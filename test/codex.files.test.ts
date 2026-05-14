import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

// The module under test calls os.homedir() to locate ~/.codex/, so we
// intercept it before each test and point it at a tmpdir. Imports happen
// inside the tests (via dynamic import) to honor the per-test homedir.

let fakeHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fakeHome = mkdtempSync(path.join(tmpdir(), "m2c-codex-test-"));
  homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  rmSync(fakeHome, { recursive: true, force: true });
});

async function loadModules() {
  // Fresh import each test so any module-level state stays clean.
  const files = await import("../src/codex/files.js");
  const paths = await import("../src/codex/paths.js");
  return { files, paths };
}

describe("codex/paths", () => {
  it("codexDir resolves to <home>/.codex", async () => {
    const { paths } = await loadModules();
    expect(paths.codexDir()).toBe(path.join(fakeHome, ".codex"));
  });

  it("assertInsideCodexDir accepts paths inside ~/.codex/", async () => {
    const { paths } = await loadModules();
    expect(() => paths.assertInsideCodexDir(path.join(fakeHome, ".codex", "auth.json"))).not.toThrow();
    expect(() => paths.assertInsideCodexDir(path.join(fakeHome, ".codex"))).not.toThrow();
  });

  it("assertInsideCodexDir rejects paths outside", async () => {
    const { paths } = await loadModules();
    expect(() => paths.assertInsideCodexDir(path.join(fakeHome, "elsewhere"))).toThrow(/outside/);
    expect(() =>
      paths.assertInsideCodexDir(path.join(fakeHome, ".codex", "..", "..", "etc", "passwd"))
    ).toThrow(/outside/);
  });
});

describe("codex/files", () => {
  it("atomicWrite creates parent directory and writes target", async () => {
    const { files, paths } = await loadModules();
    const target = path.join(paths.codexDir(), "auth.json");
    expect(existsSync(paths.codexDir())).toBe(false);
    files.atomicWrite(target, '{"x":1}');
    expect(readFileSync(target, "utf-8")).toBe('{"x":1}');
  });

  it("atomicWrite leaves no tmp files behind on success", async () => {
    const { files, paths } = await loadModules();
    const target = path.join(paths.codexDir(), "auth.json");
    files.atomicWrite(target, "hello");
    const { readdirSync } = await import("node:fs");
    const siblings = readdirSync(paths.codexDir());
    expect(siblings.filter((n) => n.includes(".tmp."))).toHaveLength(0);
  });

  it("atomicWrite refuses paths outside ~/.codex/", async () => {
    const { files } = await loadModules();
    expect(() => files.atomicWrite(path.join(fakeHome, "evil.txt"), "x")).toThrow(/outside/);
  });

  it("backupFile returns null when source does not exist", async () => {
    const { files, paths } = await loadModules();
    const target = path.join(paths.codexDir(), "auth.json");
    expect(files.backupFile(target, 123)).toBeNull();
  });

  it("backupFile produces <file>.bak.<ts>.<pid>", async () => {
    const { files, paths } = await loadModules();
    const target = path.join(paths.codexDir(), "auth.json");
    files.atomicWrite(target, "original");
    const backup = files.backupFile(target, 999);
    expect(backup).not.toBeNull();
    expect(backup!).toMatch(/auth\.json\.bak\.999\.\d+$/);
    expect(readFileSync(backup!, "utf-8")).toBe("original");
  });

  it("listBackups returns entries sorted descending by ts", async () => {
    const { files, paths } = await loadModules();
    const target = path.join(paths.codexDir(), "auth.json");
    files.atomicWrite(target, "v1");
    files.backupFile(target, 100);
    files.backupFile(target, 300);
    files.backupFile(target, 200);
    const list = files.listBackups(target);
    expect(list.map((e) => e.ts)).toEqual([300, 200, 100]);
  });

  it("pruneBackups keeps the most recent N, drops the rest, never deletes the latest", async () => {
    const { files, paths } = await loadModules();
    const target = path.join(paths.codexDir(), "auth.json");
    files.atomicWrite(target, "v1");
    for (let i = 1; i <= 12; i++) files.backupFile(target, i);
    files.pruneBackups(target, 10);
    const remaining = files.listBackups(target);
    expect(remaining).toHaveLength(10);
    // Newest (12) preserved, oldest two (1, 2) gone.
    expect(remaining[0].ts).toBe(12);
    expect(remaining.map((e) => e.ts)).not.toContain(1);
    expect(remaining.map((e) => e.ts)).not.toContain(2);
  });

  it("detectAuthJsonOwner: missing → 'missing'", async () => {
    const { files } = await loadModules();
    expect(files.detectAuthJsonOwner()).toBe("missing");
  });

  it("detectAuthJsonOwner: mimo2codex-local sentinel → 'mimo2codex'", async () => {
    const { files, paths } = await loadModules();
    const target = path.join(paths.codexDir(), "auth.json");
    files.atomicWrite(target, JSON.stringify({ OPENAI_API_KEY: "mimo2codex-local" }));
    expect(files.detectAuthJsonOwner()).toBe("mimo2codex");
  });

  it("detectAuthJsonOwner: foreign key → 'external'", async () => {
    const { files, paths } = await loadModules();
    const target = path.join(paths.codexDir(), "auth.json");
    files.atomicWrite(target, JSON.stringify({ OPENAI_API_KEY: "sk-real-openai-key" }));
    expect(files.detectAuthJsonOwner()).toBe("external");
  });

  it("detectAuthJsonOwner: malformed JSON → 'external' (safe default)", async () => {
    const { paths } = await loadModules();
    // Write directly with fs (atomicWrite enforces JSON-validity-free contract anyway).
    const { mkdirSync } = await import("node:fs");
    mkdirSync(paths.codexDir(), { recursive: true });
    writeFileSync(path.join(paths.codexDir(), "auth.json"), "{not json");
    const { files } = await loadModules();
    expect(files.detectAuthJsonOwner()).toBe("external");
  });
});
