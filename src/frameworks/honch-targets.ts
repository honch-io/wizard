/**
 * Honch SDK targets.
 *
 * Replaces PostHog's per-web-framework modules. Each target is a
 * FrameworkConfig the universal runner consumes: detection (which build files
 * mark this target), the env vars the installed SDK reads, and the
 * agent-prompt hints. The deep install knowledge lives in the bundled
 * per-target skill (src/skills/<id>/SKILL.md), which the agent reads.
 *
 * Firmware targets (esp-idf, arduino, c-posix, micropython) run the Device SDK
 * on hardware; the react-native-relay target runs the relay in a companion app.
 */

import * as fs from 'node:fs';
import { join } from 'node:path';
import { Integration, HONCH_DOCS_URL } from '@lib/constants';
import type { FrameworkConfig } from '@lib/framework-config';
import { detectNodePackageManagers } from '@lib/detection/package-manager';

// ── fs helpers (depth-shallow; detection only needs the project root) ──

function fileExists(dir: string, rel: string): boolean {
  try {
    return fs.existsSync(join(dir, rel));
  } catch {
    return false;
  }
}

function readText(dir: string, rel: string): string | null {
  try {
    return fs.readFileSync(join(dir, rel), 'utf8');
  } catch {
    return null;
  }
}

function anyExists(dir: string, rels: string[]): boolean {
  return rels.some((r) => fileExists(dir, r));
}

/** Concatenate the top-level and main/ CMakeLists for marker checks. */
function cmakeText(dir: string): string {
  return `${readText(dir, 'CMakeLists.txt') ?? ''}\n${
    readText(dir, 'main/CMakeLists.txt') ?? ''
  }`;
}

function readJson(dir: string, rel: string): Record<string, unknown> | null {
  const raw = readText(dir, rel);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── detection predicates ──

function detectEspIdf(installDir: string): boolean {
  const t = cmakeText(installDir);
  if (/idf_component_register|ESP_PLATFORM|\$ENV\{IDF_PATH\}/.test(t))
    return true;
  return anyExists(installDir, [
    'sdkconfig',
    'sdkconfig.defaults',
    'idf_component.yml',
    'main/idf_component.yml',
    'partitions.csv',
  ]);
}

/** True if the directory (root or one level deep) holds an Arduino `.ino` sketch. */
function hasInoSketch(installDir: string): boolean {
  try {
    for (const entry of fs.readdirSync(installDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.ino')) return true;
      if (entry.isDirectory()) {
        try {
          if (
            fs
              .readdirSync(join(installDir, entry.name))
              .some((f) => f.endsWith('.ino'))
          )
            return true;
        } catch {
          // unreadable subdir — ignore
        }
      }
    }
  } catch {
    // unreadable project root — ignore
  }
  return false;
}

function detectArduino(installDir: string): boolean {
  // arduino-cli sketch profile, or an Arduino-framework PlatformIO project.
  if (fileExists(installDir, 'sketch.yaml')) return true;
  const pio = readText(installDir, 'platformio.ini');
  if (pio && /framework\s*=\s*[^\n]*\barduino\b/i.test(pio)) return true;
  return hasInoSketch(installDir);
}

function detectCPosix(installDir: string): boolean {
  const t = readText(installDir, 'CMakeLists.txt') ?? '';
  return (
    /project\s*\(/i.test(t) && !/idf_component_register|ESP_PLATFORM/.test(t)
  );
}

function detectMicropython(installDir: string): boolean {
  if (anyExists(installDir, ['manifest.py', 'boot.py', 'main.py'])) return true;
  return /USER_C_MODULES|micropython/i.test(cmakeText(installDir));
}

function hasDependency(installDir: string, name: string): boolean {
  const json = readJson(installDir, 'package.json');
  if (!json) return false;
  const deps = {
    ...((json.dependencies as Record<string, string>) ?? {}),
    ...((json.devDependencies as Record<string, string>) ?? {}),
  };
  return name in deps;
}

function detectReactNativeRelay(installDir: string): boolean {
  return (
    hasDependency(installDir, 'react-native') ||
    hasDependency(installDir, '@honch/react-native-relay')
  );
}

// ── config factory ──

type Kind = 'firmware' | 'mobile';

function honchTarget(opts: {
  id: Integration;
  name: string;
  kind: Kind;
  packageName: string;
  detect: (installDir: string) => boolean;
  projectTypeDetection: string;
  contextLines: string[];
  successMessage: string;
  estimatedDurationMinutes: number;
  packageInstallation?: string;
  /**
   * The config-symbol names the wizard writes the capture key + host under, so
   * the outro reflects what was actually written. ESP-IDF reads these through
   * Kconfig, so its symbols carry the `CONFIG_` prefix (`CONFIG_HONCH_API_KEY` /
   * `CONFIG_HONCH_HOST`) — the same names firmware-verify and the skill use;
   * every other target reads bare env / build-flag names. Keep these in sync
   * with the skill + firmware-verify if getEnvVars ever drives a real write.
   */
  envVarNames?: { key: string; host: string };
}): FrameworkConfig {
  const firmware = opts.kind === 'firmware';
  const envVarNames =
    opts.envVarNames ??
    (firmware
      ? { key: 'HONCH_API_KEY', host: 'HONCH_HOST' }
      : { key: 'HONCH_PROJECT_KEY', host: 'HONCH_CAPTURE_HOST' });
  return {
    metadata: {
      name: opts.name,
      integration: opts.id,
      docsUrl: `${HONCH_DOCS_URL}/sdks/${opts.id}`,
    },
    detection: {
      packageName: opts.packageName,
      packageDisplayName: opts.name,
      usesPackageJson: !firmware,
      getVersion: () => undefined,
      detect: (o) => Promise.resolve(opts.detect(o.installDir)),
      detectPackageManager: detectNodePackageManagers,
    },
    environment: {
      uploadToHosting: false,
      getEnvVars: (apiKey, host): Record<string, string> => ({
        [envVarNames.key]: apiKey,
        [envVarNames.host]: host,
      }),
    },
    analytics: { getTags: () => ({ target: opts.id }) },
    prompts: {
      projectTypeDetection: opts.projectTypeDetection,
      packageInstallation: opts.packageInstallation,
      getAdditionalContextLines: () => opts.contextLines,
    },
    ui: {
      successMessage: opts.successMessage,
      estimatedDurationMinutes: opts.estimatedDurationMinutes,
      getOutroChanges: () => [],
      getOutroNextSteps: () => [
        'Review the SDK integration changes before committing them.',
        "Run your project's normal build and confirm events reach the Honch dashboard.",
      ],
    },
  };
}

// ── the targets (detection order: most specific first) ──

export const HONCH_TARGETS: readonly FrameworkConfig[] = [
  honchTarget({
    id: Integration.espIdf,
    name: 'ESP-IDF',
    kind: 'firmware',
    packageName: 'honch',
    // ESP-IDF reads the key/host as Kconfig symbols; the wizard writes (and
    // firmware-verify checks) the CONFIG_-prefixed names, not bare HONCH_*.
    envVarNames: { key: 'CONFIG_HONCH_API_KEY', host: 'CONFIG_HONCH_HOST' },
    detect: detectEspIdf,
    projectTypeDetection:
      'ESP-IDF firmware: a top-level and main/ CMakeLists.txt using idf_component_register, plus idf_component.yml / sdkconfig.',
    contextLines: [
      'The wizard has ALREADY registered the Honch SDK as a git submodule at components/honch — do NOT re-add it, replace it with the ESP component manager, vendor a copy, or point at a local path. Just add `REQUIRES honch` to the relevant idf_component_register(...) so the build links it (the SDK repo root is itself the component, so no EXTRA_COMPONENT_DIRS).',
      'honch_init() needs an active IP — call it after Wi-Fi/IP is up, never directly from app_main(); drive honch_tick() from a low-priority task, never an ISR.',
      'Honch calls return honch_err_t (success HONCH_OK), not esp_err_t. Record events with honch_track(event, props, count); honch_capture() does not exist. Read the installed honch.h as the only source of truth.',
      'The SDK component ships NO Kconfig — CONFIG_HONCH_API_KEY/CONFIG_HONCH_HOST do not exist until you declare them in your app component (main/Kconfig.projbuild). Declare both string symbols there before reading them in C, or set_env_values writes keys that reconfigure silently discards.',
    ],
    successMessage: 'Honch ESP-IDF SDK integrated.',
    estimatedDurationMinutes: 4,
    packageInstallation:
      'Use idf.py / the ESP-IDF component manager, not a Node package manager.',
  }),
  honchTarget({
    id: Integration.arduino,
    name: 'Arduino ESP32',
    kind: 'firmware',
    packageName: 'honch',
    detect: detectArduino,
    projectTypeDetection:
      'An Arduino ESP32 sketch (a .ino file, sketch.yaml, or a PlatformIO project with framework = arduino). ESP32 only — not bare ESP-IDF and not non-ESP32 Arduino boards.',
    contextLines: [
      'Preview SDK. Include <Honch.h> and use the wrapper singleton: honch::defaultClient().begin(config) (returns bool), then .track(name, props, count) / .identify / .tick / .flush. Methods return bool — check honch::defaultClient().lastError() on false; there is no honch_err_t/HONCH_OK here. Read the installed Honch.h as the only source of truth.',
      'Config is a HonchConfig struct (C++ designated initializers): apiKey, host, rootCaPem, deviceModel, firmwareVersion, eventBuffer (caller-owned uint8_t[], >= 8192) + eventBufferSize. Build event properties with honch_prop()/honch_str()/honch_i64() from honch/core (same helpers as the C ports).',
      'Requires the ESP32 Arduino core plus WiFi, HTTPClient, WiFiClientSecure. Bring up Wi-Fi BEFORE begin(); set rootCaPem for TLS and keep insecureSkipTlsVerify=false in production. Drive .tick() from a dedicated low-priority FreeRTOS pump task (>= 8192-byte stack) — it runs a synchronous HTTPS POST and must never run on an ISR, control loop, or latency-sensitive loop().',
      'Secrets are compile-time on Arduino: never commit the raw key. For PlatformIO, write the key via set_env_values and inject it with build_flags using ${sysenv.HONCH_API_KEY}; for a plain .ino, keep it in a gitignored secrets header. Read the skill for the exact pattern.',
    ],
    successMessage: 'Honch Arduino ESP32 SDK integrated.',
    estimatedDurationMinutes: 5,
    packageInstallation:
      'Use the Arduino Library Manager / arduino-cli lib install, or PlatformIO lib_deps — not a Node package manager.',
  }),
  honchTarget({
    id: Integration.cPosix,
    name: 'C/POSIX',
    kind: 'firmware',
    packageName: 'honch_posix',
    detect: detectCPosix,
    projectTypeDetection:
      'A C/CMake project (project(... C ...) in CMakeLists.txt) without ESP-IDF markers.',
    contextLines: [
      'Prefer find_package(honch_posix REQUIRED); otherwise use CMake FetchContent with SOURCE_SUBDIR ports/posix. Link with honch::honch_posix.',
      'Configure api_key, endpoint_url, device_model, firmware_version, and a durable queue_directory; preserve queue durability, retry, and timestamps.',
      'The POSIX API is client-handle based and returns honch_status_t: honch_init(&client, &cfg), then honch_track(client, …) — NOT the ESP-IDF global-singleton honch_init(&cfg)/honch_err_t form. Read the installed honch.h as the only source of truth.',
    ],
    successMessage: 'Honch C/POSIX SDK integrated.',
    estimatedDurationMinutes: 4,
    packageInstallation:
      'Use CMake (find_package or FetchContent), not a Node package manager.',
  }),
  honchTarget({
    id: Integration.micropython,
    name: 'MicroPython',
    kind: 'firmware',
    packageName: 'honch',
    detect: detectMicropython,
    projectTypeDetection:
      'A MicroPython project: manifest.py / boot.py / main.py, or USER_C_MODULES / micropython.cmake.',
    contextLines: [
      'The firmware must include the native _honch_core module via USER_C_MODULES (ports/micropython/usermod/honch/micropython.cmake); freeze the Python wrapper through manifest.py when appropriate.',
      'Do not duplicate /lib/honch files if the wrapper is frozen; clearly report the firmware build steps when runtime validation cannot run locally.',
    ],
    successMessage: 'Honch MicroPython SDK integrated.',
    estimatedDurationMinutes: 5,
    packageInstallation:
      'Build MicroPython with the Honch user C module; do not use a Node package manager.',
  }),
  honchTarget({
    id: Integration.reactNativeRelay,
    name: 'React Native relay',
    kind: 'mobile',
    packageName: '@honch/react-native-relay',
    detect: detectReactNativeRelay,
    projectTypeDetection:
      'A React Native app (react-native in package.json), optionally with @honch/react-native-relay.',
    contextLines: [
      'Install @honch/react-native-relay and create the relay with createMobileRelay({ durableStore, uploaderConfig, schedulerNative }) — exactly those three keys. durableStore = createMmkvRelayStore(createMMKV({ id })); schedulerNative = createRelayNativeBindings(NativeModules.HonchReactNativeRelay).schedulerNative. Verify the option shape against the installed package types.',
      'uploaderConfig (RelayUploaderConfig) needs ALL of: endpointUrl, projectKey, relayId, relaySdkPlatform, relaySdkVersion, streamId(message), messageId(message) — not just endpointUrl/projectKey.',
      'This package RELAYS events from a paired BLE device — it is not a general app-analytics SDK. Feed each device frame your BLE stack receives into the relay via relay.receiveFrame(deviceId, frameBytes, { acknowledge }), and write the returned ackBytes back to the device over your ACK characteristic. There is no bleNative/frameEvents option and no subscribeNativeFrames(); the host app owns BLE.',
      'Add BLE permissions: iOS NSBluetoothAlwaysUsageDescription + CoreBluetooth; Android 12+ BLUETOOTH_SCAN/BLUETOOTH_CONNECT + ACCESS_FINE_LOCATION.',
    ],
    successMessage: 'Honch React Native relay integrated.',
    estimatedDurationMinutes: 5,
  }),
];
