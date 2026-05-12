import type { ChatRequest, ResponsesRequest } from "../translate/types.js";
import { reqToChat } from "../translate/reqToChat.js";
import type { PreprocessCtx, Provider, ProviderEnhancedError, ProviderModel } from "./types.js";

// Marker MiMo emits in 400 responses when web_search is forwarded but the
// account doesn't have the Web Search Plugin activated.
const WEB_SEARCH_DISABLED_MARKER = "webSearchEnabled is false";

const WEB_SEARCH_HINT =
  "MiMo Web Search Plugin is not activated for this account. " +
  "Activate it at https://platform.xiaomimimo.com/#/console/plugin (separately billed) " +
  "and restart mimo2codex. The model has decided to call web_search; if your account " +
  "doesn't include the plugin, this request will keep failing until activated.";

// Per https://platform.xiaomimimo.com/docs/zh-CN/usage-guide/multimodal-understanding/image-understanding,
// only `mimo-v2.5`, `mimo-v2.5[1m]` and `mimo-v2-omni` accept image input.
// The pro/flash variants do not — they return 404 "No endpoints found that
// support image input" if sent images.
const BUILTIN_MODELS: readonly ProviderModel[] = [
  {
    id: "mimo-v2.5-pro",
    displayName: "MiMo V2.5 Pro",
    supportsImages: false,
    supportsReasoning: true,
    supportsWebSearch: true,
    contextWindow: 128_000,
  },
  {
    id: "mimo-v2.5-pro[1m]",
    displayName: "MiMo V2.5 Pro (1M)",
    supportsImages: false,
    supportsReasoning: true,
    supportsWebSearch: true,
    contextWindow: 1_000_000,
  },
  {
    id: "mimo-v2.5",
    displayName: "MiMo V2.5 (Vision)",
    supportsImages: true,
    supportsReasoning: true,
    supportsWebSearch: true,
    contextWindow: 128_000,
  },
  {
    id: "mimo-v2.5[1m]",
    displayName: "MiMo V2.5 (Vision, 1M)",
    supportsImages: true,
    supportsReasoning: true,
    supportsWebSearch: true,
    contextWindow: 1_000_000,
  },
  {
    id: "mimo-v2-omni",
    displayName: "MiMo V2 Omni (Vision + Audio)",
    supportsImages: true,
    supportsReasoning: true,
    supportsWebSearch: true,
    contextWindow: 128_000,
  },
  {
    id: "mimo-v2-flash",
    displayName: "MiMo V2 Flash",
    supportsImages: false,
    contextWindow: 128_000,
  },
];

// MiMo runs two hosts:
//   - pay-as-you-go (`sk-*` keys): https://api.xiaomimimo.com/v1
//   - token-plan (`tp-*` keys):    https://token-plan-cn.xiaomimimo.com/v1
// Sending a tp-* key to the pay-as-you-go host (or vice versa) yields a 401.
const PAYG_BASE_URL = "https://api.xiaomimimo.com/v1";
const TOKEN_PLAN_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";

function isTokenPlanRuntime(apiKey: string, baseUrl: string): boolean {
  return /token-plan/i.test(baseUrl) || apiKey.startsWith("tp-");
}

export const mimo: Provider = {
  id: "mimo",
  shortcut: "mimo",
  displayName: "MiMo (via mimo2codex)",
  defaultBaseUrl: PAYG_BASE_URL,
  baseUrlEnv: "MIMO_BASE_URL",
  envKeys: ["MIMO_API_KEY"] as const,
  defaultModel: "mimo-v2.5-pro",
  builtinModels: BUILTIN_MODELS,

  detectFlags(apiKey, baseUrl) {
    return { isTokenPlan: isTokenPlanRuntime(apiKey, baseUrl) };
  },

  inferBaseUrlFromKey(apiKey) {
    if (apiKey.startsWith("tp-")) return TOKEN_PLAN_BASE_URL;
    if (apiKey.startsWith("sk-")) return PAYG_BASE_URL;
    return null;
  },

  resolveModel(clientModel) {
    return BUILTIN_MODELS.find((m) => m.id === clientModel) ?? null;
  },

  preprocessResponses(req: ResponsesRequest, ctx: PreprocessCtx): ChatRequest {
    // mimo2codex's two default-on behaviors that compensate for MiMo's weaker
    // agentic-coding training compared to GPT-5 / Claude:
    //   - parallel_tool_calls: true        ← batch tool calls per turn
    //   - web_search forwarded to MiMo     ← model decides when to search
    //
    // Token-plan accounts don't have the Web Search Plugin, so we proactively
    // strip web_search before forwarding (avoids 400 "webSearchEnabled is false").
    return reqToChat(req, {
      forceParallelToolCalls: true,
      enableWebSearch: !ctx.runtime.flags.isTokenPlan,
    });
  },

  preprocessChat(req: ChatRequest, _ctx: PreprocessCtx): ChatRequest {
    // Chat passthrough: forward verbatim. MiMo is itself Chat-Completions-native.
    return req;
  },

  enhanceError({ status, snippet }): ProviderEnhancedError | null {
    if (status === 400 && snippet?.includes(WEB_SEARCH_DISABLED_MARKER)) {
      return {
        code: "web_search_plugin_not_activated",
        message: `${WEB_SEARCH_HINT} (raw: ${snippet})`,
      };
    }
    return null;
  },
};
