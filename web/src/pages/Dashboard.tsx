import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import {
  Alert,
  Card,
  Col,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  api,
  type LogRow,
  type MappingRow,
  type ProviderInfo,
  type StatsResponse,
  type TimeseriesBucket,
  type TokenTimeseriesResponse,
} from "../api/client";
import { KeyStatusBanner } from "../components/KeyStatusBanner";
import { TokenChart } from "../components/TokenChart";

const SETUP_BANNER_KEY = "m2c.setup-banner-dismissed";

type StatsRow = StatsResponse["rows"][number];

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function Dashboard() {
  const { t } = useTranslation("dashboard");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [timeseries, setTimeseries] = useState<TokenTimeseriesResponse | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const [bucket, setBucket] = useState<TimeseriesBucket>("hour");
  const [error, setError] = useState<string | null>(null);
  const [showSetupBanner, setShowSetupBanner] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(SETUP_BANNER_KEY) !== "1";
  });

  function dismissSetupBanner() {
    setShowSetupBanner(false);
    try {
      localStorage.setItem(SETUP_BANNER_KEY, "1");
    } catch {
      // ignore — private mode / quota errors shouldn't crash the page
    }
  }

  async function load() {
    try {
      setError(null);
      const [p, s, ts, l, m] = await Promise.all([
        api.providers(),
        api.stats(range),
        api.tokenTimeseries(range, bucket),
        api.logs({ limit: 10 }),
        api.mappings(),
      ]);
      setProviders(p.providers);
      setStats(s);
      setTimeseries(ts);
      setLogs(l.logs);
      setMappings(m.mappings);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    const tid = setInterval(load, 5000);
    return () => clearInterval(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, bucket]);

  const totals = useMemo(
    () =>
      stats?.rows.reduce(
        (acc, r) => ({
          requests: acc.requests + r.requests,
          errors: acc.errors + r.errors,
          tokens: acc.tokens + r.total_tokens,
        }),
        { requests: 0, errors: 0, tokens: 0 }
      ) ?? { requests: 0, errors: 0, tokens: 0 },
    [stats]
  );

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled),
    [providers]
  );

  const statsColumns: ColumnsType<StatsRow> = useMemo(
    () => [
      {
        title: t("byModel.columns.provider"),
        dataIndex: "provider_id",
        key: "provider_id",
        render: (v: string) => <Tag>{v}</Tag>,
      },
      {
        title: t("byModel.columns.model"),
        dataIndex: "upstream_model",
        key: "upstream_model",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("byModel.columns.requests"),
        dataIndex: "requests",
        key: "requests",
        align: "right",
      },
      {
        title: t("byModel.columns.errors"),
        dataIndex: "errors",
        key: "errors",
        align: "right",
      },
      {
        title: t("byModel.columns.prompt"),
        dataIndex: "prompt_tokens",
        key: "prompt",
        align: "right",
        render: (v: number) => formatTokens(v),
      },
      {
        title: t("byModel.columns.completion"),
        dataIndex: "completion_tokens",
        key: "completion",
        align: "right",
        render: (v: number) => formatTokens(v),
      },
      {
        title: t("byModel.columns.total"),
        dataIndex: "total_tokens",
        key: "total",
        align: "right",
        render: (v: number) => formatTokens(v),
      },
    ],
    [t]
  );

  const mappingColumns: ColumnsType<MappingRow> = useMemo(
    () => [
      {
        title: t("mappings.columns.provider"),
        dataIndex: "provider_id",
        key: "provider_id",
        render: (v: string) => <Tag>{v}</Tag>,
      },
      {
        title: t("mappings.columns.clientModel"),
        dataIndex: "client_model",
        key: "client_model",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("mappings.columns.upstreamModel"),
        dataIndex: "upstream_model",
        key: "upstream_model",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("mappings.columns.count"),
        dataIndex: "count",
        key: "count",
        align: "right",
      },
      {
        title: t("mappings.columns.lastSeen"),
        dataIndex: "last_seen",
        key: "last_seen",
        render: (v: number) => formatTime(v),
      },
    ],
    [t]
  );

  const recentColumns: ColumnsType<LogRow> = useMemo(
    () => [
      {
        title: t("recent.columns.ts"),
        dataIndex: "ts",
        key: "ts",
        render: (v: number) => formatTime(v),
      },
      {
        title: t("recent.columns.provider"),
        dataIndex: "provider_id",
        key: "provider_id",
        render: (v: string) => <Tag>{v}</Tag>,
      },
      {
        title: t("recent.columns.model"),
        dataIndex: "upstream_model",
        key: "upstream_model",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("recent.columns.endpoint"),
        dataIndex: "endpoint",
        key: "endpoint",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("recent.columns.status"),
        key: "status",
        render: (_, row) => (
          <Tag color={row.status_code >= 400 ? "error" : "success"}>
            {row.status_code}
          </Tag>
        ),
      },
      {
        title: t("recent.columns.tokens"),
        dataIndex: "total_tokens",
        key: "total_tokens",
        align: "right",
        render: (v: number | null) => (v != null ? v : "—"),
      },
      {
        title: t("recent.columns.duration"),
        dataIndex: "duration_ms",
        key: "duration_ms",
        align: "right",
        render: (v: number) => `${v} ms`,
      },
    ],
    [t]
  );

  const errorRate = totals.requests
    ? ((totals.errors / totals.requests) * 100).toFixed(1)
    : "0.0";

  return (
    <>
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

      {showSetupBanner && (
        <Alert
          type="info"
          showIcon
          closable
          onClose={dismissSetupBanner}
          style={{ marginBottom: 16 }}
          message={
            <Trans i18nKey="setupBanner" ns="dashboard">
              {"placeholder"}
              <Link to="/setup">placeholder</Link>
              {"placeholder"}
            </Trans>
          }
        />
      )}

      <KeyStatusBanner providers={providers} />

      <Space style={{ marginTop: 16, marginBottom: 16 }}>
        <Typography.Text type="secondary">{t("range.label")}</Typography.Text>
        <Segmented<"24h" | "7d" | "30d">
          value={range}
          options={[
            { value: "24h", label: t("range.options.24h") },
            { value: "7d", label: t("range.options.7d") },
            { value: "30d", label: t("range.options.30d") },
          ]}
          onChange={setRange}
        />
      </Space>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t("card.requests.label")}
              value={totals.requests}
              groupSeparator=","
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("card.requests.sub")}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t("card.errors.label")}
              value={totals.errors}
              groupSeparator=","
              valueStyle={
                totals.errors > 0 ? { color: "#f5222d" } : undefined
              }
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("card.errors.sub", { rate: errorRate })}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t("card.tokens.label")}
              value={formatTokens(totals.tokens)}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("card.tokens.sub")}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t("card.providers.label")}
              value={`${enabledProviders.length}/${providers.length}`}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {enabledProviders.map((p) => p.display_name).join(" · ") ||
                t("card.providers.subEmpty")}
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card
        title={t("chart.title")}
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("chart.bucket.label")}
            </Typography.Text>
            <Segmented<TimeseriesBucket>
              size="small"
              value={bucket}
              options={[
                { value: "hour", label: t("chart.bucket.hour") },
                { value: "day", label: t("chart.bucket.day") },
              ]}
              onChange={setBucket}
            />
          </Space>
        }
      >
        {timeseries ? (
          <TokenChart data={timeseries} />
        ) : (
          <Typography.Text type="secondary">{t("chart.loading")}</Typography.Text>
        )}
      </Card>

      <Card title={t("byModel.title")} style={{ marginBottom: 16 }}>
        <Table<StatsRow>
          rowKey={(r) => `${r.provider_id}-${r.upstream_model}`}
          dataSource={stats?.rows ?? []}
          columns={statsColumns}
          pagination={false}
          size="middle"
          locale={{ emptyText: t("byModel.empty") }}
        />
      </Card>

      <Card title={t("mappings.title")} style={{ marginBottom: 16 }}>
        <Table<MappingRow>
          rowKey={(r) =>
            `${r.provider_id}-${r.client_model}-${r.upstream_model}`
          }
          dataSource={mappings}
          columns={mappingColumns}
          pagination={false}
          size="middle"
          locale={{ emptyText: t("mappings.empty") }}
        />
      </Card>

      <Card title={t("recent.title")}>
        <Table<LogRow>
          rowKey="id"
          dataSource={logs}
          columns={recentColumns}
          pagination={false}
          size="middle"
          locale={{ emptyText: t("recent.empty") }}
        />
      </Card>
    </>
  );
}
