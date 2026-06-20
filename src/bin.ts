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
  process.stdout.write(`honch

Agent-powered Honch SDK setup.

Options:
  --install-dir <path>    Client project directory
  --target <target>       esp-idf, c-posix, micropython, arduino, or react-native-relay
  --api-base-url <url>    Honch platform API base URL
  --auth-token <token>    Existing Honch platform bearer token
  --device-model <name>   Device model to configure
  --project-name <name>   Honch project name for local/offline testing
  --project-api-key <key> Honch project API key for local/offline testing
  --dry-run, -n           Preview the plan without running the agent or changing files
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

const useTui = Boolean(process.stdin.isTTY && process.stdout.isTTY);

if (useTui) {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

let shuttingDown = false;
const instance = useTui
  ? render(
      React.createElement(App, {
        options,
        prompter,
        onCancel: handleSigint,
        onExit: handleExit,
      }),
      {
        exitOnCtrlC: false,
      },
    )
  : undefined;

function unmount() {
  instance?.unmount();
}

/** Clean exit after the user dismisses the completed report. */
function handleExit() {
  if (shuttingDown) return;
  shuttingDown = true;
  unmount();
  process.exit(0);
}

function handleSigint() {
  if (shuttingDown) return;
  shuttingDown = true;
  prompter.cancel?.("Wizard cancelled");
  if (useTui) {
    // Let Ink paint the cancelled screen before the process exits.
    setTimeout(() => {
      unmount();
      process.exit(130);
    }, 400);
  } else {
    process.stdout.write("\nWizard cancelled.\n");
    process.exit(130);
  }
}

process.once("SIGINT", handleSigint);

async function main() {
  try {
    const result = await runWorkflow(options, { prompter });
    process.off("SIGINT", handleSigint);
    prompter.finish?.({ reportPath: result.reportPath });
    // Leave the completed report on screen. The App stays mounted until the
    // user dismisses it (q / enter), which calls handleExit. In a non-TTY run
    // there's no interactive UI, so print a plain summary and exit.
    if (!useTui) {
      process.stdout.write(`\nSetup report: ${result.reportPath}\n`);
      process.stdout.write(
        result.agentRan
          ? "Agent run completed.\n"
          : "Dry run — no files were changed.\n",
      );
      unmount();
    }
  } catch (error) {
    process.off("SIGINT", handleSigint);
    if (shuttingDown) return;
    prompter.fail?.((error as Error).message);
    await delay(250);
    unmount();
    process.stderr.write(`Honch failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
