package biz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/go-kratos/kratos/v2/log"

	"github.com/7as0nch/mimo2codex/docbackend/internal/conf"
	"github.com/7as0nch/mimo2codex/docbackend/internal/data"
)

type AskInput struct {
	Question string
	Lang     string
	IPHash   string
	ClientID string
	// Images are data URLs (e.g. "data:image/jpeg;base64,…") or fetchable
	// http(s) URLs of images the user attached to the question. Capped to a
	// small number by the service layer to keep payloads bounded.
	Images []string
}

// AskEventKind tags the SSE frames sent to the browser. The frontend renders:
//   - docs:        retrieval result chips (one slug per chip)
//   - thinking:    chain-of-thought stream
//   - tool_call:   one full tool call the model is about to make (workflow row)
//   - tool_result: the search result we sent back to the model (workflow row)
//   - delta:       the visible answer body (streamed token-by-token)
type AskEventKind string

const (
	AskEventDocs       AskEventKind = "docs"
	AskEventThinking   AskEventKind = "thinking"
	AskEventToolCall   AskEventKind = "tool_call"
	AskEventToolResult AskEventKind = "tool_result"
	AskEventDelta      AskEventKind = "delta"
)

// AskEventHandler is called for every event in order during a Stream call.
// Returning non-nil aborts the stream.
type AskEventHandler func(kind AskEventKind, payload any) error

// retrievalTopK is the upper bound on docs returned per search_docs call —
// keeps each tool result small so the model can chain multiple searches
// without ballooning the context.
const retrievalTopK = 5

// maxAgentIterations caps the model→tool→model loop. 4 is plenty for this
// docs corpus; if the model loops past that it's almost certainly stuck.
const maxAgentIterations = 4

// mixedModeReasoningPlaceholder is the fallback string we put in
// `reasoning_content` when the model emitted tool_calls without first
// streaming any reasoning. MiMo's thinking mode 400s on the next round
// ("The reasoning_content in the thinking mode must be passed back to the
// API") if any prior assistant message lacks reasoning_content. A short
// honest marker satisfies the check without inventing fake reasoning.
// Mirrors the strategy used by the main mimo2codex proxy in
// src/translate/reqToChat.ts.
const mixedModeReasoningPlaceholder = "[no reasoning emitted]"

type AskUsecase struct {
	docs     *data.DocsBundle
	upstream *data.UpstreamClient
	logs     *data.AskLogRepo
	cfg      *conf.Ask
	rlCfg    *conf.RateLimit
	limiter  *IPLimiter
	lg       *log.Helper
}

func NewAskUsecase(
	docs *data.DocsBundle,
	up *data.UpstreamClient,
	logs *data.AskLogRepo,
	askCfg *conf.Ask,
	rlCfg *conf.RateLimit,
	lg log.Logger,
) *AskUsecase {
	return &AskUsecase{
		docs:     docs,
		upstream: up,
		logs:     logs,
		cfg:      askCfg,
		rlCfg:    rlCfg,
		limiter:  NewIPLimiter(rlCfg.AskPerMinute),
		lg:       log.NewHelper(lg),
	}
}

// searchDocsTool is the function definition the model sees. The slug list is
// embedded in the description so the model knows what's actually available.
func (u *AskUsecase) searchDocsTool(lang string) data.ToolDef {
	src := u.docs.EN
	if lang == "zh" && len(u.docs.ZH) > 0 {
		src = u.docs.ZH
	}
	slugs := make([]string, 0, len(src))
	for s := range src {
		slugs = append(slugs, s)
	}
	sort.Strings(slugs)

	desc := "Search the mimo2codex documentation by keywords. " +
		"Returns the top matching doc bodies. Available doc slugs: " +
		strings.Join(slugs, ", ") + ". " +
		"Always call this at least once before answering the user — don't rely on prior knowledge."

	return data.ToolDef{
		Type: "function",
		Function: data.ToolDefFunction{
			Name:        "search_docs",
			Description: desc,
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"keywords": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "Search keywords. Use a few short focused terms (English or Chinese).",
					},
					"slugs": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "Optional: explicit doc slugs to fetch instead of keyword search.",
					},
				},
			},
		},
	}
}

type searchDocsArgs struct {
	Keywords []string `json:"keywords"`
	Slugs    []string `json:"slugs"`
}

type searchHit struct {
	Slug    string `json:"slug"`
	Snippet string `json:"snippet"`
}

// executeSearchDocs runs the model's tool call: when explicit slugs are given,
// fetch those bodies; otherwise keyword-search and return the top-K. Bodies
// are truncated to keep tool results small.
func (u *AskUsecase) executeSearchDocs(lang string, raw string) (slugs []string, hits []searchHit, parsedErr error) {
	var args searchDocsArgs
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &args); err != nil {
			return nil, nil, fmt.Errorf("bad arguments: %w", err)
		}
	}

	src := u.docs.EN
	if lang == "zh" && len(u.docs.ZH) > 0 {
		src = u.docs.ZH
	}

	if len(args.Slugs) > 0 {
		// Honor the explicit-slug path with no keyword fallback so the model
		// can drill into specific docs after a broad first search.
		for _, s := range args.Slugs {
			body, ok := src[s]
			if !ok {
				continue
			}
			slugs = append(slugs, s)
			hits = append(hits, searchHit{Slug: s, Snippet: truncate(body, 3500)})
		}
		return slugs, hits, nil
	}

	query := strings.Join(args.Keywords, " ")
	slugs = u.docs.Search(query, lang, retrievalTopK)
	for _, s := range slugs {
		body, ok := src[s]
		if !ok {
			continue
		}
		hits = append(hits, searchHit{Slug: s, Snippet: truncate(body, 3500)})
	}
	return slugs, hits, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n…(truncated)"
}

// Stream drives the agent loop: send the question with the search_docs tool
// available → if the model asks to search, run it and feed results back →
// repeat until the model produces a non-empty answer or we hit the iteration
// cap. Per-day quota is enforced in-memory only. Every completed round-trip
// (success or failure) is persisted to docbackend_ask_logs for owner-side
// analytics — the browser's localStorage history is for UX only.
func (u *AskUsecase) Stream(ctx context.Context, in AskInput, onEvent AskEventHandler) error {
	if !u.limiter.Allow(in.IPHash) {
		return fmt.Errorf("%w: too many questions per minute", ErrRateLimit)
	}

	question := strings.TrimSpace(in.Question)
	if question == "" {
		return fmt.Errorf("%w: question is required", ErrValidation)
	}
	if len(question) > 2000 {
		question = question[:2000]
	}

	// Accumulators for the persistence record. We intercept every event in
	// a wrapper so the upstream onEvent stays untouched while we still see
	// the bytes flying past.
	startedAt := time.Now()
	var answerBuf, thinkingBuf strings.Builder
	allSlugsSet := map[string]bool{}
	toolCallCount := 0
	persistedErrMsg := ""

	wrappedEvent := func(kind AskEventKind, payload any) error {
		switch kind {
		case AskEventDelta:
			if s, ok := payload.(string); ok {
				answerBuf.WriteString(s)
			}
		case AskEventThinking:
			if s, ok := payload.(string); ok {
				thinkingBuf.WriteString(s)
			}
		case AskEventToolCall:
			toolCallCount++
		case AskEventDocs:
			if slugs, ok := payload.([]string); ok {
				for _, s := range slugs {
					allSlugsSet[s] = true
				}
			}
		}
		return onEvent(kind, payload)
	}

	// Persist a row on the way out, no matter how we got there. The deferred
	// closure captures the accumulators so we always log SOMETHING.
	defer func() {
		slugs := make([]string, 0, len(allSlugsSet))
		for s := range allSlugsSet {
			slugs = append(slugs, s)
		}
		sort.Strings(slugs)
		slugsJSON, _ := json.Marshal(slugs)
		row := &data.AskLog{
			ClientID:       in.ClientID,
			IPHash:         in.IPHash,
			Lang:           in.Lang,
			Question:       question,
			ImageCount:     len(in.Images),
			RetrievedSlugs: string(slugsJSON),
			Answer:         answerBuf.String(),
			Thinking:       thinkingBuf.String(),
			ToolCallCount:  toolCallCount,
			Errored:        persistedErrMsg != "",
			ErrorMsg:       persistedErrMsg,
			DurationMs:     int(time.Since(startedAt).Milliseconds()),
		}
		// Use a fresh context so a cancelled request doesn't drop the log.
		// 2s is plenty for a single insert against the in-cluster PG.
		saveCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := u.logs.Save(saveCtx, row); err != nil {
			u.lg.Warnf("ask log save failed: %v", err)
		}
	}()

	lang := strings.ToLower(strings.TrimSpace(in.Lang))
	if lang != "zh" {
		lang = "en"
	}

	systemPrompt := u.cfg.SystemPromptEn
	if lang == "zh" {
		systemPrompt = u.cfg.SystemPromptZh
	}
	systemPrompt += "\n\nYou have a single tool: search_docs(keywords?, slugs?). " +
		"Call it at least once to look up relevant docs before answering. " +
		"You may chain multiple searches if the first set of results doesn't cover the question. " +
		"Quote concrete commands and slugs from the docs in your answer. " +
		"Format your final answer in Markdown — use headings, lists, code blocks and inline code where it helps the reader."

	tool := u.searchDocsTool(lang)
	tools := []data.ToolDef{tool}

	// User message: plain string when no images attached, multimodal array
	// otherwise. MiMo V2.5 requires a text part alongside any image_url part,
	// so we always include the question text — never naked images.
	var userContent any = question
	if len(in.Images) > 0 {
		parts := make([]data.ContentPart, 0, len(in.Images)+1)
		parts = append(parts, data.ContentPart{Type: "text", Text: question})
		for _, url := range in.Images {
			url = strings.TrimSpace(url)
			if url == "" {
				continue
			}
			parts = append(parts, data.ContentPart{
				Type:     "image_url",
				ImageURL: &data.ImageURLRef{URL: url},
			})
		}
		userContent = parts
	}

	messages := []data.ChatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userContent},
	}

	maxTokens := u.cfg.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024
	}

	// Track every slug the model ever pulled, so the UI's "checked docs" chip
	// row reflects the full set across multiple search iterations.
	uniqSlugs := map[string]bool{}
	pushUniqSlugs := func(s []string) []string {
		for _, slug := range s {
			uniqSlugs[slug] = true
		}
		out := make([]string, 0, len(uniqSlugs))
		for slug := range uniqSlugs {
			out = append(out, slug)
		}
		sort.Strings(out)
		return out
	}

	for iter := 0; iter < maxAgentIterations; iter++ {
		streamResult, err := u.upstream.StreamChat(ctx, messages, tools, maxTokens,
			func(kind data.ChunkKind, text string) error {
				switch kind {
				case data.ChunkKindThinking:
					return wrappedEvent(AskEventThinking, text)
				case data.ChunkKindContent:
					return wrappedEvent(AskEventDelta, text)
				}
				return nil
			},
		)
		if err != nil {
			// User aborted the SSE stream (closed drawer / clicked stop /
			// navigated away). Not a real failure — quit the agent loop, let
			// the deferred AskLog save whatever partial content we already
			// streamed, and DON'T mark the row as errored.
			if errors.Is(err, context.Canceled) {
				return nil
			}
			persistedErrMsg = err.Error()
			return fmt.Errorf("%w: %v", ErrInternal, err)
		}

		// If the model didn't ask for tools, it produced the final answer in
		// the delta stream — we're done.
		if len(streamResult.ToolCalls) == 0 {
			return nil
		}

		// The model paused to invoke tools. Echo the assistant turn into the
		// history — required for two reasons:
		//   1. tool_call_id linkage: each upcoming role="tool" message refers
		//      back to a tool_call by id, so the call must exist in history.
		//   2. reasoning_content roundtrip: MiMo V2.5 in thinking mode rejects
		//      the next request if any prior assistant message lacks
		//      reasoning_content. We forward whatever the model emitted and
		//      backfill a placeholder if it produced tool_calls without any
		//      reasoning preamble (uncommon but possible).
		reasoning := streamResult.ReasoningContent
		if reasoning == "" {
			reasoning = mixedModeReasoningPlaceholder
		}
		messages = append(messages, data.ChatMessage{
			Role:             "assistant",
			Content:          streamResult.Content,
			ReasoningContent: reasoning,
			ToolCalls:        streamResult.ToolCalls,
		})

		for _, tc := range streamResult.ToolCalls {
			if err := wrappedEvent(AskEventToolCall, map[string]any{
				"id":        tc.ID,
				"name":      tc.Function.Name,
				"arguments": tc.Function.Arguments,
			}); err != nil {
				return err
			}

			var hits []searchHit
			var slugs []string
			var execErr error
			switch tc.Function.Name {
			case "search_docs":
				slugs, hits, execErr = u.executeSearchDocs(lang, tc.Function.Arguments)
			default:
				execErr = fmt.Errorf("unknown tool %q", tc.Function.Name)
			}

			resultPayload := map[string]any{}
			if execErr != nil {
				resultPayload["error"] = execErr.Error()
			} else {
				resultPayload["slugs"] = slugs
				resultPayload["hits"] = hits
			}
			if err := wrappedEvent(AskEventToolResult, map[string]any{
				"id":     tc.ID,
				"name":   tc.Function.Name,
				"result": resultPayload,
			}); err != nil {
				return err
			}
			if err := wrappedEvent(AskEventDocs, pushUniqSlugs(slugs)); err != nil {
				return err
			}

			toolJSON, _ := json.Marshal(resultPayload)
			messages = append(messages, data.ChatMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Content:    string(toolJSON),
			})
		}
	}

	persistedErrMsg = fmt.Sprintf("agent loop exceeded %d iterations", maxAgentIterations)
	return fmt.Errorf("%w: agent loop exceeded %d iterations without answering", ErrInternal, maxAgentIterations)
}
