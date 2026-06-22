import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

  it("does not auto-detect an SDK when launched outside a project directory", () => {
    // Mirrors running `honch` in a home dir: the top level holds only dotfiles
    // and loose config, but an unrelated ESP-IDF source tree sits a couple
    // levels down. Detection must stay grounded on the launch dir being a
    // project — it must not adopt an SDK from a nested, unrelated tree.
    const home = mkdtempSync(path.join(tmpdir(), "honch-home-"));
    writeFileSync(path.join(home, ".bashrc"), "export X=1\n");
    writeFileSync(path.join(home, "config.json"), "{}\n");
    const idf = path.join(home, "esp", "esp-idf-v6.0.1");
    mkdirSync(idf, { recursive: true });
    writeFileSync(
      path.join(idf, "CMakeLists.txt"),
      "include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n" +
        'idf_component_register(SRCS "main.c")\n',
    );

    const scan = scanProject(home);

    expect(scan.detectedTargets).toEqual([]);
  });

  it("ignores SDK markers inside hidden tool directories", () => {
    // A real C/POSIX project that also carries a toolchain cache (an
    // ~/.espressif-style dir) nested beneath it. The hidden dir's ESP-IDF files
    // must not leak into detection.
    const dir = mkdtempSync(path.join(tmpdir(), "honch-hidden-"));
    writeFileSync(
      path.join(dir, "CMakeLists.txt"),
      "project(app C)\nadd_executable(app main.c)\n",
    );
    const cache = path.join(dir, ".espressif", "frameworks", "esp-idf");
    mkdirSync(cache, { recursive: true });
    writeFileSync(
      path.join(cache, "CMakeLists.txt"),
      'idf_component_register(SRCS "x.c")\n',
    );

    const scan = scanProject(dir);

    const ids = scan.detectedTargets.map((target) => target.id);
    expect(ids).toContain("c-posix");
    expect(ids).not.toContain("esp-idf");
  });

  it("detects ESP-IDF from a real project layout (root + main/)", () => {
    // Regression guard: the grounding changes (root gate, hidden-dir skip,
    // shallower depth) must not break detection of a genuine ESP-IDF project,
    // whose registering CMakeLists lives one level down in main/.
    const dir = mkdtempSync(path.join(tmpdir(), "honch-idf-"));
    writeFileSync(
      path.join(dir, "CMakeLists.txt"),
      "cmake_minimum_required(VERSION 3.16)\n" +
        "include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n" +
        "project(app C)\n",
    );
    const main = path.join(dir, "main");
    mkdirSync(main, { recursive: true });
    writeFileSync(
      path.join(main, "CMakeLists.txt"),
      'idf_component_register(SRCS "main.c")\n',
    );

    const scan = scanProject(dir);

    expect(scan.detectedTargets.map((target) => target.id)).toEqual([
      "esp-idf",
    ]);
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
