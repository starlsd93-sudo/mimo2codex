import type { ChatRequest, ResponsesRequest } from "../translate/types.js";

// Provider id is a runtime-registered string. Built-ins are "mimo" / "deepseek";
// generic OpenAI-compatible providers loaded from providers.json contribute
// their own ids at startup. Kept as a type alias for semantic clarity at call
// sites that previously expected the literal union.
export type ProviderId = string;

export interface ProviderRuntime {
  baseUrl: string;
  apiKey: string;
  flags: Record<string, boolean>;
}

export interface ProviderModel {
  id: string;
  aliases?: string[];
  displayName?: string;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  supportsWebSearch?: boolean;
  contextWindow?: number;
  // Optional per-model output cap. Used by cli.ts when emitting
  // `model_max_output_tokens` in the toml snippet. DeepSeek used to hardcode
  // 393_216 in cli.ts; with this field, generic providers can declare their
  // own caps uniformly.
  maxOutputTokens?: number;
  deprecatedAfter?: string;
}

export interface ProviderEnhancedError {
  code: string;
  message: string;
}

export interface PreprocessCtx {
  runtime: ProviderRuntime;
  exposeReasoning: boolean;
  // When the active model can't ingest images and the proxy strips them, the
  // proxy materializes the image bytes to disk here so the agent (Codex) can
  // pass the path to mimoskill/scripts/ocr.py. Empty/undefined → falls back
  // to os.tmpdir() inside reqToChat. Typically `cfg.dataDir`.
  dataDir?: string;
}

export interface Provider {
  id: ProviderId;
  shortcut: string;
  displayName: string;
  defaultBaseUrl: string;
  baseUrlEnv: string;
  envKeys: readonly string[];
  defaultModel: string;
  builtinModels: readonly ProviderModel[];
  // Wire protocol toward the upstream. "chat" (default) goes through
  // reqToChat/respToResponses translation. "responses" pipes the Codex
  // Responses payload straight to the upstream's /v1/responses endpoint —
  // useful when the upstream natively speaks Responses (OpenAI, future
  // Chat-Completions-deprecated providers) and translation would only
  // strip fields the upstream actually understands.
  wireApi?: "chat" | "responses";
  // Optional doc URL surfaced in "missing API key" error messages instead
  // of the hardcoded mimo / deepseek console links.
  docsUrl?: string;

  detectFlags(apiKey: string, baseUrl: string): Record<string, boolean>;
  // Some providers route different key tiers to different hosts. MiMo's
  // `tp-*` keys live behind `token-plan-cn.xiaomimimo.com`, while `sk-*` keys
  // hit the main pay-as-you-go host. Return null when the key gives no signal
  // — callers will then fall back to defaultBaseUrl.
  inferBaseUrlFromKey?(apiKey: string): string | null;
  resolveModel(clientModel: string): ProviderModel | null;
  preprocessResponses(req: ResponsesRequest, ctx: PreprocessCtx): ChatRequest;
  preprocessChat(req: ChatRequest, ctx: PreprocessCtx): ChatRequest;
  // Lightweight hook for wireApi === "responses". Receives the original Codex
  // Responses payload; return the version to forward (model id rewrite,
  // field cleanup, etc). Default behavior when omitted is identity passthrough
  // with `model` substituted by the routing layer.
  preprocessResponsesPassthrough?(req: ResponsesRequest, ctx: PreprocessCtx): ResponsesRequest;
  enhanceError(ctx: { status: number; snippet?: string }): ProviderEnhancedError | null;
  // minimax-compat: 响应翻译层用到的开关。未实现时所有标记 false → 既有行为。
  // 目前只放 extractInlineThink（把 content 里的 <think>...</think> 切到 reasoning_content），
  // 后续若再加响应侧 sanitizer 共用这一个对象，避免接口爆炸。
  responseFlags?: {
    extractInlineThink?: boolean;
  };
}
