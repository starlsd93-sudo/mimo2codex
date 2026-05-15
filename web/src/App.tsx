import { useEffect, useMemo, useState } from "react";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ConfigProvider, Layout, Menu, theme as antdTheme } from "antd";
import type { MenuProps } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { useTranslation } from "react-i18next";
import {
  AppstoreOutlined,
  ApiOutlined,
  CodeOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  SettingOutlined,
} from "@ant-design/icons";

import { api } from "./api/client";
import { AppConfigProvider, useAppConfig } from "./contexts/AppConfigContext";
import { Dashboard } from "./pages/Dashboard";
import { Models } from "./pages/Models";
import { Logs } from "./pages/Logs";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";
import { Providers } from "./pages/Providers";
import { CodexEnable } from "./pages/CodexEnable";

const GITHUB_REPO = "https://github.com/7as0nch/mimo2codex";
const { Sider, Content, Footer: AntFooter } = Layout;

interface MenuEntry {
  path: string;
  key: keyof MenuLabels;
  icon: React.ReactNode;
  element: React.ReactNode;
}

interface MenuLabels {
  dashboard: string;
  setup: string;
  codexEnable: string;
  providers: string;
  models: string;
  logs: string;
  settings: string;
}

const MENU: MenuEntry[] = [
  { path: "/", key: "dashboard", icon: <DashboardOutlined />, element: <Dashboard /> },
  { path: "/setup", key: "setup", icon: <ApiOutlined />, element: <Setup /> },
  { path: "/codex-enable", key: "codexEnable", icon: <CodeOutlined />, element: <CodexEnable /> },
  { path: "/providers", key: "providers", icon: <AppstoreOutlined />, element: <Providers /> },
  { path: "/models", key: "models", icon: <DatabaseOutlined />, element: <Models /> },
  { path: "/logs", key: "logs", icon: <FileTextOutlined />, element: <Logs /> },
  { path: "/settings", key: "settings", icon: <SettingOutlined />, element: <Settings /> },
];

export function App() {
  return (
    <AppConfigProvider>
      <ThemedRoot />
    </AppConfigProvider>
  );
}

function ThemedRoot() {
  const { resolvedTheme, lang } = useAppConfig();
  const algorithm =
    resolvedTheme === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm;
  const antdLocale = lang === "en-US" ? enUS : zhCN;

  return (
    <ConfigProvider
      theme={{ algorithm, cssVar: true, hashed: false }}
      locale={antdLocale}
    >
      <BrowserRouter basename="/admin">
        <Shell />
      </BrowserRouter>
    </ConfigProvider>
  );
}

function Shell() {
  const { t } = useTranslation("nav");
  const navigate = useNavigate();
  const location = useLocation();

  const items: MenuProps["items"] = useMemo(
    () => MENU.map((m) => ({ key: m.path, icon: m.icon, label: t(m.key) })),
    [t]
  );

  // Match the longest prefix so nested routes (if added later) still light up the right entry.
  const selectedKey = useMemo(() => {
    const path = location.pathname || "/";
    if (path === "/") return "/";
    const match = MENU.filter((m) => m.path !== "/").find((m) => path.startsWith(m.path));
    return match?.path ?? "/";
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={220} breakpoint="lg" collapsedWidth={64}>
        <div
          style={{
            color: "rgba(255,255,255,0.95)",
            padding: "16px 20px",
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          {t("title")}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={(info) => navigate(info.key)}
        />
      </Sider>
      <Layout>
        <Content style={{ padding: "24px 28px" }}>
          <Routes>
            {MENU.map((m) => (
              <Route key={m.path} path={m.path} element={m.element} />
            ))}
          </Routes>
        </Content>
        <AppFooter />
      </Layout>
    </Layout>
  );
}

function AppFooter() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    api
      .health()
      .then((h) => setVersion(h.version))
      .catch(() => {
        /* footer is best-effort */
      });
  }, []);
  const year = new Date().getFullYear();
  return (
    <AntFooter style={{ textAlign: "center", padding: "16px 24px" }}>
      <div>
        <strong>mimo2codex</strong>
        {version && <span style={{ marginLeft: 6, opacity: 0.65 }}>v{version}</span>} · ©{" "}
        {year} ·{" "}
        <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noreferrer">
          {t("footer.license")}
        </a>
        <span style={{ marginLeft: 12 }}>
          <a href={GITHUB_REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
          {" · "}
          <a href={`${GITHUB_REPO}/issues`} target="_blank" rel="noreferrer">
            {t("footer.feedback")}
          </a>
          {" · "}
          <a
            href={`${GITHUB_REPO}/blob/main/doc/generic-providers.zh.md`}
            target="_blank"
            rel="noreferrer"
          >
            {t("footer.docs")}
          </a>
        </span>
      </div>
    </AntFooter>
  );
}
