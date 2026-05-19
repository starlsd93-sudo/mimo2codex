import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { PageTour } from "../components/PageTour";
import {
  Alert,
  Card,
  Col,
  Row,
  Segmented,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  api,
  type ErrorStatsResponse,
  type LatencyStatsResponse,
  type LogRow,
  type ProviderHealthRow,
  type ProviderInfo,
  type StatsResponse,
  type TimeseriesBucket,
  type TokenTimeseriesResponse,
} from "../api/client";
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

function healthLevel(r: ProviderHealthRow): "healthy" | "degraded" | "down" | "idle" {
  if (r.error_rate < 0 || r.requests === 0) return "idle";
  if (r.error_rate < 5) return "healthy";
  if (r.error_rate < 50) return "degraded";
  return "down";
}

export function Dashboard() {
  const { t } = useTranslation("dashboard");
  const { t: tTour } = useTranslation("tour");
  const navigate = useNavigate();
  const rangeRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const recentRef = useRef<HTMLDivElement>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [timeseries, setTimeseries] = useState<TokenTimeseriesResponse | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [errorStats, setErrorStats] = useState<ErrorStatsResponse | null>(null);
  const [latencyStats, setLatencyStats] = useState<LatencyStatsResponse | null>(null);
  const [health, setHealth] = useState<ProviderHealthRow[]>([]);
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const [bucket, setBucket] = useState<TimeseriesBucket>("hour");
  const [error, setError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [showSetupBanner, setShowSetupBanner] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(SETUP_BANNER_KEY) !== "1";
  });
  // Last-seen payloads keep auto-refresh from re-rendering the whole subtree
  // every 5s when nothing actually changed; chart redraws flicker otherwise.
  const lastPayload = useRef<{
    providers: string;
    stats: string;
    timeseries: string;
    logs: string;
    errorStats: string;
    latencyStats: string;
    health: string;
  }>({
    providers: "",
    stats: "",
    timeseries: "",
    logs: "",
    errorStats: "",
    latencyStats: "",
    health: "",
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
      const [p, s, ts, l, es, ls, h] = await Promise.all([
        api.providers(),
        api.stats(range),
        api.tokenTimeseries(range, bucket),
        api.logs({ limit: 10 }),
        api.errorStats(range),
        api.latencyStats(range),
        api.providerHealth(),
      ]);
      // Diff-based setState: each blob is JSON-compared and only updated when
      // it actually changed. Eliminates the chart flicker that hit every 5s
      // when nothing had updated.
      const pStr = JSON.stringify(p.providers);
      if (pStr !== lastPayload.current.providers) {
        lastPayload.current.providers = pStr;
        setProviders(p.providers);
      }
      const sStr = JSON.stringify(s);
      if (sStr !== lastPayload.current.stats) {
        lastPayload.current.stats = sStr;
        setStats(s);
      }
      const tsStr = JSON.stringify(ts);
      if (tsStr !== lastPayload.current.timeseries) {
        lastPayload.current.timeseries = tsStr;
        setTimeseries(ts);
      }
      const lStr = JSON.stringify(l.logs);
      if (lStr !== lastPayload.current.logs) {
        lastPayload.current.logs = lStr;
        setLogs(l.logs);
      }
      const esStr = JSON.stringify(es);
      if (esStr !== lastPayload.current.errorStats) {
        lastPayload.current.errorStats = esStr;
        setErrorStats(es);
      }
      const lsStr = JSON.stringify(ls);
      if (lsStr !== lastPayload.current.latencyStats) {
        lastPayload.current.latencyStats = lsStr;
        setLatencyStats(ls);
      }
      const hStr = JSON.stringify(h.rows);
      if (hStr !== lastPayload.current.health) {
        lastPayload.current.health = hStr;
        setHealth(h.rows);
      }
      setInitialLoaded(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // Auto-refresh: 5s when tab visible, 30s when hidden. Same logic gets
    // re-run on visibility change because there's no DOM event for "tab
    // became active", only document.visibilityState toggling.
    let tid: ReturnType<typeof setInterval>;
    function schedule() {
      if (tid) clearInterval(tid);
      const ms = document.visibilityState === "visible" ? 5000 : 30000;
      tid = setInterval(load, ms);
    }
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearInterval(tid);
      document.removeEventListener("visibilitychange", schedule);
    };
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

  // Cache hit rate over the active window: total cached_tokens / total
  // prompt_tokens across every series in the timeseries response. When the
  // window has zero prompt traffic the rate is undefined and we render "—".
  const cacheStats = useMemo(() => {
    if (!timeseries) return null;
    let cached = 0;
    let prompt = 0;
    for (const s of timeseries.series) {
      cached += s.cached_tokens.reduce((a, b) => a + b, 0);
      prompt += s.prompt_tokens.reduce((a, b) => a + b, 0);
    }
    return { cached, prompt, rate: prompt > 0 ? (cached / prompt) * 100 : null };
  }, [timeseries]);

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

  const cacheValue =
    cacheStats?.rate == null ? "—" : `${cacheStats.rate.toFixed(1)}%`;

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
              <Link to="/codex">placeholder</Link>
              {"placeholder"}
            </Trans>
          }
        />
      )}

      <div ref={rangeRef}>
        <Space style={{ marginTop: 12, marginBottom: 12 }}>
          <Typography.Text type="secondary">{t("range.label")}</Typography.Text>
          <Segmented<"24h" | "7d" | "30d">
            size="small"
            value={range}
            options={[
              { value: "24h", label: t("range.options.24h") },
              { value: "7d", label: t("range.options.7d") },
              { value: "30d", label: t("range.options.30d") },
            ]}
            onChange={setRange}
          />
        </Space>
      </div>

      {!initialLoaded ? (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Skeleton active paragraph={{ rows: 2 }} />
        </Card>
      ) : (
        <div ref={statsRef}>
        <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: "12px 16px" } }}>
          <Row gutter={[16, 8]}>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title={t("card.requests.label")}
                value={totals.requests}
                groupSeparator=","
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title={t("card.errors.label")}
                value={totals.errors}
                groupSeparator=","
                valueStyle={{
                  fontSize: 20,
                  color: totals.errors > 0 ? "#f5222d" : undefined,
                }}
                suffix={
                  totals.requests ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {errorRate}%
                    </Typography.Text>
                  ) : null
                }
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title={t("card.tokens.label")}
                value={formatTokens(totals.tokens)}
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title={t("card.cache.label")}
                value={cacheValue}
                valueStyle={{ fontSize: 20 }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title={t("card.latency.label")}
                value={latencyStats?.p50 ?? 0}
                suffix="ms"
                valueStyle={{ fontSize: 20 }}
              />
              {latencyStats && latencyStats.count > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  P95 {latencyStats.p95} · P99 {latencyStats.p99}
                </Typography.Text>
              )}
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title={t("card.providers.label")}
                value={`${enabledProviders.length}/${providers.length}`}
                valueStyle={{ fontSize: 20 }}
              />
              {health.length > 0 && (
                <Space size={4} wrap style={{ marginTop: 2 }}>
                  {health.slice(0, 5).map((r) => {
                    const level = healthLevel(r);
                    const color =
                      level === "healthy"
                        ? "success"
                        : level === "degraded"
                          ? "warning"
                          : level === "down"
                            ? "error"
                            : "default";
                    return (
                      <Tooltip
                        key={r.provider_id}
                        title={
                          r.error_rate < 0
                            ? t("card.health.idleTip")
                            : t("card.health.tip", {
                                requests: r.requests,
                                errors: r.errors,
                                rate: r.error_rate,
                              })
                        }
                      >
                        <Tag color={color} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                          {r.provider_id}
                        </Tag>
                      </Tooltip>
                    );
                  })}
                </Space>
              )}
            </Col>
          </Row>
          {errorStats && errorStats.rows.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--ant-color-border-secondary, #eee)" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
                {t("errors.title")}:
              </Typography.Text>
              <Space size={6} wrap>
                {errorStats.rows.slice(0, 12).map((row) => (
                  <Tag key={row.error_code} color="error" style={{ marginInlineEnd: 0 }}>
                    <code>{row.error_code}</code> × {row.count}
                  </Tag>
                ))}
              </Space>
            </div>
          )}
        </Card>
        </div>
      )}

      <div ref={chartRef}>
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
          <Skeleton.Image style={{ width: "100%", height: 220 }} active />
        )}
      </Card>
      </div>

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

      <div ref={recentRef}>
      <Card title={t("recent.title")}>
        <Table<LogRow>
          rowKey="id"
          dataSource={logs}
          columns={recentColumns}
          pagination={false}
          size="middle"
          locale={{ emptyText: t("recent.empty") }}
          onRow={(row) => ({
            onClick: () => navigate(`/logs?highlight=${row.id}`),
            style: { cursor: "pointer" },
          })}
        />
      </Card>
      </div>

      <PageTour
        pageKey="dashboard"
        steps={[
          {
            target: rangeRef,
            title: tTour("dashboard.s1.title"),
            description: tTour("dashboard.s1.desc"),
          },
          {
            target: statsRef,
            title: tTour("dashboard.s2.title"),
            description: tTour("dashboard.s2.desc"),
          },
          {
            target: chartRef,
            title: tTour("dashboard.s3.title"),
            description: tTour("dashboard.s3.desc"),
          },
          {
            target: recentRef,
            title: tTour("dashboard.s4.title"),
            description: tTour("dashboard.s4.desc"),
          },
        ]}
      />
    </>
  );
}
