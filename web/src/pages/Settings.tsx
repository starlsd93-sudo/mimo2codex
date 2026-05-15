import { useEffect, useState } from "react";
import {
  Alert,
  Card,
  Form,
  Input,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { api, type ProviderInfo } from "../api/client";
import { KeyStatusBanner } from "../components/KeyStatusBanner";
import {
  useAppConfig,
  type ThemeMode,
} from "../contexts/AppConfigContext";
import { SUPPORTED_LANGS, type SupportedLang } from "../i18n";

const THEME_MODES: ThemeMode[] = ["dark", "light", "auto"];

export function Settings() {
  const { t } = useTranslation("settings");
  const { themeMode, lang, refresh } = useAppConfig();
  const [messageApi, contextHolder] = message.useMessage();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [dataDir, setDataDir] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    try {
      setError(null);
      const [p, h] = await Promise.all([api.providers(), api.health()]);
      setProviders(p.providers);
      setDataDir(h.dataDir);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveSetting(key: string, value: string) {
    try {
      setError(null);
      await api.setSetting(key, value);
      await refresh();
      messageApi.success(t("ui.saved", { key }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const providerColumns: ColumnsType<ProviderInfo> = [
    {
      title: t("providers.columns.provider"),
      dataIndex: "display_name",
      key: "provider",
      render: (name: string, row) => (
        <Space>
          <strong>{name}</strong>
          {row.default && <Tag color="blue">{t("providers.tag.default")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("providers.columns.status"),
      dataIndex: "api_key_present",
      key: "status",
      render: (present: boolean) =>
        present ? (
          <Tag color="success">{t("providers.tag.keyPresent")}</Tag>
        ) : (
          <Tag color="warning">{t("providers.tag.keyMissing")}</Tag>
        ),
    },
    {
      title: t("providers.columns.baseUrl"),
      dataIndex: "base_url",
      key: "base_url",
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t("providers.columns.defaultModel"),
      dataIndex: "default_model",
      key: "default_model",
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t("providers.columns.envVar"),
      dataIndex: "api_key_env",
      key: "env",
      render: (env: string[]) => <code>{env.join(", ")}</code>,
    },
  ];

  return (
    <>
      {contextHolder}
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

      <Card title={t("ui.title")} style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Form.Item label={t("ui.theme")}>
            <Segmented<ThemeMode>
              value={themeMode}
              options={THEME_MODES.map((m) => ({
                label: t(`ui.themeOption.${m}`),
                value: m,
              }))}
              onChange={(v) => void saveSetting("ui.theme", v)}
            />
          </Form.Item>
          <Form.Item label={t("ui.lang")}>
            <Segmented<SupportedLang>
              value={lang}
              options={SUPPORTED_LANGS.map((l) => ({ label: l, value: l }))}
              onChange={(v) => void saveSetting("ui.lang", v)}
            />
          </Form.Item>
          <Alert type="info" showIcon message={t("ui.savedHint")} />
        </Form>
      </Card>

      <Card title={t("apiKey.title")} style={{ marginBottom: 16 }}>
        <KeyStatusBanner providers={providers} />
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message={<strong>{t("apiKey.info")}</strong>}
          description={
            <>
              <ul style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
                <li>
                  {t("apiKey.mimoLabel")}: <code>MIMO_API_KEY</code>
                </li>
                <li>
                  {t("apiKey.dsLabel")}: <code>DS_API_KEY</code> /{" "}
                  <code>DEEPSEEK_API_KEY</code>
                </li>
              </ul>
              <div style={{ marginTop: 8 }}>
                <code>export DS_API_KEY=sk-xxxxxx && mimo2codex --model ds</code>
              </div>
            </>
          }
        />
      </Card>

      <Card title={t("providers.title")} style={{ marginBottom: 16 }}>
        <Table<ProviderInfo>
          rowKey="id"
          dataSource={providers}
          columns={providerColumns}
          pagination={false}
          size="middle"
        />
      </Card>

      <Card title={t("dataDir.title")}>
        <Form layout="vertical">
          <Form.Item label={t("dataDir.currentLabel")}>
            <Input value={dataDir} disabled />
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("dataDir.hint")}
        </Typography.Paragraph>
      </Card>
    </>
  );
}
