import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Select,
  Space,
  Tabs,
  Typography,
  message,
  theme,
} from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { api, type SetupSnippetsResponse } from "../api/client";

type Tab = "auth" | "envkey" | "ccswitch";
type Platform = "mac" | "linux" | "windows";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "linux";
  const p = navigator.platform || "";
  if (/win/i.test(p)) return "windows";
  if (/mac/i.test(p)) return "mac";
  return "linux";
}

function codexPathFor(platform: Platform, file: "auth.json" | "config.toml"): string {
  if (platform === "windows") return `%USERPROFILE%\\.codex\\${file}`;
  return `~/.codex/${file}`;
}

function CodeBlock({ title, code }: { title?: string; code: string }) {
  const { t: tCommon } = useTranslation("common");
  const [messageApi, ctx] = message.useMessage();
  const { token } = theme.useToken();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      messageApi.success(tCommon("copied"));
    } catch {
      // older browsers without clipboard.writeText — silent fail is fine
    }
  }

  return (
    <>
      {ctx}
      <div
        style={{
          background: token.colorFillTertiary,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            padding: "8px 14px",
            borderBottom: title ? `1px solid ${token.colorBorderSecondary}` : "none",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {title && (
            <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: "0.05em" }}>
              {title.toUpperCase()}
            </Typography.Text>
          )}
          <Button size="small" icon={<CopyOutlined />} onClick={copy}>
            {tCommon("copy")}
          </Button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: "12px 14px",
            overflowX: "auto",
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {code}
        </pre>
      </div>
    </>
  );
}

export function SetupSnippets() {
  const { t } = useTranslation("setup");
  const [data, setData] = useState<SetupSnippetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("auth");
  const platform = useMemo(detectPlatform, []);

  async function load(hint?: string) {
    try {
      setError(null);
      const resp = await api.setupSnippets(hint);
      setData(resp);
      setSelectedProvider(resp.bundle.target.providerId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function onProviderChange(id: string) {
    setSelectedProvider(id);
    void load(id);
  }

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message={error}
        closable
        onClose={() => setError(null)}
      />
    );
  }

  if (!data) return null;

  return (
    <>
      <Typography.Paragraph type="secondary">{t("intro")}</Typography.Paragraph>
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Text type="secondary">{t("providerLabel")}:</Typography.Text>
        <Select
          value={selectedProvider ?? data.defaultProviderId}
          onChange={onProviderChange}
          style={{ minWidth: 220 }}
          options={data.providers.map((p) => ({
            value: p.id,
            label:
              p.display_name +
              (p.id === data.defaultProviderId ? ` ${t("defaultTag")}` : ""),
          }))}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("currentModel")}: <code>{data.bundle.target.modelId}</code>
        </Typography.Text>
      </Space>

      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as Tab)}
        items={[
          {
            key: "auth",
            label: t("tab.auth"),
            children: <AuthTab data={data} platform={platform} />,
          },
          {
            key: "envkey",
            label: t("tab.envkey"),
            children: <EnvKeyTab data={data} platform={platform} />,
          },
          {
            key: "ccswitch",
            label: t("tab.ccswitch"),
            children: <CcSwitchTab data={data} />,
          },
        ]}
      />
    </>
  );
}

function AuthTab({
  data,
  platform,
}: {
  data: SetupSnippetsResponse;
  platform: Platform;
}) {
  const { t } = useTranslation("setup");
  const authPath = codexPathFor(platform, "auth.json");
  const tomlPath = codexPathFor(platform, "config.toml");
  return (
    <>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          <Trans i18nKey="auth.warn" ns="setup" values={{ path: authPath }}>
            placeholder<code>placeholder</code>placeholder
          </Trans>
        }
      />

      <Typography.Title level={4}>{t("auth.step1", { path: authPath })}</Typography.Title>
      <CodeBlock code={data.bundle.ccSwitchAuthJson} />

      <Typography.Title level={4}>{t("auth.step2", { path: tomlPath })}</Typography.Title>
      <CodeBlock code={data.bundle.configToml} />

      <Typography.Title level={4}>{t("auth.step3Title")}</Typography.Title>
      <Typography.Paragraph type="secondary">
        <Trans
          i18nKey="auth.step3Body"
          ns="setup"
          values={{ label: data.bundle.target.providerLabel }}
        >
          placeholder<code>placeholder</code>placeholder
        </Trans>
      </Typography.Paragraph>
    </>
  );
}

function EnvKeyTab({
  data,
  platform,
}: {
  data: SetupSnippetsResponse;
  platform: Platform;
}) {
  const { t } = useTranslation("setup");
  const authPath = codexPathFor(platform, "auth.json");
  const shellLabel =
    platform === "windows"
      ? t("envkey.shellWin")
      : platform === "mac"
        ? t("envkey.shellMac")
        : t("envkey.shellLinux");
  const envCmd =
    platform === "windows"
      ? `$env:MIMO2CODEX_KEY = "anything"`
      : `export MIMO2CODEX_KEY=anything`;

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          <Trans i18nKey="envkey.info" ns="setup" values={{ path: authPath }}>
            placeholder<code>placeholder</code>placeholder<code>placeholder</code>placeholder
            <strong>placeholder</strong>placeholder
          </Trans>
        }
      />

      <Typography.Title level={4}>{t("envkey.tomlTitle")}</Typography.Title>
      <CodeBlock code={data.bundle.configTomlEnvKey} />

      <Typography.Title level={4}>{t("envkey.envTitle")}</Typography.Title>
      <CodeBlock title={shellLabel} code={envCmd} />

      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t("envkey.note")}
      </Typography.Paragraph>
    </>
  );
}

function CcSwitchTab({ data }: { data: SetupSnippetsResponse }) {
  const { t } = useTranslation("setup");
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          <Trans i18nKey="ccswitch.info" ns="setup">
            <a
              href="https://github.com/farion1231/cc-switch"
              target="_blank"
              rel="noreferrer"
            >
              cc-switch
            </a>
            placeholder<strong>placeholder</strong>placeholder
          </Trans>
        }
      />

      <Typography.Title level={4}>{t("ccswitch.authTitle")}</Typography.Title>
      <CodeBlock code={data.bundle.ccSwitchAuthJson} />

      <Typography.Title level={4}>{t("ccswitch.tomlTitle")}</Typography.Title>
      <CodeBlock code={data.bundle.ccSwitchConfigToml} />

      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t("ccswitch.note")}
      </Typography.Paragraph>
    </>
  );
}
