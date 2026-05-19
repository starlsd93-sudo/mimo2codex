import { theme, Typography } from "antd";
import type { TFunction } from "i18next";

// Pretty-print JSON if possible, fall back to raw text. Lives here because
// BodyBlock is the only consumer.
function formatBody(text: string | null): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function BodyBlock({
  title,
  body,
  t,
}: {
  title: string;
  body: string | null;
  t: TFunction<"logs">;
}) {
  const { token } = theme.useToken();
  if (!body) {
    return (
      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {t("expand.notCaptured")}
        </Typography.Text>
      </div>
    );
  }
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: 600 }}>{title}</span>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("expand.chars", { count: body.length })}
        </Typography.Text>
      </div>
      <pre
        className="mono"
        style={{
          maxHeight: 360,
          overflow: "auto",
          padding: 8,
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: 0,
          border: `1px solid ${token.colorBorder}`,
          borderRadius: 4,
        }}
      >
        {formatBody(body)}
      </pre>
    </div>
  );
}
