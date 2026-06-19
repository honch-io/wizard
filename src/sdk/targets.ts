export type SdkTargetId =
  | "esp-idf"
  | "c-posix"
  | "micropython"
  | "arduino"
  | "react-native-relay";

export type ProjectFiles = Record<string, string>;

export type SdkTarget = {
  id: SdkTargetId;
  label: string;
  status: "stable" | "preview";
  skillPath: string;
  verificationHint: string;
};

export const SDK_TARGETS: Record<SdkTargetId, SdkTarget> = {
  "esp-idf": {
    id: "esp-idf",
    label: "ESP-IDF",
    status: "stable",
    skillPath: "skills/esp-idf/SKILL.md",
    verificationHint:
      "Run an ESP-IDF build only when the toolchain is present.",
  },
  "c-posix": {
    id: "c-posix",
    label: "C/POSIX",
    status: "stable",
    skillPath: "skills/c-posix/SKILL.md",
    verificationHint:
      "Run CMake configure/build or the project's existing tests.",
  },
  micropython: {
    id: "micropython",
    label: "MicroPython",
    status: "stable",
    skillPath: "skills/micropython/SKILL.md",
    verificationHint:
      "Run host checks when present and report firmware build steps.",
  },
  arduino: {
    id: "arduino",
    label: "Arduino ESP32 (preview)",
    status: "preview",
    skillPath: "skills/arduino/SKILL.md",
    verificationHint:
      "Record the PlatformIO/arduino-cli compile command; a full board build runs on demand.",
  },
  "react-native-relay": {
    id: "react-native-relay",
    label: "React Native relay (preview)",
    status: "preview",
    skillPath: "skills/react-native-relay/SKILL.md",
    verificationHint:
      "Verified through the project's own package-manager build; no firmware build is run.",
  },
};

export function detectSdkTargets(files: ProjectFiles): SdkTarget[] {
  const normalized = Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [
      path.toLowerCase(),
      contents,
    ]),
  );
  const found = new Set<SdkTargetId>();

  for (const [path, contents] of Object.entries(normalized)) {
    if (
      path.endsWith("cmakelists.txt") &&
      (contents.includes("idf_component_register") ||
        contents.includes("ESP_PLATFORM") ||
        contents.includes("$ENV{IDF_PATH}"))
    ) {
      found.add("esp-idf");
    }

    if (
      path.endsWith("cmakelists.txt") &&
      /\bproject\s*\([^)]*\bC\b/i.test(contents) &&
      !contents.includes("idf_component_register")
    ) {
      found.add("c-posix");
    }

    if (
      path.endsWith("manifest.py") ||
      path.endsWith("boot.py") ||
      path.endsWith("main.py") ||
      contents.includes("USER_C_MODULES") ||
      contents.includes("micropython.cmake")
    ) {
      found.add("micropython");
    }

    if (
      path.endsWith(".ino") ||
      path.endsWith("sketch.yaml") ||
      path.endsWith("platformio.ini")
    ) {
      found.add("arduino");
    }

    if (
      path.endsWith("package.json") &&
      /["']react-native["']\s*:/.test(contents)
    ) {
      found.add("react-native-relay");
    }
  }

  return Array.from(found).map((id) => SDK_TARGETS[id]);
}
