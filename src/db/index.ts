import Database from "better-sqlite3";
import { join } from "node:path";
import { MIGRATIONS } from "./schema.js";
import { PROVIDER_LIST } from "../providers/registry.js";
import { log } from "../util/log.js";

export type DB = Database.Database;

let instance: DB | null = null;
let instancePath: string | null = null;

export function openDb(dataDir: string): DB {
  const dbPath = join(dataDir, "data.db");
  if (instance && instancePath === dbPath) return instance;
  if (instance) {
    instance.close();
    instance = null;
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  seedBuiltins(db);
  instance = db;
  instancePath = dbPath;
  log.debug(`sqlite opened at ${dbPath}`);
  return db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }
}

export function getDb(): DB {
  if (!instance) {
    throw new Error("db not opened — call openDb(dataDir) before getDb()");
  }
  return instance;
}

function applyMigrations(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );`);
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
  const current = row.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec(m.sql);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
      m.version,
      Date.now()
    );
    log.debug(`applied schema migration v${m.version}`);
  }
}

function seedBuiltins(db: DB): void {
  const upsertProvider = db.prepare(`
    INSERT INTO providers (id, shortcut, display_name, base_url, default_model, api_key_env, updated_at)
    VALUES (@id, @shortcut, @display_name, @base_url, @default_model, @api_key_env, @updated_at)
    ON CONFLICT(id) DO NOTHING
  `);
  const upsertModel = db.prepare(`
    INSERT INTO models (
      provider_id, upstream_id, display_name,
      supports_images, supports_reasoning, supports_web_search,
      context_window, is_builtin, deprecated_after, sort_order
    ) VALUES (
      @provider_id, @upstream_id, @display_name,
      @supports_images, @supports_reasoning, @supports_web_search,
      @context_window, 1, @deprecated_after, @sort_order
    )
    ON CONFLICT(provider_id, upstream_id) DO NOTHING
  `);
  const upsertAlias = db.prepare(`
    INSERT INTO model_aliases (alias, provider_id, upstream_id)
    VALUES (@alias, @provider_id, @upstream_id)
    ON CONFLICT(alias) DO NOTHING
  `);

  const now = Date.now();
  const tx = db.transaction(() => {
    for (const p of PROVIDER_LIST) {
      upsertProvider.run({
        id: p.id,
        shortcut: p.shortcut,
        display_name: p.displayName,
        base_url: p.defaultBaseUrl,
        default_model: p.defaultModel,
        api_key_env: p.envKeys.join(","),
        updated_at: now,
      });
      let order = 0;
      for (const m of p.builtinModels) {
        upsertModel.run({
          provider_id: p.id,
          upstream_id: m.id,
          display_name: m.displayName ?? null,
          supports_images: m.supportsImages ? 1 : 0,
          supports_reasoning: m.supportsReasoning ? 1 : 0,
          supports_web_search: m.supportsWebSearch ? 1 : 0,
          context_window: m.contextWindow ?? null,
          deprecated_after: m.deprecatedAfter ?? null,
          sort_order: order++,
        });
        for (const alias of m.aliases ?? []) {
          upsertAlias.run({ alias, provider_id: p.id, upstream_id: m.id });
        }
      }
    }
  });
  tx();
}
