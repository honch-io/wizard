import { describe, expect, it } from "vitest";
import { buildSetupReport } from "../src/report/setup-report.js";

describe("buildSetupReport", () => {
  it("summarizes setup decisions and verification", () => {
    const report = buildSetupReport({
      targetLabel: "ESP-IDF",
      projectName: "Action Camera",
      captureHost: "https://capture.honch.io",
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
});
