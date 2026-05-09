import { mimo } from "./mimo.js";
import { deepseek } from "./deepseek.js";
import type { Provider, ProviderId } from "./types.js";

export const PROVIDERS: Readonly<Record<ProviderId, Provider>> = {
  mimo,
  deepseek,
};

export const PROVIDER_LIST: readonly Provider[] = [mimo, deepseek];

export function byShortcut(s: string): Provider | undefined {
  const norm = s.toLowerCase();
  return PROVIDER_LIST.find((p) => p.shortcut === norm || p.id === norm);
}

// Find which provider owns a given client-supplied model id (or alias).
// Used in PR2+ for per-request routing; in PR1 callers fall back to the
// configured default provider when this returns undefined.
export function byClientModel(model: string): Provider | undefined {
  for (const p of PROVIDER_LIST) {
    if (p.resolveModel(model)) return p;
  }
  return undefined;
}

export function isProviderId(s: string): s is ProviderId {
  return s === "mimo" || s === "deepseek";
}
