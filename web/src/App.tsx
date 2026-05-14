import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api/client";
import { Dashboard } from "./pages/Dashboard";
import { Models } from "./pages/Models";
import { Logs } from "./pages/Logs";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";
import { Providers } from "./pages/Providers";
import { CodexEnable } from "./pages/CodexEnable";

const GITHUB_REPO = "https://github.com/7as0nch/mimo2codex";

export function App() {
  return (
    <BrowserRouter basename="/admin">
      <div className="layout">
        <aside className="sidebar">
          <h1>mimo2codex</h1>
          <nav>
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              概览
            </NavLink>
            <NavLink to="/setup" className={({ isActive }) => (isActive ? "active" : "")}>
              对接指引
            </NavLink>
            <NavLink to="/codex-enable" className={({ isActive }) => (isActive ? "active" : "")}>
              Codex 启用
            </NavLink>
            <NavLink to="/providers" className={({ isActive }) => (isActive ? "active" : "")}>
              通用 Provider
            </NavLink>
            <NavLink to="/models" className={({ isActive }) => (isActive ? "active" : "")}>
              模型
            </NavLink>
            <NavLink to="/logs" className={({ isActive }) => (isActive ? "active" : "")}>
              日志
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
              设置
            </NavLink>
          </nav>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/codex-enable" element={<CodexEnable />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/models" element={<Models />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

function Footer() {
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    api
      .health()
      .then((h) => setVersion(h.version))
      .catch(() => {
        /* footer is best-effort — silent failure is fine */
      });
  }, []);
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div>
        <strong>mimo2codex</strong>
        {version && (
          <>
            {" "}
            <span className="tag muted">v{version}</span>
          </>
        )}{" "}
        · © {year} ·{" "}
        <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noreferrer">
          MIT License
        </a>
      </div>
      <div className="links">
        <a href={GITHUB_REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href={`${GITHUB_REPO}/issues`} target="_blank" rel="noreferrer">
          反馈 / Issues
        </a>
        <a
          href={`${GITHUB_REPO}/blob/main/doc/generic-providers.zh.md`}
          target="_blank"
          rel="noreferrer"
        >
          文档
        </a>
      </div>
    </footer>
  );
}
