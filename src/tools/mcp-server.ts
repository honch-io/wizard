import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SecretVault } from "../secrets/vault.js";
import {
  checkEnvKeys,
  detectPackageManager,
  setEnvValues,
} from "./local-tools.js";

export function createLocalToolsServer(input: {
  workingDirectory: string;
  secretVault: SecretVault;
}) {
  return createSdkMcpServer({
    name: "honcho-tools",
    version: "0.1.0",
    instructions:
      "Local Honcho tools. Use these for package manager detection and environment file writes. Do not read or write .env files directly.",
    tools: [
      tool(
        "detect_package_manager",
        "Detect package managers and build systems in the target project.",
        {},
        async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                detectPackageManager(input.workingDirectory),
              ),
            },
          ],
        }),
      ),
      tool(
        "check_env_keys",
        "Check whether specific environment keys exist in an env file.",
        {
          filePath: z.string(),
          keys: z.array(z.string()),
        },
        async (args) => ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                checkEnvKeys(input.workingDirectory, args.filePath, args.keys),
              ),
            },
          ],
        }),
      ),
      tool(
        "set_env_values",
        "Set env file values. Secret refs are resolved locally and never returned.",
        {
          filePath: z.string(),
          values: z.record(
            z.union([z.string(), z.object({ secretRef: z.string() })]),
          ),
        },
        async (args) => ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                setEnvValues(
                  input.workingDirectory,
                  args.filePath,
                  args.values,
                  input.secretVault,
                ),
              ),
            },
          ],
        }),
      ),
    ],
  });
}
