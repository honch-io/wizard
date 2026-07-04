import { detectSdkTargets } from "@honch/agent-core";
import { describe, expect, it } from "vitest";

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

  it("detects Arduino projects from sketches and PlatformIO config", () => {
    const result = detectSdkTargets({
      "blink.ino": "void setup() {}\nvoid loop() {}",
      "platformio.ini": "[env:esp32]\nplatform = espressif32",
    });

    expect(result.map((target) => target.id)).toContain("arduino");
  });

  it("detects React Native projects from a react-native dependency", () => {
    const result = detectSdkTargets({
      "package.json": '{ "dependencies": { "react-native": "0.74.0" } }',
    });

    expect(result.map((target) => target.id)).toContain("react-native-relay");
  });

  it("requires react-native in dependencies, not just anywhere in package.json", () => {
    // A "react-native" mention outside dependencies (a config block, a script,
    // a metadata field) is not a React Native app and must not be detected.
    const result = detectSdkTargets({
      "package.json":
        '{ "name": "app", "config": { "react-native": "metro" } }',
    });

    expect(result.map((target) => target.id)).not.toContain(
      "react-native-relay",
    );
  });

  it("reports only ESP-IDF (not C/POSIX) for an IDF project's CMake files", () => {
    // A real ESP-IDF project: the top-level CMakeLists declares a C project and
    // the component CMakeLists registers via idf_component_register. The generic
    // C/POSIX heuristic would otherwise also match the top-level file.
    const result = detectSdkTargets({
      "CMakeLists.txt":
        "cmake_minimum_required(VERSION 3.16)\n" +
        "include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n" +
        "project(camera C)",
      "main/CMakeLists.txt": 'idf_component_register(SRCS "app_main.c")',
    });

    expect(result.map((target) => target.id)).toEqual(["esp-idf"]);
  });

  it("leads with the detected SDK by priority", () => {
    const result = detectSdkTargets({
      "blink.ino": "void setup() {}",
      "main/CMakeLists.txt": 'idf_component_register(SRCS "app_main.c")',
    });

    expect(result[0].id).toBe("esp-idf");
  });
});
