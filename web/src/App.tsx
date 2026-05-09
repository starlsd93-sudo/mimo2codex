import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Models } from "./pages/Models";
import { Logs } from "./pages/Logs";
import { Settings } from "./pages/Settings";

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
            <Route path="/models" element={<Models />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
