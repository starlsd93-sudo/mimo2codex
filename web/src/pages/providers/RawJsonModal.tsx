import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Input,
  Modal,
  Space,
  Typography,
  message,
} from "antd";
import { CodeOutlined } from "@ant-design/icons";

// Raw JSON editor for `providers.json`. Surfaces parse errors inline via an
// <Alert> + concrete error message, disables OK while invalid, and offers
// copy/paste-from-clipboard shortcuts since the textarea contents are often
// big enough that selecting them by hand is annoying.
export function RawJsonModal({
  value,
  setValue,
  onCancel,
  onSubmit,
}: {
  value: string;
  setValue: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation("providers");
  const { t: tCommon } = useTranslation("common");
  const [messageApi, msgCtx] = message.useMessage();
  const [saving, setSaving] = useState(false);

  // Memoize the parse result so an invalid blob also yields a precise error
  // message — surfaced inside <Alert> rather than a tiny gray subtext.
  const parsed = useMemo(
    (): { ok: true } | { ok: false; error: string } => {
      try {
        JSON.parse(value);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    [value]
  );

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      messageApi.success(tCommon("copied"));
    } catch {
      messageApi.error(tCommon("copyFailed"));
    }
  }

  async function onPaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setValue(text);
    } catch {
      messageApi.error(t("rawJson.pasteFailed"));
    }
  }

  return (
    <Modal
      open
      width={840}
      title={t("rawJson.title")}
      onCancel={onCancel}
      onOk={async () => {
        if (!parsed.ok) return;
        setSaving(true);
        try {
          await onSubmit();
        } finally {
          setSaving(false);
        }
      }}
      okText={tCommon("save")}
      cancelText={tCommon("cancel")}
      confirmLoading={saving}
      okButtonProps={{ disabled: !parsed.ok }}
    >
      {msgCtx}
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 0 }}
      >
        {t("rawJson.hint")}
      </Typography.Paragraph>
      <Space style={{ marginBottom: 8 }}>
        <Button
          size="small"
          icon={<CodeOutlined />}
          onClick={() => void onCopy()}
        >
          {tCommon("copy")}
        </Button>
        <Button size="small" onClick={() => void onPaste()}>
          {t("rawJson.pasteBtn")}
        </Button>
      </Space>
      <Input.TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoSize={{ minRows: 10, maxRows: 30 }}
        status={parsed.ok ? "" : "error"}
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      />
      <Alert
        type={parsed.ok ? "success" : "error"}
        showIcon
        style={{ marginTop: 8 }}
        message={parsed.ok ? t("rawJson.valid") : t("rawJson.invalid")}
        description={
          parsed.ok ? undefined : (
            <code style={{ fontSize: 12 }}>{parsed.error}</code>
          )
        }
      />
    </Modal>
  );
}
