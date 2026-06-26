import { describe, expect, it } from "vitest";
import { buildAgentPrompt } from "../src/agent/prompt.js";
import { HONCH_FEATURES, targetSupportsFeatures } from "../src/sdk/targets.js";

describe("feature catalog", () => {
  it("has exactly one locked core, and every optional feature maps to a HONCH_ENABLE_* toggle", () => {
    const locked = HONCH_FEATURES.filter((feature) => feature.locked);
    expect(locked).toHaveLength(1);
    expect(locked[0]?.id).toBe("core");
    expect(locked[0]?.toggle).toBeUndefined();
    for (const feature of HONCH_FEATURES) {
      if (!feature.locked) expect(feature.toggle).toMatch(/^HONCH_ENABLE_/);
    }
  });

  it("offers feature stripping for the C-core SDKs but not the React Native relay", () => {
    expect(targetSupportsFeatures("esp-idf")).toBe(true);
    expect(targetSupportsFeatures("c-posix")).toBe(true);
    expect(targetSupportsFeatures("micropython")).toBe(true);
    expect(targetSupportsFeatures("react-native-relay")).toBe(false);
  });
});

describe("buildAgentPrompt feature selection", () => {
  const base = {
    targetId: "esp-idf" as const,
    projectApiKeyRef: "secret-ref",
    deviceModel: "X3-Pro",
  };

  it("omits the feature-selection block when nothing is disabled", () => {
    expect(buildAgentPrompt(base)).not.toContain("COMPILE OUT");
    expect(buildAgentPrompt({ ...base, disabledFeatures: [] })).not.toContain(
      "COMPILE OUT",
    );
  });

  it("instructs the agent to compile out each chosen toggle", () => {
    const prompt = buildAgentPrompt({
      ...base,
      disabledFeatures: ["HONCH_ENABLE_BATTERY", "HONCH_ENABLE_SESSIONS"],
    });
    expect(prompt).toContain("COMPILE OUT");
    expect(prompt).toContain("HONCH_ENABLE_BATTERY=0");
    expect(prompt).toContain("HONCH_ENABLE_SESSIONS=0");
    // The per-target mechanism is spelled out so the agent applies it correctly.
    expect(prompt).toContain("CONFIG_HONCH_");
  });
});
