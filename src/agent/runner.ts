import {
  type Options,
  query,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

export type AgentRunInput = {
  cwd: string;
  prompt: string;
  platformToken: string;
  llmBaseUrl: string;
  mcpServers: NonNullable<Options["mcpServers"]>;
  onEvent?: (event: AgentRunEvent) => void;
};

export type AgentRunEvent = {
  kind: "assistant" | "tool" | "status" | "error";
  text: string;
};

const HONCH_AGENT_MODEL = "claude-3-5-haiku-20241022";

export function buildAgentOptions(input: Omit<AgentRunInput, "prompt">) {
  return {
    cwd: input.cwd,
    model: HONCH_AGENT_MODEL,
    fallbackModel: "claude-3-haiku-20240307",
    permissionMode: "acceptEdits" as const,
    mcpServers: input.mcpServers,
    includePartialMessages: true,
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
      ...safeProcessEnv(),
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
    const event = renderAgentEvent(message);
    if (event) input.onEvent?.(event);

    if (message.type === "assistant") {
      for (const content of message.message.content) {
        if (content.type === "text") messages.push(content.text);
      }
    }
  }

  return messages;
}

export function renderAgentEvent(
  message: SDKMessage,
): AgentRunEvent | undefined {
  if (message.type === "assistant") {
    for (const content of message.message.content) {
      if (content.type === "tool_use") {
        return {
          kind: "tool",
          text: formatToolUse(content.name, content.input),
        };
      }
      if (content.type === "text") {
        const text = firstMeaningfulLine(content.text);
        if (text) return { kind: "assistant", text };
      }
    }
  }

  if (message.type === "stream_event") {
    const event = message.event;
    if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta.type === "text_delta") {
        const text = firstMeaningfulLine(delta.text);
        if (text) return { kind: "assistant", text };
      }
    }
  }

  if (message.type === "system") {
    if (message.subtype === "api_retry") {
      return {
        kind: "status",
        text: `Retrying Claude API request ${message.attempt}/${message.max_retries}`,
      };
    }
    if (message.subtype === "permission_denied") {
      return {
        kind: "error",
        text: `Denied ${message.tool_name}: ${message.message}`,
      };
    }
  }

  if (message.type === "tool_progress") {
    return {
      kind: "status",
      text: `${message.tool_name} running for ${Math.round(message.elapsed_time_seconds)}s`,
    };
  }

  if (message.type === "result" && message.subtype !== "success") {
    return {
      kind: "error",
      text: message.errors[0] ?? "Claude returned an error result",
    };
  }

  return undefined;
}

function formatToolUse(name: string, input: unknown) {
  const record =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const filePath = stringValue(record.file_path) ?? stringValue(record.path);
  const command = stringValue(record.command);
  const heading = filePath
    ? `${name} ${filePath}`
    : command
      ? `${name} ${command}`
      : name;
  const preview = codePreview(record);
  return preview ? `${heading}\n${preview}` : heading;
}

function codePreview(record: Record<string, unknown>) {
  const source =
    stringValue(record.content) ??
    stringValue(record.new_string) ??
    stringValue(record.old_string);
  if (!source) return undefined;
  const lines = source
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 3);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function firstMeaningfulLine(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeProcessEnv() {
  const keys = [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "SHELL",
    "LANG",
    "TERM",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
  ];
  return Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}
