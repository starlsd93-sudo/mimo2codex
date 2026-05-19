import type {
  GenericProviderSpec,
  ProviderPresetClient,
} from "../../api/client";

// Built-in provider ids — the user cannot create generics with these. Used
// by both validation (reject reserved names) and provider-list filtering.
export const RESERVED_IDS = new Set(["mimo", "deepseek"]);

// Antd Form binds to a flat key/value object, while providers.json uses
// nested `features: { ... }`. FormValues is the flat representation we read
// and write inside the form modal, with feat* keys mirroring each feature
// flag plus a few non-feature top-level fields.
export interface FormValues extends GenericProviderSpec {
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
  featDropResponseFormat: boolean;
  featDropNonFunctionTools: boolean;
  featDropReasoningEffort: boolean;
  // 单选 "" / "sensenova" / "minimax" / "kimi"。"" → 写回时不写字段。
  featEnhanceErrorPreset: "" | "sensenova" | "minimax" | "kimi";
  // minimax-compat: 顶层 forceDefaultModel 是非 features 字段，单独平铺也是为了表单绑定方便。
  featForceDefaultModel: boolean;
}

// 列出所有 feature 复选框字段 —— watcher 用它判断"用户是否已勾过任何 feature"
// （已勾过则不自动覆盖），以及 clearAutoApplied 用它一次性还原。
export const FEATURE_BOOLEAN_KEYS: Array<keyof FormValues> = [
  "forceParallelToolCalls",
  "featWebSearch",
  "featMinimaxCompat",
  "featDropNullStrict",
  "featDropNullContent",
  "featDropToolChoiceAuto",
  "featDropStreamOptions",
  "featDropParallelToolCalls",
  "featMergeSystemMessages",
  "featExtractThinkTags",
  "featDropResponseFormat",
  "featDropNonFunctionTools",
  "featDropReasoningEffort",
  "featForceDefaultModel",
];

export function emptyFormValues(): FormValues {
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
    featDropResponseFormat: false,
    featDropNonFunctionTools: false,
    featDropReasoningEffort: false,
    featEnhanceErrorPreset: "",
    featForceDefaultModel: false,
    docsUrl: "",
  };
}

export function specToFormValues(spec: GenericProviderSpec): FormValues {
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
      dropResponseFormat: !!spec.features?.dropResponseFormat,
      dropNonFunctionTools: !!spec.features?.dropNonFunctionTools,
      dropReasoningEffort: !!spec.features?.dropReasoningEffort,
      enhanceErrorPreset: spec.features?.enhanceErrorPreset,
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
    featDropResponseFormat: !!spec.features?.dropResponseFormat,
    featDropNonFunctionTools: !!spec.features?.dropNonFunctionTools,
    featDropReasoningEffort: !!spec.features?.dropReasoningEffort,
    featEnhanceErrorPreset:
      spec.features?.enhanceErrorPreset === "sensenova" ||
      spec.features?.enhanceErrorPreset === "minimax" ||
      spec.features?.enhanceErrorPreset === "kimi"
        ? spec.features.enhanceErrorPreset
        : "",
    featForceDefaultModel: !!spec.forceDefaultModel,
    docsUrl: spec.docsUrl ?? "",
  };
}

export function formValuesToSpec(form: FormValues): GenericProviderSpec {
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
  // features 同时承载 boolean 子开关与 string 字段（enhanceErrorPreset），用 union 类型。
  const features: Record<string, boolean | string> = {};
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
  if (form.featDropResponseFormat) features.dropResponseFormat = true;
  if (form.featDropNonFunctionTools) features.dropNonFunctionTools = true;
  if (form.featDropReasoningEffort) features.dropReasoningEffort = true;
  if (form.featEnhanceErrorPreset)
    features.enhanceErrorPreset = form.featEnhanceErrorPreset;
  if (Object.keys(features).length > 0) {
    // GenericProviderSpec.features 期望具体字段类型，运行时这里就是匹配的，断言收口。
    out.features = features as GenericProviderSpec["features"];
  }
  // minimax-compat: 顶层 forceDefaultModel
  if (form.featForceDefaultModel) out.forceDefaultModel = true;
  if (form.docsUrl?.trim()) out.docsUrl = form.docsUrl.trim();
  return out;
}

// 只看 sanitizer boolean 开关 —— enhanceErrorPreset 是"分类标签"而非 sanitizer，
// 排除它，否则用户主动从单选切到 sensenova/minimax 时这里就 true 了，下面的
// preset watcher 永远套不上 features。
export function hasUserCustomizedFeatures(v: Partial<FormValues>): boolean {
  for (const k of FEATURE_BOOLEAN_KEYS) {
    if (v[k]) return true;
  }
  return false;
}

// 把 preset.recommendedSpec.features (后端字段命名) 映射成 FormValues 里的
// feat* 平铺字段。
export function mapPresetFeaturesToFormFlags(
  features: Record<string, boolean | string>
): Partial<FormValues> {
  const patch: Partial<FormValues> = {};
  if (typeof features.forceParallelToolCalls === "boolean")
    patch.forceParallelToolCalls = features.forceParallelToolCalls;
  if (typeof features.webSearch === "boolean")
    patch.featWebSearch = features.webSearch;
  if (typeof features.minimaxCompat === "boolean")
    patch.featMinimaxCompat = features.minimaxCompat;
  if (typeof features.dropNullStrict === "boolean")
    patch.featDropNullStrict = features.dropNullStrict;
  if (typeof features.dropNullContent === "boolean")
    patch.featDropNullContent = features.dropNullContent;
  if (typeof features.dropToolChoiceAuto === "boolean")
    patch.featDropToolChoiceAuto = features.dropToolChoiceAuto;
  if (typeof features.dropStreamOptions === "boolean")
    patch.featDropStreamOptions = features.dropStreamOptions;
  if (typeof features.dropParallelToolCalls === "boolean")
    patch.featDropParallelToolCalls = features.dropParallelToolCalls;
  if (typeof features.mergeSystemMessages === "boolean")
    patch.featMergeSystemMessages = features.mergeSystemMessages;
  if (typeof features.extractThinkTags === "boolean")
    patch.featExtractThinkTags = features.extractThinkTags;
  if (typeof features.dropResponseFormat === "boolean")
    patch.featDropResponseFormat = features.dropResponseFormat;
  if (typeof features.dropNonFunctionTools === "boolean")
    patch.featDropNonFunctionTools = features.dropNonFunctionTools;
  if (typeof features.dropReasoningEffort === "boolean")
    patch.featDropReasoningEffort = features.dropReasoningEffort;
  if (
    features.enhanceErrorPreset === "sensenova" ||
    features.enhanceErrorPreset === "minimax" ||
    features.enhanceErrorPreset === "kimi"
  ) {
    patch.featEnhanceErrorPreset = features.enhanceErrorPreset;
  }
  return patch;
}

// Match an existing baseUrl / model combo against the registry of known
// presets so we can auto-suggest a sanitizer profile inside the form.
// First-pass match on baseUrl substring; if none, fallback to model prefix.
export function matchPresetClient(
  presets: readonly ProviderPresetClient[],
  baseUrl: string,
  model: string
): ProviderPresetClient | null {
  const bu = (baseUrl || "").toLowerCase();
  const m = (model || "").toLowerCase();
  for (const p of presets) {
    if (p.matchBaseUrl.some((s) => bu.includes(s.toLowerCase()))) return p;
  }
  for (const p of presets) {
    if (p.matchModelPrefix.some((s) => m.startsWith(s.toLowerCase())))
      return p;
  }
  return null;
}
