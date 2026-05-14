import { describe, expect, it, afterEach } from "vitest";
import { selectProvider } from "../src/server.js";
import type { Config } from "../src/config.js";
import { initRegistry } from "../src/providers/registry.js";
import { createGenericProvider } from "../src/providers/generic.js";
import type { ProviderRuntime } from "../src/providers/types.js";

// Build a minimal Config for routing tests. Only fields read by selectProvider
// matter: defaultProviderId, providers map. Everything else is filled with
// stable defaults so the shape compiles.
function makeConfig(opts: {
  defaultProviderId: string;
  providers: Record<string, ProviderRuntime | null>;
}): Config {
  return {
    host: "127.0.0.1",
    port: 0,
    baseUrl: "https://example.test/v1",
    apiKey: "sk-test",
    exposeReasoning: true,
    verbose: false,
    userAgent: "mimo2codex/test",
    defaultProviderId: opts.defaultProviderId as Config["defaultProviderId"],
    providers: opts.providers as Config["providers"],
    isTokenPlan: false,
    dataDir: "",
    adminEnabled: false,
  };
}

const fakeRuntime: ProviderRuntime = {
  apiKey: "sk-test",
  baseUrl: "https://example.test/v1",
  flags: {},
};

const companyMimoSpec = {
  id: "company-mimo",
  displayName: "Company MiMo Proxy",
  baseUrl: "https://internal.example/v1",
  envKey: "COMPANY_MIMO_API_KEY",
  defaultModel: "mimo-v2.5-pro",
  models: [{ id: "mimo-v2.5-pro", contextWindow: 128_000 }],
};

afterEach(() => {
  // Restore built-ins-only registry so each test starts from a clean slate.
  initRegistry([]);
});

describe("selectProvider routing priority (PR #6 regression)", () => {
  it("case A: generic with declared model + key wins over built-in mimo with key", () => {
    initRegistry([createGenericProvider(companyMimoSpec)]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      providers: { mimo: fakeRuntime, deepseek: null, "company-mimo": fakeRuntime },
    });
    const sel = selectProvider("mimo-v2.5-pro", cfg);
    expect(sel.provider.id).toBe("company-mimo");
    expect(sel.upstreamModel).toBe("mimo-v2.5-pro");
    expect(sel.rewriteNotice).toBeNull();
  });

  it("case B: generic claims model but has no key → falls through to built-in mimo", () => {
    initRegistry([createGenericProvider(companyMimoSpec)]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      providers: { mimo: fakeRuntime, deepseek: null, "company-mimo": null },
    });
    const sel = selectProvider("mimo-v2.5-pro", cfg);
    expect(sel.provider.id).toBe("mimo");
    expect(sel.upstreamModel).toBe("mimo-v2.5-pro");
    expect(sel.rewriteNotice).toBeNull();
  });

  it("case C: only generic has key; built-in mimo has no key → generic wins (PR #6's core fix)", () => {
    initRegistry([createGenericProvider(companyMimoSpec)]);
    // defaultProviderId stays as the generic itself so buildConfig wouldn't
    // throw; before PR #6 this case still routed via the broken fall-through.
    const cfg = makeConfig({
      defaultProviderId: "company-mimo",
      providers: { mimo: null, deepseek: null, "company-mimo": fakeRuntime },
    });
    const sel = selectProvider("mimo-v2.5-pro", cfg);
    expect(sel.provider.id).toBe("company-mimo");
    expect(sel.upstreamModel).toBe("mimo-v2.5-pro");
    expect(sel.rewriteNotice).toBeNull();
  });

  it("case D: open-catalog generic does NOT hijack a built-in model id", () => {
    // Generic without `models[]` accepts any model id via passthrough. It must
    // not be picked when the request maps to a built-in catalog id.
    initRegistry([
      createGenericProvider({
        id: "openrouter",
        displayName: "OpenRouter",
        baseUrl: "https://openrouter.example/v1",
        envKey: "OPENROUTER_API_KEY",
        defaultModel: "any",
      }),
    ]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      providers: { mimo: fakeRuntime, deepseek: null, openrouter: fakeRuntime },
    });
    const sel = selectProvider("mimo-v2.5-pro", cfg);
    expect(sel.provider.id).toBe("mimo");
    expect(sel.rewriteNotice).toBeNull();
  });

  it("case E: completely unknown model id falls back to default provider with rewriteNotice", () => {
    initRegistry([]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      providers: { mimo: fakeRuntime, deepseek: null },
    });
    const sel = selectProvider("gpt-99-turbo", cfg);
    expect(sel.provider.id).toBe("mimo");
    expect(sel.upstreamModel).toBe("mimo-v2.5-pro"); // mimo's defaultModel
    expect(sel.rewriteNotice).not.toBeNull();
    expect(sel.rewriteNotice?.from).toBe("gpt-99-turbo");
    expect(sel.rewriteNotice?.to).toBe("mimo-v2.5-pro");
  });

  it("case F: built-in catalog hit yields rewriteNotice === null", () => {
    initRegistry([]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      providers: { mimo: fakeRuntime, deepseek: fakeRuntime },
    });
    const sel = selectProvider("deepseek-v4-pro", cfg);
    expect(sel.provider.id).toBe("deepseek");
    expect(sel.upstreamModel).toBe("deepseek-v4-pro");
    expect(sel.rewriteNotice).toBeNull();
  });
});

describe("selectProvider runtime override (Pass 0)", () => {
  it("case G: valid override wins over normal routing", () => {
    initRegistry([]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      providers: { mimo: fakeRuntime, deepseek: fakeRuntime },
    });
    // Client asks for a mimo model, but override forces deepseek.
    const sel = selectProvider("mimo-v2.5-pro", cfg, {
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    });
    expect(sel.provider.id).toBe("deepseek");
    expect(sel.upstreamModel).toBe("deepseek-v4-pro");
    expect(sel.rewriteNotice).toBeNull();
  });

  it("case H: override pointing at unknown providerId is ignored (falls back to normal routing)", () => {
    initRegistry([]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      providers: { mimo: fakeRuntime, deepseek: null },
    });
    const sel = selectProvider("mimo-v2.5-pro", cfg, {
      providerId: "ghost-provider",
      modelId: "ghost-model",
    });
    // Falls through to Pass 2 (built-in mimo with key).
    expect(sel.provider.id).toBe("mimo");
    expect(sel.upstreamModel).toBe("mimo-v2.5-pro");
    expect(sel.rewriteNotice).toBeNull();
  });

  it("case I: override at a provider with no runtime is ignored", () => {
    initRegistry([]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      // deepseek registered but has no api key.
      providers: { mimo: fakeRuntime, deepseek: null },
    });
    const sel = selectProvider("mimo-v2.5-pro", cfg, {
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    });
    expect(sel.provider.id).toBe("mimo");
    expect(sel.rewriteNotice).toBeNull();
  });

  it("case J: override with unknown modelId still routes to that provider, sets rewriteNotice", () => {
    initRegistry([]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      providers: { mimo: fakeRuntime, deepseek: fakeRuntime },
    });
    const sel = selectProvider("mimo-v2.5-pro", cfg, {
      providerId: "deepseek",
      modelId: "deepseek-experimental-99",
    });
    expect(sel.provider.id).toBe("deepseek");
    // Unknown ids forwarded verbatim so the upstream can decide.
    expect(sel.upstreamModel).toBe("deepseek-experimental-99");
    expect(sel.rewriteNotice).not.toBeNull();
    expect(sel.rewriteNotice?.reason).toContain("runtime override");
  });

  it("case K: override=null preserves all existing behavior (no regression)", () => {
    initRegistry([createGenericProvider(companyMimoSpec)]);
    const cfg = makeConfig({
      defaultProviderId: "mimo",
      providers: { mimo: fakeRuntime, deepseek: null, "company-mimo": fakeRuntime },
    });
    const sel = selectProvider("mimo-v2.5-pro", cfg, null);
    // Same as case A.
    expect(sel.provider.id).toBe("company-mimo");
    expect(sel.upstreamModel).toBe("mimo-v2.5-pro");
    expect(sel.rewriteNotice).toBeNull();
  });
});
