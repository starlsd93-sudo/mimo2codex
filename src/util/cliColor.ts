// Terminal color capability detection + RGB→SGR encoding.
//
// Three tiers are surfaced. Sticking to truecolor unconditionally breaks
// Apple Terminal.app (macOS's default), which silently mis-parses
// `\x1b[38;2;R;G;Bm` as a sequence of separate SGR codes and renders
// garbled red/magenta/cyan blocks instead of the gradient.
//
//   3 → truecolor   (`\x1b[38;2;R;G;Bm`)        ← iTerm2 / VS Code / WT / Alacritty / GNOME Term / Konsole
//   2 → 256-color   (`\x1b[38;5;Nm`, 6×6×6 cube) ← Apple Terminal + everything else with TTY
//   0 → no color    (plain text)                ← pipes, CI, NO_COLOR
//
// FORCE_COLOR / NO_COLOR follow the de-facto chalk-style convention:
// https://github.com/chalk/supports-color

export type ColorLevel = 0 | 2 | 3;

export function detectColorLevel(): ColorLevel {
  if (process.env.NO_COLOR) return 0;
  const fc = process.env.FORCE_COLOR;
  if (fc !== undefined) {
    if (fc === "0" || fc === "false") return 0;
    if (fc === "3") return 3;
    if (fc === "2") return 2;
    // FORCE_COLOR=1 conventionally means "basic 16 colors"; we don't ship a
    // 16-color path (modern terminals all do 256+), so degrade upward to 2.
    if (fc === "1" || fc === "true") return 2;
    return 3; // any other truthy value → assume truecolor (user knows best)
  }
  if (!process.stdout.isTTY) return 0;
  // The de-facto truecolor signal; set by most modern terminals.
  const ct = (process.env.COLORTERM ?? "").toLowerCase();
  if (ct === "truecolor" || ct === "24bit") return 3;
  // Known truecolor terminals that occasionally fail to set COLORTERM
  // (e.g. older iTerm2 builds, Hyper before 3.x).
  const tp = process.env.TERM_PROGRAM;
  if (
    tp === "iTerm.app" ||
    tp === "vscode" ||
    tp === "Hyper" ||
    tp === "WezTerm" ||
    tp === "ghostty"
  ) {
    return 3;
  }
  if (process.env.WT_SESSION) return 3; // Windows Terminal
  if (process.env.TERMINUS_SUBLIME) return 3;
  // Apple_Terminal explicitly: NO truecolor, but reliable 256-color.
  // Anything else with a TTY also gets 256-color as the safe baseline —
  // it's been universally supported in xterm-class terminals since ~2010.
  return 2;
}

// Encode an RGB triple as a foreground SGR string for the given level.
// Returns "" for level 0 so callers can blindly concatenate without an
// `if (color)` guard everywhere.
export function fg(r: number, g: number, b: number, level: ColorLevel): string {
  if (level === 0) return "";
  if (level === 3) return `\x1b[38;2;${r};${g};${b}m`;
  // 256-color quantization to the 6×6×6 RGB cube (indices 16..231).
  // Each channel maps to [0..5]; rounding biases toward the nearest cube
  // step. Quality is fine for gradients — adjacent cells in the cube are
  // visually distinguishable.
  const r6 = Math.round((r / 255) * 5);
  const g6 = Math.round((g / 255) * 5);
  const b6 = Math.round((b / 255) * 5);
  return `\x1b[38;5;${16 + 36 * r6 + 6 * g6 + b6}m`;
}

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
