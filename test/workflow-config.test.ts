import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseOptions } from "../src/cli/options.js";
import { TuiPrompter } from "../src/cli/prompt.js";
import { loadHonchConfig } from "../src/config/honch-config.js";
import { runWorkflow } from "../src/workflow.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "honch-workflow-config-"));
  tempDirs.push(dir);
  return dir;
}

describe("workflow config writing", () => {
  it("writes honch.config.json after a successful dry run", async () => {
    const installDir = makeTempDir();

    const options = parseOptions(
      [
        "--install-dir",
        installDir,
        "--target",
        "esp-idf",
        "--device-model",
        "ActionCam X1",
        "--project-name",
        "My Camera Project",
        "--project-api-key",
        "honch_test_key",
        "--yes",
      ],
      { HONCH_WIZARD_DRY_RUN: "1" },
    );

    const prompter = new TuiPrompter({});
    await runWorkflow(options, { prompter });

    const config = loadHonchConfig(installDir);
    expect(config).toBeDefined();
    expect(config?.target).toBe("esp-idf");
    expect(config?.deviceModel).toBe("ActionCam X1");
    expect(config?.projectName).toBe("My Camera Project");
    expect(config?.projectId).toBe("local");
  });

  it("does not write the API key into honch.config.json", async () => {
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
        "SecretProject",
        "--project-api-key",
        "honch_secret_key",
        "--yes",
      ],
      { HONCH_WIZARD_DRY_RUN: "1" },
    );

    const prompter = new TuiPrompter({});
    await runWorkflow(options, { prompter });

    const configPath = path.join(installDir, "honch.config.json");
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(configPath, "utf8");
    expect(raw).not.toContain("honch_secret_key");
    expect(raw).not.toContain("apiKey");
    expect(raw).not.toContain("projectApiKey");
  });

  it("skips writing honch.config.json when --no-save-config is set", async () => {
    const installDir = makeTempDir();

    const options = parseOptions(
      [
        "--install-dir",
        installDir,
        "--target",
        "esp-idf",
        "--device-model",
        "ActionCam X1",
        "--project-name",
        "My Camera Project",
        "--project-api-key",
        "honch_test_key",
        "--yes",
        "--no-save-config",
      ],
      { HONCH_WIZARD_DRY_RUN: "1" },
    );

    const prompter = new TuiPrompter({});
    await runWorkflow(options, { prompter });

    const config = loadHonchConfig(installDir);
    expect(config).toBeUndefined();
  });

  it("skips writing honch.config.json when HONCH_WIZARD_NO_SAVE_CONFIG=1", async () => {
    const installDir = makeTempDir();

    const options = parseOptions(
      [
        "--install-dir",
        installDir,
        "--target",
        "micropython",
        "--device-model",
        "PiZero",
        "--project-name",
        "PiProject",
        "--project-api-key",
        "honch_test_key",
        "--yes",
      ],
      {
        HONCH_WIZARD_DRY_RUN: "1",
        HONCH_WIZARD_NO_SAVE_CONFIG: "1",
      },
    );

    const prompter = new TuiPrompter({});
    await runWorkflow(options, { prompter });

    const config = loadHonchConfig(installDir);
    expect(config).toBeUndefined();
  });

  it("includes apiBaseUrl in config when non-default", async () => {
    const installDir = makeTempDir();

    const options = parseOptions(
      [
        "--install-dir",
        installDir,
        "--target",
        "esp-idf",
        "--device-model",
        "TestBoard",
        "--project-name",
        "StagingProject",
        "--project-api-key",
        "honch_test_key",
        "--yes",
        "--api-base-url",
        "https://staging.honch.io",
      ],
      { HONCH_WIZARD_DRY_RUN: "1" },
    );

    const prompter = new TuiPrompter({});
    await runWorkflow(options, { prompter });

    const config = loadHonchConfig(installDir);
    expect(config?.apiBaseUrl).toBe("https://staging.honch.io");
  });
});
