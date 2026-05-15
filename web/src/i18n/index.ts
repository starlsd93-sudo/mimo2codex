import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zhCommon from "./locales/zh-CN/common.json";
import zhNav from "./locales/zh-CN/nav.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhLogs from "./locales/zh-CN/logs.json";
import zhDashboard from "./locales/zh-CN/dashboard.json";
import zhProviders from "./locales/zh-CN/providers.json";
import enCommon from "./locales/en-US/common.json";
import enNav from "./locales/en-US/nav.json";
import enSettings from "./locales/en-US/settings.json";
import enLogs from "./locales/en-US/logs.json";
import enDashboard from "./locales/en-US/dashboard.json";
import enProviders from "./locales/en-US/providers.json";

export const SUPPORTED_LANGS = ["zh-CN", "en-US"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: SupportedLang = "zh-CN";

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": {
      common: zhCommon,
      nav: zhNav,
      settings: zhSettings,
      logs: zhLogs,
      dashboard: zhDashboard,
      providers: zhProviders,
    },
    "en-US": {
      common: enCommon,
      nav: enNav,
      settings: enSettings,
      logs: enLogs,
      dashboard: enDashboard,
      providers: enProviders,
    },
  },
  lng: DEFAULT_LANG,
  fallbackLng: DEFAULT_LANG,
  defaultNS: "common",
  ns: ["common", "nav", "settings", "logs", "dashboard", "providers"],
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  missingKeyHandler: (lngs, ns, key) => {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing key: ${ns}:${key} for ${lngs.join(",")}`);
  },
  saveMissing: true,
});

export default i18n;
