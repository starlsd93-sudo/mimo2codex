import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import { PROVIDER_LIST, PROVIDERS } from "../providers/registry.js";
import {
  aggregateMappings,
  aggregateStats,
  aggregateTokensTimeseries,
  deleteLogsBefore,
  getLogById,
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
import { buildSnippetBundle, resolveSnippetTarget, tomlProviderKeyFor } from "../setup/snippets.js";
import {
  GenericLoaderError,
  locateProvidersFile,
  readSpecsFromFile,
  writeSpecsToFile,
} from "../providers/genericLoader.js";
import type { GenericProviderSpec } from "../providers/generic.js";
import { applyCodex, readCodexState, restoreCodex } from "../codex/state.js";
import {
  clearActiveOverride,
  getActiveOverride,
  setActiveOverride,
} from "../db/overrides.js";

// Locate dist/web/ relative to THIS module's location, not process.cwd().
// When mimo2codex is installed globally (`npm install -g`), the user invokes
// it from any working directory, so cwd is never the install root.
//
// Two layouts to support:
//   - production (`node dist/cli.js`):   <root>/dist/admin/router.js → ../web
//   - dev mode (`tsx src/cli.ts`):       <root>/src/admin/router.ts  → ../../dist/web
//
// The list is checked in order; whichever exists wins. If neither exists we
// fall back to the production path for the 503 message — that's the path the
// user is most likely meant to populate via `npm run web:build`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STATIC_ROOT = (() => {
  const candidates = [
    resolve(__dirname, "..", "web"),                  // dist/admin → dist/web
    resolve(__dirname, "..", "..", "dist", "web"),    // src/admin  → dist/web
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
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
    // userAgent is "mimo2codex/<version>"; split out the version part for
    // the footer (cli.ts is the only place that has the package.json version
    // and it stashes it on cfg.userAgent during startup).
    const version = cfg.userAgent.startsWith("mimo2codex/")
      ? cfg.userAgent.slice("mimo2codex/".length)
      : cfg.userAgent;
    return sendJson(res, 200, { ok: true, dataDir: cfg.dataDir, version });
  }

  if (req.method === "GET" && pathname === "/admin/api/providers") {
    return sendJson(res, 200, { providers: providerStateFor(cfg) });
  }

  // GET /admin/api/generic-providers
  // Returns the raw spec list from providers.json + metadata about where
  // the file lives. The admin UI uses this to populate its editor.
  if (req.method === "GET" && pathname === "/admin/api/generic-providers") {
    const loc = locateProvidersFile(process.env, cfg.dataDir);
    if (!loc) {
      // dataDir is unset (admin runs without persistence) — no canonical
      // path to edit. UI surfaces this as a read-only banner.
      return sendJson(res, 200, {
        specs: [],
        path: null,
        source: null,
        exists: false,
        editable: false,
        notice:
          "no providers.json location available — admin UI cannot edit when --no-admin is set",
      });
    }
    let specs: GenericProviderSpec[] = [];
    if (loc.exists) {
      try {
        specs = readSpecsFromFile(loc.path);
      } catch (err) {
        if (err instanceof GenericLoaderError) {
          return sendJson(res, 200, {
            specs: [],
            path: loc.path,
            source: loc.source,
            exists: true,
            editable: true,
            error: err.message,
          });
        }
        throw err;
      }
    }
    return sendJson(res, 200, {
      specs,
      path: loc.path,
      source: loc.source,
      exists: loc.exists,
      editable: true,
    });
  }

  // PUT /admin/api/generic-providers
  // Body: { providers: GenericProviderSpec[] }
  // Validates every spec, then atomically writes to providers.json. A
  // restart is still required for the change to take effect (the in-memory
  // registry is initialized once at startup).
  if (req.method === "PUT" && pathname === "/admin/api/generic-providers") {
    const loc = locateProvidersFile(process.env, cfg.dataDir);
    if (!loc) {
      return sendError(
        res,
        400,
        "no_writable_location",
        "no providers.json path is available — set MIMO2CODEX_DATA_DIR or restart without --no-admin"
      );
    }
    let body: { providers?: unknown };
    try {
      body = await readJsonBody<{ providers?: unknown }>(req);
    } catch (err) {
      return sendError(res, 400, "invalid_json", (err as Error).message);
    }
    if (!Array.isArray(body.providers)) {
      return sendError(res, 400, "invalid_body", "body must include providers: array");
    }
    try {
      writeSpecsToFile(loc.path, body.providers as GenericProviderSpec[]);
    } catch (err) {
      if (err instanceof GenericLoaderError) {
        return sendError(res, 400, "validation_failed", err.message);
      }
      return sendError(res, 500, "write_failed", (err as Error).message);
    }
    log.info(
      `providers.json updated via admin UI (${(body.providers as unknown[]).length} entries, restart required)`
    );
    return sendJson(res, 200, {
      ok: true,
      path: loc.path,
      restartRequired: true,
    });
  }

  // GET /admin/api/setup-snippets?provider=<id>
  // Returns every Codex-integration snippet variant (default auth.json,
  // env-key, cc-switch) so the Setup page can render all three tabs in one
  // round-trip. When `provider` is omitted, defaults to the configured
  // default provider — same fallback the CLI uses.
  if (req.method === "GET" && pathname === "/admin/api/setup-snippets") {
    const hint = query.get("provider") ?? cfg.defaultProviderId;
    const bundle = buildSnippetBundle(hint, { host: cfg.host, port: cfg.port });
    return sendJson(res, 200, {
      bundle,
      defaultProviderId: cfg.defaultProviderId,
      providers: PROVIDER_LIST.map((p) => ({
        id: p.id,
        shortcut: p.shortcut,
        display_name: p.displayName,
      })),
    });
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

  // /admin/api/logs/:id — single log row including request_body + response_body.
  // Kept off the list endpoint so a 100-row table fetch doesn't haul megabytes
  // of payload across the wire on every refresh.
  const logIdMatch = pathname.match(/^\/admin\/api\/logs\/(\d+)$/);
  if (logIdMatch && req.method === "GET") {
    const id = Number(logIdMatch[1]);
    const row = getLogById(id);
    if (!row) return sendError(res, 404, "not_found", `log ${id} not found`);
    return sendJson(res, 200, { log: row });
  }

  if (req.method === "GET" && pathname === "/admin/api/mappings") {
    return sendJson(res, 200, { mappings: aggregateMappings() });
  }

  if (req.method === "GET" && pathname === "/admin/api/stats") {
    const range = query.get("range") ?? "24h";
    return sendJson(res, 200, aggregateStats(range));
  }

  // Per-bucket token timeseries for the dashboard chart. Dense (every
  // bucket in the window appears in `buckets`, zero-filled). Bucket size
  // is `?bucket=day` (default) or `?bucket=hour`.
  if (req.method === "GET" && pathname === "/admin/api/stats/timeseries") {
    const range = query.get("range") ?? "7d";
    const bucketParam = query.get("bucket");
    const bucket = bucketParam === "hour" ? "hour" : "day";
    return sendJson(res, 200, aggregateTokensTimeseries(range, bucket));
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

  // ──────────── Codex 启用 (replaces ccswitch) ────────────
  //
  // codex-state: read-only snapshot of ~/.codex/ ownership + backup list +
  // active runtime override. UI reads this on every page load so it can
  // surface the right warnings (e.g. "your auth.json has a real OpenAI key,
  // overwriting will back it up").
  if (req.method === "GET" && pathname === "/admin/api/codex-state") {
    const state = readCodexState();
    return sendJson(res, 200, {
      ...state,
      activeOverride: getActiveOverride(),
    });
  }

  // codex-targets: aggregated (provider × model) pickable from the UI.
  // Built-in models come from PROVIDER_LIST; custom models come from the
  // sqlite models table. We surface hasKey so the UI can disable the
  // runtime-override button on providers without an api key (the file-write
  // button is fine without a key — the user might be setting up first).
  if (req.method === "GET" && pathname === "/admin/api/codex-targets") {
    const state = readCodexState();
    const override = getActiveOverride();
    const targets: Array<Record<string, unknown>> = [];
    for (const p of PROVIDER_LIST) {
      const runtime = cfg.providers[p.id];
      // Built-in catalog (declared by Provider.builtinModels).
      for (const m of p.builtinModels) {
        if (m.deprecatedAfter) continue;
        targets.push({
          providerId: p.id,
          providerDisplayName: p.displayName,
          providerKey: tomlProviderKeyFor(p.id),
          modelId: m.id,
          displayName: m.displayName ?? null,
          contextWindow: m.contextWindow ?? null,
          maxOutputTokens: m.maxOutputTokens ?? null,
          source: "builtin",
          hasKey: !!runtime,
          isCurrentOverride:
            override?.providerId === p.id && override?.modelId === m.id,
        });
      }
      // Custom models from the admin's models table — only when admin/db
      // is up (we're inside the admin router, so it is).
      try {
        const customRows = listModels(p.id);
        for (const row of customRows) {
          if (row.is_builtin === 1) continue; // dedup against builtinModels above
          targets.push({
            providerId: p.id,
            providerDisplayName: p.displayName,
            providerKey: tomlProviderKeyFor(p.id),
            modelId: row.upstream_id,
            displayName: row.display_name ?? null,
            contextWindow: row.context_window ?? null,
            maxOutputTokens: null,
            source: "custom",
            hasKey: !!runtime,
            isCurrentOverride:
              override?.providerId === p.id && override?.modelId === row.upstream_id,
          });
        }
      } catch {
        // listModels needs db open; skip silently if it's not.
      }
    }
    return sendJson(res, 200, {
      targets,
      activeOverride: override,
      authJsonOwner: state.authJsonOwner,
    });
  }

  // codex-apply: write ~/.codex/auth.json + config.toml for (provider, model).
  // Replaces ccswitch. The user must restart Codex for changes to take effect.
  if (req.method === "POST" && pathname === "/admin/api/codex-apply") {
    let body: { providerId?: unknown; modelId?: unknown };
    try {
      body = await readJsonBody<{ providerId?: unknown; modelId?: unknown }>(req);
    } catch (err) {
      return sendError(res, 400, "invalid_json", (err as Error).message);
    }
    if (typeof body.providerId !== "string" || typeof body.modelId !== "string") {
      return sendError(res, 400, "invalid_body", "providerId and modelId must be strings");
    }
    if (!isProviderId(body.providerId)) {
      return sendError(res, 400, "unknown_provider", `unknown provider ${body.providerId}`);
    }
    const provider = PROVIDERS[body.providerId];
    // Validate the model exists in either the built-in catalog or the
    // custom-models table. Forwarding an arbitrary unknown id would write
    // a config Codex can't actually use.
    const builtinHit = provider.builtinModels.some((m) => m.id === body.modelId);
    let customHit = false;
    if (!builtinHit) {
      try {
        customHit = listModels(provider.id).some((r) => r.upstream_id === body.modelId);
      } catch {
        /* db not open — only built-in validation available */
      }
    }
    if (!builtinHit && !customHit) {
      return sendError(
        res,
        400,
        "unknown_model",
        `model "${body.modelId}" is not in ${provider.id}'s catalog`
      );
    }
    // Build the SnippetTarget the writer expects. Reuse resolveSnippetTarget
    // for the default, then override modelId so we honor the user's pick.
    const baseTarget = resolveSnippetTarget(body.providerId);
    const targetModelMeta = provider.builtinModels.find((m) => m.id === body.modelId);
    const target = {
      ...baseTarget,
      modelId: body.modelId,
      contextWindow: targetModelMeta?.contextWindow ?? baseTarget.contextWindow,
      maxOutputTokens: targetModelMeta?.maxOutputTokens ?? baseTarget.maxOutputTokens,
    };
    try {
      const result = applyCodex(target, { host: cfg.host, port: cfg.port });
      log.info(
        `codex profile applied via webui: provider=${provider.id} model=${body.modelId} ` +
          `authJsonOwnerBefore=${result.authJsonOwnerBefore} backupTs=${result.backupTs}`
      );
      return sendJson(res, 200, {
        ok: true,
        backupTs: result.backupTs,
        authBackup: result.authBackup,
        tomlBackup: result.tomlBackup,
        authJsonOwnerBefore: result.authJsonOwnerBefore,
        restartRequired: true,
      });
    } catch (err) {
      log.error("codex-apply failed", { error: (err as Error).message });
      return sendError(res, 500, "apply_failed", (err as Error).message);
    }
  }

  // codex-restore: undo a previous apply by restoring both files from a
  // paired backup. ts comes from /codex-state.backups.
  if (req.method === "POST" && pathname === "/admin/api/codex-restore") {
    let body: { ts?: unknown };
    try {
      body = await readJsonBody<{ ts?: unknown }>(req);
    } catch (err) {
      return sendError(res, 400, "invalid_json", (err as Error).message);
    }
    if (typeof body.ts !== "number" || !Number.isFinite(body.ts)) {
      return sendError(res, 400, "invalid_body", "ts must be a number");
    }
    try {
      restoreCodex(body.ts);
      log.info(`codex profile restored from backup ts=${body.ts}`);
      return sendJson(res, 200, { ok: true, restartRequired: true });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg.includes("no backup pair")
        ? "not_found"
        : msg.includes("incomplete")
          ? "incomplete_pair"
          : "restore_failed";
      const status = code === "not_found" ? 404 : 400;
      return sendError(res, status, code, msg);
    }
  }

  // active-override: runtime model override stored in settings DB. Pass-0
  // of selectProvider() honors it before any normal routing logic.
  if (req.method === "GET" && pathname === "/admin/api/active-override") {
    return sendJson(res, 200, { override: getActiveOverride() });
  }
  if (req.method === "PUT" && pathname === "/admin/api/active-override") {
    let body: { providerId?: unknown; modelId?: unknown };
    try {
      body = await readJsonBody<{ providerId?: unknown; modelId?: unknown }>(req);
    } catch (err) {
      return sendError(res, 400, "invalid_json", (err as Error).message);
    }
    if (typeof body.providerId !== "string" || typeof body.modelId !== "string") {
      return sendError(res, 400, "invalid_body", "providerId and modelId must be strings");
    }
    if (!isProviderId(body.providerId)) {
      return sendError(res, 400, "unknown_provider", `unknown provider ${body.providerId}`);
    }
    // Require the provider to have a runtime (api key); without it the
    // override would be silently ignored at request time and the user
    // would think the switch worked.
    if (!cfg.providers[body.providerId]) {
      return sendError(
        res,
        400,
        "provider_has_no_key",
        `provider ${body.providerId} has no api key configured — override would have no effect`
      );
    }
    setActiveOverride(body.providerId, body.modelId);
    log.info(`active override set: provider=${body.providerId} model=${body.modelId}`);
    return sendJson(res, 200, { override: { providerId: body.providerId, modelId: body.modelId } });
  }
  if (req.method === "DELETE" && pathname === "/admin/api/active-override") {
    clearActiveOverride();
    log.info("active override cleared");
    return sendJson(res, 200, { deleted: true });
  }

  return sendError(res, 404, "not_found", `no admin route for ${req.method} ${pathname}`);
}

function serveStatic(res: ServerResponse, pathname: string): void {
  if (!existsSync(STATIC_ROOT)) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(
      `Admin UI not built. Expected static bundle at ${STATIC_ROOT}.\n` +
        "Run `npm run web:build` (or `npm run build:all`) to populate dist/web/.\n"
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
