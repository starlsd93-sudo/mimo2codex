import os from "node:os";
import path from "node:path";
import { getSetting } from "../db/settings.js";

// Resolution order (highest priority first):
//   1. settings.codex.dir — admin UI override, survives restarts
//   2. CODEX_HOME env var  — matches the Codex CLI's own convention
//   3. ~/.codex            — platform default (os.homedir() returns
//                            %USERPROFILE% on Windows)
//
// Kept as a function (not a top-level constant) so:
//   - tests can stub os.homedir() via vi.spyOn before importing consumers
//   - the admin UI can change the override at runtime without restarting
export function codexDir(): string {
  try {
    const override = getSetting("codex.dir");
    if (override && override.trim()) {
      return path.resolve(override.trim());
    }
  } catch {
    // DB not opened — happens in tests that don't seed sqlite and during
    // very early CLI bootstrap. Both cases legitimately want the default.
  }
  const envOverride = process.env.CODEX_HOME;
  if (envOverride && envOverride.trim()) {
    return path.resolve(envOverride.trim());
  }
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
