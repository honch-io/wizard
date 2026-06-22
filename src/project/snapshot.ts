/**
 * Non-destructive working-tree snapshots for the install step.
 *
 * Before the agent runs we capture the project's working tree as a git tree
 * object using a throwaway index (GIT_INDEX_FILE), so the user's real index and
 * staged changes are never touched. If the user later asks to revert Claude's
 * work, we restore tracked files from that tree and delete anything the agent
 * created afterward.
 *
 * Snapshots only work inside a git work tree. The ESP-IDF install already
 * initializes one before the agent runs; for other targets revert is offered
 * only when the project is already a git repo.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type GitRunner = (
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
) => string;

function runGitCommand(
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
): string {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
}

/** True when the repo has at least one commit (needed to branch from HEAD). */
export function hasCommits(
  dir: string,
  runGit: GitRunner = runGitCommand,
): boolean {
  try {
    runGit(["rev-parse", "--verify", "HEAD"], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

function branchExists(dir: string, name: string, runGit: GitRunner): boolean {
  try {
    runGit(["rev-parse", "--verify", `refs/heads/${name}`], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

/** A branch name based on `base` that doesn't already exist. */
export function availableBranchName(
  dir: string,
  base: string,
  runGit: GitRunner = runGitCommand,
): string {
  if (!branchExists(dir, base, runGit)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!branchExists(dir, candidate, runGit)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** The current branch name, or undefined when detached / not a repo. */
export function currentBranch(
  dir: string,
  runGit: GitRunner = runGitCommand,
): string | undefined {
  try {
    const name = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: dir,
    }).trim();
    return name && name !== "HEAD" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Create and switch to a new branch (carrying the working tree along). */
export function createBranch(
  dir: string,
  name: string,
  runGit: GitRunner = runGitCommand,
): void {
  runGit(["checkout", "-b", name], { cwd: dir });
}

/** Commit everything in the working tree; a no-op when there's nothing staged. */
export function commitAll(
  dir: string,
  message: string,
  runGit: GitRunner = runGitCommand,
): void {
  runGit(["add", "-A"], { cwd: dir });
  try {
    runGit(["commit", "-m", message, "--no-verify"], { cwd: dir });
  } catch {
    // Nothing to commit — fine.
  }
}

/** Initialize a git work tree in `dir` so snapshots and revert become available.
 * Works on an empty repo — snapshotProject uses write-tree, not commits. */
export function gitInit(dir: string, runGit: GitRunner = runGitCommand): void {
  runGit(["init"], { cwd: dir });
}

export function isGitWorkTree(
  dir: string,
  runGit: GitRunner = runGitCommand,
): boolean {
  try {
    return (
      runGit(["rev-parse", "--is-inside-work-tree"], { cwd: dir }).trim() ===
      "true"
    );
  } catch {
    return false;
  }
}

function freshIndex(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), "index");
}

/**
 * Capture the current working tree as a git tree SHA, or undefined when the
 * directory is not a git work tree. Uses a temp index so the real one is safe.
 */
export function snapshotProject(
  dir: string,
  runGit: GitRunner = runGitCommand,
): string | undefined {
  if (!isGitWorkTree(dir, runGit)) return undefined;
  const env = { GIT_INDEX_FILE: freshIndex("honch-snap-") };
  // Stage the whole working tree (tracked + untracked, .gitignore respected).
  runGit(["add", "-A"], { cwd: dir, env });
  return runGit(["write-tree"], { cwd: dir, env }).trim();
}

/**
 * List the paths that changed (added, modified, or deleted) in the working tree
 * since the given snapshot tree. Returns [] when the directory isn't a git work
 * tree or the snapshot is unknown — i.e. when we can't tell.
 */
export function changedFilesSince(
  dir: string,
  tree: string | undefined,
  runGit: GitRunner = runGitCommand,
): string[] {
  if (!tree || !isGitWorkTree(dir, runGit)) return [];
  const env = { GIT_INDEX_FILE: freshIndex("honch-changed-") };
  runGit(["add", "-A"], { cwd: dir, env });
  const out = runGit(["diff", "--cached", "--name-only", tree], {
    cwd: dir,
    env,
  }).trim();
  return out.split("\n").filter(Boolean);
}

/**
 * Restore the working tree to a snapshot tree: overwrite tracked files with the
 * snapshot version and delete files created after the snapshot was taken.
 */
export function restoreProject(
  dir: string,
  tree: string,
  runGit: GitRunner = runGitCommand,
): void {
  const restoreEnv = { GIT_INDEX_FILE: freshIndex("honch-restore-") };
  runGit(["read-tree", tree], { cwd: dir, env: restoreEnv });
  runGit(["checkout-index", "-a", "-f"], { cwd: dir, env: restoreEnv });

  // Anything present now but absent from the snapshot tree was added by the
  // agent — remove it so the revert is faithful.
  const currentEnv = { GIT_INDEX_FILE: freshIndex("honch-current-") };
  runGit(["add", "-A"], { cwd: dir, env: currentEnv });
  const added = runGit(
    ["diff", "--cached", "--name-only", "--diff-filter=A", tree],
    { cwd: dir, env: currentEnv },
  ).trim();
  for (const file of added.split("\n").filter(Boolean)) {
    rmSync(join(dir, file), { force: true });
  }
}
