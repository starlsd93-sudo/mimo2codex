package data

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/7as0nch/mimo2codex/docbackend/internal/conf"
)

// UpstreamClient calls an OpenAI-compatible Chat Completions endpoint and
// forwards streamed content + reasoning + tool_calls back to the caller. The
// agent loop in biz/ask.go drives multi-turn tool calling on top of this.
type UpstreamClient struct {
	cfg  *conf.Upstream
	http *http.Client
}

func NewUpstreamClient(cfg *conf.Upstream) *UpstreamClient {
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 90 * time.Second
	}
	return &UpstreamClient{
		cfg: cfg,
		http: &http.Client{
			Timeout: timeout,
		},
	}
}

// ChatMessage is the OpenAI-compatible message shape, extended with the
// fields needed for tool calling and multimodal input. Content is typed as
// `any` so callers can pass a plain `string` (the common case) or a
// `[]ContentPart` for vision messages — both forms are valid in the
// OpenAI / MiMo Chat Completions API.
//
// IMPORTANT: Content is intentionally NOT tagged omitempty. Some providers
// (MiMo V2.5 is the case in point) require `content: null` to be present on
// assistant turns that carry tool_calls — silently dropping the field causes
// the next round-trip to fail with an upstream 400. Keeping the field forces
// nil → JSON null, string → JSON string, and []ContentPart → JSON array, all
// of which the upstream accepts.
type ChatMessage struct {
	Role string `json:"role"`
	Content any `json:"content"`
	// ReasoningContent is required on assistant turns once thinking has been
	// emitted in the conversation — MiMo V2.5 in thinking mode 400s with
	// "The reasoning_content in the thinking mode must be passed back to the
	// API" if a prior assistant message in `messages` lacks it. We populate
	// this when echoing the model's first turn back into history for the
	// agent loop (see biz/ask.go).
	ReasoningContent string                `json:"reasoning_content,omitempty"`
	ToolCallID       string                `json:"tool_call_id,omitempty"`
	ToolCalls        []ChatMessageToolCall `json:"tool_calls,omitempty"`
}

// ContentPart is one element of a multimodal user message. Use Type="text"
// with Text set, or Type="image_url" with ImageURL pointing to a data URL or
// fetchable HTTP URL. MiMo V2.5 follows the OpenAI shape for vision input.
type ContentPart struct {
	Type     string       `json:"type"`
	Text     string       `json:"text,omitempty"`
	ImageURL *ImageURLRef `json:"image_url,omitempty"`
}

type ImageURLRef struct {
	URL string `json:"url"`
}

type ChatMessageToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"` // always "function" for now
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// ToolDef is one entry in the `tools` array of a Chat Completions request.
// Parameters is a JSON-schema-shaped any; we keep it untyped because we only
// build it in one place (biz/ask.go) and shipping a strict struct would just
// trade clarity for boilerplate.
type ToolDef struct {
	Type     string           `json:"type"`
	Function ToolDefFunction  `json:"function"`
}

type ToolDefFunction struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"`
}

type chatRequest struct {
	Model               string        `json:"model"`
	Messages            []ChatMessage `json:"messages"`
	Tools               []ToolDef     `json:"tools,omitempty"`
	ToolChoice          string        `json:"tool_choice,omitempty"`
	Stream              bool          `json:"stream"`
	MaxCompletionTokens int           `json:"max_completion_tokens,omitempty"`
}

// streamToolCall is the partial tool_call fragment we accumulate across stream
// chunks. The upstream emits the call's name in one early frame and then
// streams its `arguments` JSON character-by-character — we concatenate until
// finish_reason="tool_calls".
type streamToolCall struct {
	Index     int
	ID        string
	Type      string
	Name      string
	Arguments strings.Builder
}

type chatStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
			ToolCalls        []struct {
				Index    int    `json:"index"`
				ID       string `json:"id,omitempty"`
				Type     string `json:"type,omitempty"`
				Function struct {
					Name      string `json:"name,omitempty"`
					Arguments string `json:"arguments,omitempty"`
				} `json:"function,omitempty"`
			} `json:"tool_calls,omitempty"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason,omitempty"`
	} `json:"choices"`
}

// ChunkKind tags whether a streamed fragment is the visible answer, the
// model's reasoning trace, or part of a tool call. The frontend renders them
// in different UI slots (answer body, collapsible "thinking" panel, workflow
// timeline).
type ChunkKind string

const (
	ChunkKindContent  ChunkKind = "delta"
	ChunkKindThinking ChunkKind = "thinking"
)

// StreamResult tells the caller why the stream ended: the model finished its
// answer ("stop") or paused to invoke tools ("tool_calls"). When tool calls
// are present, the caller must execute them and start another stream with
// the results appended to the message list. Content/ReasoningContent are
// accumulated copies of whatever was forwarded via onChunk — needed so the
// agent loop can echo the assistant turn (incl. reasoning_content) back
// into the next round's history, which MiMo's thinking mode demands.
type StreamResult struct {
	FinishReason     string
	ToolCalls        []ChatMessageToolCall
	Content          string
	ReasoningContent string
}

// StreamChat opens a streaming Chat Completions call and invokes onChunk for
// every non-empty content/reasoning fragment. Tool-call fragments are buffered
// internally and returned in the StreamResult when the model finishes its
// turn — they aren't fed to onChunk because partial tool args mean nothing
// until fully assembled.
func (u *UpstreamClient) StreamChat(
	ctx context.Context,
	messages []ChatMessage,
	tools []ToolDef,
	maxTokens int,
	onChunk func(kind ChunkKind, text string) error,
) (*StreamResult, error) {
	if u.cfg.APIKey == "" {
		return nil, fmt.Errorf("upstream API key is not configured")
	}
	if u.cfg.BaseURL == "" {
		return nil, fmt.Errorf("upstream base URL is not configured")
	}
	if u.cfg.Model == "" {
		return nil, fmt.Errorf("upstream model is not configured")
	}

	reqBody := chatRequest{
		Model:               u.cfg.Model,
		Messages:            messages,
		Tools:               tools,
		Stream:              true,
		MaxCompletionTokens: maxTokens,
	}
	if len(tools) > 0 {
		reqBody.ToolChoice = "auto"
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal chat request: %w", err)
	}

	endpoint := strings.TrimRight(u.cfg.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build upstream request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+u.cfg.APIKey)
	req.Header.Set("Accept", "text/event-stream")

	resp, err := u.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upstream call: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("upstream %d: %s", resp.StatusCode, string(raw))
	}

	result := &StreamResult{}
	toolBuf := map[int]*streamToolCall{}
	var contentBuf, reasoningBuf strings.Builder

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			// Distinguish "user gave up" from "stream actually broke". If the
			// request context is gone, the client (browser fetch + abort
			// controller) hung up; net/http surfaces that as context.Canceled
			// on the next Read. Return whatever we accumulated so callers can
			// persist a partial answer, and let them recognise the cause via
			// errors.Is(err, context.Canceled).
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				result.Content = contentBuf.String()
				result.ReasoningContent = reasoningBuf.String()
				return result, context.Canceled
			}
			return nil, fmt.Errorf("read upstream stream: %w", err)
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			break
		}
		var chunk chatStreamChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			// Skip keep-alives and non-JSON noise.
			continue
		}
		for _, ch := range chunk.Choices {
			if ch.Delta.ReasoningContent != "" {
				reasoningBuf.WriteString(ch.Delta.ReasoningContent)
				if err := onChunk(ChunkKindThinking, ch.Delta.ReasoningContent); err != nil {
					return nil, err
				}
			}
			if ch.Delta.Content != "" {
				contentBuf.WriteString(ch.Delta.Content)
				if err := onChunk(ChunkKindContent, ch.Delta.Content); err != nil {
					return nil, err
				}
			}
			for _, tc := range ch.Delta.ToolCalls {
				slot, ok := toolBuf[tc.Index]
				if !ok {
					slot = &streamToolCall{Index: tc.Index}
					toolBuf[tc.Index] = slot
				}
				if tc.ID != "" {
					slot.ID = tc.ID
				}
				if tc.Type != "" {
					slot.Type = tc.Type
				}
				if tc.Function.Name != "" {
					slot.Name = tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					slot.Arguments.WriteString(tc.Function.Arguments)
				}
			}
			if ch.FinishReason != "" {
				result.FinishReason = ch.FinishReason
			}
		}
	}

	if len(toolBuf) > 0 {
		// Order by index so the caller invokes tools in the model's intended
		// sequence (matters when the model expects results to come back in
		// the same order it requested them).
		maxIdx := -1
		for i := range toolBuf {
			if i > maxIdx {
				maxIdx = i
			}
		}
		for i := 0; i <= maxIdx; i++ {
			slot, ok := toolBuf[i]
			if !ok {
				continue
			}
			call := ChatMessageToolCall{
				ID:   slot.ID,
				Type: slot.Type,
			}
			if call.Type == "" {
				call.Type = "function"
			}
			call.Function.Name = slot.Name
			call.Function.Arguments = slot.Arguments.String()
			result.ToolCalls = append(result.ToolCalls, call)
		}
	}

	if result.FinishReason == "" && len(result.ToolCalls) > 0 {
		// Some providers omit finish_reason on the final tool-call chunk.
		// If we got tool calls but no explicit reason, infer it.
		result.FinishReason = "tool_calls"
	}
	result.Content = contentBuf.String()
	result.ReasoningContent = reasoningBuf.String()
	return result, nil
}
