import { getDb } from "./index.js";

const FORBIDDEN_KEYS = new Set([
  "api_key",
  "apikey",
  "key",
  "mimo_api_key",
  "ds_api_key",
  "deepseek_api_key",
]);

export class ForbiddenSettingError extends Error {
  constructor(public readonly key: string) {
    super(
      `setting "${key}" cannot be stored — API keys must be supplied via environment variables (MIMO_API_KEY, DS_API_KEY, DEEPSEEK_API_KEY) or the --api-key CLI flag.`
    );
    this.name = "ForbiddenSettingError";
  }
}

export function isForbiddenSettingKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase());
}

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function listSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSetting(key: string, value: string): void {
  if (isForbiddenSettingKey(key)) {
    throw new ForbiddenSettingError(key);
  }
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, Date.now());
}

export function deleteSetting(key: string): boolean {
  const info = getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
  return info.changes > 0;
}
