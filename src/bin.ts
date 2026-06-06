#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { parseOptions } from "./cli/options.js";
import { TuiPrompter } from "./cli/prompt.js";
import { SDK_TARGETS } from "./sdk/targets.js";
import { App } from "./ui/App.js";
import { runWorkflow } from "./workflow.js";

const options = parseOptions(process.argv.slice(2), process.env);

if (options.help) {
  process.stdout.write(`honcho

Agent-powered Honch SDK setup.

Options:
  --install-dir <path>    Client project directory
  --target <target>       esp-idf, c-posix, or micropython
  --api-base-url <url>    Honch platform API base URL
  --auth-token <token>    Existing Honch platform bearer token
  --capture-host <url>    Capture host for SDK configuration
  --device-model <name>   Device model to configure
  --firmware-version <v>  Firmware version to configure
  --project-name <name>   Honch project name for local/offline testing
  --project-api-key <key> Honch project API key for local/offline testing
  --run-agent             Run Claude Agent SDK through Honch platform proxy
  --yes, -y               Skip confirmation prompts when inputs are complete
  --help, -h              Show this help
`);
  process.exit(0);
}

const prompter = new TuiPrompter({
  targetProject: options.installDir,
  platformApi: options.apiBaseUrl,
  sdkTarget: options.target ? SDK_TARGETS[options.target].label : undefined,
  runMode: options.runAgent ? "agent install" : "dry run",
});

if (process.stdout.isTTY) {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

const instance = render(React.createElement(App, { options, prompter }));

try {
  const result = await runWorkflow(options, { prompter });
  prompter.finish?.({ reportPath: result.reportPath });
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.stdout.write(`\nSetup report: ${result.reportPath}\n`);
  process.stdout.write(
    result.agentRan
      ? "Agent run completed.\n"
      : "Dry run completed; pass --run-agent after platform auth is configured.\n",
  );
  instance.unmount();
} catch (error) {
  prompter.fail?.((error as Error).message);
  await new Promise((resolve) => setTimeout(resolve, 250));
  instance.unmount();
  process.stderr.write(`Honcho failed: ${(error as Error).message}\n`);
  process.exit(1);
}
