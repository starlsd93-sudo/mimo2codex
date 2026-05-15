import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
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
  MinusCircleOutlined,
} from "@ant-design/icons";
import {
  api,
  type GenericProviderModelSpec,
  type GenericProviderSpec,
  type GenericProvidersResponse,
} from "../api/client";

// Built-in provider ids — the user cannot create generics with these.
const RESERVED_IDS = new Set(["mimo", "deepseek"]);

interface FormValues extends GenericProviderSpec {
  wireApiDisplay: "chat" | "responses";
  forceParallelToolCalls: boolean;
  featWebSearch: boolean;
  // minimax-compat: 把 features 里的严格兼容子开关平铺到表单顶层，方便 antd Form 绑定。
  featMinimaxCompat: boolean;
  featDropNullStrict: boolean;
  featDropNullContent: boolean;
  featDropToolChoiceAuto: boolean;
  featDropStreamOptions: boolean;
  featDropParallelToolCalls: boolean;
  featMergeSystemMessages: boolean;
  featExtractThinkTags: boolean;
  // minimax-compat: 顶层 forceDefaultModel 是非 features 字段，单独平铺也是为了表单绑定方便。
  featForceDefaultModel: boolean;
}

function emptyFormValues(): FormValues {
  return {
    id: "",
    shortcut: "",
    displayName: "",
    baseUrl: "",
    envKey: "",
    defaultModel: "",
    wireApi: "chat",
    wireApiDisplay: "chat",
    models: [],
    features: { forceParallelToolCalls: false, webSearch: false },
    forceParallelToolCalls: false,
    featWebSearch: false,
    featMinimaxCompat: false,
    featDropNullStrict: false,
    featDropNullContent: false,
    featDropToolChoiceAuto: false,
    featDropStreamOptions: false,
    featDropParallelToolCalls: false,
    featMergeSystemMessages: false,
    featExtractThinkTags: false,
    featForceDefaultModel: false,
    docsUrl: "",
  };
}

function specToFormValues(spec: GenericProviderSpec): FormValues {
  const wire = spec.wireApi ?? "chat";
  return {
    ...spec,
    shortcut: spec.shortcut ?? "",
    displayName: spec.displayName ?? "",
    wireApi: wire,
    wireApiDisplay: wire,
    models: spec.models ? spec.models.map((m) => ({ ...m })) : [],
    features: {
      forceParallelToolCalls: !!spec.features?.forceParallelToolCalls,
      webSearch: !!spec.features?.webSearch,
      // 平铺 minimax-compat 子开关
      minimaxCompat: !!spec.features?.minimaxCompat,
      dropNullStrict: !!spec.features?.dropNullStrict,
      dropNullContent: !!spec.features?.dropNullContent,
      dropToolChoiceAuto: !!spec.features?.dropToolChoiceAuto,
      dropStreamOptions: !!spec.features?.dropStreamOptions,
      dropParallelToolCalls: !!spec.features?.dropParallelToolCalls,
      mergeSystemMessages: !!spec.features?.mergeSystemMessages,
      extractThinkTags: !!spec.features?.extractThinkTags,
    },
    forceParallelToolCalls: !!spec.features?.forceParallelToolCalls,
    featWebSearch: !!spec.features?.webSearch,
    featMinimaxCompat: !!spec.features?.minimaxCompat,
    featDropNullStrict: !!spec.features?.dropNullStrict,
    featDropNullContent: !!spec.features?.dropNullContent,
    featDropToolChoiceAuto: !!spec.features?.dropToolChoiceAuto,
    featDropStreamOptions: !!spec.features?.dropStreamOptions,
    featDropParallelToolCalls: !!spec.features?.dropParallelToolCalls,
    featMergeSystemMessages: !!spec.features?.mergeSystemMessages,
    featExtractThinkTags: !!spec.features?.extractThinkTags,
    featForceDefaultModel: !!spec.forceDefaultModel,
    docsUrl: spec.docsUrl ?? "",
  };
}

function formValuesToSpec(form: FormValues): GenericProviderSpec {
  const out: GenericProviderSpec = {
    id: form.id.trim(),
    baseUrl: form.baseUrl.trim(),
    envKey: form.envKey.trim(),
    defaultModel: form.defaultModel.trim(),
  };
  if (form.shortcut?.trim()) out.shortcut = form.shortcut.trim();
  if (form.displayName?.trim()) out.displayName = form.displayName.trim();
  if (form.wireApiDisplay === "responses") out.wireApi = "responses";
  const models = (form.models ?? [])
    .map((m) => ({ ...m, id: (m.id ?? "").trim() }))
    .filter((m) => m.id);
  if (models.length > 0) out.models = models;
  const features: Record<string, boolean> = {};
  if (form.forceParallelToolCalls) features.forceParallelToolCalls = true;
  if (form.featWebSearch) features.webSearch = true;
  // minimax-compat: 6 个子开关 + 1 个一键预设。开关默认 false → 写入时只在 true 时落盘
  // 以保持 providers.json 清爽，与既有 forceParallelToolCalls / webSearch 处理一致。
  if (form.featMinimaxCompat) features.minimaxCompat = true;
  if (form.featDropNullStrict) features.dropNullStrict = true;
  if (form.featDropNullContent) features.dropNullContent = true;
  if (form.featDropToolChoiceAuto) features.dropToolChoiceAuto = true;
  if (form.featDropStreamOptions) features.dropStreamOptions = true;
  if (form.featDropParallelToolCalls) features.dropParallelToolCalls = true;
  if (form.featMergeSystemMessages) features.mergeSystemMessages = true;
  if (form.featExtractThinkTags) features.extractThinkTags = true;
  if (Object.keys(features).length > 0) out.features = features;
  // minimax-compat: 顶层 forceDefaultModel
  if (form.featForceDefaultModel) out.forceDefaultModel = true;
  if (form.docsUrl?.trim()) out.docsUrl = form.docsUrl.trim();
  return out;
}

export function Providers() {
  const { t } = useTranslation("providers");
  const [messageApi, msgCtx] = message.useMessage();
  const [modal, modalCtx] = Modal.useModal();
  const [data, setData] = useState<GenericProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    | { mode: "create"; values: FormValues }
    | { mode: "edit"; originalId: string; values: FormValues }
    | null
  >(null);
  const [rawEditor, setRawEditor] = useState<string | null>(null);

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

  async function save(updated: GenericProviderSpec[]) {
    try {
      setError(null);
      setSuccess(null);
      const resp = await api.saveGenericProviders(updated);
      const key = resp.restartRequired ? "saved.withRestart" : "saved.withoutRestart";
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
          <Tag color={v === "responses" ? "success" : "default"}>{v ?? "chat"}</Tag>
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
                type="primary"
                icon={<PlusOutlined />}
                onClick={startCreate}
                disabled={!data.editable}
              >
                {t("action.create")}
              </Button>
              <Button
                icon={<CodeOutlined />}
                onClick={() =>
                  setRawEditor(JSON.stringify({ providers: data.specs }, null, 2))
                }
                disabled={!data.editable}
              >
                {t("action.rawJson")}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void load()}>
                {t("action.refresh")}
              </Button>
            </Space>

            <Table<GenericProviderSpec>
              rowKey="id"
              dataSource={data.specs}
              columns={columns}
              pagination={false}
              size="middle"
              locale={{ emptyText: t("table.empty") }}
            />
          </Card>
        </>
      )}

      {editing && (
        <ProviderFormModal
          mode={editing.mode}
          initialValues={editing.values}
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
    </>
  );
}

function ProviderFormModal({
  mode,
  initialValues,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  initialValues: FormValues;
  onCancel: () => void;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const { t } = useTranslation("providers");
  const { t: tCommon } = useTranslation("common");
  const [form] = Form.useForm<FormValues>();

  const title =
    mode === "create"
      ? t("form.titleCreate")
      : t("form.titleEdit", { name: initialValues.id || "Provider" });

  return (
    <Modal
      open
      width={760}
      title={title}
      onCancel={onCancel}
      okText={tCommon("save")}
      cancelText={tCommon("cancel")}
      onOk={async () => {
        const values = await form.validateFields();
        await onSubmit(values);
      }}
      destroyOnClose
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={initialValues}
        preserve={false}
      >
        <Form.Item
          name="id"
          label={t("form.fields.id")}
          rules={[{ required: true, message: t("form.validate.idRequired") }]}
          extra={t("form.fields.idHint")}
        >
          <Input
            placeholder={t("form.fields.idPlaceholder")}
            disabled={mode === "edit"}
          />
        </Form.Item>

        <Form.Item name="displayName" label={t("form.fields.displayName")}>
          <Input placeholder={t("form.fields.displayNamePlaceholder")} />
        </Form.Item>

        <Form.Item
          name="shortcut"
          label={t("form.fields.shortcut")}
          extra={t("form.fields.shortcutHint")}
        >
          <Input placeholder={t("form.fields.shortcutPlaceholder")} />
        </Form.Item>

        <Form.Item
          name="baseUrl"
          label={t("form.fields.baseUrl")}
          rules={[
            { required: true, message: t("form.validate.baseUrlRequired") },
          ]}
          extra={
            <Trans i18nKey="form.fields.baseUrlHint" ns="providers">
              {"placeholder"}
            </Trans>
          }
        >
          <Input placeholder={t("form.fields.baseUrlPlaceholder")} />
        </Form.Item>

        <Form.Item
          name="envKey"
          label={t("form.fields.envKey")}
          rules={[
            { required: true, message: t("form.validate.envKeyRequired") },
          ]}
          extra={t("form.fields.envKeyHint")}
        >
          <Input placeholder={t("form.fields.envKeyPlaceholder")} />
        </Form.Item>

        <Form.Item
          name="defaultModel"
          label={t("form.fields.defaultModel")}
          rules={[
            {
              required: true,
              message: t("form.validate.defaultModelRequired"),
            },
          ]}
        >
          <Input placeholder={t("form.fields.defaultModelPlaceholder")} />
        </Form.Item>

        <Form.Item name="wireApiDisplay" label={t("form.fields.wireApi")}>
          <Radio.Group>
            <Radio.Button value="chat">
              <Space direction="vertical" size={0} style={{ alignItems: "flex-start" }}>
                <strong>{t("form.fields.wireApiChat")}</strong>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {t("form.fields.wireApiChatSub")}
                </Typography.Text>
              </Space>
            </Radio.Button>
            <Radio.Button value="responses">
              <Space direction="vertical" size={0} style={{ alignItems: "flex-start" }}>
                <strong>{t("form.fields.wireApiResponses")}</strong>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {t("form.fields.wireApiResponsesSub")}
                </Typography.Text>
              </Space>
            </Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item label={t("form.fields.features")}>
          <Space direction="vertical">
            <Form.Item
              name="forceParallelToolCalls"
              valuePropName="checked"
              noStyle
            >
              <Checkbox>
                <strong>{t("form.fields.forceParallelToolCalls")}</strong>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.forceParallelToolCallsSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
            <Form.Item name="featWebSearch" valuePropName="checked" noStyle>
              <Checkbox>
                <strong>{t("form.fields.webSearch")}</strong>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.webSearchSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
          </Space>
        </Form.Item>

        {/* minimax-compat: 严格 OpenAI 兼容预设。命名以 MiniMax 首位受益者命名，
            但任何拒绝 strict:null / content:null / stream_options 等字段的上游都能用。 */}
        <Form.Item label={t("form.fields.strictCompat")}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            {t("form.fields.strictCompatHint")}
          </Typography.Paragraph>
          <Space direction="vertical">
            <Form.Item name="featMinimaxCompat" valuePropName="checked" noStyle>
              <Checkbox>
                <strong>{t("form.fields.minimaxCompat")}</strong>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.minimaxCompatSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
            <Form.Item name="featForceDefaultModel" valuePropName="checked" noStyle>
              <Checkbox>
                <strong>{t("form.fields.forceDefaultModel")}</strong>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.forceDefaultModelSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>

            <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>
              {t("form.fields.strictCompatSubswitches")}
            </Typography.Text>
            <Form.Item name="featDropNullStrict" valuePropName="checked" noStyle>
              <Checkbox>
                <code>dropNullStrict</code>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.dropNullStrictSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
            <Form.Item name="featDropNullContent" valuePropName="checked" noStyle>
              <Checkbox>
                <code>dropNullContent</code>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.dropNullContentSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
            <Form.Item name="featDropToolChoiceAuto" valuePropName="checked" noStyle>
              <Checkbox>
                <code>dropToolChoiceAuto</code>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.dropToolChoiceAutoSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
            <Form.Item name="featDropStreamOptions" valuePropName="checked" noStyle>
              <Checkbox>
                <code>dropStreamOptions</code>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.dropStreamOptionsSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
            <Form.Item name="featDropParallelToolCalls" valuePropName="checked" noStyle>
              <Checkbox>
                <code>dropParallelToolCalls</code>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.dropParallelToolCallsSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
            <Form.Item name="featMergeSystemMessages" valuePropName="checked" noStyle>
              <Checkbox>
                <code>mergeSystemMessages</code>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.mergeSystemMessagesSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
            <Form.Item name="featExtractThinkTags" valuePropName="checked" noStyle>
              <Checkbox>
                <code>extractThinkTags</code>{" "}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  · {t("form.fields.extractThinkTagsSub")}
                </Typography.Text>
              </Checkbox>
            </Form.Item>
          </Space>
        </Form.Item>

        <Form.Item
          name="docsUrl"
          label={t("form.fields.docsUrl")}
          extra={t("form.fields.docsUrlHint")}
        >
          <Input placeholder="https://..." />
        </Form.Item>

        <Typography.Title level={5}>{t("form.models.title")}</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          <Trans i18nKey="form.models.hint" ns="providers">
            {"placeholder"}
          </Trans>
        </Typography.Paragraph>

        <Form.List name="models">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Card
                  key={field.key}
                  size="small"
                  style={{ marginBottom: 12 }}
                  styles={{ body: { padding: 12 } }}
                  extra={
                    <Button
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  }
                >
                  <Form.Item
                    {...field}
                    label="model id"
                    name={[field.name, "id"]}
                    rules={[{ required: true }]}
                    style={{ marginBottom: 8 }}
                  >
                    <Input placeholder={t("form.models.idPlaceholder")} />
                  </Form.Item>
                  <Space wrap>
                    <Form.Item
                      name={[field.name, "contextWindow"]}
                      label={t("form.models.contextPlaceholder")}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber min={1} placeholder="262144" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "maxOutputTokens"]}
                      label={t("form.models.maxOutputPlaceholder")}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber min={1} placeholder="8192" />
                    </Form.Item>
                  </Space>
                  <Space>
                    <Form.Item
                      name={[field.name, "supportsImages"]}
                      valuePropName="checked"
                      noStyle
                    >
                      <Checkbox>{t("form.models.vision")}</Checkbox>
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "supportsReasoning"]}
                      valuePropName="checked"
                      noStyle
                    >
                      <Checkbox>{t("form.models.reasoning")}</Checkbox>
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "supportsWebSearch"]}
                      valuePropName="checked"
                      noStyle
                    >
                      <Checkbox>{t("form.models.webSearch")}</Checkbox>
                    </Form.Item>
                  </Space>
                </Card>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() =>
                  add({ id: "" } as Partial<GenericProviderModelSpec>)
                }
                block
              >
                {t("form.models.addBtn")}
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}

function RawJsonModal({
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

  const valid = useMemo(() => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }, [value]);

  return (
    <Modal
      open
      width={760}
      title={t("rawJson.title")}
      onCancel={onCancel}
      onOk={onSubmit}
      okText={tCommon("save")}
      cancelText={tCommon("cancel")}
      okButtonProps={{ disabled: !valid }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0 }}>
        {t("rawJson.hint")}
      </Typography.Paragraph>
      <Input.TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={20}
        status={valid ? "" : "error"}
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      />
      <Typography.Text
        type={valid ? "success" : "danger"}
        style={{ fontSize: 11, marginTop: 6, display: "block" }}
      >
        {valid ? t("rawJson.valid") : t("rawJson.invalid")}
      </Typography.Text>
    </Modal>
  );
}
