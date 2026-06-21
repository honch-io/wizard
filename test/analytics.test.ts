import { arch, platform } from "node:os";
import { describe, expect, it } from "vitest";
import {
  analyticsDisabled,
  buildInstallProperties,
  estimateCostUsd,
} from "../src/analytics.js";

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

describe("estimateCostUsd", () => {
  it("converts 1M tokens at the blended rate", () => {
    expect(estimateCostUsd(1_000_000)).toBe(3);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateCostUsd(0)).toBe(0);
  });

  it("returns 0 for negative tokens", () => {
    expect(estimateCostUsd(-100)).toBe(0);
  });

  it("returns 0 for non-finite input", () => {
    expect(estimateCostUsd(Infinity)).toBe(0);
    expect(estimateCostUsd(NaN)).toBe(0);
  });
});

describe("buildInstallProperties", () => {
  it("captures coarse experience fields with snake_case keys", () => {
    const props = buildInstallProperties({
      target: "esp-idf",
      outcome: "success",
      agentRan: true,
      durationMs: 4200,
      totalTokens: 500_000,
    });

    expect(props).toMatchObject({
      os: platform(),
      arch: arch(),
      target: "esp-idf",
      outcome: "success",
      agent_ran: true,
      duration_ms: 4200,
      total_tokens: 500_000,
      est_cost_usd: 1.5,
    });
    expect(typeof props.wizard_version).toBe("string");
  });

  it("carries no code, paths, project identifiers, or secrets", () => {
    const props = buildInstallProperties({
      target: "c-posix",
      outcome: "failed",
      agentRan: false,
      durationMs: 10,
      totalTokens: 0,
    });

    // Only the known coarse keys — nothing that could leak project content.
    expect(Object.keys(props).sort()).toEqual(
      [
        "agent_ran",
        "arch",
        "duration_ms",
        "est_cost_usd",
        "os",
        "outcome",
        "target",
        "total_tokens",
        "wizard_version",
      ].sort(),
    );
  });
});
