import type { ChatRequest, ResponsesRequest } from "../translate/types.js";

export type ProviderId = "mimo" | "deepseek";

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
  deprecatedAfter?: string;
}

export interface ProviderEnhancedError {
  code: string;
  message: string;
}

export interface PreprocessCtx {
  runtime: ProviderRuntime;
  exposeReasoning: boolean;
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

  detectFlags(apiKey: string, baseUrl: string): Record<string, boolean>;
  // Some providers route different key tiers to different hosts. MiMo's
  // `tp-*` keys live behind `token-plan-cn.xiaomimimo.com`, while `sk-*` keys
  // hit the main pay-as-you-go host. Return null when the key gives no signal
  // — callers will then fall back to defaultBaseUrl.
  inferBaseUrlFromKey?(apiKey: string): string | null;
  resolveModel(clientModel: string): ProviderModel | null;
  preprocessResponses(req: ResponsesRequest, ctx: PreprocessCtx): ChatRequest;
  preprocessChat(req: ChatRequest, ctx: PreprocessCtx): ChatRequest;
  enhanceError(ctx: { status: number; snippet?: string }): ProviderEnhancedError | null;
}
