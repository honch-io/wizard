import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseOptions } from "../src/cli/options.js";
import type { Prompter, WizardSummary } from "../src/cli/prompt.js";
import type { SdkTargetId } from "../src/sdk/targets.js";
import { runWorkflow } from "../src/workflow.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "honch-scaffold-wf-"));
  tempDirs.push(dir);
  return dir;
}

type ScaffoldCall = { dir: string; target: SdkTargetId };

// A dry run in local mode (--project-api-key) needs no network, agent, or
// platform — perfect for exercising the scaffold wiring with a stub.
function localDryRun(installDir: string, extra: string[] = []) {
  return parseOptions(
    [
      "--install-dir",
      installDir,
      "--device-model",
      "TestDevice",
      "--project-api-key",
      "k",
      ...extra,
    ],
    { HONCH_WIZARD_DRY_RUN: "1" },
  );
}

/**
 * A stub Prompter that returns scripted `select` answers in order and captures
 * the final summary. Confirms are auto-approved so the dry run proceeds.
 */
function stubPrompter(selectAnswers: string[]): {
  prompter: Prompter;
  summary: () => WizardSummary;
} {
  let summary: WizardSummary = {};
  let next = 0;
  const prompter = {
    question: async () => "",
    select: async () => selectAnswers[next++] ?? "",
    confirm: async () => true,
    close: () => {},
    setSummary: (patch: Partial<WizardSummary>) => {
      summary = { ...summary, ...patch };
    },
    finish: (patch: Partial<WizardSummary>) => {
      summary = { ...summary, ...patch };
    },
  } as unknown as Prompter;
  return { prompter, summary: () => summary };
}

describe("workflow scaffold wiring", () => {
  it("Try Honch scaffolds the chosen SDK into a temp dir and records it", async () => {
    const cwd = makeTempDir();
    const calls: ScaffoldCall[] = [];
    const scaffold = async (dir: string, target: SdkTargetId) => {
      calls.push({ dir, target });
      return { files: ["main.c", "CMakeLists.txt"] };
    };

    // --try (interactive): pick c-posix in the Try picker.
    const { prompter, summary } = stubPrompter(["c-posix"]);
    await runWorkflow(localDryRun(cwd, ["--try"]), { prompter, scaffold });

    expect(calls).toHaveLength(1);
    expect(calls[0].target).toBe("c-posix");
    // Scaffolded into a fresh temp dir under the OS tmp dir, not the cwd.
    const realTmp = path.resolve(tmpdir());
    expect(path.resolve(calls[0].dir).startsWith(realTmp)).toBe(true);
    expect(path.resolve(calls[0].dir)).not.toBe(path.resolve(cwd));
    // The summary carries the temp project path so the report can surface it.
    expect(summary().tempProject).toBe(calls[0].dir);
  });

  it("non-interactive (--yes --target) installs into the cwd and never scaffolds", async () => {
    const cwd = makeTempDir();
    const calls: ScaffoldCall[] = [];
    const scaffold = async (dir: string, target: SdkTargetId) => {
      calls.push({ dir, target });
      return { files: [] };
    };

    const { prompter, summary } = stubPrompter([]);
    await runWorkflow(localDryRun(cwd, ["--target", "c-posix", "--yes"]), {
      prompter,
      scaffold,
    });

    expect(calls).toEqual([]);
    expect(summary().tempProject).toBeUndefined();
  });
});
