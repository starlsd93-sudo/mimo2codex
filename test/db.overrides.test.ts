import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "../src/db/index.js";
import {
  clearActiveOverride,
  getActiveOverride,
  setActiveOverride,
} from "../src/db/overrides.js";
import { isForbiddenSettingKey, setSetting } from "../src/db/settings.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "m2c-overrides-test-"));
  openDb(dataDir);
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("db/overrides", () => {
  it("returns null when no override is set", () => {
    expect(getActiveOverride()).toBeNull();
  });

  it("returns null when only one of the two keys is set", () => {
    // Hand-roll the partial state via setSetting directly.
    setSetting("codex.activeOverride.providerId", "mimo");
    expect(getActiveOverride()).toBeNull();
  });

  it("setActiveOverride + getActiveOverride round-trip", () => {
    setActiveOverride("deepseek", "deepseek-v4-pro");
    expect(getActiveOverride()).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    });
  });

  it("clearActiveOverride deletes both rows", () => {
    setActiveOverride("mimo", "mimo-v2.5-pro");
    clearActiveOverride();
    expect(getActiveOverride()).toBeNull();
  });

  it("override keys are not blocked by isForbiddenSettingKey", () => {
    expect(isForbiddenSettingKey("codex.activeOverride.providerId")).toBe(false);
    expect(isForbiddenSettingKey("codex.activeOverride.modelId")).toBe(false);
  });

  it("setActiveOverride is idempotent / overwriting", () => {
    setActiveOverride("mimo", "mimo-v2.5-pro");
    setActiveOverride("deepseek", "deepseek-v4-pro");
    expect(getActiveOverride()).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    });
  });
});
