import { describe, expect, it } from "vitest";
import { deepseek } from "../src/providers/deepseek.js";
import { mimo } from "../src/providers/mimo.js";
import type { ChatRequest, ResponsesRequest } from "../src/translate/types.js";

const dsCtx = {
  runtime: { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-x", flags: {} },
  exposeReasoning: true,
};

const mimoCtx = {
  runtime: { baseUrl: "https://api.xiaomimimo.com/v1", apiKey: "sk-x", flags: { isTokenPlan: false } },
  exposeReasoning: true,
};

describe("deepseek provider", () => {
  it("preprocessResponses does NOT inject thinking field (mimo-only)", () => {
    const req: ResponsesRequest = { model: "deepseek-v4-pro", input: "hello" };
    const chat = deepseek.preprocessResponses(req, dsCtx);
    expect((chat as Record<string, unknown>).thinking).toBeUndefined();
    expect(chat.enable_thinking).toBeUndefined();
  });

  it("preprocessResponses drops web_search builtin (DeepSeek doesn't have one)", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: "search for cats",
      tools: [
        { type: "web_search_preview" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "function", name: "shell", parameters: { type: "object" } },
      ] as ResponsesRequest["tools"],
    };
    const chat = deepseek.preprocessResponses(req, dsCtx);
    expect(chat.tools).toHaveLength(1);
    expect(chat.tools![0].type).toBe("function");
  });

  it("preprocessResponses respects the client's parallel_tool_calls (no force)", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: "hi",
      parallel_tool_calls: false,
    };
    const chat = deepseek.preprocessResponses(req, dsCtx);
    expect(chat.parallel_tool_calls).toBe(false);
  });

  it("preprocessChat strips thinking/enable_thinking on passthrough", () => {
    const body: ChatRequest = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled" },
      enable_thinking: true,
    };
    const out = deepseek.preprocessChat(body, dsCtx);
    expect((out as Record<string, unknown>).thinking).toBeUndefined();
    expect(out.enable_thinking).toBeUndefined();
    // original is not mutated
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("preprocessChat strips reasoning_content from assistant history (DS rejects it on input)", () => {
    const body: ChatRequest = {
      model: "deepseek-v4-pro",
      messages: [
        { role: "user", content: "first question" },
        {
          role: "assistant",
          content: "first answer",
          reasoning_content: "let me think...",
        },
        { role: "user", content: "follow-up" },
      ],
    };
    const out = deepseek.preprocessChat(body, dsCtx);
    expect(out.messages[1].reasoning_content).toBeUndefined();
    expect(out.messages[1].content).toBe("first answer");
    // Original input is not mutated.
    expect(body.messages[1].reasoning_content).toBe("let me think...");
  });

  it("preprocessResponses strips reasoning_content re-injected by reqToChat", () => {
    // Codex echoes prior reasoning items in the next request's input. reqToChat
    // re-emits them as `reasoning_content` on the assistant message (for MiMo's
    // sake). DeepSeek 400s on that — preprocessResponses must scrub it.
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "search for cats" }],
        },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "I should call search" }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "search",
          arguments: '{"q":"cats"}',
        },
        { type: "function_call_output", call_id: "call_1", output: "5 results" },
        { type: "message", role: "user", content: "thanks, more please" },
      ],
    };
    const chat = deepseek.preprocessResponses(req, dsCtx);
    for (const m of chat.messages) {
      expect(m.reasoning_content).toBeUndefined();
    }
    // Tool calls and content should still be intact.
    const assistantWithTool = chat.messages.find((m) => m.tool_calls?.length);
    expect(assistantWithTool).toBeDefined();
    expect(assistantWithTool!.tool_calls![0].function.name).toBe("search");
  });

  it("enhanceError returns null (no DS-specific error mapping yet)", () => {
    expect(deepseek.enhanceError({ status: 400, snippet: "anything" })).toBeNull();
    expect(deepseek.enhanceError({ status: 401 })).toBeNull();
  });

  it("metadata: shortcut, env keys, default model match the spec", () => {
    expect(deepseek.shortcut).toBe("ds");
    expect(deepseek.envKeys).toEqual(["DS_API_KEY", "DEEPSEEK_API_KEY"]);
    expect(deepseek.defaultModel).toBe("deepseek-v4-pro");
    expect(deepseek.defaultBaseUrl).toBe("https://api.deepseek.com/v1");
  });
});

describe("mimo provider preprocessResponses retains MiMo specifics", () => {
  it("forces parallel_tool_calls", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "hi",
      parallel_tool_calls: false,
    };
    const chat = mimo.preprocessResponses(req, mimoCtx);
    expect(chat.parallel_tool_calls).toBe(true);
  });

  it("forwards web_search when not on token-plan", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        { type: "web_search_preview" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = mimo.preprocessResponses(req, mimoCtx);
    expect(chat.tools).toHaveLength(1);
    expect(chat.tools![0].type).toBe("web_search");
  });

  it("strips web_search when isTokenPlan", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        { type: "web_search_preview" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const ctx = { ...mimoCtx, runtime: { ...mimoCtx.runtime, flags: { isTokenPlan: true } } };
    const chat = mimo.preprocessResponses(req, ctx);
    expect(chat.tools).toBeUndefined();
  });

  it("enhanceError surfaces web_search plugin hint on 400 with marker", () => {
    const err = mimo.enhanceError({
      status: 400,
      snippet:
        "web search tool found in the request body, but webSearchEnabled is false",
    });
    expect(err).not.toBeNull();
    expect(err!.code).toBe("web_search_plugin_not_activated");
    expect(err!.message).toMatch(/Web Search Plugin/);
  });

  it("enhanceError returns null for unrelated 400 errors", () => {
    expect(mimo.enhanceError({ status: 400, snippet: "Param Incorrect" })).toBeNull();
    expect(mimo.enhanceError({ status: 401 })).toBeNull();
  });

  it("preprocessResponses preserves reasoning_content (MiMo needs it back in multi-turn)", () => {
    // The opposite of the DS strip: MiMo's official guidance is to re-inject
    // prior reasoning_content. Guard against accidental cross-contamination.
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        { type: "message", role: "user", content: "search for cats" },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "I should call search" }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "search",
          arguments: '{"q":"cats"}',
        },
        { type: "function_call_output", call_id: "call_1", output: "5 results" },
      ],
    };
    const chat = mimo.preprocessResponses(req, mimoCtx);
    const assistantWithReasoning = chat.messages.find((m) => m.reasoning_content);
    expect(assistantWithReasoning).toBeDefined();
    expect(assistantWithReasoning!.reasoning_content).toBe("I should call search");
  });

  it("inferBaseUrlFromKey routes tp-* keys to the token-plan host", () => {
    expect(mimo.inferBaseUrlFromKey?.("tp-xxx")).toBe(
      "https://token-plan-cn.xiaomimimo.com/v1"
    );
    expect(mimo.inferBaseUrlFromKey?.("sk-xxx")).toBe("https://api.xiaomimimo.com/v1");
    expect(mimo.inferBaseUrlFromKey?.("anonymous")).toBeNull();
  });

  it("DeepSeek does not override base url from key prefix", () => {
    const inferred = (
      // Optional method — call only if defined.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (deepseek as any).inferBaseUrlFromKey?.("sk-xxx") ?? null
    );
    expect(inferred).toBeNull();
  });
});
