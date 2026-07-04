/**
 * End-to-end integration of the change-detection + verdict + report pipeline
 * against REAL git — the exact chain that misfired in the field (a "Honch was
 * not installed" banner sitting above the agent's own "integration is complete"
 * summary). These tests drive the real snapshotProject / changedFilesSince
 * (from snapshot.ts) composed exactly as workflow.ts composes them, so the wiring
 * — not just the pure units — is covered.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSetupReport, resolveInstallOutcome } from "@honch/agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { changedFilesSince, snapshotProject } from "../src/project/snapshot.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]) {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" });
}

/** A committed git repo, like a real client checkout. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "honch-e2e-"));
  dirs.push(dir);
  git(dir, "init");
  git(dir, "config", "user.email", "test@honch.io");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "README.md"), "top\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  return dir;
}

/**
 * The whole pipeline as workflow.ts runs it: snapshot before, compare after,
 * reconcile the git diff with the agent's observed writes, build the report.
 */
function runPipeline(input: {
  dir: string;
  snapshot: string | undefined;
  agentWrittenFiles: string[];
  agentSummary?: string;
}) {
  const gitChanged = changedFilesSince(input.dir, input.snapshot).filter(
    (f) => f !== "honch-setup-report.md",
  );
  const agentWritten = input.agentWrittenFiles.filter(
    (f) => !f.endsWith("honch-setup-report.md"),
  );
  const { integrated, unverifiedByGit } = resolveInstallOutcome({
    agentWroteFiles: agentWritten.length > 0,
    gitChangedCount: gitChanged.length,
  });
  const report = buildSetupReport({
    targetLabel: "C/POSIX",
    projectName: "Test",
    deviceModel: "AnchorCam",
    agentRan: true,
    integrated,
    unverifiedByGit,
    agentSummary: input.agentSummary,
    verification: ["agent run completed"],
  });
  return { gitChanged, integrated, unverifiedByGit, report };
}

const SUCCESS_CLAIM =
  "Honch C/POSIX SDK integration is complete. Added VERSION to CMakeLists.txt, created anchor_honch.c, wired anchor_honch_start() into main.c.";

/** Assert a report never simultaneously claims integrated AND not-integrated. */
function expectCoherent(report: string) {
  const saysNo = report.includes("not** integrated");
  const saysYesUnqualified = /Honch was integrated —/.test(report) && !saysNo;
  // Never both.
  expect(saysNo && saysYesUnqualified).toBe(false);
  // If it embeds a success-claiming summary while saying "not integrated", the
  // claim must be explicitly flagged unverified (the field-bug guard).
  if (saysNo && report.includes("integration is complete")) {
    expect(report.toLowerCase()).toContain("unverified");
  }
}

describe("install outcome — real-git end to end", () => {
  it("FIELD CASE: agent writes into a nested module git can't see → integrated, not a false 'not installed'", () => {
    const dir = repo();
    // Nested module (submodule-like) buried where the luckfox app lives.
    const nested = join(dir, "project", "app", "uvc_app_tiny", "uvc_app");
    mkdirSync(nested, { recursive: true });
    git(nested, "init");
    git(nested, "config", "user.email", "test@honch.io");
    git(nested, "config", "user.name", "Test");
    writeFileSync(join(nested, "main.c"), "int main(){}\n");
    git(nested, "add", "-A");
    git(nested, "commit", "-m", "init nested");

    const snapshot = snapshotProject(dir);
    // Agent wires Honch into the nested module.
    writeFileSync(join(nested, "CMakeLists.txt"), "project(x VERSION 0.1.0)\n");
    writeFileSync(join(nested, "anchor_honch.c"), "// honch\n");

    const r = runPipeline({
      dir,
      snapshot,
      agentWrittenFiles: [
        join(nested, "CMakeLists.txt"),
        join(nested, "anchor_honch.c"),
      ],
      agentSummary: SUCCESS_CLAIM,
    });

    // Git is genuinely blind here — this is what broke the old code.
    expect(r.gitChanged).toEqual([]);
    // The fix: the agent's writes win.
    expect(r.integrated).toBe(true);
    expect(r.unverifiedByGit).toBe(true);
    expect(r.report).not.toContain("not** integrated");
    expect(r.report.toLowerCase()).toMatch(/submodule|nested|not visible/);
    expectCoherent(r.report);
  });

  it("BLIND SPOT: agent writes only into a .gitignored path → still integrated", () => {
    const dir = repo();
    writeFileSync(join(dir, ".gitignore"), "generated/\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-m", "ignore");
    const snapshot = snapshotProject(dir);
    mkdirSync(join(dir, "generated"), { recursive: true });
    writeFileSync(join(dir, "generated", "honch_cfg.c"), "// honch\n");

    const r = runPipeline({
      dir,
      snapshot,
      agentWrittenFiles: [join(dir, "generated", "honch_cfg.c")],
      agentSummary: SUCCESS_CLAIM,
    });
    expect(r.gitChanged).toEqual([]);
    expect(r.integrated).toBe(true);
    expect(r.unverifiedByGit).toBe(true);
    expectCoherent(r.report);
  });

  it("NON-GIT PROJECT: no snapshot, agent wrote files → integrated (not silent 'no changes')", () => {
    const dir = mkdtempSync(join(tmpdir(), "honch-e2e-plain-"));
    dirs.push(dir);
    writeFileSync(join(dir, "main.c"), "int main(){}\n");
    const snapshot = snapshotProject(dir); // undefined — not a git repo
    expect(snapshot).toBeUndefined();
    writeFileSync(join(dir, "honch.c"), "// honch\n");

    const r = runPipeline({
      dir,
      snapshot,
      agentWrittenFiles: [join(dir, "honch.c")],
      agentSummary: SUCCESS_CLAIM,
    });
    expect(r.gitChanged).toEqual([]);
    expect(r.integrated).toBe(true);
    expect(r.unverifiedByGit).toBe(true);
    expectCoherent(r.report);
  });

  it("HEALTHY: normal tracked edits → integrated and git-verified (no submodule caveat)", () => {
    const dir = repo();
    const snapshot = snapshotProject(dir);
    writeFileSync(join(dir, "CMakeLists.txt"), "project(x VERSION 0.1.0)\n");
    writeFileSync(join(dir, "honch.c"), "// honch\n");

    const r = runPipeline({
      dir,
      snapshot,
      agentWrittenFiles: [join(dir, "CMakeLists.txt"), join(dir, "honch.c")],
    });
    expect(r.gitChanged.sort()).toEqual(["CMakeLists.txt", "honch.c"]);
    expect(r.integrated).toBe(true);
    expect(r.unverifiedByGit).toBe(false);
    expect(r.report).not.toContain("not** integrated");
    expect(r.report.toLowerCase()).not.toContain("unverified");
    expectCoherent(r.report);
  });

  it("HONEST NO-OP: agent changed nothing → coherent 'not integrated', no false success", () => {
    const dir = repo();
    const snapshot = snapshotProject(dir);
    // Agent only wrote its own report (excluded), touched no project files.
    const r = runPipeline({
      dir,
      snapshot,
      agentWrittenFiles: [join(dir, "honch-setup-report.md")],
      agentSummary: SUCCESS_CLAIM,
    });
    expect(r.gitChanged).toEqual([]);
    expect(r.integrated).toBe(false);
    expect(r.report).toContain("not** integrated");
    // The success claim is present but explicitly flagged unverified.
    expect(r.report.toLowerCase()).toContain("unverified");
    expectCoherent(r.report);
  });
});
