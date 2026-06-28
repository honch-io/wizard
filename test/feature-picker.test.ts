import { describe, expect, it } from "vitest";
import { buildAgentPrompt } from "../src/agent/prompt.js";
import { HONCH_FEATURES, targetSupportsFeatures } from "../src/sdk/targets.js";

describe("feature catalog", () => {
  it("has exactly one locked core; every optional feature carries both a -D macro and an ESP-IDF Kconfig symbol", () => {
    const locked = HONCH_FEATURES.filter((feature) => feature.locked);
    expect(locked).toHaveLength(1);
    expect(locked[0]?.id).toBe("core");
    expect(locked[0]?.toggle).toBeUndefined();
    for (const feature of HONCH_FEATURES) {
      if (feature.locked) continue;
      expect(feature.toggle).toMatch(/^HONCH_ENABLE_/);
      // The ESP-IDF symbol is NOT the macro name (no ENABLE_) — must be explicit.
      expect(feature.espIdfConfig).toMatch(/^CONFIG_HONCH_/);
      expect(feature.espIdfConfig).not.toContain("ENABLE_");
    }
  });

  it("merges crash + logs into one Error tracking feature (ESP-IDF can't strip them apart)", () => {
    const ids = HONCH_FEATURES.map((feature) => feature.id);
    expect(ids).toContain("error-tracking");
    expect(ids).not.toContain("crash");
    expect(ids).not.toContain("log");
    const errorTracking = HONCH_FEATURES.find((f) => f.id === "error-tracking");
    expect(errorTracking?.toggle).toBe("HONCH_ENABLE_ERROR_TRACKING");
    expect(errorTracking?.espIdfConfig).toBe("CONFIG_HONCH_ERROR_TRACKING");
  });

  it("uses measured footprint + wire numbers (real, not round estimates)", () => {
    const errorTracking = HONCH_FEATURES.find((f) => f.id === "error-tracking");
    // Measured on ESP32/IDF v6.0.1 — see src/sdk/feature-footprint.json.
    expect(errorTracking?.flashBytes).toBe(4971);
    expect(errorTracking?.ramBytes).toBe(316);
    expect(errorTracking?.wireBytesPerEvent).toBe(166);
    expect(errorTracking?.wireEvent).toBe("$crash");
    // Every optional feature has a measured per-event wire cost.
    for (const feature of HONCH_FEATURES) {
      if (!feature.locked) expect(feature.wireBytesPerEvent).toBeGreaterThan(0);
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
    projectApiKeyRef: "secret-ref",
    deviceModel: "X3-Pro",
  };
  const disabled = [
    { toggle: "HONCH_ENABLE_BATTERY", espIdfConfig: "CONFIG_HONCH_BATTERY" },
    { toggle: "HONCH_ENABLE_SESSIONS", espIdfConfig: "CONFIG_HONCH_SESSIONS" },
  ];

  it("omits the feature-selection block when nothing is disabled", () => {
    expect(buildAgentPrompt({ ...base, targetId: "esp-idf" })).not.toContain(
      "COMPILE OUT",
    );
    expect(
      buildAgentPrompt({ ...base, targetId: "esp-idf", disabledFeatures: [] }),
    ).not.toContain("COMPILE OUT");
  });

  it("emits the exact ESP-IDF Kconfig symbols (=n in sdkconfig.defaults)", () => {
    const prompt = buildAgentPrompt({
      ...base,
      targetId: "esp-idf",
      disabledFeatures: disabled,
    });
    expect(prompt).toContain("COMPILE OUT");
    expect(prompt).toContain("sdkconfig.defaults");
    expect(prompt).toContain("CONFIG_HONCH_BATTERY=n");
    expect(prompt).toContain("CONFIG_HONCH_SESSIONS=n");
    // Never the macro form on ESP-IDF.
    expect(prompt).not.toContain("HONCH_ENABLE_BATTERY=0");
  });

  it("emits -D macro flags for the C-core targets", () => {
    const prompt = buildAgentPrompt({
      ...base,
      targetId: "c-posix",
      disabledFeatures: disabled,
    });
    expect(prompt).toContain("HONCH_ENABLE_BATTERY=0");
    expect(prompt).toContain("HONCH_ENABLE_SESSIONS=0");
    expect(prompt).not.toContain("CONFIG_HONCH_BATTERY");
  });
});
