import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOptions } from "../src/cli/options.js";
import { TuiPrompter } from "../src/cli/prompt.js";
import type { SdkTargetId } from "../src/sdk/targets.js";
import { runWorkflow } from "../src/workflow.js";

const tempDirs: string[] = [];

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "honch-scaffold-registry-"));
  tempDirs.push(dir);
  process.env.HONCH_WIZARD_PROJECTS_FILE = path.join(dir, "projects.json");
});

afterEach(() => {
  delete process.env.HONCH_WIZARD_PROJECTS_FILE;
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
function localDryRun(installDir: string, target: string, extra: string[] = []) {
  return parseOptions(
    [
      "--install-dir",
      installDir,
      "--target",
      target,
      "--device-model",
      "TestDevice",
      "--project-api-key",
      "k",
      "--yes",
      ...extra,
    ],
    { HONCH_WIZARD_DRY_RUN: "1" },
  );
}

describe("workflow scaffold wiring", () => {
  it("scaffolds the chosen target under --try", async () => {
    const installDir = makeTempDir();
    const calls: ScaffoldCall[] = [];
    const scaffold = async (dir: string, target: SdkTargetId) => {
      calls.push({ dir, target });
      return { files: ["main.c", "CMakeLists.txt"] };
    };

    await runWorkflow(localDryRun(installDir, "c-posix", ["--try"]), {
      prompter: new TuiPrompter({}),
      scaffold,
    });

    expect(calls).toEqual([{ dir: installDir, target: "c-posix" }]);
  });

  it("does not scaffold a non-empty project without --try", async () => {
    const installDir = makeTempDir();
    writeFileSync(path.join(installDir, "existing.txt"), "mine\n");
    const calls: ScaffoldCall[] = [];
    const scaffold = async (dir: string, target: SdkTargetId) => {
      calls.push({ dir, target });
      return { files: [] };
    };

    await runWorkflow(localDryRun(installDir, "c-posix"), {
      prompter: new TuiPrompter({}),
      scaffold,
    });

    expect(calls).toEqual([]);
  });

  it("does not scaffold a target that has no starter, even with --try", async () => {
    const installDir = makeTempDir();
    const calls: ScaffoldCall[] = [];
    const scaffold = async (dir: string, target: SdkTargetId) => {
      calls.push({ dir, target });
      return { files: [] };
    };

    await runWorkflow(localDryRun(installDir, "arduino", ["--try"]), {
      prompter: new TuiPrompter({}),
      scaffold,
    });

    expect(calls).toEqual([]);
  });
});
