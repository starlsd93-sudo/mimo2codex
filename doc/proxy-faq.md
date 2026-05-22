# Proxy / Network FAQ (macOS & Windows)

<p>
  <a href="./proxy-faq.md"><strong>English</strong></a> ·
  <a href="./proxy-faq.zh.md">简体中文</a>
</p>

When mimo2codex misbehaves on Mac or Windows, the issue is usually **not** the program itself — it's the surrounding **network proxy / VPN / DNS / firewall** layer. This FAQ collects, per-platform and per-error-code, where to look and what to change.

> Fast path: jump to section 5 ("Error code lookup") and match the exact text you're seeing.

---

## 1. The two network hops

```
[Codex CLI / Codex Desktop]
        │  ① local loopback (127.0.0.1:8788)
        ▼
[mimo2codex]
        │  ② outbound HTTPS (subject to system proxy / VPN / firewall)
        ▼
[Upstream LLM API: token-plan-cn.xiaomimimo.com / api.deepseek.com / api.moonshot.cn / ...]
```

Each hop has its own failure modes:

- **① Client → mimo2codex**: loopback, almost never the problem. If port `8788` is busy or mimo2codex isn't running, the client sees `ECONNREFUSED` — **not 502**.
- **② mimo2codex → upstream**: the source of most 502 / `ETIMEDOUT` / `ENOTFOUND` errors.

**Key fact (v0.4.5+)**: mimo2codex **reads** `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` env vars on startup and routes its upstream fetch through them — same behavior as `curl` / `git`. But **"system proxy" ≠ "process proxy"**: toggling the "System Proxy" switch in macOS Settings, Clash for Mac, Clash for Windows, Surge, V2RayN, etc. **does not** auto-export these env vars to the mimo2codex process. To route mimo2codex through a proxy, **explicitly export** `HTTPS_PROXY` / `HTTP_PROXY` (see §3.2 / §4.2) — or declare them in the `environment:` section of `docker-compose.yml` for Docker deployments.

> 🩺 **Self-check**: mimo2codex's startup banner always prints a `proxy:` line. Read it:
> - **`proxy: HTTPS_PROXY=http://...`** → env recognised, outbound calls go through that proxy. If you're still hitting 502, the failure is in the proxy → upstream hop, not env-detection. Jump to §5.
> - **`proxy: direct (no HTTPS_PROXY / HTTP_PROXY in env)`** → env wasn't passed to the mimo2codex process; all outbound calls go direct. If upstream needs a proxy, go back and `export` it (or fix `docker-compose.yml` `environment:` / systemd unit `Environment=`), then restart mimo2codex.
> - **`proxy: disabled (MIMO2CODEX_NO_PROXY_FROM_ENV=1)`** → you explicitly opted out; outbound calls go direct even if `HTTPS_PROXY` is set.
>
> This single line resolves the most common variant of "I toggled my proxy's system-proxy switch but mimo2codex still 502s."
>
> Want mimo2codex to ignore proxy env vars even when they're present (e.g. your shell exports `HTTPS_PROXY` for `curl` / `git` but it can't reach mimo2codex's upstream)? Set `MIMO2CODEX_NO_PROXY_FROM_ENV=1`.

---

## 2. When you need a proxy, when you don't

Per-upstream rule of thumb (**not absolute** — adjust for your actual network):

| Upstream | China mainland | Outside China |
|----------|----------------|---------------|
| MiMo (`xiaomimimo.com`) | direct | usually needs proxy |
| DeepSeek (`api.deepseek.com`) | direct | direct |
| Kimi / Moonshot (`api.moonshot.cn`) | direct | usually needs proxy |
| Zhipu GLM (`open.bigmodel.cn`) | direct | usually needs proxy |
| Qwen DashScope | direct | usually needs proxy |
| OpenAI (`api.openai.com`) | **needs proxy** | direct |

Note: **MiMo token-plan's baseUrl is a China-mainland domain**. China-mainland users should **not** point mimo2codex at a proxy. Running Clash in "global mode" can actually break this domain (proxy node unreachable / TLS relay failure) and surface as a 502.

---

## 3. macOS

### 3.1 The three proxy modes

- **System Proxy** (System Settings → Network → Proxies): only affects apps using the macOS network framework. **Does not affect Node.js.**
- **Clash for Mac / Surge / ShadowsocksX-NG / V2Box "system proxy" toggle**: writes system proxy, same as above — does not affect Node.js.
- **TUN mode** (Surge Enhanced Mode / Clash TUN / Mihomo TUN): intercepts all TCP/UDP at the network stack, **does affect Node.js**. Requires admin authorization.

### 3.2 Routing mimo2codex through a proxy

**Temporary (current shell only)**:

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
export NO_PROXY=localhost,127.0.0.1,::1
mimo2codex
```

**Persistent (shell rc file)**:

```bash
# zsh (macOS default)
cat >> ~/.zshrc <<'EOF'
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
export NO_PROXY=localhost,127.0.0.1,::1
EOF
source ~/.zshrc
```

**Important**:

- `7890` is Clash's default HTTP-proxy port; Surge defaults are `6152` / `6153`; V2Box might be `1087`. Use whatever your proxy app actually listens on.
- **`NO_PROXY=localhost,127.0.0.1,::1` is mandatory.** Otherwise, when Codex talks to mimo2codex via `127.0.0.1:8788`, the proxy app intercepts that too and produces `tunneling socket could not be established` or similar.

### 3.3 macOS sanity-check commands

```bash
# 1. Are the proxy env vars actually set?
env | grep -i proxy

# 2. Bypass mimo2codex — curl the upstream directly to test the network layer.
curl -v https://token-plan-cn.xiaomimimo.com/v1/models -H "Authorization: Bearer $YOUR_KEY"

# 3. Is mimo2codex listening on 8788?
lsof -i :8788

# 4. mimo2codex log (if redirected to a file)
tail -n 50 ~/.mimo2codex/mimo2codex.log 2>/dev/null
# Otherwise, look at the terminal you launched mimo2codex from.
```

---

## 4. Windows

### 4.1 The three proxy modes

- **Windows Settings → Network → Proxy**: affects WinINET (IE / legacy Edge / some Win32 apps). **Node.js does not use WinINET — no effect.**
- **Clash for Windows / V2RayN / Clash Verge "system proxy" toggle**: writes WinINET + some WinHTTP, **Node.js still doesn't read either — no effect**.
- **TUN mode** (Clash Verge → TUN Mode / Clash for Windows → TUN): kernel-level traffic capture, **does affect Node.js**. Requires admin and a correctly configured Service Mode.

### 4.2 Routing mimo2codex through a proxy

**PowerShell, temporary (current window)**:

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:HTTP_PROXY  = "http://127.0.0.1:7890"
$env:NO_PROXY    = "localhost,127.0.0.1,::1"
mimo2codex
```

**PowerShell, persistent (user env vars, new windows pick it up)**:

```powershell
setx HTTPS_PROXY "http://127.0.0.1:7890"
setx HTTP_PROXY  "http://127.0.0.1:7890"
setx NO_PROXY    "localhost,127.0.0.1,::1"
```

> `setx` **does not** affect the PowerShell window you're typing in — open a **new** PowerShell to see the value.

**CMD, temporary**:

```cmd
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
set NO_PROXY=localhost,127.0.0.1,::1
mimo2codex
```

**Important**:

- Default ports: Clash for Windows = `7890`; Clash Verge = `7897`; V2RayN = `10809`. Use whatever your app actually listens on.
- `NO_PROXY=localhost,127.0.0.1,::1` is still mandatory.

### 4.3 Windows sanity-check commands

```powershell
# 1. Proxy env vars set?
Get-ChildItem env: | Where-Object Name -match 'proxy'

# 2. Hit upstream directly with curl (PowerShell 7+ has curl.exe; Windows 10/11 bundles it too)
curl.exe -v https://token-plan-cn.xiaomimimo.com/v1/models -H "Authorization: Bearer $env:YOUR_KEY"

# 3. Is mimo2codex listening on 8788?
Get-NetTCPConnection -LocalPort 8788 -ErrorAction SilentlyContinue

# 4. mimo2codex log (default dir)
Get-Content $env:USERPROFILE\.mimo2codex\mimo2codex.log -Tail 50 -ErrorAction SilentlyContinue
```

---

## 5. Error code lookup

Match the exact text you see in the client / terminal.

### `unexpected status 502 Bad Gateway` (same as issue #21)

- **Meaning**: mimo2codex is running and listening, but **both** attempts at the outbound HTTPS call to upstream failed (mimo2codex retries once internally).
- **First check**: does the startup banner show a `proxy:` line?
  - **Banner shows proxy enabled** → mimo2codex is routing through your proxy; the failure is in the proxy → upstream hop or upstream itself.
  - **No `proxy:` line** → mimo2codex is going direct. Either upstream needs a proxy and your env vars weren't exported (most common), or upstream is genuinely down / blocked.
- **Likely causes** (in order of frequency):
  1. Upstream needs proxy but env vars weren't exported to the mimo2codex process — most common with Clash/Surge "system proxy" toggle. See §1's self-check.
  2. Upstream provider outage — verify with `curl` from section 3.3 / 4.3.
  3. Wrong proxy port / proxy not running → see `ECONNREFUSED <proxy-host>:<proxy-port>` below.
  4. Corporate firewall / VPN blocking it → toggle off briefly to compare.
  5. DNS poisoning / IPv6 problems → launch with `NODE_OPTIONS=--dns-result-order=ipv4first`.
  6. TLS-intercepting corporate proxy → see `DEPTH_ZERO_SELF_SIGNED_CERT` below.
- Starting v0.4.5, the `WARN upstream connect failed` log line carries the underlying cause code (e.g. `code: 'ECONNREFUSED'`, `'ENOTFOUND'`, `'ETIMEDOUT'`) — use that to triangulate quickly instead of guessing.

### `ECONNREFUSED <proxy-host>:<proxy-port>` (in the upstream log)

- **Meaning**: mimo2codex tried to dial the proxy you configured via `HTTPS_PROXY` / `HTTP_PROXY` and got no listener on that host:port.
- **Common causes**: typo in the port, proxy app not running, proxy bound only to `127.0.0.1` while mimo2codex (in Docker) is on a different network.
- **Check**:
  - Verify the proxy is actually listening: `lsof -iTCP -P | grep <port>` (mac) / `Get-NetTCPConnection -LocalPort <port>` (win).
  - Try `curl -v -x http://<proxy>:<port> https://upstream.example.com/` from the same host (or inside the same Docker network) — if curl fails the same way, fix the proxy side first.
  - **Docker gotcha**: `HTTPS_PROXY=http://127.0.0.1:7890` doesn't work inside a container — `127.0.0.1` is the container itself. Use `host.docker.internal` (mac/win) or the host's LAN IP.

### `connect ECONNREFUSED 127.0.0.1:8788`

- **Meaning**: the Codex client **can't reach mimo2codex itself**.
- **Versus 502**: 502 = "proxy is up, upstream is down"; ECONNREFUSED = "proxy isn't running or wrong port".
- **Check**:
  - Mac: `lsof -i :8788`
  - Win: `Get-NetTCPConnection -LocalPort 8788`
  - If the port is taken: launch with `mimo2codex --port 8889` and update Codex's baseUrl to match.

### `Reconnecting... 1/5 ... unexpected status 502 Bad Gateway`

Same root cause as 502 above. Codex has a 5-attempt reconnect loop; 5 failures in a row means upstream stays down. **This isn't a Codex networking bug — it's mimo2codex's outbound hop failing.**

### `tunneling socket could not be established` / `socket hang up`

Your proxy app is intercepting `127.0.0.1` too. **Set `NO_PROXY=localhost,127.0.0.1,::1`** and restart mimo2codex.

### `DEPTH_ZERO_SELF_SIGNED_CERT` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `self-signed certificate`

Your corporate proxy is doing TLS man-in-the-middle. Export its CA as `.pem` and launch with:

```bash
# Mac
NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem mimo2codex

# Windows PowerShell
$env:NODE_EXTRA_CA_CERTS = "C:\path\to\corp-ca.pem"
mimo2codex
```

**Don't** use `NODE_TLS_REJECT_UNAUTHORIZED=0` — that disables all TLS verification, which is unsafe.

### `ENOTFOUND` / `getaddrinfo ENOTFOUND ...`

DNS resolution failed. Try one of:

- Force IPv4 first: launch with `NODE_OPTIONS=--dns-result-order=ipv4first`.
- Switch DNS: 1.1.1.1 (Cloudflare) / 8.8.8.8 (Google) / 223.5.5.5 (Alibaba CN).
- Include `nslookup <upstream-domain>` output in any issue you open.

### `ETIMEDOUT` / `ECONNRESET`

The upstream or proxy is half-broken. Try:

- Swap proxy node.
- Switch proxy to "global" or "TUN" mode.
- Disable IPv6 temporarily: on Mac, set IPv6 to `Link-local only`; on Win, untick IPv6 on the adapter.

---

## 6. Copy-paste starter configs

### Scenario A: China-mainland user hitting MiMo / DeepSeek (**no proxy**)

```bash
# macOS
unset HTTPS_PROXY HTTP_PROXY
mimo2codex
```

```powershell
# Windows PowerShell
Remove-Item env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item env:HTTP_PROXY  -ErrorAction SilentlyContinue
mimo2codex
```

### Scenario B: overseas / OpenAI generic provider (proxy required)

```bash
# macOS, Clash default 7890
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
export NO_PROXY=localhost,127.0.0.1,::1
mimo2codex
```

```powershell
# Windows PowerShell, Clash for Windows default 7890
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:HTTP_PROXY  = "http://127.0.0.1:7890"
$env:NO_PROXY    = "localhost,127.0.0.1,::1"
mimo2codex
```

---

## 7. What does `INFO model fallback applied` in the console mean?

> **Starting in v0.2.18**, this log was downgraded from `WARN` to `INFO` and the message was rewritten. Older versions (≤ v0.2.17) print `WARN client model rewritten on the way upstream` instead.

Sample:

```
[2026-05-20T02:07:51.792Z] INFO model fallback applied — client sent unknown model id, request continues with provider default {
  provider: 'mimo',
  from: 'gpt-5.4',
  to: 'mimo-v2.5-pro',
  reason: "unknown client model — falling back to mimo provider's defaultModel"
}
```

**This is not an error. The request itself completes normally.** What it means:

- The `model` field your Codex client sent (`gpt-5.4`) isn't in any provider's `builtinModels` list.
- mimo2codex automatically routed it to the default provider (here `mimo`) and its default model (`mimo-v2.5-pro`).
- Upstream sees `model=mimo-v2.5-pro` and the response is forwarded back to Codex normally.

**Why log it at all?** Because silent rewrites hide a real class of bug: you think you're calling a vision-capable model and you sent images, but you were actually routed to a non-vision default and the images were dropped. Without this log, that bug is invisible. Hence the INFO line — visible but no longer scary.

### 7.1 Where does `gpt-5.4` / `gpt-5.4-mini` even come from?

**Not a Codex "probe packet."** It's the literal `model` field from your `~/.codex/config.toml` (or the "Models" setting in Codex Desktop). Codex doesn't inject internal model names — it sends whatever you configured.

Typical path to this log line:

1. You chose "Custom OpenAI-compatible service" in Codex Desktop and pointed the baseUrl at `http://127.0.0.1:8788`.
2. **You left the model field at Codex's factory default.** Different Codex versions ship different defaults — recent ones have used `gpt-5`, `gpt-5-codex`, `gpt-5-mini`, `gpt-5.4`, `gpt-5.4-mini` as placeholders.
3. Codex sends that literal string in every request's `model` field.
4. mimo2codex can't find `gpt-5.4` in any provider's `builtinModels`, so it falls back to the default provider's default model (`mimo-v2.5-pro`).

> Sanity check: OpenAI has never released a model called `gpt-5.4`. The string is a Codex-internal placeholder, unrelated to any real OpenAI model version.
>
> Cross-reference: [doc/minimax.md](./minimax.md) documents the same behavior from an earlier Codex version that defaulted to `gpt-5.5`. MiniMax has no fallback path and 400s outright, which is why the generic provider gained a `forceDefaultModel` / `GENERIC_FORCE_DEFAULT_MODEL` switch — see [doc/generic-providers.md](./generic-providers.md).

**Want the INFO line to go away?** Three options:

1. **Change the `model` field on the Codex side** (recommended). Open the [Codex Enable](./codex-enable.md) page in the admin webui and pick the model you want — it writes `~/.codex/config.toml` for you. Or edit the file directly: `model = "gpt-5.4"` → `model = "mimo-v2.5-pro"` (or whichever mimo / deepseek / generic id you use).
2. **Accept the fallback** and change nothing. Requests still work; the only side effect is the INFO line.
3. **Use `forceDefaultModel` on a generic provider** (only when you're plugging in an env-var-single-instance generic provider and can't change the Codex side). See [doc/minimax.md](./minimax.md) for the same workaround.

### 7.2 What does `INFO backfilled placeholder reasoning_content ...` mean after I toggle the thinking switch?

Sample:

```
[2026-05-20T02:42:14.123Z] INFO backfilled placeholder reasoning_content onto 1 historical assistant message(s) so thinking can stay ON for this request. These turns originally ran with thinking OFF (or the client didn't echo reasoning items). Placeholder text: "(this turn ran without thinking mode)". If the upstream rejects this with a 400, please open an issue — we can fall back to silently disabling thinking.
```

**Also an INFO, not an error. The request completes normally AND thinking stays ON.** mimo2codex detected that the conversation history contains assistant message(s) **without reasoning_content**, while the current request is in thinking mode. To avoid an upstream 400, mimo2codex **backfills a fixed placeholder string** (`"(this turn ran without thinking mode)"`) as `reasoning_content` on those historical messages. That satisfies the upstream's non-empty check and keeps thinking ON for the current request.

**The MiMo constraint**: MiMo (and DeepSeek V4, etc.) in thinking mode **scan the entire conversation history**: if any historical assistant message lacks reasoning_content, the upstream 400s outright:

```
Param Incorrect: The reasoning_content in the thinking mode must be passed back to the API.
```

History can end up with assistant turns missing reasoning_content via:

1. **You toggled thinking mid-conversation**: the first few turns ran with thinking OFF (so those assistant turns never produced reasoning_content), then you toggled thinking ON in the admin webui and continued the same session. The early assistant messages have no reasoning_content to pass back.
2. **Client doesn't echo reasoning items**: some Codex Desktop builds treat reasoning as ephemeral UI state and never store it in the conversation history — every subsequent turn arrives without it.

**Why placeholder instead of just disabling thinking?** Because disabling thinking would defeat the user's intent — you explicitly toggled thinking ON in the admin UI. With the placeholder approach:

- The current request **really does run with thinking** (the upstream reasons over the history + current prompt).
- The historical "non-thinking" turns carry the explicit marker `(this turn ran without thinking mode)`, which is visible to the model, so it won't mistake them for prior real reasoning.
- No need to start a new conversation.

**When should I start a new conversation anyway?** Only if you subjectively feel the conversation has gotten "polluted" enough that the marker-laden history confuses you or the model. Technically not required.

**What if the upstream still rejects the placeholder?** Rare, but possible if MiMo / DeepSeek tighten validation. The fallback is to silently disable thinking for that request (with a corresponding INFO message). If you see a 400 even with the placeholder, please open an issue with the details listed in [§8 Info to include in issues](#8-info-to-include-in-issues) and we'll switch strategies.

---

## 8. Info to include in issues

If the steps above don't unstick you, when you open an issue please attach:

1. mimo2codex version (`mimo2codex --version`).
2. OS (mac / win + version).
3. **Full output** of the 4 sanity-check commands from section 3.3 / 4.3.
4. The last ~50 lines of mimo2codex's startup log (**redact API keys**).
5. Whether you're using Codex CLI or Codex Desktop, plus its version.
6. The `model` field value from `~/.codex/config.toml` (no need to paste the whole file; redact anything sensitive other than baseUrl).

With those, we can usually separate "network/proxy problem" from "mimo2codex bug" in one round instead of three.
