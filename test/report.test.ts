import { describe, expect, it } from "vitest";
import { buildSetupReport } from "../src/report/setup-report.js";

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
});
