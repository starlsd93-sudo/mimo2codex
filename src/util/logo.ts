// Startup splash. ANSI Shadow figlet rendering of "MIMO2CODEX" — solid
// block characters (filled with █) instead of the thin hollow strokes of
// the standard font, then painted with a left-to-right truecolor gradient.
//
// Width: ~83 columns. Most modern terminals are 100+ cols wide; users on
// strict 80-col terminals may see one wrap, still readable.
// Rows: 6.
const LOGO_LINES: readonly string[] = [
  "███╗   ███╗██╗███╗   ███╗ ██████╗ ██████╗  ██████╗  ██████╗ ██████╗ ███████╗██╗  ██╗",
  "████╗ ████║██║████╗ ████║██╔═══██╗╚════██╗██╔════╝ ██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝",
  "██╔████╔██║██║██╔████╔██║██║   ██║ █████╔╝██║      ██║   ██║██║  ██║█████╗   ╚███╔╝ ",
  "██║╚██╔╝██║██║██║╚██╔╝██║██║   ██║██╔═══╝ ██║      ██║   ██║██║  ██║██╔══╝   ██╔██╗ ",
  "██║ ╚═╝ ██║██║██║ ╚═╝ ██║╚██████╔╝███████╗╚██████╗ ╚██████╔╝██████╔╝███████╗██╔╝ ██╗",
  "╚═╝     ╚═╝╚═╝╚═╝     ╚═╝ ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝",
];

const REPO_URL = "https://github.com/7as0nch/mimo2codex";
const ISSUES_URL = `${REPO_URL}/issues`;
const TAGLINE = "Local proxy · Codex Responses API ↔ Chat Completions (MiMo / DeepSeek / generic)";

import { detectColorLevel, fg, RESET, BOLD, DIM, type ColorLevel } from "./cliColor.js";

// Three-stop horizontal gradient. "Deep ocean" — bright surface cyan
// fading through a mid-blue into near-black abyssal blue. Conveys depth
// and seriousness; contrasts with the bright-yellow config snippet below.
const GRAD_START = { r: 0x00, g: 0xb4, b: 0xd8 }; // #00B4D8
const GRAD_MID = { r: 0x00, g: 0x77, b: 0xb6 }; //   #0077B6
const GRAD_END = { r: 0x03, g: 0x04, b: 0x5e }; //   #03045E

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function gradientAt(t: number): { r: number; g: number; b: number } {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  if (clamped <= 0.5) {
    const t2 = clamped * 2;
    return {
      r: lerp(GRAD_START.r, GRAD_MID.r, t2),
      g: lerp(GRAD_START.g, GRAD_MID.g, t2),
      b: lerp(GRAD_START.b, GRAD_MID.b, t2),
    };
  }
  const t2 = (clamped - 0.5) * 2;
  return {
    r: lerp(GRAD_MID.r, GRAD_END.r, t2),
    g: lerp(GRAD_MID.g, GRAD_END.g, t2),
    b: lerp(GRAD_MID.b, GRAD_END.b, t2),
  };
}

// Paint one line of the logo with the column-indexed gradient. Spaces are
// skipped (they carry no foreground color). Repeated identical SGRs are
// coalesced. The encoder picks truecolor or 256-color cube based on
// terminal capability — critical on Apple Terminal.app which silently
// mis-parses truecolor escapes into the legacy palette.
function colorLine(line: string, totalCols: number, level: ColorLevel): string {
  if (level === 0) return line;
  const chars = [...line];
  let out = "";
  let lastCode = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === " ") {
      out += ch;
      continue;
    }
    const t = totalCols > 1 ? i / (totalCols - 1) : 0;
    const { r, g, b } = gradientAt(t);
    const code = fg(r, g, b, level);
    if (code !== lastCode) {
      out += code;
      lastCode = code;
    }
    out += ch;
  }
  return out + RESET;
}

export function printLogo(version: string): void {
  // Logo is purely cosmetic — skip when stdout isn't a TTY (scripted
  // captures stay clean), unless the user explicitly forced color output
  // (FORCE_COLOR is the conventional "I want decoration even in pipes"
  // escape hatch).
  if (!process.stdout.isTTY && !process.env.FORCE_COLOR) return;
  const level = detectColorLevel();
  const wrap = (code: string, text: string): string =>
    level > 0 ? `${code}${text}${RESET}` : text;

  const totalCols = Math.max(...LOGO_LINES.map((l) => [...l].length));
  for (const line of LOGO_LINES) {
    process.stdout.write(colorLine(line, totalCols, level) + "\n");
  }
  process.stdout.write("\n");
  // Tagline + GitHub: dim styling so it visually sits "under" the logo
  // without competing with the operational banner that follows.
  process.stdout.write(
    "  " + wrap(BOLD, `v${version}`) + wrap(DIM, `  ·  ${TAGLINE}`) + "\n"
  );
  process.stdout.write(
    "  " + wrap(DIM, "GitHub: ") + REPO_URL + wrap(DIM, "   ·   Issues: ") + ISSUES_URL + "\n"
  );
  process.stdout.write("\n");
}
