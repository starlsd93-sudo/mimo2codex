import { useTranslation } from "react-i18next";
import { Button, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ThunderboltOutlined } from "@ant-design/icons";
import type { CodexTarget } from "../../api/client";
import type { Busy, ProbeState } from "./types";

// One section per provider inside the Targets tab: header (provider name +
// key status) above a table of (model, source, context, ops) rows. Hoisted
// out of CodexEnable.tsx so the page file stays focused on orchestration.
export function ProviderBlock({
  providerDisplayName,
  targets,
  busy,
  probes,
  onApply,
  onOverride,
  onProbe,
}: {
  providerDisplayName: string;
  targets: CodexTarget[];
  busy: Busy;
  probes: Record<string, ProbeState>;
  onApply: (t: CodexTarget) => void;
  onOverride: (t: CodexTarget) => Promise<void>;
  onProbe: (t: CodexTarget) => Promise<void>;
}) {
  const { t } = useTranslation("codexEnable");
  const hasKey = targets[0]?.hasKey ?? false;

  const columns: ColumnsType<CodexTarget> = [
    {
      title: t("targets.columns.model"),
      key: "model",
      render: (_, row) => {
        const probe = probes[`${row.providerId}::${row.modelId}`]?.result;
        return (
          <Space wrap>
            <strong>
              <code>{row.modelId}</code>
            </strong>
            {row.displayName && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.displayName}
              </Typography.Text>
            )}
            {row.isCurrentOverride && (
              <Tag color="success">{t("targets.activeOverride")}</Tag>
            )}
            {probe && (
              <Tooltip
                title={
                  probe.ok
                    ? probe.sample
                      ? t("targets.probeSample", { sample: probe.sample })
                      : ""
                    : probe.error?.message ?? ""
                }
              >
                <Tag
                  color={probe.ok ? "success" : "error"}
                  style={{ marginInlineEnd: 0 }}
                >
                  {probe.ok
                    ? t("targets.probeOk", { latency: probe.latencyMs })
                    : t("targets.probeFail", {
                        code: probe.error?.code ?? "error",
                      })}
                </Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: t("targets.columns.source"),
      dataIndex: "source",
      key: "source",
      render: (v: CodexTarget["source"]) =>
        v === "builtin" ? (
          <Tag>{t("targets.source.builtin")}</Tag>
        ) : (
          <Tag color="success">{t("targets.source.custom")}</Tag>
        ),
    },
    {
      title: t("targets.columns.context"),
      dataIndex: "contextWindow",
      key: "contextWindow",
      render: (v: number | null) => (v ? v.toLocaleString() : "—"),
    },
    {
      title: t("targets.columns.ops"),
      key: "ops",
      align: "right",
      width: 420,
      render: (_, row) => {
        const key = `${row.providerId}::${row.modelId}`;
        const applyBusy = busy?.kind === "apply" && busy.key === key;
        const overrideBusy = busy?.kind === "override" && busy.key === key;
        const probeBusy = probes[key]?.running ?? false;
        return (
          <Space>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={() => void onProbe(row)}
              loading={probeBusy}
              disabled={!hasKey}
              title={
                hasKey
                  ? t("targets.probeTitle")
                  : t("targets.overrideDisabledTitle")
              }
            >
              {probeBusy ? t("targets.probeBusy") : t("targets.probeBtn")}
            </Button>
            <Button
              type="primary"
              onClick={() => onApply(row)}
              loading={applyBusy}
              disabled={!!busy && !applyBusy}
              title={t("targets.applyTitle")}
            >
              {applyBusy ? t("targets.applyBusy") : t("targets.applyBtn")}
            </Button>
            <Button
              onClick={() => void onOverride(row)}
              loading={overrideBusy}
              disabled={(!!busy && !overrideBusy) || !hasKey}
              title={
                hasKey
                  ? t("targets.overrideTitle")
                  : t("targets.overrideDisabledTitle")
              }
            >
              {overrideBusy
                ? t("targets.overrideBusy")
                : t("targets.overrideBtn")}
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
        {providerDisplayName}{" "}
        {hasKey ? (
          <Tag color="success">{t("targets.hasKey")}</Tag>
        ) : (
          <Tag color="warning">{t("targets.missingKey")}</Tag>
        )}
      </Typography.Title>
      <Table<CodexTarget>
        rowKey={(r) => `${r.providerId}::${r.modelId}`}
        dataSource={targets}
        columns={columns}
        pagination={false}
        size="middle"
      />
    </div>
  );
}
