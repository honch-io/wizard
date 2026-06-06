#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { parseOptions } from "./cli/options.js";
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

const instance = render(React.createElement(App, { options }));

try {
  const result = await runWorkflow(options);
  instance.unmount();
  process.stdout.write(`\nSetup report: ${result.reportPath}\n`);
  process.stdout.write(
    result.agentRan
      ? "Agent run completed.\n"
      : "Dry run completed; pass --run-agent after platform auth is configured.\n",
  );
} catch (error) {
  instance.unmount();
  process.stderr.write(`\nHoncho failed: ${(error as Error).message}\n`);
  process.exit(1);
}
