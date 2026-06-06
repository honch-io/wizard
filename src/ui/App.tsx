import { Box, Text, useInput } from "ink";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import type { CliOptions } from "../cli/options.js";
import type { PromptRequest, TuiPrompter } from "../cli/prompt.js";

const COLORS = {
  accent: "#ea5924",
  label: "#6f7895",
  value: "#d8dee9",
  neutral: "#8b93a7",
  success: "#8bd17c",
  failure: "#ff6b5f",
  help: "#a7adbb",
} as const;

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
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Hero />
      <Box gap={2}>
        <Box width={34} flexDirection="column" gap={1}>
          <Panel title="Progress" active>
            {snapshot.steps.map((step) => (
              <Box key={step.id} flexDirection="column">
                <Text>
                  <Text
                    color={
                      step.status === "active" ? COLORS.accent : COLORS.neutral
                    }
                  >
                    {stepIcon(step.status)}
                  </Text>
                  <Text
                    bold={step.status === "active"}
                    color={
                      step.status === "done" ? COLORS.value : COLORS.neutral
                    }
                    dimColor={step.status === "pending"}
                  >
                    {" "}
                    {step.label}
                  </Text>
                </Text>
                {step.status === "active" && step.detail ? (
                  <Text color={COLORS.help}> {truncate(step.detail, 23)}</Text>
                ) : null}
              </Box>
            ))}
          </Panel>
          <Panel title="Project">
            <SummaryLine
              label="Target"
              value={options.installDir}
              maxLength={16}
            />
            <SummaryLine
              label="Platform"
              value={options.apiBaseUrl}
              maxLength={16}
            />
            <SummaryLine
              label="Mode"
              value={snapshot.summary.runMode ?? "dry run"}
              maxLength={16}
            />
          </Panel>
        </Box>

        <Box width={74} flexDirection="column" gap={1}>
          <Panel title={prompt?.title ?? panelTitle(snapshot.completed)} active>
            {snapshot.error ? (
              <ErrorView message={snapshot.error} />
            ) : snapshot.completed ? (
              <DoneView reportPath={snapshot.summary.reportPath} />
            ) : prompt ? (
              <PromptView
                key={prompt.id}
                prompt={prompt}
                onAnswer={(value) => prompter.answer(value)}
              />
            ) : (
              <RunView messages={snapshot.runMessages} />
            )}
          </Panel>
          <Panel title="Install plan">
            <SummaryLine label="SDK" value={snapshot.summary.sdkTarget} />
            <SummaryLine label="Auth" value={snapshot.summary.authMode} />
            <SummaryLine label="Project" value={snapshot.summary.projectName} />
            <SummaryLine label="Device" value={snapshot.summary.deviceModel} />
            <SummaryLine
              label="Firmware"
              value={snapshot.summary.firmwareVersion}
            />
            <SummaryLine label="Capture" value={snapshot.summary.captureHost} />
          </Panel>
        </Box>
      </Box>
      <Text color={COLORS.help}>
        ↑/↓ navigate | enter select | ctrl+c exit before setup
      </Text>
    </Box>
  );
}

function Hero() {
  return (
    <Box flexDirection="column" width={78}>
      <Box
        borderStyle="round"
        borderColor={COLORS.accent}
        paddingX={1}
        flexDirection="column"
      >
        <Text>
          <Text bold color={COLORS.accent}>
            HONCHO
          </Text>
          <Text bold color={COLORS.value}>
            {" "}
            WIZARD
          </Text>
          <Text color={COLORS.neutral}> / AI SDK install chain</Text>
        </Text>
        <Text color={COLORS.help}>
          Scan firmware projects, connect Honch, and let the agent wire the SDK.
        </Text>
      </Box>
    </Box>
  );
}

function Panel({
  title,
  children,
  active = false,
}: {
  title: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <Box
      borderStyle="round"
      borderColor={active ? COLORS.accent : COLORS.neutral}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
    >
      <Text bold color={active ? COLORS.accent : COLORS.label}>
        {title}
      </Text>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
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
    <Box flexDirection="column" gap={1}>
      <Text color={COLORS.value}>{prompt.message}</Text>
      <Box flexDirection="column">
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
                <Text color={COLORS.help}> - {truncate(option.hint, 48)}</Text>
              ) : null}
            </Text>
          );
        })}
      </Box>
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
    <Box flexDirection="column" gap={1}>
      <Text color={COLORS.value}>{prompt.message}</Text>
      <Box borderStyle="single" borderColor={COLORS.accent} paddingX={1}>
        <Text color={COLORS.value}>
          {visibleValue}
          <Text color={COLORS.accent}>_</Text>
        </Text>
      </Box>
      {prompt.defaultValue ? (
        <Text color={COLORS.help}>
          Default is pre-filled. Press Enter to keep it.
        </Text>
      ) : (
        <Text color={COLORS.help}>Type a value and press Enter.</Text>
      )}
    </Box>
  );
}

function RunView({
  messages,
}: {
  messages: Array<{ id: number; text: string }>;
}) {
  return (
    <Box flexDirection="column">
      {messages.length === 0 ? (
        <Text color={COLORS.help}>Preparing setup...</Text>
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
      <Text color={COLORS.success} bold>
        Setup flow complete
      </Text>
      <Text color={COLORS.help}>Report:</Text>
      <Text color={COLORS.value}>
        {truncate(reportPath ?? "honch-setup-report.md", 56)}
      </Text>
    </Box>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <Box flexDirection="column">
      <Text color={COLORS.failure} bold>
        Wizard failed
      </Text>
      <Text color={COLORS.value}>{message}</Text>
    </Box>
  );
}

function SummaryLine({
  label,
  value,
  maxLength = 48,
}: {
  label: string;
  value?: string;
  maxLength?: number;
}) {
  return (
    <Text>
      <Text color={COLORS.label}>{label.padEnd(9)}</Text>
      <Text color={value ? COLORS.value : COLORS.neutral}>
        {truncate(value ?? "pending", maxLength)}
      </Text>
    </Text>
  );
}

function stepIcon(status: "pending" | "active" | "done") {
  if (status === "done") return "[x]";
  if (status === "active") return "[>]";
  return "[ ]";
}

function panelTitle(completed?: boolean) {
  return completed ? "Complete" : "Working";
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}
