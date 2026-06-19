/**
 * Deterministic ESP-IDF component install.
 *
 * The agent's Bash allowlist (wizardCanUseTool) permits only package-manager and
 * build/lint scripts — it cannot run `idf.py add-dependency` or `git submodule
 * add`. So the wizard registers the Honch SDK as a git submodule at
 * components/honch itself, before the agent runs, and the agent then only wires
 * `REQUIRES honch`, init, and tracking into the existing component.
 *
 * Fails loudly rather than leaving SDK setup as a manual follow-up: if the
 * submodule cannot be added, updated, or verified, the caller aborts the install.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export const HONCH_ESP_IDF_SDK_URL = "https://github.com/honch-io/SDK.git";
export const HONCH_ESP_IDF_COMPONENT_PATH = "components/honch";

export type GitRunner = (args: string[], options: { cwd: string }) => string;

export interface EspIdfSubmoduleInstallResult {
  changed: boolean;
  componentPath: string;
  message: string;
}

export function installEspIdfHonchSubmodule(
  projectDir: string,
  runGit: GitRunner = runGitCommand,
): EspIdfSubmoduleInstallResult {
  const initializedGit = ensureGitWorkTree(projectDir, runGit);
  const componentDir = join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH);

  if (isHonchSubmoduleRegistered(projectDir)) {
    runGit(["submodule", "sync", "--", HONCH_ESP_IDF_COMPONENT_PATH], {
      cwd: projectDir,
    });
    runGit(
      [
        "submodule",
        "update",
        "--init",
        "--recursive",
        "--",
        HONCH_ESP_IDF_COMPONENT_PATH,
      ],
      { cwd: projectDir },
    );
    assertRegisteredSubmodule(projectDir);
    return {
      changed: false,
      componentPath: HONCH_ESP_IDF_COMPONENT_PATH,
      message: "Honch ESP-IDF SDK submodule already registered",
    };
  }

  if (existsSync(componentDir) && !isGitCheckout(componentDir)) {
    moveExistingComponentAside(projectDir);
  }

  if (existsSync(componentDir)) {
    registerExistingHonchCheckout(projectDir, runGit);
  } else {
    addHonchSubmodule(projectDir, runGit);
  }

  runGit(
    [
      "submodule",
      "update",
      "--init",
      "--recursive",
      "--",
      HONCH_ESP_IDF_COMPONENT_PATH,
    ],
    { cwd: projectDir },
  );
  assertRegisteredSubmodule(projectDir);

  return {
    changed: true,
    componentPath: HONCH_ESP_IDF_COMPONENT_PATH,
    message: initializedGit
      ? "Git repository initialized and Honch ESP-IDF SDK submodule added"
      : "Honch ESP-IDF SDK submodule added",
  };
}

export function isHonchSubmoduleRegistered(projectDir: string): boolean {
  const gitmodulesPath = join(projectDir, ".gitmodules");
  if (!existsSync(gitmodulesPath)) return false;

  const gitmodules = readFileSync(gitmodulesPath, "utf8");
  return (
    gitmodules.includes(`path = ${HONCH_ESP_IDF_COMPONENT_PATH}`) &&
    gitmodules.includes(`url = ${HONCH_ESP_IDF_SDK_URL}`)
  );
}

function ensureGitWorkTree(projectDir: string, runGit: GitRunner): boolean {
  try {
    const result = runGit(["rev-parse", "--is-inside-work-tree"], {
      cwd: projectDir,
    }).trim();
    if (result === "true") return false;
  } catch {
    // Not a git worktree yet — initialize one so the submodule can register.
  }

  runGit(["init"], { cwd: projectDir });
  return true;
}

/**
 * Add the submodule, retrying with --force when git refuses the plain add.
 * Two cases need the force flag, and both are safe here because the component
 * path is dedicated to the Honch SDK:
 *  - a leftover .git/modules/components/honch from an interrupted run
 *    ("a git directory ... is found locally");
 *  - the project's .gitignore ignores components/ — the SDK component still
 *    has to live there for the build, so we add it anyway.
 */
function addHonchSubmodule(projectDir: string, runGit: GitRunner): void {
  try {
    runGit(
      ["submodule", "add", HONCH_ESP_IDF_SDK_URL, HONCH_ESP_IDF_COMPONENT_PATH],
      { cwd: projectDir },
    );
  } catch (error) {
    if (!submoduleAddNeedsForce(error)) throw error;
    runGit(
      [
        "submodule",
        "add",
        "--force",
        HONCH_ESP_IDF_SDK_URL,
        HONCH_ESP_IDF_COMPONENT_PATH,
      ],
      { cwd: projectDir },
    );
  }
}

function submoduleAddNeedsForce(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /is found locally|already exists in the index|--force|ignored by one of your|Use -f/.test(
    message,
  );
}

function registerExistingHonchCheckout(
  projectDir: string,
  runGit: GitRunner,
): void {
  const originUrl = runGit(
    [
      "-C",
      HONCH_ESP_IDF_COMPONENT_PATH,
      "config",
      "--get",
      "remote.origin.url",
    ],
    { cwd: projectDir },
  ).trim();
  if (originUrl !== HONCH_ESP_IDF_SDK_URL) {
    throw new Error(
      `${HONCH_ESP_IDF_COMPONENT_PATH} already exists but its git origin is ${
        originUrl || "unset"
      }, not ${HONCH_ESP_IDF_SDK_URL}. Remove or move it before running the installer.`,
    );
  }

  runGit(
    [
      "config",
      "-f",
      ".gitmodules",
      "submodule.components/honch.path",
      HONCH_ESP_IDF_COMPONENT_PATH,
    ],
    { cwd: projectDir },
  );
  runGit(
    [
      "config",
      "-f",
      ".gitmodules",
      "submodule.components/honch.url",
      HONCH_ESP_IDF_SDK_URL,
    ],
    { cwd: projectDir },
  );
  runGit(["add", ".gitmodules", HONCH_ESP_IDF_COMPONENT_PATH], {
    cwd: projectDir,
  });
}

function assertRegisteredSubmodule(projectDir: string): void {
  if (!isHonchSubmoduleRegistered(projectDir)) {
    throw new Error(
      `Honch SDK submodule registration failed: .gitmodules must contain ${HONCH_ESP_IDF_COMPONENT_PATH} -> ${HONCH_ESP_IDF_SDK_URL}.`,
    );
  }
}

function moveExistingComponentAside(projectDir: string): void {
  // Back up OUTSIDE components/ — ESP-IDF auto-discovers every directory under
  // components/ as a build component, so a leftover `honch.pre-wizard` there
  // would be picked up by the build (and likely break it). Park it at the
  // project root instead.
  const backupDir = join(projectDir, ".honch-backup");
  mkdirSync(backupDir, { recursive: true });
  renameSync(
    join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH),
    nextBackupPath(backupDir),
  );
}

function nextBackupPath(backupDir: string): string {
  const base = join(backupDir, "honch.pre-wizard");
  if (!existsSync(base)) return base;

  for (let index = 1; index < 1000; index++) {
    const candidate = `${base}.${index}`;
    if (!existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Could not create a backup path for the existing components/honch directory.",
  );
}

function isGitCheckout(directory: string): boolean {
  if (!existsSync(directory)) return false;
  if (!statSync(directory).isDirectory()) return false;
  return existsSync(join(directory, ".git"));
}

function runGitCommand(args: string[], options: { cwd: string }): string {
  try {
    return execFileSync("git", args, {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error
        ? String((error as Error & { stderr?: unknown }).stderr ?? "")
        : "";
    const message = stderr.trim() || (error as Error).message;
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
  }
}
