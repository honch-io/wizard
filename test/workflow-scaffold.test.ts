import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SdkTargetId } from "@honch/agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { parseOptions } from "../src/cli/options.js";
import type {
  Prompter,
  SelectConfig,
  WizardSummary,
} from "../src/cli/prompt.js";
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
    multiSelect: async () => [],
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

  it("leads with installing here (not a scratch project) when no SDK is detected", async () => {
    const cwd = makeTempDir(); // empty dir → nothing detected
    const welcomeConfigs: SelectConfig[] = [];
    const prompter = {
      question: async () => "",
      select: async (config: SelectConfig) => {
        const isWelcome = config.options.some((o) => o.value === "try");
        if (isWelcome) {
          welcomeConfigs.push(config);
          return "different"; // choose to set up here
        }
        return "c-posix"; // the SDK picker that follows
      },
      confirm: async () => true,
      multiSelect: async () => [],
      close: () => {},
      setSummary: () => {},
      finish: () => {},
    } as unknown as Prompter;
    const scaffold = async () => ({ files: [] as string[] });

    await runWorkflow(localDryRun(cwd), { prompter, scaffold });

    const welcome = welcomeConfigs[0];
    expect(welcome).toBeDefined();
    // The user ran honch in THIS directory, so installing here is the default
    // and leading option; the scratch project is the secondary escape hatch.
    expect(welcome.defaultValue).toBe("different");
    expect(welcome.options[0]?.value).toBe("different");
  });

  it("names the scratch project by SDK, directly under the temp dir", async () => {
    const cwd = makeTempDir();
    const calls: ScaffoldCall[] = [];
    const scaffold = async (dir: string, target: SdkTargetId) => {
      calls.push({ dir, target });
      return { files: [] as string[] };
    };

    const { prompter } = stubPrompter(["c-posix"]);
    await runWorkflow(localDryRun(cwd, ["--try"]), { prompter, scaffold });

    const dir = calls[0].dir;
    // Flat: the only fixed parent is the temp dir itself — no stable,
    // attacker-guessable intermediate dir to plant a symlink at. mkdtemp creates
    // the unique 0700 leaf atomically. The SDK name keeps it self-describing.
    expect(path.dirname(dir)).toBe(tmpdir());
    expect(path.basename(dir).startsWith("honch-try-c-posix-")).toBe(true);
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
