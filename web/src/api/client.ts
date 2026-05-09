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
  id: "mimo" | "deepseek";
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

export const api = {
  health: () => request<{ ok: boolean; dataDir: string }>("GET", "/health"),
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
  deleteLogsBefore: (ts: number) =>
    request<{ removed: number }>("DELETE", `/logs?before=${ts}`),
  mappings: () => request<{ mappings: MappingRow[] }>("GET", "/mappings"),
  stats: (range: "24h" | "7d" | "30d" = "24h") =>
    request<StatsResponse>("GET", `/stats?range=${range}`),
  settings: () => request<{ settings: Record<string, string> }>("GET", "/settings"),
  setSetting: (key: string, value: string) =>
    request<{ key: string; value: string }>("PUT", `/settings/${encodeURIComponent(key)}`, {
      value,
    }),
};
