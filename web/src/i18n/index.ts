import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zhCommon from "./locales/zh-CN/common.json";
import zhNav from "./locales/zh-CN/nav.json";
import zhSettings from "./locales/zh-CN/settings.json";
import enCommon from "./locales/en-US/common.json";
import enNav from "./locales/en-US/nav.json";
import enSettings from "./locales/en-US/settings.json";

export const SUPPORTED_LANGS = ["zh-CN", "en-US"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: SupportedLang = "zh-CN";

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": {
      common: zhCommon,
      nav: zhNav,
      settings: zhSettings,
    },
    "en-US": {
      common: enCommon,
      nav: enNav,
      settings: enSettings,
    },
  },
  lng: DEFAULT_LANG,
  fallbackLng: DEFAULT_LANG,
  defaultNS: "common",
  ns: ["common", "nav", "settings"],
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  missingKeyHandler: (lngs, ns, key) => {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing key: ${ns}:${key} for ${lngs.join(",")}`);
  },
  saveMissing: true,
});

export default i18n;
