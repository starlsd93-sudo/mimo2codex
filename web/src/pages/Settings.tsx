import { useEffect, useState } from "react";
import { api, type ProviderInfo } from "../api/client";
import { KeyStatusBanner } from "../components/KeyStatusBanner";

export function Settings() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [dataDir, setDataDir] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const [p, s, h] = await Promise.all([api.providers(), api.settings(), api.health()]);
      setProviders(p.providers);
      setSettings(s.settings);
      setDataDir(h.dataDir);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveSetting(key: string, value: string) {
    try {
      setError(null);
      setSuccess(null);
      await api.setSetting(key, value);
      setSuccess(`已保存 ${key}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h2>设置</h2>

      {error && (
        <div className="banner err">
          <span className="ic">!</span>
          <div className="body">{error}</div>
        </div>
      )}
      {success && (
        <div className="banner ok">
          <span className="ic">✓</span>
          <div className="body">{success}</div>
        </div>
      )}

      <h3>API Key 状态</h3>
      <KeyStatusBanner providers={providers} />

      <div className="banner info" style={{ marginTop: 12 }}>
        <span className="ic">i</span>
        <div className="body">
          <strong>API key 不在 UI 中存储，也不写入数据库。</strong>{" "}
          这是为了避免凭据落盘后被备份/泄漏。
          请通过环境变量注入 key 后重启 mimo2codex：
          <ul style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
            <li>
              MiMo：<code>MIMO_API_KEY</code>
            </li>
            <li>
              DeepSeek：<code>DS_API_KEY</code> 或 <code>DEEPSEEK_API_KEY</code>
            </li>
          </ul>
          <div style={{ marginTop: 8 }}>
            <code>export DS_API_KEY=sk-xxxxxx && mimo2codex --model ds</code>
          </div>
        </div>
      </div>

      <h3>Provider 配置</h3>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>状态</th>
            <th>Base URL</th>
            <th>默认模型</th>
            <th>Env 变量</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id}>
              <td>
                <strong>{p.display_name}</strong>{" "}
                {p.default && <span className="tag ok">默认</span>}
              </td>
              <td>
                {p.api_key_present ? (
                  <span className="tag ok">已检测到 key</span>
                ) : (
                  <span className="tag warn">未检测到 key</span>
                )}
              </td>
              <td className="mono">{p.base_url}</td>
              <td className="mono">{p.default_model}</td>
              <td className="mono">{p.api_key_env.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>本地数据目录</h3>
      <div className="field">
        <label>当前 dataDir</label>
        <input value={dataDir} disabled />
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
        数据目录由启动参数决定（CLI <code>--data-dir</code> 或 env{" "}
        <code>MIMO2CODEX_DATA_DIR</code>），UI 不可改写。默认为{" "}
        <code>~/.mimo2codex/</code>。
      </p>

      <h3>UI 偏好</h3>
      <SettingRow
        keyName="ui.theme"
        label="主题"
        value={settings["ui.theme"] ?? "dark"}
        onSave={saveSetting}
      />
      <SettingRow
        keyName="ui.density"
        label="密度"
        value={settings["ui.density"] ?? "comfortable"}
        onSave={saveSetting}
      />
    </div>
  );
}

function SettingRow({
  keyName,
  label,
  value,
  onSave,
}: {
  keyName: string;
  label: string;
  value: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const [v, setV] = useState(value);
  useEffect(() => {
    setV(value);
  }, [value]);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row" style={{ margin: 0 }}>
        <input className="grow" value={v} onChange={(e) => setV(e.target.value)} />
        <button onClick={() => onSave(keyName, v)} disabled={v === value}>
          保存
        </button>
      </div>
    </div>
  );
}
