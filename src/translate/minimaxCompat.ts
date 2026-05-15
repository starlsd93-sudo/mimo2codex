// MiniMax 兼容性补丁层 (minimax-compat)
// ---------------------------------------
// 背景：MiniMax 的 Chat Completions API (https://api.minimaxi.com/v1) 比 OpenAI
// 自家 / MiMo / DeepSeek 都更严格：
//   - 拒绝 strict: null（要么不传，要么传 boolean）
//   - 拒绝 assistant 消息 content: null
//   - 拒绝 tool_choice: "auto"（"auto" 是默认值，应省略而非显式传）
//   - 拒绝非标准 stream_options / parallel_tool_calls
//   - 只接受 1 条 system 消息，且必须出现在所有 user/assistant 之前
//
// 主线 reqToChat() 对其他上游照样写这些字段（很多上游需要
// stream_options.include_usage 才能回传 token usage，admin DB 的缓存命中柱状图
// 依赖这一点）。为了不污染主路径，本文件提供 applyMinimaxCompat()，作为
// reqToChat 输出之后的可选后处理。
//
// 触发：providers.json 里 features.minimaxCompat: true（或细粒度子开关）。
// 既有用户零行为变化 —— 开关默认全部 false。
//
// 见 doc/minimax.md, issue #7 (https://github.com/7as0nch/mimo2codex/issues/7)
import type { ChatRequest, ChatMessage, ChatTool } from "./types.js";

export interface MinimaxCompatFeatures {
  /**
   * 一键预设。打开后**默认包揽**下面这些子开关：
   *   - dropNullStrict
   *   - dropNullContent
   *   - dropToolChoiceAuto
   *   - mergeSystemMessages
   *   - extractThinkTags
   *
   * **不**包揽：
   *   - dropStreamOptions  / dropParallelToolCalls
   *     这两个是 OpenAI 官方 Chat Completions 规范字段，绝大多数严格 OpenAI 兼容
   *     上游（含 MiniMax）都接受；尤其 `stream_options.include_usage` 是 token
   *     用量回传的入口，删了之后 admin DB 的 token 统计会全 null。少数真的拒绝
   *     的极端上游再单独勾选这两个子开关。
   */
  minimaxCompat?: boolean;
  /** 删 `tools[*].function.strict === null`，保留显式 true/false。 */
  dropNullStrict?: boolean;
  /** 删 assistant 消息的 `content === null` 字段（同消息上的 tool_calls/reasoning_content 还在时合法）。 */
  dropNullContent?: boolean;
  /** 删 `tool_choice === "auto"`（"auto" 是默认值，省略与显式传等价）。 */
  dropToolChoiceAuto?: boolean;
  /**
   * 删 `stream_options` 整个字段。⚠️ 上游不再回传 usage → admin DB 的 token 统计 /
   * 缓存命中柱状图会变 0。**仅在上游真的因为 stream_options 而 400 时**才开；
   * MiniMax / 大多数严格 OpenAI 兼容上游都接受这个字段，无需打开。
   * 不在 `minimaxCompat: true` 一键预设里。
   */
  dropStreamOptions?: boolean;
  /**
   * 删 `parallel_tool_calls` 整个字段。OpenAI 标准字段，多数上游接受；仅在上游
   * 明确报错时打开。不在 `minimaxCompat: true` 一键预设里。
   */
  dropParallelToolCalls?: boolean;
  /** 合并所有 role:"system" 消息为单条前置（双换行拼接），符合 MiniMax 单 system 约束。 */
  mergeSystemMessages?: boolean;
  /**
   * 响应侧：把 chat completion content 里的 inline `<think>...</think>` 块切出来，
   * 并入 `reasoning_content`。MiniMax M1/M2/M3 系列把 thinking 内嵌在 content 里
   * （不像 DeepSeek/MiMo 用单独的 reasoning_content 字段），不开启的话 Codex 会
   * 把 `<think>...</think>` 当作正常 assistant 文本显示出来。
   * 部分 GLM/Qwen-thinking 模型也采用 inline `<think>` 格式，按需打开即可。
   */
  extractThinkTags?: boolean;
}

// minimaxCompat: true 默认包揽的子开关白名单。把潜在副作用大的开关
// （dropStreamOptions / dropParallelToolCalls）排除在外——它们仍然作为
// 子开关存在，只是不被一键预设默认勾上。
const MINIMAX_COMPAT_DEFAULTS: ReadonlySet<
  Exclude<keyof MinimaxCompatFeatures, "minimaxCompat">
> = new Set([
  "dropNullStrict",
  "dropNullContent",
  "dropToolChoiceAuto",
  "mergeSystemMessages",
  "extractThinkTags",
]);

function isOn(
  features: MinimaxCompatFeatures,
  key: Exclude<keyof MinimaxCompatFeatures, "minimaxCompat">,
): boolean {
  if (features[key]) return true;
  if (features.minimaxCompat && MINIMAX_COMPAT_DEFAULTS.has(key)) return true;
  return false;
}

/**
 * 对 `ChatRequest` 做 MiniMax 兼容后处理。幂等（重复调用产物相同），原地修改入参以
 * 避免一次深拷贝；调用方应已不再需要"修改前"的版本。
 *
 * 当 features 全部为 falsy 时，本函数是恒等函数（不写任何字段）。
 */
export function applyMinimaxCompat(
  chat: ChatRequest,
  features: MinimaxCompatFeatures | undefined,
): ChatRequest {
  if (!features) return chat;

  // 1. 工具列表里删 strict: null（保留 true / false）
  if (isOn(features, "dropNullStrict") && Array.isArray(chat.tools)) {
    for (const t of chat.tools as ChatTool[]) {
      if (t.type === "function" && t.function && t.function.strict === null) {
        delete (t.function as { strict?: unknown }).strict;
      }
    }
  }

  // 2. assistant content: null → 删字段（OpenAI 规范允许 tool_calls 存在时 content 省略）
  if (isOn(features, "dropNullContent") && Array.isArray(chat.messages)) {
    for (const m of chat.messages as ChatMessage[]) {
      if (m.role === "assistant" && (m as { content?: unknown }).content === null) {
        delete (m as { content?: unknown }).content;
      }
    }
  }

  // 3. tool_choice: "auto" → 删字段（"auto" 即默认）
  if (isOn(features, "dropToolChoiceAuto") && chat.tool_choice === "auto") {
    delete (chat as { tool_choice?: unknown }).tool_choice;
  }

  // 4. 删 stream_options
  if (isOn(features, "dropStreamOptions")) {
    delete (chat as { stream_options?: unknown }).stream_options;
  }

  // 5. 删 parallel_tool_calls
  if (isOn(features, "dropParallelToolCalls")) {
    delete (chat as { parallel_tool_calls?: unknown }).parallel_tool_calls;
  }

  // 6. 合并 system 消息为单条前置
  if (isOn(features, "mergeSystemMessages") && Array.isArray(chat.messages)) {
    mergeSystemMessagesInPlace(chat.messages as ChatMessage[]);
  }

  return chat;
}

// 把 messages 中所有 role: "system" 的条目合并为单条前置（双换行拼接）。
// 边界处理：
//   - 0 条 system → 不变
//   - 1 条 system 且已在 messages[0] → 不变（无 reorder）
//   - 1 条 system 但在中段 → 提前
//   - 2+ 条 system → 拼接为一条放到 messages[0]
//   - content 不是 string（例如 ChatContentPart[]，理论上 system 用不到但防御性处理）→ 跳过该条
//   - content 是空字符串 → 跳过
//   - 全部 system content 都是空 / 非 string → 移除所有 system 消息
function mergeSystemMessagesInPlace(messages: ChatMessage[]): void {
  const systemContents: string[] = [];
  let systemCount = 0;
  for (const m of messages) {
    if (m.role !== "system") continue;
    systemCount++;
    const c = (m as { content?: unknown }).content;
    if (typeof c === "string" && c.length > 0) systemContents.push(c);
  }
  if (systemCount === 0) return;
  // 单条 system 已经在最前 → 不动
  if (systemCount === 1 && messages[0]?.role === "system") return;

  const nonSystem = messages.filter((m) => m.role !== "system");
  messages.length = 0;
  if (systemContents.length > 0) {
    messages.push({ role: "system", content: systemContents.join("\n\n") });
  }
  messages.push(...nonSystem);
}

// =========================================================================
// 响应侧：inline `<think>...</think>` 切分
// -------------------------------------------------------------------------
// MiniMax M1/M2/M3 系列把 reasoning 直接嵌在 chat completion 的 content 字段
// 里（用 <think>...</think> 包裹），而 mimo2codex 翻译层默认把 reasoning 从
// 单独的 `reasoning_content` 字段里读（DeepSeek / MiMo 风格）。不切分的话
// Codex 客户端会把 `<think>...</think>` 当作正常 assistant 文本直接显示。
//
// 提供两套工具：
//   - applyInlineThinkSplitToMessage(message)  非流式：原地切分 ChatMessage
//   - createInlineThinkSplitter()              流式：跨 chunk 边界安全的有状态切分器
//
// 与请求侧 sanitizer 解耦：这两套工具不读 MinimaxCompatFeatures，调用方根据
// features.extractThinkTags || features.minimaxCompat 决定要不要开。
// =========================================================================

/**
 * 把字符串里所有完整的 `<think>...</think>` 块切出来。
 *   - 匹配小写 `<think>` / `</think>`（MiniMax 实际用小写；其他厂家不规范的话可以
 *     扩展，但当前 `g` 而非 `gi` 是为了避免 LLM 在普通文本里写出 `<Think>`
 *     被误吞）
 *   - 多个块按出现顺序拼接，双换行分隔
 *   - 未闭合的 `<think>`（找不到 `</think>`）保留在 content 中作为字面文本，
 *     避免把后续真实回答都吃掉
 *   - 块外文本组成 content（多段时按出现顺序拼接，不加额外分隔）
 */
export function splitInlineThink(s: string): { reasoning: string; content: string } {
  if (!s) return { reasoning: "", content: s ?? "" };
  const re = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  const reasoningParts: string[] = [];
  const contentParts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > lastIndex) contentParts.push(s.slice(lastIndex, m.index));
    reasoningParts.push(m[1]);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < s.length) contentParts.push(s.slice(lastIndex));
  return {
    reasoning: reasoningParts.join("\n\n"),
    content: contentParts.join(""),
  };
}

/**
 * 在 ChatMessage 上原地切分 inline `<think>...</think>`：
 *   - thinking 块合并到 `message.reasoning_content`（已有内容时拼接在前面）
 *   - 剩余文本回填 `message.content`
 *   - 没有 `<think>` 时一行不改
 *   - `content` 不是 string 时（例如多模态 part 数组）跳过
 */
export function applyInlineThinkSplitToMessage(message: {
  content?: string | unknown;
  reasoning_content?: string | null;
}): void {
  if (typeof message.content !== "string") return;
  const { reasoning, content } = splitInlineThink(message.content);
  if (!reasoning) return;
  const existing = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
  message.reasoning_content = existing ? existing + "\n\n" + reasoning : reasoning;
  message.content = content;
}

/**
 * 创建一个 stateful chunk splitter，处理 streaming inline `<think>...</think>`。
 *
 * 用法：
 *   const sp = createInlineThinkSplitter();
 *   // 每个上游 delta.content 进来时：
 *   const { content, reasoning } = sp.processChunk(delta.content);
 *   // 流结束时 flush：
 *   const { content, reasoning } = sp.flush();
 *
 * 实现：维护一个 carry 缓冲——只要末尾可能是半截标签（包含 `<` 但还未确认是
 * `<think>` / `</think>` 的完整序列），就 hold 住不下发，下个 chunk 进来时
 * 拼接续算。stream 结束 flush 时若 carry 非空，按当前 inThink 状态归到
 * reasoning 或 content。
 *
 * 注意：splitter 不区分大小写处理 —— 只识别小写 `<think>` / `</think>`（与
 * splitInlineThink 一致）。
 */
export function createInlineThinkSplitter(): {
  processChunk(text: string): { content: string; reasoning: string };
  flush(): { content: string; reasoning: string };
} {
  let inThink = false;
  let carry = ""; // 等待确认的尾部（可能包含 `<` 半截标签）

  function maybeCarryTail(buf: string): { emit: string; carry: string } {
    // 检查 buf 尾部是否可能是 `<think>` / `</think>` 的前缀（取决于 inThink 状态）。
    // 半截：buf 末尾包含 `<` 且后续字符是某个目标标签的前缀。
    // 保留长度上限：max("</think>".length) === 8 → 最多保留尾部 8 个字符。
    const target = inThink ? "</think>" : "<think>";
    const maxBack = Math.min(target.length - 1, buf.length);
    for (let k = maxBack; k > 0; k--) {
      const tail = buf.slice(buf.length - k);
      if (target.startsWith(tail)) {
        return { emit: buf.slice(0, buf.length - k), carry: tail };
      }
    }
    return { emit: buf, carry: "" };
  }

  function processChunk(text: string): { content: string; reasoning: string } {
    let buf = carry + text;
    let outContent = "";
    let outReasoning = "";

    while (buf.length > 0) {
      if (!inThink) {
        const idx = buf.indexOf("<think>");
        if (idx === -1) {
          const { emit, carry: c } = maybeCarryTail(buf);
          outContent += emit;
          carry = c;
          buf = "";
        } else {
          outContent += buf.slice(0, idx);
          buf = buf.slice(idx + "<think>".length);
          inThink = true;
        }
      } else {
        const idx = buf.indexOf("</think>");
        if (idx === -1) {
          const { emit, carry: c } = maybeCarryTail(buf);
          outReasoning += emit;
          carry = c;
          buf = "";
        } else {
          outReasoning += buf.slice(0, idx);
          buf = buf.slice(idx + "</think>".length);
          inThink = false;
        }
      }
    }

    return { content: outContent, reasoning: outReasoning };
  }

  function flush(): { content: string; reasoning: string } {
    if (!carry) return { content: "", reasoning: "" };
    const out = inThink
      ? { content: "", reasoning: carry }  // 流断在 think 中段 → 当 reasoning 兜底
      : { content: carry, reasoning: "" }; // 流断在普通文本中段 → 当 content 兜底
    carry = "";
    return out;
  }

  return { processChunk, flush };
}
