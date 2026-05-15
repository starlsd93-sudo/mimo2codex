import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

let fakeHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
let originalCodexHome: string | undefined;

beforeEach(() => {
  fakeHome = mkdtempSync(path.join(tmpdir(), "m2c-codex-state-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
  originalCodexHome = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
});

afterEach(() => {
  homedirSpy.mockRestore();
  if (originalCodexHome !== undefined) process.env.CODEX_HOME = originalCodexHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

async function loadModules() {
  const state = await import("../src/codex/state.js");
  const snippets = await import("../src/setup/snippets.js");
  const paths = await import("../src/codex/paths.js");
  return { state, snippets, paths };
}

const host = { host: "127.0.0.1", port: 8788 };

describe("codex/state — applyCodex", () => {
  it("creates ~/.codex/ + writes auth.json and config.toml on a fresh machine", async () => {
    const { state, snippets, paths } = await loadModules();
    const target = snippets.resolveSnippetTarget("mimo");
    const result = state.applyCodex(target, host);
    expect(existsSync(paths.codexDir())).toBe(true);
    expect(existsSync(path.join(paths.codexDir(), "auth.json"))).toBe(true);
    expect(existsSync(path.join(paths.codexDir(), "config.toml"))).toBe(true);
    expect(result.authBackup).toBeNull();
    expect(result.tomlBackup).toBeNull();
    expect(result.authJsonOwnerBefore).toBe("missing");

    // Content sanity-check.
    const auth = JSON.parse(readFileSync(path.join(paths.codexDir(), "auth.json"), "utf-8"));
    expect(auth.OPENAI_API_KEY).toBe("mimo2codex-local");
    const toml = readFileSync(path.join(paths.codexDir(), "config.toml"), "utf-8");
    expect(toml).toContain('model = "mimo-v2.5-pro"');
    expect(toml).toContain('base_url = "http://127.0.0.1:8788/v1"');
  });

  it("backs up existing auth.json + config.toml with the SAME ts (paired pair)", async () => {
    const { state, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(
      path.join(paths.codexDir(), "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "sk-real-openai" })
    );
    writeFileSync(path.join(paths.codexDir(), "config.toml"), "previous content");

    const result = state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
    expect(result.authBackup).not.toBeNull();
    expect(result.tomlBackup).not.toBeNull();
    expect(result.authJsonOwnerBefore).toBe("external");
    // Both backups must encode the same timestamp prefix so restore can pair.
    const authTs = /\.bak\.(\d+)\./.exec(result.authBackup!)![1];
    const tomlTs = /\.bak\.(\d+)\./.exec(result.tomlBackup!)![1];
    expect(authTs).toBe(tomlTs);
    expect(Number(authTs)).toBe(result.backupTs);

    // The backed-up auth.json still has the real key.
    const backedUpAuth = JSON.parse(readFileSync(result.authBackup!, "utf-8"));
    expect(backedUpAuth.OPENAI_API_KEY).toBe("sk-real-openai");
  });

  it("prunes regular (non-preserved) backups to BACKUP_KEEP=10 after 11 successive applies", async () => {
    const { state, snippets, paths } = await loadModules();
    // Seed an auth.json that looks like one of OURS so the first apply
    // produces a REGULAR (non-preserved) backup. Preserved backups are
    // tested separately — here we want to assert the prune behavior on
    // ordinary snapshots.
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(
      path.join(paths.codexDir(), "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "mimo2codex-local" })
    );
    writeFileSync(path.join(paths.codexDir(), "config.toml"), "x");
    for (let i = 0; i < 11; i++) {
      state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
      await new Promise((r) => setTimeout(r, 2));
    }
    const pairs = state.listBackupPairs();
    expect(pairs.every((p) => !p.preserved)).toBe(true);
    expect(pairs.length).toBeLessThanOrEqual(10);
  });
});

describe("codex/state — restoreCodex", () => {
  it("round-trips a real OpenAI auth.json + custom config.toml", async () => {
    const { state, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    const originalAuth = JSON.stringify({ OPENAI_API_KEY: "sk-real-openai" }, null, 2);
    const originalToml = '# my real config\nmodel = "gpt-5"\n';
    writeFileSync(path.join(paths.codexDir(), "auth.json"), originalAuth);
    writeFileSync(path.join(paths.codexDir(), "config.toml"), originalToml);

    const apply = state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
    // Sanity: apply overwrote the originals.
    expect(JSON.parse(readFileSync(path.join(paths.codexDir(), "auth.json"), "utf-8")).OPENAI_API_KEY).toBe(
      "mimo2codex-local"
    );

    state.restoreCodex(apply.backupTs);
    expect(readFileSync(path.join(paths.codexDir(), "auth.json"), "utf-8")).toBe(originalAuth);
    expect(readFileSync(path.join(paths.codexDir(), "config.toml"), "utf-8")).toBe(originalToml);
  });

  it("rejects unknown ts", async () => {
    const { state } = await loadModules();
    expect(() => state.restoreCodex(99999)).toThrow(/no backup pair/);
  });

  it("half-pair restore: missing toml backup means current toml gets DELETED (return-to-prior semantics)", async () => {
    const { state, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    // Pre-state: only auth.json exists (user had real OpenAI, never customized config.toml).
    const originalAuth = JSON.stringify({ OPENAI_API_KEY: "sk-real" }, null, 2);
    writeFileSync(path.join(paths.codexDir(), "auth.json"), originalAuth);

    const { resolveSnippetTarget } = await import("../src/setup/snippets.js");
    const apply = state.applyCodex(resolveSnippetTarget("mimo"), host);
    expect(apply.authBackup).not.toBeNull();
    expect(apply.tomlBackup).toBeNull(); // toml didn't exist pre-apply
    // After apply, both files exist (we wrote them).
    expect(existsSync(path.join(paths.codexDir(), "auth.json"))).toBe(true);
    expect(existsSync(path.join(paths.codexDir(), "config.toml"))).toBe(true);

    state.restoreCodex(apply.backupTs);
    // auth.json restored to original.
    expect(readFileSync(path.join(paths.codexDir(), "auth.json"), "utf-8")).toBe(originalAuth);
    // config.toml didn't exist before → it must NOT exist after restore.
    expect(existsSync(path.join(paths.codexDir(), "config.toml"))).toBe(false);
  });
});

describe("codex/state — preserve on external overwrite", () => {
  it("first apply on external auth.json produces a preserved backup; subsequent applies are regular", async () => {
    const { state, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(
      path.join(paths.codexDir(), "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "sk-real-openai" })
    );
    writeFileSync(path.join(paths.codexDir(), "config.toml"), "model = \"gpt-5\"\n");

    const a1 = state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
    expect(a1.preserved).toBe(true);
    expect(a1.authBackup).toMatch(/\.preserve$/);
    expect(a1.tomlBackup).toMatch(/\.preserve$/);

    await new Promise((r) => setTimeout(r, 2));
    const a2 = state.applyCodex(snippets.resolveSnippetTarget("ds"), host);
    expect(a2.preserved).toBe(false);
    expect(a2.authBackup).not.toMatch(/\.preserve$/);

    const pairs = state.listBackupPairs();
    expect(pairs.find((p) => p.ts === a1.backupTs)?.preserved).toBe(true);
    expect(pairs.find((p) => p.ts === a2.backupTs)?.preserved).toBe(false);
  });

  it("preserved backup survives 15 subsequent applies (default keep=10)", async () => {
    const { state, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(
      path.join(paths.codexDir(), "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "sk-real-openai" })
    );
    writeFileSync(path.join(paths.codexDir(), "config.toml"), "model = \"gpt-5\"\n");

    const first = state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
    expect(first.preserved).toBe(true);
    for (let i = 0; i < 15; i++) {
      state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
      await new Promise((r) => setTimeout(r, 2));
    }
    const pairs = state.listBackupPairs();
    // The preserved one is still there.
    const preserved = pairs.find((p) => p.ts === first.backupTs);
    expect(preserved).toBeDefined();
    expect(preserved!.preserved).toBe(true);
    // The total cap of unpreserved is 10 (auth + toml each capped to 10, paired).
    const unpreservedCount = pairs.filter((p) => !p.preserved).length;
    expect(unpreservedCount).toBeLessThanOrEqual(10);
  });

  it("listBackupPairs surfaces sniffed model/provider from the toml backup", async () => {
    const { state, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(
      path.join(paths.codexDir(), "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "sk-real" })
    );
    writeFileSync(
      path.join(paths.codexDir(), "config.toml"),
      'model = "gpt-5"\nmodel_provider = "openai"\n'
    );
    state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
    const pairs = state.listBackupPairs();
    expect(pairs[0].model).toBe("gpt-5");
    expect(pairs[0].provider).toBe("openai");
    expect(pairs[0].authBackupOwner).toBe("external");
  });
});

describe("codex/state — deleteBackupPair", () => {
  it("removes a regular backup pair (both halves) without force", async () => {
    const { state, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(path.join(paths.codexDir(), "auth.json"), '{"OPENAI_API_KEY":"mimo2codex-local"}');
    writeFileSync(path.join(paths.codexDir(), "config.toml"), "x");
    const a = state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
    expect(state.listBackupPairs().some((p) => p.ts === a.backupTs)).toBe(true);
    const removed = state.deleteBackupPair(a.backupTs);
    expect(removed).toBe(2);
    expect(state.listBackupPairs().some((p) => p.ts === a.backupTs)).toBe(false);
  });

  it("refuses to delete preserved pair without force=true", async () => {
    const { state, snippets, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(path.join(paths.codexDir(), "auth.json"), '{"OPENAI_API_KEY":"sk-real"}');
    writeFileSync(path.join(paths.codexDir(), "config.toml"), "x");
    const a = state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
    expect(() => state.deleteBackupPair(a.backupTs)).toThrow(/preserved/);
    // With force=true it succeeds.
    expect(state.deleteBackupPair(a.backupTs, { force: true })).toBe(2);
  });

  it("throws on unknown ts", async () => {
    const { state } = await loadModules();
    expect(() => state.deleteBackupPair(99999)).toThrow(/no backup pair/);
  });
});

describe("codex/state — readCodexState", () => {
  it("returns 'missing' on a fresh machine", async () => {
    const { state } = await loadModules();
    const s = state.readCodexState();
    expect(s.authJsonOwner).toBe("missing");
    expect(s.authJsonExists).toBe(false);
    expect(s.configTomlExists).toBe(false);
    expect(s.backups).toEqual([]);
  });

  it("reflects an active mimo2codex install + lists paired backups", async () => {
    const { state, snippets } = await loadModules();
    state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
    await new Promise((r) => setTimeout(r, 2));
    state.applyCodex(snippets.resolveSnippetTarget("ds"), host);
    const s = state.readCodexState();
    expect(s.authJsonOwner).toBe("mimo2codex");
    expect(s.authJsonExists).toBe(true);
    expect(s.configTomlExists).toBe(true);
    // One paired backup (from the second apply, backing up the first's files).
    const complete = s.backups.filter((b) => b.authBackup && b.tomlBackup);
    expect(complete.length).toBeGreaterThanOrEqual(1);
  });
});
