import { describe, expect, it } from "vitest";
import { resolveBridgeTheme } from "../../apps/web/src/lib/bridge-theme";

describe("model-aware palette", () => {
  it("uses the whale palette for first setup and DeepSeek, and restores the chosen palette after switching providers", () => {
    expect(resolveBridgeTheme("forest", true, null)).toBe("whale");
    expect(
      resolveBridgeTheme("iris", true, "byok_deepseek/deepseek-chat"),
    ).toBe("whale");
    expect(resolveBridgeTheme("iris", true, "openai/gpt-4.1")).toBe("iris");
  });
  it("honors a manual palette even with a DeepSeek model", () => {
    expect(resolveBridgeTheme("sand", false, "deepseek/deepseek-chat")).toBe(
      "sand",
    );
    expect(resolveBridgeTheme("whale", false, "openai/gpt-4.1")).toBe("whale");
  });
});
