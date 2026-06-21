import { arch, platform } from "node:os";
import { describe, expect, it } from "vitest";
import { analyticsDisabled, buildAnalyticsPayload } from "../src/analytics.js";

describe("analyticsDisabled", () => {
  it("is enabled by default", () => {
    expect(analyticsDisabled({})).toBe(false);
  });

  it("honors HONCH_WIZARD_NO_ANALYTICS", () => {
    expect(analyticsDisabled({ HONCH_WIZARD_NO_ANALYTICS: "1" })).toBe(true);
  });

  it("honors the DO_NOT_TRACK standard", () => {
    expect(analyticsDisabled({ DO_NOT_TRACK: "1" })).toBe(true);
  });
});

describe("buildAnalyticsPayload", () => {
  it("captures coarse experience fields", () => {
    const payload = buildAnalyticsPayload({
      target: "esp-idf",
      outcome: "success",
      agentRan: true,
      durationMs: 4200,
    });

    expect(payload).toMatchObject({
      event: "install",
      os: platform(),
      arch: arch(),
      target: "esp-idf",
      outcome: "success",
      agentRan: true,
      durationMs: 4200,
    });
    expect(typeof payload.wizardVersion).toBe("string");
  });

  it("carries no code, paths, project identifiers, or secrets", () => {
    const payload = buildAnalyticsPayload({
      target: "c-posix",
      outcome: "failed",
      agentRan: false,
      durationMs: 10,
    });

    // Only the known coarse keys — nothing that could leak project content.
    expect(Object.keys(payload).sort()).toEqual(
      [
        "agentRan",
        "arch",
        "durationMs",
        "event",
        "os",
        "outcome",
        "target",
        "wizardVersion",
      ].sort(),
    );
  });
});
