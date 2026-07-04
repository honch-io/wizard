import { resolveInstallOutcome } from "@honch/agent-core";
import { describe, expect, it } from "vitest";

describe("@honch/agent-core workspace wiring", () => {
  it("re-exports the real engine surface", () => {
    expect(
      resolveInstallOutcome({ agentWroteFiles: true, gitChangedCount: 0 }),
    ).toEqual({ integrated: true, unverifiedByGit: true });
  });
});
