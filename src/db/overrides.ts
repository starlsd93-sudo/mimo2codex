import { deleteSetting, getSetting, setSetting } from "./settings.js";

// Persisted "active model override" — when set, selectProvider Pass 0 routes
// every incoming request to (providerId, modelId) regardless of what the
// client sent in payload.model. Stored as two settings KV rows so the
// existing forbidden-keys gate (api_key et al.) keeps working unchanged.
const KEY_PROVIDER = "codex.activeOverride.providerId";
const KEY_MODEL = "codex.activeOverride.modelId";

export interface ActiveOverride {
  providerId: string;
  modelId: string;
}

export function getActiveOverride(): ActiveOverride | null {
  const providerId = getSetting(KEY_PROVIDER);
  const modelId = getSetting(KEY_MODEL);
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

export function setActiveOverride(providerId: string, modelId: string): void {
  setSetting(KEY_PROVIDER, providerId);
  setSetting(KEY_MODEL, modelId);
}

export function clearActiveOverride(): void {
  deleteSetting(KEY_PROVIDER);
  deleteSetting(KEY_MODEL);
}
