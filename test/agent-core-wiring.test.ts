import { AGENT_CORE_READY } from "@honch/agent-core";
import { describe, expect, it } from "vitest";

describe("@honch/agent-core workspace wiring", () => {
  it("resolves the package specifier from the workspace", () => {
    expect(AGENT_CORE_READY).toBe(true);
  });
});
