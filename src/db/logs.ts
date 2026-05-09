import { getDb } from "./index.js";

export interface ChatLogEntry {
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
  stream: boolean;
  error_code: string | null;
  error_snippet: string | null;
}

const MAX_SNIPPET = 500;

export function insertLog(entry: ChatLogEntry): void {
  const snippet = entry.error_snippet
    ? entry.error_snippet.length > MAX_SNIPPET
      ? entry.error_snippet.slice(0, MAX_SNIPPET) + "…"
      : entry.error_snippet
    : null;
  getDb()
    .prepare(
      `INSERT INTO chat_logs (
        ts, request_id, provider_id, client_model, upstream_model,
        endpoint, status_code, duration_ms,
        prompt_tokens, completion_tokens, total_tokens,
        stream, error_code, error_snippet
      ) VALUES (
        @ts, @request_id, @provider_id, @client_model, @upstream_model,
        @endpoint, @status_code, @duration_ms,
        @prompt_tokens, @completion_tokens, @total_tokens,
        @stream, @error_code, @error_snippet
      )`
    )
    .run({
      ts: entry.ts,
      request_id: entry.request_id,
      provider_id: entry.provider_id,
      client_model: entry.client_model,
      upstream_model: entry.upstream_model,
      endpoint: entry.endpoint,
      status_code: entry.status_code,
      duration_ms: entry.duration_ms,
      prompt_tokens: entry.prompt_tokens,
      completion_tokens: entry.completion_tokens,
      total_tokens: entry.total_tokens,
      stream: entry.stream ? 1 : 0,
      error_code: entry.error_code,
      error_snippet: snippet,
    });
}

export interface LogFilter {
  provider?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
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

export function queryLogs(filter: LogFilter = {}): LogRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.provider) {
    where.push("provider_id = @provider");
    params.provider = filter.provider;
  }
  if (typeof filter.from === "number") {
    where.push("ts >= @from");
    params.from = filter.from;
  }
  if (typeof filter.to === "number") {
    where.push("ts <= @to");
    params.to = filter.to;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
  const offset = Math.max(filter.offset ?? 0, 0);
  return getDb()
    .prepare(
      `SELECT * FROM chat_logs ${whereSql} ORDER BY ts DESC LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset }) as LogRow[];
}

export interface MappingRow {
  provider_id: string;
  client_model: string;
  upstream_model: string;
  count: number;
  last_seen: number;
}

export function aggregateMappings(): MappingRow[] {
  return getDb()
    .prepare(
      `SELECT provider_id, client_model, upstream_model, COUNT(*) AS count, MAX(ts) AS last_seen
       FROM chat_logs
       GROUP BY provider_id, client_model, upstream_model
       ORDER BY count DESC`
    )
    .all() as MappingRow[];
}

export interface StatsRow {
  provider_id: string;
  upstream_model: string;
  requests: number;
  errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

const RANGE_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function aggregateStats(range: string): { since: number; rows: StatsRow[] } {
  const span = RANGE_MS[range] ?? RANGE_MS["24h"];
  const since = Date.now() - span;
  const rows = getDb()
    .prepare(
      `SELECT provider_id, upstream_model,
              COUNT(*) AS requests,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM chat_logs
       WHERE ts >= @since
       GROUP BY provider_id, upstream_model
       ORDER BY requests DESC`
    )
    .all({ since }) as StatsRow[];
  return { since, rows };
}

export function deleteLogsBefore(ts: number): number {
  const info = getDb().prepare("DELETE FROM chat_logs WHERE ts < ?").run(ts);
  return info.changes;
}
