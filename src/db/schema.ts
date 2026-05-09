// Initial schema. Kept inline (rather than as a .sql file alongside the
// compiled .js) so packaging doesn't have to chase asset paths. Future
// migrations should append numbered statements to MIGRATIONS and bump the
// schema version checked at startup.

export const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  shortcut TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  default_model TEXT NOT NULL,
  api_key_env TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL,
  display_name TEXT,
  supports_images INTEGER NOT NULL DEFAULT 0,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  supports_web_search INTEGER NOT NULL DEFAULT 0,
  context_window INTEGER,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  deprecated_after TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider_id, upstream_id)
);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id, sort_order);

CREATE TABLE IF NOT EXISTS model_aliases (
  alias TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  request_id TEXT,
  provider_id TEXT NOT NULL,
  client_model TEXT NOT NULL,
  upstream_model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  stream INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_snippet TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_logs_ts ON chat_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_chat_logs_provider ON chat_logs(provider_id, ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`,
  },
];
