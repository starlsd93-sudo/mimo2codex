import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db/index.js";
import { insertLog, queryLogs, aggregateMappings, aggregateStats } from "../src/db/logs.js";
import { listSettings, setSetting, ForbiddenSettingError } from "../src/db/settings.js";
import {
  insertCustomModel,
  listModels,
  patchModel,
  deleteModel,
  upsertAlias,
  lookupAlias,
} from "../src/db/models.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-db-test-"));
  openDb(dataDir);
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("db migrations + seeding", () => {
  it("seeds builtin providers and models on first open", () => {
    const mimoModels = listModels("mimo");
    expect(mimoModels.length).toBeGreaterThan(0);
    expect(mimoModels.find((m) => m.upstream_id === "mimo-v2.5-pro")).toBeDefined();
    const dsModels = listModels("deepseek");
    expect(dsModels.find((m) => m.upstream_id === "deepseek-v4-pro")).toBeDefined();
    expect(dsModels.find((m) => m.upstream_id === "deepseek-v4-flash")).toBeDefined();
    // builtin flag is set
    expect(mimoModels[0].is_builtin).toBe(1);
  });

  it("re-opening the same db does not duplicate seeds (idempotent)", () => {
    closeDb();
    openDb(dataDir);
    const mimoModels = listModels("mimo");
    // No duplicate rows for the same upstream_id within a provider.
    const ids = mimoModels.map((m) => m.upstream_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("chat_logs", () => {
  it("inserts and queries logs ordered by recency", () => {
    insertLog({
      ts: 100,
      request_id: "r1",
      provider_id: "mimo",
      client_model: "mimo-v2.5-pro",
      upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses",
      status_code: 200,
      duration_ms: 42,
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      stream: false,
      error_code: null,
      error_snippet: null,
    });
    insertLog({
      ts: 200,
      request_id: "r2",
      provider_id: "deepseek",
      client_model: "deepseek-v4-pro",
      upstream_model: "deepseek-v4-pro",
      endpoint: "/v1/responses",
      status_code: 200,
      duration_ms: 100,
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
      stream: true,
      error_code: null,
      error_snippet: null,
    });
    const all = queryLogs({});
    expect(all).toHaveLength(2);
    expect(all[0].request_id).toBe("r2");
    expect(all[1].request_id).toBe("r1");
    const dsOnly = queryLogs({ provider: "deepseek" });
    expect(dsOnly).toHaveLength(1);
    expect(dsOnly[0].provider_id).toBe("deepseek");
  });

  it("aggregateMappings groups by client/upstream model pair", () => {
    insertLog({
      ts: 1, request_id: null, provider_id: "mimo",
      client_model: "alias-a", upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses", status_code: 200, duration_ms: 1,
      prompt_tokens: null, completion_tokens: null, total_tokens: null,
      stream: false, error_code: null, error_snippet: null,
    });
    insertLog({
      ts: 2, request_id: null, provider_id: "mimo",
      client_model: "alias-a", upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses", status_code: 200, duration_ms: 1,
      prompt_tokens: null, completion_tokens: null, total_tokens: null,
      stream: false, error_code: null, error_snippet: null,
    });
    const rows = aggregateMappings();
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].last_seen).toBe(2);
  });

  it("aggregateStats sums tokens within the requested range", () => {
    const now = Date.now();
    insertLog({
      ts: now - 1000, request_id: null, provider_id: "mimo",
      client_model: "mimo-v2.5-pro", upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses", status_code: 200, duration_ms: 1,
      prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
      stream: false, error_code: null, error_snippet: null,
    });
    insertLog({
      ts: now - 2000, request_id: null, provider_id: "mimo",
      client_model: "mimo-v2.5-pro", upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses", status_code: 500, duration_ms: 1,
      prompt_tokens: 7, completion_tokens: 0, total_tokens: 7,
      stream: false, error_code: "server_error", error_snippet: "boom",
    });
    const { rows } = aggregateStats("24h");
    expect(rows).toHaveLength(1);
    expect(rows[0].requests).toBe(2);
    expect(rows[0].errors).toBe(1);
    expect(rows[0].total_tokens).toBe(157);
  });
});

describe("settings (key storage forbidden)", () => {
  it("setSetting rejects keys that look like API keys", () => {
    expect(() => setSetting("api_key", "sk-x")).toThrow(ForbiddenSettingError);
    expect(() => setSetting("MIMO_API_KEY", "sk-x")).toThrow(ForbiddenSettingError);
    expect(() => setSetting("DS_API_KEY", "sk-x")).toThrow(ForbiddenSettingError);
  });

  it("normal settings round-trip", () => {
    setSetting("ui.theme", "dark");
    setSetting("ui.density", "compact");
    expect(listSettings()).toEqual({ "ui.theme": "dark", "ui.density": "compact" });
  });
});

describe("custom models + aliases", () => {
  it("insertCustomModel adds a non-builtin row", () => {
    const row = insertCustomModel("deepseek", {
      upstream_id: "deepseek-experimental",
      display_name: "DS Experimental",
    });
    expect(row.is_builtin).toBe(0);
    const dsModels = listModels("deepseek");
    expect(dsModels.find((m) => m.upstream_id === "deepseek-experimental")).toBeDefined();
  });

  it("patchModel refuses to modify builtin rows", () => {
    const builtin = listModels("mimo").find((m) => m.is_builtin === 1)!;
    expect(() =>
      patchModel(builtin.id, { display_name: "Hijacked" })
    ).toThrow(/builtin models cannot be modified/);
  });

  it("deleteModel refuses to delete builtin rows but allows custom ones", () => {
    const custom = insertCustomModel("deepseek", { upstream_id: "ds-custom-1" });
    expect(deleteModel(custom.id)).toBe(true);
    const builtin = listModels("mimo").find((m) => m.is_builtin === 1)!;
    expect(() => deleteModel(builtin.id)).toThrow(/builtin models cannot be deleted/);
  });

  it("aliases upsert + lookup", () => {
    upsertAlias({ alias: "fast", provider_id: "mimo", upstream_id: "mimo-v2-flash" });
    const r = lookupAlias("fast");
    expect(r?.provider_id).toBe("mimo");
    expect(r?.upstream_id).toBe("mimo-v2-flash");
    upsertAlias({ alias: "fast", provider_id: "deepseek", upstream_id: "deepseek-v4-flash" });
    expect(lookupAlias("fast")?.provider_id).toBe("deepseek");
  });
});
