import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanProject } from "../src/project/scan.js";

describe("scanProject", () => {
  it("reads target detection files from disk", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "honch-scan-"));
    writeFileSync(
      path.join(dir, "CMakeLists.txt"),
      "project(camera C)\nadd_executable(camera main.c)",
    );

    const scan = scanProject(dir);

    expect(scan.detectedTargets.map((target) => target.id)).toContain(
      "c-posix",
    );
    expect(scan.files["CMakeLists.txt"]).toContain("project(camera C)");
  });

  it("throws a friendly error when the install dir is missing", () => {
    const missing = path.join(
      tmpdir(),
      `honch-scan-missing-${Date.now()}`,
      "nope",
    );

    expect(() => scanProject(missing)).toThrow(
      /Couldn't read the project directory .* check the path and permissions\./,
    );
  });
});
