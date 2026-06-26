import { Box, Text, useInput } from "ink";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { COLORS, GLYPHS } from "./theme.js";

const SIDEBAR_WIDTH = 24;

/** The minimum terminal size for the full wizard layout (sidebar timeline +
 * main column). Below this we don't degrade into a cramped view — we ask the
 * user to resize, so the experience is either complete or a clear prompt. */
export const MIN_TERMINAL = { width: 60, height: 20 } as const;

export function isTerminalTooSmall(cols: number, rows: number): boolean {
  return cols < MIN_TERMINAL.width || rows < MIN_TERMINAL.height;
}

/** Fit to the live terminal size. */
function layout() {
  const rawCols = process.stdout.columns ?? 80;
  const rawRows = process.stdout.rows ?? 24;
  const cols = Math.max(rawCols, 24);
  const rows = Math.max(rawRows, 12);
  const inner = cols - 4; // outer paddingX={2}
  const main = Math.max(inner - SIDEBAR_WIDTH - 3, 30); // gutter + left rule
  return {
    inner,
    main,
    rows,
    rawCols,
    rawRows,
    tooSmall: isTerminalTooSmall(rawCols, rawRows),
  };
}

export type TextEditState = { value: string; cursor: number };

/** Apply one keypress to a text field with a cursor. Pure and exported so the
 * editing logic is unit-testable without rendering Ink. Supports mid-string
 * insertion, left/right cursor movement, backspace-at-cursor, and ctrl+U clear.
 * Backspace and delete both delete the character before the cursor — terminals
 * disagree on which code the Backspace key sends, so lumping them avoids a
 * platform-specific regression (forward-delete isn't worth that risk). */
export function editText(
  state: TextEditState,
  key: {
    leftArrow?: boolean;
    rightArrow?: boolean;
    backspace?: boolean;
    delete?: boolean;
    ctrl?: boolean;
    meta?: boolean;
  },
  input: string,
): TextEditState {
  const { value, cursor } = state;
  if (key.leftArrow) return { value, cursor: Math.max(0, cursor - 1) };
  if (key.rightArrow)
    return { value, cursor: Math.min(value.length, cursor + 1) };
  if (key.ctrl && input.toLowerCase() === "u") return { value: "", cursor: 0 };
  if (key.backspace || key.delete) {
    if (cursor === 0) return state;
    return {
      value: value.slice(0, cursor - 1) + value.slice(cursor),
      cursor: cursor - 1,
    };
  }
  if (key.ctrl || key.meta || !input) return state;
  return {
    value: value.slice(0, cursor) + input + value.slice(cursor),
    cursor: cursor + input.length,
  };
}

export type KeyAction = "exit" | "cancel" | "interrupt" | "none";

/** Map a keypress to an action given the current screen. Pure and exported so
 * the key map is unit-testable without rendering Ink.
 *
 * ctrl+c is the single cancel/exit key (it lands on the calm CancelledView mid-
 * flow, or exits a terminal screen). ESC pauses the agent run, but during a
 * (non-run) prompt it is intentionally a no-op: it used to silently cancel the
 * whole wizard, which surprised users reaching for ESC as "go back" and cost
 * them the run. */
export function resolveKeyAction(
  key: { ctrl?: boolean; escape?: boolean; return?: boolean },
  input: string,
  state: { dismissable: boolean; installing: boolean; hasPrompt: boolean },
): KeyAction {
  if (key.ctrl && input.toLowerCase() === "c") {
    return state.dismissable ? "exit" : "cancel";
  }
  if (state.dismissable && (input.toLowerCase() === "q" || key.return)) {
    return "exit";
  }
  if (key.escape && state.installing) return "interrupt";
  return "none";
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

  const { inner, main, rows, rawCols, rawRows, tooSmall } = layout();
  const installing =
    activeStepLabel(snapshot.steps) === "agent" &&
    !prompt &&
    !snapshot.completed &&
    !snapshot.error &&
    !snapshot.cancelled;
  // A finished report, a surfaced error, or a deliberate cancel is a terminal
  // screen the user just dismisses; only a live run/prompt can be cancelled.
  const dismissable =
    Boolean(snapshot.completed) ||
    Boolean(snapshot.error) ||
    Boolean(snapshot.cancelled);
  // Honest, context-aware footer: only advertise keys that work on THIS screen.
  const footer = snapshot.error
    ? "press enter to exit"
    : snapshot.cancelled
      ? "press enter to exit"
      : snapshot.completed &&
          (snapshot.summary.reportPath || snapshot.summary.tempProject)
        ? reportFooterHint(
            snapshot.summary.reportPath,
            snapshot.summary.tempProject,
          )
        : installing
          ? "↑/↓ scroll · esc pause · ctrl+c cancel"
          : "↑/↓ move · enter select · ctrl+c cancel";

  useInput((input, key) => {
    const action = resolveKeyAction(key, input, {
      dismissable,
      installing,
      hasPrompt: Boolean(prompt),
    });
    if (action === "exit") onExit();
    else if (action === "cancel") onCancel();
    else if (action === "interrupt") prompter.interrupt();
  });

  // Below the minimum, don't render a cramped layout — show a centered prompt
  // with the current size and the size we need. (All hooks above run first so
  // this conditional return is safe.)
  if (tooSmall) return <TooSmallNotice cols={rawCols} rows={rawRows} />;

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

function TooSmallNotice({ cols, rows }: { cols: number; rows: number }) {
  return (
    <Box
      height={Math.max(rows, 1)}
      width={Math.max(cols, 1)}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <Text bold color={COLORS.value}>
        Terminal too small
      </Text>
      <Text color={COLORS.help}>{`Now ${cols} × ${rows}`}</Text>
      <Text color={COLORS.help}>
        {`Resize to at least ${MIN_TERMINAL.width} × ${MIN_TERMINAL.height}`}
      </Text>
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
        <Fact
          label="Path"
          value={displayPath(summary.installDir ?? options.installDir)}
        />
        <Fact label="SDK" value={summary.sdkTarget ?? "—"} />
        <Fact label="Device" value={summary.deviceModel ?? "—"} />
        <Fact label="Mode" value={summary.runMode ?? "Preview (dry run)"} />
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
  if (prompt.kind === "multiselect") {
    return <FeaturePicker width={width} prompt={prompt} onAnswer={onAnswer} />;
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

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const CORE_JOKE =
  "hey man, what's the point of using our SDK without the heart of it?";

/** The "Pick your features" multi-select. Matches the Picker style (heading +
 * rows + spacing, no dividers). The core row is locked: trying to toggle it off
 * flashes a friendly warning instead of disabling it. */
function FeaturePicker({
  width,
  prompt,
  onAnswer,
}: {
  width: number;
  prompt: PromptRequest;
  onAnswer: (value: string) => void;
}) {
  const options = prompt.options;
  const [enabled, setEnabled] = useState<Set<string>>(
    () =>
      new Set(options.filter((o) => o.checked !== false).map((o) => o.value)),
  );
  const [focused, setFocused] = useState(0);
  // Bumped each time the user tries to toggle the locked core; the effect shows
  // the warning once, holds it for ~2s, then clears it.
  const [jokeTrigger, setJokeTrigger] = useState(0);
  const [jokeOn, setJokeOn] = useState(false);

  useEffect(() => {
    if (jokeTrigger === 0) return;
    setJokeOn(true);
    const timer = setTimeout(() => setJokeOn(false), 2000);
    return () => clearTimeout(timer);
  }, [jokeTrigger]);

  useInput((input, key) => {
    if (key.upArrow) {
      setFocused((c) => (c === 0 ? options.length - 1 : c - 1));
    } else if (key.downArrow) {
      setFocused((c) => (c === options.length - 1 ? 0 : c + 1));
    } else if (input === " ") {
      const option = options[focused];
      if (!option) return;
      if (option.locked) {
        setJokeTrigger((t) => t + 1);
        return;
      }
      setEnabled((current) => {
        const next = new Set(current);
        if (next.has(option.value)) next.delete(option.value);
        else next.add(option.value);
        return next;
      });
    } else if (key.return) {
      onAnswer([...enabled].join(","));
    }
  });

  let totalFlash = 0;
  let totalRam = 0;
  for (const option of options) {
    if (!enabled.has(option.value)) continue;
    totalFlash += option.flashBytes ?? 0;
    totalRam += option.ramBytes ?? 0;
  }

  // Roll the displayed totals quickly up/down toward the new target when a
  // feature is toggled — a brief "counting" shuffle instead of a hard snap.
  const [animFlash, setAnimFlash] = useState(totalFlash);
  const [animRam, setAnimRam] = useState(totalRam);
  const flashRef = useRef(totalFlash);
  const ramRef = useRef(totalRam);
  useEffect(() => {
    const startFlash = flashRef.current;
    const startRam = ramRef.current;
    if (startFlash === totalFlash && startRam === totalRam) return;
    const steps = 12;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      const done = i >= steps;
      const t = i / steps;
      const flash = done
        ? totalFlash
        : Math.round(startFlash + (totalFlash - startFlash) * t);
      const ram = done
        ? totalRam
        : Math.round(startRam + (totalRam - startRam) * t);
      flashRef.current = flash;
      ramRef.current = ram;
      setAnimFlash(flash);
      setAnimRam(ram);
      if (done) clearInterval(id);
    }, 22);
    return () => clearInterval(id);
  }, [totalFlash, totalRam]);

  return (
    <Box flexDirection="column">
      <StepHeading title={prompt.title} />
      <Box height={1} />
      <Text color={COLORS.help} wrap="wrap">
        {prompt.message}
      </Text>
      <Box height={1} />
      {options.map((option, index) => {
        const active = index === focused;
        const on = enabled.has(option.value);
        // The core renders like an enabled row ([x], accent) but is locked off —
        // toggling it flashes the joke instead. Its stat reads "(required)".
        const box = option.locked || on ? "[x]" : "[ ]";
        const boxColor = option.locked || on ? COLORS.accent : COLORS.neutral;
        const hasStat =
          (option.flashBytes ?? 0) > 0 || (option.ramBytes ?? 0) > 0;
        const stat = option.locked
          ? "(required)"
          : hasStat
            ? `+${formatBytes(option.flashBytes ?? 0)} flash${
                (option.ramBytes ?? 0) > 0
                  ? ` · ${formatBytes(option.ramBytes ?? 0)} RAM`
                  : ""
              }`
            : "";
        return (
          <Text key={option.value}>
            <Text color={active ? COLORS.accent : COLORS.neutral}>
              {active ? "›" : " "}
            </Text>
            <Text color={boxColor}> {box}</Text>
            <Text bold={active} color={active ? COLORS.value : COLORS.neutral}>
              {" "}
              {option.label}
            </Text>
            <Text color={COLORS.neutral}> {stat}</Text>
          </Text>
        );
      })}
      <Box height={1} />
      <Text color={COLORS.help}>
        Selected optional features add{" "}
        <Text color={COLORS.value}>
          {formatBytes(animFlash)} flash · {formatBytes(animRam)} RAM
        </Text>{" "}
        (estimated)
      </Text>
      <Box height={1} />
      {jokeOn ? (
        <Text color={COLORS.warning}>{CORE_JOKE}</Text>
      ) : (
        <Text> </Text>
      )}
      <Box marginTop={1}>
        <Text color={COLORS.help}>
          {truncate(
            "space toggles · ↑↓ moves · enter confirms — all on is the default SDK",
            width,
          )}
        </Text>
      </Box>
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
  const [state, setState] = useState<TextEditState>(() => ({
    value: prompt.defaultValue ?? "",
    cursor: (prompt.defaultValue ?? "").length,
  }));

  useInput((input, key) => {
    if (key.return) {
      onAnswer(state.value);
      return;
    }
    setState((current) => editText(current, key, input));
  });

  // A password field shows just the caret — never per-character masking, which
  // would leak the secret's length. The "(input hidden)" note below explains
  // the empty field. Other fields show the value with the caret at the cursor.
  const masked = prompt.kind === "password";
  const before = masked ? "" : state.value.slice(0, state.cursor);
  const after = masked ? "" : state.value.slice(state.cursor);

  // Mirror the Picker: a title heading, then the question as a message line —
  // so select and text prompts read the same. Skip the message when it would
  // just repeat the heading (an unrecognized prompt whose title is itself).
  const showMessage = prompt.message && prompt.message !== prompt.title;
  return (
    <Box flexDirection="column">
      <StepHeading title={prompt.title} />
      <Box height={1} />
      {showMessage ? (
        <>
          <Text color={COLORS.help} wrap="wrap">
            {prompt.message}
          </Text>
          <Box height={1} />
        </>
      ) : null}
      <Text>
        <Text color={COLORS.secondary}>{"›"}</Text>{" "}
        <Text color={COLORS.value}>{before}</Text>
        <Text color={COLORS.accent}>▏</Text>
        <Text color={COLORS.value}>{after}</Text>
      </Text>
      <Text color={COLORS.rule}>{rule(Math.min(width, 40))}</Text>
      {prompt.kind === "password" ? (
        <Text color={COLORS.help} dimColor>
          (input hidden)
        </Text>
      ) : null}
    </Box>
  );
}

function StepHeading({ title }: { title: string }) {
  return (
    <Text>
      <Text color={COLORS.accent}>{GLYPHS.heading}</Text>
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
    (branch ? 8 : 5) + (notInstalled ? 1 : 0) + (tempProject ? 3 : 0);
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
          {GLYPHS.reverted} Reverted Claude's changes
        </Text>
        <Box height={1} />
        <Text color={COLORS.help} wrap="wrap">
          Your project is back to how it was before the install. Run honch again
          whenever you're ready.
        </Text>
      </Box>
    );
  }
  // Outcome-specific success header. Try mode and a real integrated install each
  // get concrete copy; a dry run / non-git run (integrated undefined) stays
  // neutral; the not-installed case keeps its amber warning.
  const successHeader = tempProject
    ? "Honch is running in your scratch project"
    : integrated === true
      ? "Honch is installed"
      : "Setup flow complete";
  return (
    <Box flexDirection="column">
      {notInstalled ? (
        <Box flexDirection="column">
          <Text bold color={COLORS.accent}>
            {GLYPHS.warn} Honch was not installed
          </Text>
          <Text color={COLORS.help} wrap="wrap">
            Claude didn't change any files in this project — see the report
            below for why.
          </Text>
        </Box>
      ) : (
        <Text bold color={COLORS.success}>
          {GLYPHS.success} {successHeader}
        </Text>
      )}
      <Box height={1} />
      {tempProject ? (
        <Box flexDirection="column">
          <Text color={COLORS.help}>Tried Honch in a temporary project at</Text>
          <Text color={COLORS.value}>{truncate(tempProject, width)}</Text>
          <Text color={COLORS.help} wrap="wrap">
            This is a temporary scratch project — copy it somewhere permanent to
            keep it.
          </Text>
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
        {GLYPHS.cancelled} Wizard cancelled
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
 * limits read as an "expected" amber notice, not a red crash. Exported for
 * tests; not used outside this module. */
export function describeFailure(message: string): {
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
  if (
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("offline") ||
    lower.includes("getaddrinfo")
  ) {
    return {
      title: "Can't reach Honch",
      tone: "limit",
      lines: [
        "Can't reach Honch — check your connection and try again.",
        "Nothing was changed; run honch again once you're back online.",
      ],
    };
  }
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("token expired") ||
    lower.includes("expired") ||
    lower.includes("authentication") ||
    lower.includes("auth failed")
  ) {
    return {
      title: "Sign-in expired",
      tone: "limit",
      lines: [
        "Your Honch sign-in expired or was rejected.",
        "Run honch again to sign in fresh.",
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
        {tone === "limit" ? GLYPHS.limit : GLYPHS.error} {title}
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
  if (status === "done") return GLYPHS.stepDone;
  if (status === "active") return GLYPHS.stepActive;
  return GLYPHS.stepPending;
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

function displayPath(path: string) {
  const home = process.env.HOME;
  const shown =
    home && path.startsWith(home) ? `~${path.slice(home.length) || "/"}` : path;
  const max = SIDEBAR_WIDTH - 7;
  if (shown.length <= max) return shown;
  // Middle-ellipsis: keep the leading anchor (e.g. "~/dev") AND the trailing
  // folder, collapsing the middle, so two same-named dirs stay distinguishable
  // (e.g. "~/dev/…/firmware") instead of both showing as just "firmware".
  return middleEllipsis(shown, max);
}

/** Collapse the middle of a path with "…", preserving its first segment and its
 * leaf so distinct deep paths don't render identically. */
function middleEllipsis(value: string, max: number) {
  if (value.length <= max || max < 5) return truncate(value, max);
  const segments = value.split("/");
  const leaf = segments[segments.length - 1] ?? value;
  const head = segments[0] || "/";
  const candidate = `${head}/…/${leaf}`;
  if (candidate.length <= max) return candidate;
  // Even head + leaf is too long — keep the leaf, ellipsize its front.
  const keep = Math.max(max - 2, 1);
  return `…/${leaf.slice(Math.max(leaf.length - keep, 0))}`;
}

function rule(width: number) {
  return "─".repeat(Math.max(width, 0));
}

function truncate(value: string, maxLength: number) {
  if (maxLength <= 1 || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
