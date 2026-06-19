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
  abortController?: AbortController;
  resume?: string;
};

export type AgentRunResult = {
  messages: string[];
  sessionId?: string;
};

export type AgentRunEvent = {
  kind: "assistant" | "tool" | "status" | "error";
  text: string;
};

const HONCH_AGENT_MODEL = "claude-sonnet-4-6";

export function buildAgentOptions(input: Omit<AgentRunInput, "prompt">) {
  return {
    cwd: input.cwd,
    model: HONCH_AGENT_MODEL,
    permissionMode: "acceptEdits" as const,
    mcpServers: input.mcpServers,
    includePartialMessages: true,
    ...(input.abortController
      ? { abortController: input.abortController }
      : {}),
    ...(input.resume ? { resume: input.resume } : {}),
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
      ANTHROPIC_API_KEY: input.platformToken,
    },
  };
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const messages: string[] = [];
  let sessionId: string | undefined;
  const response = query({
    prompt: input.prompt,
    options: buildAgentOptions(input),
  });

  try {
    for await (const message of response) {
      const id = (message as { session_id?: string }).session_id;
      if (id) sessionId = id;

      const event = renderAgentEvent(message);
      if (event) input.onEvent?.(event);

      if (message.type === "assistant") {
        for (const content of message.message.content) {
          if (content.type === "text") messages.push(content.text);
        }
      }
    }
  } catch (error) {
    // A user-requested abort ends the run cleanly; anything else is a failure.
    if (!input.abortController?.signal.aborted) throw error;
  }

  return { messages, sessionId };
}

export function renderAgentEvent(
  message: SDKMessage,
): AgentRunEvent | undefined {
  if (message.type === "assistant") {
    for (const content of message.message.content) {
      if (content.type === "tool_use") {
        const text = formatToolUse(content.name, content.input);
        return text ? { kind: "tool", text } : undefined;
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

/**
 * Turn a raw tool call into a short, human-readable action line. Returns
 * undefined for pure noise (e.g. `echo` separators) so it is dropped from the
 * install log entirely.
 */
function formatToolUse(name: string, input: unknown): string | undefined {
  const record =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const file = stringValue(record.file_path) ?? stringValue(record.path);
  const command = stringValue(record.command);

  // The wizard's own local MCP tools.
  if (name.includes("detect_package_manager"))
    return "Detecting package manager";
  if (name.includes("check_env_keys")) return "Checking environment keys";
  if (name.includes("set_env_values")) return "Writing environment values";

  switch (name) {
    case "Read":
      return file ? `Reading ${basename(file)}` : "Reading a file";
    case "Edit":
    case "MultiEdit":
      return file ? `Editing ${basename(file)}` : "Editing a file";
    case "Write":
      return file ? `Writing ${basename(file)}` : "Writing a file";
    case "Glob":
      return "Scanning the project";
    case "Grep":
      return "Searching the project";
    case "LS":
      return "Listing files";
    case "Bash":
      return formatBashCommand(command);
    default:
      return name;
  }
}

function formatBashCommand(command?: string): string | undefined {
  if (!command) return "Running a command";
  const trimmed = command.trim();
  // Echo separators are pure noise.
  if (/^echo\b/.test(trimmed)) return undefined;
  // The agent often inspects files with cat/head/tail — show what it's reading.
  const inspect = /^(?:cat|head|tail)\s+(?:-\S+\s+)*"?([^\s"|]+)/.exec(trimmed);
  if (inspect) return `Inspecting ${basename(inspect[1])}`;
  return `$ ${truncate(trimmed, 56)}`;
}

function basename(filePath: string): string {
  return filePath.replace(/\/+$/, "").split("/").pop() || filePath;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
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
