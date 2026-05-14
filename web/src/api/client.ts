const BASE = "/admin/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = data as { error?: { code?: string; message?: string } } | null;
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export interface ProviderInfo {
  // Provider id is a runtime-registered string; "mimo" and "deepseek" are
  // built in, anything else is a user-declared generic provider.
  id: string;
  shortcut: string;
  display_name: string;
  default: boolean;
  enabled: boolean;
  api_key_present: boolean;
  api_key_env: string[];
  base_url: string;
  default_model: string;
  flags: Record<string, boolean>;
}

export interface SetupSnippetTarget {
  providerId: string;
  providerKey: string;
  providerLabel: string;
  modelId: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface SetupSnippetBundle {
  target: SetupSnippetTarget;
  authJson: string;
  configToml: string;
  configTomlEnvKey: string;
  ccSwitchAuthJson: string;
  ccSwitchConfigToml: string;
}

export interface SetupSnippetsResponse {
  bundle: SetupSnippetBundle;
  defaultProviderId: string;
  providers: Array<{ id: string; shortcut: string; display_name: string }>;
}

// Generic provider spec — mirror of GenericProviderSpec in src/providers/generic.ts.
// Stored verbatim in providers.json.
export interface GenericProviderModelSpec {
  id: string;
  aliases?: string[];
  displayName?: string;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  supportsWebSearch?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  deprecatedAfter?: string;
}

export interface GenericProviderSpec {
  id: string;
  shortcut?: string;
  displayName?: string;
  baseUrl: string;
  envKey: string;
  defaultModel: string;
  wireApi?: "chat" | "responses";
  models?: GenericProviderModelSpec[];
  features?: { webSearch?: boolean; forceParallelToolCalls?: boolean };
  docsUrl?: string;
}

export interface GenericProvidersResponse {
  specs: GenericProviderSpec[];
  path: string | null;
  source: "explicit" | "default" | null;
  exists: boolean;
  editable: boolean;
  notice?: string;
  error?: string;
}

export interface ModelRow {
  id: number;
  provider_id: string;
  upstream_id: string;
  display_name: string | null;
  supports_images: number;
  supports_reasoning: number;
  supports_web_search: number;
  context_window: number | null;
  is_builtin: number;
  deprecated_after: string | null;
  sort_order: number;
}

export interface AliasRow {
  alias: string;
  provider_id: string;
  upstream_id: string;
}

export interface LogRow {
  id: number;
  ts: number;
  request_id: string | null;
  provider_id: string;
  client_model: string;
  upstream_model: string;
  endpoint: string;
  status_code: number;
  duration_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  stream: number;
  error_code: string | null;
  error_snippet: string | null;
  tool_call_count: number | null;
}

export interface LogDetail extends LogRow {
  request_body: string | null;
  response_body: string | null;
}

export interface MappingRow {
  provider_id: string;
  client_model: string;
  upstream_model: string;
  count: number;
  last_seen: number;
}

export interface StatsResponse {
  since: number;
  rows: Array<{
    provider_id: string;
    upstream_model: string;
    requests: number;
    errors: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }>;
}

export interface TokenTimeseriesSeries {
  provider_id: string;
  upstream_model: string;
  tokens: number[];
  prompt_tokens: number[];
  completion_tokens: number[];
  total: number;
}

export type TimeseriesBucket = "day" | "hour";

export interface TokenTimeseriesResponse {
  range: string;
  bucket: TimeseriesBucket;
  since: number;
  buckets: string[];
  series: TokenTimeseriesSeries[];
}

// ───────── Codex 启用 ─────────

export interface CodexTarget {
  providerId: string;
  providerDisplayName: string;
  providerKey: string;
  modelId: string;
  displayName: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  source: "builtin" | "custom";
  hasKey: boolean;
  isCurrentOverride: boolean;
}

export interface ActiveOverride {
  providerId: string;
  modelId: string;
}

export interface CodexBackupPair {
  ts: number;
  authBackup: string | null;
  tomlBackup: string | null;
}

export interface CodexState {
  codexDir: string;
  authPath: string;
  tomlPath: string;
  authJsonOwner: "mimo2codex" | "external" | "missing";
  authJsonExists: boolean;
  configTomlExists: boolean;
  configTomlText: string | null;
  backups: CodexBackupPair[];
  activeOverride: ActiveOverride | null;
}

export interface CodexTargetsResponse {
  targets: CodexTarget[];
  activeOverride: ActiveOverride | null;
  authJsonOwner: "mimo2codex" | "external" | "missing";
}

export interface CodexApplyResponse {
  ok: boolean;
  backupTs: number;
  authBackup: string | null;
  tomlBackup: string | null;
  authJsonOwnerBefore: "mimo2codex" | "external" | "missing";
  restartRequired: boolean;
}

export const api = {
  health: () => request<{ ok: boolean; dataDir: string; version: string }>("GET", "/health"),
  providers: () => request<{ providers: ProviderInfo[] }>("GET", "/providers"),
  modelsFor: (providerId: string) =>
    request<{ models: ModelRow[] }>("GET", `/providers/${providerId}/models`),
  createModel: (providerId: string, body: { upstream_id: string; display_name?: string }) =>
    request<{ model: ModelRow }>("POST", `/providers/${providerId}/models`, body),
  patchModel: (id: number, body: Partial<ModelRow>) =>
    request<{ model: ModelRow }>("PATCH", `/models/${id}`, body),
  deleteModel: (id: number) => request<{ deleted: boolean }>("DELETE", `/models/${id}`),
  aliases: () => request<{ aliases: AliasRow[] }>("GET", "/aliases"),
  upsertAlias: (body: AliasRow) => request<{ alias: string }>("POST", "/aliases", body),
  deleteAlias: (alias: string) =>
    request<{ deleted: boolean }>("DELETE", `/aliases/${encodeURIComponent(alias)}`),
  logs: (params: { provider?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.provider) qs.set("provider", params.provider);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ logs: LogRow[] }>("GET", `/logs${suffix}`);
  },
  logDetail: (id: number) => request<{ log: LogDetail }>("GET", `/logs/${id}`),
  deleteLogsBefore: (ts: number) =>
    request<{ removed: number }>("DELETE", `/logs?before=${ts}`),
  mappings: () => request<{ mappings: MappingRow[] }>("GET", "/mappings"),
  stats: (range: "24h" | "7d" | "30d" = "24h") =>
    request<StatsResponse>("GET", `/stats?range=${range}`),
  tokenTimeseries: (range: "24h" | "7d" | "30d" = "7d", bucket: TimeseriesBucket = "day") =>
    request<TokenTimeseriesResponse>(
      "GET",
      `/stats/timeseries?range=${range}&bucket=${bucket}`
    ),
  settings: () => request<{ settings: Record<string, string> }>("GET", "/settings"),
  setSetting: (key: string, value: string) =>
    request<{ key: string; value: string }>("PUT", `/settings/${encodeURIComponent(key)}`, {
      value,
    }),
  setupSnippets: (providerId?: string) => {
    const qs = providerId ? `?provider=${encodeURIComponent(providerId)}` : "";
    return request<SetupSnippetsResponse>("GET", `/setup-snippets${qs}`);
  },
  genericProviders: () =>
    request<GenericProvidersResponse>("GET", "/generic-providers"),
  saveGenericProviders: (providers: GenericProviderSpec[]) =>
    request<{ ok: boolean; path: string; restartRequired: boolean }>(
      "PUT",
      "/generic-providers",
      { providers }
    ),
  codexState: () => request<CodexState>("GET", "/codex-state"),
  codexTargets: () => request<CodexTargetsResponse>("GET", "/codex-targets"),
  codexApply: (body: { providerId: string; modelId: string }) =>
    request<CodexApplyResponse>("POST", "/codex-apply", body),
  codexRestore: (ts: number) =>
    request<{ ok: boolean; restartRequired: boolean }>("POST", "/codex-restore", { ts }),
  getActiveOverride: () =>
    request<{ override: ActiveOverride | null }>("GET", "/active-override"),
  setActiveOverride: (body: { providerId: string; modelId: string }) =>
    request<{ override: ActiveOverride }>("PUT", "/active-override", body),
  clearActiveOverride: () =>
    request<{ deleted: boolean }>("DELETE", "/active-override"),
};
