import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Typography,
} from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import type {
  GenericProviderModelSpec,
  ProviderPresetClient,
} from "../../api/client";
import {
  FEATURE_BOOLEAN_KEYS,
  hasUserCustomizedFeatures,
  mapPresetFeaturesToFormFlags,
  matchPresetClient,
  type FormValues,
} from "./formValues";

// Big edit/create form for one generic provider spec. Keeps:
//   - flat antd Form state (FormValues)
//   - autoApplied / presetRadioValue / advancedExpanded UI-only state
//   - watcher that auto-suggests a preset based on baseUrl / defaultModel
//   - manual preset switcher that overwrites preset-managed fields
export function ProviderFormModal({
  mode,
  initialValues,
  presets,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  initialValues: FormValues;
  presets: ProviderPresetClient[];
  onCancel: () => void;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const { t } = useTranslation("providers");
  const { t: tCommon } = useTranslation("common");
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  // autoApplied: 显示哪个预设刚被自动套用（null 表示未套用 / 已清除）。
  const [autoApplied, setAutoApplied] = useState<string | null>(null);

  // Radio 当前值用 React useState 控制 —— 不用 Form.useWatch，因为脱离 Form.Item
  // 的字段，setFieldsValue 写入后 useWatch 在 rc-field-form 内部不一定能感知到
  // （之前症状："切到 sensenova 后 features checkbox 套上了但 Radio 一直 none
  // 高亮"，正是这个原因）。useState 是 React 自己的 setter，写完立刻在下次
  // render 生效，没有内部状态机干扰。form store 仍通过 setFieldsValue 同步，
  // submit 路径走 hidden Form.Item 让 validateFields 能拿到该字段，与既有
  // formValuesToSpec 接口保持兼容。
  const [presetRadioValue, setPresetRadioValue] = useState<
    "" | "sensenova" | "minimax" | "kimi"
  >(
    (initialValues.featEnhanceErrorPreset ?? "") as
      | ""
      | "sensenova"
      | "minimax"
      | "kimi"
  );
  // "高级（细粒度兼容子开关）"折叠状态。自动跟随预设：none → 展开，预设 →
  // 折叠；用户也可手动展开/收起；切换预设时强制同步（覆盖手动 state，因为切
  // 预设是清零信号）。
  const [advancedExpanded, setAdvancedExpanded] = useState<boolean>(
    presetRadioValue === ""
  );
  useEffect(() => {
    setAdvancedExpanded(presetRadioValue === "");
  }, [presetRadioValue]);

  // Watcher A：监听 baseUrl / defaultModel，命中已知厂商预设 + 当前 features
  // 全空 → 自动套用。create 与 edit 都触发：用户偏好"帮老配置跟上推荐"。
  // hasUserCustomizedFeatures 保护，已经勾过任何 feature 的存量配置不会被覆盖。
  const watchedBaseUrl = Form.useWatch("baseUrl", form);
  const watchedModel = Form.useWatch("defaultModel", form);
  useEffect(() => {
    if (!presets.length) return;
    const preset = matchPresetClient(
      presets,
      watchedBaseUrl ?? "",
      watchedModel ?? ""
    );
    if (!preset) {
      // 改成不命中的值 → 只清 Alert，不还原已套字段（避免抖动；用户可点 Alert
      // 上的清除按钮）。
      setAutoApplied(null);
      return;
    }
    const current = form.getFieldsValue();
    if (hasUserCustomizedFeatures(current)) return;
    form.setFieldsValue(
      mapPresetFeaturesToFormFlags(preset.recommendedSpec.features)
    );
    setAutoApplied(preset.displayName);
    // 同步给 Radio 的 useState（form.setFieldsValue 写 store 但 Radio value
    // 来自 useState）
    const presetId = preset.recommendedSpec.features.enhanceErrorPreset;
    if (
      presetId === "sensenova" ||
      presetId === "minimax" ||
      presetId === "kimi"
    ) {
      setPresetRadioValue(presetId);
    }
  }, [watchedBaseUrl, watchedModel, presets, form]);

  // Radio onChange：useState 主管 UI，setFieldsValue 同步 form store
  function onPresetRadioChange(newVal: string): void {
    const v: "" | "sensenova" | "minimax" | "kimi" =
      newVal === "sensenova" || newVal === "minimax" || newVal === "kimi"
        ? newVal
        : "";
    // 1. 立即更新 useState（Radio 高亮立刻切换，无中间态）
    setPresetRadioValue(v);
    // 2. 同步 form store（hidden Form.Item 让 validateFields 也能拿到）
    form.setFieldsValue({ featEnhanceErrorPreset: v });

    if (v === "") {
      setAutoApplied(null);
      return;
    }
    const preset = presets.find((p) => p.id === v);
    if (!preset) {
      setAutoApplied(null);
      return;
    }

    // 3. 清"预设管理范围"内字段，防止 sensenova → minimax 残留 sensenova 的
    // 勾。preset 范围 = 所有已知 preset 的 patch 字段并集；不影响 preset 范围
    // 外字段 (forceParallelToolCalls / featForceDefaultModel 等用户独立配置)。
    const presetManagedKeys = new Set<keyof FormValues>();
    for (const p of presets) {
      const flat = mapPresetFeaturesToFormFlags(p.recommendedSpec.features);
      for (const k of Object.keys(flat) as Array<keyof FormValues>) {
        if (k === "featEnhanceErrorPreset") continue;
        presetManagedKeys.add(k);
      }
    }
    const reset: Partial<FormValues> = {};
    for (const k of presetManagedKeys) {
      (reset as Record<string, unknown>)[k] = false;
    }

    // 4. 套新 preset。触发源字段不回写 —— 第 2 步已经写好。
    const patch = mapPresetFeaturesToFormFlags(preset.recommendedSpec.features);
    delete patch.featEnhanceErrorPreset;
    form.setFieldsValue({ ...reset, ...patch });
    setAutoApplied(preset.displayName);
  }

  function clearAutoApplied(): void {
    const reset: Partial<FormValues> = { featEnhanceErrorPreset: "" };
    for (const k of FEATURE_BOOLEAN_KEYS) {
      (reset as Record<string, unknown>)[k] = false;
    }
    form.setFieldsValue(reset);
    setPresetRadioValue(""); // Radio 的 useState 也要同步还原
    setAutoApplied(null);
  }

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
        setSaving(true);
        try {
          await onSubmit(values);
        } finally {
          setSaving(false);
        }
      }}
      confirmLoading={saving}
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
          rules={[{ required: true, message: t("form.validate.baseUrlRequired") }]}
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
          rules={[{ required: true, message: t("form.validate.envKeyRequired") }]}
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
              <Space
                direction="vertical"
                size={0}
                style={{ alignItems: "flex-start" }}
              >
                <strong>{t("form.fields.wireApiChat")}</strong>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {t("form.fields.wireApiChatSub")}
                </Typography.Text>
              </Space>
            </Radio.Button>
            <Radio.Button value="responses">
              <Space
                direction="vertical"
                size={0}
                style={{ alignItems: "flex-start" }}
              >
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

        {/* 厂商快捷预设：放在最上面。选 sensenova / minimax 会做两件事 ——
            ① 一键勾上下面"高级"区里的推荐细粒度子开关
            ② 上游模糊化 400 翻译成诊断 hint */}
        <Form.Item label={t("form.fields.enhanceErrorPresetTitle")}>
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginBottom: 8 }}
          >
            {t("form.fields.enhanceErrorPresetSub")}
          </Typography.Paragraph>
          {autoApplied && (
            <Alert
              type="success"
              showIcon
              closable
              onClose={() => setAutoApplied(null)}
              message={t("form.fields.presetAutoApplied", {
                name: autoApplied,
              })}
              action={
                <Button size="small" onClick={clearAutoApplied}>
                  {t("form.fields.presetClear")}
                </Button>
              }
              style={{ marginBottom: 12 }}
            />
          )}
          {/* Radio value 由 React useState 控制（presetRadioValue），不耦合
              antd 内部状态机。hidden Form.Item 仅用于让 validateFields 能拿到
              该字段以走通既有 formValuesToSpec 路径。onChange 里
              setFieldsValue + setPresetRadioValue 双写保证两边同步。 */}
          <Form.Item name="featEnhanceErrorPreset" noStyle hidden>
            <input type="hidden" />
          </Form.Item>
          <Radio.Group
            size="small"
            value={presetRadioValue}
            onChange={(e) => onPresetRadioChange(e.target.value as string)}
          >
            <Radio.Button value="">
              {t("form.fields.enhanceErrorPresetNone")}
            </Radio.Button>
            <Radio.Button value="sensenova">sensenova</Radio.Button>
            <Radio.Button value="minimax">minimax</Radio.Button>
            <Radio.Button value="kimi">kimi</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {/* 高级：严格 OpenAI 兼容（细粒度子开关）。折叠默认状态自动跟随预设：
            选预设折叠（推荐已套用，不必看）；选 none 展开。用户也可手动点
            header 切换。 */}
        <Collapse
          ghost
          activeKey={advancedExpanded ? ["advanced"] : []}
          onChange={(keys) =>
            setAdvancedExpanded(Array.isArray(keys) ? keys.length > 0 : !!keys)
          }
          items={[
            {
              key: "advanced",
              label: (
                <strong style={{ fontSize: 13 }}>
                  {t("form.fields.strictCompat")}
                </strong>
              ),
              children: <StrictCompatSwitches />,
            },
          ]}
        />

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

// Inner sub-section: the 11 sanitizer toggles under the "Advanced compat"
// collapse. Pulled out so the main form body stays readable.
function StrictCompatSwitches() {
  const { t } = useTranslation("providers");
  return (
    <>
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginBottom: 8 }}
      >
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

        <Typography.Text
          type="secondary"
          style={{ fontSize: 11, marginTop: 4 }}
        >
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
        <Form.Item
          name="featDropToolChoiceAuto"
          valuePropName="checked"
          noStyle
        >
          <Checkbox>
            <code>dropToolChoiceAuto</code>{" "}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              · {t("form.fields.dropToolChoiceAutoSub")}
            </Typography.Text>
          </Checkbox>
        </Form.Item>
        <Form.Item
          name="featDropStreamOptions"
          valuePropName="checked"
          noStyle
        >
          <Checkbox>
            <code>dropStreamOptions</code>{" "}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              · {t("form.fields.dropStreamOptionsSub")}
            </Typography.Text>
          </Checkbox>
        </Form.Item>
        <Form.Item
          name="featDropParallelToolCalls"
          valuePropName="checked"
          noStyle
        >
          <Checkbox>
            <code>dropParallelToolCalls</code>{" "}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              · {t("form.fields.dropParallelToolCallsSub")}
            </Typography.Text>
          </Checkbox>
        </Form.Item>
        <Form.Item
          name="featMergeSystemMessages"
          valuePropName="checked"
          noStyle
        >
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
        <Form.Item
          name="featDropResponseFormat"
          valuePropName="checked"
          noStyle
        >
          <Checkbox>
            <code>dropResponseFormat</code>{" "}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              · {t("form.fields.dropResponseFormatSub")}
            </Typography.Text>
          </Checkbox>
        </Form.Item>
        <Form.Item
          name="featDropNonFunctionTools"
          valuePropName="checked"
          noStyle
        >
          <Checkbox>
            <code>dropNonFunctionTools</code>{" "}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              · {t("form.fields.dropNonFunctionToolsSub")}
            </Typography.Text>
          </Checkbox>
        </Form.Item>
        <Form.Item
          name="featDropReasoningEffort"
          valuePropName="checked"
          noStyle
        >
          <Checkbox>
            <code>dropReasoningEffort</code>{" "}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              · {t("form.fields.dropReasoningEffortSub")}
            </Typography.Text>
          </Checkbox>
        </Form.Item>
      </Space>
    </>
  );
}
