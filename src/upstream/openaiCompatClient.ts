import type { ChatRequest } from "../translate/types.js";
import { log, redactKey } from "../util/log.js";
import type { ProviderEnhancedError } from "../providers/types.js";

export interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  userAgent: string;
  enhanceError?: (ctx: { status: number; snippet?: string }) => ProviderEnhancedError | null;
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

function buildUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
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
  const url = buildUrl(cfg.baseUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: body.stream ? "text/event-stream" : "application/json",
    "User-Agent": cfg.userAgent,
    ...authHeader(cfg.apiKey),
  };

  log.debug(`upstream POST ${url}`, {
    model: body.model,
    stream: !!body.stream,
    messages: body.messages.length,
    tools: body.tools?.length ?? 0,
    apiKey: redactKey(cfg.apiKey),
  });
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
    log.warn("upstream connect failed, retrying once", { error: (err as Error).message });
    try {
      res = await attempt();
    } catch (err2) {
      throw new UpstreamError({
        status: 502,
        code: "upstream_unreachable",
        message: `failed to reach upstream: ${(err2 as Error).message}`,
      });
    }
  }

  if (!res.ok) {
    const snippet = await readSnippet(res);
    const enhanced = cfg.enhanceError?.({ status: res.status, snippet });
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
