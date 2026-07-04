import { createSecretVault } from "@honch/agent-core";
import { describe, expect, it } from "vitest";

describe("createSecretVault", () => {
  it("returns opaque refs without exposing stored values", () => {
    const vault = createSecretVault();

    const ref = vault.put("honch_project_key", "honch_secret_value");

    expect(ref).toMatch(/^secret:/);
    expect(ref).not.toContain("honch_secret_value");
    expect(vault.resolve(ref)).toBe("honch_secret_value");
    expect(vault.list()).toEqual([
      expect.objectContaining({ label: "honch_project_key" }),
    ]);
  });

  it("rejects unknown refs", () => {
    const vault = createSecretVault();

    expect(() => vault.resolve("secret:missing")).toThrow("Unknown secret ref");
  });
});
