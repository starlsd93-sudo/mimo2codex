import { describe, expect, it } from "vitest";
import { applyMinimaxCompat } from "../src/translate/minimaxCompat.js";
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

describe("applyMinimaxCompat — minimaxCompat: true (all-in preset)", () => {
  it("strips every MiniMax-rejected field at once", () => {
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

    // 4. stream_options removed
    expect("stream_options" in chat).toBe(false);

    // 5. parallel_tool_calls removed
    expect("parallel_tool_calls" in chat).toBe(false);

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
