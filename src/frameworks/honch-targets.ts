/**
 * Honch SDK targets.
 *
 * Replaces PostHog's per-web-framework modules. Each target is a
 * FrameworkConfig the universal runner consumes: detection (which build files
 * mark this target), the env vars the installed SDK reads, and the
 * agent-prompt hints. The deep install knowledge lives in the bundled
 * per-target skill (src/skills/<id>/SKILL.md), which the agent reads.
 *
 * Firmware targets (esp-idf, c-posix, micropython) run the Device SDK on
 * hardware; mobile targets (react-native-relay, ios-swift, android-kotlin)
 * run the App SDK / relay in a companion app.
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

function detectIosSwift(installDir: string): boolean {
  if (anyExists(installDir, ['Package.swift', 'Podfile'])) return true;
  try {
    return fs
      .readdirSync(installDir)
      .some((f) => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'));
  } catch {
    return false;
  }
}

function detectAndroidKotlin(installDir: string): boolean {
  return anyExists(installDir, [
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'app/build.gradle',
    'app/build.gradle.kts',
    'app/src/main/AndroidManifest.xml',
  ]);
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
}): FrameworkConfig {
  const firmware = opts.kind === 'firmware';
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
      getEnvVars: (apiKey, host): Record<string, string> =>
        firmware
          ? { HONCH_API_KEY: apiKey, HONCH_HOST: host }
          : { HONCH_PROJECT_KEY: apiKey, HONCH_CAPTURE_HOST: host },
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

// ── the six targets (detection order: most specific first) ──

export const HONCH_TARGETS: readonly FrameworkConfig[] = [
  honchTarget({
    id: Integration.espIdf,
    name: 'ESP-IDF',
    kind: 'firmware',
    packageName: 'honch',
    detect: detectEspIdf,
    projectTypeDetection:
      'ESP-IDF firmware: a top-level and main/ CMakeLists.txt using idf_component_register, plus idf_component.yml / sdkconfig.',
    contextLines: [
      'The wizard has ALREADY registered the Honch SDK as a git submodule at components/honch — do NOT re-add it, replace it with the ESP component manager, vendor a copy, or point at a local path. Just add `REQUIRES honch` to the relevant idf_component_register(...) so the build links it (the SDK repo root is itself the component, so no EXTRA_COMPONENT_DIRS).',
      'honch_init() needs an active IP — call it after Wi-Fi/IP is up, never directly from app_main(); drive honch_tick() from a low-priority task, never an ISR.',
      'Honch calls return honch_err_t (success HONCH_OK), not esp_err_t. Record events with honch_track(event, props, count); honch_capture() does not exist. Read the installed honch.h as the only source of truth.',
    ],
    successMessage: 'Honch ESP-IDF SDK integrated.',
    estimatedDurationMinutes: 4,
    packageInstallation:
      'Use idf.py / the ESP-IDF component manager, not a Node package manager.',
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
      'Install @honch/react-native-relay and create the relay with createMobileRelay({ uploaderConfig: { endpointUrl, projectKey }, durableStore, bleNative, schedulerNative, frameEvents }). Verify the option shape against the installed package types.',
      'This package RELAYS events from a paired BLE device — it is not a general app-analytics SDK. Feed each received device frame into the relay via receiveFrame(deviceId, frameBytes) (or subscribeNativeFrames()); it forwards them, preserving device_id/timestamp.',
      'Add BLE permissions: iOS NSBluetoothAlwaysUsageDescription + CoreBluetooth; Android 12+ BLUETOOTH_SCAN/BLUETOOTH_CONNECT + ACCESS_FINE_LOCATION.',
    ],
    successMessage: 'Honch React Native relay integrated.',
    estimatedDurationMinutes: 5,
  }),
  honchTarget({
    id: Integration.iosSwift,
    name: 'iOS (Swift)',
    kind: 'mobile',
    packageName: 'Honch',
    detect: detectIosSwift,
    projectTypeDetection:
      'An iOS project: Package.swift, a .xcodeproj/.xcworkspace, or a Podfile.',
    contextLines: [
      'Configure the App SDK with the project capture key + capture host. Mode A: instrument the app with the SDK track/identify calls. Mode B: forward paired-device events with the App SDK relay-ingest method, preserving device_id/timestamp and stamping $relayed. Confirm every symbol (the Analytics entry point and the relay-ingest method name) against the installed SDK header — do not assume names.',
      'Add it via Swift Package Manager or CocoaPods; do not hardcode the key — use an xcconfig/Info.plist value.',
    ],
    successMessage: 'Honch iOS SDK integrated.',
    estimatedDurationMinutes: 5,
    packageInstallation:
      'Use Swift Package Manager or CocoaPods, not a Node package manager.',
  }),
  honchTarget({
    id: Integration.androidKotlin,
    name: 'Android (Kotlin)',
    kind: 'mobile',
    packageName: 'io.honch:honch-android',
    detect: detectAndroidKotlin,
    projectTypeDetection:
      'An Android project: build.gradle(.kts) / settings.gradle and an AndroidManifest.xml.',
    contextLines: [
      'Configure the App SDK with the project capture key + capture host. Mode A: instrument the app with the SDK track/identify calls. Mode B: forward paired-device events with the App SDK relay-ingest method, preserving device_id/timestamp and stamping $relayed. Confirm every symbol (the Analytics entry point and the relay-ingest method name) against the installed SDK — do not assume names.',
      'Add the Gradle implementation dependency; do not hardcode the key — use a gradle property / BuildConfig. Mode B needs Android 12+ BLUETOOTH_SCAN/BLUETOOTH_CONNECT + ACCESS_FINE_LOCATION.',
    ],
    successMessage: 'Honch Android SDK integrated.',
    estimatedDurationMinutes: 5,
    packageInstallation: 'Use Gradle, not a Node package manager.',
  }),
];
