import { describe, expect, it } from "vitest";
import { buildAgentOptions } from "../src/agent/runner.js";
import { createSecretVault } from "../src/secrets/vault.js";
import { createLocalToolsServer } from "../src/tools/mcp-server.js";

describe("buildAgentOptions", () => {
  it("points Claude at the Honch platform proxy", () => {
    const options = buildAgentOptions({
      cwd: "/tmp/project",
      platformToken: "wizard-token",
      llmBaseUrl: "https://app.honch.io/api/wizard/llm",
      mcpServers: {
        "honcho-tools": createLocalToolsServer({
          workingDirectory: "/tmp/project",
          secretVault: createSecretVault(),
        }),
      },
    });

    expect(options.cwd).toBe("/tmp/project");
    expect(options.mcpServers).toHaveProperty("honcho-tools");
    expect(options.env).toEqual(
      expect.objectContaining({
        ANTHROPIC_BASE_URL: "https://app.honch.io/api/wizard/llm",
        ANTHROPIC_AUTH_TOKEN: "wizard-token",
      }),
    );
  });
});
