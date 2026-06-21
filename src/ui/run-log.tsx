import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { RunMessage } from "../cli/prompt.js";
import { COLORS } from "./theme.js";

const STAR_FRAMES = ["✶", "✷", "✸", "✹", "✺", "✹", "✸", "✷"];

function basename(filePath: string): string {
  return filePath.replace(/\/+$/, "").split("/").pop() || filePath;
}

/** A twinkling star, à la Claude. */
function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % STAR_FRAMES.length),
      90,
    );
    return () => clearInterval(timer);
  }, []);
  return <Text color={COLORS.accent}>{STAR_FRAMES[frame]}</Text>;
}

/** Seconds elapsed since `active` became true, ticking up by 1 each second. */
function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** Compact token count for the usage meter: 980 → "980", 12345 → "12.3k". */
function formatTokens(tokens: number) {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
}

type InlineSegment = { text: string; code?: boolean; bold?: boolean };

/** Split a line into plain / `code` / **bold** runs (code wins over bold). */
function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  for (const part of text.split(/(`[^`]+`)/)) {
    if (!part) continue;
    if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
      segments.push({ text: part.slice(1, -1), code: true });
      continue;
    }
    for (const run of part.split(/(\*\*[^*]+\*\*|__[^_]+__)/)) {
      if (!run) continue;
      const bold =
        run.length >= 4 &&
        ((run.startsWith("**") && run.endsWith("**")) ||
          (run.startsWith("__") && run.endsWith("__")));
      segments.push(
        bold ? { text: run.slice(2, -2), bold: true } : { text: run },
      );
    }
  }
  return segments;
}

/** Render one line of inline markdown — bold emphasized, `code` colored. */
function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((segment, index) => {
        const key = `${index}-${segment.text}`;
        return (
          <Text
            key={key}
            color={segment.code ? COLORS.success : COLORS.value}
            bold={segment.bold}
          >
            {segment.text}
          </Text>
        );
      })}
    </>
  );
}

/** Render Claude's assistant prose as markdown: headings, bullets, code, text. */
function AgentMarkdown({ text }: { text: string }) {
  let inCode = false;
  return (
    <>
      {text.split("\n").map((line, index) => {
        const key = `l${index}`;
        if (/^\s*```/.test(line)) {
          inCode = !inCode;
          return null;
        }
        if (inCode) {
          return (
            <Text
              key={key}
              color={COLORS.success}
            >{`  ${line.trimEnd()}`}</Text>
          );
        }
        const trimmed = line.trim();
        if (!trimmed) return <Text key={key}> </Text>;
        const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
        if (heading) {
          return (
            <Text key={key} bold color={COLORS.secondary} wrap="wrap">
              {heading[1]}
            </Text>
          );
        }
        const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
        if (bullet) {
          return (
            <Text key={key} wrap="wrap">
              <Text color={COLORS.accent}>• </Text>
              <InlineText text={bullet[1]} />
            </Text>
          );
        }
        const numbered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
        if (numbered) {
          return (
            <Text key={key} wrap="wrap">
              <Text color={COLORS.accent}>{`${numbered[1]}. `}</Text>
              <InlineText text={numbered[2]} />
            </Text>
          );
        }
        return (
          <Text key={key} wrap="wrap">
            <InlineText text={line} />
          </Text>
        );
      })}
    </>
  );
}

/** Tool calls and errors hang off a turn as a tree; status notes do not. */
function isConnectorKind(kind: RunMessage["kind"]) {
  return kind === "tool" || kind === "error";
}

/** One entry in the run log — an assistant turn, or a tool/status/error note. */
function RunMessageView({
  message,
  first,
  lastInGroup,
}: {
  message: RunMessage;
  first: boolean;
  /** True when no further connector line follows — caps the group with `⎿`. */
  lastInGroup: boolean;
}) {
  if (message.kind === "assistant") {
    // Filled marker on the turn; prose hangs indented two columns beneath it,
    // with a blank line separating consecutive turns.
    return (
      <Box flexDirection="row" marginTop={first ? 0 : 1}>
        <Text bold color={COLORS.accent}>
          {"⏺ "}
        </Text>
        <Box flexGrow={1} flexDirection="column">
          <AgentMarkdown text={message.text} />
        </Box>
      </Box>
    );
  }
  // Wizard status notes are quiet, plain dim lines — they aren't Claude's
  // actions, so they don't get the tool-tree connector (which would dangle off
  // nothing). Only real tool calls and errors read as a branch under a turn.
  if (message.kind === "status" || message.kind === "info") {
    return (
      <Box flexDirection="row">
        <Text color={COLORS.help} dimColor wrap="truncate">
          {`  ${message.text}`}
        </Text>
      </Box>
    );
  }
  // Box-drawing trunk/cap so the group reads as one connected line: earlier
  // lines use the vertical `│`, and the last line caps it with the rounded
  // `╰`, whose vertical stroke joins the trunk seamlessly.
  const connector = lastInGroup ? "╰" : "│";
  return (
    <Box flexDirection="row">
      <Text
        color={message.kind === "error" ? COLORS.failure : COLORS.neutral}
        dimColor={message.kind === "tool"}
        wrap="truncate"
      >
        {`  ${connector} ${message.text}`}
      </Text>
    </Box>
  );
}

export function RunView({
  activeStep,
  messages,
  transientStatus,
  changedFiles,
  usageTokens,
  width,
  height,
}: {
  activeStep: string;
  messages: RunMessage[];
  transientStatus?: string;
  changedFiles: { path: string; op: "create" | "edit" }[];
  usageTokens: number;
  width: number;
  height: number;
}) {
  const isAgent = activeStep === "agent";
  const elapsed = useElapsed(isAgent);
  const panelRows = changedFiles.length
    ? Math.min(changedFiles.length, 6) + 1
    : 0;
  const budget = Math.max(height - 4 - panelRows, 4);
  const total = messages.length;
  // Offset from the newest line: 0 follows the tail; ↑/↓ scrolls the history.
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(total - 1, 0);
  const clamped = Math.min(offset, maxOffset);

  useInput((_input, key) => {
    if (key.upArrow) setOffset((o) => Math.min(o + 1, maxOffset));
    else if (key.downArrow) setOffset((o) => Math.max(o - 1, 0));
  });

  // Assistant lines wrap, so a single message can occupy several rows. Fill the
  // visible row budget from the newest message backwards so wrapped text is
  // shown in full instead of truncated, and the footer never gets pushed off.
  const end = total - clamped;
  const textWidth = Math.max(width - 2, 1);
  let used = 0;
  let start = end;
  for (let i = end - 1; i >= 0; i -= 1) {
    const message = messages[i];
    // Assistant prose spans multiple explicit lines, each of which wraps — count
    // rows per line (plus one for the blank line that separates turns) so the
    // visible window never over- or under-fills.
    const rows =
      message.kind === "assistant"
        ? 1 +
          message.text
            .split("\n")
            .reduce(
              (sum, line) =>
                sum + Math.max(1, Math.ceil(line.length / textWidth)),
              0,
            )
        : 1;
    if (used + rows > budget && start < end) break;
    used += rows;
    start = i;
  }
  const windowed = messages.slice(start, end);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text>
        {isAgent ? <Spinner /> : <Text color={COLORS.accent}>◉</Text>}
        <Text bold color={COLORS.value}>
          {"  "}
          {isAgent ? "Claude is installing Honch" : "Preparing install"}
        </Text>
        {isAgent ? (
          <Text color={COLORS.label}>{`  ·  ${formatElapsed(elapsed)}`}</Text>
        ) : null}
        {isAgent && usageTokens > 0 ? (
          <Text
            color={COLORS.label}
          >{`  ·  ${formatTokens(usageTokens)} tokens`}</Text>
        ) : null}
      </Text>
      <Box height={1} />
      {changedFiles.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor color={COLORS.label}>
            Changed files
          </Text>
          {changedFiles.slice(-6).map((file) => (
            <Text
              key={file.path}
              color={file.op === "create" ? COLORS.success : COLORS.accent}
              wrap="truncate"
            >
              {file.op === "create" ? "+ " : "~ "}
              {basename(file.path)}
            </Text>
          ))}
        </Box>
      ) : null}
      {total === 0 ? (
        <Text color={COLORS.help}>
          {isAgent
            ? "Waiting for Claude to inspect the project…"
            : "Analyzing project and preparing setup…"}
        </Text>
      ) : (
        <Box flexDirection="column">
          {start > 0 ? (
            <Text color={COLORS.help}>↑ {start} earlier</Text>
          ) : null}
          {windowed.map((message, index) => {
            // A connector line caps with `⎿` when the next message isn't part
            // of the same tool group (or there is none); otherwise `│`.
            const next = messages[start + index + 1];
            const lastInGroup = !next || !isConnectorKind(next.kind);
            return (
              <RunMessageView
                key={message.id}
                message={message}
                first={index === 0}
                lastInGroup={lastInGroup}
              />
            );
          })}
          {total - end > 0 ? (
            <Text color={COLORS.help}>↓ {total - end} more</Text>
          ) : null}
        </Box>
      )}
      {transientStatus ? (
        <>
          <Box flexGrow={1} />
          <Text color={COLORS.secondary}>
            <Spinner /> <Text dimColor>{transientStatus}</Text>
          </Text>
        </>
      ) : null}
    </Box>
  );
}
