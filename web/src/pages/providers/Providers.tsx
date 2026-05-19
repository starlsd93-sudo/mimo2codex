import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CodeOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  api,
  type GenericProviderSpec,
  type GenericProvidersResponse,
  type ProviderPresetClient,
} from "../../api/client";
import { PageTour } from "../../components/PageTour";
import {
  emptyFormValues,
  formValuesToSpec,
  RESERVED_IDS,
  specToFormValues,
  type FormValues,
} from "./formValues";
import { ProviderFormModal } from "./ProviderFormModal";
import { RawJsonModal } from "./RawJsonModal";

export function Providers() {
  const { t } = useTranslation("providers");
  const { t: tTour } = useTranslation("tour");
  const [messageApi, msgCtx] = message.useMessage();
  const [modal, modalCtx] = Modal.useModal();
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const rawJsonBtnRef = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GenericProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    | { mode: "create"; values: FormValues }
    | { mode: "edit"; originalId: string; values: FormValues }
    | null
  >(null);
  const [rawEditor, setRawEditor] = useState<string | null>(null);
  // 已知厂商预设，仅用于在 ProviderFormModal 里做"输入命中即自动套用 features"。
  // 加载失败不阻塞页面 —— 预设缺失只是失去自动化便利，手动配置仍可用。
  const [presets, setPresets] = useState<ProviderPresetClient[]>([]);

  async function load() {
    try {
      setError(null);
      const resp = await api.genericProviders();
      setData(resp);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    api
      .providerPresets()
      .then((r) => setPresets(r.presets))
      .catch(() => {
        /* 静默 */
      });
  }, []);

  async function save(updated: GenericProviderSpec[]) {
    try {
      setError(null);
      setSuccess(null);
      const resp = await api.saveGenericProviders(updated);
      const key = resp.restartRequired
        ? "saved.withRestart"
        : "saved.withoutRestart";
      const text = t(key, { path: resp.path });
      setSuccess(text);
      messageApi.success(text);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startCreate() {
    setEditing({ mode: "create", values: emptyFormValues() });
  }
  function startEdit(spec: GenericProviderSpec) {
    setEditing({
      mode: "edit",
      originalId: spec.id,
      values: specToFormValues(spec),
    });
  }

  async function remove(id: string) {
    if (!data) return;
    modal.confirm({
      title: t("deleteConfirm", { id }),
      icon: <DeleteOutlined />,
      okButtonProps: { danger: true },
      onOk: async () => {
        await save(data.specs.filter((s) => s.id !== id));
      },
    });
  }

  async function commitForm(values: FormValues) {
    if (!editing || !data) return;
    const id = values.id.trim();
    if (!id) {
      setError(t("form.validate.idRequired"));
      return;
    }
    if (RESERVED_IDS.has(id)) {
      setError(t("form.validate.idReserved", { id }));
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
      setError(t("form.validate.idFormat", { id }));
      return;
    }
    const originalId = editing.mode === "edit" ? editing.originalId : null;
    if (data.specs.some((s) => s.id === id && s.id !== originalId)) {
      setError(t("form.validate.idDup", { id }));
      return;
    }
    if (!values.baseUrl.trim()) {
      setError(t("form.validate.baseUrlRequired"));
      return;
    }
    if (!values.envKey.trim()) {
      setError(t("form.validate.envKeyRequired"));
      return;
    }
    if (!values.defaultModel.trim()) {
      setError(t("form.validate.defaultModelRequired"));
      return;
    }
    const next = formValuesToSpec(values);
    const merged =
      editing.mode === "create"
        ? [...data.specs, next]
        : data.specs.map((s) => (s.id === editing.originalId ? next : s));
    setEditing(null);
    await save(merged);
  }

  async function commitRawJson() {
    if (rawEditor == null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawEditor);
    } catch (err) {
      setError(t("rawJson.parseError", { message: (err as Error).message }));
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      setError(t("rawJson.notObject"));
      return;
    }
    const obj = parsed as { providers?: unknown };
    if (!Array.isArray(obj.providers)) {
      setError(t("rawJson.missingProviders"));
      return;
    }
    setRawEditor(null);
    await save(obj.providers as GenericProviderSpec[]);
  }

  const columns: ColumnsType<GenericProviderSpec> = useMemo(
    () => [
      {
        title: t("table.columns.id"),
        dataIndex: "id",
        key: "id",
        render: (id: string, row) => (
          <Space>
            <strong>
              <code>{id}</code>
            </strong>
            {row.shortcut && row.shortcut !== row.id && (
              <Tag>{t("table.shortcutTag", { value: row.shortcut })}</Tag>
            )}
          </Space>
        ),
      },
      {
        title: t("table.columns.displayName"),
        key: "displayName",
        render: (_, row) => row.displayName ?? row.id,
      },
      {
        title: t("table.columns.baseUrl"),
        dataIndex: "baseUrl",
        key: "baseUrl",
        render: (v: string) => <code style={{ fontSize: 11 }}>{v}</code>,
      },
      {
        title: t("table.columns.defaultModel"),
        dataIndex: "defaultModel",
        key: "defaultModel",
        render: (v: string) => <code>{v}</code>,
      },
      {
        title: t("table.columns.wireApi"),
        dataIndex: "wireApi",
        key: "wireApi",
        render: (v: GenericProviderSpec["wireApi"]) => (
          <Tag color={v === "responses" ? "success" : "default"}>
            {v ?? "chat"}
          </Tag>
        ),
      },
      {
        title: t("table.columns.models"),
        key: "models",
        render: (_, row) =>
          row.models && row.models.length > 0 ? (
            <Tag>{t("table.modelCountTag", { count: row.models.length })}</Tag>
          ) : (
            <Tag>{t("table.passthroughTag")}</Tag>
          ),
      },
      {
        title: t("table.columns.ops"),
        key: "ops",
        align: "right",
        width: 200,
        render: (_, row) => (
          <Space>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => startEdit(row)}
              disabled={!data?.editable}
            >
              {t("action.edit")}
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => void remove(row.id)}
              disabled={!data?.editable}
            >
              {t("action.delete")}
            </Button>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, data?.editable]
  );

  return (
    <>
      {msgCtx}
      {modalCtx}
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        {t("title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        <Trans i18nKey="intro" ns="providers">
          {"placeholder"}
          <a
            href="https://github.com/7as0nch/mimo2codex/blob/main/doc/generic-providers.zh.md"
            target="_blank"
            rel="noreferrer"
          >
            placeholder
          </a>
          {"placeholder"}
        </Trans>
      </Typography.Paragraph>

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
      {success && (
        <Alert
          type="warning"
          showIcon
          message={success}
          closable
          onClose={() => setSuccess(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {data && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              <Space wrap>
                <strong>{t("file.title")}:</strong>
                <code>{data.path ?? "(unavailable)"}</code>
                {data.source === "explicit" && <Tag>{t("file.explicit")}</Tag>}
                {!data.exists && data.path && (
                  <Tag color="warning">{t("file.notCreated")}</Tag>
                )}
                {!data.editable && (
                  <Tag color="error">
                    {t("file.notEditable", { notice: data.notice ?? "" })}
                  </Tag>
                )}
              </Space>
            }
            description={
              data.error ? (
                <div style={{ marginTop: 8 }}>
                  {t("file.currentError", { error: data.error })}
                </div>
              ) : undefined
            }
          />

          <Card>
            <Space style={{ marginBottom: 16 }}>
              <Button
                ref={addBtnRef}
                type="primary"
                icon={<PlusOutlined />}
                onClick={startCreate}
                disabled={!data.editable}
              >
                {t("action.create")}
              </Button>
              <Button
                ref={rawJsonBtnRef}
                icon={<CodeOutlined />}
                onClick={() =>
                  setRawEditor(
                    JSON.stringify({ providers: data.specs }, null, 2)
                  )
                }
                disabled={!data.editable}
              >
                {t("action.rawJson")}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void load()}>
                {t("action.refresh")}
              </Button>
            </Space>

            <div ref={tableRef}>
              <Table<GenericProviderSpec>
                rowKey="id"
                dataSource={data.specs}
                columns={columns}
                pagination={false}
                size="middle"
                locale={{ emptyText: t("table.empty") }}
              />
            </div>
          </Card>
        </>
      )}

      {editing && (
        <ProviderFormModal
          mode={editing.mode}
          initialValues={editing.values}
          presets={presets}
          onCancel={() => setEditing(null)}
          onSubmit={commitForm}
        />
      )}

      {rawEditor != null && (
        <RawJsonModal
          value={rawEditor}
          setValue={setRawEditor}
          onCancel={() => setRawEditor(null)}
          onSubmit={() => void commitRawJson()}
        />
      )}

      <PageTour
        pageKey="providers"
        steps={[
          {
            target: addBtnRef,
            title: tTour("providers.s1.title"),
            description: tTour("providers.s1.desc"),
          },
          {
            target: rawJsonBtnRef,
            title: tTour("providers.s2.title"),
            description: tTour("providers.s2.desc"),
          },
          {
            target: tableRef,
            title: tTour("providers.s3.title"),
            description: tTour("providers.s3.desc"),
          },
        ]}
      />
    </>
  );
}
