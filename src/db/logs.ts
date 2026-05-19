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
  // JSON strings, redacted before being passed in. May be null when the
  // upstream surface didn't yield a body we could capture (e.g. raw chat
  // completions stream passthrough where we don't decode SSE).
  request_body: string | null;
  response_body: string | null;
  tool_call_count: number | null;
  // Upstream-reported prompt-cache hits in tokens (subset of prompt_tokens).
  // Optional in the entry so the many error-path recordLog call sites that
  // don't have usage data don't need to spell out cached_tokens: null.
  cached_tokens?: number | null;
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
        stream, error_code, error_snippet,
        request_body, response_body, tool_call_count, cached_tokens
      ) VALUES (
        @ts, @request_id, @provider_id, @client_model, @upstream_model,
        @endpoint, @status_code, @duration_ms,
        @prompt_tokens, @completion_tokens, @total_tokens,
        @stream, @error_code, @error_snippet,
        @request_body, @response_body, @tool_call_count, @cached_tokens
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
      request_body: entry.request_body,
      response_body: entry.response_body,
      tool_call_count: entry.tool_call_count,
      cached_tokens: entry.cached_tokens ?? null,
    });
}

export interface LogFilter {
  provider?: string;
  // Substring match against upstream_model (case-sensitive, SQL LIKE).
  model?: string;
  // Inclusive bounds for HTTP status_code, useful to slice success vs error.
  statusMin?: number;
  statusMax?: number;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

// Light-weight row for the table view. Bodies are intentionally excluded —
// they can be large and we only want them on demand via getLogById.
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
  cached_tokens: number | null;
}

export interface LogDetailRow extends LogRow {
  request_body: string | null;
  response_body: string | null;
}

const LIST_COLUMNS =
  "id, ts, request_id, provider_id, client_model, upstream_model, " +
  "endpoint, status_code, duration_ms, prompt_tokens, completion_tokens, " +
  "total_tokens, stream, error_code, error_snippet, tool_call_count, cached_tokens";

export function queryLogs(filter: LogFilter = {}): LogRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.provider) {
    where.push("provider_id = @provider");
    params.provider = filter.provider;
  }
  if (filter.model) {
    where.push("upstream_model LIKE @model");
    params.model = `%${filter.model}%`;
  }
  if (typeof filter.statusMin === "number") {
    where.push("status_code >= @statusMin");
    params.statusMin = filter.statusMin;
  }
  if (typeof filter.statusMax === "number") {
    where.push("status_code <= @statusMax");
    params.statusMax = filter.statusMax;
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
      `SELECT ${LIST_COLUMNS} FROM chat_logs ${whereSql} ORDER BY ts DESC LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset }) as LogRow[];
}

export function getLogById(id: number): LogDetailRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM chat_logs WHERE id = ?`)
    .get(id) as LogDetailRow | undefined;
  return row ?? null;
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

export interface ErrorBucket {
  error_code: string;
  count: number;
}

export function aggregateErrors(range: string): { since: number; rows: ErrorBucket[] } {
  const span = RANGE_MS[range] ?? RANGE_MS["24h"];
  const since = Date.now() - span;
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(error_code, 'http_' || status_code) AS error_code, COUNT(*) AS count
       FROM chat_logs
       WHERE ts >= @since AND status_code >= 400
       GROUP BY error_code
       ORDER BY count DESC`
    )
    .all({ since }) as ErrorBucket[];
  return { since, rows };
}

export interface LatencyStats {
  since: number;
  count: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

// Latency percentiles over the window. We pull duration_ms into JS to compute
// quantiles because SQLite lacks PERCENTILE_CONT — for typical windows
// (≤30 days × ≤thousands of requests) this is fine; if traffic grows past
// 1M rows we can revisit with a window-function approach.
export function aggregateLatency(range: string): LatencyStats {
  const span = RANGE_MS[range] ?? RANGE_MS["24h"];
  const since = Date.now() - span;
  const rows = getDb()
    .prepare(
      `SELECT duration_ms FROM chat_logs
       WHERE ts >= @since AND duration_ms IS NOT NULL
       ORDER BY duration_ms ASC`
    )
    .all({ since }) as Array<{ duration_ms: number }>;
  if (rows.length === 0) {
    return { since, count: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }
  const values = rows.map((r) => r.duration_ms);
  const sum = values.reduce((a, b) => a + b, 0);
  const pct = (q: number): number => {
    if (values.length === 1) return values[0];
    const idx = Math.min(values.length - 1, Math.floor((values.length - 1) * q));
    return values[idx];
  };
  return {
    since,
    count: values.length,
    avg: Math.round(sum / values.length),
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
  };
}

export interface ProviderHealthRow {
  provider_id: string;
  requests: number;
  errors: number;
  // 0..100; -1 when zero requests in the window.
  error_rate: number;
  last_seen: number | null;
}

// Last hour error rate per provider — feeds the Dashboard "Provider Status"
// card. Provider with no traffic returns error_rate = -1 so the UI can
// distinguish "no data" from "0% errors".
export function aggregateProviderHealth(rangeMs: number = 60 * 60 * 1000): ProviderHealthRow[] {
  const since = Date.now() - rangeMs;
  return getDb()
    .prepare(
      `SELECT provider_id,
              COUNT(*) AS requests,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors,
              CASE
                WHEN COUNT(*) = 0 THEN -1
                ELSE ROUND(100.0 * SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) / COUNT(*), 1)
              END AS error_rate,
              MAX(ts) AS last_seen
       FROM chat_logs
       WHERE ts >= @since
       GROUP BY provider_id
       ORDER BY requests DESC`
    )
    .all({ since }) as ProviderHealthRow[];
}

// Per-day token usage broken down by (provider_id, upstream_model). The
// dashboard renders this as a multi-series line chart so users can spot
// which model is eating their token budget.
//
// Returns dense data — every day in the window appears in `buckets`, and
// every model returned has a `tokens` array of the same length with zero
// entries for days where it had no traffic. Makes the SVG chart trivial to
// render without per-day lookup tables.
export interface TokenTimeseriesSeries {
  provider_id: string;
  upstream_model: string;
  tokens: number[]; // same length as buckets, zero-filled
  prompt_tokens: number[];
  completion_tokens: number[];
  // Upstream-reported prompt-cache hits per bucket (subset of prompt_tokens).
  // Zero-filled when the upstream returned no cache data or the column was
  // never populated (pre-v3 rows).
  cached_tokens: number[];
  total: number; // sum across the window, for ranking
}

export type TimeseriesBucket = "day" | "hour";

export interface TokenTimeseries {
  range: string;
  bucket: TimeseriesBucket;
  since: number;
  // Per-bucket time labels:
  //   - bucket="day"  → "YYYY-MM-DD"
  //   - bucket="hour" → "YYYY-MM-DD HH" (24-hour, local tz)
  // Both formats are ascending and dense (no gaps).
  buckets: string[];
  series: TokenTimeseriesSeries[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoHour(d: Date): string {
  return `${isoDate(d)} ${pad2(d.getHours())}`;
}

export function aggregateTokensTimeseries(
  range: string,
  bucket: TimeseriesBucket = "day"
): TokenTimeseries {
  const span = RANGE_MS[range] ?? RANGE_MS["7d"];
  const since = Date.now() - span;

  // Build the dense bucket list spanning [since..now] inclusive, in local
  // time. Emitted ascending so the chart x-axis reads left-to-right from
  // oldest to newest.
  const buckets: string[] = [];
  if (bucket === "hour") {
    const start = new Date(since);
    start.setMinutes(0, 0, 0);
    const end = new Date();
    end.setMinutes(0, 0, 0);
    for (let d = new Date(start); d <= end; d.setHours(d.getHours() + 1)) {
      buckets.push(isoHour(d));
    }
  } else {
    const start = new Date(since);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      buckets.push(isoDate(d));
    }
  }
  const bucketIndex: Map<string, number> = new Map(buckets.map((b, i) => [b, i]));

  // The SQL-side bucket key must match the JS string format above so the
  // bucketIndex lookup hits. strftime + unixepoch + localtime gives us the
  // local-tz date/hour string SQLite-side.
  const fmt =
    bucket === "hour" ? "%Y-%m-%d %H" : "%Y-%m-%d";
  const rows = getDb()
    .prepare(
      `SELECT strftime('${fmt}', ts/1000, 'unixepoch', 'localtime') AS day,
              provider_id,
              upstream_model,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(cached_tokens), 0) AS cached_tokens
       FROM chat_logs
       WHERE ts >= @since
       GROUP BY day, provider_id, upstream_model
       ORDER BY day ASC`
    )
    .all({ since }) as Array<{
    day: string;
    provider_id: string;
    upstream_model: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens: number;
  }>;

  // Pivot the long-format rows into per-model series with dense bucket arrays.
  const seriesMap = new Map<string, TokenTimeseriesSeries>();
  for (const r of rows) {
    const key = `${r.provider_id}:::${r.upstream_model}`;
    let s = seriesMap.get(key);
    if (!s) {
      s = {
        provider_id: r.provider_id,
        upstream_model: r.upstream_model,
        tokens: new Array(buckets.length).fill(0),
        prompt_tokens: new Array(buckets.length).fill(0),
        completion_tokens: new Array(buckets.length).fill(0),
        cached_tokens: new Array(buckets.length).fill(0),
        total: 0,
      };
      seriesMap.set(key, s);
    }
    const idx = bucketIndex.get(r.day);
    if (idx === undefined) continue;
    s.tokens[idx] = r.total_tokens;
    s.prompt_tokens[idx] = r.prompt_tokens;
    s.completion_tokens[idx] = r.completion_tokens;
    s.cached_tokens[idx] = r.cached_tokens;
    s.total += r.total_tokens;
  }

  // Sort by total descending so the chart picks the most-used models when
  // truncating the legend.
  const series = Array.from(seriesMap.values()).sort((a, b) => b.total - a.total);
  return { range, bucket, since, buckets, series };
}
