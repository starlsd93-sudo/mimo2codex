import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { closeDb, openDb } from "../src/db/index.js";
import { insertLog, queryLogs, aggregateMappings, aggregateStats, getLogById } from "../src/db/logs.js";
import { listSettings, setSetting, ForbiddenSettingError } from "../src/db/settings.js";
import {
  insertCustomModel,
  listModels,
  patchModel,
  deleteModel,
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

  it("syncs context_window and prunes stale builtin rows on next open", () => {
    // Simulate a previous version's seed: a legacy "[1m]" variant + a
    // legitimate row whose context_window has since been bumped in source.
    closeDb();
    const raw = new Database(join(dataDir, "data.db"));
    raw.prepare(
      `INSERT INTO models
        (provider_id, upstream_id, display_name,
         supports_images, supports_reasoning, supports_web_search,
         context_window, is_builtin, deprecated_after, sort_order)
       VALUES ('mimo', 'mimo-v2.5-pro[1m]', 'Legacy 1M variant',
               0, 1, 1, 1000000, 1, NULL, 99)`
    ).run();
    // Force a stale context_window on a still-current builtin row.
    raw
      .prepare(
        `UPDATE models SET context_window = 128000 WHERE provider_id = 'mimo' AND upstream_id = 'mimo-v2.5-pro'`
      )
      .run();
    raw.close();

    openDb(dataDir);

    const after = listModels("mimo");
    // Stale legacy row is gone.
    expect(after.find((m) => m.upstream_id === "mimo-v2.5-pro[1m]")).toBeUndefined();
    // Current builtin row has been refreshed from source (1M, not 128k).
    const proRow = after.find((m) => m.upstream_id === "mimo-v2.5-pro");
    expect(proRow?.context_window).toBe(1_000_000);
  });

  it("does not delete user-created custom (is_builtin=0) models during prune", () => {
    insertCustomModel("mimo", {
      upstream_id: "user-fork-v1",
      display_name: "user's fork",
    });
    closeDb();
    openDb(dataDir);
    const mimoModels = listModels("mimo");
    expect(mimoModels.find((m) => m.upstream_id === "user-fork-v1")).toBeDefined();
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

  it("v3 column: insertLog persists cached_tokens, queryLogs surfaces it, missing field defaults to null", () => {
    insertLog({
      ts: 600,
      request_id: "c1",
      provider_id: "mimo",
      client_model: "mimo-v2.5-pro",
      upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses",
      status_code: 200,
      duration_ms: 5,
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      stream: false,
      error_code: null,
      error_snippet: null,
      request_body: null,
      response_body: null,
      tool_call_count: null,
      cached_tokens: 80,
    });
    // Second row without cached_tokens — older callers / error paths.
    insertLog({
      ts: 601,
      request_id: "c2",
      provider_id: "mimo",
      client_model: "mimo-v2.5-pro",
      upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses",
      status_code: 200,
      duration_ms: 5,
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      stream: false,
      error_code: null,
      error_snippet: null,
      request_body: null,
      response_body: null,
      tool_call_count: null,
    });
    const list = queryLogs({});
    const cached = list.find((r) => r.request_id === "c1");
    const uncached = list.find((r) => r.request_id === "c2");
    expect(cached?.cached_tokens).toBe(80);
    expect(uncached?.cached_tokens).toBeNull();
  });

  it("v2 columns: insertLog persists request_body, response_body, tool_call_count and getLogById returns them", () => {
    insertLog({
      ts: 500,
      request_id: "rb1",
      provider_id: "mimo",
      client_model: "mimo-v2.5-pro",
      upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses",
      status_code: 200,
      duration_ms: 12,
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
      stream: true,
      error_code: null,
      error_snippet: null,
      request_body: '{"input":"hi"}',
      response_body: '{"output":"hello"}',
      tool_call_count: 2,
    });
    const list = queryLogs({});
    const head = list[0];
    // Bodies excluded from list shape.
    expect((head as unknown as { request_body?: unknown }).request_body).toBeUndefined();
    expect(head.tool_call_count).toBe(2);
    const detail = getLogById(head.id);
    expect(detail).not.toBeNull();
    expect(detail!.request_body).toBe('{"input":"hi"}');
    expect(detail!.response_body).toBe('{"output":"hello"}');
    expect(detail!.tool_call_count).toBe(2);
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

});
