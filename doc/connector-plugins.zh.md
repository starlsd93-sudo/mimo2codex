# Codex Desktop connector 插件

<p>
  <a href="./connector-plugins.md">English</a> ·
  <a href="./connector-plugins.zh.md"><strong>简体中文</strong></a>
</p>

Codex Desktop 的 connector 插件（GitHub / Canva / HeyGen / Dropbox / Gmail / Google Drive / ...）依赖 OpenAI 后端的 MCP 运行时，mimo2codex 这种第三方代理实现不了。

## 当前行为

当请求里含 connector 工具时，mimo2codex 会注入一段简短的系统消息告诉上游模型该 connector 不可用、并建议用 `shell` + 命令行替代。模型把这转达给用户，例如：

> 这个 GitHub connector 在 mimo2codex 代理后不可用。我可以用 shell 调用 `gh` 帮你拿 profile —— 要这么干吗？

不再报 `unsupported call`。控制台也保持安静（不再有大段 WARN）。

## 变通方案

| Connector | 命令行替代 |
|-----------|------------|
| GitHub | `gh`（[cli.github.com](https://cli.github.com)） |
| Google Drive / Gmail | `rclone`，或 Google 官方 CLI |
| Dropbox | `rclone`，或 `dropbox` CLI |
| HeyGen / Canva | 用 `curl` 调它们的 REST API |

或者直接在 Codex Desktop → Settings → Plugins 里把不需要的 connector 关掉。

## 遇到未知工具类型怎么报

如果控制台出现 `dropping unknown tool type "X"`，重启 mimo2codex 时带上 `MIMO2CODEX_VERBOSE=1`，重现一次，（脱敏后的）工具 payload 会在 DEBUG 级别打出来，把它复制到 issue 即可。authorization / api_key / token 等敏感字段会自动脱敏。

## 相关链接

- Issue #39: https://github.com/7as0nch/mimo2codex/issues/39
- Issue #41（`tool_search` 工具）: https://github.com/7as0nch/mimo2codex/issues/41
