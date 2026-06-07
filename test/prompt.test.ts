import { describe, expect, it } from "vitest";
import { buildAgentPrompt } from "../src/agent/prompt.js";

describe("buildAgentPrompt", () => {
  it("includes SDK target instructions and secret refs without raw keys", () => {
    const prompt = buildAgentPrompt({
      targetId: "esp-idf",
      projectApiKeyRef: "secret:project",
      captureHost: "https://capture.honch.io",
      deviceModel: "ActionCam X1",
      firmwareVersion: "1.2.3",
    });

    expect(prompt).toContain("ESP-IDF");
    expect(prompt).toContain("secret:project");
    expect(prompt).toContain("ActionCam X1");
    expect(prompt).toContain("Required workflow");
    expect(prompt).toContain("detect_package_manager MCP tool");
    expect(prompt).toContain("call honch_tick() only from a low-priority task");
    expect(prompt).toContain("honch-setup-report.md");
    expect(prompt).not.toContain("honch_test");
    expect(prompt).not.toContain("sk_");
  });
});
