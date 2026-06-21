#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "ink";
import React from "react";
import { parseOptions } from "./cli/options.js";
import { TuiPrompter } from "./cli/prompt.js";
import { SDK_TARGETS } from "./sdk/targets.js";
import { App } from "./ui/App.js";
import { promptForUpdate } from "./ui/update-prompt.js";
import { commandString } from "./update/action.js";
import { dismissVersion } from "./update/cache.js";
import { getUpgradeVersion } from "./update/check.js";
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

let shuttingDown = false;
let failed = false;
let instance: ReturnType<typeof render> | undefined;

function unmount() {
  instance?.unmount();
}

/** Clean exit after the user dismisses the completed report or error screen. */
function handleExit() {
  if (shuttingDown) return;
  shuttingDown = true;
  unmount();
  process.exit(failed ? 1 : 0);
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

/** Read this CLI's own version from the package manifest beside the bundle. */
function selfVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * On an interactive launch, offer an in-place update when a newer release is
 * published — mirroring Codex. "Update now" runs the package manager with
 * inherited stdio, then exits so the user relaunches into the new version.
 */
async function maybeOfferUpdate(): Promise<void> {
  if (!useTui) return;

  const current = selfVersion();
  let info: Awaited<ReturnType<typeof getUpgradeVersion>>;
  try {
    info = await getUpgradeVersion({ currentVersion: current });
  } catch {
    return; // never block startup on the update check
  }
  if (!info) return;

  const choice = await promptForUpdate(current, info);
  if (choice === "skip") {
    dismissVersion(info.latestVersion);
    return;
  }
  if (choice !== "update") return;

  const cmd = commandString(info.action);
  process.stdout.write(`\nUpdating Honch via \`${cmd}\`…\n\n`);
  const result = spawnSync(info.action.command, info.action.args, {
    stdio: "inherit",
  });
  if (result.status === 0) {
    process.stdout.write(
      `\n🎉 Updated to ${info.latestVersion}! Run \`honch\` again.\n`,
    );
    process.exit(0);
  }
  process.stdout.write(`\n✗ Update failed. Run it yourself:\n  ${cmd}\n`);
  process.exit(1);
}

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
    const message = (error as Error).message;
    failed = true;
    prompter.fail?.(message);
    if (useTui) {
      // Leave the dismissable error screen up; the user presses enter to exit
      // (handleExit). Writing to stderr here bled into the TUI footer.
      return;
    }
    process.stderr.write(`Honch failed: ${message}\n`);
    unmount();
    process.exitCode = 1;
  }
}

async function start() {
  // The update prompt renders its own Ink app and unmounts before the wizard
  // mounts, so the two never fight over the terminal.
  await maybeOfferUpdate();

  if (useTui) {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    instance = render(
      React.createElement(App, {
        options,
        prompter,
        onCancel: handleSigint,
        onExit: handleExit,
      }),
      {
        exitOnCtrlC: false,
      },
    );
  }

  await main();
}

void start();
