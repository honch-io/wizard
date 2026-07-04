import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkEnvKeys,
  createSecretVault,
  detectPackageManager,
  setEnvValues,
} from "@honch/agent-core";
import { describe, expect, it } from "vitest";

describe("local tools", () => {
  it("detects package managers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "honch-tools-"));
    writeFileSync(path.join(dir, "bun.lock"), "");

    expect(detectPackageManager(dir)).toEqual(["bun"]);
  });

  it("writes secret refs into env files without returning values", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "honch-env-"));
    const vault = createSecretVault();
    const secretRef = vault.put("project key", "honch_secret");

    const result = setEnvValues(
      dir,
      ".env",
      { HONCH_API_KEY: { secretRef } },
      vault,
    );

    expect(result.keys).toEqual(["HONCH_API_KEY"]);
    expect(result.valuesReturned).toBe(false);
    expect(readFileSync(path.join(dir, ".env"), "utf8")).toContain(
      "HONCH_API_KEY=honch_secret",
    );
    expect(checkEnvKeys(dir, ".env", ["HONCH_API_KEY"])).toEqual({
      HONCH_API_KEY: true,
    });
  });
});
