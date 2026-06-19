import { Box, Text, useInput } from "ink";
import { useState, useSyncExternalStore } from "react";
import type { CliOptions } from "../cli/options.js";
import type {
  PromptRequest,
  TuiPrompter,
  WizardStep,
  WizardSummary,
} from "../cli/prompt.js";

const COLORS = {
  accent: "#ea5924",
  secondary: "#58a6ff",
  label: "#6f7895",
  value: "#d8dee9",
  neutral: "#8b93a7",
  success: "#8bd17c",
  failure: "#ff6b5f",
  help: "#a7adbb",
  rule: "#2d3545",
} as const;

const SIDEBAR_WIDTH = 18;

/** Adapt to the terminal width, clamped to a readable range. */
function layout() {
  const cols = Math.min(Math.max(process.stdout.columns ?? 80, 64), 96);
  const inner = cols - 4; // outer paddingX={2}
  const main = Math.max(inner - SIDEBAR_WIDTH - 3, 34); // gutter + left rule
  return { inner, main };
}

export function App({
  options,
  prompter,
  onCancel,
}: {
  options: CliOptions;
  prompter: TuiPrompter;
  onCancel: () => void;
}) {
  const snapshot = useSyncExternalStore(
    prompter.subscribe,
    prompter.getSnapshot,
  );
  const prompt = snapshot.currentPrompt;
  const { inner, main } = layout();

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === "c") {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box gap={2}>
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
            activeStep={activeStepLabel(snapshot.steps)}
            prompt={prompt}
            completed={snapshot.completed}
            error={snapshot.error}
            reportPath={snapshot.summary.reportPath}
            messages={snapshot.runMessages}
            onAnswer={(value) => prompter.answer(value)}
          />
        </Box>
      </Box>
      <Box height={1} />
      <Text color={COLORS.rule}>{rule(inner)}</Text>
      <Text color={COLORS.help}>↑/↓ move · enter select · ctrl+c exit</Text>
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
      <Box height={1} />
      <Fact label="Path" value={displayPath(options.installDir)} />
      <Fact label="SDK" value={summary.sdkTarget ?? "—"} />
      <Fact label="Device" value={summary.deviceModel ?? "—"} />
      <Fact label="Mode" value={summary.runMode ?? "dry run"} />
    </Box>
  );
}

function MainArea({
  width,
  activeStep,
  prompt,
  completed,
  error,
  reportPath,
  messages,
  onAnswer,
}: {
  width: number;
  activeStep: string;
  prompt?: PromptRequest;
  completed?: boolean;
  error?: string;
  reportPath?: string;
  messages: Array<{ id: number; text: string }>;
  onAnswer: (value: string) => void;
}) {
  if (error) return <ErrorView message={error} />;
  if (completed) return <DoneView width={width} reportPath={reportPath} />;
  if (prompt)
    return (
      <PromptView
        key={prompt.id}
        width={width}
        prompt={prompt}
        onAnswer={onAnswer}
      />
    );
  return <RunView activeStep={activeStep} messages={messages} width={width} />;
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
  const [focused, setFocused] = useState(0);

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
      <StepHeading title={mainTitle(prompt)} />
      <Box height={1} />
      <Text color={COLORS.help} wrap="wrap">
        {mainDescription(prompt)}
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

function RunView({
  activeStep,
  messages,
  width,
}: {
  activeStep: string;
  messages: Array<{ id: number; text: string }>;
  width: number;
}) {
  const isAgent = activeStep === "agent";
  return (
    <Box flexDirection="column">
      <StepHeading
        title={isAgent ? "Claude is installing Honch" : "Preparing install"}
      />
      <Box height={1} />
      {messages.length === 0 ? (
        <Text color={COLORS.help}>
          {isAgent
            ? "Waiting for Claude to inspect the project…"
            : "Analyzing project and preparing setup…"}
        </Text>
      ) : (
        messages.map((message) => (
          <Text key={message.id}>
            <Text color={COLORS.accent}>›</Text>{" "}
            <Text color={COLORS.value}>
              {truncate(message.text, width - 2)}
            </Text>
          </Text>
        ))
      )}
    </Box>
  );
}

function DoneView({
  width,
  reportPath,
}: {
  width: number;
  reportPath?: string;
}) {
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.success}>
        ✓ Setup flow complete
      </Text>
      <Box height={1} />
      <Text color={COLORS.help}>Report generated at</Text>
      <Text color={COLORS.value}>
        {truncate(reportPath ?? "honch-setup-report.md", width)}
      </Text>
    </Box>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.failure}>
        ✗ Wizard failed
      </Text>
      <Box height={1} />
      <Text color={COLORS.value} wrap="wrap">
        {message}
      </Text>
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
      return "Scan project";
    case "target":
      return "Detect SDK";
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

function mainTitle(prompt: PromptRequest) {
  if (prompt.title === "Choose SDK target") return "Detect the SDK target";
  if (prompt.title === "Review install plan") return "Review the install plan";
  return prompt.title;
}

function mainDescription(prompt: PromptRequest) {
  return prompt.message;
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
