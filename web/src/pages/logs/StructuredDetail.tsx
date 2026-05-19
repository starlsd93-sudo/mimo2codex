import { useMemo } from "react";
import { Alert, Card, Space, Tag, theme, Typography } from "antd";
import type { TFunction } from "i18next";
import type { LogDetail } from "../../api/client";

// Safely parse a JSON string into an object record, returning null when the
// payload is empty, malformed, or not a plain object (numbers / arrays at
// the top level aren't useful for the structured layout below).
function safeParse(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return typeof v === "object" && v !== null
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Flatten one message's `content` field into a readable string. OpenAI-style
// arrays of parts (text / image_url) collapse to one line per part with image
// parts elided to a `[image]` marker so the structured view stays scannable.
function summarizeContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null) {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (p.type === "image_url" || p.type === "image") return "[image]";
        }
        return JSON.stringify(part);
      })
      .join("\n");
  }
  return JSON.stringify(content, null, 2);
}

export function StructuredDetail({
  detail,
  t,
}: {
  detail: LogDetail;
  t: TFunction<"logs">;
}) {
  const { token } = theme.useToken();
  const reqJson = useMemo(
    () => safeParse(detail.request_body),
    [detail.request_body]
  );
  const respJson = useMemo(
    () => safeParse(detail.response_body),
    [detail.response_body]
  );
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      <Card size="small" title={t("expand.summary")}>
        <Space wrap size={[12, 6]}>
          <span>
            <Typography.Text type="secondary">
              {t("expand.field.model")}:
            </Typography.Text>{" "}
            <code>{detail.upstream_model}</code>
          </span>
          <span>
            <Typography.Text type="secondary">
              {t("expand.field.duration")}:
            </Typography.Text>{" "}
            {detail.duration_ms} ms
          </span>
          <span>
            <Typography.Text type="secondary">
              {t("expand.field.tokens")}:
            </Typography.Text>{" "}
            {detail.prompt_tokens ?? "—"} / {detail.completion_tokens ?? "—"} /{" "}
            {detail.total_tokens ?? "—"}
          </span>
          {detail.cached_tokens != null && detail.cached_tokens > 0 && (
            <span>
              <Typography.Text type="secondary">
                {t("expand.field.cached")}:
              </Typography.Text>{" "}
              {detail.cached_tokens}
            </span>
          )}
          {detail.tool_call_count != null && detail.tool_call_count > 0 && (
            <span>
              <Typography.Text type="secondary">
                {t("expand.field.tools")}:
              </Typography.Text>{" "}
              {detail.tool_call_count}
            </span>
          )}
        </Space>
        {detail.error_code && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 8 }}
            message={
              <span>
                <code>{detail.error_code}</code>
                {detail.error_snippet ? `: ${detail.error_snippet}` : ""}
              </span>
            }
          />
        )}
      </Card>

      {Array.isArray(reqJson?.messages) && (
        <Card size="small" title={t("expand.messages")}>
          <Space direction="vertical" style={{ width: "100%" }} size={6}>
            {(reqJson.messages as Array<Record<string, unknown>>).map((m, i) => (
              <div
                key={i}
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 4,
                  padding: 8,
                }}
              >
                <Tag>{String(m.role ?? "?")}</Tag>
                <pre
                  className="mono"
                  style={{
                    margin: "6px 0 0 0",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {summarizeContent(m.content)}
                </pre>
              </div>
            ))}
          </Space>
        </Card>
      )}

      {Array.isArray(reqJson?.tools) && reqJson.tools.length > 0 && (
        <Card size="small" title={t("expand.tools")}>
          <Space wrap>
            {(reqJson.tools as Array<Record<string, unknown>>).map((tool, i) => {
              const fn = tool.function as Record<string, unknown> | undefined;
              const name =
                (fn?.name as string) ?? (tool.type as string) ?? `tool-${i}`;
              return <Tag key={i}>{name}</Tag>;
            })}
          </Space>
        </Card>
      )}

      {Array.isArray(respJson?.choices) && (
        <Card size="small" title={t("expand.completion")}>
          {(respJson.choices as Array<Record<string, unknown>>).map((c, i) => {
            const msg = c.message as Record<string, unknown> | undefined;
            return (
              <pre
                key={i}
                className="mono"
                style={{
                  margin: 0,
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {summarizeContent(msg?.content)}
              </pre>
            );
          })}
        </Card>
      )}
    </Space>
  );
}
