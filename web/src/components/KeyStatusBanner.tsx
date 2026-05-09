import type { ProviderInfo } from "../api/client";

interface Props {
  providers: ProviderInfo[];
}

export function KeyStatusBanner({ providers }: Props) {
  const missing = providers.filter((p) => !p.api_key_present);
  if (missing.length === 0) {
    return (
      <div className="banner ok">
        <span className="ic">✓</span>
        <div className="body">
          所有 provider 的 API key 均已通过环境变量注入。
        </div>
      </div>
    );
  }
  return (
    <div className="banner warn">
      <span className="ic">!</span>
      <div className="body">
        <strong>未检测到以下 provider 的 API key：</strong>{" "}
        {missing.map((p) => p.display_name).join(", ")}
        <br />
        API key 不存储在本 UI 中。请通过环境变量注入对应 key 后重启 mimo2codex：
        <ul style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
          {missing.map((p) => (
            <li key={p.id}>
              {p.display_name}：<code>{p.api_key_env.join(" 或 ")}</code>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 8, color: "var(--muted)" }}>
          示例：
          <br />
          macOS / Linux:{" "}
          <code>export {missing[0].api_key_env[0]}=sk-xxxxxx</code>
          <br />
          Windows PowerShell:{" "}
          <code>$env:{missing[0].api_key_env[0]}="sk-xxxxxx"</code>
        </div>
      </div>
    </div>
  );
}
