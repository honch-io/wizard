import { buildSetupReport } from "@honch/agent-core";
import { describe, expect, it } from "vitest";

const base = {
  targetLabel: "C/POSIX",
  projectName: "Test",
  deviceModel: "AnchorCam",
  verification: ["agent run completed"],
};

// The agent's real closing message from the field — it claims success.
const successSummary =
  "Honch C/POSIX SDK integration is complete. Added VERSION to CMakeLists.txt, created uvc/anchor_honch.c, wired anchor_honch_start() into main.c.";

describe("buildSetupReport — never contradicts itself", () => {
  it("does NOT assert a success summary as fact when nothing was integrated", () => {
    const report = buildSetupReport({
      ...base,
      agentRan: true,
      integrated: false,
      agentSummary: successSummary,
    });

    // The verified finding is stated.
    expect(report).toContain("not** integrated");
    // The agent's claim still appears (we don't hide it)...
    expect(report).toContain("integration is complete");
    // ...but it is explicitly framed as unverified — never presented as the
    // report's own finding.
    expect(report.toLowerCase()).toContain("unverified");
    // The old bug: a bare success sentence sitting directly under the
    // "not integrated" line with nothing flagging the discrepancy.
    const outcomeIdx = report.indexOf("not** integrated");
    const claimIdx = report.indexOf("integration is complete");
    const unverifiedIdx = report.toLowerCase().indexOf("unverified");
    expect(unverifiedIdx).toBeGreaterThan(outcomeIdx);
    expect(unverifiedIdx).toBeLessThan(claimIdx);
  });

  it("says integrated-but-not-visible when the agent wrote files git couldn't see", () => {
    const report = buildSetupReport({
      ...base,
      agentRan: true,
      integrated: true,
      unverifiedByGit: true,
      agentSummary: successSummary,
    });

    expect(report).toContain("integrated");
    expect(report).not.toContain("not** integrated");
    // Tells the user where the changes are and to look directly.
    expect(report.toLowerCase()).toMatch(
      /submodule|nested|not visible|ignored/,
    );
    expect(report).toContain("integration is complete");
  });

  it("clean success report when integration is git-verified", () => {
    const report = buildSetupReport({
      ...base,
      agentRan: true,
      integrated: true,
      unverifiedByGit: false,
    });

    expect(report).not.toContain("not** integrated");
    expect(report.toLowerCase()).not.toContain("unverified");
  });

  it("summary line reflects no-change runs honestly", () => {
    const report = buildSetupReport({
      ...base,
      agentRan: true,
      integrated: false,
    });
    expect(report).toContain("ran — no changes made");
  });
});
