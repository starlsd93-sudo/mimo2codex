import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const DEFAULT_DIR_NAME = ".mimo2codex";

// Resolve the data directory for sqlite + future config files. Priority:
//   1. explicit cliOverride (--data-dir)
//   2. MIMO2CODEX_DATA_DIR env var
//   3. ~/.mimo2codex
export function resolveDataDir(
  cliOverride: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): string {
  const dir = cliOverride ?? env.MIMO2CODEX_DATA_DIR ?? join(homedir(), DEFAULT_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}
