package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/7as0nch/mimo2codex/docbackend/internal/biz"
	"github.com/7as0nch/mimo2codex/docbackend/internal/conf"
)

type AskService struct {
	uc  *biz.AskUsecase
	sec *conf.Security
}

func NewAskService(uc *biz.AskUsecase, sec *conf.Security) *AskService {
	return &AskService{uc: uc, sec: sec}
}

type askReq struct {
	Question string   `json:"question"`
	Lang     string   `json:"lang"`
	Images   []string `json:"images,omitempty"`
	// ClientID kept here even though /api/ask doesn't persist anything per
	// client — the frontend wraps EVERY request body with clientId for
	// uniformity. Without this field, DisallowUnknownFields would reject
	// the JSON and the user sees a 400.
	ClientID string `json:"clientId,omitempty"`
}

// maxImageCount caps how many images a single /api/ask request may carry.
// 4 is enough for a screenshot-heavy "look at my config" question without
// letting a single request balloon to tens of MB.
const maxImageCount = 4

// askBodyCap is the max accepted body size in bytes. Each compressed image
// is ~250-600 KB base64-encoded; 8 MB leaves headroom for 4 images + the
// question text without inviting OOM-by-paste.
const askBodyCap = 8 << 20

// HandleAsk replies with text/event-stream. Each delta is emitted as
// `data: {"delta":"..."}\n\n`, terminating with `data: {"done":true}\n\n`.
// Errors after the first byte cannot become HTTP statuses, so they are
// inlined as `data: {"error":"..."}\n\n` for the client to render.
func (s *AskService) HandleAsk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var req askReq
	if err := decodeJSON(r, &req, askBodyCap); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json: " + err.Error()})
		return
	}

	// Cap attached image count server-side regardless of what the client sent.
	if len(req.Images) > maxImageCount {
		req.Images = req.Images[:maxImageCount]
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering for SSE

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming not supported"})
		return
	}

	emit := func(payload any) {
		buf, _ := json.Marshal(payload)
		fmt.Fprintf(w, "data: %s\n\n", buf)
		flusher.Flush()
	}

	err := s.uc.Stream(r.Context(), biz.AskInput{
		Question: req.Question,
		Lang:     req.Lang,
		IPHash:   IPHash(r, s.sec.IPSalt),
		ClientID: clientIDFrom(r, req.ClientID),
		Images:   req.Images,
	}, func(kind biz.AskEventKind, payload any) error {
		// Emit one SSE frame per event. We use the kind as the JSON key so the
		// frontend can branch on { docs: [...] } vs { thinking: "..." } vs
		// { delta: "..." } without needing a separate `event:` field.
		emit(map[string]any{string(kind): payload})
		return nil
	})

	if err != nil {
		// If the client connection was already gone (user closed the drawer
		// or aborted the fetch), there's nothing to emit — writing to a dead
		// socket only churns logs. biz/ask.go already treats context.Canceled
		// as a graceful exit (returns nil), so we shouldn't actually get
		// here for that case; the check is belt + braces.
		if errors.Is(err, context.Canceled) || r.Context().Err() != nil {
			return
		}
		// Validation / rate-limit errors are safe to expose verbatim. For
		// upstream / internal errors we surface the wrapped message so the
		// frontend can show something actionable — masking everything as
		// "upstream error" was hiding the actual cause (e.g. tool-message
		// shape rejected by MiMo) during debugging.
		if errors.Is(err, biz.ErrValidation) || errors.Is(err, biz.ErrRateLimit) {
			emit(map[string]string{"error": err.Error()})
		} else {
			emit(map[string]string{"error": err.Error()})
		}
		return
	}
	// Skip the final "done" frame if the client already hung up — same
	// reasoning as above.
	if r.Context().Err() != nil {
		return
	}
	emit(map[string]bool{"done": true})
}
