import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import { reqToChat } from "./translate/reqToChat.js";
import { respToResponses } from "./translate/respToResponses.js";
import { pipeChatStreamToResponses } from "./translate/streamToSse.js";
import { iterChatStreamChunks } from "./upstream/chatStream.js";
import { callMimo, UpstreamError } from "./upstream/mimoClient.js";
import { makeServerResponseSink } from "./util/sse.js";
import { log } from "./util/log.js";
import type { ChatRequest, ChatResponse, ResponsesRequest } from "./translate/types.js";

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
  // translation would forward `messages: []` to MiMo, which 400s. Detect the
  // probe shape (no input, no instructions) and answer with a synthetic 200
  // without burning an upstream call.
  const hasInput = Array.isArray(payload.input) && payload.input.length > 0;
  const hasInstructions = typeof payload.instructions === "string" && payload.instructions.length > 0;
  if (!hasInput && !hasInstructions) {
    log.debug("matched probe shape — returning synthetic 200 without upstream call");
    return respondToResponsesProbe(payload, res, !!payload.stream);
  }

  // mimo2codex applies two default-on behaviors that compensate for MiMo's
  // weaker agentic-coding training compared to GPT-5 / Claude:
  //   - parallel_tool_calls: true        ← batch tool calls per turn
  //   - web_search forwarded to MiMo     ← model decides when to search
  //
  // Note on web_search: if the user's MiMo account doesn't have the Web Search
  // Plugin activated, MiMo returns 400 "webSearchEnabled is false". We do NOT
  // silently strip + retry — that hides a real billing/feature issue. Instead
  // we surface the error verbatim with a friendlier message (see mimoClient.ts)
  // so the user activates the plugin (or accepts the limitation) and restarts.
  //
  // Note: we deliberately do NOT set `thinking: {type: "disabled"}` so that
  // MiMo keeps generating `reasoning_content`. The user typically wants to
  // see the thinking in the Codex terminal (use `--no-reasoning` to hide it).
  const chat = reqToChat(payload, {
    forceParallelToolCalls: true,
    enableWebSearch: true,
  });
  chat.stream = !!payload.stream;
  const stream = !!payload.stream;

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  if (!stream) {
    try {
      const upstreamRes = await callMimo(
        { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, userAgent: cfg.userAgent },
        chat,
        ac.signal
      );
      const chatJson = (await upstreamRes.json()) as ChatResponse;
      const responses = respToResponses(chatJson, payload, {
        exposeReasoning: cfg.exposeReasoning,
      });
      return sendJson(res, 200, responses);
    } catch (err) {
      if (err instanceof UpstreamError) {
        return sendJson(res, err.status, errorEnvelope(err.status, err.code, err.message));
      }
      log.error("non-stream request failed", { error: (err as Error).message });
      return sendJson(res, 500, errorEnvelope(500, "internal_error", (err as Error).message));
    }
  }

  // Streaming path. Strategy: don't open the SSE stream to the client until we
  // know the upstream is OK. This way upstream errors map to clean HTTP errors
  // instead of half-opened SSE streams that confuse the Codex client.
  let upstreamRes: Response;
  try {
    upstreamRes = await callMimo(
      { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, userAgent: cfg.userAgent },
      chat,
      ac.signal
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      return sendJson(res, err.status, errorEnvelope(err.status, err.code, err.message));
    }
    log.error("stream request failed (pre-stream)", { error: (err as Error).message });
    return sendJson(res, 500, errorEnvelope(500, "internal_error", (err as Error).message));
  }

  // Upstream returned 200 — now we can safely open the SSE stream.
  const sink = makeServerResponseSink(res);
  const keepalive = setInterval(() => sink.comment("keepalive"), KEEPALIVE_INTERVAL_MS);
  res.on("close", () => clearInterval(keepalive));

  try {
    const chunks = iterChatStreamChunks(upstreamRes);
    await pipeChatStreamToResponses(
      sink,
      { chunks },
      payload,
      { exposeReasoning: cfg.exposeReasoning }
    );
  } catch (err) {
    log.error("stream request failed (mid-stream)", { error: (err as Error).message });
    // pipeChatStreamToResponses handles its own errors with response.failed,
    // so reaching here means something unexpected in our own code.
    if (!sink.closed()) {
      sink.write("error", {
        type: "error",
        code: "server_error",
        message: (err as Error).message,
        sequence_number: 9999,
      });
      sink.end();
    }
  } finally {
    clearInterval(keepalive);
  }
}

// Build a synthetic Responses object that satisfies probes (cc-switch test
// connection, etc.) without forwarding to MiMo. Status 200 + minimally-shaped
// response is enough for connection-test tools, which only check the status.
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

// Synthetic Chat Completion for probes hitting /v1/chat/completions with empty
// messages. Mirror of respondToResponsesProbe but in OpenAI Chat shape.
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

// Passthrough for POST /v1/chat/completions. mimo2codex's primary surface is
// the Responses API translation, but plenty of tools (cc-switch's "test
// connection" probe, Cherry Studio, raw OpenAI SDKs) only speak Chat
// Completions. Since MiMo is itself Chat Completions–native, the cleanest
// answer is to forward the body verbatim and stream/return whatever upstream
// gives back. No translation, no state.
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

  // Probe short-circuit (mirrors handleResponses): empty messages → synthetic 200.
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    log.debug("matched probe shape — returning synthetic 200 without upstream call");
    return respondToChatProbe(payload, res, !!payload.stream);
  }

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  let upstreamRes: Response;
  try {
    upstreamRes = await callMimo(
      { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, userAgent: cfg.userAgent },
      payload,
      ac.signal
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      return sendJson(res, err.status, errorEnvelope(err.status, err.code, err.message));
    }
    log.error("chat passthrough failed", { error: (err as Error).message });
    return sendJson(res, 500, errorEnvelope(500, "internal_error", (err as Error).message));
  }

  const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);

  if (payload.stream) {
    if (!upstreamRes.body) {
      res.end();
      return;
    }
    const reader = upstreamRes.body.getReader();
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
    } catch (err) {
      log.error("chat passthrough stream error", { error: (err as Error).message });
    } finally {
      res.end();
    }
    return;
  }

  const text = await upstreamRes.text();
  res.end(text);
}

function handleModels(res: ServerResponse): void {
  sendJson(res, 200, {
    object: "list",
    data: [
      { id: "mimo-v2.5-pro", object: "model", owned_by: "xiaomi" },
      { id: "mimo-v2.5-pro[1m]", object: "model", owned_by: "xiaomi" },
      { id: "mimo-v2-flash", object: "model", owned_by: "xiaomi" },
    ],
  });
}

export function startServer(cfg: Config): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (req.method === "GET" && (url === "/healthz" || url === "/")) {
      sendJson(res, 200, { ok: true, name: "mimo2codex", baseUrl: cfg.baseUrl });
      return;
    }
    if (req.method === "GET" && url.startsWith("/v1/models")) {
      handleModels(res);
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
    sendJson(res, 404, errorEnvelope(404, "not_found", `no route for ${req.method} ${url}`));
  });

  server.listen(cfg.port, cfg.host);
  return server;
}
