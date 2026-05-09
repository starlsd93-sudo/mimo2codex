import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import { respToResponses } from "./translate/respToResponses.js";
import { pipeChatStreamToResponses } from "./translate/streamToSse.js";
import { iterChatStreamChunks } from "./upstream/chatStream.js";
import { callOpenAICompat, UpstreamError } from "./upstream/openaiCompatClient.js";
import { byClientModel, PROVIDER_LIST, PROVIDERS } from "./providers/registry.js";
import type { Provider, ProviderRuntime } from "./providers/types.js";
import { makeServerResponseSink } from "./util/sse.js";
import { log } from "./util/log.js";
import type { ChatRequest, ChatResponse, ChatUsage, ResponsesRequest } from "./translate/types.js";
import { handleAdmin } from "./admin/router.js";
import { insertLog, type ChatLogEntry } from "./db/logs.js";

const KEEPALIVE_INTERVAL_MS = 15_000;

async function readJsonBody<T>(req: IncomingMessage, maxBytes = 16 * 1024 * 1024): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function errorEnvelope(status: number, code: string, message: string): {
  error: { type: string; code: string; message: string; status: number };
} {
  return {
    error: {
      type:
        status === 401
          ? "authentication_error"
          : status === 429
            ? "rate_limit_exceeded"
            : status >= 500
              ? "server_error"
              : "invalid_request_error",
      code,
      message,
      status,
    },
  };
}

interface SelectedProvider {
  provider: Provider;
  runtime: ProviderRuntime;
  upstreamModel: string;
}

function recordLog(cfg: Config, entry: Omit<ChatLogEntry, "ts">): void {
  if (!cfg.adminEnabled) return;
  const ts = Date.now();
  setImmediate(() => {
    try {
      insertLog({ ...entry, ts });
    } catch (err) {
      log.warn("chat_logs insert failed", { error: (err as Error).message });
    }
  });
}

function usageFromChatResponse(u: ChatUsage | undefined): {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
} {
  if (!u) return { prompt_tokens: null, completion_tokens: null, total_tokens: null };
  return {
    prompt_tokens: u.prompt_tokens ?? null,
    completion_tokens: u.completion_tokens ?? null,
    total_tokens: u.total_tokens ?? null,
  };
}

// Route a request to a provider based on the client-supplied model field:
//   1. If the model matches an enabled non-default provider's catalog → switch.
//   2. Otherwise use the configured default provider; the body.model is
//      rewritten to the default provider's defaultModel so we never forward
//      an unknown id (which would 400 at the upstream).
function selectProvider(clientModel: string, cfg: Config): SelectedProvider {
  const matched = byClientModel(clientModel);
  if (matched && cfg.providers[matched.id]) {
    const resolved = matched.resolveModel(clientModel);
    return {
      provider: matched,
      runtime: cfg.providers[matched.id]!,
      upstreamModel: resolved?.id ?? matched.defaultModel,
    };
  }
  const provider = PROVIDERS[cfg.defaultProviderId];
  const runtime = cfg.providers[cfg.defaultProviderId];
  if (!runtime) {
    throw new Error(`provider ${cfg.defaultProviderId} has no runtime (missing api key)`);
  }
  // Unknown model → use the default provider's defaultModel so we don't pass
  // a foreign id to the upstream.
  const resolved = provider.resolveModel(clientModel);
  return {
    provider,
    runtime,
    upstreamModel: resolved?.id ?? provider.defaultModel,
  };
}

async function handleResponses(
  cfg: Config,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let payload: ResponsesRequest;
  try {
    payload = await readJsonBody<ResponsesRequest>(req);
  } catch (err) {
    return sendJson(
      res,
      400,
      errorEnvelope(400, "invalid_json", `failed to parse request body: ${(err as Error).message}`)
    );
  }
  if (!payload.model) {
    return sendJson(
      res,
      400,
      errorEnvelope(400, "missing_model", "request body must include 'model'")
    );
  }

  log.debug("incoming POST /v1/responses", {
    model: payload.model,
    stream: !!payload.stream,
    hasInput: Array.isArray(payload.input) ? payload.input.length : "n/a",
    hasInstructions: typeof payload.instructions === "string" ? payload.instructions.length : 0,
    keys: Object.keys(payload),
  });
  log.debug("incoming POST /v1/responses raw body", payload);

  // Health-check probe short-circuit. Tools like cc-switch's "test connection"
  // send POST /v1/responses with just `{model, stream}` and no input — our
  // translation would forward `messages: []` to the upstream, which 400s.
  // Detect the probe shape (no input, no instructions) and answer with a
  // synthetic 200 without burning an upstream call.
  const hasInput = Array.isArray(payload.input) && payload.input.length > 0;
  const hasInstructions = typeof payload.instructions === "string" && payload.instructions.length > 0;
  if (!hasInput && !hasInstructions) {
    log.debug("matched probe shape — returning synthetic 200 without upstream call");
    return respondToResponsesProbe(payload, res, !!payload.stream);
  }

  const { provider, runtime, upstreamModel } = selectProvider(payload.model, cfg);
  log.debug(`routing to provider=${provider.id}`, {
    baseUrl: runtime.baseUrl,
    clientModel: payload.model,
    upstreamModel,
  });

  const chat = provider.preprocessResponses(payload, {
    runtime,
    exposeReasoning: cfg.exposeReasoning,
  });
  chat.model = upstreamModel;
  chat.stream = !!payload.stream;
  const stream = !!payload.stream;

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  const startedAt = Date.now();
  const baseEntry = {
    request_id: null as string | null,
    provider_id: provider.id,
    client_model: payload.model,
    upstream_model: upstreamModel,
    endpoint: "/v1/responses",
    stream,
  };

  if (!stream) {
    try {
      const upstreamRes = await callOpenAICompat(
        {
          baseUrl: runtime.baseUrl,
          apiKey: runtime.apiKey,
          userAgent: cfg.userAgent,
          enhanceError: provider.enhanceError.bind(provider),
        },
        chat,
        ac.signal
      );
      const chatJson = (await upstreamRes.json()) as ChatResponse;
      const responses = respToResponses(chatJson, payload, {
        exposeReasoning: cfg.exposeReasoning,
      });
      sendJson(res, 200, responses);
      recordLog(cfg, {
        ...baseEntry,
        request_id: chatJson.id ?? null,
        status_code: 200,
        duration_ms: Date.now() - startedAt,
        ...usageFromChatResponse(chatJson.usage),
        error_code: null,
        error_snippet: null,
      });
      return;
    } catch (err) {
      if (err instanceof UpstreamError) {
        sendJson(res, err.status, errorEnvelope(err.status, err.code, err.message));
        recordLog(cfg, {
          ...baseEntry,
          status_code: err.status,
          duration_ms: Date.now() - startedAt,
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
          error_code: err.code,
          error_snippet: err.bodySnippet ?? err.message,
        });
        return;
      }
      log.error("non-stream request failed", { error: (err as Error).message });
      sendJson(res, 500, errorEnvelope(500, "internal_error", (err as Error).message));
      recordLog(cfg, {
        ...baseEntry,
        status_code: 500,
        duration_ms: Date.now() - startedAt,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        error_code: "internal_error",
        error_snippet: (err as Error).message,
      });
      return;
    }
  }

  // Streaming path.
  let upstreamRes: Response;
  try {
    upstreamRes = await callOpenAICompat(
      {
        baseUrl: runtime.baseUrl,
        apiKey: runtime.apiKey,
        userAgent: cfg.userAgent,
        enhanceError: provider.enhanceError.bind(provider),
      },
      chat,
      ac.signal
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      sendJson(res, err.status, errorEnvelope(err.status, err.code, err.message));
      recordLog(cfg, {
        ...baseEntry,
        status_code: err.status,
        duration_ms: Date.now() - startedAt,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        error_code: err.code,
        error_snippet: err.bodySnippet ?? err.message,
      });
      return;
    }
    log.error("stream request failed (pre-stream)", { error: (err as Error).message });
    sendJson(res, 500, errorEnvelope(500, "internal_error", (err as Error).message));
    recordLog(cfg, {
      ...baseEntry,
      status_code: 500,
      duration_ms: Date.now() - startedAt,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      error_code: "internal_error",
      error_snippet: (err as Error).message,
    });
    return;
  }

  const sink = makeServerResponseSink(res);
  const keepalive = setInterval(() => sink.comment("keepalive"), KEEPALIVE_INTERVAL_MS);
  res.on("close", () => clearInterval(keepalive));

  let streamError: Error | null = null;
  try {
    const chunks = iterChatStreamChunks(upstreamRes);
    await pipeChatStreamToResponses(
      sink,
      { chunks },
      payload,
      { exposeReasoning: cfg.exposeReasoning }
    );
  } catch (err) {
    streamError = err as Error;
    log.error("stream request failed (mid-stream)", { error: streamError.message });
    if (!sink.closed()) {
      sink.write("error", {
        type: "error",
        code: "server_error",
        message: streamError.message,
        sequence_number: 9999,
      });
      sink.end();
    }
  } finally {
    clearInterval(keepalive);
    recordLog(cfg, {
      ...baseEntry,
      status_code: streamError ? 500 : 200,
      duration_ms: Date.now() - startedAt,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      error_code: streamError ? "stream_error" : null,
      error_snippet: streamError ? streamError.message : null,
    });
  }
}

function respondToResponsesProbe(
  payload: ResponsesRequest,
  res: ServerResponse,
  stream: boolean
): void {
  const id = `resp_probe_${Date.now()}`;
  const created_at = Math.floor(Date.now() / 1000);
  const completed = {
    id,
    object: "response",
    created_at,
    status: "completed",
    model: payload.model,
    output: [],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    parallel_tool_calls: true,
    tool_choice: "auto",
    text: { format: { type: "text" } },
    reasoning: { effort: null, summary: null },
    incomplete_details: null,
    error: null,
    metadata: null,
  };
  if (!stream) {
    sendJson(res, 200, completed);
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  const inProgress = { ...completed, status: "in_progress" };
  res.write(
    `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: inProgress, sequence_number: 0 })}\n\n`
  );
  res.write(
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: completed, sequence_number: 1 })}\n\n`
  );
  res.end();
}

function respondToChatProbe(
  payload: ChatRequest,
  res: ServerResponse,
  stream: boolean
): void {
  const id = `chatcmpl_probe_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  if (!stream) {
    sendJson(res, 200, {
      id,
      object: "chat.completion",
      created,
      model: payload.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  const chunk = (delta: object, finish: string | null): string =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model: payload.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  res.write(chunk({ role: "assistant", content: "" }, null));
  res.write(chunk({}, "stop"));
  res.write(`data: [DONE]\n\n`);
  res.end();
}

async function handleChatPassthrough(
  cfg: Config,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let payload: ChatRequest;
  try {
    payload = await readJsonBody<ChatRequest>(req);
  } catch (err) {
    return sendJson(
      res,
      400,
      errorEnvelope(400, "invalid_json", `failed to parse request body: ${(err as Error).message}`)
    );
  }
  if (!payload.model) {
    return sendJson(
      res,
      400,
      errorEnvelope(400, "missing_model", "request body must include 'model'")
    );
  }

  log.debug("incoming POST /v1/chat/completions", {
    model: payload.model,
    stream: !!payload.stream,
    messages: Array.isArray(payload.messages) ? payload.messages.length : "n/a",
    keys: Object.keys(payload),
  });
  log.debug("incoming POST /v1/chat/completions raw body", payload);

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    log.debug("matched probe shape — returning synthetic 200 without upstream call");
    return respondToChatProbe(payload, res, !!payload.stream);
  }

  const { provider, runtime, upstreamModel } = selectProvider(payload.model, cfg);
  log.debug(`routing chat passthrough to provider=${provider.id}`, {
    clientModel: payload.model,
    upstreamModel,
  });

  const body = provider.preprocessChat(payload, {
    runtime,
    exposeReasoning: cfg.exposeReasoning,
  });
  body.model = upstreamModel;

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  const startedAt = Date.now();
  const baseEntry = {
    request_id: null as string | null,
    provider_id: provider.id,
    client_model: payload.model,
    upstream_model: upstreamModel,
    endpoint: "/v1/chat/completions",
    stream: !!payload.stream,
  };

  let upstreamRes: Response;
  try {
    upstreamRes = await callOpenAICompat(
      {
        baseUrl: runtime.baseUrl,
        apiKey: runtime.apiKey,
        userAgent: cfg.userAgent,
        enhanceError: provider.enhanceError.bind(provider),
      },
      body,
      ac.signal
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      sendJson(res, err.status, errorEnvelope(err.status, err.code, err.message));
      recordLog(cfg, {
        ...baseEntry,
        status_code: err.status,
        duration_ms: Date.now() - startedAt,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        error_code: err.code,
        error_snippet: err.bodySnippet ?? err.message,
      });
      return;
    }
    log.error("chat passthrough failed", { error: (err as Error).message });
    sendJson(res, 500, errorEnvelope(500, "internal_error", (err as Error).message));
    recordLog(cfg, {
      ...baseEntry,
      status_code: 500,
      duration_ms: Date.now() - startedAt,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      error_code: "internal_error",
      error_snippet: (err as Error).message,
    });
    return;
  }

  const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);

  if (payload.stream) {
    if (!upstreamRes.body) {
      res.end();
      recordLog(cfg, {
        ...baseEntry,
        status_code: 200,
        duration_ms: Date.now() - startedAt,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        error_code: null,
        error_snippet: null,
      });
      return;
    }
    const reader = upstreamRes.body.getReader();
    let streamError: Error | null = null;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
    } catch (err) {
      streamError = err as Error;
      log.error("chat passthrough stream error", { error: streamError.message });
    } finally {
      res.end();
      recordLog(cfg, {
        ...baseEntry,
        status_code: streamError ? 500 : 200,
        duration_ms: Date.now() - startedAt,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        error_code: streamError ? "stream_error" : null,
        error_snippet: streamError ? streamError.message : null,
      });
    }
    return;
  }

  const text = await upstreamRes.text();
  res.end(text);
  // Try to extract token usage from the JSON body so logs reflect cost.
  let usage: ChatUsage | undefined;
  try {
    const parsed = JSON.parse(text) as { usage?: ChatUsage };
    usage = parsed.usage;
  } catch {
    // ignore
  }
  recordLog(cfg, {
    ...baseEntry,
    status_code: 200,
    duration_ms: Date.now() - startedAt,
    ...usageFromChatResponse(usage),
    error_code: null,
    error_snippet: null,
  });
}

function handleModels(cfg: Config, res: ServerResponse): void {
  // Aggregate the catalogs of every provider whose api key is configured. The
  // default provider's catalog comes first so existing tools that pick the top
  // entry keep their previous behavior.
  const ordered: Provider[] = [
    PROVIDERS[cfg.defaultProviderId],
    ...PROVIDER_LIST.filter((p) => p.id !== cfg.defaultProviderId),
  ];
  const data: Array<{ id: string; object: "model"; owned_by: string }> = [];
  for (const p of ordered) {
    if (!cfg.providers[p.id]) continue;
    const ownedBy = p.id === "mimo" ? "xiaomi" : "deepseek";
    for (const m of p.builtinModels) {
      data.push({ id: m.id, object: "model", owned_by: ownedBy });
    }
  }
  sendJson(res, 200, { object: "list", data });
}

export function startServer(cfg: Config): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (req.method === "GET" && (url === "/healthz" || url === "/")) {
      sendJson(res, 200, {
        ok: true,
        name: "mimo2codex",
        provider: cfg.defaultProviderId,
        baseUrl: cfg.baseUrl,
      });
      return;
    }
    if (req.method === "GET" && url.startsWith("/v1/models")) {
      handleModels(cfg, res);
      return;
    }
    if (req.method === "POST" && url.startsWith("/v1/responses")) {
      void handleResponses(cfg, req, res);
      return;
    }
    if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
      void handleChatPassthrough(cfg, req, res);
      return;
    }
    if (cfg.adminEnabled && (url === "/admin" || url.startsWith("/admin/"))) {
      void handleAdmin(cfg, req, res);
      return;
    }
    sendJson(res, 404, errorEnvelope(404, "not_found", `no route for ${req.method} ${url}`));
  });

  server.listen(cfg.port, cfg.host);
  return server;
}
