import { describe, expect, it } from "vitest";
import { detectSdkTargets } from "../src/sdk/targets.js";

describe("detectSdkTargets", () => {
  it("detects ESP-IDF projects from idf_component_register", () => {
    const result = detectSdkTargets({
      "main/CMakeLists.txt": 'idf_component_register(SRCS "app_main.c")',
    });

    expect(result.map((target) => target.id)).toContain("esp-idf");
  });

  it("detects C/POSIX projects from CMake C targets", () => {
    const result = detectSdkTargets({
      "CMakeLists.txt": "project(camera C)\nadd_executable(camera main.c)",
    });

    expect(result.map((target) => target.id)).toContain("c-posix");
  });

  it("detects MicroPython projects from MicroPython manifests", () => {
    const result = detectSdkTargets({
      "manifest.py": 'package("app")',
      "boot.py": "print('boot')",
    });

    expect(result.map((target) => target.id)).toContain("micropython");
  });
});
