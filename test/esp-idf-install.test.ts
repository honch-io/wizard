import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type GitRunner,
  HONCH_ESP_IDF_COMPONENT_PATH,
  HONCH_ESP_IDF_SDK_URL,
  installEspIdfHonchSubmodule,
  isHonchSubmoduleRegistered,
} from "../src/firmware/esp-idf-install.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "honch-esp-idf-"));
}

function writeRegisteredSubmodule(projectDir: string): void {
  writeFileSync(
    join(projectDir, ".gitmodules"),
    `[submodule "components/honch"]\n\tpath = ${HONCH_ESP_IDF_COMPONENT_PATH}\n\turl = ${HONCH_ESP_IDF_SDK_URL}\n`,
  );
}

function fakeGit(projectDir: string): { calls: string[][]; runner: GitRunner } {
  const calls: string[][] = [];
  const runner: GitRunner = (args) => {
    calls.push(args);
    if (args.join(" ") === "rev-parse --is-inside-work-tree") return "true\n";
    if (
      args.join(" ") ===
      `-C ${HONCH_ESP_IDF_COMPONENT_PATH} config --get remote.origin.url`
    ) {
      return `${HONCH_ESP_IDF_SDK_URL}\n`;
    }
    if (
      args.join(" ") ===
        `config -f .gitmodules submodule.components/honch.path ${HONCH_ESP_IDF_COMPONENT_PATH}` ||
      args.join(" ") ===
        `config -f .gitmodules submodule.components/honch.url ${HONCH_ESP_IDF_SDK_URL}`
    ) {
      writeRegisteredSubmodule(projectDir);
      return "";
    }
    if (args[0] === "submodule" && args[1] === "add") {
      mkdirSync(join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH), {
        recursive: true,
      });
      writeFileSync(
        join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH, ".git"),
        "gitdir: ../../.git/modules/components/honch\n",
      );
      writeRegisteredSubmodule(projectDir);
      return "";
    }
    return "";
  };
  return { calls, runner };
}

describe("installEspIdfHonchSubmodule", () => {
  it("adds the Honch ESP-IDF SDK as a git submodule", () => {
    const projectDir = tempProject();
    const git = fakeGit(projectDir);

    const result = installEspIdfHonchSubmodule(projectDir, git.runner);

    expect(result.changed).toBe(true);
    expect(isHonchSubmoduleRegistered(projectDir)).toBe(true);
    expect(git.calls).toContainEqual([
      "submodule",
      "add",
      HONCH_ESP_IDF_SDK_URL,
      HONCH_ESP_IDF_COMPONENT_PATH,
    ]);
  });

  it("retries with --force when a leftover module gitdir blocks the add", () => {
    const projectDir = tempProject();
    const git = fakeGit(projectDir);
    let plainAddAttempted = false;
    const runner: GitRunner = (args, options) => {
      if (
        args[0] === "submodule" &&
        args[1] === "add" &&
        !args.includes("--force")
      ) {
        plainAddAttempted = true;
        throw new Error(
          "git submodule add failed: fatal: A git directory for 'components/honch' is found locally",
        );
      }
      return git.runner(args, options);
    };

    const result = installEspIdfHonchSubmodule(projectDir, runner);

    expect(plainAddAttempted).toBe(true);
    expect(result.changed).toBe(true);
    expect(isHonchSubmoduleRegistered(projectDir)).toBe(true);
    expect(git.calls).toContainEqual([
      "submodule",
      "add",
      "--force",
      HONCH_ESP_IDF_SDK_URL,
      HONCH_ESP_IDF_COMPONENT_PATH,
    ]);
  });

  it("retries with --force when components/ is gitignored", () => {
    const projectDir = tempProject();
    const git = fakeGit(projectDir);
    const runner: GitRunner = (args, options) => {
      if (
        args[0] === "submodule" &&
        args[1] === "add" &&
        !args.includes("--force")
      ) {
        throw new Error(
          "git submodule add failed: The following paths are ignored by one of your .gitignore files:\ncomponents/honch\nhint: Use -f if you really want to add them.",
        );
      }
      return git.runner(args, options);
    };

    const result = installEspIdfHonchSubmodule(projectDir, runner);

    expect(result.changed).toBe(true);
    expect(isHonchSubmoduleRegistered(projectDir)).toBe(true);
    expect(git.calls).toContainEqual([
      "submodule",
      "add",
      "--force",
      HONCH_ESP_IDF_SDK_URL,
      HONCH_ESP_IDF_COMPONENT_PATH,
    ]);
  });

  it("updates an already-registered submodule without adding it again", () => {
    const projectDir = tempProject();
    mkdirSync(join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH, ".git"),
      "gitdir: ../../.git/modules/components/honch\n",
    );
    writeRegisteredSubmodule(projectDir);
    const git = fakeGit(projectDir);

    const result = installEspIdfHonchSubmodule(projectDir, git.runner);

    expect(result.changed).toBe(false);
    expect(git.calls).toContainEqual([
      "submodule",
      "sync",
      "--",
      HONCH_ESP_IDF_COMPONENT_PATH,
    ]);
    expect(git.calls.some((args) => args[1] === "add")).toBe(false);
  });

  it("registers an existing Honch checkout when .gitmodules is missing", () => {
    const projectDir = tempProject();
    mkdirSync(join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH, ".git"),
      "gitdir: ../../.git/modules/components/honch\n",
    );
    const git = fakeGit(projectDir);

    const result = installEspIdfHonchSubmodule(projectDir, git.runner);

    expect(result.changed).toBe(true);
    expect(isHonchSubmoduleRegistered(projectDir)).toBe(true);
    expect(git.calls).toContainEqual([
      "add",
      ".gitmodules",
      HONCH_ESP_IDF_COMPONENT_PATH,
    ]);
  });

  it("initializes git before adding the submodule when not a worktree", () => {
    const projectDir = tempProject();
    const git = fakeGit(projectDir);
    const runner: GitRunner = (args, options) => {
      if (args.join(" ") === "rev-parse --is-inside-work-tree") {
        throw new Error("not a git repository");
      }
      return git.runner(args, options);
    };

    const result = installEspIdfHonchSubmodule(projectDir, runner);

    expect(result.message).toContain("Git repository initialized");
    expect(git.calls).toContainEqual(["init"]);
  });

  it("moves an existing non-git components/honch directory aside", () => {
    const projectDir = tempProject();
    mkdirSync(join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, HONCH_ESP_IDF_COMPONENT_PATH, "README.md"),
      "not a submodule\n",
    );
    const git = fakeGit(projectDir);

    const result = installEspIdfHonchSubmodule(projectDir, git.runner);

    expect(result.changed).toBe(true);
    // Backed up outside components/ so ESP-IDF doesn't discover it as a component.
    expect(existsSync(join(projectDir, ".honch-backup/honch.pre-wizard"))).toBe(
      true,
    );
    expect(existsSync(join(projectDir, "components/honch.pre-wizard"))).toBe(
      false,
    );
    expect(isHonchSubmoduleRegistered(projectDir)).toBe(true);
  });

  it("recognizes the required .gitmodules entry", () => {
    const projectDir = tempProject();
    writeRegisteredSubmodule(projectDir);

    expect(readFileSync(join(projectDir, ".gitmodules"), "utf8")).toContain(
      HONCH_ESP_IDF_SDK_URL,
    );
    expect(isHonchSubmoduleRegistered(projectDir)).toBe(true);
  });
});
