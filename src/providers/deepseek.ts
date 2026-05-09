import type { ChatRequest, ResponsesRequest } from "../translate/types.js";
import { reqToChat } from "../translate/reqToChat.js";
import type { PreprocessCtx, Provider, ProviderModel } from "./types.js";

// Builtin DeepSeek model catalog. Source: https://api-docs.deepseek.com/zh-cn/
// `deepseek-chat` and `deepseek-reasoner` are the legacy aliases that route to
// `deepseek-v4-flash` (non-thinking / thinking respectively); they're announced
// for deprecation 2026-07-24. We keep them as aliases for backwards compat.
const BUILTIN_MODELS: readonly ProviderModel[] = [
  {
    id: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    supportsReasoning: true,
  },
  {
    id: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    aliases: ["deepseek-chat", "deepseek-reasoner"],
    supportsReasoning: true,
  },
  {
    id: "deepseek-chat",
    displayName: "DeepSeek Chat (legacy)",
    deprecatedAfter: "2026-07-24",
  },
  {
    id: "deepseek-reasoner",
    displayName: "DeepSeek Reasoner (legacy)",
    supportsReasoning: true,
    deprecatedAfter: "2026-07-24",
  },
];

export const deepseek: Provider = {
  id: "deepseek",
  shortcut: "ds",
  displayName: "DeepSeek",
  defaultBaseUrl: "https://api.deepseek.com/v1",
  baseUrlEnv: "DEEPSEEK_BASE_URL",
  envKeys: ["DS_API_KEY", "DEEPSEEK_API_KEY"] as const,
  defaultModel: "deepseek-v4-pro",
  builtinModels: BUILTIN_MODELS,

  detectFlags(_apiKey, _baseUrl) {
    return {};
  },

  resolveModel(clientModel) {
    for (const m of BUILTIN_MODELS) {
      if (m.id === clientModel) return m;
      if (m.aliases?.includes(clientModel)) return m;
    }
    return null;
  },

  preprocessResponses(req: ResponsesRequest, _ctx: PreprocessCtx): ChatRequest {
    // DeepSeek is OpenAI Chat Completions compatible. No `thinking` field, no
    // `web_search` builtin (drop those tools), no MiMo-style force-parallel
    // override (respect the client's value).
    const chat = reqToChat(req, {
      forceParallelToolCalls: false,
      enableWebSearch: false,
    });
    // Drop any MiMo-specific fields that may have leaked in.
    delete chat.thinking;
    delete chat.enable_thinking;
    return chat;
  },

  preprocessChat(req: ChatRequest, _ctx: PreprocessCtx): ChatRequest {
    // Strip MiMo-specific fields from chat passthrough so a misrouted request
    // doesn't 400 at DeepSeek.
    const out = { ...req };
    delete out.thinking;
    delete out.enable_thinking;
    return out;
  },

  enhanceError(_ctx) {
    return null;
  },
};
