import { Box, Text } from "ink";
import type { CliOptions } from "../cli/options.js";

export function App({ options }: { options: CliOptions }) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">
        Honcho Wizard
      </Text>
      <Text>Agent-powered Honch SDK setup</Text>
      <Text>Target project: {options.installDir}</Text>
      <Text>Platform API: {options.apiBaseUrl}</Text>
      <Text>
        SDK target:{" "}
        {options.target ?? "auto-detect ESP-IDF, C/POSIX, or MicroPython"}
      </Text>
    </Box>
  );
}
