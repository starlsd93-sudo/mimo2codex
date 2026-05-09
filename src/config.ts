import { byShortcut, isProviderId, PROVIDER_LIST, PROVIDERS } from "./providers/registry.js";
import type { Provider, ProviderId, ProviderRuntime } from "./providers/types.js";
import { resolveDataDir } from "./db/dataDir.js";

export interface Config {
  host: string;
  port: number;
  baseUrl: string;            // resolved base url for the default provider
  apiKey: string;             // resolved api key for the default provider
  exposeReasoning: boolean;
  verbose: boolean;
  userAgent: string;
  defaultProviderId: ProviderId;
  providers: Record<ProviderId, ProviderRuntime | null>;
  // Convenience: same as providers[defaultProviderId]!.flags.isTokenPlan
  // when default is mimo. Kept on Config for log-banner ergonomics.
  isTokenPlan: boolean;
  dataDir: string;
  adminEnabled: boolean;
}

const DEFAULTS = {
  host: "127.0.0.1",
  port: 8788,
};

export interface ParsedArgs {
  host?: string;
  port?: number;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  exposeReasoning?: boolean;
  verbose?: boolean;
  envKey?: boolean;
  dataDir?: string;
  noAdmin?: boolean;
  positional: string[];
  showHelp: boolean;
  showVersion: boolean;
}

export function parseArgv(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], showHelp: false, showVersion: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`flag ${a} requires a value`);
      i++;
      return v;
    };
    switch (a) {
      case "--port":
      case "-p":
        out.port = Number(next());
        if (Number.isNaN(out.port)) throw new Error("--port must be a number");
        break;
      case "--host":
        out.host = next();
        break;
      case "--base-url":
      case "--baseurl":
        out.baseUrl = next();
        break;
      case "--api-key":
        out.apiKey = next();
        break;
      case "--model":
        out.model = next();
        break;
      case "--no-reasoning":
        out.exposeReasoning = false;
        break;
      case "--reasoning":
        out.exposeReasoning = true;
        break;
      case "--verbose":
      case "-v":
        out.verbose = true;
        break;
      case "--env-key":
        out.envKey = true;
        break;
      case "--data-dir":
        out.dataDir = next();
        break;
      case "--no-admin":
        out.noAdmin = true;
        break;
      case "--help":
      case "-h":
        out.showHelp = true;
        break;
      case "--version":
      case "-V":
        out.showVersion = true;
        break;
      default:
        if (a.startsWith("--")) {
          throw new Error(`unknown flag: ${a}`);
        }
        out.positional.push(a);
    }
  }
  return out;
}

function resolveProviderRuntime(
  provider: Provider,
  isDefault: boolean,
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv
): ProviderRuntime | null {
  // CLI --api-key / --base-url apply only to the default provider.
  const apiKeyFromCli = isDefault ? parsed.apiKey : undefined;
  const baseUrlFromCli = isDefault ? parsed.baseUrl : undefined;

  let apiKey = apiKeyFromCli;
  if (!apiKey) {
    for (const k of provider.envKeys) {
      const v = env[k];
      if (v) {
        apiKey = v;
        break;
      }
    }
  }
  if (!apiKey) return null;

  // Priority: CLI --base-url > env > key-based inference > defaultBaseUrl.
  // Key-based inference handles MiMo's tp-* / sk-* tiers — using the wrong
  // host with a tp-* key 401s, so this auto-switches to the right one when
  // the user hasn't overridden it explicitly.
  const baseUrl =
    baseUrlFromCli ??
    env[provider.baseUrlEnv] ??
    provider.inferBaseUrlFromKey?.(apiKey) ??
    provider.defaultBaseUrl;
  return {
    apiKey,
    baseUrl,
    flags: provider.detectFlags(apiKey, baseUrl),
  };
}

export function buildConfig(parsed: ParsedArgs, env: NodeJS.ProcessEnv, version: string): Config {
  const exposeReasoningEnv = env.MIMO2CODEX_NO_REASONING ? false : true;
  const verboseEnv = !!env.MIMO2CODEX_VERBOSE;

  // Resolve default provider. --model accepts either a known shortcut ("ds")
  // or a full provider id ("deepseek"). Default = mimo.
  let defaultProviderId: ProviderId = "mimo";
  if (parsed.model) {
    const p = byShortcut(parsed.model);
    if (!p) {
      const known = PROVIDER_LIST.map((x) => `${x.shortcut} (${x.id})`).join(", ");
      throw new Error(`unknown --model "${parsed.model}". Known providers: ${known}`);
    }
    defaultProviderId = p.id;
  } else if (env.MIMO2CODEX_DEFAULT_PROVIDER) {
    if (!isProviderId(env.MIMO2CODEX_DEFAULT_PROVIDER)) {
      throw new Error(
        `MIMO2CODEX_DEFAULT_PROVIDER must be one of: ${PROVIDER_LIST.map((p) => p.id).join(", ")}`
      );
    }
    defaultProviderId = env.MIMO2CODEX_DEFAULT_PROVIDER;
  }

  // Resolve runtime for every provider; null when no key is available. We
  // register all providers up-front so PR2's per-request routing can dispatch
  // to a non-default provider when its key is present.
  const providers: Record<ProviderId, ProviderRuntime | null> = {
    mimo: null,
    deepseek: null,
  };
  for (const p of PROVIDER_LIST) {
    providers[p.id] = resolveProviderRuntime(p, p.id === defaultProviderId, parsed, env);
  }

  const defaultRuntime = providers[defaultProviderId];
  if (!defaultRuntime) {
    const def = PROVIDERS[defaultProviderId];
    const envHint = def.envKeys.join(" or ");
    const docs =
      def.id === "mimo"
        ? "Get one at https://platform.xiaomimimo.com/#/console/api-keys"
        : "Get one at https://platform.deepseek.com/api_keys";
    throw new Error(
      `missing API key for ${def.displayName} — set ${envHint} env var or pass --api-key. ${docs}`
    );
  }

  const portFromEnv = env.MIMO2CODEX_PORT ? Number(env.MIMO2CODEX_PORT) : undefined;
  if (portFromEnv !== undefined && Number.isNaN(portFromEnv)) {
    throw new Error("MIMO2CODEX_PORT must be a number");
  }

  const adminEnabled = parsed.noAdmin
    ? false
    : env.MIMO2CODEX_NO_ADMIN
      ? false
      : true;
  const dataDir = adminEnabled ? resolveDataDir(parsed.dataDir, env) : "";

  return {
    host: parsed.host ?? env.MIMO2CODEX_HOST ?? DEFAULTS.host,
    port: parsed.port ?? portFromEnv ?? DEFAULTS.port,
    baseUrl: defaultRuntime.baseUrl,
    apiKey: defaultRuntime.apiKey,
    exposeReasoning: parsed.exposeReasoning ?? exposeReasoningEnv,
    verbose: parsed.verbose ?? verboseEnv,
    userAgent: `mimo2codex/${version}`,
    defaultProviderId,
    providers,
    isTokenPlan: !!defaultRuntime.flags.isTokenPlan,
    dataDir,
    adminEnabled,
  };
}
