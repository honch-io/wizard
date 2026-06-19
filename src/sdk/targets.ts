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

    // MicroPython needs a real on-device signal. A bare main.py is normal in
    // any host CPython project, so match the frozen-manifest/native-module
    // build markers, a boot.py (the MicroPython boot convention), or Python
    // that imports a MicroPython-only module — never main.py alone.
    if (
      path.endsWith("manifest.py") ||
      path.endsWith("boot.py") ||
      contents.includes("USER_C_MODULES") ||
      contents.includes("micropython.cmake") ||
      (path.endsWith(".py") &&
        /\b(?:import|from)\s+(?:machine|micropython|esp32?|pyb|ubinascii|uasyncio)\b/.test(
          contents,
        ))
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

  // ESP-IDF projects are C/CMake projects too, so their many CMakeLists.txt
  // files trip the generic C/POSIX heuristic alongside the IDF one. ESP-IDF is
  // the more specific match, so it wins — never report both.
  if (found.has("esp-idf")) {
    found.delete("c-posix");
  }

  // Return the most specific match first so callers (welcome summary, target
  // picker) lead with the SDK the project most likely is.
  const priority: SdkTargetId[] = [
    "esp-idf",
    "micropython",
    "arduino",
    "react-native-relay",
    "c-posix",
  ];
  return priority.filter((id) => found.has(id)).map((id) => SDK_TARGETS[id]);
}
