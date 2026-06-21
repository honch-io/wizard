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
  // "retry" is transient — it updates a single pinned line instead of adding
  // a new run-log entry, so retry storms don't spam the log.
  // "file" tracks write/edit operations for the live changed-files panel.
  kind: "assistant" | "tool" | "status" | "error" | "retry" | "file";
  text: string;
  op?: "create" | "edit";
};

// The backend proxy pins the model server-side; this keeps the client request
// aligned with what actually runs.
const HONCH_AGENT_MODEL = "claude-opus-4-8";

export function buildAgentOptions(input: Omit<AgentRunInput, "prompt">) {
  return {
    cwd: input.cwd,
    model: HONCH_AGENT_MODEL,
    permissionMode: "acceptEdits" as const,
    mcpServers: input.mcpServers,
    // Render the final `assistant` message once, in full. Partial streaming
    // deltas (`stream_event`) re-emit the same text and, combined with the
    // assistant block, produced duplicated + truncated lines in the run log.
    includePartialMessages: false,
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
      "mcp__honch-tools__detect_package_manager",
      "mcp__honch-tools__check_env_keys",
      "mcp__honch-tools__set_env_values",
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

      for (const event of agentEventsFor(message)) input.onEvent?.(event);

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

/**
 * Translate one SDK message into the run-log events to display. An assistant
 * turn can carry several content blocks (prose plus tool calls), so this
 * returns them in order. Text blocks are emitted in full — no first-line
 * truncation — and partial streaming deltas are intentionally not consumed, so
 * each piece of Claude's output appears exactly once.
 */
export function agentEventsFor(message: SDKMessage): AgentRunEvent[] {
  const events: AgentRunEvent[] = [];

  if (message.type === "assistant") {
    for (const content of message.message.content) {
      if (content.type === "text") {
        const text = content.text.trim();
        if (text) events.push({ kind: "assistant", text });
      } else if (content.type === "tool_use") {
        const text = formatToolUse(content.name, content.input);
        if (text) events.push({ kind: "tool", text });
        // Emit a file event for write/edit operations so the UI can show a
        // live "Changed files" panel. The tool event above stays unchanged.
        const fileEvent = fileEventFor(content.name, content.input);
        if (fileEvent) events.push(fileEvent);
      }
    }
    return events;
  }

  if (message.type === "system") {
    if (message.subtype === "api_retry") {
      events.push({
        kind: "retry",
        text: `Reconnecting to Claude — attempt ${message.attempt} of ${message.max_retries}`,
      });
    } else if (message.subtype === "permission_denied") {
      events.push({
        kind: "error",
        text: `Denied ${message.tool_name}: ${message.message}`,
      });
    }
    return events;
  }

  if (message.type === "tool_progress") {
    events.push({
      kind: "status",
      text: `${message.tool_name} running for ${Math.round(message.elapsed_time_seconds)}s`,
    });
    return events;
  }

  if (message.type === "result" && message.subtype !== "success") {
    events.push({
      kind: "error",
      text: message.errors[0] ?? "Claude returned an error result",
    });
  }

  return events;
}

/**
 * Produce a `{kind:"file"}` event for tools that write or edit files, so the
 * UI can maintain a live "Changed files" panel. Returns undefined for tools
 * that do not mutate files (Read, Bash, etc.).
 */
function fileEventFor(name: string, input: unknown): AgentRunEvent | undefined {
  const record =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const file = stringValue(record.file_path);
  if (!file) return undefined;

  if (name === "Write") return { kind: "file", op: "create", text: file };
  if (name === "Edit" || name === "MultiEdit")
    return { kind: "file", op: "edit", text: file };
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
