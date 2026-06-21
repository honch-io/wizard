import { describe, expect, it } from "vitest";
import { agentEventsFor, buildAgentOptions } from "../src/agent/runner.js";
import { createSecretVault } from "../src/secrets/vault.js";
import { createLocalToolsServer } from "../src/tools/mcp-server.js";

describe("buildAgentOptions", () => {
  it("points Claude at the Honch platform proxy", () => {
    const options = buildAgentOptions({
      cwd: "/tmp/project",
      platformToken: "wizard-token",
      llmBaseUrl: "https://app.honch.io/api/wizard/llm",
      mcpServers: {
        "honch-tools": createLocalToolsServer({
          workingDirectory: "/tmp/project",
          secretVault: createSecretVault(),
        }),
      },
    });

    expect(options.cwd).toBe("/tmp/project");
    expect(options.model).toBe("claude-opus-4-8");
    expect(options).not.toHaveProperty("fallbackModel");
    expect(options.includePartialMessages).toBe(false);
    expect(options.mcpServers).toHaveProperty("honch-tools");
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
    const events = agentEventsFor({
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

    expect(events).toEqual([{ kind: "tool", text: "Editing app_main.c" }]);
  });

  it("drops echo noise and labels file inspection", () => {
    const make = (command: string) =>
      agentEventsFor({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t", name: "Bash", input: { command } },
          ],
        },
      } as never);

    expect(make('echo "---"')).toEqual([]);
    expect(make("cat components/honch/main/app_main.c")).toEqual([
      { kind: "tool", text: "Inspecting app_main.c" },
    ]);
  });

  it("emits each content block of an assistant turn in full, with no duplication", () => {
    const events = agentEventsFor({
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "I'll wire in the Honch SDK.\nFirst I'll read the build files.",
          },
          {
            type: "tool_use",
            id: "t",
            name: "Read",
            input: { file_path: "CMakeLists.txt" },
          },
        ],
      },
    } as never);

    expect(events).toEqual([
      {
        kind: "assistant",
        text: "I'll wire in the Honch SDK.\nFirst I'll read the build files.",
      },
      { kind: "tool", text: "Reading CMakeLists.txt" },
    ]);
  });

  it("does not render streaming partial deltas (they duplicate the final block)", () => {
    expect(
      agentEventsFor({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "I'll wire" },
        },
      } as never),
    ).toEqual([]);
  });
});
