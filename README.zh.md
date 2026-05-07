# mimo2codex · 中文文档

> [English](./README.md) · 中文

让**最新版** OpenAI Codex CLI / Codex 桌面端无缝接入**小米 MiMo V2.5 Pro** 的本地代理。它把 Codex 的 Responses API 实时翻译成 MiMo 的 Chat Completions API，纯本地无状态转换。

可独立使用，也可作为自定义供应商配置进 [cc-switch](https://github.com/farion1231/cc-switch)，与 OpenAI 官方、Azure、AiHubMix 等其他 Codex 供应商**一键切换**。

---

## 这个工具解决什么问题

小米米莫官方的 [Codex 集成文档](https://platform.xiaomimimo.com/docs/zh-CN/integration/codex) 明确写着：

> "MiMo Models are not yet compatible with the Responses API and are only supported by older versions of Codex that use the ChatCompletions API."
>
> "Newer versions of Codex no longer support `wire_api = "chat"`. If you encounter the error `wire_api = chat is no longer supported`, please downgrade the Codex version."

也就是说：

- MiMo 服务端**只暴露 Chat Completions 协议**
- OpenAI 已弃用 Codex 的 `wire_api = "chat"`（2026 年 2 月起为硬错误）
- 官方建议的解决方案是**降级 Codex 到 0.80.0**——但这样就丢掉了 pet 宠物、桌面端新功能、新工具支持等改进
- cc-switch 的 Codex 预设里也没有 MiMo（只有 OpenAI 官方、Azure、AiHubMix、DMXAPI、PackyCode、OpenRouter 等）——同样因为 MiMo 不支持 Responses API

**mimo2codex 把这两边都救活了**：本地起个 HTTP 服务，对外伪装成 OpenAI Responses API 后端，对内翻译成 MiMo Chat Completions。Codex 用最新版、MiMo 服务端不变、cc-switch 把它当一个普通自定义供应商管理。

工作原理类似 [openrouter](https://openrouter.ai)、[claude-code-router](https://github.com/musistudio/claude-code-router)、[y-router](https://github.com/luohy15/y-router)——纯协议网关，不缓存、不调度、不存储。

## 支持的能力

- ✅ Codex CLI 0.x 最新版（`wire_api = "responses"`）
- ✅ Codex 桌面端（macOS / Windows）
- ✅ **Pet 宠物**（状态由 SSE 事件生命周期驱动，无需特殊处理）
- ✅ **工具调用**——function tools，含并行调用
- ✅ 多轮对话 + 混合工具调用 + reasoning
- ✅ 流式 SSE，完整 Responses 事件序列（`response.created` / `output_item.added` / `output_text.delta` / `function_call_arguments.delta` / `reasoning_summary_text.delta` / `completed` 等）
- ✅ **思维链透传**——MiMo 的 `reasoning_content` 在 Codex 终端显示为思考摘要，多轮工具调用时按 MiMo 官方推荐回填给上游
- ✅ **1M 长上下文**——把 model 写成 `mimo-v2.5-pro[1m]` 即可
- ✅ **可配进 cc-switch**——与 OpenAI 官方等其他供应商一键切换

## 工作原理

```
┌──────────────┐  POST /v1/responses     ┌──────────────┐  POST /v1/chat/completions  ┌──────────────┐
│ Codex CLI /  │  (wire_api="responses") │  mimo2codex  │  (chat completions, SSE)    │  Xiaomimimo  │
│ Codex 桌面端 │ ──────────────────────► │  127.0.0.1   │ ──────────────────────────► │  MiMo V2.5   │
└──────────────┘ ◄────────────────────── │   :8788      │ ◄────────────────────────── └──────────────┘
                  Responses SSE 事件流   └──────────────┘   Chat Completions SSE
```

每个请求的处理：

1. Codex POST 一个 Responses 请求体（`input` 是 message / function_call / function_call_output / reasoning items 数组）
2. mimo2codex 把 `input` 翻译成 Chat `messages`，并把连续的 `reasoning` + `function_call` 折叠成一条带 `reasoning_content` + `tool_calls` 的 assistant 消息（这是 MiMo 推荐的多轮高质量做法）
3. mimo2codex 用你的 `MIMO_API_KEY` 调 MiMo 的 `/v1/chat/completions`
4. 流式读 Chat SSE 块，状态机改写成 Responses SSE 事件流回 Codex

整个代理**完全无状态**——不存 `previous_response_id`、不缓存、不校验入站 key。想跑几个实例都行。

---

## 安装与启动（本地源码运行）

> 本节假设你**没有**通过 `npm install -g` 安装包，而是 git clone 仓库后在本地直接运行。这是当前推荐的方式。

### 0. 先决条件

| 软件 | 版本要求 | 检查命令 |
|---|---|---|
| Node.js | **≥ 18.0** | `node -v` |
| npm | 与 Node 同包 | `npm -v` |
| git | 任意版本 | `git --version` |

如果 `node -v` 报错或版本不到 18，去 [nodejs.org](https://nodejs.org) 装一个 LTS。Windows 用户也可以用 [nvs](https://github.com/jasongin/nvs) / [nvm-windows](https://github.com/coreybutler/nvm-windows) 管理多版本。

### 1. 克隆仓库 & 装依赖

```bash
git clone https://github.com/your-org/mimo2codex.git
cd mimo2codex
npm install
```

`npm install` 会装大约 87 个包（typescript、vitest、tsx、nanoid、eventsource-parser），耗时 30 秒到 1 分钟。

### 2. 选一种启动方式

下面三种任选其一。**A** 是最快上手的；**B** 启动最快、运行时占用最低；**C** 让 `mimo2codex` 像全局命令一样使用。

#### 方式 A：开发模式（推荐首次试用）

直接用 `tsx` 跑 TypeScript 源码，**不需要构建**：

```bash
# Linux / macOS / Git Bash
export MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
npm run dev

# Windows PowerShell
$env:MIMO_API_KEY="sk-xxxxxxxxxxxxxxxx"
npm run dev

# Windows CMD
set MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
npm run dev
```

要带额外参数（例如改端口）：

```bash
npm run dev -- --port 9000
npm run dev -- --base-url https://token-plan-cn.xiaomimimo.com/v1
npm run dev -- print-cc-switch
```

> ⚠️ 注意 `--` 分隔符：`--` 前面是给 npm 的参数，后面才是给 mimo2codex 的。

#### 方式 B：构建后跑（推荐长期使用）

把 TypeScript 编译成 JavaScript，再用纯 Node 跑——启动快（< 100ms）、内存占用低、没有 tsx 的额外开销：

```bash
# 一次性构建
npm run build

# 启动（任选其一）
npm start
node dist/cli.js
```

带参数：

```bash
npm start -- --port 9000
node dist/cli.js --port 9000
node dist/cli.js print-cc-switch
```

构建产物在 `dist/`（已在 `.gitignore` 里，不会污染仓库）。改了源码记得重新 `npm run build`。

#### 方式 C：把 `mimo2codex` 注册为全局命令（不需要 publish）

在仓库根目录跑一次：

```bash
npm run build      # 先确保 dist/ 已生成
npm link           # 把当前目录注册为全局 mimo2codex
```

之后在**任何目录**都能直接用：

```bash
mimo2codex --version
mimo2codex print-cc-switch
MIMO_API_KEY=sk-xxx mimo2codex
```

要解除链接：在仓库根目录跑 `npm unlink`，或全局 `npm rm -g mimo2codex`。

> 💡 后文所有的 `mimo2codex ...` 命令示例，对应到方式 A 是 `npm run dev -- ...`、方式 B 是 `node dist/cli.js ...`、方式 C 是 `mimo2codex ...` 直接用。

### 3. 跑测试（可选）

确认你这台机器上一切正常：

```bash
npm test
```

预期 25 个用例全过：

```
 ✓ test/respToResponses.test.ts (6 tests)
 ✓ test/reqToChat.test.ts (11 tests)
 ✓ test/streamToSse.test.ts (8 tests)

 Test Files  3 passed (3)
      Tests  25 passed (25)
```

### 4. 让代理常驻后台

mimo2codex 是个长时运行的服务，开发时直接前台跑就行；如果想常驻：

#### macOS / Linux：systemd 用户单元（推荐）

新建 `~/.config/systemd/user/mimo2codex.service`：

```ini
[Unit]
Description=mimo2codex — Codex Responses → Xiaomi MiMo proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/绝对路径/到/mimo2codex
Environment="MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx"
ExecStart=/usr/bin/node dist/cli.js
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now mimo2codex
systemctl --user status mimo2codex     # 看状态
journalctl --user -u mimo2codex -f      # 看日志
```

#### 跨平台：[pm2](https://pm2.keymetrics.io)

```bash
npm install -g pm2
cd mimo2codex
npm run build
MIMO_API_KEY=sk-xxx pm2 start dist/cli.js --name mimo2codex
pm2 save
pm2 startup    # 跟着提示开机自启
```

#### Windows：[node-windows](https://github.com/coreybutler/node-windows) 或任务计划程序

最省事的方法是**任务计划程序**：

1. 控制面板 → 任务计划程序 → 创建基本任务
2. 触发器：登录时
3. 操作：启动程序
   - 程序：`C:\Program Files\nodejs\node.exe`
   - 参数：`D:\workspace\goproject\my\mimo2codex\dist\cli.js`
   - 起始位置：`D:\workspace\goproject\my\mimo2codex`
4. 完成后右键任务 → 属性 → 设置「使用最高权限运行」可选；在「条件」/「设置」里关掉空闲限制
5. 在「环境变量」里把 `MIMO_API_KEY` 设上（或在系统属性 → 环境变量里全局设）

### 5. 升级到新版本

```bash
cd mimo2codex
git pull
npm install            # 拉了新依赖才需要
npm run build          # 方式 B/C 必跑；方式 A 不用
# 重启你的常驻进程（systemctl restart / pm2 restart 等）
```

---

## 准备：拿一个 MiMo API Key

去 [platform.xiaomimimo.com](https://platform.xiaomimimo.com) 注册（用小米账号），在「控制台 → API Keys」里创建一个 Key。

- **按量付费**：`sk-xxx` 开头，BASE_URL 用 `https://api.xiaomimimo.com/v1`
- **Token 套餐**：`tp-xxx` 开头，BASE_URL 用订阅页面给出的专属 URL（一般是 `https://token-plan-cn.xiaomimimo.com/v1`）

---

## 使用方式

下面三种用法任选其一。**A** 是最简单的；**B** 适合已经在用 cc-switch 管理多家供应商的；**C** 是把 mimo2codex 与其他 Codex 供应商混合使用、随时切换。

### A. 独立使用（手动配 Codex）

#### 1. 启动代理

```bash
export MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
mimo2codex
```

启动后会打印需要的配置片段：

```
mimo2codex v0.1.0 listening on http://127.0.0.1:8788
upstream:    https://api.xiaomimimo.com/v1
api key:     sk-x…xxxx
reasoning:   passthrough

# ~/.codex/config.toml — 把下面这段加进去（或与已有配置合并）
model = "mimo-v2.5-pro"
model_provider = "mimo"

[model_providers.mimo]
name = "MiMo (via mimo2codex)"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
env_key = "MIMO2CODEX_KEY"
request_max_retries = 1
```

#### 2. 写 Codex 配置

把上面那段 TOML 拷贝到：

- macOS / Linux：`~/.codex/config.toml`
- Windows：`%USERPROFILE%\.codex\config.toml`

然后随便 export 一个非空字符串作为 `MIMO2CODEX_KEY`（代理本身不校验，真正的 MiMo Key 在 mimo2codex 进程里）：

```bash
# macOS / Linux
export MIMO2CODEX_KEY=anything

# Windows CMD
setx MIMO2CODEX_KEY anything
```

#### 3. 用 Codex

```bash
codex
> 帮我写一个 Python 计算斐波那契的函数并保存到 fib.py
```

Pet、工具调用、思考摘要、多轮对话都能正常工作。

---

### B. 通过 cc-switch 添加自定义供应商

[cc-switch](https://github.com/farion1231/cc-switch) 是一个跨平台桌面 App，专门管理 Claude Code / Codex / OpenCode / OpenClaw / Gemini CLI 五个工具的多供应商切换。它的 Codex 预设里**没有 MiMo**（因为 MiMo 不支持 Responses API），所以我们用 mimo2codex 当桥，再以「自定义供应商」的方式加进 cc-switch。

#### 1. 启动 mimo2codex

```bash
export MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
mimo2codex
```

让它一直在后台跑（开机自启 / 用 `pm2` / `systemctl --user` / Windows 服务都行）。

#### 2. 拿到 cc-switch 配置片段

```bash
mimo2codex print-cc-switch
```

输出：

```
# cc-switch — Add Provider → Codex tab → Custom

# ───────── auth.json (粘到 auth.json 文本框) ─────────
{
  "OPENAI_API_KEY": "mimo2codex-local"
}

# ───────── config.toml (粘到 config.toml 文本框) ─────────
model_provider = "mimo2codex"
model = "mimo-v2.5-pro"

[model_providers.mimo2codex]
name = "MiMo (via mimo2codex)"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
```

#### 3. 在 cc-switch 里添加

打开 cc-switch → 顶部切到 **Codex** Tab → 点右上角 **+** 号 → 选「**应用专属供应商**」→ 预设选「**自定义**」（或 Custom）：

| 字段 | 填入 |
|---|---|
| **名称** | `MiMo (via mimo2codex)` |
| **auth.json** | 上面 print-cc-switch 输出的 auth.json 部分（整段 JSON） |
| **config.toml** | 上面 print-cc-switch 输出的 config.toml 部分（整段 TOML） |
| **备注**（可选） | `本地 mimo2codex 代理 → MiMo V2.5 Pro` |

点「添加」即可。

#### 4. 切换并启动 Codex

回到 cc-switch 主界面，在 Codex 列表里点击「**MiMo (via mimo2codex)**」，让它变成当前激活供应商（cc-switch 会自动写入 `~/.codex/auth.json` 和 `~/.codex/config.toml`）。

然后跑：

```bash
codex
```

完事。

> 💡 **小贴士**：cc-switch 的「获取模型」按钮（下载图标）会调用 `/v1/models` 端点。mimo2codex 已经实现了这个端点，所以你点一下就能下拉选 `mimo-v2.5-pro` / `mimo-v2.5-pro[1m]` / `mimo-v2-flash`。

---

### C. 在多个 Codex 供应商之间随时切换

cc-switch 的核心价值就是**一键切换**。结合 mimo2codex 后，你可以同时拥有：

| 名称 | 用途 |
|---|---|
| OpenAI 官方（cc-switch 内置预设） | GPT-5.2、思考能力最强但贵 |
| **MiMo (via mimo2codex)** | MiMo V2.5 Pro，1M 上下文，国内访问快 |
| Azure OpenAI（cc-switch 内置） | 企业合规走 Azure |
| OpenRouter（cc-switch 内置） | 多家模型聚合 |
| AiHubMix / DMXAPI（cc-switch 内置） | 国内中转 |

切换流程：

1. 打开 cc-switch
2. Codex Tab 里点想用的那个供应商
3. 顶部托盘也能直接切（cc-switch 支持）
4. 当前 Codex 会话不需要重启——下次启动 `codex` 就用新的了

> ⚠️ **注意**：mimo2codex 进程要保持运行状态。即使你在 cc-switch 里切到了别的供应商也没关系——mimo2codex 只在被路由到时才接收请求，不会消耗资源。可以挂在 `pm2`、Windows 服务或 systemd 用户单元里常驻。

---

## CLI 参数速查

| 参数 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `--port`, `-p` | `MIMO2CODEX_PORT` | `8788` | 监听端口 |
| `--host` | `MIMO2CODEX_HOST` | `127.0.0.1` | 绑定地址（建议不要暴露到公网） |
| `--base-url` | `MIMO_BASE_URL` | `https://api.xiaomimimo.com/v1` | 切换到 Token 套餐：`https://token-plan-cn.xiaomimimo.com/v1` |
| `--api-key` | `MIMO_API_KEY` | _必填_ | 上游 MiMo 的 Key |
| `--no-reasoning` | `MIMO2CODEX_NO_REASONING=1` | 关 | 终端不显示思考摘要（多轮工具调用时仍会回填给 MiMo） |
| `--verbose`, `-v` | `MIMO2CODEX_VERBOSE=1` | 关 | 打印每次翻译的请求 |

子命令：

```bash
mimo2codex                          # 启动代理
mimo2codex print-config             # 输出 ~/.codex/config.toml 片段
mimo2codex print-cc-switch          # 输出 cc-switch 自定义供应商片段
mimo2codex --port 9000 print-config # 端口换 9000 后再输出
```

---

## 常见问题

**Q：Pet 宠物在 mimo2codex 后还能用吗？**

A：**完全可用。** Pet 是桌面端的 UI 悬浮组件，状态来自 Codex 内部的 agent 状态（working / waiting-input / done / error）。这些状态由 Responses SSE 事件生命周期决定（`response.created` → `response.in_progress` → `response.output_item.added` → `response.completed` / `response.failed`）。mimo2codex 严格按规范发出全部事件，所以 pet 的转圈、闲置、完成、错误状态都会正确显示。

**Q：工具调用支持哪些？**

A：**全部 Codex 的内置工具都支持**——本地 shell、文件读写、apply_patch、web fetch 等。包括并行调用、多轮调用、流式 arguments delta。Codex 把工具定义放进 `tools` 字段，模型返回 `function_call` items；mimo2codex 在两种 API 之间双向翻译这部分，本地工具的执行还是 Codex 自己负责。

**Q：图片 / 文件输入支持吗？**

A：`input_image` 部分会被翻译成 `image_url` 格式透传——但 MiMo 的 chat API 只在 `mimo-v2-omni` 模型上接受图片，在 `mimo-v2.5-pro` 上会被上游静默丢弃。`input_file`（PDF 等）当前 MiMo chat API 不支持，会被丢弃并打 warn 日志。

**Q：思考过程可以隐藏吗？**

A：可以，启动时加 `--no-reasoning`。注意这只是不向 Codex 暴露——多轮工具调用时仍会把上一轮的 `reasoning_content` 回填给 MiMo（这是 MiMo 官方推荐的做法，能显著提升多轮工具调用质量）。

**Q：为什么不直接改 Codex 让它接受 chat wire？**

A：CLI 端确实可以降级到 0.80.0 临时绕过，但你会失去：
- pet 宠物（5月新出）
- 桌面端新版本的所有改进
- 后续所有 Codex 新功能

加一层协议 shim 是更小的改动、生命周期更长。

**Q：和 [claude-code-router](https://github.com/musistudio/claude-code-router) 是什么关系？**

A：思路一样（本地代理 + 协议翻译），但 claude-code-router 是面向 **Claude Code**（Anthropic Messages API）的；mimo2codex 是面向 **Codex**（OpenAI Responses API）的。两个工具可以并存。

**Q：把端口改了之后 cc-switch 还能用吗？**

A：能。改完用 `mimo2codex --port 9999 print-cc-switch` 拿新片段，去 cc-switch 里编辑一下「MiMo (via mimo2codex)」供应商的 config.toml 文本框（把 `base_url` 里的端口改了）即可。

**Q：mimo2codex 会校验入站 Key 吗？**

A：**不会。** 它只在 127.0.0.1 监听，假设你的本机是可信的。所有请求一律转发到 MiMo（用启动时的 `MIMO_API_KEY`）。这样设计是为了：
- 解耦凭据：Codex / cc-switch 那边随便填一个非空字符串就行，真正的 MiMo Key 不会暴露给 Codex 进程
- 简化使用：换 MiMo Key 不需要改 Codex / cc-switch 配置

如果担心本机有恶意进程，请确保只 bind `127.0.0.1`（默认就是）。

**Q：怎么看代理在干嘛？**

A：启动时加 `--verbose`（或设环境变量 `MIMO2CODEX_VERBOSE=1`）：

```bash
# 方式 A
npm run dev -- --verbose
# 方式 B
node dist/cli.js --verbose
# 方式 C
mimo2codex --verbose
```

会在 stderr 打印每次的上游 POST、模型名、消息数、工具数、流式与否。API Key 会被脱敏成 `sk-x…xxxx`。

---

## 项目结构

```
mimo2codex/
├── src/
│   ├── cli.ts                    # 入口：argv 解析、启动 server、打印片段
│   ├── server.ts                 # node:http server，路由 /v1/responses、/v1/models、/healthz
│   ├── config.ts                 # env + flags 合并
│   ├── upstream/
│   │   ├── mimoClient.ts         # 调上游 fetch 包装（重试 / 错误归一化）
│   │   └── chatStream.ts         # 上游 Chat SSE → ChatStreamChunk 异步迭代器
│   ├── translate/
│   │   ├── types.ts              # Responses + ChatCompletions 类型定义
│   │   ├── reqToChat.ts          # 请求方向翻译
│   │   ├── respToResponses.ts    # 非流式响应翻译
│   │   └── streamToSse.ts        # 流式响应状态机
│   └── util/
│       ├── ids.ts                # resp_*, msg_*, fc_*, rs_* id 生成
│       ├── sse.ts                # SSE 写入 / 测试用 in-memory sink
│       └── log.ts                # debug/info/warn/error + 脱敏
├── test/                          # 25 个 vitest 单测
├── dist/                          # tsc 输出（构建后产生）
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 许可证

MIT
