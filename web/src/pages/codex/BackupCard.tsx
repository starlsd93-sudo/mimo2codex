import { Trans, useTranslation } from "react-i18next";
import { Button, Card, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { CodexBackupPair, CodexState } from "../../api/client";
import type { Busy } from "./types";

// Backup history table shown inside the "Backups" tab. Each row represents
// one (auth.json, config.toml) snapshot taken right before a codex-apply,
// with restore / delete actions.
export function BackupCard({
  state,
  busy,
  onRestore,
  onDelete,
}: {
  state: CodexState;
  busy: Busy;
  onRestore: (b: CodexBackupPair) => void;
  onDelete: (b: CodexBackupPair) => void;
}) {
  const { t } = useTranslation("codexEnable");

  const columns: ColumnsType<CodexBackupPair> = [
    {
      title: t("backup.columns.ts"),
      dataIndex: "ts",
      key: "ts",
      render: (v: number) => <code style={{ fontSize: 11 }}>{v}</code>,
    },
    {
      title: t("backup.columns.time"),
      dataIndex: "ts",
      key: "time",
      render: (v: number) => new Date(v).toLocaleString(),
    },
    {
      title: t("backup.columns.type"),
      key: "type",
      render: (_, b) =>
        b.preserved ? (
          <Tag color="success" title={t("backup.type.preservedTitle")}>
            {t("backup.type.preserved")}
          </Tag>
        ) : b.authBackupOwner === "mimo2codex" ? (
          <Tag>{t("backup.type.snapshotMimo")}</Tag>
        ) : (
          <Tag>{t("backup.type.snapshot")}</Tag>
        ),
    },
    {
      title: t("backup.columns.providerModel"),
      key: "providerModel",
      render: (_, b) =>
        b.provider || b.model ? (
          <code style={{ fontSize: 12 }}>
            {b.provider ?? "?"} / {b.model ?? "?"}
          </code>
        ) : (
          <Tag>{t("backup.notRecorded")}</Tag>
        ),
    },
    {
      title: t("backup.columns.auth"),
      key: "auth",
      render: (_, b) =>
        b.authBackup ? (
          <Tag color="success">{t("backup.has")}</Tag>
        ) : (
          <Tag>{t("backup.missing")}</Tag>
        ),
    },
    {
      title: t("backup.columns.toml"),
      key: "toml",
      render: (_, b) =>
        b.tomlBackup ? (
          <Tag color="success">{t("backup.has")}</Tag>
        ) : (
          <Tag>{t("backup.missing")}</Tag>
        ),
    },
    {
      title: t("backup.columns.ops"),
      key: "ops",
      align: "right",
      width: 200,
      render: (_, b) => {
        const restoreBusy =
          busy?.kind === "restore" && busy.key === String(b.ts);
        const deleteBusy =
          busy?.kind === "delete-backup" && busy.key === String(b.ts);
        return (
          <Space>
            <Button
              size="small"
              onClick={() => onRestore(b)}
              loading={restoreBusy}
              disabled={!!busy && !restoreBusy}
            >
              {restoreBusy ? t("backup.restoreBusy") : t("backup.restore")}
            </Button>
            <Button
              size="small"
              danger
              onClick={() => onDelete(b)}
              loading={deleteBusy}
              disabled={!!busy && !deleteBusy}
              title={
                b.preserved
                  ? t("backup.deletePreservedTitle")
                  : t("backup.deleteTitle")
              }
            >
              {deleteBusy ? t("backup.deleteBusy") : t("backup.delete")}
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      title={t("backup.title")}
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <Trans i18nKey="backup.intro" ns="codexEnable">
            <strong>placeholder</strong>
          </Trans>
        </Typography.Text>
      }
    >
      <Table<CodexBackupPair>
        rowKey="ts"
        dataSource={state.backups}
        columns={columns}
        pagination={false}
        size="middle"
        locale={{ emptyText: t("backup.empty") }}
      />
    </Card>
  );
}
