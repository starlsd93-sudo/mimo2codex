# mimo2codex · 中文文档

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md"><strong>简体中文</strong></a> ·
  <a href="./doc/env-setup.zh.md">.env 配置</a> ·
  <a href="./doc/auth-deployment.zh.md">鉴权与部署</a> ·
  <a href="./doc/mimoskill.zh.md">mimoskill</a> ·
  <a href="./doc/generic-providers.zh.md">通用 Provider</a> ·
  <a href="./doc/codex-enable.zh.md">Codex 启用</a> ·
  <a href="./doc/proxy-faq.zh.md">代理 FAQ</a> ·
  <a href="./doc/connector-plugins.zh.md">Connector 插件</a> ·
  <a href="./doc/tag-log.zh.md">版本日志</a>
</p>

<p align="center">
  <a href="https://github.com/7as0nch/mimo2codex/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/7as0nch/mimo2codex?style=flat-square&logo=github"></a>
  <a href="https://www.npmjs.com/package/mimo2codex"><img alt="npm version" src="https://img.shields.io/npm/v/mimo2codex?style=flat-square&logo=npm"></a>
  <a href="https://www.npmjs.com/package/mimo2codex"><img alt="downloads" src="https://img.shields.io/npm/dt/mimo2codex?style=flat-square&color=brightgreen"></a>
  <img alt="license" src="https://img.shields.io/github/license/7as0nch/mimo2codex?style=flat-square">
  <img alt="node" src="https://img.shields.io/badge/Node-18%2B-blue?style=flat-square&logo=node.js&logoColor=white">
  <img alt="wire_api" src="https://img.shields.io/badge/wire__api-responses-black?style=flat-square">
</p>

让**最新版** OpenAI Codex CLI / Codex 桌面端接入主流大模型的本地代理。内置 **小米 MiMo V2.5** 与 **DeepSeek V4 Pro**，并提供**通用 provider 机制**——不改任何代码、不重新发包，就能把任何 **OpenAI Chat Completions 兼容**（Qwen / GLM / Kimi / 本地 vLLM / Ollama / LM Studio …）或**原生 Responses API**（OpenAI 自家）的上游接到新版 Codex。把 Codex 的 Responses API 实时翻译成上游的 Chat Completions API，按客户端发的 `model` 字段在 provider 之间自动路由。可配 admin Web 控制台。

> 🚀 **从 v0.5.0 起 · 三种部署方式任选**：
> 1. **一键命令行运行** —— `npm install -g mimo2codex` 装好即跑，老用户路径。
> 2. **Docker 云服务部署** —— 内网 / 团队场景，自带用户登录、BYOK、OAuth、Codex 客户端配置下发，不泄漏上游 key。详见 [doc/auth-deployment.zh.md](./doc/auth-deployment.zh.md)。
> 3. **Windows / macOS 桌面端**（推荐小白用户）—— 直接下载安装包，后台运行、开机自启、不用开终端、不用碰命令行，从系统托盘 / 顶栏一键开 admin 面板。下载入口：<https://mimodoc.chengj.online/download>。
>
> 📜 完整版本历史 → **[doc/tag-log.zh.md](./doc/tag-log.zh.md)**（倒序排列；修复 / 新增 / 优化 / 文档 各类分门别类）。

![Admin 控制台 · 概览](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/images/admin-dashboard.png)

![mimo2codex 安装与启动](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/images/npminstall.png)

## 目录

- [解决什么问题](#解决什么问题) —— 这玩意儿到底是干啥的
- [支持](#支持) —— 能力对照表
- [安装——任选一种](#安装任选一种) —— npm / 一键脚本 / 手动构建
- [使用](#使用) —— 拿 key、启动代理、配置 Codex
- [.env 与加载脚本](./doc/env-setup.zh.md) —— 一次填好 key，分系统快速配置（mac/Linux + Windows）
- [Docker 部署](./doc/docker.zh.md) —— docker compose 一键起、数据持久化、多架构镜像（v0.2.15 新增）
- [Codex 启用 — webui 一键切模型（v0.2.6 新增，替代 cc-switch）](#codex-启用--webui-一键切模型v026-新增替代-cc-switch)
- [配合 cc-switch 使用](#配合-cc-switch-使用)
- [Admin 控制台](#admin-控制台) —— 概览 / 日志 / 模型 / 设置
  - [Provider 与模型 ID](#provider-与模型-id)
  - [接入第三方 OpenAI 兼容上游](#接入第三方-openai-兼容上游) —— Qwen / GLM / Kimi / Ollama / OpenAI
- [CLI 参数速查](#cli-参数速查)
- [故障排查](#故障排查)
- [mimoskill——填补 MiMo 的能力缺口](#mimoskill填补-mimo-的能力缺口) —— 图像生成 / OCR 兜底 / 宠物
- [项目结构](#项目结构)
- [开发](#开发)
- [许可证](#许可证)

**详细文档：** [.env 配置](./doc/env-setup.zh.md) · [Docker 部署](./doc/docker.zh.md) · [鉴权与多用户 (v0.2.16)](./doc/auth-deployment.zh.md) · [Codex 启用](./doc/codex-enable.zh.md) · [通用 provider](./doc/generic-providers.zh.md) · [mimoskill](./doc/mimoskill.zh.md)

## 解决什么问题

小米米莫官方 [Codex 集成文档](https://platform.xiaomimimo.com/docs/zh-CN/integration/codex) 只支持 `wire_api = "chat"`，而最新版 Codex 已经把这个开关变成硬错误。官方建议是降级 Codex 到 0.80.0——但会丢掉 pet 宠物、桌面端新功能、新工具。mimo2codex 在中间挂个本地代理，**Codex 用最新版、MiMo 服务端不变**，两边都不用改。

类似 [openrouter](https://openrouter.ai)、[claude-code-router](https://github.com/musistudio/claude-code-router)、[y-router](https://github.com/luohy15/y-router)——纯协议网关。

## 支持

- ✅ Codex CLI 0.x（`wire_api = "responses"`）+ 桌面端
- ✅ 多 provider：**MiMo** + **DeepSeek**，同实例混用（按 `model` 字段路由）
- ✅ **通用 OpenAI 兼容 provider**——Qwen / GLM / Kimi / Ollama / OpenAI 原生 Responses 等，写 `providers.json` 即可接入，详见 [doc/generic-providers.zh.md](./doc/generic-providers.zh.md)
- ✅ MiMo 模型：`mimo-v2.5-pro` / `mimo-v2-flash`
- ✅ DeepSeek 模型：`deepseek-v4-pro`（默认）/ `deepseek-v4-flash` / `deepseek-chat` / `deepseek-reasoner`
- ✅ 工具调用——function tools、并行调用、`local_shell`、`custom`、MCP `namespace`
- ✅ 联网搜索——翻译成 MiMo 原生 `web_search` builtin（需在控制台激活 Web Search Plugin）；DeepSeek 路径自动跳过
- ✅ 视觉——`mimo-v2.5` / `mimo-v2-omni` 走视觉路径；pro/flash 自动剥图 + 占位文本
- ✅ 思维链透传 + 正确的**多轮 `reasoning_content` 回传**（按 [MiMo 官方公告](https://platform.xiaomimimo.com/docs/zh-CN/usage-guide/passing-back-reasoning_content)要求；`--no-reasoning` 隐藏终端显示但回传仍完整保留）
- ✅ MiMo 主机自动切换：`tp-*` key → token-plan 主机，`sk-*` key → pay-as-you-go 主机
- ✅ 本地 Admin Web UI（`http://127.0.0.1:8788/admin/`）：模型清单 / 别名管理 / 聊天日志 / Token 统计 / Provider 配置
- ✅ sqlite 持久化（默认 `~/.mimo2codex/data.db`，`--data-dir` 可改）
- ✅ cc-switch 集成（`mimo2codex print-cc-switch` 输出粘贴片段）
- ⚠️ **`/hatch` 自定义宠物生成**——纯 MiMo 做不到。Codex 的 `/hatch` 在客户端硬编码调 OpenAI 的 `image_gen` 工具，这步代理拦不住；MiMo 自己又没有图像生成 endpoint。绕路方案走 `mimoskill/`（免费，不要 OpenAI key），见下文。

## 安装——任选一种

### 🟢 npm（最常用）

```bash
npm install -g mimo2codex
```

### 🟡 一键脚本（不需要全局安装）

```bash
curl -fsSL https://raw.githubusercontent.com/7as0nch/mimo2codex/main/scripts/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/7as0nch/mimo2codex/main/scripts/install.ps1 | iex
```

### 其他方式

- **git clone 手动构建**：`git clone https://github.com/7as0nch/mimo2codex && cd mimo2codex && npm install && npm run build`，想看源码 / 改代码用这个
- **`npm link`**：clone 完之后 `npm run build && npm link`，把本地仓库注册成全局命令，不用 publish

要求 Node.js ≥ 18。

## 使用

### 1. 拿 API Key

| Provider | 控制台 | Key 前缀 |
|---|---|---|
| MiMo | [platform.xiaomimimo.com](https://platform.xiaomimimo.com) → 控制台 → API Keys | `sk-`（按量）/ `tp-`（Token 套餐） |
| DeepSeek | [api-docs.deepseek.com](https://api-docs.deepseek.com/zh-cn/) | `sk-` |

### 2. 启动代理

> 💡 **不想每次手动 export？** 用内置加载器（v0.2.8+，无需拉仓库、跨系统通用）：
>
> ```bash
> mimo2codex init                       # 在 ~/.mimo2codex/ 下生成 .env + .env.example
> # 编辑器打开 ~/.mimo2codex/.env 填入真 key
> mimo2codex                            # 每次启动自动加载，banner 上会显示加载了哪些 key 名
> ```
>
> 关键点：mimo2codex 进程自己读 `~/.mimo2codex/.env`，跟 shell 无关——桌面端、cmd.exe、scheduler、Docker 一视同仁。不想自动加载？加 `--no-load-env`。第一次裸跑 `mimo2codex` 没 .env 也没 key 时会自动 bootstrap 并提示编辑。
>
> 📖 更详细的两种方式对照（内置加载器 vs 仓库脚本 source 到 shell）、分系统说明（PowerShell 执行策略受阻兜底、Git Bash / WSL）、`.env` 语法、常见问题 → **[doc/env-setup.zh.md](./doc/env-setup.zh.md)**。

**只用 MiMo**（默认）：

```bash
export MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
mimo2codex
```

**只用 DeepSeek**：

```bash
export DS_API_KEY=sk-xxxxxxxxxxxxxxxx       # 或 DEEPSEEK_API_KEY
mimo2codex --model ds
```

**两个 provider 同时启用**（请求按 `model` 字段自动路由——发 `mimo-v2.5-pro` 走 MiMo、发 `deepseek-v4-pro` 走 DeepSeek）：

```bash
export MIMO_API_KEY=sk-mimo-key
export DS_API_KEY=sk-deepseek-key
mimo2codex                           # 默认 mimo
mimo2codex --model ds                # 默认 ds（未匹配的 model 字段走 ds）
```

启动横幅会直接打印好该贴到 `~/.codex/` 的 `auth.json` 和 `config.toml` 内容，并显示已启用的 provider、admin UI 地址、数据目录。默认走 auth.json 方式——CLI 和桌面端都能用，不依赖任何环境变量。

> **`--model` 的语义**：决定**默认 / fallback** provider，不是硬开关。当客户端发的 `model` 字段命中任一**已启用**（有 key）provider 的目录（含别名）时，**自动按该 provider 路由**，与 `--model` 无关。`--model` 只在以下情况生效：
> 1. 只配了一个 provider 的 key——必须把 `--model` 指到那个 provider，否则启动报错
> 2. 客户端发了未知的 model 字段（如 `gpt-4o`）——走 `--model` 指定 provider 的 `defaultModel`
> 3. **客户端发的 model 命中了某个 provider 的 catalog，但那个 provider 没设 key**——也走默认 provider 的 `defaultModel`，admin 日志里会记一条 `client_model_rewritten` 标记。比如你只设了 `MIMO_API_KEY` 没设 `QWEN_API_KEY`，发 `qwen3-max` 会被静默重写成 `mimo-v2.5-pro` 发给 MiMo。在 admin 的「模型映射记录」表里能看到这条 `qwen3-max → mimo-v2.5-pro` 映射

### 3. 配置 Codex

把启动横幅打的两段内容写到对应文件：

| 文件 | macOS / Linux | Windows |
|---|---|---|
| auth.json | `~/.codex/auth.json` | `%USERPROFILE%\.codex\auth.json` |
| config.toml | `~/.codex/config.toml` | `%USERPROFILE%\.codex\config.toml` |

### 4. 跑 Codex

```bash
codex
> 写一个 Python 计算斐波那契并保存到 fib.py
```

宠物、工具调用、思考过程、多轮对话都正常。`--no-reasoning` 可以不在终端显示思考。

> 桌面端如果没读到新 `auth.json`，**完全退出后重启**（托盘 → 退出，不只是关窗口）。

## Codex 启用 — webui 一键切模型（v0.2.6 新增，替代 cc-switch）

> 新增于 **2026-05-14**，起始版本 **v0.2.6**。详细文档：[doc/codex-enable.zh.md](./doc/codex-enable.zh.md)

如果你只用 Codex（不用 Claude Code / Gemini CLI 等），可以**不再依赖 cc-switch**。admin webui 侧栏多了一个「**Codex 启用**」页签，直接做掉 cc-switch 替你做的事，并补全它没做的：

- **一键写文件**：点任一行模型的「写入文件并启用」→ 服务端原子写入 `~/.codex/auth.json` + `~/.codex/config.toml`，完全退出重启 Codex 即生效。
- **运行时覆盖**：点「仅运行时覆盖」→ 把激活的 (provider, model) 存到内部 settings，`selectProvider` 路由前优先用它，**无需重启 Codex**。
- **原始 Codex 配置永不丢** 🔒：首次覆盖你真 OpenAI 登录的那份 auth.json 时，备份自动打 `.preserve` 标记，**永远不会被后续切换轮转清理**。切 100 次模型，那份原始配置仍在备份表里，一键恢复。
- **每次切换都备份**：普通快照按"最近 10 份"轮转，可以回到任意一份历史配置；备份表里直接显示每份当时的 `provider/model`，肉眼区分。
- **半残 pair 对称恢复**：如果你原本只有 `auth.json` 没有 `config.toml`（很多人不自定义），恢复时会顺手删掉我们建的 `config.toml`，让 `~/.codex/` 真正回到 apply 前状态。
- **手动删除**：每行有「删除」按钮，🔒 保留型需要二次确认+ `?force=1` 才能放行。

更详细的机制对比、API、边界行为、故障排查 → [doc/codex-enable.zh.md](./doc/codex-enable.zh.md)。

## 配合 cc-switch 使用

如果你**同时用 Claude Code / Gemini CLI 等其他 CLI 工具**，仍然推荐用 cc-switch 做统一切换中心；mimo2codex 也兼容（两个工具都写同一个 `~/.codex/`，互不打架）。

[cc-switch](https://github.com/farion1231/cc-switch) 是个跨平台桌面 App，专门管理 Claude Code / Codex / OpenCode / OpenClaw / Gemini CLI 的多供应商切换。它的 Codex 预设里没 MiMo（因为 MiMo 不支持 Responses API），mimo2codex 当桥用「自定义供应商」加进去：

1. 让 mimo2codex 一直跑（`MIMO_API_KEY=... mimo2codex`）
2. `mimo2codex print-cc-switch` 输出 `auth.json` + `config.toml` 两段文本
3. cc-switch GUI → **Codex** Tab → **+** → **自定义** → 把两段贴对应文本框 → 名称写 `MiMo (via mimo2codex)` → 添加
4. 点击新供应商激活——cc-switch 自动写 Codex 的配置文件。后续切回 OpenAI 官方 / Azure / OpenRouter 都是一键，mimo2codex 进程不需要重启，只在被路由到时收到流量。

cc-switch 的「获取模型」按钮调 `/v1/models`，mimo2codex 已实现——下拉里能直接选 `mimo-v2.5-pro` / `mimo-v2-flash`。

## Admin 控制台

启动后浏览器访问 `http://127.0.0.1:8788/admin/`。

**概览**——24h / 7d / 30d Token 用量、错误率、按 provider/模型聚合的请求统计、模型映射记录、最近 10 条请求。

![Admin 控制台 · 概览](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/images/admin-dashboard.png)

**日志**——按 provider 过滤、按时间分页、按时间清理旧记录；状态码异常着色、错误片段就地展开。

![Admin 控制台 · 聊天日志](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/images/admin-logs.png)

**模型**——按 provider tab 切换；内置模型只读，可新增自定义模型 + 别名（客户端发的 model 字段 → 上游 ID 的映射）。

**设置**——provider 状态、base URL、默认模型、UI 偏好。**API key 不在 UI 里存储**——必须走环境变量，UI 只展示状态 + 操作指引。

数据存 sqlite（`~/.mimo2codex/data.db`），可 `--data-dir <path>` 改路径，或 `--no-admin` 关闭。

### Provider 与模型 ID

| Provider | 短码 | Env 变量 | 默认 baseUrl | 默认模型 | 模型清单 |
|---|---|---|---|---|---|
| MiMo | `mimo` | `MIMO_API_KEY` | `https://api.xiaomimimo.com/v1` | `mimo-v2.5-pro` | `mimo-v2.5-pro` / `mimo-v2-flash` |
| DeepSeek | `ds` | `DS_API_KEY` 或 `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` | `deepseek-v4-pro` | `deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-chat`* / `deepseek-reasoner`* |

*legacy，2026-07-24 弃用，对应 v4-flash 的非思考 / 思考双模。

> MiMo 的 `tp-*` key 自动用 token-plan 主机（`https://token-plan-cn.xiaomimimo.com/v1`），`sk-*` key 自动用 pay-as-you-go 主机。如果你显式设了 `MIMO_BASE_URL` / `--base-url`，那就以你的为准；启动横幅在 key 前缀和主机不匹配时会打 ⚠ 警告。

### 接入第三方 OpenAI 兼容上游

除了内置的 MiMo / DeepSeek，**任何 OpenAI Chat Completions 兼容**（Qwen / GLM / Kimi / Ollama / vLLM …）或**原生 Responses API**（OpenAI 自家、未来其他）的上游都能在不改代码的前提下接到 Codex。

**最简方式**——一个 env 三件套：

```bash
export GENERIC_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export GENERIC_API_KEY=sk-your-qwen-key
export GENERIC_DEFAULT_MODEL=qwen3-max
mimo2codex --model generic
```

**多实例方式**——写 `~/.mimo2codex/providers.json`：

```json
{
  "providers": [
    {
      "id": "qwen",
      "displayName": "Qwen (DashScope)",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "envKey": "QWEN_API_KEY",
      "defaultModel": "qwen3-max"
    }
  ]
}
```

然后 `QWEN_API_KEY=sk-... mimo2codex --model qwen`。

完整字段说明、`wireApi: "responses"` 直透模式、Qwen / GLM / Kimi / Ollama / OpenAI / MiniMax 六种主流上游的可粘贴示例、路由规则、故障排查，全部在 **[doc/generic-providers.zh.md](./doc/generic-providers.zh.md)**。

> 严格 OpenAI 兼容的上游（如 **MiniMax**）需要 `features.minimaxCompat: true` 一键开关——详见 [doc/minimax.zh.md](./doc/minimax.zh.md)。

> **商汤日日新 (SenseNova)** 走 admin UI 新增 generic provider 时输入 `https://token.sensenova.cn/v1` 会被自动识别并套用推荐 features——详见 [doc/sensenova.zh.md](./doc/sensenova.zh.md)。

> **Kimi (Moonshot)** 输入 `https://api.moonshot.cn/v1` 会被自动识别为 Kimi（默认套 `dropReasoningEffort` 避免与"强制高强度思考"开关冲突）——详见 [doc/kimi.zh.md](./doc/kimi.zh.md)。

> 既有 mimo / deepseek 用户不写 `providers.json` 时**完全不受影响**——默认仍是 mimo，所有行为字节级一致。

## CLI 参数速查

| 参数 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `--model <shortcut>` | `MIMO2CODEX_DEFAULT_PROVIDER` | `mimo` | 默认 provider：`mimo` 或 `ds` |
| `--port`, `-p` | `MIMO2CODEX_PORT` | `8788` | 监听端口 |
| `--host` | `MIMO2CODEX_HOST` | `127.0.0.1` | 绑定地址 |
| `--base-url` | `MIMO_BASE_URL` / `DEEPSEEK_BASE_URL` | 见上表 | 当前默认 provider 的 base URL |
| `--api-key` | `MIMO_API_KEY` / `DS_API_KEY` / `DEEPSEEK_API_KEY` | _至少一个必填_ | 当前默认 provider 的 key（其他 provider 走对应 env 变量） |
| `--data-dir <path>` | `MIMO2CODEX_DATA_DIR` | `~/.mimo2codex` | sqlite + admin UI 数据目录 |
| `--no-admin` | `MIMO2CODEX_NO_ADMIN=1` | 关 | 关闭 admin UI 与 sqlite 日志 |
| `--no-reasoning` | `MIMO2CODEX_NO_REASONING=1` | 关 | 终端不显示思考（多轮工具调用仍回填给上游） |
| `--verbose`, `-v` | `MIMO2CODEX_VERBOSE=1` | 关 | 打印每次翻译的请求体 |
| _仅环境变量_ | `MIMO2CODEX_CONTEXT_OVERFLOW_MODE` | `friendly` | 上游 400 且识别为上下文超限时的处理：`friendly`（默认）重写为中英文友好提示并引导 `/compact`；`passthrough` 透传原始错误 |

子命令：

```bash
mimo2codex print-config             # 默认 auth.json + config.toml 两段
mimo2codex print-config --env-key   # 老的环境变量方式（仅 CLI 适用）
mimo2codex print-cc-switch          # cc-switch 自定义供应商片段
```

## 故障排查

<details>
<summary><b>MiMo 报 400 <code>The reasoning_content in the thinking mode must be passed back</code> / 多轮调工具时模型开始胡编 / 输出跟任务无关的"小说"</b></summary>

按 [MiMo 官方公告](https://platform.xiaomimimo.com/docs/zh-CN/usage-guide/passing-back-reasoning_content)：思考模式打开（默认）且历史里有工具调用时，**每一条带 `tool_calls` 的 assistant message 必须同时带原 `reasoning_content`**，否则模型上下文断裂。两种失败模式：

| 严重程度 | 现象 |
|---|---|
| 🔴 **硬失败** | MiMo 直接 400 `"The reasoning_content in the thinking mode must be passed back"`。Codex 显示 "Provider returned 400"，对话卡死。 |
| 🟡 **软退化** | 不报错但模型"自言自语"不调工具、编造跟提示无关的内容（如让生成宠物 sprite，模型输出影视娱乐冷知识）、说"我马上去做 X"然后回合结束。每跑飞一次烧 1k-5k token。 |

**触发场景集中在多轮调工具的工作流**：agentic 编码、`/hatch` 替代品宠物生成、OCR 回灌、联网搜索链。Codex 出现在 MiMo 公告的受影响列表里（同列还有 Cursor、TRAE、Roo Code、Copilot CLI 等）。

**修复**：升级到 `mimo2codex >= 0.2.3`。老版本只把 reasoning 塞 `summary[].text`，`--no-reasoning` 模式甚至完全丢弃；0.2.3+ 把完整 trace 同时存进 `encrypted_content`（Codex 视为 opaque blob 原样回传），翻译时再注入回前一条 assistant message 的 `reasoning_content`。

```bash
npm update -g mimo2codex   # 或：git pull && npm run build
mimo2codex --version       # 确认 >= 0.2.3
```

受影响模型：MiMo-V2.5-Pro、MiMo-V2.5、MiMo-V2-Pro、MiMo-V2-Omni、MiMo-V2-Flash。DeepSeek V4 系列有同样的要求，项目里早就处理了。

</details>

<details>
<summary><b>报 <code>Missing environment variable: MIMO2CODEX_KEY</code></b></summary>

你 `config.toml` 还在用老的 `env_key = "MIMO2CODEX_KEY"`，桌面端不读 shell 环境变量。换成 auth.json 方式：把 `env_key = "..."` 改成 `requires_openai_auth = true`，再写 `~/.codex/auth.json` 为 `{"OPENAI_API_KEY": "mimo2codex-local"}`。或者直接 `mimo2codex print-config` 重新拿默认输出粘贴。

</details>

<details>
<summary><b>报 <code>404: No endpoints found that support image input</code></b></summary>

模型不支持图。MiMo 系列里只有 `mimo-v2.5` 和 `mimo-v2-omni` 接受图片。把 `config.toml` 的 model 换成这两个之一，或交给 mimo2codex 自动剥图（`mimo-v2.5-pro` / `-flash` 上自动加占位文本）。

</details>

<details>
<summary><b>报 <code>400: Param Incorrect: text is not set</code></b></summary>

MiMo 的图像 API 要求每条带图消息必须同时有 `text` part。mimo2codex 自动补一个空格——确保你是最新版（`npm update -g mimo2codex` 或 `git pull && npm run build`）。

</details>

<details>
<summary><b>生成宠物时 Codex 报 <code>image_gen tool not available</code></b></summary>

是 Codex 的 `/hatch` 想调 OpenAI 图像 API——MiMo 没有图像生成能力。改用仓库自带的 [`mimoskill/scripts/generate_pet.py`](./mimoskill/scripts/generate_pet.py)，默认走免费的 Pollinations.ai，**不需要任何 OpenAI key**。完整流程见 [mimoskill/SKILL.md](./mimoskill/SKILL.md)。

</details>

<details>
<summary><b>报 <code>stream disconnected before completion</code></b></summary>

老版本 bug——确保 ≥ 0.1.0。SSE 事件 data 里必须带 `type` 字段，老构建漏了。

</details>

<details>
<summary><b>日志被 <code>dropping unsupported tool type</code> 刷屏</b></summary>

已修——已知服务端工具（`code_interpreter`、`image_generation`、`computer_use` 等）默默丢弃；未知类型每个会话只 WARN 一次，不再每次请求都刷。

</details>

<details>
<summary><b>报 <code>400: web search tool found in the request body, but webSearchEnabled is false</b></summary>

是老版本。新版 mimo2codex 会自动捕获这个 400、剥掉 web_search 重试，并在本次进程里记住"插件未激活"，后续请求自动跳过 web_search——**不会再报错**。升到最新即可：`npm update -g mimo2codex`（或 `git pull && npm run build`）。

如果你**确实**想让联网搜索工作，去 [MiMo 控制台 → 插件管理](https://platform.xiaomimimo.com/#/console/plugin) 激活 Web Search Plugin（独立计费），然后重启 mimo2codex 即可。

</details>

<details>
<summary><b>启动横幅打 ⚠ 警告 "sk-* key 通常需要 pay-as-you-go 主机..." / "tp-* key 通常需要 token-plan 主机..."</b></summary>

`MIMO_BASE_URL` 残留在 shell 环境里覆盖了基于 key 前缀的自动推断。优先级是 `--base-url > MIMO_BASE_URL > 键前缀推断 > 默认`，env 比推断高。

PowerShell：

```powershell
echo $env:MIMO_BASE_URL                                          # 看一下
Remove-Item Env:MIMO_BASE_URL                                    # 当前会话清掉
[Environment]::GetEnvironmentVariable('MIMO_BASE_URL','User')    # 看用户级
[Environment]::SetEnvironmentVariable('MIMO_BASE_URL',$null,'User')  # 永久清掉用户级
```

bash / zsh：

```bash
echo $MIMO_BASE_URL
unset MIMO_BASE_URL
```

清掉后 `sk-*` 自动走 `https://api.xiaomimimo.com/v1`，`tp-*` 自动走 `https://token-plan-cn.xiaomimimo.com/v1`。

</details>

<details>
<summary><b>DeepSeek 报 401 Unauthorized</b></summary>

确认走了 `DS_API_KEY` 或 `DEEPSEEK_API_KEY`，并且 key 没贴错（DeepSeek 的 key 只在它自家控制台拿，不和 MiMo 互通）。

```bash
mimo2codex --model ds --verbose
# 启动横幅会显示 api key: sk-x…xxxx，确认是 DS 那把
```

</details>

<details>
<summary><b>Admin UI 打开是 503 "Admin UI not built"</b></summary>

前端没构建过。`npm run build:all`（先 tsc 后端，再 vite 前端）一次性产出 `dist/cli.js` + `dist/web/`。或者只跑前端构建：`npm run web:install && npm run web:build`。

</details>

<details>
<summary><b>better-sqlite3 在 npm install 时编译失败</b></summary>

通常是用了非主流 Node 版本（或 Electron 内置 Node）。要求 Node ≥ 18，绝大多数系统自动下载 prebuilt 二进制，不需要本地编译器。如果只想用代理本身不要 admin UI，加 `--no-admin`，db 模块就不会被加载。

</details>

<details>
<summary><b>Codex 说"我现在做 X"然后回合就结束了，没真调工具</b></summary>

**最常见的根因**：prior assistant 轮次 `reasoning_content` 丢失 —— 参考本节最顶上的 troubleshooting 条目（升级到 ≥ 0.2.3）。0.2.2 及以前在某些配置下会静默丢弃跨轮 reasoning，导致 MiMo 多轮工具调用恰好以这种症状退化。

如果你已经在 ≥ 0.2.3 还碰到这个，那就是 MiMo 多步 agentic 编码本身的弱点——模型把 token 花在"叙述"上不真调工具。mimo2codex 默认强制 `parallel_tool_calls: true`（一回合多个工具调用），通常能缓解。最有效的手动救场是**改提示词**——用命令式替代"继续"：

> 不要解释，直接调 apply_patch 写完整文件内容

这种格式（具体指令 + 显式工具名 + "不要解释"）对 MiMo 的稳定性比"继续"高得多。

</details>

## mimoskill——填补 MiMo 的能力缺口

> 📖 **完整文档：** [doc/mimoskill.zh.md](./doc/mimoskill.zh.md) —— 单脚本详解、环境变量、触发规则、三种用法、常用组合、故障排查。本节是速览。

[mimoskill/](./mimoskill/) 是仓库根目录下一捆**辅助脚本 + 参考文档**。它存在的原因是有些事 MiMo 原生不支持（主要是图像生成、纯文本模型场景下的 OCR 兜底），而 Codex 在客户端硬编码了一些能力假设，代理层压根改不动。

### 为啥要这玩意

| 问题 | mimo2codex 自己为啥搞不定 |
|---|---|
| `/hatch` 自定义宠物生成 | Codex 在**客户端**直接调 OpenAI 的 `image_gen` 工具——MiMo 没图像生成 endpoint，代理也没法假装有，因为 Codex 根本不把这个请求送到代理来。 |
| Codex 内的图片生成 | 同上，代理拦不住客户端硬编码。 |
| 在 Codex 之外直接调 MiMo | mimo2codex 是代理不是 SDK——一次性调用走脚本比启代理简单得多。 |
| MiMo 的各种坑（图必须配 text、`max_completion_tokens`、`reasoning_content` 多轮回填等） | 每写一次脚本都要重学这些坑很烦，脚本里已经全踩好了。 |

### 里面有啥

| 文件 | 作用 |
|---|---|
| `SKILL.md` | Skill 清单——给 Claude / Codex agent 读的，描述什么时候该调哪个脚本 |
| `scripts/mimo_chat.py` | 直接调 MiMo 的聊天 / 视觉 / 联网搜索，**纯标准库**（不用 `pip install openai`） |
| `scripts/generate_pet.py` | 图片生成：`auto` 模式没 OpenAI key 时走免费 Pollinations，有就走 `gpt-image-1`；也支持 Replicate / 本地 SD |
| `scripts/install_pet.sh` | 把生成的 PNG 装到 Codex 宠物目录（自动探测 macOS / Linux / Windows 路径） |
| `references/models.md` | MiMo 模型能力矩阵 + 字段坑 |
| `references/pet_workflow.md` | 宠物生成完整流程（单图 vs 多状态 bundle） |
| `assets/pet_prompt_template.md` | 调好的 chibi 贴纸风格提示词模板 |

### 三种用法

**1. 直接调用（普通用户，零配置）**

```bash
python3 mimoskill/scripts/mimo_chat.py "讲个笑话"
python3 mimoskill/scripts/mimo_chat.py --image src.jpg "描述这张图"
python3 mimoskill/scripts/generate_pet.py --description "chibi shiba 程序员" --out pet.png
bash mimoskill/scripts/install_pet.sh pet.png shiba
```

**2. 当 Claude Code 的 Skill 用**——把目录软链到 `~/.claude/skills/`：

```bash
ln -s "$(pwd)/mimoskill" ~/.claude/skills/mimoskill
```

之后 Claude 会自动读 `SKILL.md`，遇到相关任务（"帮我从这张图生成宠物"）会自己路由到对应脚本。

**3. 当 Codex agent 指南**——已经通过仓库根的 [AGENTS.md](./AGENTS.md) 接好了。Codex 每次启会话自动读 AGENTS.md，遇到生图 / 宠物相关任务会路由到 mimoskill 脚本，**不会再去 `pip install openai`**。

### 用 mimoskill 替代 `/hatch` 生成宠物

```bash
# 生成（免费——没 OpenAI key 时默认用 Pollinations.ai）
python3 mimoskill/scripts/generate_pet.py --description "chibi shiba 程序员" --out pet.png

# 安装
bash mimoskill/scripts/install_pet.sh pet.png shiba

# 完全退出 + 重启 Codex，宠物菜单里挑新的
```

想要更高质量，设 `PET_OPENAI_API_KEY=sk-真OpenAI-key`（跟 `MIMO_API_KEY` 完全独立——只用于这一次图片生成调用），`auto` 模式会自动切到 `gpt-image-1`。多状态动画 bundle 用 `--bundle DIR/`。完整流程：[mimoskill/SKILL.md](./mimoskill/SKILL.md)。

## 项目结构

![项目结构](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/tutorial-video/assets/04-agent-docs.jpg)

```
src/
  cli.ts, server.ts, config.ts        # 入口 + 路由 + 多 provider 配置
  providers/{types,mimo,deepseek,generic,genericLoader,registry}.ts   # Provider 抽象 + 内置 + 通用工厂
  setup/snippets.ts                   # print-config 与 admin /setup-snippets 共享的 snippet 生成器
  upstream/openaiCompatClient.ts      # chat + responses 直透两套上游客户端
  translate/                          # Responses API ↔ Chat Completions API 翻译
  admin/router.ts                     # /admin/api/* REST + /admin/* SPA 静态托管
  db/{index,logs,settings,models}.ts  # better-sqlite3 持久化层 + migrations + seed
test/                # 136 个 vitest 用例
web/                 # Vite + React 18 控制台（构建产物 dist/web/）
mimoskill/           # MiMo 辅助工具 + 宠物生成绕路方案
doc/                 # 扩展文档（通用 provider 等），README 里引用
scripts/install.{sh,ps1}  # 一键安装脚本
dist/                # tsc + vite 编译产物
AGENTS.md            # Codex agent 说明（不要装 openai，用 mimoskill）
PUBLISHING.md        # 维护者发布手册
```

## 开发

```bash
git clone https://github.com/7as0nch/mimo2codex && cd mimo2codex
npm install
npm run web:install  # 安装前端依赖（仅首次）
npm run dev          # tsx 跑后端，不用构建（默认 admin UI 仍生效但需要先 web:build 一次）
npm run web:dev      # 另开窗口跑 vite dev（5173，自动 proxy /admin/api → 8788）
npm test             # 100 个 vitest
npm run build        # 仅后端 → dist/cli.js
npm run web:build    # 仅前端 → dist/web/
npm run build:all    # 一把全打
```

把本地代码注册成全局 `mimo2codex` 命令：`npm run build:all && npm link`。

## 更新日志

### 0.2.5-beta.0（beta 通道）

本轮按 MiMo / DeepSeek **官方文档**做了一次系统对齐，外加一个被社区报告的 DeepSeek 工具调用 400 修复。没有破坏性变更。安装：`npm i -g mimo2codex@beta`。

- **修复 DeepSeek 多轮工具调用 400**：`"An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)"`。根因是翻译时 `reasoning` 项被无条件 flush，会在 `assistant(tool_calls)` 和对应的 `tool` 消息之间塞一条 `assistant(reasoning_content)`，破坏 Chat Completions 协议的"tool_calls 必须紧跟 tool 消息"约束。现在 reasoning 会被折叠到同一条 assistant 消息里。同时加了一道防御：若上游历史里某个 `tool_call_id` 找不到对应的 `function_call_output`（取消的轮次、丢失的输出等），自动补一条占位 tool 消息，保证发出的 body 始终结构合法。
- **DeepSeek 思考模式恢复**：之前 `thinking` 字段在 deepseek provider 里被静默删掉，等于没人能开思考模式；现在按官方文档默认注入 `thinking: {type: "enabled"}` + `reasoning_effort: "high"`。客户端如显式传了值则尊重不覆盖。
- **DeepSeek 思考模式下剥除无效参数**：`temperature` / `top_p` / `presence_penalty` / `frequency_penalty` 在思考模式下被上游忽略，提前剥掉以免误导。
- **MiMo `mimo-v2-pro` 补入 catalog**（v2-pro，不带 `.5`），官方 OpenAI API 文档列在 model 允许值里但之前没收录。
- **MiMo `thinking` 默认值按模型区分**：`mimo-v2-flash` 上游默认 disabled（不再无脑注入），`mimo-v2.5-pro` / `mimo-v2.5` / `mimo-v2-pro` / `mimo-v2-omni` 缺省注入 `enabled`。
- **MiMo `mimo-v2.5-pro` / `mimo-v2.5` 思考模式下剥除 `temperature`**（官方说会被强制 1.0）。
- **MiMo `tool_choice` 非 `auto` 值剥除**（官方说后端会移除）。
- **MiMo catalog 补 `maxOutputTokens`**：pro / v2-pro = 131072，v2.5 / omni = 32768，flash = 65536。print-config 现在能输出 `model_max_output_tokens`。
- DeepSeek `defaultBaseUrl` **保留为 `https://api.deepseek.com/v1` 不动**（官方示例不带 /v1，但带也能用，避免回归风险）。

测试通过后会发布 `0.2.5` 正式版（`npm dist-tag` 切换到 latest）。

## 许可证

MIT，见 [LICENSE](./LICENSE)。
