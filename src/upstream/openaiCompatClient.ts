import type { ChatRequest, ResponsesRequest } from "../translate/types.js";
import { log, redactKey } from "../util/log.js";
import type { ProviderEnhancedError } from "../providers/types.js";
import { detectContextOverflow } from "./contextOverflow.js";

export type ContextOverflowMode = "friendly" | "passthrough";

export interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  userAgent: string;
  enhanceError?: (ctx: { status: number; snippet?: string }) => ProviderEnhancedError | null;
  // When set to "friendly" (default), upstream 400 responses that look like
  // context-window overflows are rewritten to a structured bilingual message
  // guiding the user to run /compact in codex. "passthrough" preserves the
  // raw upstream error verbatim.
  contextOverflowMode?: ContextOverflowMode;
  // Routed model metadata, used to enrich the friendly overflow message with
  // the upstream model id and its context-window cap.
  modelInfo?: { id: string; contextWindow?: number };
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export class UpstreamError extends Error {
  status: number;
  bodySnippet?: string;
  code: string;

  constructor(opts: { status: number; message: string; code: string; bodySnippet?: string }) {
    super(opts.message);
    this.name = "UpstreamError";
    this.status = opts.status;
    this.code = opts.code;
    this.bodySnippet = opts.bodySnippet;
  }
}

function buildUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${normalizedPath}`;
}

function authHeader(apiKey: string): Record<string, string> {
  // Both MiMo and DeepSeek accept the OpenAI-style Bearer scheme, which is
  // also more universally supported by intermediaries than the api-key header.
  return { Authorization: `Bearer ${apiKey}` };
}

async function readSnippet(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    return text.length > 800 ? `${text.slice(0, 800)}…` : text;
  } catch {
    return undefined;
  }
}

// Native fetch surfaces a generic "fetch failed" Error; the actionable detail
// (ECONNREFUSED / ENOTFOUND / ETIMEDOUT / EHOSTUNREACH, plus the address that
// failed) lives on err.cause from undici. Expose both so logs and the 502
// payload can name the underlying cause — critical for proxy / network bugs.
interface FetchErrorDetail {
  error: string;
  cause?: string;
  code?: string;
}
function describeFetchError(err: unknown): FetchErrorDetail {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  return {
    error: e.message,
    cause: e.cause?.message,
    code: e.cause?.code,
  };
}

function defaultErrorCode(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_denied";
  if (status === 429) return "rate_limit_exceeded";
  if (status >= 500) return "server_error";
  return "bad_request";
}

export async function callOpenAICompat(
  cfg: UpstreamConfig,
  body: ChatRequest,
  signal: AbortSignal
): Promise<Response> {
  return await postUpstream(cfg, "/chat/completions", body, signal, {
    summary: {
      model: body.model,
      stream: !!body.stream,
      messages: body.messages.length,
      tools: body.tools?.length ?? 0,
    },
    streaming: !!body.stream,
  });
}

// Direct Responses-API passthrough. Used when Provider.wireApi === "responses"
// — the body is sent untouched to the upstream's /v1/responses endpoint.
// Lets generic providers that natively speak the Codex Responses API skip
// the Chat-Completions translation round-trip.
export async function callResponsesPassthrough(
  cfg: UpstreamConfig,
  body: ResponsesRequest,
  signal: AbortSignal
): Promise<Response> {
  return await postUpstream(cfg, "/responses", body, signal, {
    summary: {
      model: body.model,
      stream: !!body.stream,
      inputItems: Array.isArray(body.input) ? body.input.length : 0,
      tools: body.tools?.length ?? 0,
    },
    streaming: !!body.stream,
  });
}

async function postUpstream(
  cfg: UpstreamConfig,
  path: string,
  body: unknown,
  signal: AbortSignal,
  meta: { summary: Record<string, unknown>; streaming: boolean }
): Promise<Response> {
  const url = buildUrl(cfg.baseUrl, path);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: meta.streaming ? "text/event-stream" : "application/json",
    "User-Agent": cfg.userAgent,
    ...authHeader(cfg.apiKey),
  };

  log.debug(`upstream POST ${url}`, { ...meta.summary, apiKey: redactKey(cfg.apiKey) });
  log.debug("upstream POST body", body);

  const attempt = async (): Promise<Response> => {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    return res;
  };

  let res: Response;
  try {
    res = await attempt();
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    log.warn("upstream connect failed, retrying once", describeFetchError(err));
    try {
      res = await attempt();
    } catch (err2) {
      const detail = describeFetchError(err2);
      throw new UpstreamError({
        status: 502,
        code: "upstream_unreachable",
        message: detail.code
          ? `failed to reach upstream: ${detail.error} (${detail.code}${detail.cause ? `: ${detail.cause}` : ""})`
          : `failed to reach upstream: ${detail.error}`,
      });
    }
  }

  if (!res.ok) {
    const snippet = await readSnippet(res);
    // Provider-specific enhancement runs first so dedicated rules (e.g. MiMo's
    // "webSearchEnabled is false" hint) keep winning over the generic
    // context-overflow detector below.
    let enhanced = cfg.enhanceError?.({ status: res.status, snippet });
    if (!enhanced && (cfg.contextOverflowMode ?? "friendly") === "friendly") {
      enhanced = detectContextOverflow({
        status: res.status,
        snippet,
        modelId: cfg.modelInfo?.id,
        contextWindow: cfg.modelInfo?.contextWindow,
      });
    }
    const code = enhanced?.code ?? defaultErrorCode(res.status);
    const message = enhanced?.message ?? `upstream returned ${res.status}: ${snippet ?? "(no body)"}`;
    if (enhanced) {
      log.warn(enhanced.message);
    }
    throw new UpstreamError({
      status: res.status,
      code,
      message,
      bodySnippet: snippet,
    });
  }

  return res;
}
