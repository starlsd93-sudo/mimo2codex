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

beforeEach(() => {
  fakeHome = mkdtempSync(path.join(tmpdir(), "m2c-codex-state-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
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

  it("prunes to BACKUP_KEEP=10 after 11 successive applies", async () => {
    const { state, snippets, paths } = await loadModules();
    // Seed an existing pair so the first apply has something to back up.
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(path.join(paths.codexDir(), "auth.json"), "{}");
    writeFileSync(path.join(paths.codexDir(), "config.toml"), "x");
    for (let i = 0; i < 11; i++) {
      state.applyCodex(snippets.resolveSnippetTarget("mimo"), host);
      // Force Date.now() apart by 2ms so backups don't collide.
      await new Promise((r) => setTimeout(r, 2));
    }
    const pairs = state.listBackupPairs();
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

  it("rejects incomplete pair (only auth backup exists)", async () => {
    const { state, paths } = await loadModules();
    mkdirSync(paths.codexDir(), { recursive: true });
    // Hand-craft a half-pair: backup only the auth.json side.
    writeFileSync(
      path.join(paths.codexDir(), "auth.json.bak.4242.999"),
      JSON.stringify({ OPENAI_API_KEY: "sk-half" })
    );
    expect(() => state.restoreCodex(4242)).toThrow(/incomplete/);
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
