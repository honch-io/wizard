import { buildAgentPrompt } from "@honch/agent-core";
import { describe, expect, it } from "vitest";

describe("buildAgentPrompt", () => {
  it("includes SDK target instructions and secret refs without raw keys", () => {
    const prompt = buildAgentPrompt({
      targetId: "esp-idf",
      projectApiKeyRef: "secret:project",
      deviceModel: "ActionCam X1",
    });

    expect(prompt).toContain("ESP-IDF");
    expect(prompt).toContain("secret:project");
    expect(prompt).toContain("ActionCam X1");
    expect(prompt).toContain("Required workflow");
    expect(prompt).toContain("detect_package_manager MCP tool");
    expect(prompt).toContain("call honch_tick() only from a low-priority task");
    expect(prompt).toContain("honch-setup-report.md");
    expect(prompt).toContain("wire Honch's firmware_version");
    expect(prompt).toContain("FIRMWARE_VERSION");
    expect(prompt).toContain("PROJECT_VER");
    expect(prompt).toContain("never a value entered once in the wizard");
    expect(prompt).not.toContain("Firmware version:");
    expect(prompt).not.toContain("1.2.3");
    expect(prompt).not.toContain("honch_test");
    expect(prompt).not.toContain("sk_");
  });
});
