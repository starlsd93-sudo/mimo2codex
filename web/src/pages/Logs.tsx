import { useEffect, useState } from "react";
import { api, type LogRow } from "../api/client";

const PAGE_SIZE = 100;

export function Logs() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const r = await api.logs({
        provider: provider || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setLogs(r.logs);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, page]);

  async function clearOld() {
    const days = prompt("删除多少天之前的日志？", "7");
    if (!days) return;
    const before = Date.now() - Number(days) * 24 * 60 * 60 * 1000;
    try {
      const r = await api.deleteLogsBefore(before);
      alert(`已删除 ${r.removed} 条`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h2>聊天日志</h2>

      {error && (
        <div className="banner err">
          <span className="ic">!</span>
          <div className="body">{error}</div>
        </div>
      )}

      <div className="row">
        <span style={{ color: "var(--muted)", fontSize: 13 }}>过滤：</span>
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(0); }}>
          <option value="">全部</option>
          <option value="mimo">mimo</option>
          <option value="deepseek">deepseek</option>
        </select>
        <button onClick={() => load()} className="secondary">
          刷新
        </button>
        <span className="grow" />
        <button onClick={clearOld} className="secondary">
          清理旧日志…
        </button>
      </div>

      {logs.length > 0 ? (
        <>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>Provider</th>
                <th>Client model</th>
                <th>Upstream model</th>
                <th>端点</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}>Prompt</th>
                <th style={{ textAlign: "right" }}>Completion</th>
                <th style={{ textAlign: "right" }}>合计</th>
                <th style={{ textAlign: "right" }}>耗时</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.ts).toLocaleString()}</td>
                  <td>
                    <span className="tag">{l.provider_id}</span>
                  </td>
                  <td className="mono">{l.client_model}</td>
                  <td className="mono">{l.upstream_model}</td>
                  <td className="mono">{l.endpoint}</td>
                  <td>
                    <span className={`tag ${l.status_code >= 400 ? "err" : "ok"}`}>
                      {l.status_code}
                      {l.stream ? " · stream" : ""}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {l.prompt_tokens ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {l.completion_tokens ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {l.total_tokens ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{l.duration_ms} ms</td>
                  <td className="mono" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.error_snippet ?? ""}>
                    {l.error_code ?? ""}
                    {l.error_snippet ? `: ${l.error_snippet}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ← 上一页
            </button>
            <span style={{ color: "var(--muted)" }}>第 {page + 1} 页</span>
            <button
              className="secondary"
              disabled={logs.length < PAGE_SIZE}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页 →
            </button>
          </div>
        </>
      ) : (
        <div className="empty">暂无日志</div>
      )}
    </div>
  );
}
