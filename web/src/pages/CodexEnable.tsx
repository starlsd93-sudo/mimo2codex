import { useEffect, useMemo, useState } from "react";
import {
  api,
  type CodexState,
  type CodexTarget,
  type CodexTargetsResponse,
} from "../api/client";

type Busy = null | { kind: "apply" | "override" | "restore" | "clear"; key: string };

export function CodexEnable() {
  const [state, setState] = useState<CodexState | null>(null);
  const [targetsResp, setTargetsResp] = useState<CodexTargetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // Confirmation dialog state for the "external auth.json" warning.
  const [pendingApply, setPendingApply] = useState<CodexTarget | null>(null);

  async function load() {
    try {
      setError(null);
      const [s, t] = await Promise.all([api.codexState(), api.codexTargets()]);
      setState(s);
      setTargetsResp(t);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function rowKey(t: CodexTarget): string {
    return `${t.providerId}::${t.modelId}`;
  }

  async function doApply(t: CodexTarget) {
    setBusy({ kind: "apply", key: rowKey(t) });
    setError(null);
    setSuccess(null);
    try {
      const resp = await api.codexApply({ providerId: t.providerId, modelId: t.modelId });
      const backupNote =
        resp.authBackup || resp.tomlBackup
          ? `已备份原文件（ts=${resp.backupTs}）。`
          : "";
      setSuccess(
        `已写入 ${t.providerDisplayName} / ${t.modelId}。${backupNote}请完全退出并重启 Codex 让新配置生效。`
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function onApplyClick(t: CodexTarget) {
    if (state?.authJsonOwner === "external") {
      // Real OpenAI key (or unparseable JSON) detected — show confirmation.
      setPendingApply(t);
      return;
    }
    void doApply(t);
  }

  async function doOverride(t: CodexTarget) {
    setBusy({ kind: "override", key: rowKey(t) });
    setError(null);
    setSuccess(null);
    try {
      await api.setActiveOverride({ providerId: t.providerId, modelId: t.modelId });
      setSuccess(
        `运行时覆盖已设置为 ${t.providerDisplayName} / ${t.modelId}。无需重启 Codex，下一次请求即生效。`
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doClearOverride() {
    setBusy({ kind: "clear", key: "" });
    setError(null);
    setSuccess(null);
    try {
      await api.clearActiveOverride();
      setSuccess("运行时覆盖已清除，路由回到默认行为。");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doRestore(ts: number) {
    if (!confirm(`恢复到备份 ts=${ts}？当前 auth.json + config.toml 不会再次备份。`)) return;
    setBusy({ kind: "restore", key: String(ts) });
    setError(null);
    setSuccess(null);
    try {
      await api.codexRestore(ts);
      setSuccess(`已从备份 ts=${ts} 恢复 auth.json + config.toml。请重启 Codex。`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Group targets by provider for the table.
  const grouped = useMemo(() => {
    if (!targetsResp) return new Map<string, CodexTarget[]>();
    const m = new Map<string, CodexTarget[]>();
    for (const t of targetsResp.targets) {
      const arr = m.get(t.providerId) ?? [];
      arr.push(t);
      m.set(t.providerId, arr);
    }
    return m;
  }, [targetsResp]);

  return (
    <div>
      <h2>Codex 启用</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
        在这里一键切换 Codex 实际调用的模型，替代 ccswitch。提供两种机制：
      </p>
      <div className="banner info" style={{ marginBottom: 16 }}>
        <span className="ic">i</span>
        <div className="body">
          <div>
            <strong>写入文件并启用</strong>：物理写入 <code>~/.codex/auth.json</code> 和{" "}
            <code>~/.codex/config.toml</code>，与 ccswitch 行为一致。
            <strong> 需要重启 Codex</strong> 才能生效。原文件会被自动备份，可一键恢复。
          </div>
          <div style={{ marginTop: 6 }}>
            <strong>仅运行时覆盖</strong>：把激活的 (provider, model) 存到 mimo2codex 内部，
            <code> selectProvider</code> 路由时优先用它。
            <strong> 无需重启 Codex</strong>，但要求 Codex 已经能连到 mimo2codex（即首次接入仍需用上面那种方式）。
          </div>
        </div>
      </div>

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

      {state && <CurrentStateCard state={state} />}

      {state && (
        <>
          <h3>可启用组合</h3>
          {state.authJsonOwner === "external" && (
            <div className="banner warn" style={{ marginBottom: 12 }}>
              <span className="ic">⚠</span>
              <div className="body">
                当前 <code>~/.codex/auth.json</code> 不是 mimo2codex 写入的（可能是真 OpenAI 登录或其他工具）。
                点「写入文件并启用」会先自动备份再覆盖，恢复随时可做。
              </div>
            </div>
          )}
          {targetsResp && targetsResp.targets.length === 0 ? (
            <div className="empty">没有可启用的模型组合。</div>
          ) : (
            Array.from(grouped.entries()).map(([providerId, list]) => (
              <ProviderBlock
                key={providerId}
                providerId={providerId}
                providerDisplayName={list[0].providerDisplayName}
                targets={list}
                busy={busy}
                onApply={onApplyClick}
                onOverride={doOverride}
              />
            ))
          )}
        </>
      )}

      {state && <RuntimeOverrideCard state={state} busy={busy} onClear={doClearOverride} />}

      {state && <BackupCard state={state} busy={busy} onRestore={doRestore} />}

      {pendingApply && (
        <ConfirmModal
          title="覆盖 auth.json？"
          body={
            <>
              <p>
                当前 <code>~/.codex/auth.json</code> 不是 mimo2codex 写入的，可能保存着你真实的 OpenAI 登录信息。
              </p>
              <p>
                继续会自动备份它（<code>auth.json.bak.&lt;时间戳&gt;</code>）并写入 mimo2codex 占位 key。
                之后可通过下方「备份与恢复」一键恢复。
              </p>
              <p>
                目标：<strong>{pendingApply.providerDisplayName}</strong> /{" "}
                <code>{pendingApply.modelId}</code>
              </p>
            </>
          }
          onCancel={() => setPendingApply(null)}
          onConfirm={() => {
            const t = pendingApply;
            setPendingApply(null);
            void doApply(t);
          }}
          confirmLabel="备份并覆盖"
        />
      )}
    </div>
  );
}

function CurrentStateCard({ state }: { state: CodexState }) {
  const ownerTag =
    state.authJsonOwner === "mimo2codex" ? (
      <span className="tag ok">mimo2codex</span>
    ) : state.authJsonOwner === "external" ? (
      <span className="tag warn">外部（真 OpenAI key 或其他）</span>
    ) : (
      <span className="tag muted">尚未创建</span>
    );

  const currentToml = parseConfigToml(state.configTomlText);

  return (
    <>
      <h3>当前状态</h3>
      <table style={{ marginBottom: 16 }}>
        <tbody>
          <tr>
            <td style={{ width: 160 }}>Codex 目录</td>
            <td className="mono">{state.codexDir}</td>
          </tr>
          <tr>
            <td>auth.json</td>
            <td>
              {ownerTag}{" "}
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                {state.authPath}
              </span>
            </td>
          </tr>
          <tr>
            <td>config.toml</td>
            <td>
              {state.configTomlExists ? (
                <>
                  {currentToml.provider && (
                    <span className="tag">
                      provider=<code>{currentToml.provider}</code>
                    </span>
                  )}{" "}
                  {currentToml.model && (
                    <span className="tag">
                      model=<code>{currentToml.model}</code>
                    </span>
                  )}{" "}
                  {!currentToml.provider && !currentToml.model && (
                    <span className="tag muted">无法解析当前 model</span>
                  )}{" "}
                  <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                    {state.tomlPath}
                  </span>
                </>
              ) : (
                <span className="tag muted">尚未创建</span>
              )}
            </td>
          </tr>
          <tr>
            <td>运行时覆盖</td>
            <td>
              {state.activeOverride ? (
                <span className="tag ok">
                  <code>
                    {state.activeOverride.providerId} / {state.activeOverride.modelId}
                  </code>
                </span>
              ) : (
                <span className="tag muted">未设置</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function ProviderBlock({
  providerDisplayName,
  targets,
  busy,
  onApply,
  onOverride,
}: {
  providerId: string;
  providerDisplayName: string;
  targets: CodexTarget[];
  busy: Busy;
  onApply: (t: CodexTarget) => void;
  onOverride: (t: CodexTarget) => Promise<void>;
}) {
  const hasKey = targets[0]?.hasKey ?? false;
  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ margin: "12px 0 8px" }}>
        {providerDisplayName}{" "}
        {hasKey ? (
          <span className="tag ok">已配置 key</span>
        ) : (
          <span className="tag warn">未检测到 key</span>
        )}
      </h4>
      <table>
        <thead>
          <tr>
            <th>模型</th>
            <th>来源</th>
            <th>上下文</th>
            <th style={{ textAlign: "right" }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => {
            const key = `${t.providerId}::${t.modelId}`;
            const applyBusy = busy?.kind === "apply" && busy.key === key;
            const overrideBusy = busy?.kind === "override" && busy.key === key;
            return (
              <tr key={key}>
                <td>
                  <strong className="mono">{t.modelId}</strong>
                  {t.displayName && (
                    <span style={{ marginLeft: 8, color: "var(--muted)", fontSize: 12 }}>
                      {t.displayName}
                    </span>
                  )}
                  {t.isCurrentOverride && (
                    <>
                      {" "}
                      <span className="tag ok">运行时激活</span>
                    </>
                  )}
                </td>
                <td>
                  {t.source === "builtin" ? (
                    <span className="tag muted">内置</span>
                  ) : (
                    <span className="tag">自定义</span>
                  )}
                </td>
                <td className="mono">
                  {t.contextWindow ? t.contextWindow.toLocaleString() : "—"}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => onApply(t)}
                    disabled={!!busy}
                    title="写入 ~/.codex/auth.json 和 config.toml，需重启 Codex"
                  >
                    {applyBusy ? "写入中…" : "写入文件并启用"}
                  </button>{" "}
                  <button
                    className="secondary"
                    onClick={() => void onOverride(t)}
                    disabled={!!busy || !hasKey}
                    title={
                      hasKey
                        ? "把激活模型存到 settings DB，无需重启 Codex"
                        : "provider 没有 api key，无法作为运行时覆盖"
                    }
                  >
                    {overrideBusy ? "设置中…" : "仅运行时覆盖"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RuntimeOverrideCard({
  state,
  busy,
  onClear,
}: {
  state: CodexState;
  busy: Busy;
  onClear: () => Promise<void>;
}) {
  return (
    <>
      <h3>运行时覆盖</h3>
      {state.activeOverride ? (
        <div className="banner info">
          <span className="ic">i</span>
          <div className="body">
            <div>
              当前覆盖：<code>{state.activeOverride.providerId}</code> /{" "}
              <code>{state.activeOverride.modelId}</code>
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                className="secondary"
                onClick={() => void onClear()}
                disabled={busy?.kind === "clear"}
              >
                {busy?.kind === "clear" ? "清除中…" : "清除覆盖"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty">尚未设置运行时覆盖。点上面任意行的「仅运行时覆盖」启用。</div>
      )}
    </>
  );
}

function BackupCard({
  state,
  busy,
  onRestore,
}: {
  state: CodexState;
  busy: Busy;
  onRestore: (ts: number) => Promise<void>;
}) {
  return (
    <>
      <h3>备份与恢复</h3>
      {state.backups.length === 0 ? (
        <div className="empty">尚无备份。第一次「写入文件并启用」会自动产生备份。</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>时间戳</th>
              <th>本地时间</th>
              <th>auth.json</th>
              <th>config.toml</th>
              <th style={{ textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {state.backups.map((b) => {
              const complete = !!b.authBackup && !!b.tomlBackup;
              const busyHere = busy?.kind === "restore" && busy.key === String(b.ts);
              return (
                <tr key={b.ts}>
                  <td className="mono">{b.ts}</td>
                  <td>{new Date(b.ts).toLocaleString()}</td>
                  <td>
                    {b.authBackup ? (
                      <span className="tag ok">有</span>
                    ) : (
                      <span className="tag muted">无</span>
                    )}
                  </td>
                  <td>
                    {b.tomlBackup ? (
                      <span className="tag ok">有</span>
                    ) : (
                      <span className="tag muted">无</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="secondary"
                      onClick={() => void onRestore(b.ts)}
                      disabled={!complete || !!busy}
                      title={complete ? "" : "成对备份不完整，无法恢复"}
                    >
                      {busyHere ? "恢复中…" : "恢复"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function ConfirmModal({
  title,
  body,
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  title: string;
  body: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">{body}</div>
        <div className="modal-footer">
          <button className="secondary" onClick={onCancel}>
            取消
          </button>
          <button onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Best-effort TOML hint extraction for the status card. We only care about the
// top-level `model = "..."` and `model_provider = "..."` keys; the rest of the
// file may be arbitrary and we leave full TOML parsing to Codex itself.
function parseConfigToml(text: string | null): { model: string | null; provider: string | null } {
  if (!text) return { model: null, provider: null };
  const modelMatch = /^\s*model\s*=\s*"([^"\n]+)"/m.exec(text);
  const providerMatch = /^\s*model_provider\s*=\s*"([^"\n]+)"/m.exec(text);
  return {
    model: modelMatch?.[1] ?? null,
    provider: providerMatch?.[1] ?? null,
  };
}
