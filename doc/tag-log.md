# Tag Log

<p>
  <a href="./tag-log.md"><strong>English</strong></a> ·
  <a href="./tag-log.zh.md">简体中文</a>
</p>

Release history of mimo2codex, newest first.

**Category tags**

- **[new]** / **[feat]**: new features
- **[fix]**: bug fixes
- **[opt]** / **[refactor]**: optimization / refactor
- **[doc]**: documentation
- **[test]**: tests

---

## (v0.3.0 — coming)

- **[new]** **Docker auth deployment goes GA**: after v0.2.17 served as the preview, the **Docker auth mode** is now a stable feature — user registration / login, per-user m2c proxy API keys, BYOK (bring-your-own upstream key), Gitee / GitHub OAuth, downloadable Codex client config bundles. Put mimo2codex behind Docker / an internal network / a small private circle without leaking the upstream key. Local single-user runs (`authMode` defaults to `off`) are unaffected. Full guide: [doc/auth-deployment.md](./auth-deployment.md) — covers Docker compose, first-run bootstrap, OAuth setup, and troubleshooting.
- **[fix]** **Tool list dedup defense ([issue #20](https://github.com/7as0nch/mimo2codex/issues/20))**: newer Codex CLI / Desktop / DeX builds emit duplicate tool names (typical shape: a top-level `_fetch` function plus a `namespace`-wrapped `_fetch` that flattens to a second copy), causing MiMo to 400 with `"tools contains duplicate names: _fetch"`. reqToChat now dedupes by `function.name` / builtin `type` keep-first after the merge step; duplicates are logged at `WARN` so users can spot the client-side bug.
- **[new]** **Mixed-mode thinking history defense**: when conversation history contains assistant messages without `reasoning_content` (typical scenario: user toggled the thinking switch mid-session), automatically backfill those messages with the placeholder `"(this turn ran without thinking mode)"`. **Thinking stays ON** — avoids upstream MiMo / DeepSeek 400 `"reasoning_content must be passed back"`. Logs a paired INFO line.
- **[opt]** Quieter console log: `WARN client model rewritten on the way upstream` → `INFO model fallback applied — client sent unknown model id, request continues with provider default`. Demoted to INFO + rephrased; it was always a graceful fallback (request succeeds), not an error.
- **[doc]** New bilingual [Proxy / Network FAQ](./proxy-faq.md): mac & win proxy setup, error-code lookup (502 / ECONNREFUSED / DNS / TLS-MITM, etc.), origin of the `gpt-5.4` placeholder, mixed-mode thinking history explainer.
- **[doc]** New bilingual [Tag Log](./tag-log.md): migrated out of the README's `<details>` changelog block; sorted newest-first with `[new]/[fix]/[opt]/[doc]` categorization across all 44 historical tags.

---

## v0.2.17 — 2026-05-19

- **[new]** **Docker auth mode (preview)**: users can register, log in, and generate their own m2c (mimo2codex proxy) API key. For Docker / intranet / small private deployments, replace `OPENAI_API_KEY`'s `mimo2codex-local` placeholder with the generated m2c key — protects the upstream key from being abused. Single-user local runs (`authMode` defaults to `off`) are unaffected.

> ⚠️ **v0.2.17 is a preview release** — the first cut of the Docker auth deployment. **v0.3.0 is the GA**. For production use, please run v0.3.0+. See [Auth & deployment](./auth-deployment.md).

## v0.2.16 — 2026-05-19

- **[opt]** Admin UI tightening: denser layout, dropped redundant displays, reduced visual noise.

## v0.2.15 — 2026-05-18

> Includes betas `v0.2.15-beta.0/1/2` (SenseNova model adaptation + thinking fine-tuning + Kimi adaptation).

- **[new]** **Thinking mode admin UI**: the "Codex Enable" page gains a global **Thinking** card.
  - **Thinking ON/OFF**: persists into the settings DB; no more `--disable-thinking` restart. Takes effect immediately on the next request. OFF makes every provider skip thinking (`thinking:{type:"disabled"}` for mimo / deepseek, `reasoning_effort:"none"` for sensenova / other generic).
  - **Force high reasoning effort**: when Codex didn't pass `reasoning.effort`, mimo2codex fills in `reasoning_effort:"high"`. Disabled by default with a visible side-effect warning (billing can spike). CLI `--disable-thinking` still wins.
- **[new]** **Kimi (Moonshot) preset**: typing `https://api.moonshot.cn/v1` (or `moonshot.ai`) as baseUrl is auto-recognized and applies `dropReasoningEffort: true`, so Kimi (which uses `thinking:{enabled/disabled}` instead of `reasoning_effort`) doesn't 400 on the unknown field. Models: `kimi-k2.6` / `kimi-k2.5` / `kimi-k2-thinking` / `kimi-k2-thinking-turbo` / `moonshot-v1-{8k,32k,128k}`. See [doc/kimi.md](./kimi.md).
- **[new]** **Docker deployment**: new `Dockerfile` (multi-stage alpine, ~70MB), `.dockerignore`, GitHub Actions workflow that auto-builds **multi-arch `linux/amd64 / linux/arm64` images and pushes to ghcr.io/7as0nch/mimo2codex**; bundled `docker-compose.yml` for one-command launch with **the data dir bind-mounted to local `./.mimo2codex/`** (sqlite + providers.json + admin UI config persist across container rebuilds); env supports both `.env` mount and `-e` / `environment:` injection. macOS / Windows / Linux. Based on [#15](https://github.com/7as0nch/mimo2codex/pull/15) (thanks @hufang360).
- **[new]** SenseNova model adaptation (from betas).

## v0.2.14 — 2026-05-15

- **[fix]** Added inline comments to `.env.example` so first-time users don't miss what each field means.

## v0.2.13 / v0.2.12 / v0.2.11 / v0.2.10 — 2026-05-15

- **[new]** Version-update check (queries the upstream npm registry for newer releases). Iterated through four patches to refine network tolerance, caching, and message phrasing.

## v0.2.9 — 2026-05-15

- **[new]** Universal `.env` config: `mimo2codex init` then fill in keys — same config across platforms.

## v0.2.8 — 2026-05-15

> MiniMax / strict OpenAI-compatible upstream support patchset (PR #12).

- **[fix]** `reqToChat`: no longer sends `strict: null` upstream (MiMo's Pydantic schema rejects null and 400s with `"Input should be a valid boolean"`). Fixes [issue #11](https://github.com/7as0nch/mimo2codex/issues/11).
- **[fix]** `minimax-compat`: one-click preset no longer strips `stream_options` / `parallel_tool_calls` by default.
- **[feat]** `minimax-compat`: inline `<think>...</think>` on the response side is split into `reasoning_content`.
- **[feat]** Admin webui providers form: new "Strict OpenAI compat" switch group (covers minimaxCompat etc.).
- **[feat]** Generic provider gains the MiniMax-compat patch ([issue #7](https://github.com/7as0nch/mimo2codex/issues/7)).

## v0.2.7 — 2026-05-15

- **[new]** Full admin webui rewrite on **Ant Design 5**: dark/light themes, EN/中文 i18n, viewport-locked sider + footer, smoothed Token-usage curves.
- **[new]** `.env.example` + **Bash / PowerShell one-liner key-loader scripts** (`.env` is gitignored).
- **[new]** Per-model **⚡Probe** button on "Codex Enable": fires a minimal ping to validate key / baseUrl / model id end-to-end.
- **[new]** Token-usage chart folds in **cache-hit bars** (green = hits, gray ghost = prompt totals) plus a window-wide hit-rate summary.
- **[new]** Customizable Codex dir via settings or the `CODEX_HOME` env var.

> Includes betas `v0.2.6-beta.1/2/3`: MiMo models' `contextWindow` 128K → 1M (matching DeepSeek; fixes Codex 256K-config 400); webui refactor PR #1~#6 (antd 5 base, Setup/Models/CodexEnable theming, Logs table, Dashboard cache-hit overlay, viewport lockdown, etc.).

## v0.2.6 — 2026-05-14

- **[new]** **"Codex Enable" page** (**replaces cc-switch**): admin webui writes `~/.codex/auth.json` + `config.toml` in one click.
- **[new]** **Runtime override**: swap upstream models without restarting Codex.
- **[new]** Permanent backup retention + half-broken pair recovery + manual deletion: originals are auto-backed-up, and **the first backup capturing your real external auth.json is permanently preserved** — switch models 100 times and you can still restore the original Codex config.
- **[fix]** `removeOrphanToolMessages`: drops orphan tool messages on DeepSeek V4 session desync, preventing 400 `"Messages with role 'tool' must be a response to..."` ([PR #10](https://github.com/7as0nch/mimo2codex/pull/10) / [issue #8](https://github.com/7as0nch/mimo2codex/issues/8)).
- See [doc/codex-enable.md](./codex-enable.md).

## v0.2.5 — 2026-05-14

> Includes beta `v0.2.5-beta.1`.

- **[feat]** MiMo / DeepSeek docs aligned.
- **[fix]** DeepSeek `tool_calls` 400 fix.
- **[feat]** Friendly context-overflow error: surfaces a readable `/compact` hint instead of a raw 400.
- **[feat]** Beta release workflow (`npm run release:beta`).

## v0.2.4 — 2026-05-13

- **[test]** Added two-stage priority regression tests for `selectProvider`.
- **[doc]** Generic-provider routing-priority docs updated to match.

## v0.2.3 — 2026-05-13

- **[fix]** Fixed MiMo `reasoning_content` round-trip per Xiaomi's [official guidance](https://platform.xiaomimimo.com/docs/zh-CN/usage-guide/passing-back-reasoning_content).

## v0.2.2 — 2026-05-13

- **[fix]** GitHub Actions workflow fix.

## v0.2.1 — 2026-05-12

- **[new]** Added `mimoskill` — Python helpers for image generation, OCR, etc. (stdlib only, no pip).

## v0.1.16 ~ v0.1.19 — 2026-05-12

- **[new]** Early `mimoskill` iteration (v0.1.17 ~ v0.1.19): image gen / OCR / pet generation, polished step by step.
- **[new]** v0.1.16: support for additional models with `wireApi="responses"` direct passthrough (in addition to the default mimo / deepseek chat-translation path).

## v0.1.15 — 2026-05-12

- **[fix]** Registered `mimo-v2.5` vision model in the builtin catalog so it no longer silently falls back to `mimo-v2.5-pro` (which would drop images).

## v0.1.1 ~ v0.1.14 — 2026-05-09 ~ 2026-05-10

Early-project iteration (v0.1.1 was the first public release on 2026-05-09). No detailed changelog kept for this phase; main work:

- mimo / deepseek dual-provider scaffolding.
- Responses API ↔ Chat Completions bidirectional translation core (`reqToChat` / `respToResponses` / `streamToSse`).
- First-cut admin webui (Tokens / Logs / Settings pages).
- SQLite persistence (chat logs, model catalog, runtime settings).
- CLI: `mimo2codex init` / `update` / `print-config` / `print-cc-switch`.

Browse the full commit stream with `git log v0.1.1..v0.1.14 --oneline`.

---

## Release commands

Defined in [package.json](../package.json):

```bash
npm run release:patch    # x.y.Z+1
npm run release:minor    # x.Y+1.0
npm run release:major    # X+1.0.0
npm run release:beta     # pre-release
```

Full runbook: [PUBLISHING.md](../PUBLISHING.md) (repo root).
