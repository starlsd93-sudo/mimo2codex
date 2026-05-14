import { byShortcut, PROVIDERS } from "../providers/registry.js";
import type { ProviderId } from "../providers/types.js";

// Snippet target shared between CLI `print-config` / `print-cc-switch` and
// the admin webui's Setup page. Kept as a flat shape so the webui can JSON
// it through `/admin/api/setup-snippets` without further transformation.
export interface SnippetTarget {
  providerId: ProviderId;
  providerKey: string;             // toml [model_providers.<key>] name
  providerLabel: string;           // human-readable name field
  modelId: string;                 // Codex's model = "<id>"
  contextWindow?: number;          // for model_context_window
  maxOutputTokens?: number;        // for model_max_output_tokens
}

export interface HostPort {
  host: string;
  port: number;
}

// DeepSeek V4 family: 1M input / 384K max output across all current models.
// Kept here (rather than a maxOutputTokens field on each ProviderModel)
// because deepseek.ts is unchanged in this revision.
function deepseekMaxOutput(): number {
  return 393_216;
}

// Toml `[model_providers.<key>]` name for the given provider id. Preserved
// for backwards compatibility:
//   - mimo users keep `[model_providers.mimo]`
//   - deepseek users keep `[model_providers.mimo2codex]` (legacy)
//   - generic providers use `[model_providers.mimo2codex-<id>]` to avoid
//     collisions with any toml sections the user has already configured.
export function tomlProviderKeyFor(providerId: string): string {
  if (providerId === "mimo") return "mimo";
  if (providerId === "deepseek") return "mimo2codex";
  return `mimo2codex-${providerId}`;
}

// Resolve the default snippet target for a given provider id (or shortcut).
// When the input is not recognized, falls back to mimo to match the previous
// CLI behavior of "unknown --model means mimo".
export function resolveSnippetTarget(providerHint?: string): SnippetTarget {
  const providerId: ProviderId = providerHint
    ? (byShortcut(providerHint)?.id ?? "mimo")
    : "mimo";
  const provider = PROVIDERS[providerId];
  const modelMeta = provider.builtinModels.find((m) => m.id === provider.defaultModel);
  const maxOutputTokens =
    modelMeta?.maxOutputTokens ?? (providerId === "deepseek" ? deepseekMaxOutput() : undefined);
  return {
    providerId,
    providerKey: tomlProviderKeyFor(providerId),
    providerLabel: provider.displayName,
    modelId: provider.defaultModel,
    contextWindow: modelMeta?.contextWindow,
    maxOutputTokens,
  };
}

export function modelTuningLines(t: SnippetTarget): string {
  const lines: string[] = [];
  if (t.contextWindow) lines.push(`model_context_window = ${t.contextWindow}`);
  if (t.maxOutputTokens) lines.push(`model_max_output_tokens = ${t.maxOutputTokens}`);
  return lines.length ? "\n" + lines.join("\n") : "";
}

// Comment block listing every builtin model for the chosen provider.
export function alternativesComment(t: SnippetTarget): string {
  const provider = PROVIDERS[t.providerId];
  if (provider.builtinModels.length === 0) {
    return [
      `# No declared alternatives for ${provider.displayName}. Edit the`,
      `# \`model = "..."\` line above to send any model id supported by this`,
      `# upstream — mimo2codex forwards it verbatim.`,
    ].join("\n");
  }
  const lines: string[] = [];
  lines.push(
    `# Switch model — replace the two lines above (model = ... and`,
    `# model_context_window = ...) with one of the entries below.`,
    `# Available ${provider.displayName} models:`
  );
  for (const m of provider.builtinModels) {
    if (m.deprecatedAfter) continue;
    const ctx = m.contextWindow ? `   model_context_window = ${m.contextWindow}` : "";
    const modelMaxOut =
      m.maxOutputTokens ?? (t.providerId === "deepseek" ? deepseekMaxOutput() : undefined);
    const maxOut =
      modelMaxOut && m.contextWindow ? `   model_max_output_tokens = ${modelMaxOut}` : "";
    const marker = m.id === t.modelId ? " (current)" : "";
    lines.push(`#   model = "${m.id}"${ctx}${maxOut}${marker}`);
  }
  return lines.join("\n");
}

// Default snippet — uses ~/.codex/auth.json + requires_openai_auth = true.
// This avoids the common "Missing environment variable: MIMO2CODEX_KEY" error
// on the Codex desktop app, which doesn't inherit shell env vars set via
// `export` or `setx`. Works for both CLI and desktop with no env setup.
export function configSnippet(cfg: HostPort, target: SnippetTarget): string {
  return `# Step 1 — write ~/.codex/auth.json (Windows: %USERPROFILE%\\.codex\\auth.json)
# Any non-empty value works; mimo2codex does not validate inbound credentials.
{
  "OPENAI_API_KEY": "mimo2codex-local"
}

# Step 2 — append to ~/.codex/config.toml (Windows: %USERPROFILE%\\.codex\\config.toml)
model = "${target.modelId}"
model_provider = "${target.providerKey}"${modelTuningLines(target)}

${alternativesComment(target)}

[model_providers.${target.providerKey}]
name = "${target.providerLabel}"
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
export function configSnippetEnvKey(cfg: HostPort, target: SnippetTarget): string {
  return `# ~/.codex/config.toml — env-var variant (Codex CLI only; desktop app won't see shell env vars)
model = "${target.modelId}"
model_provider = "${target.providerKey}"${modelTuningLines(target)}

${alternativesComment(target)}

[model_providers.${target.providerKey}]
name = "${target.providerLabel}"
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
// Bare file contents written to ~/.codex/auth.json and ~/.codex/config.toml.
// Same shape ccswitch would write. Extracted so that:
//   1. ccSwitchSnippet() can wrap it with markdown for the CLI / Setup page
//   2. src/codex/state.ts can write these bytes directly when the user
//      hits "启用" in the webui
// Returned strings are intended to be the FULL file contents — they replace
// any existing config.toml. Backing up the previous file is the caller's job.
export function buildCcSwitchFiles(
  cfg: HostPort,
  target: SnippetTarget
): { authJson: string; configToml: string } {
  const authJson = JSON.stringify({ OPENAI_API_KEY: "mimo2codex-local" }, null, 2);
  const configToml = `model_provider = "${target.providerKey}"
model = "${target.modelId}"${modelTuningLines(target)}

${alternativesComment(target)}

[model_providers.${target.providerKey}]
name = "${target.providerLabel}"
base_url = "http://${cfg.host}:${cfg.port}/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
`;
  return { authJson, configToml };
}

export function ccSwitchSnippet(cfg: HostPort, target: SnippetTarget): string {
  const { authJson, configToml } = buildCcSwitchFiles(cfg, target);
  return `# cc-switch — Add Provider → Codex tab → Custom

# ───────── auth.json (paste into the auth.json textarea) ─────────
${authJson}

# ───────── config.toml (paste into the config.toml textarea) ─────────
${configToml}
# Note: OPENAI_API_KEY can be any non-empty string — mimo2codex does not
# validate inbound credentials. Your real upstream key (MIMO_API_KEY /
# DS_API_KEY) stays in the env of the machine running mimo2codex.
`;
}

// Webui-facing bundle: returns every snippet variant + the resolved snippet
// target. Used by `/admin/api/setup-snippets` so the page can render all
// three tabs in one round-trip.
export interface SnippetBundle {
  target: SnippetTarget;
  authJson: string;
  configToml: string;
  configTomlEnvKey: string;
  ccSwitchAuthJson: string;
  ccSwitchConfigToml: string;
}

export function buildSnippetBundle(providerHint: string | undefined, cfg: HostPort): SnippetBundle {
  const target = resolveSnippetTarget(providerHint);
  const { authJson: ccAuth, configToml: ccToml } = buildCcSwitchFiles(cfg, target);
  return {
    target,
    authJson: ccAuth,
    configToml: configSnippet(cfg, target),
    configTomlEnvKey: configSnippetEnvKey(cfg, target),
    ccSwitchAuthJson: ccAuth,
    ccSwitchConfigToml: ccToml,
  };
}
