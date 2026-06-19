import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  availableBranchName,
  commitAll,
  createBranch,
  currentBranch,
  restoreProject,
  snapshotProject,
} from "../src/project/snapshot.js";

const dirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "honch-snap-test-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init");
  git("config", "user.email", "test@honch.io");
  git("config", "user.name", "Test");
  writeFileSync(join(dir, "existing.txt"), "original\n");
  git("add", "-A");
  git("commit", "-m", "init");
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("project snapshot", () => {
  it("returns undefined outside a git work tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "honch-nogit-"));
    dirs.push(dir);
    expect(snapshotProject(dir)).toBeUndefined();
  });

  it("restores modified, deleted, and agent-added files", () => {
    const dir = tempRepo();
    // also capture an untracked file in the snapshot
    writeFileSync(join(dir, "untracked.txt"), "keep me\n");

    const snapshot = snapshotProject(dir);
    expect(snapshot).toBeTruthy();

    // simulate the agent's work: modify, delete, and create files
    writeFileSync(join(dir, "existing.txt"), "MODIFIED BY AGENT\n");
    rmSync(join(dir, "untracked.txt"));
    writeFileSync(join(dir, "agent-new.c"), "honch_init();\n");

    restoreProject(dir, snapshot as string);

    expect(readFileSync(join(dir, "existing.txt"), "utf8")).toBe("original\n");
    expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe("keep me\n");
    expect(existsSync(join(dir, "agent-new.c"))).toBe(false);
  });

  it("creates a branch, commits work, and reports the base/new names", () => {
    const dir = tempRepo();
    const base = currentBranch(dir);
    expect(base).toBeTruthy();

    const name = availableBranchName(dir, "honch/setup");
    expect(name).toBe("honch/setup");

    createBranch(dir, name);
    expect(currentBranch(dir)).toBe("honch/setup");

    writeFileSync(join(dir, "wired.c"), "honch_init();\n");
    commitAll(dir, "honch: install SDK");

    // The new branch is one commit ahead of where we started.
    const log = execFileSync("git", ["log", "--oneline", `${base}..HEAD`], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(log).toContain("honch: install SDK");

    // A second call avoids the existing branch name.
    expect(availableBranchName(dir, "honch/setup")).toBe("honch/setup-2");
  });
});
