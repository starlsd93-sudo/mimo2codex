// Minimal type definitions for the two API shapes we translate between.
// Trimmed to the fields the proxy actually inspects or emits.

// ============================================================================
// OpenAI Responses API (what Codex sends to us)
// ============================================================================

export type ResponsesRole = "user" | "assistant" | "system" | "developer";

export interface ResponsesContentInputText {
  type: "input_text";
  text: string;
}

export interface ResponsesContentInputImage {
  type: "input_image";
  image_url: string;
  detail?: "auto" | "low" | "high";
}

export interface ResponsesContentInputFile {
  type: "input_file";
  file_id?: string;
  filename?: string;
  file_data?: string;
}

export interface ResponsesContentOutputText {
  type: "output_text";
  text: string;
  annotations?: unknown[];
}

export type ResponsesContentPart =
  | ResponsesContentInputText
  | ResponsesContentInputImage
  | ResponsesContentInputFile
  | ResponsesContentOutputText;

export interface ResponsesMessageItem {
  type: "message";
  id?: string;
  role: ResponsesRole;
  status?: "in_progress" | "completed" | "incomplete";
  content: ResponsesContentPart[] | string;
}

export interface ResponsesFunctionCallItem {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: "in_progress" | "completed" | "incomplete";
}

export interface ResponsesFunctionCallOutputItem {
  type: "function_call_output";
  id?: string;
  call_id: string;
  // Codex / OpenAI Responses send `output` as either a plain string OR an
  // array of content parts (the latter when the tool returned images, e.g.
  // image_gen / mimoskill image generation). Chat Completions tool messages
  // only accept a string content, so the array form is flattened in
  // reqToChat — see toolOutputToString.
  output: string | ResponsesContentPart[];
}

export interface ResponsesReasoningSummaryPart {
  type: "summary_text";
  text: string;
}

export interface ResponsesReasoningItem {
  type: "reasoning";
  id?: string;
  summary: ResponsesReasoningSummaryPart[];
  encrypted_content?: string | null;
  status?: "in_progress" | "completed" | "incomplete";
}

export type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem
  | ResponsesReasoningItem;

export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean | null;
}

// Codex (and the Responses API in general) sends several builtin tool shapes
// that don't follow the function-tool schema — `local_shell`, `web_search`,
// `web_search_preview`, `code_interpreter`, `file_search`, `image_generation`,
// `computer_use_preview`, etc. These have no `name` field. We accept them at
// the request boundary and decide per-type whether to translate, drop, or
// pass through in reqToChat.
export interface ResponsesBuiltinTool {
  type: string;
  [key: string]: unknown;
}

// OpenAI Responses-API `mcp` tool (issue #39). Covers both Codex Desktop's
// first-party connector plugins (GitHub / Canva / HeyGen / Dropbox / Gmail
// / Google Drive / ...), distinguished by `connector_id`, and user-configured
// remote MCP servers, distinguished by `server_url`. Chat-Completions
// upstreams (MiMo / DeepSeek / SenseNova / ...) have no MCP equivalent, so
// mimo2codex's handling lives in reqToChat#mcpToolToChat — see doc/connector-plugins.md.
export interface ResponsesMcpTool {
  type: "mcp";
  server_label?: string;
  /** First-party connector, e.g. "connector_github" / "connector_canva". */
  connector_id?: string;
  /** User-configured remote MCP server URL. */
  server_url?: string;
  /** OAuth Bearer token or similar credential — must be redacted before logging. */
  authorization?: string;
  /** "never" | "always" | { ... } — mimo2codex has no UI to ask, all variants act as "never". */
  require_approval?: "never" | "always" | Record<string, unknown>;
  /** Optional sub-tool allowlist on the MCP server. */
  allowed_tools?: string[];
  // Permit forward-compat fields we don't recognize yet.
  [key: string]: unknown;
}

export type ResponsesTool = ResponsesFunctionTool | ResponsesMcpTool | ResponsesBuiltinTool;

export type ResponsesToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; name?: string; function?: { name: string } };

export interface ResponsesRequest {
  model: string;
  input?: ResponsesInputItem[] | string;
  instructions?: string | null;
  tools?: ResponsesTool[];
  tool_choice?: ResponsesToolChoice;
  parallel_tool_calls?: boolean;
  temperature?: number | null;
  top_p?: number | null;
  max_output_tokens?: number | null;
  stream?: boolean;
  reasoning?: {
    effort?: "minimal" | "low" | "medium" | "high" | null;
    summary?: "auto" | "concise" | "detailed" | null;
  } | null;
  metadata?: Record<string, string> | null;
  store?: boolean;
  previous_response_id?: string | null;
  text?: { format?: { type: string } } | null;
  include?: string[];
}

// Non-streaming Responses object that we synthesize and return.
export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

export type ResponsesOutputItem =
  | (ResponsesMessageItem & { id: string })
  | (ResponsesFunctionCallItem & { id: string })
  | (ResponsesReasoningItem & { id: string });

export interface ResponsesObject {
  id: string;
  object: "response";
  created_at: number;
  status: "in_progress" | "completed" | "failed" | "incomplete";
  model: string;
  output: ResponsesOutputItem[];
  usage: ResponsesUsage | null;
  parallel_tool_calls: boolean;
  tool_choice: ResponsesToolChoice;
  reasoning: { effort: string | null; summary: string | null };
  text: { format: { type: string } };
  incomplete_details: { reason: string } | null;
  error: { code?: string; message: string; type?: string } | null;
  metadata: Record<string, string> | null;
  previous_response_id: string | null;
  instructions: string | null;
  temperature?: number | null;
  top_p?: number | null;
  max_output_tokens?: number | null;
  tools?: unknown[];
  truncation?: string;
}

// ============================================================================
// OpenAI Chat Completions API (what MiMo accepts and returns)
// ============================================================================

export type ChatRole = "system" | "user" | "assistant" | "tool" | "developer";

export interface ChatTextPart {
  type: "text";
  text: string;
}

export interface ChatImageUrlPart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type ChatContentPart = ChatTextPart | ChatImageUrlPart;

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  index?: number;
}

export interface ChatMessage {
  role: ChatRole;
  content?: string | ChatContentPart[] | null;
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  reasoning_content?: string | null;
  annotations?: ChatAnnotation[];
}

export interface ChatFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean | null;
  };
}

// MiMo's builtin web_search tool — server-side search, not a function call.
// Requires the user to have activated the Web Search Plugin in their MiMo console.
// See https://platform.xiaomimimo.com/#/docs/usage-guide/tool-calling/web-search
export interface ChatWebSearchTool {
  type: "web_search";
  user_location?: {
    type?: "approximate";
    country?: string;
    region?: string;
    city?: string;
    district?: string;
    longitude?: number;
    latitude?: number;
  };
  max_keyword?: number;
  force_search?: boolean;
  limit?: number;
}

export type ChatTool = ChatFunctionTool | ChatWebSearchTool;

// Citation/annotation returned by MiMo when web_search is used.
// OpenAI's Responses API uses a similar `url_citation` annotation on output_text.
export interface ChatAnnotation {
  type: "url_citation" | string;
  url?: string;
  title?: string;
  summary?: string;
  start_index?: number;
  end_index?: number;
}

export type ChatToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
  temperature?: number | null;
  top_p?: number | null;
  max_completion_tokens?: number | null;
  stream?: boolean;
  // OpenAI-compatible: when streaming, include a final usage chunk so we can
  // record token counts. Without this, upstream omits usage from stream chunks.
  stream_options?: { include_usage?: boolean };
  stop?: string | string[] | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  // MiMo-specific. Set thinking.type to "disabled" to skip reasoning mode and
  // make the model more action-oriented for agentic / tool-heavy tasks.
  thinking?: { type: "enabled" | "disabled" | "auto" };
  enable_thinking?: boolean;
  // DeepSeek-specific thinking-mode intensity. See
  // https://api-docs.deepseek.com/zh-cn/guides/thinking_mode — default "high"
  // for normal requests, Claude Code / OpenCode-style Agents auto-promoted to "max".
  // "none" 是 SenseNova 6.7 的扩展（关思考），其他厂家可能不识别 —— per-provider 自处理。
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max" | "none";
}

export interface ChatChoiceMessage {
  role: "assistant";
  content: string | null;
  reasoning_content?: string | null;
  tool_calls?: ChatToolCall[];
  annotations?: ChatAnnotation[];
  refusal?: string | null;
}

export interface ChatChoice {
  index: number;
  message: ChatChoiceMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: ChatUsage;
}

export interface ChatStreamDelta {
  role?: ChatRole;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
  annotations?: ChatAnnotation[];
}

export interface ChatStreamChoice {
  index: number;
  delta: ChatStreamDelta;
  finish_reason: ChatChoice["finish_reason"];
}

export interface ChatStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatStreamChoice[];
  usage?: ChatUsage;
}
