import { describe, expect, it } from "vitest";
import { buildAgentOptions, renderAgentEvent } from "../src/agent/runner.js";
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
    expect(options.model).toBe("claude-3-5-haiku-20241022");
    expect(options.fallbackModel).toBe("claude-3-haiku-20240307");
    expect(options.includePartialMessages).toBe(true);
    expect(options.mcpServers).toHaveProperty("honcho-tools");
    expect(options.env).toEqual(
      expect.objectContaining({
        ANTHROPIC_BASE_URL: "https://app.honch.io/api/wizard/llm",
        ANTHROPIC_AUTH_TOKEN: "wizard-token",
      }),
    );
    expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("renders edit tool events with code previews", () => {
    const event = renderAgentEvent({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Edit",
            input: {
              file_path: "main/app_main.c",
              new_string: 'honch_init(&config);\nhonch_track("boot", NULL);\n',
            },
          },
        ],
      },
    } as never);

    expect(event).toEqual({
      kind: "tool",
      text: 'Edit main/app_main.c\nhonch_init(&config);\nhonch_track("boot", NULL);',
    });
  });
});
