import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CliOptions } from "../cli/options.js";
import type {
  PromptRequest,
  RunMessage,
  TuiPrompter,
  WizardStep,
  WizardSummary,
} from "../cli/prompt.js";
import { openReport } from "./open-report.js";
import {
  formatReportMarkdown,
  type ReportLine,
  reportFooterHint,
  visibleReportLines,
} from "./report-view.js";
import { RunView } from "./run-log.js";
import { COLORS } from "./theme.js";

const SIDEBAR_WIDTH = 24;

/** Fit to the live terminal size. */
function layout() {
  const cols = Math.max(process.stdout.columns ?? 80, 48);
  const rows = Math.max(process.stdout.rows ?? 24, 12);
  const inner = cols - 4; // outer paddingX={2}
  const main = Math.max(inner - SIDEBAR_WIDTH - 3, 30); // gutter + left rule
  return { inner, main, rows };
}

export function App({
  options,
  prompter,
  onCancel,
  onExit,
}: {
  options: CliOptions;
  prompter: TuiPrompter;
  onCancel: () => void;
  onExit: () => void;
}) {
  const snapshot = useSyncExternalStore(
    prompter.subscribe,
    prompter.getSnapshot,
  );
  const prompt = snapshot.currentPrompt;

  // Re-render (and re-read the terminal size) whenever the window resizes.
  const [, forceResize] = useState(0);
  useEffect(() => {
    const onResize = () => forceResize((n) => n + 1);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  const { inner, main, rows } = layout();
  const installing =
    activeStepLabel(snapshot.steps) === "agent" &&
    !prompt &&
    !snapshot.completed &&
    !snapshot.error &&
    !snapshot.cancelled;
  // A finished report or a surfaced error is a terminal screen the user just
  // dismisses; only a live run can be cancelled.
  const dismissable = Boolean(snapshot.completed) || Boolean(snapshot.error);
  const footer = snapshot.error
    ? "press enter to exit"
    : snapshot.completed &&
        (snapshot.summary.reportPath || snapshot.summary.tempProject)
      ? reportFooterHint(
          snapshot.summary.reportPath,
          snapshot.summary.tempProject,
        )
      : `↑/↓ move · enter select${installing ? " · esc stop Claude" : ""} · ctrl+c exit`;

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === "c") {
      // On a terminal screen, ctrl+c is just "I'm done" — exit cleanly.
      if (dismissable) onExit();
      else onCancel();
    } else if (dismissable && (input.toLowerCase() === "q" || key.return)) {
      onExit();
    } else if (key.escape) {
      prompter.interrupt();
    }
  });

  return (
    <Box
      flexDirection="column"
      height={rows}
      paddingX={2}
      paddingTop={1}
      paddingBottom={0}
    >
      <Box gap={2} flexGrow={1}>
        <Sidebar
          options={options}
          steps={snapshot.steps}
          summary={snapshot.summary}
        />
        <Box
          flexDirection="column"
          width={main}
          borderStyle="single"
          borderColor={COLORS.rule}
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={2}
        >
          <MainArea
            width={main - 3}
            height={rows - 3}
            activeStep={activeStepLabel(snapshot.steps)}
            prompt={prompt}
            completed={snapshot.completed}
            error={snapshot.error}
            cancelled={snapshot.cancelled}
            reportPath={snapshot.summary.reportPath}
            reportMarkdown={snapshot.summary.reportMarkdown}
            branch={snapshot.summary.branch}
            baseBranch={snapshot.summary.baseBranch}
            reverted={snapshot.summary.reverted}
            integrated={snapshot.summary.integrated}
            tempProject={snapshot.summary.tempProject}
            messages={snapshot.runMessages}
            changedFiles={snapshot.changedFiles}
            usageTokens={snapshot.usageTokens}
            tokenBudget={snapshot.tokenBudget}
            tokensUsedBaseline={snapshot.tokensUsedBaseline}
            agentStartedAt={snapshot.agentStartedAt}
            transientStatus={snapshot.transientStatus}
            onAnswer={(value) => prompter.answer(value)}
          />
        </Box>
      </Box>
      <Text color={COLORS.rule}>{rule(inner)}</Text>
      <Text color={COLORS.help}>{footer}</Text>
    </Box>
  );
}

function Sidebar({
  options,
  steps,
  summary,
}: {
  options: CliOptions;
  steps: WizardStep[];
  summary: WizardSummary;
}) {
  return (
    <Box width={SIDEBAR_WIDTH} flexDirection="column">
      <Box flexDirection="column">
        {steps.map((step) => (
          <Text key={step.id}>
            <Text color={stepColor(step.status)}>{stepGlyph(step.status)}</Text>
            <Text
              bold={step.status === "active"}
              color={step.status === "active" ? COLORS.accent : COLORS.value}
              dimColor={step.status === "pending"}
            >
              {" "}
              {timelineLabel(step)}
            </Text>
          </Text>
        ))}
      </Box>
      <Box flexGrow={1} />
      <Box flexDirection="column">
        <Fact label="Path" value={displayPath(options.installDir)} />
        <Fact label="SDK" value={summary.sdkTarget ?? "—"} />
        <Fact label="Device" value={summary.deviceModel ?? "—"} />
        <Fact label="Mode" value={summary.runMode ?? "dry run"} />
      </Box>
    </Box>
  );
}

function MainArea({
  width,
  height,
  activeStep,
  prompt,
  completed,
  error,
  cancelled,
  reportPath,
  reportMarkdown,
  branch,
  baseBranch,
  reverted,
  integrated,
  tempProject,
  messages,
  changedFiles,
  usageTokens,
  tokenBudget,
  tokensUsedBaseline,
  agentStartedAt,
  transientStatus,
  onAnswer,
}: {
  width: number;
  height: number;
  activeStep: string;
  prompt?: PromptRequest;
  completed?: boolean;
  error?: string;
  cancelled?: boolean;
  reportPath?: string;
  reportMarkdown?: string;
  branch?: string;
  baseBranch?: string;
  reverted?: boolean;
  integrated?: boolean;
  tempProject?: string;
  messages: RunMessage[];
  changedFiles: { path: string; op: "create" | "edit" }[];
  usageTokens: number;
  tokenBudget?: number;
  tokensUsedBaseline?: number;
  agentStartedAt?: number;
  transientStatus?: string;
  onAnswer: (value: string) => void;
}) {
  if (cancelled) return <CancelledView />;
  if (error) return <ErrorView message={error} />;
  if (completed)
    return (
      <DoneView
        width={width}
        height={height}
        reportPath={reportPath}
        reportMarkdown={reportMarkdown}
        branch={branch}
        baseBranch={baseBranch}
        reverted={reverted}
        integrated={integrated}
        tempProject={tempProject}
      />
    );
  if (prompt)
    return (
      <PromptView
        key={prompt.id}
        width={width}
        prompt={prompt}
        onAnswer={onAnswer}
      />
    );
  return (
    <RunView
      activeStep={activeStep}
      messages={messages}
      changedFiles={changedFiles}
      usageTokens={usageTokens}
      tokenBudget={tokenBudget}
      tokensUsedBaseline={tokensUsedBaseline}
      agentStartedAt={agentStartedAt}
      transientStatus={transientStatus}
      width={width}
      height={height}
    />
  );
}

function PromptView({
  width,
  prompt,
  onAnswer,
}: {
  width: number;
  prompt: PromptRequest;
  onAnswer: (value: string) => void;
}) {
  if (prompt.kind === "select" || prompt.kind === "confirm") {
    return <Picker width={width} prompt={prompt} onAnswer={onAnswer} />;
  }
  return <TextInput width={width} prompt={prompt} onAnswer={onAnswer} />;
}

function Picker({
  width,
  prompt,
  onAnswer,
}: {
  width: number;
  prompt: PromptRequest;
  onAnswer: (value: string) => void;
}) {
  const initial = prompt.defaultValue
    ? Math.max(
        prompt.options.findIndex((o) => o.value === prompt.defaultValue),
        0,
      )
    : 0;
  const [focused, setFocused] = useState(initial);

  useInput((_input, key) => {
    if (key.upArrow) {
      setFocused((current) =>
        current === 0 ? prompt.options.length - 1 : current - 1,
      );
    }
    if (key.downArrow) {
      setFocused((current) =>
        current === prompt.options.length - 1 ? 0 : current + 1,
      );
    }
    if (key.return) {
      const option = prompt.options[focused];
      if (option) onAnswer(option.value);
    }
  });

  const hint = prompt.options[focused]?.hint;

  return (
    <Box flexDirection="column">
      <StepHeading title={prompt.title} />
      <Box height={1} />
      <Text color={COLORS.help} wrap="wrap">
        {prompt.message}
      </Text>
      <Box height={1} />
      {prompt.options.map((option, index) => {
        const active = index === focused;
        return (
          <Text key={option.value}>
            <Text color={active ? COLORS.accent : COLORS.neutral}>
              {active ? "›" : " "}
            </Text>
            <Text bold={active} color={active ? COLORS.value : COLORS.neutral}>
              {" "}
              {option.label}
            </Text>
            {option.badge ? (
              <Text color={COLORS.success}> {option.badge}</Text>
            ) : null}
          </Text>
        );
      })}
      {hint ? (
        <Box marginTop={1}>
          <Text color={COLORS.help}>{truncate(hint, width)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function TextInput({
  width,
  prompt,
  onAnswer,
}: {
  width: number;
  prompt: PromptRequest;
  onAnswer: (value: string) => void;
}) {
  const [value, setValue] = useState(prompt.defaultValue ?? "");

  useInput((input, key) => {
    if (key.return) {
      onAnswer(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      setValue((current) => `${current}${input}`);
    }
  });

  const visibleValue =
    prompt.kind === "password" ? "*".repeat(value.length) : value;

  return (
    <Box flexDirection="column">
      <StepHeading title={inputLabel(prompt)} />
      <Box height={1} />
      <Text>
        <Text color={COLORS.secondary}>{"›"}</Text>{" "}
        <Text color={COLORS.value}>{visibleValue}</Text>
        <Text color={COLORS.accent}>▏</Text>
      </Text>
      <Text color={COLORS.rule}>{rule(Math.min(width, 40))}</Text>
    </Box>
  );
}

function StepHeading({ title }: { title: string }) {
  return (
    <Text>
      <Text color={COLORS.accent}>◉</Text>
      <Text bold color={COLORS.value}>
        {"  "}
        {title}
      </Text>
    </Text>
  );
}

function DoneView({
  width,
  height,
  reportPath,
  reportMarkdown,
  branch,
  baseBranch,
  reverted,
  integrated,
  tempProject,
}: {
  width: number;
  height: number;
  reportPath?: string;
  reportMarkdown?: string;
  branch?: string;
  baseBranch?: string;
  reverted?: boolean;
  integrated?: boolean;
  tempProject?: string;
}) {
  const base = baseBranch ?? "your branch";
  const lines = useMemo(
    () => formatReportMarkdown(reportMarkdown ?? ""),
    [reportMarkdown],
  );
  const notInstalled = integrated === false;
  const headerRows =
    (branch ? 8 : 5) + (notInstalled ? 1 : 0) + (tempProject ? 2 : 0);
  const reportHeight = Math.max(height - headerRows, 4);
  const [scroll, setScroll] = useState(0);
  const windowed = visibleReportLines(lines, reportHeight, scroll);

  useInput((input, key) => {
    if (key.upArrow) setScroll((current) => Math.max(current - 1, 0));
    else if (key.downArrow) {
      setScroll((current) => Math.min(current + 1, windowed.maxOffset));
    } else if (input.toLowerCase() === "e") {
      // In Try mode, "e" opens the scratch project folder; otherwise the report.
      const openTarget = tempProject ?? reportPath;
      if (openTarget) openReport(openTarget);
    }
  });

  if (reverted) {
    return (
      <Box flexDirection="column">
        <Text bold color={COLORS.neutral}>
          ↩ Reverted Claude's changes
        </Text>
        <Box height={1} />
        <Text color={COLORS.help} wrap="wrap">
          Your project is back to how it was before the install. Run honch again
          whenever you're ready.
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {notInstalled ? (
        <Box flexDirection="column">
          <Text bold color={COLORS.accent}>
            ⚠ Honch was not installed
          </Text>
          <Text color={COLORS.help} wrap="wrap">
            Claude didn't change any files in this project — see the report
            below for why.
          </Text>
        </Box>
      ) : (
        <Text bold color={COLORS.success}>
          ✓ Setup flow complete
        </Text>
      )}
      <Box height={1} />
      {tempProject ? (
        <Box flexDirection="column">
          <Text color={COLORS.help}>Tried Honch in a temporary project at</Text>
          <Text color={COLORS.value}>{truncate(tempProject, width)}</Text>
          <Box height={1} />
        </Box>
      ) : null}
      <Text color={COLORS.help}>Report generated at</Text>
      <Text color={COLORS.value}>
        {truncate(reportPath ?? "honch-setup-report.md", width)}
      </Text>
      {branch ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.help}>
            Claude's changes are committed on{" "}
            <Text color={COLORS.value}>{branch}</Text>
          </Text>
          <Text color={COLORS.help}>
            review <Text color={COLORS.value}>git diff {base}</Text>
          </Text>
          <Text color={COLORS.help}>
            merge <Text color={COLORS.value}>git merge {branch}</Text> · discard{" "}
            <Text color={COLORS.value}>git checkout {base}</Text>
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {windowed.before > 0 ? (
          <Text color={COLORS.help}>↑ {windowed.before} earlier</Text>
        ) : null}
        {windowed.lines.map((line) => (
          <MarkdownLine key={line.id} line={line} width={width} />
        ))}
        {windowed.after > 0 ? (
          <Text color={COLORS.help}>↓ {windowed.after} more</Text>
        ) : null}
      </Box>
    </Box>
  );
}

function MarkdownLine({ line, width }: { line: ReportLine; width: number }) {
  if (line.kind === "blank") return <Text> </Text>;
  if (line.kind === "h1") {
    // Render the document title as a styled heading — no literal "#".
    return (
      <Text bold color={COLORS.accent} wrap="wrap">
        {line.text.toUpperCase()}
      </Text>
    );
  }
  if (line.kind === "h2") {
    // Section headings: bold + colored, with a leading marker glyph (not "##").
    return (
      <Text wrap="wrap">
        <Text color={COLORS.secondary}>▌</Text>{" "}
        <Text bold color={COLORS.secondary}>
          {line.text}
        </Text>
      </Text>
    );
  }
  if (line.kind === "bullet") {
    return (
      <Text wrap="truncate">
        <Text color={COLORS.accent}>•</Text>{" "}
        <MarkdownSegments line={line} width={width - 2} />
      </Text>
    );
  }
  return (
    <Text wrap="truncate">
      <MarkdownSegments line={line} width={width} />
    </Text>
  );
}

function MarkdownSegments({
  line,
  width,
}: {
  line: ReportLine;
  width: number;
}) {
  let remaining = width;
  return (
    <>
      {line.segments.map((segment) => {
        if (remaining <= 0) return null;
        const shown = clip(segment.text, remaining);
        remaining = Math.max(remaining - shown.length, 0);
        return (
          <Text
            key={`${segment.code}-${segment.text}`}
            color={segment.code ? COLORS.success : COLORS.value}
            bold={segment.code}
          >
            {shown}
          </Text>
        );
      })}
    </>
  );
}

function clip(value: string, maxLength: number) {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength === 1) return "…";
  return `${value.slice(0, maxLength - 1)}…`;
}

function CancelledView() {
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.neutral}>
        ◌ Wizard cancelled
      </Text>
      <Box height={1} />
      <Text color={COLORS.help} wrap="wrap">
        No further changes will be made. Run honch again any time to pick up
        where you left off.
      </Text>
    </Box>
  );
}

/** Turn a raw failure string into a calm, human-readable screen. Quota/rate
 * limits read as an "expected" amber notice, not a red crash. */
function describeFailure(message: string): {
  title: string;
  tone: "limit" | "error";
  lines: string[];
} {
  const lower = message.toLowerCase();
  if (lower.includes("budget") && lower.includes("token")) {
    return {
      title: "Daily install limit reached",
      tone: "limit",
      lines: [
        "You've used today's free Honch wizard budget.",
        "Anything done so far is saved — try again tomorrow, or follow the setup report to finish by hand.",
      ],
    };
  }
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate-limit")
  ) {
    return {
      title: "Claude is busy right now",
      tone: "limit",
      lines: [
        "Claude's API is rate-limited or briefly unavailable.",
        "Give it a minute, then run honch again.",
      ],
    };
  }
  return { title: "Wizard failed", tone: "error", lines: [message] };
}

function ErrorView({ message }: { message: string }) {
  const { title, tone, lines } = describeFailure(message);
  const color = tone === "limit" ? COLORS.accent : COLORS.failure;
  return (
    <Box flexDirection="column">
      <Text bold color={color}>
        {tone === "limit" ? "⏳" : "✗"} {title}
      </Text>
      <Box height={1} />
      {lines.map((line) => (
        <Text key={line} color={COLORS.value} wrap="wrap">
          {line}
        </Text>
      ))}
    </Box>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <Text>
      <Text color={COLORS.label}>{label.padEnd(7)}</Text>
      <Text color={value ? COLORS.value : COLORS.neutral}>
        {truncate(value ?? "—", SIDEBAR_WIDTH - 7)}
      </Text>
    </Text>
  );
}

function stepGlyph(status: WizardStep["status"]) {
  if (status === "done") return "✓";
  if (status === "active") return "●";
  return "○";
}

function stepColor(status: WizardStep["status"]) {
  if (status === "done") return COLORS.success;
  if (status === "active") return COLORS.accent;
  return COLORS.neutral;
}

function timelineLabel(step: WizardStep) {
  switch (step.id) {
    case "scan":
      return "Welcome";
    case "target":
      return "Select SDK";
    case "auth":
      return "Connect";
    case "project":
      return "Project";
    case "config":
      return "Configure";
    case "confirm":
      return "Confirm";
    case "agent":
      return "Install";
    case "report":
      return "Report";
    default:
      return step.label;
  }
}

function activeStepLabel(steps: WizardStep[]) {
  return steps.find((step) => step.status === "active")?.id ?? "auth";
}

function inputLabel(prompt: PromptRequest) {
  return prompt.message.replace(/:$/, "");
}

function displayPath(path: string) {
  const home = process.env.HOME;
  const shown =
    home && path.startsWith(home) ? `~${path.slice(home.length) || "/"}` : path;
  // Prefer the trailing segment when it would otherwise be truncated away.
  if (shown.length <= SIDEBAR_WIDTH - 7) return shown;
  const tail = shown.split("/").filter(Boolean).pop() ?? shown;
  return tail;
}

function rule(width: number) {
  return "─".repeat(Math.max(width, 0));
}

function truncate(value: string, maxLength: number) {
  if (maxLength <= 1 || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
