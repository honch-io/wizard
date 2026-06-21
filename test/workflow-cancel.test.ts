import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseOptions } from "../src/cli/options.js";
import {
  type Prompter,
  type SelectConfig,
  WizardCancelledError,
} from "../src/cli/prompt.js";
import { runWorkflow } from "../src/workflow.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "honch-workflow-cancel-"));
  tempDirs.push(dir);
  return dir;
}

/** A scripted prompter that declines the confirm and records a cancel() call. */
function decliningPrompter(): Prompter & { cancelled: boolean } {
  const state = { cancelled: false };
  return {
    state,
    question: async () => "",
    select: async (config: SelectConfig) =>
      config.defaultValue ?? config.options[0]?.value ?? "",
    confirm: async () => false,
    cancel: () => {
      state.cancelled = true;
    },
    close: () => {},
    get cancelled() {
      return state.cancelled;
    },
  } as unknown as Prompter & { cancelled: boolean };
}

describe("workflow deliberate cancel", () => {
  it("throws WizardCancelledError and flags cancel — not a generic failure", async () => {
    const installDir = makeTempDir();
    const options = parseOptions(
      [
        "--install-dir",
        installDir,
        "--target",
        "c-posix",
        "--device-model",
        "TestDevice",
        "--project-name",
        "Cancelled",
        "--project-api-key",
        "honch_test_key",
        "--no-save-config",
      ],
      { HONCH_WIZARD_DRY_RUN: "1" },
    );

    const prompter = decliningPrompter();
    await expect(runWorkflow(options, { prompter })).rejects.toBeInstanceOf(
      WizardCancelledError,
    );
    expect(prompter.cancelled).toBe(true);
  });
});
