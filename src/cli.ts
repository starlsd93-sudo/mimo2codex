#!/usr/bin/env node
import { createRequire } from "node:module";
import { buildConfig, parseArgv, type Config } from "./config.js";
import { startServer } from "./server.js";
import { setVerbose, log, redactKey } from "./util/log.js";
import { closeDb, openDb } from "./db/index.js";

const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

const HELP = `mimo2codex v${VERSION} — local proxy: Codex Responses API → Chat Completions (MiMo / DeepSeek)

USAGE
  mimo2codex [options]
  mimo2codex print-config
  mimo2codex print-cc-switch

OPTIONS
  -p, --port <n>          listen port (default: 8788, env: MIMO2CODEX_PORT)
      --host <h>          bind host (default: 127.0.0.1, env: MIMO2CODEX_HOST)
      --model <shortcut>  default upstream provider: "mimo" (default) or "ds" (DeepSeek)
      --base-url <url>    base url for the default provider (env: MIMO_BASE_URL / DEEPSEEK_BASE_URL)
      --api-key <key>     api key for the default provider (env varies — see below) — required
      --no-reasoning      hide reasoning_content from Codex (still re-injected for multi-turn quality)
      --reasoning         force reasoning passthrough (default)
      --data-dir <path>   admin sqlite + UI data directory (default: ~/.mimo2codex,
                          env: MIMO2CODEX_DATA_DIR)
      --no-admin          disable the local admin UI + sqlite logging
                          (env: MIMO2CODEX_NO_ADMIN=1)
  -v, --verbose           log every request (env: MIMO2CODEX_VERBOSE=1)
  -V, --version           print version
  -h, --help              show this help

PROVIDER KEYS
      MiMo:     MIMO_API_KEY                          (default base: https://api.xiaomimimo.com/v1)
      DeepSeek: DS_API_KEY  or  DEEPSEEK_API_KEY      (default base: https://api.deepseek.com/v1)
      Set the key for whichever provider --model selects. Other providers are
      registered automatically when their key is present (per-request routing
      lands in a follow-up release).

DEFAULTS BAKED IN (no flag needed)
      ✓ MiMo thinking mode ON — model generates reasoning_content; use
        --no-reasoning to hide it from the Codex terminal (still preserved
        between turns for multi-turn tool quality)
      ✓ parallel_tool_calls forced on — model can batch tool calls per turn,
        helps avoid "model says 'I'll do X' then ends" pattern
      ✓ Codex web_search forwarded to MiMo's web_search builtin. If your account
        doesn't have the Web Search Plugin activated, MiMo returns 400
        "webSearchEnabled is false" — mimo2codex surfaces that error so you can
        activate the plugin (https://platform.xiaomimimo.com/#/console/plugin,
        separately billed) and restart, or accept that web search isn't available

SUBCOMMANDS
  print-config            print ~/.codex/auth.json + config.toml snippets (default;
                          works for Codex CLI and desktop app)
  print-config --env-key  print env-var-based variant (Codex CLI only — desktop app
                          will NOT see shell env vars set via export/setx)
  print-cc-switch         print auth.json + config.toml snippets for the cc-switch
                          desktop app (https://github.com/farion1231/cc-switch)

EXAMPLES
  MIMO_API_KEY=sk-... mimo2codex
  mimo2codex --port 9000 --base-url https://token-plan-cn.xiaomimimo.com/v1
  mimo2codex print-config > codex-mimo.toml
  mimo2codex print-config --env-key       # legacy env-var variant
  mimo2codex print-cc-switch
`;

// Default snippet — uses ~/.codex/auth.json + requires_openai_auth = true.
// This avoids the common "Missing environment variable: MIMO2CODEX_KEY" error
// on the Codex desktop app, which doesn't inherit shell env vars set via
// `export` or `setx`. Works for both CLI and desktop with no env setup.
function configSnippet(cfg: { host: string; port: number }): string {
  return `# Step 1 — write ~/.codex/auth.json (Windows: %USERPROFILE%\\.codex\\auth.json)
# Any non-empty value works; mimo2codex does not validate inbound credentials.
{
  "OPENAI_API_KEY": "mimo2codex-local"
}

# Step 2 — append to ~/.codex/config.toml (Windows: %USERPROFILE%\\.codex\\config.toml)
model = "mimo-v2.5-pro"
model_provider = "mimo"

[model_providers.mimo]
name = "MiMo (via mimo2codex)"
base_url = "http://${cfg.host}:${cfg.port}/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1

# Step 3 — completely quit and restart Codex (the desktop app must be relaunched
# for the new auth.json to be picked up). Then run \`codex\` and pick this provider.

# ⚠️ If you also use Codex with your real OpenAI account, this auth.json overwrites
# your OpenAI login. Use cc-switch (\`mimo2codex print-cc-switch\`) instead to switch
# between providers cleanly, or use \`mimo2codex print-config --env-key\` for the
# env-var-based variant (works for Codex CLI but not the desktop app).
`;
}

// Legacy env_key variant — keeps ~/.codex/auth.json untouched (preserving any
// existing OpenAI login). Requires MIMO2CODEX_KEY to be set in the environment
// of the process running \`codex\`. Codex DESKTOP APP does not inherit shell env
// vars on macOS/Windows, so this variant only works reliably for the CLI.
function configSnippetEnvKey(cfg: { host: string; port: number }): string {
  return `# ~/.codex/config.toml — env-var variant (Codex CLI only; desktop app won't see shell env vars)
model = "mimo-v2.5-pro"
model_provider = "mimo"

[model_providers.mimo]
name = "MiMo (via mimo2codex)"
base_url = "http://${cfg.host}:${cfg.port}/v1"
wire_api = "responses"
env_key = "MIMO2CODEX_KEY"
request_max_retries = 1

# Then in your shell (the same shell you launch \`codex\` from):
#   export MIMO2CODEX_KEY=anything           # macOS/Linux/Git Bash
#   $env:MIMO2CODEX_KEY="anything"           # Windows PowerShell
#   set MIMO2CODEX_KEY=anything              # Windows CMD (current session only)
#
# For Codex DESKTOP APP, this variant does NOT work — desktop apps launched from
# Finder/Start Menu don't inherit shell env vars. Use the default print-config
# (auth.json variant) or \`mimo2codex print-cc-switch\` instead.
`;
}

// cc-switch (https://github.com/farion1231/cc-switch) is a desktop app that
// manages multiple Codex providers via a "+" → "Custom" panel. It writes
// ~/.codex/auth.json + ~/.codex/config.toml when you switch providers.
// This subcommand prints both snippets in a copy-pasteable form so users can
// add mimo2codex as a custom Codex provider in cc-switch.
function ccSwitchSnippet(cfg: { host: string; port: number }): string {
  const authJson = JSON.stringify({ OPENAI_API_KEY: "mimo2codex-local" }, null, 2);
  const configToml = `model_provider = "mimo2codex"
model = "mimo-v2.5-pro"

[model_providers.mimo2codex]
name = "MiMo (via mimo2codex)"
base_url = "http://${cfg.host}:${cfg.port}/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
`;
  return `# cc-switch — Add Provider → Codex tab → Custom

# ───────── auth.json (paste into the auth.json textarea) ─────────
${authJson}

# ───────── config.toml (paste into the config.toml textarea) ─────────
${configToml}
# Note: OPENAI_API_KEY can be any non-empty string — mimo2codex does not
# validate inbound credentials. Your real MiMo key stays in MIMO_API_KEY
# on the machine running mimo2codex.
`;
}

function checkMimoHostMismatch(cfg: Config): string | null {
  // Catch the most common foot-gun: tp-* key sent at the pay-as-you-go host
  // (or sk-* key sent at the token-plan host) — usually because MIMO_BASE_URL
  // is left over in the shell from a previous session. Yields 401 or
  // confusing 400s upstream; cheaper to warn at startup.
  if (cfg.defaultProviderId !== "mimo") return null;
  const isTpKey = cfg.apiKey.startsWith("tp-");
  const isSkKey = cfg.apiKey.startsWith("sk-");
  const hostIsTokenPlan = /token-plan/i.test(cfg.baseUrl);
  if (isTpKey && !hostIsTokenPlan) {
    return `tp-* key 通常需要 token-plan 主机，但当前 baseUrl 是 ${cfg.baseUrl}。检查 MIMO_BASE_URL / --base-url 是否覆盖了自动推断。`;
  }
  if (isSkKey && hostIsTokenPlan) {
    return `sk-* key 通常需要 pay-as-you-go 主机，但当前 baseUrl 是 ${cfg.baseUrl}。检查 MIMO_BASE_URL / --base-url 是否泄漏（PowerShell: Remove-Item Env:MIMO_BASE_URL）。`;
  }
  return null;
}

function printStartupBanner(cfg: Config): void {
  // eslint-disable-next-line no-console
  console.log(`mimo2codex v${VERSION} listening on http://${cfg.host}:${cfg.port}`);
  // eslint-disable-next-line no-console
  console.log(`provider:    ${cfg.defaultProviderId}`);
  // eslint-disable-next-line no-console
  console.log(`upstream:    ${cfg.baseUrl}`);
  // eslint-disable-next-line no-console
  console.log(`api key:     ${redactKey(cfg.apiKey)}`);
  const mismatch = checkMimoHostMismatch(cfg);
  if (mismatch) {
    // eslint-disable-next-line no-console
    console.log(`⚠ 警告:      ${mismatch}`);
  }
  if (cfg.defaultProviderId === "mimo") {
    // eslint-disable-next-line no-console
    console.log(
      `plan:        ${cfg.isTokenPlan ? "token-plan (web_search auto-disabled — plugin not available)" : "pay-as-you-go"}`
    );
  }
  // eslint-disable-next-line no-console
  console.log(`reasoning:   ${cfg.exposeReasoning ? "passthrough" : "hidden"}`);
  const others = (Object.keys(cfg.providers) as Array<keyof typeof cfg.providers>)
    .filter((id) => id !== cfg.defaultProviderId && cfg.providers[id])
    .join(", ");
  if (others) {
    // eslint-disable-next-line no-console
    console.log(`registered:  ${others} (model-routed when client picks one of those ids)`);
  }
  if (cfg.adminEnabled) {
    // eslint-disable-next-line no-console
    console.log(`admin UI:    http://${cfg.host}:${cfg.port}/admin/`);
    // eslint-disable-next-line no-console
    console.log(`data dir:    ${cfg.dataDir}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`admin UI:    disabled (--no-admin)`);
  }
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(configSnippet({ host: cfg.host, port: cfg.port }));
}

function main(): void {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }

  if (parsed.showHelp) {
    // eslint-disable-next-line no-console
    console.log(HELP);
    return;
  }
  if (parsed.showVersion) {
    // eslint-disable-next-line no-console
    console.log(VERSION);
    return;
  }

  if (parsed.positional[0] === "print-config") {
    const host = parsed.host ?? "127.0.0.1";
    const port = parsed.port ?? 8788;
    const useEnvKey = parsed.envKey === true;
    // eslint-disable-next-line no-console
    console.log(useEnvKey ? configSnippetEnvKey({ host, port }) : configSnippet({ host, port }));
    return;
  }

  if (parsed.positional[0] === "print-cc-switch") {
    const host = parsed.host ?? "127.0.0.1";
    const port = parsed.port ?? 8788;
    // eslint-disable-next-line no-console
    console.log(ccSwitchSnippet({ host, port }));
    return;
  }

  let cfg: Config;
  try {
    cfg = buildConfig(parsed, process.env, VERSION);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }

  setVerbose(cfg.verbose);

  if (cfg.adminEnabled) {
    try {
      openDb(cfg.dataDir);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `error: failed to open admin database at ${cfg.dataDir}: ${(err as Error).message}\n` +
          `Pass --no-admin to disable persistence, or --data-dir <path> to choose a writable location.`
      );
      process.exit(2);
    }
  }

  printStartupBanner(cfg);

  const server = startServer(cfg);
  server.on("listening", () => {
    log.debug("server listening");
  });
  server.on("error", (err) => {
    log.error("server error", { error: err.message });
    process.exit(1);
  });

  const shutdown = (sig: string) => {
    log.info(`received ${sig}, shutting down`);
    server.close(() => {
      try {
        closeDb();
      } catch {
        // ignore
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
