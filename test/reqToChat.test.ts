import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { reqToChat } from "../src/translate/reqToChat.js";
import type { ResponsesRequest } from "../src/translate/types.js";

describe("reqToChat", () => {
  it("instructions-only request becomes a single system message", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      instructions: "You are MiMo.",
      input: [],
    };
    const chat = reqToChat(req);
    expect(chat).toEqual({
      model: "mimo-v2.5-pro",
      messages: [{ role: "system", content: "You are MiMo." }],
      stream: false,
    });
  });

  it("simple user text", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      instructions: "be helpful",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ]);
  });

  it("string input is treated as user content", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "hello",
    };
    const chat = reqToChat(req);
    expect(chat.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("developer role becomes system", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "x" }] },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages[0]).toEqual({ role: "system", content: "x" });
  });

  it("tool definitions wrap into function objects", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [{ type: "message", role: "user", content: "go" }],
      tools: [
        {
          type: "function",
          name: "shell",
          description: "run shell",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
          strict: true,
        },
      ],
      tool_choice: "auto",
    };
    const chat = reqToChat(req);
    expect(chat.tools).toEqual([
      {
        type: "function",
        function: {
          name: "shell",
          description: "run shell",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
          strict: true,
        },
      },
    ]);
    expect(chat.tool_choice).toBe("auto");
  });

  it("tool_choice with named function", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [{ type: "message", role: "user", content: "go" }],
      tool_choice: { type: "function", function: { name: "shell" } },
    };
    const chat = reqToChat(req);
    expect(chat.tool_choice).toEqual({ type: "function", function: { name: "shell" } });
  });

  // issue #11 regression: 默认（未传 strict）/ 显式传 null 时，都不应该在
  // outgoing function 上写 `strict: null` — MiMo 的 Pydantic schema 会以
  // "Input should be a valid boolean" 400。
  it("function tool without strict → outgoing tool omits strict field (issue #11)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [{ type: "message", role: "user", content: "go" }],
      tools: [
        {
          type: "function",
          name: "shell",
          parameters: { type: "object" },
        },
      ],
    };
    const chat = reqToChat(req);
    const fn = (chat.tools![0] as { function: Record<string, unknown> }).function;
    expect("strict" in fn).toBe(false);
  });

  it("function tool with explicit strict: null → outgoing tool omits strict field (issue #11)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [{ type: "message", role: "user", content: "go" }],
      tools: [
        {
          type: "function",
          name: "shell",
          parameters: { type: "object" },
          strict: null,
        } as unknown as ResponsesRequest["tools"][number],
      ],
    };
    const chat = reqToChat(req);
    const fn = (chat.tools![0] as { function: Record<string, unknown> }).function;
    expect("strict" in fn).toBe(false);
  });

  it("function tool with explicit strict: false → outgoing tool preserves strict: false (issue #11)", () => {
    // 显式 boolean 必须保留（用户明确意图）
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [{ type: "message", role: "user", content: "go" }],
      tools: [
        {
          type: "function",
          name: "shell",
          parameters: { type: "object" },
          strict: false,
        },
      ],
    };
    const chat = reqToChat(req);
    const fn = (chat.tools![0] as { function: { strict?: boolean } }).function;
    expect(fn.strict).toBe(false);
  });

  it("local_shell builtin → outgoing shell function omits strict field (issue #11)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [{ type: "message", role: "user", content: "go" }],
      tools: [{ type: "local_shell" }],
    };
    const chat = reqToChat(req);
    const fn = (chat.tools![0] as { function: Record<string, unknown> }).function;
    expect("strict" in fn).toBe(false);
    expect(fn.name).toBe("shell");
  });

  it("custom tool → outgoing function omits strict field (issue #11)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [{ type: "message", role: "user", content: "go" }],
      tools: [
        {
          type: "custom",
          name: "grammar_tool",
          description: "custom thing",
          format: { type: "grammar" },
        } as unknown as ResponsesRequest["tools"][number],
      ],
    };
    const chat = reqToChat(req);
    const fn = (chat.tools![0] as { function: Record<string, unknown> }).function;
    expect("strict" in fn).toBe(false);
  });

  it("function_call from history with output (round trip after tool exec)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "list files" }] },
        {
          type: "function_call",
          call_id: "call_abc",
          name: "shell",
          arguments: '{"cmd":"ls"}',
        },
        { type: "function_call_output", call_id: "call_abc", output: "a.txt\nb.txt" },
        { type: "message", role: "user", content: "thanks, count them" },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages).toEqual([
      { role: "user", content: "list files" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_abc",
            type: "function",
            function: { name: "shell", arguments: '{"cmd":"ls"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_abc", content: "a.txt\nb.txt" },
      { role: "user", content: "thanks, count them" },
    ]);
  });

  it("assistant text + reasoning + function_calls in same turn collapse into ONE assistant message", () => {
    // Regression: previously the assistant message item triggered an immediate
    // flush, leaving the subsequent function_call items in a second assistant
    // message without reasoning_content. DeepSeek V4 thinking mode rejects
    // assistant messages without reasoning_content with 400
    // "The reasoning_content in the thinking mode must be passed back to the API".
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: "几点了，项目大不大" },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "I'll check the time and list files." }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "先快速扫一眼项目结构" }],
        },
        {
          type: "function_call",
          call_id: "c1",
          name: "shell",
          arguments: '{"command":["date"]}',
        },
        { type: "function_call_output", call_id: "c1", output: "2026-05-10 14:17" },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages).toEqual([
      { role: "user", content: "几点了，项目大不大" },
      {
        role: "assistant",
        content: "先快速扫一眼项目结构",
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "shell", arguments: '{"command":["date"]}' },
          },
        ],
        reasoning_content: "I'll check the time and list files.",
      },
      { role: "tool", tool_call_id: "c1", content: "2026-05-10 14:17" },
    ]);
  });

  it("reasoning + function_call collapse into single assistant turn with reasoning_content", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        { type: "message", role: "user", content: "search for cats" },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "I should call the search tool." }],
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
    const chat = reqToChat(req);
    expect(chat.messages).toEqual([
      { role: "user", content: "search for cats" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "search", arguments: '{"q":"cats"}' },
          },
        ],
        reasoning_content: "I should call the search tool.",
      },
      { role: "tool", tool_call_id: "call_1", content: "5 results" },
    ]);
  });

  it("reasoning AFTER function_call folds into the SAME assistant message (DeepSeek 400 bug)", () => {
    // Regression for DeepSeek 400:
    //   "An assistant message with 'tool_calls' must be followed by tool messages
    //    responding to each 'tool_call_id'. (insufficient tool messages following
    //    tool_calls message)"
    //
    // Codex sometimes emits reasoning AFTER the function_call (or between
    // function_call and function_call_output). Previously this flushed the
    // pending tool_calls into one assistant message and the reasoning into a
    // SECOND assistant message — interposing it between tool_calls and the
    // tool result, which violates the Chat Completions contiguity invariant.
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: "run ls" },
        {
          type: "function_call",
          call_id: "call_1",
          name: "shell",
          arguments: '{"cmd":"ls"}',
        },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "thought about it after deciding to call" }],
        },
        { type: "function_call_output", call_id: "call_1", output: "a.txt" },
      ],
    };
    const chat = reqToChat(req);
    // The crucial structural invariant: assistant(tool_calls) MUST be
    // immediately followed by tool messages — no other assistant message
    // may be wedged in between.
    expect(chat.messages).toEqual([
      { role: "user", content: "run ls" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "shell", arguments: '{"cmd":"ls"}' },
          },
        ],
        reasoning_content: "thought about it after deciding to call",
      },
      { role: "tool", tool_call_id: "call_1", content: "a.txt" },
    ]);
  });

  it("reasoning BETWEEN multiple function_calls in the same turn folds correctly", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: "do A and B" },
        {
          type: "function_call",
          call_id: "call_A",
          name: "shell",
          arguments: '{"cmd":"A"}',
        },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "now also calling B" }],
        },
        {
          type: "function_call",
          call_id: "call_B",
          name: "shell",
          arguments: '{"cmd":"B"}',
        },
        { type: "function_call_output", call_id: "call_A", output: "ra" },
        { type: "function_call_output", call_id: "call_B", output: "rb" },
      ],
    };
    const chat = reqToChat(req);
    // Both tool_calls in ONE assistant message, both tool messages follow
    // immediately, no interloper.
    expect(chat.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
    expect(chat.messages[1].tool_calls?.map((tc) => tc.id)).toEqual([
      "call_A",
      "call_B",
    ]);
    expect(chat.messages[2].tool_call_id).toBe("call_A");
    expect(chat.messages[3].tool_call_id).toBe("call_B");
  });

  it("missing function_call_output gets a synthetic tool message placeholder (defensive)", () => {
    // Defensive backstop: if Codex's input is missing a function_call_output
    // for one of the tool_calls (cancelled turn, dropped output, etc.),
    // synthesize a placeholder tool message rather than emit an invalid body.
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: "do A and B" },
        {
          type: "function_call",
          call_id: "call_A",
          name: "shell",
          arguments: '{"cmd":"A"}',
        },
        {
          type: "function_call",
          call_id: "call_B",
          name: "shell",
          arguments: '{"cmd":"B"}',
        },
        { type: "function_call_output", call_id: "call_A", output: "ra" },
        // call_B output is MISSING
        { type: "message", role: "user", content: "follow-up" },
      ],
    };
    const chat = reqToChat(req);
    const idxAsst = chat.messages.findIndex(
      (m) => m.role === "assistant" && m.tool_calls?.length
    );
    expect(idxAsst).toBeGreaterThanOrEqual(0);
    const expectedIds = chat.messages[idxAsst].tool_calls!.map((tc) => tc.id);
    // Collect tool messages immediately following the assistant.
    const followingTools: string[] = [];
    for (let i = idxAsst + 1; i < chat.messages.length; i++) {
      const m = chat.messages[i];
      if (m.role !== "tool") break;
      followingTools.push(m.tool_call_id!);
    }
    expect(followingTools).toEqual(expectedIds);
  });

  it("user message with text + image parts (omni model — images preserved)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2-omni",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "what's this?" },
            { type: "input_image", image_url: "https://x/y.png", detail: "auto" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what's this?" },
        { type: "image_url", image_url: { url: "https://x/y.png", detail: "auto" } },
      ],
    });
  });

  it("drops image parts on non-omni model and adds an inline placeholder note", () => {
    // mimo-v2.5-pro and friends return 404 "No endpoints found that support image
    // input" if image_url parts are forwarded. We strip them with a short note so
    // the model still has context that an image was attached.
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "what's this?" },
            { type: "input_image", image_url: "https://x/y.png" },
            { type: "input_image", image_url: "https://x/z.png" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    // Should be a single user message with text only (collapsed to string when
    // all parts are text after dropping images)
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].role).toBe("user");
    const content = chat.messages[0].content;
    expect(typeof content).toBe("string");
    expect(content).toContain("what's this?");
    expect(content).toContain("2 image attachments omitted");
    expect(content).toContain("mimo-v2-omni");
    // Definitely no image_url part
    expect(JSON.stringify(chat.messages[0])).not.toContain("image_url");
  });

  it("preserves images on plain `mimo-v2.5` (image-understanding model per docs)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "describe" },
            { type: "input_image", image_url: "https://x/y.png" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    expect(JSON.stringify(chat.messages[0])).toContain("image_url");
  });

  it("DROPS images on mimo-v2.5-pro (per official docs: only mimo-v2.5 and -omni support vision)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "what's this?" },
            { type: "input_image", image_url: "https://x/y.png" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    expect(JSON.stringify(chat.messages[0])).not.toContain("image_url");
    expect(chat.messages[0].content).toContain("what's this?");
    expect(chat.messages[0].content).toContain("image attachment");
  });

  it("ensures a text part exists when image_url is present (avoid MiMo 400 'text is not set')", () => {
    // Image-only user message — Codex CLI / desktop allow paste+enter without typing.
    // MiMo's image API requires at least one text part in the content array.
    const req: ResponsesRequest = {
      model: "mimo-v2.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "https://x/y.png" }],
        },
      ],
    };
    const chat = reqToChat(req);
    const content = chat.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string }>;
    // Must have BOTH image_url and text parts
    expect(parts.some((p) => p.type === "image_url")).toBe(true);
    expect(parts.some((p) => p.type === "text")).toBe(true);
  });

  it("does NOT add a fallback text part when image is absent (text-only stays clean)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
    };
    const chat = reqToChat(req);
    // text-only collapses to string, no extra spaces or padding parts
    expect(chat.messages[0].content).toBe("hello");
  });

  it("filters input_text parts whose `text` is empty/missing — MiMo rejects them", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "" },
            { type: "input_text" } as unknown as { type: "input_text"; text: string },
            { type: "input_text", text: "real content" },
            { type: "input_image", image_url: "https://x/y.png" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    const content = chat.messages[0].content as Array<{ type: string; text?: string }>;
    const textParts = content.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toBe("real content");
  });

  it("on pro model with image-only message, output is non-empty text-only string (the original 400 case)", () => {
    // The exact scenario that produced "MiMo returned 400: text is not set":
    // model = mimo-v2.5-pro (no vision) + content has only an image.
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "https://x/y.png" }],
        },
      ],
    };
    const chat = reqToChat(req);
    const content = chat.messages[0].content;
    expect(typeof content).toBe("string");
    expect((content as string).length).toBeGreaterThan(0);
    expect(content).toContain("image attachment");
    expect(JSON.stringify(chat.messages[0])).not.toContain("image_url");
  });

  it("max_output_tokens maps to max_completion_tokens (not max_tokens)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      max_output_tokens: 1024,
    };
    const chat = reqToChat(req);
    expect(chat.max_completion_tokens).toBe(1024);
    expect((chat as Record<string, unknown>).max_tokens).toBeUndefined();
  });

  it("preserves stream flag", () => {
    const req: ResponsesRequest = { model: "mimo-v2.5-pro", input: "x", stream: true };
    expect(reqToChat(req).stream).toBe(true);
  });

  it("drops web_search by default (Web Search Plugin not assumed activated)", () => {
    // web_search_preview is dropped unless --web-search is explicitly passed
    // because MiMo's plugin is separately billed and 400s if not activated.
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        { type: "web_search_preview" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "code_interpreter" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "function", name: "shell", parameters: { type: "object" } },
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(1);
    expect(chat.tools![0].type).toBe("function");
  });

  it("forwards web_search to MiMo when --web-search (enableWebSearch: true) is set", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        { type: "web_search_preview" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "code_interpreter" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "function", name: "shell", parameters: { type: "object" } },
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req, { enableWebSearch: true });
    expect(chat.tools).toHaveLength(2);
    const types = chat.tools!.map((t) => t.type).sort();
    expect(types).toEqual(["function", "web_search"]);
  });

  it("translates local_shell builtin into a function tool named 'shell'", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "list files",
      tools: [{ type: "local_shell" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(1);
    const fn = chat.tools![0].function;
    expect(fn.name).toBe("shell");
    expect(fn.parameters).toBeDefined();
    expect((fn.parameters as { properties: Record<string, unknown> }).properties.command).toBeDefined();
  });

  it("drops function tool that has no name instead of forwarding name=undefined", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [{ type: "function" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toBeUndefined(); // empty after filter, field omitted entirely
  });

  it("when ALL tools get filtered (truly unsupported only), the tools field is omitted entirely", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        { type: "code_interpreter" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "image_generation" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toBeUndefined();
  });

  it("translates `custom` tool type into a function tool with permissive schema", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        {
          type: "custom",
          name: "my_grammar_tool",
          description: "Output a SQL query.",
          format: { type: "grammar", syntax: "lark", definition: "..." },
        } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(1);
    const fn = chat.tools![0].function;
    expect(fn.name).toBe("my_grammar_tool");
    expect(fn.description).toContain("SQL");
    expect(fn.description).toContain("grammar");
    expect((fn.parameters as { type: string }).type).toBe("object");
  });

  it("recurses into `namespace` wrapper and flattens nested function + builtin tools", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        {
          type: "namespace",
          name: "playwright",
          tools: [
            { type: "function", name: "browser_open", parameters: { type: "object" } },
            { type: "function", name: "browser_click", parameters: { type: "object" } },
            { type: "code_interpreter" }, // nested server-only — should drop
          ],
        } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "function", name: "shell", parameters: { type: "object" } },
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(3);
    const names = chat.tools!
      .filter((t): t is { type: "function"; function: { name: string } } => t.type === "function")
      .map((t) => t.function.name)
      .sort();
    expect(names).toEqual(["browser_click", "browser_open", "shell"]);
  });

  it("server-side-only tools (code_interpreter, computer_use, etc.) are silently dropped", () => {
    // These have no MiMo equivalent; they're silently dropped.
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        { type: "code_interpreter" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "computer_use_preview" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "image_generation" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toBeUndefined();
  });

  it("Codex web_search_preview is translated to MiMo's native web_search builtin (with --web-search)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "今天上海天气?",
      tools: [
        {
          type: "web_search_preview",
          user_location: { type: "approximate", country: "China", city: "Shanghai" },
          search_context_size: "medium",
        } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req, { enableWebSearch: true });
    expect(chat.tools).toHaveLength(1);
    const tool = chat.tools![0] as { type: string; user_location?: { city?: string } };
    expect(tool.type).toBe("web_search");
    expect(tool.user_location?.city).toBe("Shanghai");
    expect((tool as Record<string, unknown>).search_context_size).toBeUndefined();
    expect((tool as Record<string, unknown>).function).toBeUndefined();
  });

  it("plain Codex web_search (no user_location) is translated and preserves MiMo extras (with --web-search)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        {
          type: "web_search",
          max_keyword: 5,
          force_search: true,
          limit: 3,
        } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req, { enableWebSearch: true });
    expect(chat.tools).toHaveLength(1);
    const tool = chat.tools![0] as Record<string, unknown>;
    expect(tool.type).toBe("web_search");
    expect(tool.max_keyword).toBe(5);
    expect(tool.force_search).toBe(true);
    expect(tool.limit).toBe(3);
    expect(tool.user_location).toBeUndefined();
  });

  it("--disable-thinking adds `thinking: {type: 'disabled'}` to the chat body", () => {
    const req: ResponsesRequest = { model: "mimo-v2.5-pro", input: "hi" };
    const chat = reqToChat(req, { disableThinking: true });
    expect((chat as Record<string, unknown>).thinking).toEqual({ type: "disabled" });
  });

  it("--disable-thinking is OFF by default (no `thinking` field added)", () => {
    const req: ResponsesRequest = { model: "mimo-v2.5-pro", input: "hi" };
    const chat = reqToChat(req);
    expect((chat as Record<string, unknown>).thinking).toBeUndefined();
  });

  it("--force-parallel-tool-calls overrides Codex's parallel_tool_calls=false", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "hi",
      parallel_tool_calls: false,
    };
    const chat = reqToChat(req, { forceParallelToolCalls: true });
    expect(chat.parallel_tool_calls).toBe(true);
  });

  it("without --force-parallel-tool-calls, Codex's parallel_tool_calls value is respected", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "hi",
      parallel_tool_calls: false,
    };
    const chat = reqToChat(req);
    expect(chat.parallel_tool_calls).toBe(false);
  });

  // Regression: when an image-gen tool returns its result as a structured
  // array containing `input_image` parts, the proxy must NOT forward the
  // array verbatim to upstream — Chat Completions tool messages only accept
  // a string content, and DeepSeek explicitly 400s with
  // "unknown variant `input_image`, expected `text`". The array must be
  // flattened: text parts joined, image parts dropped with a placeholder.
  it("function_call_output with array containing input_image is flattened to a string with placeholder", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "generate a pet" }] },
        {
          type: "function_call",
          call_id: "call_img_1",
          name: "generate_image",
          arguments: '{"description":"chibi shiba"}',
        },
        {
          type: "function_call_output",
          call_id: "call_img_1",
          output: [
            { type: "output_text", text: "pet.png generated successfully." },
            { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo..." },
          ] as any,
        },
      ],
    };
    const chat = reqToChat(req);
    const tool = chat.messages.find((m) => m.role === "tool") as
      | { role: "tool"; tool_call_id: string; content: string }
      | undefined;
    expect(tool).toBeDefined();
    expect(typeof tool!.content).toBe("string");
    expect(tool!.content).toContain("pet.png generated successfully.");
    expect(tool!.content).toContain("[1 image attachment omitted from tool output");
    expect(tool!.content).not.toContain("input_image");
    expect(tool!.content).not.toContain("data:image");
  });

  it("function_call_output with plain string output is unchanged (regression guard)", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        {
          type: "function_call",
          call_id: "c1",
          name: "shell",
          arguments: '{"cmd":"date"}',
        },
        { type: "function_call_output", call_id: "c1", output: "2026-05-12" },
      ],
    };
    const chat = reqToChat(req);
    const tool = chat.messages.find((m) => m.role === "tool") as
      | { role: "tool"; tool_call_id: string; content: string }
      | undefined;
    expect(tool?.content).toBe("2026-05-12");
  });

  // Regression: when a user pastes an image into Codex with a non-vision chat
  // model (DS / mimo-v2.5-pro / Qwen text-only), the proxy must NOT just leave
  // a vague "<path>" placeholder — that produces the unhelpful agent reply
  // "tell me the file path of the image". Instead, the data URL must be
  // materialized to disk and the absolute path included in the placeholder so
  // the agent can run `ocr.py <path>` without further user input.
  it("non-vision model: data: image URL is materialized to disk and path embedded in placeholder", () => {
    const dropDir = mkdtempSync(join(tmpdir(), "mimo2codex-test-"));
    try {
      // 1x1 transparent PNG (smallest valid PNG bytes)
      const png1x1 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      const req: ResponsesRequest = {
        model: "deepseek-v4-pro",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "what does this say" },
              { type: "input_image", image_url: `data:image/png;base64,${png1x1}` },
            ],
          },
        ],
      };
      const chat = reqToChat(req, { imageDropDir: dropDir });
      const msg = chat.messages[0];
      expect(msg.role).toBe("user");
      const content = typeof msg.content === "string" ? msg.content : "";
      expect(content).toContain("1 image attachment omitted");
      expect(content).toContain("mimoskill/scripts/ocr.py");
      // Should NOT have the old "<path>" placeholder that prompts the agent
      // to ask the user.
      expect(content).not.toMatch(/`.*ocr\.py <path>`/);

      // Extract the materialized path — should exist on disk and match
      // the original bytes.
      const pathMatch = content.match(/^\s+1\.\s+(.+)$/m);
      expect(pathMatch).toBeTruthy();
      const materializedPath = pathMatch![1];
      expect(materializedPath).toContain("cache");
      expect(materializedPath).toContain("images");
      expect(materializedPath.endsWith(".png")).toBe(true);
      expect(existsSync(materializedPath)).toBe(true);
      expect(readFileSync(materializedPath)).toEqual(Buffer.from(png1x1, "base64"));
    } finally {
      rmSync(dropDir, { recursive: true, force: true });
    }
  });

  it("non-vision model: http(s) image URLs are surfaced as-is in placeholder (no download)", () => {
    const dropDir = mkdtempSync(join(tmpdir(), "mimo2codex-test-"));
    try {
      const req: ResponsesRequest = {
        model: "mimo-v2.5-pro",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "describe" },
              { type: "input_image", image_url: "https://example.com/photo.jpg" },
            ],
          },
        ],
      };
      const chat = reqToChat(req, { imageDropDir: dropDir });
      const content =
        typeof chat.messages[0].content === "string" ? chat.messages[0].content : "";
      expect(content).toContain("https://example.com/photo.jpg");
    } finally {
      rmSync(dropDir, { recursive: true, force: true });
    }
  });

  it("non-vision model with no imageDropDir: falls back to tmpdir, still materializes", () => {
    const png1x1 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_image", image_url: `data:image/png;base64,${png1x1}` },
          ],
        },
      ],
    };
    const chat = reqToChat(req); // no opts
    const content =
      typeof chat.messages[0].content === "string" ? chat.messages[0].content : "";
    expect(content).toContain("1 image attachment omitted");
    // Should still produce a path in the fallback location.
    const pathMatch = content.match(/^\s+1\.\s+(.+)$/m);
    expect(pathMatch).toBeTruthy();
    expect(existsSync(pathMatch![1])).toBe(true);
  });

  // Regression: under --no-reasoning, respToResponses writes the reasoning
  // text into `encrypted_content` with an empty `summary`. The next-turn
  // request from Codex echoes that reasoning item back; reqToChat must
  // extract from encrypted_content (not summary) so MiMo / DS V4 get the
  // reasoning_content on the prior assistant message — without this their
  // tool-calling quality degrades into "narration / free-association"
  // instead of actual tool calls.
  it("reasoning item with empty summary + encrypted_content → reasoning_content on assistant message", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "search for cats" }],
        },
        {
          type: "reasoning",
          summary: [], // hidden from terminal — --no-reasoning case
          encrypted_content: "I should call the search tool here",
        } as unknown as ResponsesRequest["input"] extends Array<infer T> ? T : never,
        {
          type: "function_call",
          call_id: "call_1",
          name: "search",
          arguments: '{"q":"cats"}',
        },
        { type: "function_call_output", call_id: "call_1", output: "5 results" },
      ],
    };
    const chat = reqToChat(req);
    const assistantWithTool = chat.messages.find((m) => m.tool_calls?.length) as
      | { role: "assistant"; reasoning_content?: string; tool_calls: unknown[] }
      | undefined;
    expect(assistantWithTool).toBeDefined();
    expect(assistantWithTool!.reasoning_content).toBe("I should call the search tool here");
  });

  // When BOTH encrypted_content and summary are present, prefer
  // encrypted_content — it's the canonical full-trace channel; summary may
  // be truncated by some clients.
  it("reasoning item with both fields prefers encrypted_content", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "x" }] },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "summary version" }],
          encrypted_content: "full version",
        } as unknown as ResponsesRequest["input"] extends Array<infer T> ? T : never,
        {
          type: "function_call",
          call_id: "c",
          name: "f",
          arguments: "{}",
        },
      ],
    };
    const chat = reqToChat(req);
    const a = chat.messages.find((m) => m.tool_calls?.length) as
      | { reasoning_content?: string }
      | undefined;
    expect(a?.reasoning_content).toBe("full version");
  });
});

// Covers the symmetric counterpart of "missing function_call_output …
// placeholder" above. The mirror direction — orphan function_call_output
// items in history (Codex desync after Esc / Ctrl+C, openai/codex#8479) —
// was triggering an unrecoverable DeepSeek 400 (mimo2codex#8). The scrub
// is now in inputItemsToMessages right before ensureToolCallsHaveOutputs.
describe("reqToChat — orphan tool message scrub (PR #10 regression)", () => {
  it("drops a tool message whose tool_call_id has no preceding assistant.tool_calls", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: "hi" },
        // Orphan: no assistant.tool_calls before it.
        {
          type: "function_call_output",
          call_id: "call_orphan_001",
          output: "stale",
        },
        { type: "message", role: "user", content: "now do A" },
        {
          type: "function_call",
          call_id: "call_A",
          name: "shell",
          arguments: '{"cmd":"A"}',
        },
        { type: "function_call_output", call_id: "call_A", output: "ra" },
      ],
    };
    const chat = reqToChat(req);
    const toolMsgs = chat.messages.filter((m) => m.role === "tool");
    // call_orphan_001 must be gone; call_A's output must survive.
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["call_A"]);
    // And the assistant.tool_calls/tool pairing invariant still holds.
    const idxAsst = chat.messages.findIndex(
      (m) => m.role === "assistant" && m.tool_calls?.length
    );
    expect(idxAsst).toBeGreaterThanOrEqual(0);
    expect(chat.messages[idxAsst + 1]?.role).toBe("tool");
    expect(chat.messages[idxAsst + 1]?.tool_call_id).toBe("call_A");
  });

  it("drops a tool message whose tool_call_id does not match the preceding assistant.tool_calls", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: "do A" },
        {
          type: "function_call",
          call_id: "call_A",
          name: "shell",
          arguments: '{"cmd":"A"}',
        },
        { type: "function_call_output", call_id: "call_A", output: "ra" },
        // Next assistant declares only call_B; a stray output for the
        // earlier call_A reappearing here is an orphan in this scope.
        // We synthesize that scenario with a second turn.
        { type: "message", role: "user", content: "now do B" },
        {
          type: "function_call",
          call_id: "call_B",
          name: "shell",
          arguments: '{"cmd":"B"}',
        },
        // mismatched id — refers to call_A but appears after the B-only assistant turn
        { type: "function_call_output", call_id: "call_A", output: "stale-A" },
        { type: "function_call_output", call_id: "call_B", output: "rb" },
      ],
    };
    const chat = reqToChat(req);
    // call_A output for the FIRST turn must survive; the SECOND occurrence
    // (mismatched, after the B-only assistant) must be dropped.
    const toolMsgs = chat.messages.filter((m) => m.role === "tool");
    const ids = toolMsgs.map((m) => m.tool_call_id);
    // Expect: [call_A (turn 1), call_B (turn 2)] — orphan call_A from turn 2 removed.
    expect(ids).toEqual(["call_A", "call_B"]);
  });

  it("validity window resets on a user message — a tool message after user but before any assistant.tool_calls is dropped", () => {
    // assistant(tool_calls=A) → tool(A) ✓ → user(...) → tool(A again) ✗ orphan
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: "do A" },
        {
          type: "function_call",
          call_id: "call_A",
          name: "shell",
          arguments: '{"cmd":"A"}',
        },
        { type: "function_call_output", call_id: "call_A", output: "ra" },
        { type: "message", role: "user", content: "anything else?" },
        // After a user message — validity window must reset, so this is orphan.
        { type: "function_call_output", call_id: "call_A", output: "replay" },
      ],
    };
    const chat = reqToChat(req);
    const toolMsgs = chat.messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].tool_call_id).toBe("call_A");
    expect(toolMsgs[0].content).toBe("ra");
  });

  it("parallel tool_calls: keeps valid outputs, drops orphan ones in the same window", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: "do A and B in parallel" },
        {
          type: "function_call",
          call_id: "call_A",
          name: "shell",
          arguments: '{"cmd":"A"}',
        },
        {
          type: "function_call",
          call_id: "call_B",
          name: "shell",
          arguments: '{"cmd":"B"}',
        },
        { type: "function_call_output", call_id: "call_A", output: "ra" },
        // Orphan: call_GHOST was never declared.
        {
          type: "function_call_output",
          call_id: "call_GHOST",
          output: "noise",
        },
        { type: "function_call_output", call_id: "call_B", output: "rb" },
      ],
    };
    const chat = reqToChat(req);
    const toolMsgs = chat.messages.filter((m) => m.role === "tool");
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["call_A", "call_B"]);
  });

  it("regression: well-formed assistant.tool_calls + tool pair is unchanged", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-pro",
      input: [
        { type: "message", role: "user", content: "do A" },
        {
          type: "function_call",
          call_id: "call_A",
          name: "shell",
          arguments: '{"cmd":"A"}',
        },
        { type: "function_call_output", call_id: "call_A", output: "ra" },
      ],
    };
    const chat = reqToChat(req);
    const idxAsst = chat.messages.findIndex(
      (m) => m.role === "assistant" && m.tool_calls?.length
    );
    expect(idxAsst).toBeGreaterThanOrEqual(0);
    expect(chat.messages[idxAsst].tool_calls?.[0].id).toBe("call_A");
    expect(chat.messages[idxAsst + 1].role).toBe("tool");
    expect(chat.messages[idxAsst + 1].tool_call_id).toBe("call_A");
    expect(chat.messages[idxAsst + 1].content).toBe("ra");
  });
});
