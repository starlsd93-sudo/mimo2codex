import { existsSync, readFileSync } from "node:fs";
import {
  atomicWrite,
  backupFile,
  detectAuthJsonOwner,
  listBackups,
  pruneBackups,
  readConfigTomlIfExists,
  type AuthJsonOwner,
  type BackupEntry,
} from "./files.js";
import { authJsonPath, codexDir, configTomlPath } from "./paths.js";
import { buildCcSwitchFiles, type HostPort, type SnippetTarget } from "../setup/snippets.js";

const BACKUP_KEEP = 10;

export interface ApplyResult {
  backupTs: number;
  authBackup: string | null;
  tomlBackup: string | null;
  authJsonOwnerBefore: AuthJsonOwner;
}

// Write ~/.codex/auth.json and ~/.codex/config.toml for the requested
// (provider, model) pair, after first backing up whatever was there. Both
// backups share the same `ts` suffix so restoreCodex can pair them.
//
// Atomicity note: each individual file is written atomically (tmp + rename),
// but the *pair* is not transactional — if the auth.json write succeeds and
// the config.toml write fails, the user is left with our auth.json over
// their old config.toml. The owner detection + paired backup design means
// restore is always available; we do not attempt a rollback because that
// would just multiply failure modes.
export function applyCodex(target: SnippetTarget, hostPort: HostPort): ApplyResult {
  const ts = Date.now();
  const ownerBefore = detectAuthJsonOwner();
  const authBackup = backupFile(authJsonPath(), ts);
  const tomlBackup = backupFile(configTomlPath(), ts);

  const { authJson, configToml } = buildCcSwitchFiles(hostPort, target);
  atomicWrite(authJsonPath(), authJson);
  atomicWrite(configTomlPath(), configToml);

  pruneBackups(authJsonPath(), BACKUP_KEEP);
  pruneBackups(configTomlPath(), BACKUP_KEEP);

  return {
    backupTs: ts,
    authBackup,
    tomlBackup,
    authJsonOwnerBefore: ownerBefore,
  };
}

export interface BackupPair {
  ts: number;
  authBackup: string | null;
  tomlBackup: string | null;
}

// Pair backups by timestamp prefix. We treat a pair as complete only when
// *both* halves exist for the same ts; restoreCodex refuses to act on a
// half-pair to avoid leaving auth.json+config.toml in an inconsistent state
// (e.g. requires_openai_auth = true with a foreign OPENAI_API_KEY).
export function listBackupPairs(): BackupPair[] {
  const auth = listBackups(authJsonPath());
  const toml = listBackups(configTomlPath());
  const byTs = new Map<number, BackupPair>();
  for (const a of auth) {
    const existing = byTs.get(a.ts) ?? { ts: a.ts, authBackup: null, tomlBackup: null };
    existing.authBackup = a.path;
    byTs.set(a.ts, existing);
  }
  for (const t of toml) {
    const existing = byTs.get(t.ts) ?? { ts: t.ts, authBackup: null, tomlBackup: null };
    existing.tomlBackup = t.path;
    byTs.set(t.ts, existing);
  }
  return Array.from(byTs.values()).sort((a, b) => b.ts - a.ts);
}

export function restoreCodex(ts: number): void {
  const pair = listBackupPairs().find((p) => p.ts === ts);
  if (!pair) {
    throw new Error(`no backup pair with ts=${ts}`);
  }
  // Paired-backup invariant: refuse half-pairs. The two files together
  // form a Codex profile; restoring only one half can leave a hybrid
  // (requires_openai_auth = true with someone else's OPENAI_API_KEY).
  if (!pair.authBackup || !pair.tomlBackup) {
    throw new Error(
      `backup pair at ts=${ts} is incomplete (auth=${!!pair.authBackup}, toml=${!!pair.tomlBackup}); refusing to restore`
    );
  }
  // Read backups and write through atomicWrite to keep the
  // assertInsideCodexDir guard + tmp/rename behavior.
  const authBytes = readFileSync(pair.authBackup, "utf-8");
  const tomlBytes = readFileSync(pair.tomlBackup, "utf-8");
  atomicWrite(authJsonPath(), authBytes);
  atomicWrite(configTomlPath(), tomlBytes);
}

export interface CodexState {
  codexDir: string;
  authPath: string;
  tomlPath: string;
  authJsonOwner: AuthJsonOwner;
  authJsonExists: boolean;
  configTomlExists: boolean;
  // Raw config.toml content (best-effort UI display; we don't parse TOML
  // server-side because Codex's schema is broad).
  configTomlText: string | null;
  backups: BackupPair[];
}

export function readCodexState(): CodexState {
  const auth = authJsonPath();
  const toml = configTomlPath();
  return {
    codexDir: codexDir(),
    authPath: auth,
    tomlPath: toml,
    authJsonOwner: detectAuthJsonOwner(),
    authJsonExists: existsSync(auth),
    configTomlExists: existsSync(toml),
    configTomlText: readConfigTomlIfExists(),
    backups: listBackupPairs(),
  };
}

// Re-exported for routes that only want a count without the full state read.
export { listBackups, type BackupEntry, type AuthJsonOwner };
