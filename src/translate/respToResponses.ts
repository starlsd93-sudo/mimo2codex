import type {
  ChatResponse,
  ResponsesObject,
  ResponsesOutputItem,
  ResponsesRequest,
  ResponsesUsage,
} from "./types.js";
import {
  newFunctionCallId,
  newMessageId,
  newReasoningId,
  newResponseId,
} from "../util/ids.js";
import { applyInlineThinkSplitToMessage } from "./minimaxCompat.js"; // minimax-compat

export interface RespToResponsesOpts {
  exposeReasoning: boolean;
  /**
   * minimax-compat: 在生成 Responses 输出之前，先把 `message.content` 里的 inline
   * `<think>...</think>` 块切到 `message.reasoning_content`。MiniMax M1/M2/M3 等
   * inline-thinking 上游必开；否则 thinking 文本会泄漏给 Codex 当作 assistant 文本显示。
   */
  extractInlineThink?: boolean;
  /**
   * tool name → namespace name 映射。Codex Desktop 的 namespace 工具（如
   * multi_agent_v1 下的 spawn_agent）在响应中需要带 namespace 字段，否则客户端
   * 无法路由到正确的 handler（报 unsupported call）。
   */
  namespaceMap?: Map<string, string>;
}

function mapUsage(u: ChatResponse["usage"]): ResponsesUsage | null {
  if (!u) return null;
  const out: ResponsesUsage = {
    input_tokens: u.prompt_tokens,
    output_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
  };
  if (u.prompt_tokens_details?.cached_tokens !== undefined) {
    out.input_tokens_details = { cached_tokens: u.prompt_tokens_details.cached_tokens };
  }
  if (u.completion_tokens_details?.reasoning_tokens !== undefined) {
    out.output_tokens_details = {
      reasoning_tokens: u.completion_tokens_details.reasoning_tokens,
    };
  }
  return out;
}

export function respToResponses(
  chat: ChatResponse,
  req: ResponsesRequest,
  opts: RespToResponsesOpts
): ResponsesObject {
  const choice = chat.choices[0];
  const message = choice?.message;
  const output: ResponsesOutputItem[] = [];

  // minimax-compat: 先把 <think>...</think> 从 message.content 切到 reasoning_content，
  // 后续 reasoning_content 分支就能自然吃到。message 是 ChatChoiceMessage 即外部
  // ChatResponse 的子结构，原地改写不影响其他字段。
  if (opts.extractInlineThink && message) {
    applyInlineThinkSplitToMessage(
      message as unknown as { content?: string | unknown; reasoning_content?: string | null },
    );
  }

  if (message?.reasoning_content) {
    // Always pin the FULL reasoning text in `encrypted_content` — Codex
    // treats it as opaque and echoes it back verbatim on the next turn,
    // which `reqToChat` then re-injects as `reasoning_content` on the prior
    // assistant message. MiMo's "passing back reasoning_content" spec
    // requires this for multi-turn tool-call quality (without it the model
    // tends to "narrate" or free-associate instead of calling tools).
    // `summary` is the user-visible channel: populated only when the user
    // wants to see thinking in the terminal (default), empty under
    // --no-reasoning so we hide it from display but still round-trip.
    output.push({
      type: "reasoning",
      id: newReasoningId(),
      summary: opts.exposeReasoning
        ? [{ type: "summary_text", text: message.reasoning_content }]
        : [],
      encrypted_content: message.reasoning_content,
      status: "completed",
    });
  }

  if (message?.content) {
    // Translate MiMo annotations (url_citation with url/title/summary) into
    // Codex-shape annotations on the output_text content part. Codex displays
    // these as inline citations.
    const annotations =
      message.annotations?.map((a) => ({
        type: a.type ?? "url_citation",
        url: a.url ?? "",
        title: a.title ?? "",
        ...(a.summary !== undefined ? { snippet: a.summary } : {}),
      })) ?? [];
    output.push({
      type: "message",
      id: newMessageId(),
      role: "assistant",
      status: "completed",
      content: [
        { type: "output_text", text: message.content, annotations },
      ],
    });
  }

  if (message?.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      const item: ResponsesOutputItem & { namespace?: string } = {
        type: "function_call",
        id: newFunctionCallId(),
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        status: "completed",
      };
      const ns = opts.namespaceMap?.get(tc.function.name);
      if (ns) item.namespace = ns;
      output.push(item);
    }
  }

  const finishReason = choice?.finish_reason ?? "stop";
  const incomplete = finishReason === "length" ? { reason: "max_output_tokens" } : null;

  return {
    id: newResponseId(),
    object: "response",
    created_at: chat.created,
    status: incomplete ? "incomplete" : "completed",
    model: chat.model,
    output,
    usage: mapUsage(chat.usage),
    parallel_tool_calls: req.parallel_tool_calls ?? true,
    tool_choice: req.tool_choice ?? "auto",
    reasoning: {
      effort: req.reasoning?.effort ?? null,
      summary: req.reasoning?.summary ?? null,
    },
    text: req.text?.format ? { format: req.text.format } : { format: { type: "text" } },
    incomplete_details: incomplete,
    error: null,
    metadata: req.metadata ?? null,
    previous_response_id: req.previous_response_id ?? null,
    instructions: req.instructions ?? null,
    temperature: req.temperature ?? null,
    top_p: req.top_p ?? null,
    max_output_tokens: req.max_output_tokens ?? null,
    tools: req.tools ?? [],
    truncation: "disabled",
  };
}
