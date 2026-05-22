# 代理 / 网络 常见问题（mac & win）

<p>
  <a href="./proxy-faq.md">English</a> ·
  <a href="./proxy-faq.zh.md"><strong>简体中文</strong></a>
</p>

mimo2codex 在 Mac / Windows 上跑起来后，最常踩的坑不是程序本身，而是**网络代理 / VPN / DNS / 防火墙**这一层。本文档把"出错时该看哪、怎么定位、怎么改"按平台和报错码归到一处。

> 找问题快速通道：先翻第 5 节"错误码自查表"，按你看到的报错文本对号入座。

---

## 1. mimo2codex 的两条网络链路

```
[Codex CLI / Codex Desktop]
        │  ① 本地回环（127.0.0.1:8788）
        ▼
[mimo2codex]
        │  ② 出站 HTTPS（受系统代理 / VPN / 防火墙影响）
        ▼
[Upstream LLM API: token-plan-cn.xiaomimimo.com / api.deepseek.com / api.moonshot.cn / ...]
```

两条链路各自有不同的失败模式：

- **① 客户端 → mimo2codex**：本地回环，几乎不出问题。除非 `8788` 端口被占用或 mimo2codex 没启动 —— 此时客户端报 `ECONNREFUSED`，**不是 502**。
- **② mimo2codex → 上游 API**：502 / `ETIMEDOUT` / `ENOTFOUND` 等错误的主要发源地。

**关键事实（v0.4.5+）**：mimo2codex 启动时**会读** `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` 环境变量，把上游 fetch 路由到代理 —— 行为与 `curl` / `git` 一致。但**"系统代理" ≠ "进程代理"**：你在 macOS 系统设置、Clash for Mac / Clash for Windows / Surge / V2RayN 等 UI 里点的"系统代理"开关**不会**自动把这几个 env 导出给 mimo2codex 进程。要让 mimo2codex 走代理，得**显式 `export`** `HTTPS_PROXY` / `HTTP_PROXY`（见 §3.2 / §4.2）—— Docker 部署就在 `docker-compose.yml` 的 `environment:` 段声明。

> 🩺 **自检**：mimo2codex 启动 banner 永远会打一行 `proxy:`，看这行的内容：
> - **`proxy: HTTPS_PROXY=http://...`** → env 已识别，出站请求会走该代理。还 502 说明问题在代理 → 上游这一跳，跟 env 识别无关，去 §5 查错误码。
> - **`proxy: direct (no HTTPS_PROXY / HTTP_PROXY in env)`** → env 没传进 mimo2codex 进程，出站走直连。如果上游需要代理，回去把 `export` / `docker-compose.yml` `environment:` / systemd unit 的 `Environment=` 检查一遍并重启 mimo2codex。
> - **`proxy: disabled (MIMO2CODEX_NO_PROXY_FROM_ENV=1)`** → 你显式 opt-out 了，即便 env 里有 `HTTPS_PROXY` 也走直连。
>
> 这一行能解掉历史上最多的"我点了 Clash 系统代理但 mimo2codex 还是 502"投诉。
>
> 想让 mimo2codex 即便看到 env 里的代理变量也不走代理（典型场景：你 shell 里为 `curl` / `git` 常驻了 `HTTPS_PROXY`，但代理到不了上游）？设置 `MIMO2CODEX_NO_PROXY_FROM_ENV=1` 即可关掉本特性。

---

## 2. 何时需要代理 / 何时不要

按上游域名给一个常识性参考（**不是绝对**，请按你所处网络环境调整）：

| 上游 | 大陆境内 | 境外 |
|------|----------|------|
| MiMo (`xiaomimimo.com`) | 直连 | 通常需代理 |
| DeepSeek (`api.deepseek.com`) | 直连 | 直连 |
| Kimi / Moonshot (`api.moonshot.cn`) | 直连 | 通常需代理 |
| 智谱 GLM (`open.bigmodel.cn`) | 直连 | 通常需代理 |
| 通义 / Qwen DashScope | 直连 | 通常需代理 |
| OpenAI (`api.openai.com`) | **需代理** | 直连 |

提示：**MiMo token-plan 的 baseUrl 是国内域名**，大陆境内用户不要给 mimo2codex 设代理。如果开着 Clash "全局模式" 把这个域名也代理出去，反而会因为代理节点不通 / TLS 中转失败导致 502。

---

## 3. macOS 篇

### 3.1 三种常见代理方式

- **系统代理**（系统设置 → 网络 → 代理）：只影响走 macOS 网络框架的 GUI 应用。**对 Node.js 无效。**
- **Clash for Mac / Surge / ShadowsocksX-NG / V2Box 的"系统代理"开关**：本质就是写系统代理，同上对 Node.js 无效。
- **TUN 模式**（Surge Enhanced Mode / Clash TUN / Mihomo TUN）：在网络栈层接管所有 TCP/UDP 流量，**对 Node.js 也生效**。需要管理员授权。

### 3.2 给 mimo2codex 显式设代理

**临时（仅当前终端有效）**：

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
export NO_PROXY=localhost,127.0.0.1,::1
mimo2codex
```

**永久（写入 shell 配置）**：

```bash
# zsh（macOS 默认）
cat >> ~/.zshrc <<'EOF'
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
export NO_PROXY=localhost,127.0.0.1,::1
EOF
source ~/.zshrc
```

**重要**：

- `7890` 是 Clash 的默认 HTTP 代理端口；Surge 默认是 `6152` / `6153`；V2Box 默认 `1087` 之类。请按你自己代理软件实际监听端口替换。
- **必须设 `NO_PROXY=localhost,127.0.0.1,::1`**。否则 Codex 通过 `127.0.0.1:8788` 调 mimo2codex 时也会被代理软件截走，出现 `tunneling socket could not be established` 或类似错误。

### 3.3 macOS 自查命令

```bash
# 1. 看代理环境变量是否生效
env | grep -i proxy

# 2. 绕过 mimo2codex，用 curl 直接试上游（验证网络链路本身）
curl -v https://token-plan-cn.xiaomimimo.com/v1/models -H "Authorization: Bearer $YOUR_KEY"

# 3. 看 mimo2codex 是否监听 8788
lsof -i :8788

# 4. 看 mimo2codex 日志（如果重定向到了文件）
tail -n 50 ~/.mimo2codex/mimo2codex.log 2>/dev/null
# 没重定向的话，直接看启动 mimo2codex 的那个终端窗口的输出
```

---

## 4. Windows 篇

### 4.1 三种常见代理方式

- **Windows 设置 → 网络 → 代理**：影响 WinINET（IE / Edge legacy / 部分 Win32 应用）。**Node.js 不走 WinINET，不生效。**
- **Clash for Windows / V2RayN / Clash Verge 的"系统代理"开关**：写的就是 WinINET + 部分 WinHTTP，**Node.js 同样不走，不生效**。
- **TUN 模式**（Clash Verge → TUN Mode / Clash for Windows → TUN）：内核层接管所有流量，**对 Node.js 生效**。需要管理员权限和 Service Mode 配置正确。

### 4.2 给 mimo2codex 显式设代理

**PowerShell 临时（当前窗口有效）**：

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:HTTP_PROXY  = "http://127.0.0.1:7890"
$env:NO_PROXY    = "localhost,127.0.0.1,::1"
mimo2codex
```

**PowerShell 永久（写入用户环境变量，新窗口生效）**：

```powershell
setx HTTPS_PROXY "http://127.0.0.1:7890"
setx HTTP_PROXY  "http://127.0.0.1:7890"
setx NO_PROXY    "localhost,127.0.0.1,::1"
```

> `setx` **不会**影响当前已经打开的 PowerShell 窗口；得**新开一个 PowerShell** 才能拿到设置。

**CMD 临时**：

```cmd
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
set NO_PROXY=localhost,127.0.0.1,::1
mimo2codex
```

**重要**：

- 端口默认值：Clash for Windows = `7890`；Clash Verge = `7897`；V2RayN = `10809`。按你自己代理软件的"本地端口"配置替换。
- 同样必须配 `NO_PROXY=localhost,127.0.0.1,::1`，否则本地回环也会被代理拦截。

### 4.3 Windows 自查命令

```powershell
# 1. 看代理环境变量
Get-ChildItem env: | Where-Object Name -match 'proxy'

# 2. 用 curl 直接试上游（PowerShell 7+ 自带 curl.exe；Windows 10 也内置）
curl.exe -v https://token-plan-cn.xiaomimimo.com/v1/models -H "Authorization: Bearer $env:YOUR_KEY"

# 3. 看 mimo2codex 是否监听 8788
Get-NetTCPConnection -LocalPort 8788 -ErrorAction SilentlyContinue

# 4. 看 mimo2codex 日志（默认目录）
Get-Content $env:USERPROFILE\.mimo2codex\mimo2codex.log -Tail 50 -ErrorAction SilentlyContinue
```

---

## 5. 错误码自查表

按你在客户端 / 终端看到的报错文本对号入座。

### `unexpected status 502 Bad Gateway`（issue #21 同款）

- **含义**：mimo2codex 进程在跑、HTTP 监听正常，但出站访问上游 API 失败两次（mimo2codex 内置重试 1 次）。
- **先看启动 banner 有没有 `proxy:` 行**：
  - **有**：mimo2codex 已经在走你配置的代理，失败点在代理 → 上游这一跳，或上游本身。
  - **没有**：mimo2codex 走直连。要么上游需要代理但 env 没传进进程（最常见），要么上游真不可达 / 被封。
- **可能原因（按概率排序）**：
  1. 上游需要代理但 env 没传进 mimo2codex 进程 —— 最典型是 Clash/Surge 只点了"系统代理"开关。按 §1 的自检走一遍。
  2. 上游服务方临时故障 → 用 §3.3 / §4.3 里的 `curl` 直连验证。
  3. 代理端口写错 / 代理软件没起 → 看下面 `ECONNREFUSED <代理-host>:<代理-port>` 那条。
  4. 公司防火墙 / VPN 阻断 → 临时关掉对照测试。
  5. DNS 污染 / IPv6 不通 → 启动 mimo2codex 时加 `NODE_OPTIONS=--dns-result-order=ipv4first`。
  6. 走的是 TLS-MITM 的企业代理 → 看下文 `DEPTH_ZERO_SELF_SIGNED_CERT` 那条。
- 自 v0.4.5 起，`WARN upstream connect failed` 这条日志会带上 underlying cause 的 code（如 `code: 'ECONNREFUSED'` / `'ENOTFOUND'` / `'ETIMEDOUT'`），可以直接据此定位，不用再凭 `fetch failed` 五个字猜。

### `ECONNREFUSED <代理-host>:<代理-port>`（出现在 upstream 日志里）

- **含义**：mimo2codex 按你配的 `HTTPS_PROXY` / `HTTP_PROXY` 去拨代理，但那个 host:port 没人监听。
- **常见原因**：端口写错、代理软件没启动、代理只监听 `127.0.0.1` 而 mimo2codex（Docker 部署）在另一个网络命名空间。
- **自查**：
  - 确认代理在监听：`lsof -iTCP -P | grep <port>`（mac）/ `Get-NetTCPConnection -LocalPort <port>`（win）。
  - 在同一台主机（或同一个 Docker 网络里）用 `curl -v -x http://<proxy>:<port> https://upstream.example.com/` 直连测一下，curl 也不通就先修代理这一侧。
  - **Docker 坑**：`HTTPS_PROXY=http://127.0.0.1:7890` 在容器里指的是容器自己，不是宿主。要写 `host.docker.internal`（mac/win）或宿主的 LAN IP。

### `connect ECONNREFUSED 127.0.0.1:8788`

- **含义**：Codex 客户端**连不上 mimo2codex 自己**。
- **跟 502 的区别**：502 = "代理在跑但上游不通"；ECONNREFUSED = "代理根本没起或端口不对"。
- **自查**：
  - Mac：`lsof -i :8788`
  - Win：`Get-NetTCPConnection -LocalPort 8788`
  - 如果端口被别的进程占了：换端口 `mimo2codex --port 8889`，并同步改 Codex 的 baseUrl。

### `Reconnecting... 1/5 ... unexpected status 502 Bad Gateway`

跟上面 502 同因。Codex 客户端有 5 次重连机制，5 次都拿到 502 说明上游一直不通。**重连本身不是 Codex 网络问题，是 mimo2codex 出站问题。**

### `tunneling socket could not be established` / `socket hang up`

代理软件把 `127.0.0.1` 也代理出去了。**设置 `NO_PROXY=localhost,127.0.0.1,::1`** 后重启 mimo2codex。

### `DEPTH_ZERO_SELF_SIGNED_CERT` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `self-signed certificate`

企业网络的代理做了 TLS 中间人解密。把代理的 CA 证书导出为 `.pem` 文件，启动时指定：

```bash
# Mac
NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem mimo2codex

# Windows PowerShell
$env:NODE_EXTRA_CA_CERTS = "C:\path\to\corp-ca.pem"
mimo2codex
```

**不要**用 `NODE_TLS_REJECT_UNAUTHORIZED=0` —— 这相当于关掉了所有 TLS 校验，等于裸奔。

### `ENOTFOUND` / `getaddrinfo ENOTFOUND ...`

DNS 解析失败。三选一：

- 优先 IPv4：启动时加 `NODE_OPTIONS=--dns-result-order=ipv4first`。
- 换公共 DNS：1.1.1.1（Cloudflare）/ 223.5.5.5（阿里）/ 119.29.29.29（腾讯）。
- 把 `nslookup <上游域名>` 输出贴到 issue 里。

### `ETIMEDOUT` / `ECONNRESET`

上游或代理"半通"。常见做法：

- 换代理节点。
- 把代理切到"全局模式"或"TUN 模式"。
- 临时禁用 IPv6：mac 在网络设置里把 IPv6 改 `Link-local only`；Win 在适配器设置取消勾选 IPv6。

---

## 6. 开箱即用配置（可直接复制）

### 场景 A：大陆境内访问 MiMo / DeepSeek（**不要**走代理）

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

### 场景 B：境外服务 / OpenAI generic provider（需要代理）

```bash
# macOS，Clash 默认 7890
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
export NO_PROXY=localhost,127.0.0.1,::1
mimo2codex
```

```powershell
# Windows PowerShell，Clash for Windows 默认 7890
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:HTTP_PROXY  = "http://127.0.0.1:7890"
$env:NO_PROXY    = "localhost,127.0.0.1,::1"
mimo2codex
```

---

## 7. 控制台那条 `INFO model fallback applied` 是什么意思？

> **从 v0.2.18 起**这条日志从 `WARN` 降级到 `INFO` 并改了文案，旧版本（≤ v0.2.17）写的是 `WARN client model rewritten on the way upstream`。

样例：

```
[2026-05-20T02:07:51.792Z] INFO model fallback applied — client sent unknown model id, request continues with provider default {
  provider: 'mimo',
  from: 'gpt-5.4',
  to: 'mimo-v2.5-pro',
  reason: "unknown client model — falling back to mimo provider's defaultModel"
}
```

**这不是错误，请求本身正常完成。** 含义是：

- 你的 Codex 客户端发出的 `model` 字段（`gpt-5.4`）在 mimo2codex 任何 provider 的 builtinModels 里都查不到。
- mimo2codex 自动把它路由到默认 provider（这里是 `mimo`）的默认模型（`mimo-v2.5-pro`）继续处理。
- 上游收到的请求里 `model=mimo-v2.5-pro`，返回内容会正常送回 Codex。

**为什么要打这条日志？** 因为"悄悄改 model"会掩盖一类典型 bug：你以为在调一个支持 vision 的模型、传了图片，但实际被回落到一个不支持 vision 的默认模型，结果图片被忽略 —— 没有日志就很难查。所以保留这条提示是有意为之，只是从 v0.2.18 起降到 INFO 级，避免再让人误以为是错误。

### 7.1 `gpt-5.4` / `gpt-5.4-mini` 这种名字是从哪儿冒出来的？

**不是 Codex 的"探测包"**，是你 `~/.codex/config.toml`（或 Codex Desktop "Models" 设置里）写的 `model` 字段被原样发过来。Codex 客户端不会自己往请求里塞内部模型名，它发的就是配置文件里的字面值。

通常的发生路径：

1. 你在 Codex Desktop 选了"自定义 OpenAI 兼容服务"，把 baseUrl 填成了 `http://127.0.0.1:8788`。
2. 但 **model 字段保留了 Codex 出厂默认**。不同 Codex 版本默认值不同，最近见过 `gpt-5`、`gpt-5-codex`、`gpt-5-mini`、`gpt-5.4`、`gpt-5.4-mini` 这些字面量。
3. Codex 把这个字面量原样塞进每个请求的 `model` 字段。
4. mimo2codex 在任何 provider 的 builtinModels 里都找不到 `gpt-5.4`，于是 fallback 到默认 provider 的 defaultModel（`mimo-v2.5-pro`）。

> 一个能验证这件事的常识：OpenAI 至今没有发布过名为 `gpt-5.4` 的模型 —— 这是 Codex 自己的内部 placeholder，跟 OpenAI 真实模型版本号没关系。
>
> 旁证：仓库里 [doc/minimax.zh.md](./minimax.zh.md) 已经记录过同款行为，那时候 Codex 默认是 `gpt-5.5`。MiniMax 上游没有 fallback、直接 400，因此 generic provider 加了 `forceDefaultModel` / `GENERIC_FORCE_DEFAULT_MODEL` 开关来处理同样问题（见 [doc/generic-providers.zh.md](./generic-providers.zh.md)）。

**怎么让这条 INFO 彻底消失？** 三选一：

1. **改 Codex 的 model 字段**（推荐）。打开 [Codex 启用](./codex-enable.zh.md) 页面（admin webui → "Codex 启用"），选好你要用的 model，它会写入 `~/.codex/config.toml`；或者手动把 `model = "gpt-5.4"` 改成 `model = "mimo-v2.5-pro"`（或你常用的其他 mimo / deepseek / generic 模型 id）。
2. **接受 fallback**，啥都不动。请求照常工作，日志里多一行 INFO，无害。
3. **给 generic provider 用 `forceDefaultModel`**（仅当你接的是 env-var 单实例 generic provider、且不想/不能改 Codex 配置时）。详见 [doc/minimax.zh.md](./minimax.zh.md) 里的同款方案。

### 7.2 我在思考模式开关切换后看到 `INFO backfilled placeholder reasoning_content ...` 是怎么回事？

样例：

```
[2026-05-20T02:42:14.123Z] INFO backfilled placeholder reasoning_content onto 1 historical assistant message(s) so thinking can stay ON for this request. These turns originally ran with thinking OFF (or the client didn't echo reasoning items). Placeholder text: "(this turn ran without thinking mode)". If the upstream rejects this with a 400, please open an issue — we can fall back to silently disabling thinking.
```

**也是非错误的 INFO，请求正常完成、且思考模式保留为开。** 含义是：mimo2codex 检测到当前会话历史里存在 assistant 消息**没有 reasoning_content**，但你这次请求是想走思考模式。为了避免上游 400，mimo2codex 给那几条历史 assistant 消息**填了一段固定占位文本**（`"(this turn ran without thinking mode)"`）作为 `reasoning_content`，满足上游的"非空"校验，思考模式继续生效。

**MiMo 的约束**：MiMo（以及 DeepSeek V4 等）的思考模式**严格扫描整个对话历史**：只要有任何一条历史 assistant 消息缺 reasoning_content，上游就直接 400：

```
Param Incorrect: The reasoning_content in the thinking mode must be passed back to the API.
```

历史里出现"没 reasoning_content 的 assistant 消息"的常见路径：

1. **会话中途切了思考开关**：你前几轮把思考关了，之前几轮 assistant 没生成 reasoning_content。然后你在 admin webui 把"默认开启思考"切回开，继续同一个会话 —— 历史里前几轮的 assistant 消息就无 reasoning_content 可回传。
2. **客户端不回传 reasoning items**：某些 Codex 桌面端版本把 reasoning 当临时 UI 状态，不写进对话历史 —— 之后每次回传都缺。

**为什么用 placeholder 而不是直接关掉思考？** 因为关掉思考违背用户在 admin UI 显式打开思考开关的意图。Placeholder 方案下：

- 你这一轮请求**真的走思考**（上游会基于历史 + 当前 prompt 进行 reasoning）；
- 历史里那几条"原本无思考"的 assistant 消息带了明显占位标记 `(this turn ran without thinking mode)`，对模型可见，避免模型把它当成"上轮真的思考过 XX"。
- 完全不需要新建会话。

**什么时候要新建会话？** 如果你**主观感觉**会话被"污染"得太严重（比如你切换前后内容差异很大），可以新建会话让 mimo2codex 不再注入占位符。技术上不强制。

**Placeholder 如果被上游拒了怎么办？** 罕见情况下 MiMo / DeepSeek 可能升级校验逻辑、拒收占位文本。届时 mimo2codex 的兜底是把这次请求降级为不思考（发 `thinking:{type:"disabled"}`），并配套换 INFO 文案。看到 placeholder 后还能拿到 400，请按 [§8 给 issue 报告附带的必要信息](#8-给-issue-报告附带的必要信息) 提交一份，我们会改策略。

---

## 8. 给 issue 报告附带的必要信息

如果按上面自查仍然不通，开 issue 时请带上：

1. mimo2codex 版本（`mimo2codex --version`）。
2. 你的操作系统（mac/win + 版本号）。
3. 第 3.3 / 4.3 节 4 条自查命令的**完整输出**。
4. mimo2codex 启动日志最末 50 行（**遮掉 API key**）。
5. 客户端是 Codex CLI 还是 Codex Desktop，以及它的版本号。
6. `~/.codex/config.toml` 里的 `model` 字段值（不用贴完整文件，遮掉 baseUrl 之外的敏感字段）。

这些信息能把"代理 / 网络问题"和"mimo2codex 自身 bug"在一个回合里区分开，避免来回追问。
