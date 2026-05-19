import { useTranslation } from "react-i18next";
import { Button, Card, Space, Typography } from "antd";
import type { CodexState } from "../../api/client";
import type { Busy } from "./types";

// Slim card shown inside the "Thinking & Override" tab. Either displays the
// active runtime override + a clear button, or an empty-state hint pointing
// to the Targets tab where users can set one.
export function RuntimeOverrideCard({
  state,
  busy,
  onClear,
}: {
  state: CodexState;
  busy: Busy;
  onClear: () => Promise<void>;
}) {
  const { t } = useTranslation("codexEnable");
  return (
    <Card size="small" title={t("override.title")} style={{ marginBottom: 12 }}>
      {state.activeOverride ? (
        <Space wrap>
          <span>
            {t("override.current")}:{" "}
            <code>
              {state.activeOverride.providerId} /{" "}
              {state.activeOverride.modelId}
            </code>
          </span>
          <Button
            size="small"
            onClick={() => void onClear()}
            loading={busy?.kind === "clear"}
          >
            {busy?.kind === "clear"
              ? t("override.clearBusy")
              : t("override.clear")}
          </Button>
        </Space>
      ) : (
        <Typography.Text type="secondary">{t("override.empty")}</Typography.Text>
      )}
    </Card>
  );
}
