import { describe, expect, it } from "vitest";
import {
  buildCcSwitchFiles,
  buildSnippetBundle,
  ccSwitchSnippet,
  resolveSnippetTarget,
} from "../src/setup/snippets.js";

describe("buildCcSwitchFiles", () => {
  const host = { host: "127.0.0.1", port: 8788 };

  it("returns the two raw file bodies that ccSwitchSnippet inlines", () => {
    const target = resolveSnippetTarget("mimo");
    const files = buildCcSwitchFiles(host, target);
    // authJson is canonical 2-space JSON with the mimo2codex sentinel — used
    // by detectAuthJsonOwner() to distinguish our writes from foreign ones.
    expect(JSON.parse(files.authJson)).toEqual({ OPENAI_API_KEY: "mimo2codex-local" });
    expect(files.configToml).toContain('model = "mimo-v2.5-pro"');
    expect(files.configToml).toContain('base_url = "http://127.0.0.1:8788/v1"');
    expect(files.configToml).toContain("requires_openai_auth = true");

    // The markdown snippet for cc-switch must inline both bodies verbatim.
    const md = ccSwitchSnippet(host, target);
    expect(md).toContain(files.authJson);
    expect(md).toContain(files.configToml);
  });

  it("works for deepseek with its legacy 'mimo2codex' toml provider key", () => {
    const target = resolveSnippetTarget("ds");
    const files = buildCcSwitchFiles(host, target);
    expect(files.configToml).toContain('model_provider = "mimo2codex"');
    expect(files.configToml).toContain('model = "deepseek-v4-pro"');
  });

  it("buildSnippetBundle's ccSwitch fields equal buildCcSwitchFiles output", () => {
    const target = resolveSnippetTarget("mimo");
    const bundle = buildSnippetBundle("mimo", host);
    const files = buildCcSwitchFiles(host, target);
    expect(bundle.ccSwitchAuthJson).toBe(files.authJson);
    expect(bundle.ccSwitchConfigToml).toBe(files.configToml);
  });
});
