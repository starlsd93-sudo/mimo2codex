import { useEffect, useState } from "react";
import { api, type ModelRow, type ProviderInfo, type AliasRow } from "../api/client";

export function Models() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [active, setActive] = useState<"mimo" | "deepseek">("mimo");
  const [models, setModels] = useState<ModelRow[]>([]);
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newModel, setNewModel] = useState({ upstream_id: "", display_name: "" });
  const [newAlias, setNewAlias] = useState({ alias: "", upstream_id: "" });

  async function load() {
    try {
      setError(null);
      const [p, m, a] = await Promise.all([api.providers(), api.modelsFor(active), api.aliases()]);
      setProviders(p.providers);
      setModels(m.models);
      setAliases(a.aliases);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function addModel() {
    if (!newModel.upstream_id) return;
    try {
      await api.createModel(active, newModel);
      setNewModel({ upstream_id: "", display_name: "" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeModel(id: number) {
    if (!confirm("删除该自定义模型？")) return;
    try {
      await api.deleteModel(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addAlias() {
    if (!newAlias.alias || !newAlias.upstream_id) return;
    try {
      await api.upsertAlias({
        alias: newAlias.alias,
        provider_id: active,
        upstream_id: newAlias.upstream_id,
      });
      setNewAlias({ alias: "", upstream_id: "" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeAlias(alias: string) {
    if (!confirm(`删除别名 "${alias}"？`)) return;
    try {
      await api.deleteAlias(alias);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const aliasesForActive = aliases.filter((a) => a.provider_id === active);

  return (
    <div>
      <h2>模型</h2>

      {error && (
        <div className="banner err">
          <span className="ic">!</span>
          <div className="body">{error}</div>
        </div>
      )}

      <div className="row">
        {providers.map((p) => (
          <button
            key={p.id}
            className={p.id === active ? "" : "secondary"}
            onClick={() => setActive(p.id)}
          >
            {p.display_name}{" "}
            <span className={`tag ${p.enabled ? "ok" : "muted"}`}>
              {p.enabled ? "已启用" : "未配置 key"}
            </span>
          </button>
        ))}
      </div>

      <h3>模型清单</h3>
      <table>
        <thead>
          <tr>
            <th>upstream_id</th>
            <th>显示名</th>
            <th>能力</th>
            <th>上下文</th>
            <th>来源</th>
            <th>过期</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id}>
              <td className="mono">{m.upstream_id}</td>
              <td>{m.display_name ?? "—"}</td>
              <td>
                {m.supports_images ? <span className="tag">视觉</span> : null}{" "}
                {m.supports_reasoning ? <span className="tag">推理</span> : null}{" "}
                {m.supports_web_search ? <span className="tag">联网</span> : null}
              </td>
              <td>{m.context_window?.toLocaleString() ?? "—"}</td>
              <td>
                {m.is_builtin ? (
                  <span className="tag">内置</span>
                ) : (
                  <span className="tag ok">自定义</span>
                )}
              </td>
              <td>
                {m.deprecated_after ? (
                  <span className="tag warn">{m.deprecated_after}</span>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {m.is_builtin ? (
                  <span className="tag muted">只读</span>
                ) : (
                  <button className="danger" onClick={() => removeModel(m.id)}>
                    删除
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>新增自定义模型</h3>
      <div className="row">
        <input
          className="grow"
          placeholder="upstream_id（如 deepseek-v4-mini）"
          value={newModel.upstream_id}
          onChange={(e) => setNewModel({ ...newModel, upstream_id: e.target.value })}
        />
        <input
          className="grow"
          placeholder="显示名（可选）"
          value={newModel.display_name}
          onChange={(e) => setNewModel({ ...newModel, display_name: e.target.value })}
        />
        <button onClick={addModel} disabled={!newModel.upstream_id}>
          添加
        </button>
      </div>

      <h3>别名（客户端 model 字段 → 上游 ID）</h3>
      {aliasesForActive.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>别名</th>
              <th>映射到</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {aliasesForActive.map((a) => (
              <tr key={a.alias}>
                <td className="mono">{a.alias}</td>
                <td className="mono">{a.upstream_id}</td>
                <td>
                  <button className="danger" onClick={() => removeAlias(a.alias)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">尚无别名</div>
      )}

      <div className="row">
        <input
          className="grow"
          placeholder="别名（客户端发的 model）"
          value={newAlias.alias}
          onChange={(e) => setNewAlias({ ...newAlias, alias: e.target.value })}
        />
        <select
          value={newAlias.upstream_id}
          onChange={(e) => setNewAlias({ ...newAlias, upstream_id: e.target.value })}
        >
          <option value="">— 选择上游模型 —</option>
          {models.map((m) => (
            <option key={m.upstream_id} value={m.upstream_id}>
              {m.upstream_id}
            </option>
          ))}
        </select>
        <button onClick={addAlias} disabled={!newAlias.alias || !newAlias.upstream_id}>
          添加
        </button>
      </div>
    </div>
  );
}
