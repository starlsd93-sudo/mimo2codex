# mimo2codex

> English · [中文文档](./README.zh.md)

Local proxy that lets the **latest OpenAI Codex CLI / desktop** talk to virtually any modern LLM. Built-in support for **Xiaomi MiMo V2.5** and **DeepSeek V4 Pro**, plus a **generic provider mechanism** that connects any **OpenAI Chat Completions-compatible** (Qwen / GLM / Kimi / vLLM / Ollama / LM Studio …) or **native Responses API** (OpenAI itself) upstream — no code changes, no re-publish needed. Translates Codex's Responses API ↔ upstream Chat Completions on the fly, per-request routing by `model` field, optional admin web console, runs on `127.0.0.1`.

![mimo2codex install + run](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/images/npminstall.jpg)

![Admin console · dashboard](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/images/admin-dashboard.png)

## Contents

- [Why](#why) — what problem this solves
- [What works](#what-works) — feature matrix
- [Install — pick one](#install--pick-one) — npm / curl / clone
- [Use](#use) — get a key, start the proxy, configure Codex
- [Use with cc-switch](#use-with-cc-switch)
- [Admin console](#admin-console) — dashboard, logs, models, settings
  - [Enabling 1M long context](#enabling-1m-long-context)
  - [Providers and model ids](#providers-and-model-ids)
  - [Plugging in third-party OpenAI-compatible upstreams](#plugging-in-third-party-openai-compatible-upstreams) — Qwen / GLM / Kimi / Ollama / OpenAI
- [CLI flags](#cli-flags)
  - [Built-in defaults (no flag needed)](#built-in-defaults-no-flag-needed)
- [Troubleshooting](#troubleshooting)
- [mimoskill — fill MiMo's gaps](#mimoskill--fill-mimos-gaps) — image gen / OCR fallback / pet generation
- [Project layout](#project-layout)
- [Develop](#develop)
- [License](#license)

**Detailed guides:** [Generic providers](./doc/generic-providers.md) · [mimoskill](./doc/mimoskill.md)

## Why

MiMo's [official Codex doc](https://platform.xiaomimimo.com/docs/zh-CN/integration/codex) only supports `wire_api = "chat"`, but newer Codex versions hard-error on it (the official workaround is to downgrade Codex, losing pets, the new desktop release and tool fixes). mimo2codex fixes this without touching either side: keep Codex on latest, run mimo2codex locally, Codex thinks it's talking to a native Responses backend.

Conceptually a sibling of [openrouter](https://openrouter.ai), [claude-code-router](https://github.com/musistudio/claude-code-router), [y-router](https://github.com/luohy15/y-router) — a thin protocol shim.

## What works

- ✅ Codex CLI `wire_api = "responses"` and Codex desktop app
- ✅ Multi-provider — **MiMo** + **DeepSeek**, mixed within one process (per-request routing by `model` field)
- ✅ **Generic OpenAI-compatible providers** — Qwen / GLM / Kimi / Ollama / native-Responses OpenAI, declare in `providers.json` and they just work. See [doc/generic-providers.md](./doc/generic-providers.md)
- ✅ MiMo models: `mimo-v2.5-pro` / `mimo-v2.5-pro[1m]` / `mimo-v2-flash`
- ✅ DeepSeek models: `deepseek-v4-pro` (default) / `deepseek-v4-flash` / `deepseek-chat` / `deepseek-reasoner`
- ✅ Tool calling — function tools, parallel calls, `local_shell`, `custom`, MCP `namespace`
- ✅ Web search — translated to MiMo's native `web_search` builtin (requires plugin activation); auto-skipped on DeepSeek
- ✅ Vision — only `mimo-v2.5` and `mimo-v2-omni`; pro/flash auto-strip images with a placeholder
- ✅ Reasoning passthrough (with `--no-reasoning` to hide)
- ✅ MiMo host auto-routing — `tp-*` keys → token-plan host, `sk-*` keys → pay-as-you-go host
- ✅ Local admin web UI at `http://127.0.0.1:8788/admin/` — model catalog, alias mgmt, chat logs, token stats, provider config
- ✅ sqlite persistence (default `~/.mimo2codex/data.db`, override with `--data-dir`)
- ✅ cc-switch integration (`mimo2codex print-cc-switch` outputs paste-ready snippets)
- ⚠️ **`/hatch` custom pet generation** — pure MiMo can't do this. Codex's `/hatch` is hardcoded to call OpenAI's `image_gen` tool client-side, and we can't intercept that from the proxy layer. MiMo also has no image-generation endpoint. Workaround via `mimoskill/` (free, no OpenAI key required) — see below.

## Install — pick one

### 🟢 npm (most users)

```bash
npm install -g mimo2codex
```

### 🟡 curl one-liner (no global install)

```bash
curl -fsSL https://raw.githubusercontent.com/7as0nch/mimo2codex/main/scripts/install.sh | bash
```

PowerShell on Windows:

```powershell
irm https://raw.githubusercontent.com/7as0nch/mimo2codex/main/scripts/install.ps1 | iex
```

### Other paths

- **Git clone + manual** — `git clone https://github.com/7as0nch/mimo2codex && cd mimo2codex && npm install && npm run build`. Use this if you want to hack on the source.
- **`npm link`** — after a clone, `npm run build && npm link` registers `mimo2codex` globally without publishing.

Requires Node.js ≥ 18.

## Use

### 1. Get an API key

| Provider | Console | Key prefix |
|---|---|---|
| MiMo | [platform.xiaomimimo.com](https://platform.xiaomimimo.com) → Console → API Keys | `sk-` (pay-as-you-go) / `tp-` (token-plan) |
| DeepSeek | [api-docs.deepseek.com](https://api-docs.deepseek.com/zh-cn/) | `sk-` |

### 2. Start the proxy

**MiMo only** (default):

```bash
export MIMO_API_KEY=sk-xxxxxxxxxxxxxxxx
mimo2codex
```

**DeepSeek only**:

```bash
export DS_API_KEY=sk-xxxxxxxxxxxxxxxx       # or DEEPSEEK_API_KEY
mimo2codex --model ds
```

**Both providers at once** (per-request routing — sending `mimo-v2.5-pro` goes to MiMo, sending `deepseek-v4-pro` goes to DeepSeek):

```bash
export MIMO_API_KEY=sk-mimo-key
export DS_API_KEY=sk-deepseek-key
mimo2codex                           # default fallback: mimo
mimo2codex --model ds                # default fallback: ds (unknown model fields go to ds)
```

The startup banner prints the `auth.json` + `config.toml` snippets, the enabled providers, the admin UI URL and the data directory. Default works for both Codex CLI and desktop without any env-var dance.

> **What `--model` actually does**: it picks the **default / fallback** provider — not a hard switch. When the client-supplied `model` field matches any **enabled** (key configured) provider's catalog (including aliases), the request is routed to that provider regardless of `--model`. `--model` only matters when:
> 1. Only one provider's key is configured — `--model` must point at it, otherwise startup errors out.
> 2. The client sends a model id that no provider recognizes (e.g. `gpt-4o`) — it falls back to the `--model` provider's `defaultModel`.
> 3. **The client sends a model that matches some provider's catalog, but that provider has no key configured** — also falls back to the `--model` provider's `defaultModel`, logged in admin as `client_model_rewritten`. E.g. if you only set `MIMO_API_KEY` (not `QWEN_API_KEY`), sending `qwen3-max` is silently rewritten to `mimo-v2.5-pro` and forwarded to MiMo. The admin "model mappings" table will show this `qwen3-max → mimo-v2.5-pro` rewrite.

### 3. Configure Codex

Copy the printed snippets to:

| | macOS / Linux | Windows |
|---|---|---|
| auth.json | `~/.codex/auth.json` | `%USERPROFILE%\.codex\auth.json` |
| config.toml | `~/.codex/config.toml` | `%USERPROFILE%\.codex\config.toml` |

### 4. Run Codex

```bash
codex
> Write a Python fibonacci function and save it to fib.py
```

Pet, tool calls, reasoning, multi-turn — all just work. Pass `--no-reasoning` if you want to hide thinking from the terminal.

> If Codex desktop ignores the new `auth.json`, **fully quit it** (system tray → Quit) and relaunch.

## Use with cc-switch

[cc-switch](https://github.com/farion1231/cc-switch) is a desktop app for switching between Claude Code / Codex / OpenCode providers in one click. Its built-in Codex preset list doesn't include MiMo, but mimo2codex slots in as a custom provider:

1. Keep mimo2codex running (`MIMO_API_KEY=... mimo2codex`)
2. `mimo2codex print-cc-switch` — outputs `auth.json` + `config.toml` text blocks
3. cc-switch GUI → **Codex** tab → **+** → **Custom** → paste both blocks → name it `MiMo (via mimo2codex)` → **Add**
4. Click the new provider to activate it; cc-switch writes Codex's config files for you. Switch back to OpenAI / Azure / OpenRouter anytime — mimo2codex keeps running and only gets traffic when its provider is active.

cc-switch's "Fetch Models" button calls `/v1/models`, which mimo2codex implements — the dropdown auto-lists `mimo-v2.5-pro`, `mimo-v2.5-pro[1m]`, `mimo-v2-flash`.

## Admin console

Browse to `http://127.0.0.1:8788/admin/` after start.

**Dashboard** — 24h / 7d / 30d token usage, error rate, requests aggregated by provider/model, model-mapping records, last 10 requests.

![Admin console · dashboard](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/images/admin-dashboard.png)

**Logs** — filter by provider, paginate by time, prune old records; status codes are color-coded and error snippets expand inline.

![Admin console · chat logs](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/images/admin-logs.png)

**Models** — provider tabs; builtin models are read-only, custom models + aliases (client-supplied `model` → upstream id) editable.

**Settings** — provider status, base URL, default model, UI prefs. **API keys are not stored in the UI** — they must come from environment variables; the UI only displays status and copy-paste shell snippets.

Data lives in sqlite (`~/.mimo2codex/data.db`); override with `--data-dir <path>` or disable entirely with `--no-admin`.

### Enabling 1M long context

The Codex client **doesn't read the context window from the proxy** — it reads `model_context_window` from `config.toml`. When unset, Codex falls back to ~256K, so even when the proxy forwards to `mimo-v2.5-pro[1m]` or `deepseek-v4-pro`, the bottom-left context badge stays at 258K.

`mimo2codex print-config` already emits `model_context_window` for the default model and lists every builtin variant for that provider in an inline comment block:

```toml
model = "mimo-v2.5-pro"
model_provider = "mimo"
model_context_window = 128000

# Switch model — replace the two lines above with one entry below.
# Available MiMo (via mimo2codex) models:
#   model = "mimo-v2.5-pro"   model_context_window = 128000 (current)
#   model = "mimo-v2.5-pro[1m]"   model_context_window = 1000000
#   model = "mimo-v2-flash"   model_context_window = 128000
```

To use 1M, replace the `model =` and `model_context_window =` pair with the 1M entry from the list. cc-switch users can edit the same lines directly in cc-switch's textarea — no proxy restart needed.

After writing to `~/.codex/config.toml`, **fully quit and relaunch Codex** (desktop: system tray → Quit, not just close the window).

> ⚠ **Whether 1M actually engages depends on two things outside the proxy**:
> 1. **Your upstream account** — for instance MiMo's `mimo-v2.5-pro[1m]` is gated on certain plans; you'll see upstream `400 "Not supported model"` if your account doesn't include it. Confirm with `curl https://api.xiaomimimo.com/v1/models -H "Authorization: Bearer $MIMO_API_KEY"`.
> 2. **Your Codex client version** — older desktop builds ignore `model_context_window` and hard-cap at 256K. The CLI usually ships fixes earlier; if `codex` in a terminal shows 1M but the desktop badge still shows 258K, update the desktop app.

### Providers and model ids

| Provider | Shortcut | Env var | Default base URL | Default model | Models |
|---|---|---|---|---|---|
| MiMo | `mimo` | `MIMO_API_KEY` | `https://api.xiaomimimo.com/v1` | `mimo-v2.5-pro` | `mimo-v2.5-pro` / `mimo-v2.5-pro[1m]` / `mimo-v2-flash` |
| DeepSeek | `ds` | `DS_API_KEY` or `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` | `deepseek-v4-pro` | `deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-chat`* / `deepseek-reasoner`* |

*legacy, deprecated 2026-07-24, both alias the v4-flash thinking / non-thinking modes.

> MiMo's `tp-*` keys auto-route to the token-plan host (`https://token-plan-cn.xiaomimimo.com/v1`); `sk-*` keys use the pay-as-you-go host. Setting `MIMO_BASE_URL` / `--base-url` explicitly overrides this; the startup banner prints a ⚠ warning if your key prefix and host don't match.

### Plugging in third-party OpenAI-compatible upstreams

Beyond the built-in MiMo / DeepSeek, **any OpenAI Chat Completions-compatible** (Qwen / GLM / Kimi / Ollama / vLLM …) or **native Responses API** (OpenAI itself, future-leaning providers) upstream can connect to Codex with zero code changes.

**Simplest path** — one env trio:

```bash
export GENERIC_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export GENERIC_API_KEY=sk-your-qwen-key
export GENERIC_DEFAULT_MODEL=qwen3-max
mimo2codex --model generic
```

**Multi-instance** — write `~/.mimo2codex/providers.json`:

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

Then `QWEN_API_KEY=sk-... mimo2codex --model qwen`.

Full field reference, `wireApi: "responses"` passthrough mode, copy-pasteable examples for Qwen / GLM / Kimi / Ollama / OpenAI, routing rules and troubleshooting all live in **[doc/generic-providers.md](./doc/generic-providers.md)**.

> Existing mimo / deepseek users with no `providers.json` **are not affected** — default provider stays `mimo` and behavior is byte-identical.

## CLI flags

| Flag | Env | Default | Notes |
|---|---|---|---|
| `--model <shortcut>` | `MIMO2CODEX_DEFAULT_PROVIDER` | `mimo` | default provider: `mimo` or `ds` |
| `--port`, `-p` | `MIMO2CODEX_PORT` | `8788` | listen port |
| `--host` | `MIMO2CODEX_HOST` | `127.0.0.1` | bind host |
| `--base-url` | `MIMO_BASE_URL` / `DEEPSEEK_BASE_URL` | see table above | base URL for the default provider |
| `--api-key` | `MIMO_API_KEY` / `DS_API_KEY` / `DEEPSEEK_API_KEY` | _at least one required_ | api key for the default provider (other providers read their own env vars) |
| `--data-dir <path>` | `MIMO2CODEX_DATA_DIR` | `~/.mimo2codex` | sqlite + admin UI data directory |
| `--no-admin` | `MIMO2CODEX_NO_ADMIN=1` | off | disable the admin UI + sqlite logging |
| `--no-reasoning` | `MIMO2CODEX_NO_REASONING=1` | off | hide reasoning from Codex (still preserved between turns) |
| `--verbose`, `-v` | `MIMO2CODEX_VERBOSE=1` | off | log every translated request body |

### Built-in defaults (no flag needed)

mimo2codex applies two behaviors automatically to make MiMo behave more like the OpenAI / Anthropic models Codex was designed for:

- **`parallel_tool_calls` forced on** — overrides Codex's default of `false`. Lets MiMo batch multiple tool calls per turn → fewer round-trips before the model commits to `apply_patch`.
- **Web search auto-forwarded with auto-fallback** — Codex's `web_search`/`web_search_preview` is translated to MiMo's `web_search` builtin. The model decides when to invoke it (no extra prompting required). If your account doesn't have the Web Search Plugin activated, the first request returns a 400; mimo2codex catches it, strips `web_search`, retries, and remembers — subsequent requests in the same process skip web_search proactively. **Zero config either way.**

> **Thinking mode is ON** — MiMo generates `reasoning_content` on every request and Codex shows it in the terminal. Pass `--no-reasoning` to hide thinking from the terminal (mimo2codex still re-injects it across turns for multi-turn tool quality, per [MiMo's official recommendation](https://platform.xiaomimimo.com/docs/zh-CN/quick-start/first-api-call)).

Subcommands:

```bash
mimo2codex print-config             # ~/.codex/config.toml + auth.json snippets
mimo2codex print-config --env-key   # legacy env-var variant (CLI only)
mimo2codex print-cc-switch          # cc-switch paste blocks
```

## Troubleshooting

<details>
<summary><b>Missing environment variable: <code>MIMO2CODEX_KEY</code></b></summary>

Your `config.toml` has the legacy `env_key = "MIMO2CODEX_KEY"` line. Codex desktop doesn't inherit shell env vars. Switch to the auth.json variant: replace `env_key = "..."` with `requires_openai_auth = true` and write `~/.codex/auth.json` with `{"OPENAI_API_KEY": "mimo2codex-local"}`. Or just rerun `mimo2codex print-config` and paste the new default output.

</details>

<details>
<summary><b>MiMo returned 404: No endpoints found that support image input</b></summary>

You sent images on a model that doesn't support vision. Only `mimo-v2.5` and `mimo-v2-omni` accept images. Switch model in `config.toml` to one of those, or let mimo2codex auto-strip (it already does on `mimo-v2.5-pro`/`-flash` — placeholder text replaces the image).

</details>

<details>
<summary><b>MiMo returned 400: Param Incorrect: <code>text</code> is not set</b></summary>

MiMo's image API requires every image-bearing message to include a `text` part. mimo2codex auto-injects a single space when missing — make sure you're on the latest version (`npm update -g mimo2codex` or `git pull && npm run build`).

</details>

<details>
<summary><b>Codex shows <code>image_gen tool not available</code> when generating a pet</b></summary>

That's Codex's `/hatch` trying to call OpenAI's image API. MiMo doesn't have image generation. Use [`mimoskill/scripts/generate_pet.py`](./mimoskill/scripts/generate_pet.py) instead — defaults to free Pollinations.ai, no extra key needed. See [mimoskill/SKILL.md](./mimoskill/SKILL.md).

</details>

<details>
<summary><b>Stream disconnected before completion</b></summary>

Old version bug — make sure you're on >= 0.1.0. Each SSE event must have <code>type</code> in its data payload; older builds were missing it.

</details>

<details>
<summary><b>Logs spammed with <code>dropping unsupported tool type</code></b></summary>

Already fixed — known server-side tools (`code_interpreter`, `image_generation`, `computer_use`, etc.) are silently dropped at debug level. Unknown types warn once per session, not per request.

</details>

<details>
<summary><b>MiMo returned 400: web search tool found in the request body, but webSearchEnabled is false</b></summary>

You're on an old build. Newer mimo2codex catches this 400 automatically: it strips `web_search` and retries, then skips it for the rest of the session. Update with `npm update -g mimo2codex` (or `git pull && npm run build`) and the error stops appearing.

If you actually want web search to work upstream, activate the Web Search Plugin at [MiMo console → Plugin Management](https://platform.xiaomimimo.com/#/console/plugin) (separately billed), then restart mimo2codex.

</details>

<details>
<summary><b>Startup banner shows ⚠ "sk-* key needs the pay-as-you-go host..." / "tp-* key needs the token-plan host..."</b></summary>

Stale `MIMO_BASE_URL` in your shell is overriding the key-prefix inference. Resolution priority is `--base-url > MIMO_BASE_URL > key-prefix inference > default`, so env wins over inference.

PowerShell:

```powershell
echo $env:MIMO_BASE_URL                                            # check
Remove-Item Env:MIMO_BASE_URL                                      # clear in current session
[Environment]::GetEnvironmentVariable('MIMO_BASE_URL','User')      # check user-level
[Environment]::SetEnvironmentVariable('MIMO_BASE_URL',$null,'User')  # remove user-level permanently
```

bash / zsh:

```bash
echo $MIMO_BASE_URL
unset MIMO_BASE_URL
```

Once cleared, `sk-*` keys auto-use `https://api.xiaomimimo.com/v1` and `tp-*` keys auto-use `https://token-plan-cn.xiaomimimo.com/v1`.

</details>

<details>
<summary><b>DeepSeek returns 401 Unauthorized</b></summary>

Confirm `DS_API_KEY` (or `DEEPSEEK_API_KEY`) is what's actually being picked up — DeepSeek keys are issued on the DeepSeek console only and don't interchange with MiMo keys.

```bash
mimo2codex --model ds --verbose
# The startup banner prints `api key: sk-x…xxxx` — verify it's the DS one.
```

</details>

<details>
<summary><b>Admin UI returns 503 "Admin UI not built"</b></summary>

The frontend bundle hasn't been built yet. Run `npm run build:all` (compiles backend with tsc, then frontend with vite) to populate `dist/web/`. To build only the frontend: `npm run web:install && npm run web:build`.

</details>

<details>
<summary><b>better-sqlite3 fails to compile during npm install</b></summary>

Usually caused by an unusual Node distribution (e.g., Electron-bundled Node). Node ≥ 18 from nodejs.org normally pulls a prebuilt binary without invoking node-gyp. If you only want the proxy and not the admin UI, pass `--no-admin` — the db module is not loaded in that mode.

</details>

<details>
<summary><b>Codex says "I'll do X" then ends the turn without calling any tool</b></summary>

MiMo's known weakness on multi-step agentic coding — the model spends tokens narrating instead of calling tools. mimo2codex defaults `parallel_tool_calls: true` (lets MiMo batch tool calls per turn), which usually mitigates it.

If you still hit it, the highest-leverage fix is **a more directive prompt** — replace "继续" with something like:

> 不要解释，直接调 apply_patch 写完整文件内容

This pattern (concrete instruction + explicit tool name + "don't explain") is much more reliable than "continue" with MiMo.

</details>

## mimoskill — fill MiMo's gaps

> 📖 **Full reference:** [doc/mimoskill.md](./doc/mimoskill.md) — per-script docs, env vars, triggering rules, three usage modes, recipes, troubleshooting. The section below is a quick summary.

[mimoskill/](./mimoskill/) is a bundle of helper scripts + reference docs at the project root. It exists because some things MiMo just doesn't do natively (mainly: image generation, OCR fallback when the chat model is text-only), and Codex hardcodes a few capability assumptions on the client side that the proxy can't override.

### Why it exists

| Problem | Why mimo2codex alone can't fix it |
|---|---|
| `/hatch` custom pet generation | Codex calls OpenAI's `image_gen` tool **client-side**. MiMo has no image-gen endpoint, and we can't fake one in the proxy because Codex won't ship the request through us — it tries to talk to OpenAI directly with the auth.json key. |
| In-Codex image generation in general | Same reason. |
| Direct MiMo calls outside Codex | mimo2codex is a proxy, not an SDK — bare scripts are easier than spinning up the proxy for one-off calls. |
| Quirks like image+text pairing, `max_completion_tokens`, `reasoning_content` re-injection | Repeating these every time you write a script wastes your time; the helper scripts encode them already. |

### What's in it

| File | Purpose |
|---|---|
| `SKILL.md` | Skill manifest read by Claude / Codex agents — describes when to invoke each script |
| `scripts/mimo_chat.py` | Direct chat / vision / web-search call to MiMo, **stdlib-only** (no `pip install openai`) |
| `scripts/generate_pet.py` | Image generation: `auto` mode picks free Pollinations when no OpenAI key, else `gpt-image-1`. Also supports Replicate / local SD. |
| `scripts/install_pet.sh` | Install the generated PNG into Codex's pet directory (probes macOS/Linux/Windows paths) |
| `references/models.md` | MiMo capability matrix + field quirks |
| `references/pet_workflow.md` | Pet generation walkthrough (single image vs animated bundle) |
| `assets/pet_prompt_template.md` | Tuned chibi-sticker prompt templates |

### Three ways to use it

**1. Direct invocation (any user, no setup)**

```bash
python3 mimoskill/scripts/mimo_chat.py "tell me a joke"
python3 mimoskill/scripts/mimo_chat.py --image src.jpg "describe this"
python3 mimoskill/scripts/generate_pet.py --description "chibi shiba dev" --out pet.png
bash mimoskill/scripts/install_pet.sh pet.png shiba
```

**2. As a Claude Code skill** — symlink the directory into `~/.claude/skills/`:

```bash
ln -s "$(pwd)/mimoskill" ~/.claude/skills/mimoskill
```

Claude reads `SKILL.md` and routes relevant requests (e.g. "generate a pet from this image") to the right scripts automatically.

**3. As a Codex agent guide** — already wired via [AGENTS.md](./AGENTS.md). Codex reads it on each session and routes image-gen / pet tasks to mimoskill scripts instead of trying to `pip install openai`.

### Generating a `/hatch` replacement pet

```bash
# Generate (free — defaults to Pollinations.ai when no OpenAI key is set)
python3 mimoskill/scripts/generate_pet.py --description "chibi shiba coder" --out pet.png

# Install
bash mimoskill/scripts/install_pet.sh pet.png shiba

# Fully quit + relaunch Codex, pick the new pet from the picker
```

For higher quality, set `PET_OPENAI_API_KEY=sk-real-openai-key` (separate from `MIMO_API_KEY` — used only for the image gen call) and `auto` mode switches to `gpt-image-1`. Animated multi-state bundles via `--bundle DIR/`. Full guide: [mimoskill/SKILL.md](./mimoskill/SKILL.md).

## Project layout

![Project structure](https://raw.githubusercontent.com/7as0nch/mimo2codex/main/tutorial-video/assets/04-agent-docs.jpg)

```
src/
  cli.ts, server.ts, config.ts        # entry, routing, multi-provider config
  providers/{types,mimo,deepseek,generic,genericLoader,registry}.ts   # Provider abstraction + built-ins + generic factory
  setup/snippets.ts                   # shared print-config / admin /setup-snippets generator
  upstream/openaiCompatClient.ts      # chat + responses passthrough upstream clients
  translate/                          # Responses ↔ Chat Completions translation
  admin/router.ts                     # /admin/api/* REST + /admin/* SPA static hosting
  db/{index,logs,settings,models}.ts  # better-sqlite3 layer + migrations + seed
test/                # 136 vitest cases
web/                 # Vite + React 18 admin console (builds to dist/web/)
mimoskill/           # MiMo helpers + pet generation workaround
doc/                 # extended docs (generic providers, etc.) — referenced from README
scripts/install.{sh,ps1}  # one-liner bootstrap
dist/                # tsc + vite output (generated)
AGENTS.md            # Codex-agent instructions (don't import openai, use mimoskill)
PUBLISHING.md        # maintainer release runbook
```

## Develop

```bash
git clone https://github.com/7as0nch/mimo2codex && cd mimo2codex
npm install
npm run web:install  # frontend deps (first run only)
npm run dev          # backend via tsx, no build step
npm run web:dev      # vite dev server (5173, proxies /admin/api → 8788) — separate terminal
npm test             # 100 vitest cases
npm run build        # backend only → dist/cli.js
npm run web:build    # frontend only → dist/web/
npm run build:all    # both at once
```

To register `mimo2codex` globally from your local checkout: `npm run build:all && npm link`.

## License

MIT — see [LICENSE](./LICENSE).
