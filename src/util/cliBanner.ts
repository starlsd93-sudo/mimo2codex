// Banner + snippet formatters for the startup splash. Two concerns:
//
//   1. `printBoxedBanner` wraps the runtime status lines (version, provider,
//      upstream, …) in a rounded box. Width is computed from the longest
//      content line so the right border always aligns.
//
//   2. `colorizeSnippet` paints the `~/.codex/{auth.json,config.toml}` text
//      block in a high-attention yellow (TOML / JSON body) with dim comments,
//      so the user's eye lands on the part they're supposed to copy.
//
// Both helpers degrade to plain text when stdout isn't a TTY (and FORCE_COLOR
// isn't set), so scripted captures stay clean.

import { detectColorLevel, fg, RESET, DIM } from "./cliColor.js";

// Encoded lazily per call so we pick the right escape format (truecolor vs
// 256-color cube) on every render. Light overhead, avoids stale state if
// the env / TTY status changes between calls.
function borderCode(): string {
  // #7890 9C — muted slate, doesn't compete with the box contents.
  return fg(0x78, 0x90, 0x9c, detectColorLevel());
}

function codeCode(): string {
  // #FFD60A — striking yellow; pairs with the deep-ocean logo gradient.
  return fg(0xff, 0xd6, 0x0a, detectColorLevel());
}

// Display-width of a string. Banner content is ASCII + box-drawing chars + a
// few CJK glyphs in localized warning messages — all 1-cell or 2-cell. For
// simplicity we treat everything as 1-cell here; CJK in the host-mismatch
// warning may push the right edge out slightly but stays readable.
function visibleWidth(s: string): number {
  // strip ANSI escapes first in case callers pre-color a line
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  return [...stripped].length;
}

export function printBoxedBanner(lines: string[]): void {
  const level = detectColorLevel();
  const innerWidth = Math.max(...lines.map(visibleWidth));
  const horiz = "─".repeat(innerWidth + 2);
  const border = borderCode();
  const wrap = (chunk: string): string =>
    level > 0 ? `${border}${chunk}${RESET}` : chunk;
  process.stdout.write(wrap(`╭${horiz}╮`) + "\n");
  for (const line of lines) {
    const pad = " ".repeat(innerWidth - visibleWidth(line));
    process.stdout.write(`${wrap("│")} ${line}${pad} ${wrap("│")}\n`);
  }
  process.stdout.write(wrap(`╰${horiz}╯`) + "\n");
}

export function colorizeSnippet(text: string): string {
  const level = detectColorLevel();
  if (level === 0) return text;
  const code = codeCode();
  return text
    .split("\n")
    .map((line) => {
      if (line.length === 0) return line;
      const trimmed = line.trimStart();
      // TOML uses `#` comments, JSON has none — but the printed snippets use
      // `#` lines as section headers ("# Step 1 — write …"). Dim those so
      // the eye locks onto the code rows.
      if (trimmed.startsWith("#")) {
        return `${DIM}${line}${RESET}`;
      }
      return `${code}${line}${RESET}`;
    })
    .join("\n");
}
