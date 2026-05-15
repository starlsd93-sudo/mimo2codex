import { describe, expect, it, afterEach, vi } from "vitest";
import { detectColorLevel, fg } from "../src/util/cliColor.js";

// detectColorLevel reads process.env and process.stdout.isTTY. The tests
// swap those in-flight and restore them after each case.
let originalEnv = { ...process.env };
let originalIsTTY: boolean | undefined;

function withEnv(patch: Record<string, string | undefined>): void {
  // wipe known signals first so leftover host env doesn't pollute
  for (const k of [
    "NO_COLOR",
    "FORCE_COLOR",
    "COLORTERM",
    "TERM_PROGRAM",
    "WT_SESSION",
    "TERMINUS_SUBLIME",
  ]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function withTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  process.env = { ...originalEnv };
  if (originalIsTTY === undefined) {
    delete (process.stdout as unknown as { isTTY?: boolean }).isTTY;
  } else {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  }
});

// Snapshot the original isTTY exactly once (before the suite installs its
// own descriptor). vitest runs each `it` after `afterEach`, so this lives
// in the module body to capture the host value before any test touches it.
originalIsTTY = (process.stdout as unknown as { isTTY?: boolean }).isTTY;
originalEnv = { ...process.env };

describe("detectColorLevel", () => {
  it("returns 0 when NO_COLOR is set, regardless of everything else", () => {
    withEnv({ NO_COLOR: "1", FORCE_COLOR: "3", COLORTERM: "truecolor" });
    withTTY(true);
    expect(detectColorLevel()).toBe(0);
  });

  it("returns 0 for FORCE_COLOR=0 / false", () => {
    withEnv({ FORCE_COLOR: "0" });
    withTTY(true);
    expect(detectColorLevel()).toBe(0);
    withEnv({ FORCE_COLOR: "false" });
    expect(detectColorLevel()).toBe(0);
  });

  it("returns 3 for FORCE_COLOR=3", () => {
    withEnv({ FORCE_COLOR: "3" });
    withTTY(false);
    expect(detectColorLevel()).toBe(3);
  });

  it("returns 2 for FORCE_COLOR=2 / 1 / true (degrades to 256)", () => {
    withEnv({ FORCE_COLOR: "2" });
    withTTY(false);
    expect(detectColorLevel()).toBe(2);
    withEnv({ FORCE_COLOR: "1" });
    expect(detectColorLevel()).toBe(2);
    withEnv({ FORCE_COLOR: "true" });
    expect(detectColorLevel()).toBe(2);
  });

  it("returns 0 when not a TTY and FORCE_COLOR unset", () => {
    withEnv({ COLORTERM: "truecolor", TERM_PROGRAM: "iTerm.app" });
    withTTY(false);
    expect(detectColorLevel()).toBe(0);
  });

  it("returns 3 for TTY + COLORTERM=truecolor", () => {
    withEnv({ COLORTERM: "truecolor" });
    withTTY(true);
    expect(detectColorLevel()).toBe(3);
  });

  it("returns 3 for TTY + COLORTERM=24bit (case-insensitive)", () => {
    withEnv({ COLORTERM: "24bit" });
    withTTY(true);
    expect(detectColorLevel()).toBe(3);
    withEnv({ COLORTERM: "TrueColor" });
    expect(detectColorLevel()).toBe(3);
  });

  it("returns 3 for known truecolor TERM_PROGRAM values", () => {
    withTTY(true);
    for (const tp of ["iTerm.app", "vscode", "Hyper", "WezTerm", "ghostty"]) {
      withEnv({ TERM_PROGRAM: tp });
      expect(detectColorLevel()).toBe(3);
    }
  });

  it("returns 3 inside Windows Terminal (WT_SESSION)", () => {
    withEnv({ WT_SESSION: "abc-123" });
    withTTY(true);
    expect(detectColorLevel()).toBe(3);
  });

  it("returns 2 for Apple Terminal — the regression case", () => {
    // Apple_Terminal sets TERM_PROGRAM but NOT COLORTERM, and does NOT
    // support truecolor. Must degrade to 256-color cube or the rendering
    // gets garbled by misparsed SGR sequences.
    withEnv({ TERM_PROGRAM: "Apple_Terminal" });
    withTTY(true);
    expect(detectColorLevel()).toBe(2);
  });

  it("returns 2 for an unknown TTY (safe baseline)", () => {
    withEnv({});
    withTTY(true);
    expect(detectColorLevel()).toBe(2);
  });
});

describe("fg encoder", () => {
  it("returns empty string at level 0", () => {
    expect(fg(255, 0, 0, 0)).toBe("");
  });

  it("emits truecolor SGR at level 3", () => {
    expect(fg(0, 180, 216, 3)).toBe("\x1b[38;2;0;180;216m");
    expect(fg(255, 214, 10, 3)).toBe("\x1b[38;2;255;214;10m");
  });

  it("emits 256-color cube SGR at level 2", () => {
    // #00B4D8: r6=0 g6=round(180/255*5)=4 b6=round(216/255*5)=4
    //          → 16 + 0*36 + 4*6 + 4 = 44
    expect(fg(0, 180, 216, 2)).toBe("\x1b[38;5;44m");
    // #FFD60A: r6=5 g6=4 b6=0 → 16+180+24+0 = 220 (bright yellow)
    expect(fg(255, 214, 10, 2)).toBe("\x1b[38;5;220m");
    // #03045E: r6=0 g6=0 b6=round(94/255*5)=2 → 16+0+0+2 = 18 (dark blue)
    expect(fg(0x03, 0x04, 0x5e, 2)).toBe("\x1b[38;5;18m");
  });
});
