import { mimo } from "./mimo.js";
import { deepseek } from "./deepseek.js";
import type { Provider, ProviderId } from "./types.js";

// Built-in providers are always registered first. Generic providers loaded
// at startup (from providers.json or GENERIC_* env vars) are appended via
// initRegistry() before buildConfig() runs. The registry is mutable state
// but transitions only once per process — there is no hot reload.
export const BUILTIN_PROVIDERS: readonly Provider[] = [mimo, deepseek];

// Single mutable container objects. Importers keep their reference and see
// the updated contents after initRegistry() runs. This avoids Proxy gymnastics
// while still letting the registry be populated lazily at startup.
const providerListMutable: Provider[] = [...BUILTIN_PROVIDERS];
const providersMapMutable: Record<string, Provider> = Object.fromEntries(
  BUILTIN_PROVIDERS.map((p) => [p.id, p])
);

export const PROVIDER_LIST: readonly Provider[] = providerListMutable;
export const PROVIDERS: Readonly<Record<ProviderId, Provider>> = providersMapMutable;

// Initialize the registry with extra generic providers. Called once from
// cli.ts main() before buildConfig(). Safe to call zero times — the
// built-ins are present from module load.
export function initRegistry(generics: readonly Provider[]): void {
  // Reset to built-ins (idempotent — tests may call this multiple times).
  providerListMutable.length = 0;
  providerListMutable.push(...BUILTIN_PROVIDERS);
  for (const key of Object.keys(providersMapMutable)) {
    delete providersMapMutable[key];
  }
  for (const p of BUILTIN_PROVIDERS) {
    providersMapMutable[p.id] = p;
  }

  for (const p of generics) {
    if (providersMapMutable[p.id]) {
      throw new Error(
        `provider id "${p.id}" collides with an already-registered provider — pick a different id`
      );
    }
    providerListMutable.push(p);
    providersMapMutable[p.id] = p;
  }
}

export function byShortcut(s: string): Provider | undefined {
  const norm = s.toLowerCase();
  return providerListMutable.find((p) => p.shortcut === norm || p.id === norm);
}

// Find which provider owns a given client-supplied model id (or alias).
// Used by selectProvider() in server.ts for per-request routing.
//
// Note: generic providers with empty `builtinModels` accept any model id via
// their `resolveModel()` (untyped passthrough). To prevent such a generic
// from "swallowing" every unknown id (which would defeat the configured
// default provider's routing), we skip open-catalog generics in this lookup.
// Routing to an open-catalog generic happens via `selectProvider` only when
// it is the configured default provider, or when the user has declared
// matching `models[]` in the spec.
export function byClientModel(model: string): Provider | undefined {
  for (const p of providerListMutable) {
    const isOpenCatalog = !p.builtinModels || p.builtinModels.length === 0;
    if (isOpenCatalog) continue;
    if (p.resolveModel(model)) return p;
  }
  return undefined;
}

export function isProviderId(s: string): s is ProviderId {
  return Object.prototype.hasOwnProperty.call(providersMapMutable, s);
}
