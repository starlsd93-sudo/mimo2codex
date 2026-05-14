import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { assertInsideCodexDir, authJsonPath, codexDir } from "./paths.js";

// Write `contents` to `filePath` atomically: write to a sibling temp file
// then renameSync over the target. renameSync is atomic on POSIX and on
// Windows for files on the same volume — which is always the case here
// since temp + target share a parent dir.
export function atomicWrite(filePath: string, contents: string): void {
  assertInsideCodexDir(filePath);
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`
  );
  writeFileSync(tmp, contents, "utf-8");
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup if rename fails (e.g. Codex has the file open).
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// Copy `filePath` to `<filePath>.bak.<ts>` (`.<pid>` suffix avoids collisions
// when two apply requests share a Date.now() millisecond). Returns the
// backup path, or null if the source file does not exist.
export function backupFile(filePath: string, ts: number): string | null {
  assertInsideCodexDir(filePath);
  if (!existsSync(filePath)) return null;
  const backup = `${filePath}.bak.${ts}.${process.pid}`;
  copyFileSync(filePath, backup);
  return backup;
}

export interface BackupEntry {
  path: string;
  ts: number;
}

// Enumerate all `<basename>.bak.<ts>[.<pid>]` siblings of `filePath`.
// Sorted by ts descending so callers can treat index 0 as "most recent".
export function listBackups(filePath: string): BackupEntry[] {
  assertInsideCodexDir(filePath);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) return [];
  const base = path.basename(filePath);
  const prefix = `${base}.bak.`;
  const entries: BackupEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    // rest is "<ts>" or "<ts>.<pid>"; parse the leading integer.
    const m = /^(\d+)/.exec(rest);
    if (!m) continue;
    entries.push({ path: path.join(dir, name), ts: Number(m[1]) });
  }
  entries.sort((a, b) => b.ts - a.ts);
  return entries;
}

// Keep the `keep` newest backups; delete the rest. Safe to call right after
// generating a new backup — the just-created one sorts first by ts so it
// can never be pruned.
export function pruneBackups(filePath: string, keep = 10): void {
  const all = listBackups(filePath);
  for (const entry of all.slice(keep)) {
    try {
      rmSync(entry.path, { force: true });
    } catch {
      /* best-effort; missing or locked files shouldn't block apply */
    }
  }
}

export type AuthJsonOwner = "mimo2codex" | "external" | "missing";

// Detect whether ~/.codex/auth.json was last written by us. We stamp a
// sentinel value ("mimo2codex-local") in OPENAI_API_KEY at apply time;
// anything else (real OpenAI key, malformed JSON, …) is treated as foreign
// and triggers the UI's overwrite confirmation.
export function detectAuthJsonOwner(): AuthJsonOwner {
  const p = authJsonPath();
  if (!existsSync(p)) return "missing";
  try {
    const text = readFileSync(p, "utf-8");
    const json = JSON.parse(text) as { OPENAI_API_KEY?: unknown };
    if (json && json.OPENAI_API_KEY === "mimo2codex-local") return "mimo2codex";
    return "external";
  } catch {
    return "external";
  }
}

// Read raw config.toml content if present. Returned as-is for the UI to
// surface to the user; we don't parse TOML server-side because Codex's
// config schema is wide and we only need a best-effort current-model hint.
export function readConfigTomlIfExists(): string | null {
  const p = path.join(codexDir(), "config.toml");
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}
