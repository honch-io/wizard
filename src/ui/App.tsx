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

const WIDTH = 76;
const SIDEBAR_WIDTH = 22;
const MAIN_WIDTH = 48;

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

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === "c") {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header />
      <Box height={1} />
      <Box gap={2}>
        <Sidebar
          options={options}
          steps={snapshot.steps}
          summary={snapshot.summary}
        />
        <Text color={COLORS.rule}>{verticalRule(26)}</Text>
        <Box width={MAIN_WIDTH} flexDirection="column">
          <MainArea
            prompt={prompt}
            completed={snapshot.completed}
            error={snapshot.error}
            reportPath={snapshot.summary.reportPath}
            messages={snapshot.runMessages}
            onAnswer={(value) => prompter.answer(value)}
          />
          <Box height={2} />
          <InstallPlan activeStep={activeStepLabel(snapshot.steps)} />
        </Box>
      </Box>
      <Box height={1} />
      <Text color={COLORS.rule}>{rule(WIDTH)}</Text>
      <Text color={COLORS.help}>↑/↓ navigate | enter select | ctrl+c exit</Text>
    </Box>
  );
}

function Header() {
  return (
    <Box flexDirection="column" width={WIDTH}>
      <Text>
        <Text bold color={COLORS.accent}>
          HONCHO
        </Text>
        <Text bold color={COLORS.value}>
          {" "}
          WIZARD
        </Text>
        <Text color={COLORS.help}> AI SDK Installer</Text>
      </Text>
      <Text color={COLORS.rule}>{rule(WIDTH)}</Text>
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
      <Timeline steps={steps} />
      <Box height={2} />
      <Text bold color={COLORS.secondary}>
        Project
      </Text>
      <Fact label="Path" value={displayPath(options.installDir)} />
      <Fact label="SDK" value={summary.sdkTarget ?? "Detecting"} />
      <Fact label="Target" value={summary.deviceModel ?? "Pending"} />
      <Fact label="Mode" value={summary.runMode ?? "Dry Run"} />
    </Box>
  );
}

function Timeline({ steps }: { steps: WizardStep[] }) {
  return (
    <Box flexDirection="column">
      {steps.map((step, index) => (
        <Box key={step.id} flexDirection="column">
          <Text>
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
          {step.status === "active" ? (
            <Text color={COLORS.help}>│ In progress</Text>
          ) : index < steps.length - 1 ? (
            <Text color={step.status === "done" ? COLORS.success : COLORS.rule}>
              │
            </Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

function MainArea({
  prompt,
  completed,
  error,
  reportPath,
  messages,
  onAnswer,
}: {
  prompt?: PromptRequest;
  completed?: boolean;
  error?: string;
  reportPath?: string;
  messages: Array<{ id: number; text: string }>;
  onAnswer: (value: string) => void;
}) {
  if (error) return <ErrorView message={error} />;
  if (completed) return <DoneView reportPath={reportPath} />;
  if (prompt)
    return <PromptView key={prompt.id} prompt={prompt} onAnswer={onAnswer} />;
  return <RunView messages={messages} />;
}

function PromptView({
  prompt,
  onAnswer,
}: {
  prompt: PromptRequest;
  onAnswer: (value: string) => void;
}) {
  if (prompt.kind === "select" || prompt.kind === "confirm") {
    return <Picker prompt={prompt} onAnswer={onAnswer} />;
  }

  return <TextInput prompt={prompt} onAnswer={onAnswer} />;
}

function Picker({
  prompt,
  onAnswer,
}: {
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

  return (
    <Box flexDirection="column">
      <StepHeading title={mainTitle(prompt)} />
      <Box height={1} />
      <Text color={COLORS.help}>{mainDescription(prompt)}</Text>
      <Box height={2} />
      {prompt.options.map((option, index) => {
        const active = index === focused;
        return (
          <Text key={option.value}>
            <Text color={active ? COLORS.accent : COLORS.neutral}>
              {active ? ">" : " "}
            </Text>
            <Text
              bold={active}
              color={active ? COLORS.value : COLORS.neutral}
              dimColor={!active}
            >
              {" "}
              {option.label}
            </Text>
            {option.hint ? (
              <Text color={COLORS.help}> {truncate(option.hint, 28)}</Text>
            ) : null}
          </Text>
        );
      })}
      <HelperInfo />
    </Box>
  );
}

function TextInput({
  prompt,
  onAnswer,
}: {
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
      <StepHeading title={mainTitle(prompt)} />
      <Box height={1} />
      <Text color={COLORS.help}>{mainDescription(prompt)}</Text>
      <Box height={2} />
      <Text bold color={COLORS.secondary}>
        {inputLabel(prompt)}
      </Text>
      <Text>
        <Text color={COLORS.secondary}>{">"}</Text>{" "}
        <Text color={COLORS.value}>{visibleValue}</Text>
        <Text color={COLORS.value}>_</Text>
      </Text>
      <Text color={COLORS.secondary}>{rule(44)}</Text>
      <HelperInfo />
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

function HelperInfo() {
  return (
    <Box flexDirection="column" marginTop={2}>
      <Text color={COLORS.help}>
        <Text color={COLORS.secondary}>lock</Text> Credentials are encrypted
      </Text>
      <Text color={COLORS.help}>
        <Text color={COLORS.secondary}>sync</Text> Project will sync
        automatically
      </Text>
      <Text color={COLORS.help}>
        <Text color={COLORS.secondary}>zap </Text> Account can be changed later
      </Text>
    </Box>
  );
}

function InstallPlan({ activeStep }: { activeStep: string }) {
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.secondary}>
        What happens next?
      </Text>
      <Box height={1} />
      <PlanLine
        items={[
          ["auth", "1 Authenticate"],
          ["project", "2 Register Project"],
        ]}
        activeStep={activeStep}
      />
      <PlanLine
        items={[
          ["config", "3 Configure Device"],
          ["agent", "4 Install AI Runtime"],
        ]}
        activeStep={activeStep}
      />
      <PlanLine
        items={[["report", "5 Generate Report"]]}
        activeStep={activeStep}
      />
      <Box height={1} />
      <Text>
        <Text color={COLORS.help}>Estimated time: </Text>
        <Text color={COLORS.success}>~45 seconds</Text>
      </Text>
    </Box>
  );
}

function PlanLine({
  items,
  activeStep,
}: {
  items: Array<[string, string]>;
  activeStep: string;
}) {
  return (
    <Text>
      {items.map(([id, text], index) => (
        <Text key={id}>
          {index > 0 ? <Arrow /> : null}
          <PlanItem active={activeStep === id} text={text} />
        </Text>
      ))}
    </Text>
  );
}

function PlanItem({ active, text }: { active: boolean; text: string }) {
  return (
    <Text color={active ? COLORS.secondary : COLORS.neutral} bold={active}>
      {text}
    </Text>
  );
}

function Arrow() {
  return <Text color={COLORS.neutral}> → </Text>;
}

function RunView({
  messages,
}: {
  messages: Array<{ id: number; text: string }>;
}) {
  return (
    <Box flexDirection="column">
      <StepHeading title="Preparing Honcho install" />
      <Box height={1} />
      {messages.length === 0 ? (
        <Text color={COLORS.help}>
          Analyzing project and preparing setup...
        </Text>
      ) : (
        messages.map((message) => (
          <Text key={message.id}>
            <Text color={COLORS.accent}>~</Text>{" "}
            <Text color={COLORS.value}>{message.text}</Text>
          </Text>
        ))
      )}
    </Box>
  );
}

function DoneView({ reportPath }: { reportPath?: string }) {
  return (
    <Box flexDirection="column">
      <StepHeading title="Setup flow complete" />
      <Box height={1} />
      <Text color={COLORS.help}>Report generated at</Text>
      <Text color={COLORS.value}>
        {truncate(reportPath ?? "honch-setup-report.md", 70)}
      </Text>
    </Box>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.failure}>
        Wizard failed
      </Text>
      <Box height={1} />
      <Text color={COLORS.value}>{message}</Text>
    </Box>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <Text>
      <Text color={COLORS.label}>{label.padEnd(9)}</Text>
      <Text color={value ? COLORS.value : COLORS.neutral}>
        {truncate(value ?? "Pending", 12)}
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
    case "target":
      return "Detect SDK";
    case "auth":
      return "Connect account";
    case "project":
      return "Register project";
    case "config":
      return "Configure device";
    case "agent":
      return "Install AI runtime";
    case "report":
      return "Generate report";
    default:
      return step.label;
  }
}

function activeStepLabel(steps: WizardStep[]) {
  return steps.find((step) => step.status === "active")?.id ?? "auth";
}

function mainTitle(prompt: PromptRequest) {
  if (prompt.title === "Connect Honch" || prompt.title === "Account email") {
    return "Connect your Honcho account";
  }
  if (prompt.title === "Choose SDK target") return "Detect the SDK target";
  if (prompt.title === "Review install plan") return "Review the install plan";
  return prompt.title;
}

function mainDescription(prompt: PromptRequest) {
  if (prompt.title === "Account email") {
    return "Enter the email associated with your Honcho account.";
  }
  if (prompt.title === "Account password") {
    return "Enter your password to finish authenticating with Honcho.";
  }
  return prompt.message;
}

function inputLabel(prompt: PromptRequest) {
  if (prompt.title === "Account email") return "Email";
  if (prompt.title === "Account password") return "Password";
  return prompt.message.replace(/:$/, "");
}

function displayPath(path: string) {
  const home = process.env.HOME;
  if (home && path.startsWith(home)) {
    return `~${path.slice(home.length) || "/"}`;
  }
  return path;
}

function verticalRule(height: number) {
  return Array.from({ length: height }, () => "│").join("\n");
}

function rule(width: number) {
  return "─".repeat(width);
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}
