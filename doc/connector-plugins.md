# Codex Desktop connector plugins

<p>
  <a href="./connector-plugins.md"><strong>English</strong></a> ·
  <a href="./connector-plugins.zh.md">简体中文</a>
</p>

Codex Desktop's connector plugins (GitHub / Canva / HeyGen / Dropbox / Gmail / Google Drive / ...) depend on OpenAI's backend MCP runtime and cannot be served by a third-party proxy like mimo2codex.

## What happens now

When a request includes a connector tool, mimo2codex injects a short system message telling the upstream model the connector is unavailable and suggesting a `shell` + CLI alternative. The model relays this to the user, e.g.:

> The GitHub connector isn't available through this proxy. I can run `gh` via the shell tool to fetch your profile — should I do that?

No more `unsupported call` errors. The console stays quiet (no scary WARN walls).

## Workarounds

| Connector | CLI equivalent |
|-----------|----------------|
| GitHub | `gh` ([cli.github.com](https://cli.github.com)) |
| Google Drive / Gmail | `rclone`, or Google's CLI tools |
| Dropbox | `rclone`, or `dropbox` CLI |
| HeyGen / Canva | their REST API via `curl` |

Or just disable the connector in Codex Desktop → Settings → Plugins.

## Reporting unknown tool types

If you see `dropping unknown tool type "X"` in the console, restart mimo2codex with `MIMO2CODEX_VERBOSE=1` to surface the (redacted) tool payload at DEBUG level, then paste it into an issue. Secrets (authorization / api_key / token / etc.) are scrubbed automatically.

## See also

- Issue #39: https://github.com/7as0nch/mimo2codex/issues/39
- Issue #41 (`tool_search` builtin): https://github.com/7as0nch/mimo2codex/issues/41
