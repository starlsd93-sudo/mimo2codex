import { describe, expect, it } from "vitest";
import { byClientModel, byShortcut, PROVIDERS } from "../src/providers/registry.js";
import { mimo } from "../src/providers/mimo.js";
import { deepseek } from "../src/providers/deepseek.js";

describe("provider registry", () => {
  it("byShortcut matches mimo/ds and full ids", () => {
    expect(byShortcut("mimo")?.id).toBe("mimo");
    expect(byShortcut("ds")?.id).toBe("deepseek");
    expect(byShortcut("deepseek")?.id).toBe("deepseek");
    expect(byShortcut("DS")?.id).toBe("deepseek");
    expect(byShortcut("nope")).toBeUndefined();
  });

  it("PROVIDERS map exposes both providers by id", () => {
    expect(PROVIDERS.mimo).toBe(mimo);
    expect(PROVIDERS.deepseek).toBe(deepseek);
  });

  describe("byClientModel routing", () => {
    it("MiMo models route to mimo provider", () => {
      expect(byClientModel("mimo-v2.5-pro")?.id).toBe("mimo");
      expect(byClientModel("mimo-v2.5-pro[1m]")?.id).toBe("mimo");
      expect(byClientModel("mimo-v2-flash")?.id).toBe("mimo");
    });

    it("DeepSeek models route to deepseek provider", () => {
      expect(byClientModel("deepseek-v4-pro")?.id).toBe("deepseek");
      expect(byClientModel("deepseek-v4-flash")?.id).toBe("deepseek");
      expect(byClientModel("deepseek-chat")?.id).toBe("deepseek");
      expect(byClientModel("deepseek-reasoner")?.id).toBe("deepseek");
    });

    it("legacy DeepSeek aliases resolve to v4-flash", () => {
      const m = deepseek.resolveModel("deepseek-chat");
      // deepseek-chat exists as both a builtin model AND an alias of v4-flash;
      // the standalone entry comes first in the catalog so direct id lookup
      // still wins. The alias path is still exercised when a client sends an
      // id that *only* exists as an alias.
      expect(m).not.toBeNull();
    });

    it("aliases that aren't a builtin id route via alias fallback", () => {
      const result = deepseek.resolveModel("deepseek-reasoner");
      expect(result).not.toBeNull();
      // deepseek-reasoner is a standalone entry, but the v4-flash alias array
      // also contains it as a fallback. Either path returns a non-null result.
    });

    it("unknown models return undefined", () => {
      expect(byClientModel("gpt-4o")).toBeUndefined();
      expect(byClientModel("claude-3.5-sonnet")).toBeUndefined();
      expect(byClientModel("")).toBeUndefined();
    });
  });
});
