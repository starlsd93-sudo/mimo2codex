import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db/index.js";
import { handleAdmin } from "../src/admin/router.js";
import type { Config } from "../src/config.js";
import { insertLog } from "../src/db/logs.js";

let dataDir: string;
let server: Server;
let port: number;

const cfg: Config = {
  host: "127.0.0.1",
  port: 0,
  baseUrl: "https://api.xiaomimimo.com/v1",
  apiKey: "sk-test",
  exposeReasoning: true,
  verbose: false,
  userAgent: "mimo2codex/test",
  defaultProviderId: "mimo",
  providers: {
    mimo: {
      baseUrl: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-test",
      flags: { isTokenPlan: false },
    },
    deepseek: null,
  },
  isTokenPlan: false,
  dataDir: "",
  adminEnabled: true,
};

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-admin-test-"));
  openDb(dataDir);
  cfg.dataDir = dataDir;
  server = createServer((req, res) => void handleAdmin(cfg, req, res));
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (addr && typeof addr === "object") port = addr.port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

describe("admin REST", () => {
  it("GET /admin/api/health returns ok + dataDir", async () => {
    const { status, json } = await call("GET", "/admin/api/health");
    expect(status).toBe(200);
    expect((json as { ok: boolean; dataDir: string }).ok).toBe(true);
    expect((json as { dataDir: string }).dataDir).toBe(dataDir);
  });

  it("GET /admin/api/providers returns both providers with enabled flag", async () => {
    const { status, json } = await call("GET", "/admin/api/providers");
    expect(status).toBe(200);
    const list = (json as { providers: Array<{ id: string; enabled: boolean; default: boolean }> }).providers;
    expect(list).toHaveLength(2);
    const mimo = list.find((p) => p.id === "mimo")!;
    expect(mimo.enabled).toBe(true);
    expect(mimo.default).toBe(true);
    const ds = list.find((p) => p.id === "deepseek")!;
    expect(ds.enabled).toBe(false);
  });

  it("GET /admin/api/providers/mimo/models lists builtins", async () => {
    const { status, json } = await call("GET", "/admin/api/providers/mimo/models");
    expect(status).toBe(200);
    const models = (
      json as {
        models: Array<{ upstream_id: string; is_builtin: number; supports_images: number }>;
      }
    ).models;
    expect(models.find((m) => m.upstream_id === "mimo-v2.5-pro")).toBeDefined();
    // Vision-capable models must be registered as identity-resolving builtins
    // so client_model `mimo-v2.5` does not get silently rewritten to
    // `mimo-v2.5-pro` (which would 404 on image input).
    const v25 = models.find((m) => m.upstream_id === "mimo-v2.5");
    expect(v25?.supports_images).toBe(1);
    expect(models.find((m) => m.upstream_id === "mimo-v2.5[1m]")?.supports_images).toBe(1);
    expect(models.find((m) => m.upstream_id === "mimo-v2-omni")?.supports_images).toBe(1);
    // pro/flash must remain non-vision
    expect(models.find((m) => m.upstream_id === "mimo-v2.5-pro")?.supports_images).toBe(0);
    expect(models.find((m) => m.upstream_id === "mimo-v2-flash")?.supports_images).toBe(0);
    expect(models.every((m) => m.is_builtin === 1)).toBe(true);
  });

  it("POST + PATCH + DELETE custom model lifecycle", async () => {
    const created = await call("POST", "/admin/api/providers/deepseek/models", {
      upstream_id: "ds-custom",
      display_name: "Custom",
    });
    expect(created.status).toBe(201);
    const id = (created.json as { model: { id: number } }).model.id;
    const patched = await call("PATCH", `/admin/api/models/${id}`, { display_name: "Patched" });
    expect(patched.status).toBe(200);
    expect((patched.json as { model: { display_name: string } }).model.display_name).toBe("Patched");
    const deleted = await call("DELETE", `/admin/api/models/${id}`);
    expect(deleted.status).toBe(200);
  });

  it("PATCH on a builtin returns 400", async () => {
    const list = await call("GET", "/admin/api/providers/mimo/models");
    const id = (list.json as { models: Array<{ id: number; is_builtin: number }> }).models.find(
      (m) => m.is_builtin === 1
    )!.id;
    const patched = await call("PATCH", `/admin/api/models/${id}`, { display_name: "x" });
    expect(patched.status).toBe(400);
  });

  it("GET /admin/api/logs returns inserted entries", async () => {
    insertLog({
      ts: Date.now(), request_id: "r1", provider_id: "mimo",
      client_model: "mimo-v2.5-pro", upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses", status_code: 200, duration_ms: 12,
      prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
      stream: false, error_code: null, error_snippet: null,
    });
    const { status, json } = await call("GET", "/admin/api/logs");
    expect(status).toBe(200);
    const logs = (json as { logs: Array<{ provider_id: string }> }).logs;
    expect(logs).toHaveLength(1);
    expect(logs[0].provider_id).toBe("mimo");
  });

  it("GET /admin/api/stats?range=24h returns aggregated tokens", async () => {
    const now = Date.now();
    insertLog({
      ts: now, request_id: null, provider_id: "mimo",
      client_model: "mimo-v2.5-pro", upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses", status_code: 200, duration_ms: 1,
      prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
      stream: false, error_code: null, error_snippet: null,
    });
    const { status, json } = await call("GET", "/admin/api/stats?range=24h");
    expect(status).toBe(200);
    const rows = (json as { rows: Array<{ total_tokens: number }> }).rows;
    expect(rows[0].total_tokens).toBe(150);
  });

  it("GET /admin/api/mappings returns deduplicated client→upstream pairs", async () => {
    const now = Date.now();
    insertLog({
      ts: now, request_id: null, provider_id: "mimo",
      client_model: "alias", upstream_model: "mimo-v2.5-pro",
      endpoint: "/v1/responses", status_code: 200, duration_ms: 1,
      prompt_tokens: null, completion_tokens: null, total_tokens: null,
      stream: false, error_code: null, error_snippet: null,
    });
    const { status, json } = await call("GET", "/admin/api/mappings");
    expect(status).toBe(200);
    const m = (json as { mappings: Array<{ client_model: string; count: number }> }).mappings;
    expect(m).toHaveLength(1);
    expect(m[0].client_model).toBe("alias");
  });

  it("PUT /admin/api/settings/api_key is forbidden", async () => {
    const r = await call("PUT", "/admin/api/settings/api_key", { value: "sk-x" });
    expect(r.status).toBe(400);
    const code = (r.json as { error: { code: string } }).error.code;
    expect(code).toBe("forbidden_setting");
  });

  it("PUT/GET /admin/api/settings/* round-trips a regular key", async () => {
    const put = await call("PUT", "/admin/api/settings/ui.theme", { value: "dark" });
    expect(put.status).toBe(200);
    const get = await call("GET", "/admin/api/settings");
    expect(get.status).toBe(200);
    expect((get.json as { settings: Record<string, string> }).settings["ui.theme"]).toBe("dark");
  });

  it("aliases POST + GET + DELETE round-trip", async () => {
    const post = await call("POST", "/admin/api/aliases", {
      alias: "fast", provider_id: "mimo", upstream_id: "mimo-v2-flash",
    });
    expect(post.status).toBe(201);
    const list = await call("GET", "/admin/api/aliases");
    expect(
      (list.json as { aliases: Array<{ alias: string }> }).aliases.find((a) => a.alias === "fast")
    ).toBeDefined();
    const del = await call("DELETE", "/admin/api/aliases/fast");
    expect(del.status).toBe(200);
  });

  it("404 for unknown admin path", async () => {
    const r = await call("GET", "/admin/api/nope");
    expect(r.status).toBe(404);
  });
});
