import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Descriptions,
  Input,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  api,
  type CodexDirInfo,
  type CodexState,
} from "../../api/client";

// Pull `model` and `model_provider` out of a config.toml blob. We only need
// these two fields for the state card display; a full TOML parser would be
// overkill for a regex match on two known keys.
function parseConfigToml(text: string | null): {
  model: string | null;
  provider: string | null;
} {
  if (!text) return { model: null, provider: null };
  const modelMatch = /^\s*model\s*=\s*"([^"\n]+)"/m.exec(text);
  const providerMatch = /^\s*model_provider\s*=\s*"([^"\n]+)"/m.exec(text);
  return {
    model: modelMatch?.[1] ?? null,
    provider: providerMatch?.[1] ?? null,
  };
}

export function CurrentStateCard({
  state,
  dirInfo,
  onReload,
}: {
  state: CodexState;
  dirInfo: CodexDirInfo | null;
  onReload: () => void;
}) {
  const { t } = useTranslation("codexEnable");
  const ownerTag =
    state.authJsonOwner === "mimo2codex" ? (
      <Tag color="success">{t("state.owner.mimo2codex")}</Tag>
    ) : state.authJsonOwner === "external" ? (
      <Tag color="warning">{t("state.owner.external")}</Tag>
    ) : (
      <Tag>{t("state.owner.missing")}</Tag>
    );
  const currentToml = parseConfigToml(state.configTomlText);

  return (
    <Card title={t("state.title")} style={{ marginBottom: 16 }}>
      <Descriptions
        column={1}
        bordered
        size="small"
        labelStyle={{ width: 160 }}
        items={[
          {
            key: "codexDir",
            label: t("state.codexDir"),
            children: (
              <CodexDirRow
                effective={state.codexDir}
                dirInfo={dirInfo}
                onReload={onReload}
              />
            ),
          },
          {
            key: "auth",
            label: t("state.authJson"),
            children: (
              <Space>
                {ownerTag}
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  <code>{state.authPath}</code>
                </Typography.Text>
              </Space>
            ),
          },
          {
            key: "toml",
            label: t("state.configToml"),
            children: state.configTomlExists ? (
              <Space wrap>
                {currentToml.provider && (
                  <Tag>
                    {t("state.tomlProvider")}=<code>{currentToml.provider}</code>
                  </Tag>
                )}
                {currentToml.model && (
                  <Tag>
                    {t("state.tomlModel")}=<code>{currentToml.model}</code>
                  </Tag>
                )}
                {!currentToml.provider && !currentToml.model && (
                  <Tag>{t("state.tomlUnknown")}</Tag>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  <code>{state.tomlPath}</code>
                </Typography.Text>
              </Space>
            ) : (
              <Tag>{t("state.owner.missing")}</Tag>
            ),
          },
          {
            key: "override",
            label: t("state.override"),
            children: state.activeOverride ? (
              <Tag color="success">
                <code>
                  {state.activeOverride.providerId} /{" "}
                  {state.activeOverride.modelId}
                </code>
              </Tag>
            ) : (
              <Tag>{t("state.overrideNone")}</Tag>
            ),
          },
        ]}
      />
    </Card>
  );
}

// Inline edit row for the Codex directory override. Renders read-only by
// default with Edit / Reset buttons; flips to an input+save+cancel form when
// the user clicks Edit.
function CodexDirRow({
  effective,
  dirInfo,
  onReload,
}: {
  effective: string;
  dirInfo: CodexDirInfo | null;
  onReload: () => void;
}) {
  const { t } = useTranslation("codexEnable");
  const { t: tCommon } = useTranslation("common");
  const [messageApi, msgCtx] = message.useMessage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(effective);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whenever the parent reloads (post-save / post-reset) sync the draft so
  // the next edit starts from the new effective value.
  useEffect(() => {
    if (!editing) setDraft(effective);
  }, [effective, editing]);

  const source = dirInfo?.source ?? "default";
  const sourceLabel =
    source === "user"
      ? t("state.codexDirSourceUser")
      : source === "env"
        ? t("state.codexDirSourceEnv")
        : t("state.codexDirSourceDefault");

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(t("state.codexDirPlaceholder"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.setCodexDir(trimmed);
      setEditing(false);
      messageApi.success(t("state.codexDirSaved"));
      onReload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      await api.clearCodexDir();
      setEditing(false);
      messageApi.success(t("state.codexDirReseted"));
      onReload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <>
        {msgCtx}
        <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("state.codexDirPlaceholder")}
            disabled={saving}
            onPressEnter={() => void save()}
            autoFocus
          />
          <Button
            type="primary"
            icon={<CheckOutlined />}
            loading={saving}
            onClick={() => void save()}
            title={tCommon("save")}
          />
          <Button
            icon={<CloseOutlined />}
            disabled={saving}
            onClick={() => {
              setEditing(false);
              setDraft(effective);
              setError(null);
            }}
            title={tCommon("cancel")}
          />
        </Space.Compact>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}
        >
          {t("state.codexDirHelp")}
        </Typography.Paragraph>
        {error && (
          <Typography.Text type="danger" style={{ fontSize: 11 }}>
            {error}
          </Typography.Text>
        )}
      </>
    );
  }

  return (
    <>
      {msgCtx}
      <Space wrap>
        <code>{effective}</code>
        <Tag
          color={
            source === "user" ? "blue" : source === "env" ? "purple" : "default"
          }
        >
          {sourceLabel}
        </Tag>
        <Button
          size="small"
          type="text"
          icon={<EditOutlined />}
          onClick={() => {
            setDraft(effective);
            setEditing(true);
          }}
        >
          {t("state.codexDirEdit")}
        </Button>
        {source === "user" && (
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={saving}
            onClick={() => void reset()}
          >
            {t("state.codexDirReset")}
          </Button>
        )}
      </Space>
    </>
  );
}
