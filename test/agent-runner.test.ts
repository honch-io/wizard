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
    expect(options.model).toBe("claude-sonnet-4-6");
    expect(options).not.toHaveProperty("fallbackModel");
    expect(options.includePartialMessages).toBe(true);
    expect(options.mcpServers).toHaveProperty("honcho-tools");
    expect(options.env).toEqual(
      expect.objectContaining({
        ANTHROPIC_BASE_URL: "https://app.honch.io/api/wizard/llm",
        ANTHROPIC_API_KEY: "wizard-token",
      }),
    );
    expect(options.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(options.env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("renders edit tool events as a friendly action line", () => {
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

    expect(event).toEqual({ kind: "tool", text: "Editing app_main.c" });
  });

  it("drops echo noise and labels file inspection", () => {
    const make = (command: string) =>
      renderAgentEvent({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t", name: "Bash", input: { command } },
          ],
        },
      } as never);

    expect(make('echo "---"')).toBeUndefined();
    expect(make("cat components/honch/main/app_main.c")).toEqual({
      kind: "tool",
      text: "Inspecting app_main.c",
    });
  });
});
