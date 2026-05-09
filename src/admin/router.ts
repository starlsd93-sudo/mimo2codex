import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { Config } from "../config.js";
import { PROVIDER_LIST } from "../providers/registry.js";
import {
  aggregateMappings,
  aggregateStats,
  deleteLogsBefore,
  queryLogs,
} from "../db/logs.js";
import {
  deleteModel,
  insertCustomModel,
  listAliases,
  listModels,
  patchModel,
  upsertAlias,
  deleteAlias,
} from "../db/models.js";
import {
  deleteSetting,
  ForbiddenSettingError,
  isForbiddenSettingKey,
  listSettings,
  setSetting,
} from "../db/settings.js";
import type { ProviderId } from "../providers/types.js";
import { isProviderId } from "../providers/registry.js";
import { log } from "../util/log.js";

const STATIC_ROOT = (() => {
  // dist/web/ is created when `web/` is built (vite.config.ts → outDir).
  // tsc separately writes the admin handler bundle to dist/admin/, so the two
  // paths cannot be the same — that's why the static root lives under
  // dist/web/ rather than dist/admin/.
  const candidate = resolve(process.cwd(), "dist", "web");
  return candidate;
})();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message, status } });
}

async function readJsonBody<T>(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error("admin body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        if (!text) return resolve({} as T);
        resolve(JSON.parse(text) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function parseUrl(req: IncomingMessage): { pathname: string; query: URLSearchParams } {
  const u = new URL(req.url ?? "/", "http://localhost");
  return { pathname: u.pathname, query: u.searchParams };
}

function providerStateFor(cfg: Config): Array<Record<string, unknown>> {
  return PROVIDER_LIST.map((p) => {
    const runtime = cfg.providers[p.id];
    return {
      id: p.id,
      shortcut: p.shortcut,
      display_name: p.displayName,
      default: cfg.defaultProviderId === p.id,
      enabled: !!runtime,
      api_key_present: !!runtime,
      api_key_env: p.envKeys,
      base_url: runtime?.baseUrl ?? p.defaultBaseUrl,
      default_model: p.defaultModel,
      flags: runtime?.flags ?? {},
    };
  });
}

interface RouteContext {
  cfg: Config;
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  query: URLSearchParams;
}

async function handleApi(ctx: RouteContext): Promise<void> {
  const { cfg, req, res, pathname, query } = ctx;

  // GET /admin/api/health — quick liveness probe for the UI
  if (req.method === "GET" && pathname === "/admin/api/health") {
    return sendJson(res, 200, { ok: true, dataDir: cfg.dataDir });
  }

  if (req.method === "GET" && pathname === "/admin/api/providers") {
    return sendJson(res, 200, { providers: providerStateFor(cfg) });
  }

  // /admin/api/providers/:id/models
  const provModels = pathname.match(/^\/admin\/api\/providers\/([^/]+)\/models$/);
  if (provModels) {
    const id = provModels[1];
    if (!isProviderId(id)) return sendError(res, 404, "unknown_provider", `unknown provider ${id}`);
    if (req.method === "GET") {
      return sendJson(res, 200, { models: listModels(id) });
    }
    if (req.method === "POST") {
      const body = await readJsonBody<Partial<{ upstream_id: string; display_name: string }>>(req);
      if (!body.upstream_id) return sendError(res, 400, "missing_upstream_id", "upstream_id required");
      try {
        const row = insertCustomModel(id as ProviderId, {
          upstream_id: body.upstream_id,
          display_name: body.display_name,
        });
        return sendJson(res, 201, { model: row });
      } catch (err) {
        return sendError(res, 400, "insert_failed", (err as Error).message);
      }
    }
    return sendError(res, 405, "method_not_allowed", "use GET or POST");
  }

  // /admin/api/models/:id
  const modelId = pathname.match(/^\/admin\/api\/models\/(\d+)$/);
  if (modelId) {
    const id = Number(modelId[1]);
    if (req.method === "PATCH") {
      const body = await readJsonBody<Record<string, unknown>>(req);
      try {
        const row = patchModel(id, body);
        if (!row) return sendError(res, 404, "not_found", `model ${id} not found`);
        return sendJson(res, 200, { model: row });
      } catch (err) {
        return sendError(res, 400, "patch_failed", (err as Error).message);
      }
    }
    if (req.method === "DELETE") {
      try {
        const ok = deleteModel(id);
        if (!ok) return sendError(res, 404, "not_found", `model ${id} not found`);
        return sendJson(res, 200, { deleted: true });
      } catch (err) {
        return sendError(res, 400, "delete_failed", (err as Error).message);
      }
    }
    return sendError(res, 405, "method_not_allowed", "use PATCH or DELETE");
  }

  if (pathname === "/admin/api/aliases") {
    if (req.method === "GET") {
      return sendJson(res, 200, { aliases: listAliases() });
    }
    if (req.method === "POST") {
      const body = await readJsonBody<{ alias?: string; provider_id?: string; upstream_id?: string }>(req);
      if (!body.alias || !body.provider_id || !body.upstream_id) {
        return sendError(res, 400, "missing_fields", "alias, provider_id and upstream_id required");
      }
      if (!isProviderId(body.provider_id)) {
        return sendError(res, 400, "unknown_provider", `unknown provider ${body.provider_id}`);
      }
      upsertAlias({
        alias: body.alias,
        provider_id: body.provider_id,
        upstream_id: body.upstream_id,
      });
      return sendJson(res, 201, { alias: body.alias });
    }
    return sendError(res, 405, "method_not_allowed", "use GET or POST");
  }

  const aliasMatch = pathname.match(/^\/admin\/api\/aliases\/(.+)$/);
  if (aliasMatch && req.method === "DELETE") {
    const alias = decodeURIComponent(aliasMatch[1]);
    const ok = deleteAlias(alias);
    if (!ok) return sendError(res, 404, "not_found", `alias ${alias} not found`);
    return sendJson(res, 200, { deleted: true });
  }

  if (req.method === "GET" && pathname === "/admin/api/logs") {
    const provider = query.get("provider") ?? undefined;
    const from = query.get("from") ? Number(query.get("from")) : undefined;
    const to = query.get("to") ? Number(query.get("to")) : undefined;
    const limit = query.get("limit") ? Number(query.get("limit")) : undefined;
    const offset = query.get("offset") ? Number(query.get("offset")) : undefined;
    return sendJson(res, 200, { logs: queryLogs({ provider, from, to, limit, offset }) });
  }

  if (req.method === "DELETE" && pathname === "/admin/api/logs") {
    const before = query.get("before");
    if (!before) return sendError(res, 400, "missing_before", "?before=<ts_ms> required");
    const removed = deleteLogsBefore(Number(before));
    return sendJson(res, 200, { removed });
  }

  if (req.method === "GET" && pathname === "/admin/api/mappings") {
    return sendJson(res, 200, { mappings: aggregateMappings() });
  }

  if (req.method === "GET" && pathname === "/admin/api/stats") {
    const range = query.get("range") ?? "24h";
    return sendJson(res, 200, aggregateStats(range));
  }

  if (req.method === "GET" && pathname === "/admin/api/settings") {
    return sendJson(res, 200, { settings: listSettings() });
  }

  const settingKey = pathname.match(/^\/admin\/api\/settings\/([^/]+)$/);
  if (settingKey) {
    const key = decodeURIComponent(settingKey[1]);
    if (req.method === "PUT") {
      if (isForbiddenSettingKey(key)) {
        return sendError(
          res,
          400,
          "forbidden_setting",
          `${key} cannot be stored in the UI — set the corresponding env var instead (MIMO_API_KEY, DS_API_KEY, DEEPSEEK_API_KEY) and restart mimo2codex.`
        );
      }
      const body = await readJsonBody<{ value?: unknown }>(req);
      if (typeof body.value !== "string") {
        return sendError(res, 400, "invalid_value", "value must be a string");
      }
      try {
        setSetting(key, body.value);
        return sendJson(res, 200, { key, value: body.value });
      } catch (err) {
        if (err instanceof ForbiddenSettingError) {
          return sendError(res, 400, "forbidden_setting", err.message);
        }
        throw err;
      }
    }
    if (req.method === "DELETE") {
      const ok = deleteSetting(key);
      if (!ok) return sendError(res, 404, "not_found", `setting ${key} not found`);
      return sendJson(res, 200, { deleted: true });
    }
    return sendError(res, 405, "method_not_allowed", "use PUT or DELETE");
  }

  return sendError(res, 404, "not_found", `no admin route for ${req.method} ${pathname}`);
}

function serveStatic(res: ServerResponse, pathname: string): void {
  if (!existsSync(STATIC_ROOT)) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(
      "Admin UI not built. Run `npm run web:build` (or `npm run build:all`) to populate dist/admin/.\n"
    );
    return;
  }
  // Strip /admin prefix.
  const rel = pathname.replace(/^\/admin\/?/, "") || "index.html";
  const safe = normalize(rel).replace(/^[/\\]+/, "");
  if (safe.includes("..")) {
    res.statusCode = 400;
    res.end("bad path");
    return;
  }
  let filePath = join(STATIC_ROOT, safe);
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath)) {
    // SPA fallback
    filePath = join(STATIC_ROOT, "index.html");
    if (!existsSync(filePath)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
  }
  const ct = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", ct);
  res.end(readFileSync(filePath));
}

export async function handleAdmin(
  cfg: Config,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const { pathname, query } = parseUrl(req);
  try {
    if (pathname.startsWith("/admin/api/")) {
      await handleApi({ cfg, req, res, pathname, query });
      return;
    }
    if (req.method === "GET" && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
      serveStatic(res, pathname);
      return;
    }
    sendError(res, 404, "not_found", `no admin route for ${req.method} ${pathname}`);
  } catch (err) {
    log.error("admin handler error", { error: (err as Error).message, stack: (err as Error).stack });
    if (!res.headersSent) sendError(res, 500, "internal_error", (err as Error).message);
  }
}
