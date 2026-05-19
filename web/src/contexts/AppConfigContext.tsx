import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type UpdateStatusResponse } from "../api/client";
import i18n, { DEFAULT_LANG, SUPPORTED_LANGS, type SupportedLang } from "../i18n";

export type ThemeMode = "dark" | "light" | "auto";
const THEME_MODES: ThemeMode[] = ["dark", "light", "auto"];

export type ResolvedTheme = "dark" | "light";

export interface AppConfig {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  lang: SupportedLang;
  settings: Record<string, string>;
  refresh: () => Promise<void>;
  // Version status is fetched once on mount and after explicit user actions
  // (Check now / Ignore). `null` until the first fetch resolves.
  versionInfo: UpdateStatusResponse | null;
  refreshVersion: () => Promise<void>;
  // Forces a network round-trip on the backend (POST /admin/api/check-update)
  // instead of serving the cached value. Used by the "Check now" button.
  forceCheckVersion: () => Promise<void>;
  setVersionInfo: (info: UpdateStatusResponse) => void;
}

const AppConfigContext = createContext<AppConfig | null>(null);

function isThemeMode(v: string | undefined): v is ThemeMode {
  return !!v && (THEME_MODES as string[]).includes(v);
}

function isLang(v: string | undefined): v is SupportedLang {
  return !!v && (SUPPORTED_LANGS as readonly string[]).includes(v);
}

function detectSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => detectSystemTheme());
  const [versionInfo, setVersionInfoState] = useState<UpdateStatusResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.settings();
      setSettings(res.settings);
    } catch {
      // best-effort; fall back to defaults
    }
  }, []);

  const refreshVersion = useCallback(async () => {
    try {
      const info = await api.updateStatus();
      setVersionInfoState(info);
    } catch {
      // version checks are advisory — keep the previous state on failure
    }
  }, []);

  const forceCheckVersion = useCallback(async () => {
    try {
      const info = await api.checkUpdate();
      setVersionInfoState(info);
    } catch {
      // ignore — UI still shows the last known state
    }
  }, []);

  const setVersionInfo = useCallback((info: UpdateStatusResponse) => {
    setVersionInfoState(info);
  }, []);

  useEffect(() => {
    void refresh();
    void refreshVersion();
    // Backend's GET /update-status kicks off a background npm fetch when the
    // cache is past 6h TTL — but the current request still returns the stale
    // value. Re-fetch ~3s later so the freshly-written cache is picked up
    // without forcing the user to manually refresh. Cheap (single GET, reads
    // a local JSON file on the server) and only fires once per mount.
    const followup = setTimeout(() => {
      void refreshVersion();
    }, 3000);
    return () => clearTimeout(followup);
  }, [refresh, refreshVersion]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const themeMode: ThemeMode = isThemeMode(settings["ui.theme"]) ? settings["ui.theme"] : "auto";
  const lang: SupportedLang = isLang(settings["ui.lang"]) ? settings["ui.lang"] : DEFAULT_LANG;
  const resolvedTheme: ResolvedTheme = themeMode === "auto" ? systemTheme : themeMode;

  useEffect(() => {
    if (i18n.language !== lang) {
      void i18n.changeLanguage(lang);
    }
  }, [lang]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = resolvedTheme;
    }
  }, [resolvedTheme]);

  const value = useMemo<AppConfig>(
    () => ({
      themeMode,
      resolvedTheme,
      lang,
      settings,
      refresh,
      versionInfo,
      refreshVersion,
      forceCheckVersion,
      setVersionInfo,
    }),
    [
      themeMode,
      resolvedTheme,
      lang,
      settings,
      refresh,
      versionInfo,
      refreshVersion,
      forceCheckVersion,
      setVersionInfo,
    ]
  );

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfig {
  const ctx = useContext(AppConfigContext);
  if (!ctx) throw new Error("useAppConfig must be used inside <AppConfigProvider>");
  return ctx;
}
