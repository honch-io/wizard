import { resolveInstallOutcome } from "@honch/agent-core";
import { describe, expect, it } from "vitest";

describe("resolveInstallOutcome", () => {
  it("is integrated when the agent wrote files, even if git saw nothing (submodule/nested/ignored/non-git)", () => {
    // The exact failure from the field: edits landed inside a nested module the
    // repo-root git diff can't see. The agent's Write calls are authoritative.
    expect(
      resolveInstallOutcome({ agentWroteFiles: true, gitChangedCount: 0 }),
    ).toEqual({ integrated: true, unverifiedByGit: true });
  });

  it("is integrated and git-verified when both signals agree", () => {
    expect(
      resolveInstallOutcome({ agentWroteFiles: true, gitChangedCount: 3 }),
    ).toEqual({ integrated: true, unverifiedByGit: false });
  });

  it("is integrated when only git saw changes (agent wrote via Bash, no Write/Edit tool call)", () => {
    expect(
      resolveInstallOutcome({ agentWroteFiles: false, gitChangedCount: 2 }),
    ).toEqual({ integrated: true, unverifiedByGit: false });
  });

  it("is NOT integrated only when neither signal saw any change", () => {
    expect(
      resolveInstallOutcome({ agentWroteFiles: false, gitChangedCount: 0 }),
    ).toEqual({ integrated: false, unverifiedByGit: false });
  });
});
