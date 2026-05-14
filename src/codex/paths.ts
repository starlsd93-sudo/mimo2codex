import os from "node:os";
import path from "node:path";

// All Codex config lives under ~/.codex on every platform — on Windows
// os.homedir() returns %USERPROFILE%, so this single helper handles both.
// Kept as a function (not a top-level constant) so tests can stub
// os.homedir() via vi.spyOn before importing the consumers.
export function codexDir(): string {
  return path.join(os.homedir(), ".codex");
}

export function authJsonPath(): string {
  return path.join(codexDir(), "auth.json");
}

export function configTomlPath(): string {
  return path.join(codexDir(), "config.toml");
}

// Refuse any file operation that resolves outside ~/.codex/. Defense-in-depth
// against malformed timestamps in restore-backup endpoints. Server runs as
// the same user that owns ~/.codex/, so this is robustness, not adversarial
// hardening.
export function assertInsideCodexDir(p: string): void {
  const resolved = path.resolve(p);
  const root = path.resolve(codexDir());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`refusing to operate outside ~/.codex/: ${resolved}`);
  }
}
