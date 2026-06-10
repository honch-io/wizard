---
name: honch-react-native-relay
description: Install @honch/react-native-relay into a React Native app to forward events from a paired BLE-only Honch device up to the capture cloud. This is a mobile RELAY/uploader, not a general app-analytics SDK.
---

# Honch React Native Relay Install Skill

The mobile relay turns a React Native app into the uploader for a BLE-only
Honch **Device SDK**. The device's events arrive as Honch relay **frame bytes**
over the customer's **existing** BLE stack; the app hands each frame to the
relay, which decodes, queues, and uploads it to Honch.

**This package is a relay, not analytics.** It does not instrument the app's own
screens/taps. If you also need the app's own analytics (Mode A), use the
`ios-swift` / `android-kotlin` App SDK instead/alongside.

## When this target applies

- A **React Native** app (has `package.json` with a `react-native` dependency,
  plus `ios/` and/or `android/` native projects).
- The app talks to a paired hardware device over BLE and needs to forward that
  device's analytics events to the cloud.

## Relay topology (do not re-encode)

```
Device (BLE-only)              RN app (this package)            Cloud
  SDK-produced frame bytes ──▶ receiveFrame(deviceId, bytes) ──▶ POST /capture
   (obtain via the device      / subscribeNativeFrames();        (the relay owns
    SDK's own mechanism)       relay decodes & queues,            the wire encoding)
                               stamping $relayed=true,
                               preserving device_id + timestamp
```

Do **not** assume a device-side `honch_drain_to_buffer()` or a specific envelope
layout (`magic|sdk_version|…|crc32`) — no such symbol or format is published in
the C SDK. Obtain the device's frame bytes through whatever the installed device
SDK actually exposes, and pass them through unchanged.

The customer owns the BLE/GATT transport. The SDK is **a payload, not a
protocol** — you move the bytes; the relay decodes/uploads them. **Never
hand-decode a frame or hand-encode the capture wire.**

## Ground-truth rule (read this first)

Treat the installed package's TypeScript types and https://docs.honch.io/sdks/
react-native-relay as the only source of truth for names and options. Do **not**
invent APIs. Confirm `createMobileRelay`, its config keys, and the frame-ingest
method against the installed package before emitting code.

## Add the dependency

Use the project's detected package manager (check for `bun.lockb`, `pnpm-lock.yaml`,
`yarn.lock`, or `package-lock.json`):

```bash
bun add @honch/react-native-relay react-native-mmkv      # or:
pnpm add @honch/react-native-relay react-native-mmkv
yarn add @honch/react-native-relay react-native-mmkv
npm install @honch/react-native-relay react-native-mmkv
```

Peer deps (let the package's own `peerDependencies` be authoritative):
- `react-native` >= 0.72 (required peer)
- `react-native-mmkv` — recommended durable store for queued frames
- `react-native-nitro-modules` — optional, for the native bindings layer

iOS: `cd ios && pod install` (or `bundle exec pod install`) after adding.

## Native permissions (required for BLE)

**iOS** — in `Info.plist`:
- `NSBluetoothAlwaysUsageDescription` — user-facing reason string (required).
- Use CoreBluetooth for the BLE link. If you scan/connect in the background,
  add the `bluetooth-central` background mode (optional).

**Android** — in `AndroidManifest.xml`, and request the runtime ones on
Android 12+ (API 31+):
- `android.permission.BLUETOOTH_SCAN`
- `android.permission.BLUETOOTH_CONNECT`
- `android.permission.ACCESS_FINE_LOCATION` (where your scan requires it)

The customer's app already owns pairing/bonding and the GATT services — do not
replace them.

## Configure safely

- **Never** hardcode the raw project key. Read it from a secret store / native
  config (`.env` via `react-native-config`, iOS xcconfig, Android
  `gradle.properties` / `BuildConfig`) wired through the wizard's secret-ref env
  tool — not committed JS source.
- `endpointUrl` must be the HTTPS capture base (`https://capture.honch.io`). Do
  not disable TLS.

## Initialize and feed device frames

Create the relay once at app startup, then subscribe to native BLE frames and
pass each Honch envelope to the relay. Names below are from the package docs —
verify against the installed types.

```ts
import { NativeEventEmitter } from "react-native";
import {
  createMobileRelay,
  createRelayNativeBindings,
  createMmkvRelayStore,
} from "@honch/react-native-relay";

const native = createRelayNativeBindings();

const relay = createMobileRelay({
  // Upload config is nested under `uploaderConfig` (RelayUploaderConfig).
  uploaderConfig: {
    endpointUrl: "https://capture.honch.io", // the capture host
    projectKey: PROJECT_KEY,                 // secret ref / native config
  },
  durableStore: createMmkvRelayStore(),      // survives restarts
  bleNative: native.ble,
  schedulerNative: native.scheduler,
  frameEvents: new NativeEventEmitter(native.frameEmitter),
});

// Forward device-produced Honch frames arriving over your BLE stack.
// The relay decodes them, stamps $relayed=true, and preserves the device's
// original device_id and timestamp before uploading.
const subscription = relay.subscribeNativeFrames();

// On teardown:
// subscription.remove();
```

If your BLE bytes arrive through your own JS handler instead of the native frame
emitter, pass each complete frame to `relay.receiveFrame(deviceId, frameBytes)`
— do not parse the frame yourself. (Verify `receiveFrame` and the option shape
above against the installed package's types before emitting code.)

## Verify

- If the RN toolchain is set up: typecheck/build the JS (`tsc --noEmit` or the
  project's build script) and build the native app for at least one platform
  (`npx react-native run-ios` / `run-android`) to confirm the native module
  links and permissions resolve.
- If the native toolchains/simulators are unavailable, do not install them;
  print the exact `pod install` + build/run commands the user must run.

## Hard rules

- This is a relay/uploader, not app analytics — do not present it as `track()`
  for the app's own events.
- Do not weaken TLS, auth, queue durability, or retry. Keep the durable store
  configured so frames survive app restarts.
- Do not change the wire format; do not hand-decode the device envelope or
  hand-encode the capture body. Preserve `device_id` and `timestamp`; let the
  relay set `$relayed`.
- Do not touch the customer's BLE pairing/bonding or GATT services.
- Read the installed package types and https://docs.honch.io as the only sources
  of truth.
