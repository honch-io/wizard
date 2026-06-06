import { Box, Text, useInput } from "ink";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import type { CliOptions } from "../cli/options.js";
import type { PromptRequest, TuiPrompter } from "../cli/prompt.js";

const HONCH_ORANGE = "#ea5924";

export function App({
  options,
  prompter,
}: {
  options: CliOptions;
  prompter: TuiPrompter;
}) {
  const snapshot = useSyncExternalStore(
    prompter.subscribe,
    prompter.getSnapshot,
  );
  const prompt = snapshot.currentPrompt;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
      <Hero />
      <Box gap={2}>
        <Box width={34} flexDirection="column" gap={1}>
          <Panel title="Progress">
            {snapshot.steps.map((step) => (
              <Text key={step.id}>
                <Text color={step.status === "active" ? HONCH_ORANGE : "gray"}>
                  {stepIcon(step.status)}
                </Text>
                <Text
                  bold={step.status === "active"}
                  dimColor={step.status === "pending"}
                >
                  {" "}
                  {step.label}
                </Text>
              </Text>
            ))}
          </Panel>
          <Panel title="Project">
            <SummaryLine
              label="Target"
              value={options.installDir}
              maxLength={14}
            />
            <SummaryLine
              label="Platform"
              value={options.apiBaseUrl}
              maxLength={14}
            />
            <SummaryLine
              label="Mode"
              value={snapshot.summary.runMode ?? "dry run"}
              maxLength={14}
            />
          </Panel>
        </Box>

        <Box width={72} flexDirection="column" gap={1}>
          <Panel title={prompt?.title ?? panelTitle(snapshot.completed)}>
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
      <Text dimColor>
        Arrow keys navigate choices. Enter selects. Ctrl+C exits before setup.
      </Text>
    </Box>
  );
}

function Hero() {
  return (
    <Box flexDirection="column">
      <Text bold color={HONCH_ORANGE}>
        HONCHO WIZARD
      </Text>
      <Text>
        <Text color={HONCH_ORANGE}>Agent-powered</Text> Honch SDK setup for
        firmware projects
      </Text>
    </Box>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      paddingY={0}
      flexDirection="column"
    >
      <Text bold color={HONCH_ORANGE}>
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
      <Text>{prompt.message}</Text>
      <Box flexDirection="column">
        {prompt.options.map((option, index) => {
          const active = index === focused;
          return (
            <Text key={option.value}>
              <Text color={active ? HONCH_ORANGE : "gray"}>
                {active ? ">" : " "}
              </Text>
              <Text bold={active} dimColor={!active}>
                {" "}
                {option.label}
              </Text>
              {option.hint ? <Text dimColor> - {option.hint}</Text> : null}
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
      <Text>{prompt.message}</Text>
      <Box borderStyle="single" borderColor={HONCH_ORANGE} paddingX={1}>
        <Text>
          {visibleValue}
          <Text color={HONCH_ORANGE}>_</Text>
        </Text>
      </Box>
      {prompt.defaultValue ? (
        <Text dimColor>Default is pre-filled. Press Enter to keep it.</Text>
      ) : (
        <Text dimColor>Type a value and press Enter.</Text>
      )}
    </Box>
  );
}

function RunView({ messages }: { messages: string[] }) {
  return (
    <Box flexDirection="column">
      {messages.length === 0 ? (
        <Text dimColor>Preparing setup...</Text>
      ) : (
        messages.map((message) => (
          <Text key={message}>
            <Text color={HONCH_ORANGE}>~</Text> {message}
          </Text>
        ))
      )}
    </Box>
  );
}

function DoneView({ reportPath }: { reportPath?: string }) {
  return (
    <Box flexDirection="column">
      <Text color="green" bold>
        Setup flow complete
      </Text>
      <Text>Report: {truncate(reportPath ?? "honch-setup-report.md", 44)}</Text>
    </Box>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <Box flexDirection="column">
      <Text color="red" bold>
        Wizard failed
      </Text>
      <Text>{message}</Text>
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
      <Text dimColor>{label.padEnd(9)}</Text>
      <Text>{truncate(value ?? "pending", maxLength)}</Text>
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
