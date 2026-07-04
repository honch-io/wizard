import { buildSetupReport } from "@honch/agent-core";
import { describe, expect, it } from "vitest";

describe("buildSetupReport", () => {
  it("summarizes setup decisions and verification", () => {
    const report = buildSetupReport({
      targetLabel: "ESP-IDF",
      projectName: "Action Camera",
      deviceModel: "ActionCam X1",
      agentRan: false,
      verification: ["dry run: no files modified"],
    });

    expect(report).toContain("# Honch Setup Report");
    expect(report).toContain("ESP-IDF");
    expect(report).toContain("ActionCam X1");
    expect(report).not.toContain("Firmware version:");
    expect(report).toContain("dry run: no files modified");
  });

  it("reports an honest outcome when the agent changed nothing", () => {
    const report = buildSetupReport({
      targetLabel: "MicroPython",
      projectName: "Python Testing",
      deviceModel: "pc1",
      agentRan: true,
      integrated: false,
      agentSummary: "This is a host CPython app, not MicroPython firmware.",
      verification: ["agent run completed"],
    });

    expect(report).toContain("## Outcome");
    expect(report).toContain("not** integrated");
    expect(report).toContain("ran — no changes made");
    expect(report).toContain("host CPython app, not MicroPython");
  });

  it("omits the outcome section on a successful integration", () => {
    const report = buildSetupReport({
      targetLabel: "ESP-IDF",
      projectName: "Action Camera",
      deviceModel: "ActionCam X1",
      agentRan: true,
      integrated: true,
      verification: ["agent run completed"],
    });

    expect(report).not.toContain("## Outcome");
  });

  it("tailors Next Steps to kick-the-tires guidance for a Try run", () => {
    const report = buildSetupReport({
      targetLabel: "C/POSIX",
      projectName: "Scratch",
      deviceModel: "pc1",
      agentRan: true,
      integrated: true,
      tryMode: true,
      verification: ["agent run completed"],
    });

    expect(report).toContain("temporary scratch project");
    // Ship-readiness guidance is wrong for a scratch run.
    expect(report).not.toContain("before shipping");
  });

  it("keeps ship-readiness Next Steps for a real integrated install", () => {
    const report = buildSetupReport({
      targetLabel: "ESP-IDF",
      projectName: "Action Camera",
      deviceModel: "ActionCam X1",
      agentRan: true,
      integrated: true,
      verification: ["agent run completed"],
    });

    expect(report).toContain("before shipping");
  });
});
