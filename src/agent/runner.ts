import { type Options, query } from "@anthropic-ai/claude-agent-sdk";

export type AgentRunInput = {
  cwd: string;
  prompt: string;
  platformToken: string;
  llmBaseUrl: string;
  mcpServers: NonNullable<Options["mcpServers"]>;
};

export function buildAgentOptions(input: Omit<AgentRunInput, "prompt">) {
  return {
    cwd: input.cwd,
    permissionMode: "acceptEdits" as const,
    mcpServers: input.mcpServers,
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "MultiEdit",
      "Glob",
      "Grep",
      "LS",
      "Bash",
      "mcp__honcho-tools__detect_package_manager",
      "mcp__honcho-tools__check_env_keys",
      "mcp__honcho-tools__set_env_values",
    ],
    env: {
      ANTHROPIC_BASE_URL: input.llmBaseUrl,
      ANTHROPIC_AUTH_TOKEN: input.platformToken,
      CLAUDE_CODE_OAUTH_TOKEN: input.platformToken,
    },
  };
}

export async function runAgent(input: AgentRunInput): Promise<string[]> {
  const messages: string[] = [];
  const response = query({
    prompt: input.prompt,
    options: buildAgentOptions(input),
  });

  for await (const message of response) {
    if (message.type === "assistant") {
      for (const content of message.message.content) {
        if (content.type === "text") messages.push(content.text);
      }
    }
  }

  return messages;
}
