import { describe, expect, it } from "vitest";
import {
  applyMinimaxCompat,
  applyInlineThinkSplitToMessage,
  createInlineThinkSplitter,
  splitInlineThink,
} from "../src/translate/minimaxCompat.js";
import type { ChatRequest } from "../src/translate/types.js";

// Helper: build a ChatRequest that contains every "issue #7" symptom in one
// object, so each test can selectively assert what got cleaned.
function makeDirtyChat(): ChatRequest {
  return {
    model: "MiniMax-M2.7",
    stream: true,
    stream_options: { include_usage: true },
    parallel_tool_calls: false,
    tool_choice: "auto",
    messages: [
      { role: "system", content: "instructions A" },
      { role: "user", content: "hi" },
      { role: "system", content: "middle system (model_switch)" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "shell", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "ok" },
      { role: "system", content: "permissions tail" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "shell",
          description: "run shell",
          parameters: { type: "object", properties: {} },
          strict: null,
        },
      },
      {
        type: "function",
        function: {
          name: "strict_one",
          parameters: { type: "object", properties: {} },
          strict: true,
        },
      },
    ],
  };
}

describe("applyMinimaxCompat — defaults", () => {
  it("undefined features → identity (no fields changed)", () => {
    const chat = makeDirtyChat();
    const snapshot = JSON.parse(JSON.stringify(chat));
    const out = applyMinimaxCompat(chat, undefined);
    expect(out).toBe(chat); // same reference (in-place)
    expect(out).toEqual(snapshot); // no value changes
  });

  it("empty features object → identity", () => {
    const chat = makeDirtyChat();
    const snapshot = JSON.parse(JSON.stringify(chat));
    const out = applyMinimaxCompat(chat, {});
    expect(out).toEqual(snapshot);
  });
});

describe("applyMinimaxCompat — minimaxCompat: true (preset)", () => {
  it("preset strips MiniMax-rejected fields but PRESERVES stream_options / parallel_tool_calls", () => {
    const chat = makeDirtyChat();
    applyMinimaxCompat(chat, { minimaxCompat: true });

    // 1. strict: null removed, strict: true kept
    expect(chat.tools![0]).toEqual({
      type: "function",
      function: {
        name: "shell",
        description: "run shell",
        parameters: { type: "object", properties: {} },
      },
    });
    expect(chat.tools![1]).toEqual({
      type: "function",
      function: {
        name: "strict_one",
        parameters: { type: "object", properties: {} },
        strict: true,
      },
    });

    // 2. assistant content: null removed
    const assistant = chat.messages.find((m) => m.role === "assistant")!;
    expect("content" in assistant).toBe(false);
    expect(assistant.tool_calls).toBeDefined();

    // 3. tool_choice "auto" removed
    expect("tool_choice" in chat).toBe(false);

    // 4. stream_options KEPT — OpenAI standard field, MiniMax accepts it,
    //    and removing it breaks token usage reporting.
    expect(chat.stream_options).toEqual({ include_usage: true });

    // 5. parallel_tool_calls KEPT — OpenAI standard field, MiniMax accepts it.
    expect(chat.parallel_tool_calls).toBe(false);

    // 6. system messages merged into one leading entry
    const systems = chat.messages.filter((m) => m.role === "system");
    expect(systems).toHaveLength(1);
    expect(chat.messages[0].role).toBe("system");
    expect(chat.messages[0].content).toBe(
      "instructions A\n\nmiddle system (model_switch)\n\npermissions tail",
    );
    // non-system messages preserved in their relative order
    const nonSystem = chat.messages.filter((m) => m.role !== "system");
    expect(nonSystem.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("preset + explicit dropStreamOptions / dropParallelToolCalls together → all stripped", () => {
    // Escape hatch for the rare upstream that does reject these fields:
    // open the preset and the two leaf switches alongside.
    const chat = makeDirtyChat();
    applyMinimaxCompat(chat, {
      minimaxCompat: true,
      dropStreamOptions: true,
      dropParallelToolCalls: true,
    });
    expect("stream_options" in chat).toBe(false);
    expect("parallel_tool_calls" in chat).toBe(false);
  });

  it("is idempotent (second pass changes nothing)", () => {
    const chat = makeDirtyChat();
    applyMinimaxCompat(chat, { minimaxCompat: true });
    const afterFirst = JSON.parse(JSON.stringify(chat));
    applyMinimaxCompat(chat, { minimaxCompat: true });
    expect(chat).toEqual(afterFirst);
  });
});

describe("applyMinimaxCompat — individual switches", () => {
  it("dropNullStrict removes only tools[*].function.strict === null", () => {
    const chat = makeDirtyChat();
    applyMinimaxCompat(chat, { dropNullStrict: true });
    expect("strict" in (chat.tools![0].type === "function" ? chat.tools![0].function : {})).toBe(false);
    if (chat.tools![1].type === "function") {
      expect(chat.tools![1].function.strict).toBe(true);
    }
    // other fields untouched
    expect(chat.stream_options).toBeDefined();
    expect(chat.tool_choice).toBe("auto");
    expect(chat.parallel_tool_calls).toBe(false);
    expect(chat.messages.filter((m) => m.role === "system")).toHaveLength(3);
  });

  it("dropNullContent removes assistant content:null but keeps tool_calls", () => {
    const chat = makeDirtyChat();
    applyMinimaxCompat(chat, { dropNullContent: true });
    const assistant = chat.messages.find((m) => m.role === "assistant")!;
    expect("content" in assistant).toBe(false);
    expect(assistant.tool_calls).toBeDefined();
    // user/system content kept as-is
    expect(chat.messages.find((m) => m.role === "user")!.content).toBe("hi");
  });

  it("dropToolChoiceAuto removes only 'auto'", () => {
    const chat = makeDirtyChat();
    applyMinimaxCompat(chat, { dropToolChoiceAuto: true });
    expect("tool_choice" in chat).toBe(false);
  });

  it("dropToolChoiceAuto preserves named function tool_choice", () => {
    const chat: ChatRequest = {
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      tool_choice: { type: "function", function: { name: "shell" } },
    };
    applyMinimaxCompat(chat, { dropToolChoiceAuto: true });
    expect(chat.tool_choice).toEqual({ type: "function", function: { name: "shell" } });
  });

  it("dropStreamOptions removes stream_options only", () => {
    const chat = makeDirtyChat();
    applyMinimaxCompat(chat, { dropStreamOptions: true });
    expect("stream_options" in chat).toBe(false);
    expect(chat.parallel_tool_calls).toBe(false); // unchanged
  });

  it("dropParallelToolCalls removes parallel_tool_calls only", () => {
    const chat = makeDirtyChat();
    applyMinimaxCompat(chat, { dropParallelToolCalls: true });
    expect("parallel_tool_calls" in chat).toBe(false);
    expect(chat.stream_options).toBeDefined(); // unchanged
  });
});

describe("applyMinimaxCompat — mergeSystemMessages edge cases", () => {
  it("0 system → unchanged", () => {
    const chat: ChatRequest = {
      model: "x",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(chat));
    applyMinimaxCompat(chat, { mergeSystemMessages: true });
    expect(chat).toEqual(snapshot);
  });

  it("1 system already at index 0 → unchanged (no reorder)", () => {
    const chat: ChatRequest = {
      model: "x",
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "u" },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(chat));
    applyMinimaxCompat(chat, { mergeSystemMessages: true });
    expect(chat).toEqual(snapshot);
  });

  it("1 system in the middle → promoted to index 0", () => {
    const chat: ChatRequest = {
      model: "x",
      messages: [
        { role: "user", content: "u1" },
        { role: "system", content: "S" },
        { role: "user", content: "u2" },
      ],
    };
    applyMinimaxCompat(chat, { mergeSystemMessages: true });
    expect(chat.messages.map((m) => m.role)).toEqual(["system", "user", "user"]);
    expect(chat.messages[0].content).toBe("S");
  });

  it("multiple system messages with empty strings → only non-empty merged", () => {
    const chat: ChatRequest = {
      model: "x",
      messages: [
        { role: "system", content: "A" },
        { role: "user", content: "u" },
        { role: "system", content: "" },
        { role: "system", content: "B" },
      ],
    };
    applyMinimaxCompat(chat, { mergeSystemMessages: true });
    const systems = chat.messages.filter((m) => m.role === "system");
    expect(systems).toHaveLength(1);
    expect(systems[0].content).toBe("A\n\nB");
  });

  it("all-empty system messages → all system entries removed", () => {
    const chat: ChatRequest = {
      model: "x",
      messages: [
        { role: "system", content: "" },
        { role: "user", content: "u" },
        { role: "system", content: "" },
      ],
    };
    applyMinimaxCompat(chat, { mergeSystemMessages: true });
    expect(chat.messages.filter((m) => m.role === "system")).toHaveLength(0);
    expect(chat.messages.map((m) => m.role)).toEqual(["user"]);
  });
});

// =========================================================================
// 响应侧 — inline <think>...</think> 切分（MiniMax M1/M2/M3 风格）
// =========================================================================

describe("splitInlineThink — pure string splitter", () => {
  it("returns content unchanged when no <think> tags", () => {
    expect(splitInlineThink("hello world")).toEqual({
      reasoning: "",
      content: "hello world",
    });
  });

  it("extracts single block, leaves surrounding content", () => {
    expect(splitInlineThink("<think>reasoning here</think>\n\nactual answer")).toEqual({
      reasoning: "reasoning here",
      content: "\n\nactual answer",
    });
  });

  it("extracts multiple blocks, joins reasoning with double newline", () => {
    const r = splitInlineThink(
      "<think>step 1</think>middle <think>step 2</think>final",
    );
    expect(r.reasoning).toBe("step 1\n\nstep 2");
    expect(r.content).toBe("middle final");
  });

  it("preserves unclosed <think> as literal text (does not eat the tail)", () => {
    const r = splitInlineThink("normal <think>oops no closer");
    expect(r.reasoning).toBe("");
    expect(r.content).toBe("normal <think>oops no closer");
  });

  it("empty input → empty output, no throw", () => {
    expect(splitInlineThink("")).toEqual({ reasoning: "", content: "" });
  });

  it("does NOT match uppercase <THINK> (case-sensitive on purpose)", () => {
    // 避免误吞 LLM 写出的真实标签字面文本（教程、代码示例等）
    const r = splitInlineThink("<THINK>not stripped</THINK>");
    expect(r.reasoning).toBe("");
    expect(r.content).toBe("<THINK>not stripped</THINK>");
  });
});

describe("applyInlineThinkSplitToMessage — non-stream message", () => {
  it("moves <think> into reasoning_content, rewrites content", () => {
    const msg = {
      role: "assistant",
      content: "<think>thinking...</think>visible answer",
    } as { content?: string | unknown; reasoning_content?: string | null };
    applyInlineThinkSplitToMessage(msg);
    expect(msg.content).toBe("visible answer");
    expect(msg.reasoning_content).toBe("thinking...");
  });

  it("appends to existing reasoning_content (not overwrites)", () => {
    const msg = {
      content: "<think>more</think>tail",
      reasoning_content: "existing",
    };
    applyInlineThinkSplitToMessage(msg);
    expect(msg.reasoning_content).toBe("existing\n\nmore");
    expect(msg.content).toBe("tail");
  });

  it("no-op when no <think> tag in content", () => {
    const msg = { content: "plain", reasoning_content: "rc" };
    applyInlineThinkSplitToMessage(msg);
    expect(msg.content).toBe("plain");
    expect(msg.reasoning_content).toBe("rc");
  });

  it("skips when content is not a string (multimodal parts array)", () => {
    const msg = { content: [{ type: "text", text: "x" }] as unknown };
    applyInlineThinkSplitToMessage(msg);
    expect(msg.content).toEqual([{ type: "text", text: "x" }]);
  });
});

describe("createInlineThinkSplitter — stream splitter", () => {
  it("handles complete <think>...</think> within a single chunk", () => {
    const sp = createInlineThinkSplitter();
    expect(sp.processChunk("<think>x</think>visible")).toEqual({
      content: "visible",
      reasoning: "x",
    });
    expect(sp.flush()).toEqual({ content: "", reasoning: "" });
  });

  it("handles <think> tag split across two chunks (no leak)", () => {
    const sp = createInlineThinkSplitter();
    // Tag itself spans the chunk boundary
    const r1 = sp.processChunk("hello <thi");
    expect(r1.content).toBe("hello ");
    expect(r1.reasoning).toBe("");
    const r2 = sp.processChunk("nk>reasoning</think>tail");
    expect(r2.content).toBe("tail");
    expect(r2.reasoning).toBe("reasoning");
  });

  it("handles </think> closer split across chunks", () => {
    const sp = createInlineThinkSplitter();
    sp.processChunk("<think>thinking");
    const r2 = sp.processChunk(" more</thi");
    expect(r2.reasoning).toBe(" more");
    expect(r2.content).toBe("");
    const r3 = sp.processChunk("nk>visible");
    expect(r3.reasoning).toBe("");
    expect(r3.content).toBe("visible");
  });

  it("emits clean content chunks when no think tags present", () => {
    const sp = createInlineThinkSplitter();
    expect(sp.processChunk("plain ")).toEqual({ content: "plain ", reasoning: "" });
    expect(sp.processChunk("text")).toEqual({ content: "text", reasoning: "" });
  });

  it("flush emits carry as content when stream ends mid-content with `<` prefix", () => {
    const sp = createInlineThinkSplitter();
    // ends with potential prefix that turned out to be just literal `<`
    sp.processChunk("answer<");
    const f = sp.flush();
    expect(f.content).toBe("<");
    expect(f.reasoning).toBe("");
  });

  it("flush emits carry as reasoning when stream ends inside think tag", () => {
    const sp = createInlineThinkSplitter();
    sp.processChunk("<think>incomplete</thi"); // </thi is a partial closer
    const f = sp.flush();
    // carry is "</thi", state is inThink → goes to reasoning as literal
    expect(f.reasoning).toBe("</thi");
    expect(f.content).toBe("");
  });

  it("multiple blocks streaming chunk by chunk", () => {
    const sp = createInlineThinkSplitter();
    sp.processChunk("<think>a</think>"); // → reasoning a
    const r2 = sp.processChunk("between"); // → content
    expect(r2.content).toBe("between");
    expect(r2.reasoning).toBe("");
    const r3 = sp.processChunk("<think>b</think>after"); // → reasoning b + content after
    expect(r3.content).toBe("after");
    expect(r3.reasoning).toBe("b");
  });

  it("processChunk is monotonic (no re-emit, no truncate, no skip)", () => {
    const sp = createInlineThinkSplitter();
    const collected = { content: "", reasoning: "" };
    for (const piece of ["<thi", "nk>r1</thin", "k>m1<think>r2", "</think>m2"]) {
      const r = sp.processChunk(piece);
      collected.content += r.content;
      collected.reasoning += r.reasoning;
    }
    const f = sp.flush();
    collected.content += f.content;
    collected.reasoning += f.reasoning;
    expect(collected.content).toBe("m1m2");
    expect(collected.reasoning).toBe("r1r2");
  });
});
