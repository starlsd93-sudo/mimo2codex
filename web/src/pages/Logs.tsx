import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { api, type LogDetail, type LogRow } from "../api/client";

const PAGE_SIZE = 100;

function formatBody(text: string | null): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function Logs() {
  const { t } = useTranslation("logs");
  const [messageApi, msgCtx] = message.useMessage();
  const [modal, modalCtx] = Modal.useModal();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<number, LogDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Set<number>>(new Set());

  async function load() {
    try {
      setError(null);
      setLoading(true);
      const r = await api.logs({
        provider: provider || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setLogs(r.logs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, page]);

  async function loadDetail(id: number) {
    if (details[id] || detailLoading.has(id)) return;
    setDetailLoading((prev) => new Set(prev).add(id));
    try {
      const r = await api.logDetail(id);
      setDetails((prev) => ({ ...prev, [id]: r.log }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDetailLoading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function openClearOld() {
    let days = 7;
    modal.confirm({
      title: t("clearOld.title"),
      icon: <DeleteOutlined />,
      content: (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 6 }}>{t("clearOld.label")}</div>
          <InputNumber
            min={1}
            max={3650}
            defaultValue={days}
            onChange={(v) => {
              days = (v ?? 7) as number;
            }}
            style={{ width: 120 }}
          />
        </div>
      ),
      onOk: async () => {
        const before = Date.now() - days * 24 * 60 * 60 * 1000;
        try {
          const r = await api.deleteLogsBefore(before);
          messageApi.success(t("clearOld.removed", { count: r.removed }));
          await load();
        } catch (err) {
          setError((err as Error).message);
        }
      },
    });
  }

  const columns: ColumnsType<LogRow> = useMemo(
    () => [
      {
        title: t("columns.ts"),
        dataIndex: "ts",
        key: "ts",
        render: (ts: number) => new Date(ts).toLocaleString(),
        width: 180,
      },
      {
        title: t("columns.provider"),
        dataIndex: "provider_id",
        key: "provider_id",
        render: (v: string) => <Tag>{v}</Tag>,
        width: 110,
      },
      {
        title: t("columns.clientModel"),
        dataIndex: "client_model",
        key: "client_model",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("columns.upstreamModel"),
        dataIndex: "upstream_model",
        key: "upstream_model",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("columns.endpoint"),
        dataIndex: "endpoint",
        key: "endpoint",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("columns.status"),
        key: "status",
        render: (_, row) => (
          <Tag color={row.status_code >= 400 ? "error" : "success"}>
            {row.status_code}
            {row.stream ? ` · ${t("stream")}` : ""}
          </Tag>
        ),
        width: 130,
      },
      {
        title: t("columns.promptTokens"),
        dataIndex: "prompt_tokens",
        key: "prompt_tokens",
        align: "right",
        render: (v: number | null) => v ?? "—",
      },
      {
        title: t("columns.completionTokens"),
        dataIndex: "completion_tokens",
        key: "completion_tokens",
        align: "right",
        render: (v: number | null) => v ?? "—",
      },
      {
        title: t("columns.totalTokens"),
        dataIndex: "total_tokens",
        key: "total_tokens",
        align: "right",
        render: (v: number | null) => v ?? "—",
      },
      {
        title: t("columns.tools"),
        dataIndex: "tool_call_count",
        key: "tool_call_count",
        align: "right",
        render: (v: number | null) => (v && v > 0 ? v : "—"),
        width: 70,
      },
      {
        title: t("columns.duration"),
        dataIndex: "duration_ms",
        key: "duration_ms",
        align: "right",
        render: (v: number) => `${v} ms`,
        width: 100,
      },
      {
        title: t("columns.error"),
        key: "error",
        render: (_, row) => {
          if (!row.error_code && !row.error_snippet) return null;
          const text = `${row.error_code ?? ""}${
            row.error_snippet ? `: ${row.error_snippet}` : ""
          }`;
          return (
            <Tooltip title={row.error_snippet ?? ""}>
              <span
                style={{
                  display: "inline-block",
                  maxWidth: 280,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  verticalAlign: "bottom",
                }}
              >
                <code>{text}</code>
              </span>
            </Tooltip>
          );
        },
      },
    ],
    [t]
  );

  return (
    <>
      {msgCtx}
      {modalCtx}
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        {t("title")}
      </Typography.Title>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <Card>
        <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
          <Space>
            <Typography.Text type="secondary">
              {t("filter.providerLabel")}
            </Typography.Text>
            <Select
              value={provider}
              style={{ minWidth: 160 }}
              onChange={(v) => {
                setProvider(v);
                setPage(0);
              }}
              options={[
                { value: "", label: t("filter.all") },
                { value: "mimo", label: "mimo" },
                { value: "deepseek", label: "deepseek" },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              {t("action.refresh")}
            </Button>
          </Space>
          <Button danger icon={<DeleteOutlined />} onClick={openClearOld}>
            {t("action.clearOld")}
          </Button>
        </Space>

        <Table<LogRow>
          rowKey="id"
          dataSource={logs}
          columns={columns}
          loading={loading}
          size="middle"
          pagination={{
            current: page + 1,
            pageSize: PAGE_SIZE,
            onChange: (p) => setPage(p - 1),
            showSizeChanger: false,
            // Total is unknown server-side; show a hasNextPage-style pager
            total: page * PAGE_SIZE + logs.length + (logs.length === PAGE_SIZE ? PAGE_SIZE : 0),
          }}
          locale={{ emptyText: <Empty description={t("empty")} /> }}
          expandable={{
            onExpand: (expanded, row) => {
              if (expanded) void loadDetail(row.id);
            },
            expandedRowRender: (row) => {
              const detail = details[row.id];
              if (!detail) {
                return (
                  <Typography.Text type="secondary">
                    {detailLoading.has(row.id) ? t("expand.loading") : t("expand.empty")}
                  </Typography.Text>
                );
              }
              return (
                <Space direction="vertical" style={{ width: "100%" }} size={12}>
                  <BodyBlock title={t("expand.requestBody")} body={detail.request_body} t={t} />
                  <BodyBlock title={t("expand.responseBody")} body={detail.response_body} t={t} />
                </Space>
              );
            },
          }}
        />
      </Card>
    </>
  );
}

function BodyBlock({
  title,
  body,
  t,
}: {
  title: string;
  body: string | null;
  t: ReturnType<typeof useTranslation<"logs">>["t"];
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
