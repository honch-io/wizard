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

function hasReactNativeDependency(packageJson: string): boolean {
  let pkg: {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    // A malformed package.json gives no reliable signal.
    return false;
  }
  return Boolean(
    pkg?.dependencies?.["react-native"] ??
      pkg?.devDependencies?.["react-native"],
  );
}

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

    // React Native must be an actual dependency — a "react-native" mention in a
    // script, config block, or metadata field is not a React Native app. Parse
    // the manifest and check the dependency maps rather than the whole file.
    if (path.endsWith("package.json") && hasReactNativeDependency(contents)) {
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

import footprint from "./feature-footprint.json";

export type WizardFeature = {
  /** Short id used as the multi-select option value. Matches a key in
   * feature-footprint.json for the optional features. */
  id: string;
  label: string;
  hint: string;
  /** The portable SDK compile-time macro — the `-D<NAME>=0` flag used by
   * C/POSIX, Arduino, and the MicroPython usermod. Omitted for the locked
   * core. */
  toggle?: string;
  /** The ESP-IDF Kconfig symbol for this feature (note: NOT the macro name —
   * e.g. HONCH_ENABLE_ERROR_TRACKING is surfaced as CONFIG_HONCH_ERROR_TRACKING).
   * The agent sets `<symbol>=n` in sdkconfig.defaults on ESP-IDF. */
  espIdfConfig?: string;
  /** The core: always compiled in, cannot be toggled off. */
  locked?: boolean;
  /** Measured footprint cost when this feature is compiled in — real numbers
   * from feature-footprint.json (ESP32, ESP-IDF v6.0.1, -Os, libhonch.a
   * archive attribution). RAM is static .bss/.data only; runtime queue/buffer
   * RAM is config-driven and separate. */
  flashBytes: number;
  ramBytes: number;
  /** Full wire-v2 bytes of this feature's headline auto-event (e.g. $crash for
   * error tracking) — the per-event network cost. 0 for the locked core, which
   * emits no auto-events of its own. */
  wireBytesPerEvent: number;
  /** The headline event the wire number measures, for labeling/docs. */
  wireEvent?: string;
};

const FP = footprint.features;

/** The optional feature set. ESP-IDF bundles crash capture, coredump upload,
 * and error-log capture under one toggle (HONCH_ENABLE_ERROR_TRACKING /
 * CONFIG_HONCH_ERROR_TRACKING), so they're presented as a single "Error
 * tracking" feature — matching what the SDK actually strips. */
export const HONCH_FEATURES: WizardFeature[] = [
  {
    id: "core",
    label: "Event tracking + wire & queue",
    hint: "the heart of the SDK — always included",
    locked: true,
    flashBytes: 0,
    ramBytes: 0,
    wireBytesPerEvent: 0,
  },
  {
    id: "error-tracking",
    label: "Error tracking (crashes + logs)",
    hint: "$crash + coredump upload and $error log capture",
    toggle: "HONCH_ENABLE_ERROR_TRACKING",
    espIdfConfig: "CONFIG_HONCH_ERROR_TRACKING",
    flashBytes: FP["error-tracking"].flash_bytes,
    ramBytes: FP["error-tracking"].ram_bytes,
    wireBytesPerEvent: FP["error-tracking"].wire_bytes_per_event,
    wireEvent: FP["error-tracking"].wire_event,
  },
  {
    id: "lifecycle",
    label: "Lifecycle events",
    hint: "$device_boot / $firmware_update / $device_shutdown",
    toggle: "HONCH_ENABLE_LIFECYCLE_EVENTS",
    espIdfConfig: "CONFIG_HONCH_LIFECYCLE_EVENTS",
    flashBytes: FP.lifecycle.flash_bytes,
    ramBytes: FP.lifecycle.ram_bytes,
    wireBytesPerEvent: FP.lifecycle.wire_bytes_per_event,
    wireEvent: FP.lifecycle.wire_event,
  },
  {
    id: "sessions",
    label: "Sessions",
    hint: "$session_start / $session_end",
    toggle: "HONCH_ENABLE_SESSIONS",
    espIdfConfig: "CONFIG_HONCH_SESSIONS",
    flashBytes: FP.sessions.flash_bytes,
    ramBytes: FP.sessions.ram_bytes,
    wireBytesPerEvent: FP.sessions.wire_bytes_per_event,
    wireEvent: FP.sessions.wire_event,
  },
  {
    id: "battery",
    label: "Battery telemetry",
    hint: "$battery_level + $battery_low (battery-powered devices)",
    toggle: "HONCH_ENABLE_BATTERY",
    espIdfConfig: "CONFIG_HONCH_BATTERY",
    flashBytes: FP.battery.flash_bytes,
    ramBytes: FP.battery.ram_bytes,
    wireBytesPerEvent: FP.battery.wire_bytes_per_event,
    wireEvent: FP.battery.wire_event,
  },
];

/** Compile-time feature stripping applies to the C-core SDKs; the React Native
 * relay has no such toggles. */
export function targetSupportsFeatures(id: SdkTargetId): boolean {
  return id !== "react-native-relay";
}
