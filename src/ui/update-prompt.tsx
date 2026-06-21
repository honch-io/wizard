import { Box, render, Text, useInput } from "ink";
import { useState } from "react";
import { commandString } from "../update/action.js";
import type { UpgradeInfo } from "../update/check.js";
import { COLORS } from "./theme.js";

export type UpdateChoice = "update" | "skip" | "continue";

const OPTIONS: { value: UpdateChoice; label: (command: string) => string }[] = [
  { value: "update", label: (command) => `Update now  (runs \`${command}\`)` },
  { value: "skip", label: () => "Skip this version" },
  { value: "continue", label: () => "Continue for now" },
];

function UpdatePrompt({
  currentVersion,
  info,
  onChoose,
}: {
  currentVersion: string;
  info: UpgradeInfo;
  onChoose: (choice: UpdateChoice) => void;
}) {
  const [focused, setFocused] = useState(0);
  const command = commandString(info.action);

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === "c") {
      onChoose("continue");
      return;
    }
    if (key.upArrow) {
      setFocused((current) =>
        current === 0 ? OPTIONS.length - 1 : current - 1,
      );
    } else if (key.downArrow) {
      setFocused((current) =>
        current === OPTIONS.length - 1 ? 0 : current + 1,
      );
    } else if (input === "1") onChoose("update");
    else if (input === "2") onChoose("skip");
    else if (input === "3") onChoose("continue");
    else if (key.return) onChoose(OPTIONS[focused].value);
    else if (key.escape) onChoose("continue");
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1}>
      <Text>
        <Text bold color={COLORS.accent}>
          ✨ Update available!
        </Text>
        <Text
          color={COLORS.neutral}
        >{`  ${currentVersion} → ${info.latestVersion}`}</Text>
      </Text>
      <Box height={1} />
      {OPTIONS.map((option, index) => {
        const active = index === focused;
        return (
          <Text key={option.value}>
            <Text color={active ? COLORS.accent : COLORS.neutral}>
              {active ? "›" : " "}
            </Text>
            <Text bold={active} color={active ? COLORS.value : COLORS.neutral}>
              {` ${option.label(command)}`}
            </Text>
          </Text>
        );
      })}
      <Box height={1} />
      <Text color={COLORS.help}>↑/↓ move · enter select · esc continue</Text>
    </Box>
  );
}

/** Render the update prompt, resolving with the user's choice and unmounting. */
export function promptForUpdate(
  currentVersion: string,
  info: UpgradeInfo,
): Promise<UpdateChoice> {
  return new Promise((resolve) => {
    let instance: ReturnType<typeof render>;
    const onChoose = (choice: UpdateChoice) => {
      instance.unmount();
      resolve(choice);
    };
    instance = render(
      <UpdatePrompt
        currentVersion={currentVersion}
        info={info}
        onChoose={onChoose}
      />,
      { exitOnCtrlC: false },
    );
  });
}
