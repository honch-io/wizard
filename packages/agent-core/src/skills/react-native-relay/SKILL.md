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
screens/taps — there is no separate Honch app-analytics SDK to pair it with. Its
only job is to forward the paired device's events to the capture cloud.

## When this target applies

- A **React Native** app (has `package.json` with a `react-native` dependency,
  plus `ios/` and/or `android/` native projects).
- The app talks to a paired hardware device over BLE and needs to forward that
  device's analytics events to the cloud.

## Relay topology (do not re-encode)

```
Device (BLE-only)              RN app (this package)            Cloud
  SDK-produced frame bytes ──▶ receiveFrame(deviceId, bytes) ──▶ POST /capture
   (obtain via your own BLE     relay decodes & queues,           (the relay owns
    stack — the host app        stamping $relayed=true,            the wire encoding)
    owns the BLE transport)     preserving device_id + timestamp
```

The device emits **Honch relay frames** over BLE — a published, fixed binary
format (`spec/relay-chunks.md` / `spec/wire-format-v2.md`: a 20-byte header —
version, source_type, flags, sequence, offset, payload_length, CRC-16 — then the
payload). The relay implements it via `decodeRelayFrame`; **you never decode or
build frames yourself.** The relay also defines fixed GATT UUIDs:

```text
Service:              484f4e43-482d-5245-4c41-592d53445631
Frame Notify (notify) 484f4e43-482d-5245-4c41-592d4652414d
ACK Write   (write)   484f4e43-482d-5245-4c41-592d41434b31
```

Subscribe to the **Frame Notify** characteristic, hand each raw notification
buffer to `relay.receiveFrame(deviceId, frameBytes)` **unchanged**, and write the
`ackBytes` the relay returns back to the device's **ACK Write** characteristic.
Do **not** assume a device-side `honch_drain_to_buffer()` symbol — the device
produces frames through the SDK's own queue/chunker; your job is only to carry
the bytes.

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
- `endpointUrl` must be the HTTPS capture base (`https://i.honch.io`). Do
  not disable TLS.

## Initialize and feed device frames

Create the relay once at app startup with `createMobileRelay({ durableStore,
uploaderConfig, schedulerNative })`. `durableStore` and `uploaderConfig` are
required; **`schedulerNative` is optional** — it exists only on Android (there is
**no** iOS native module by design; the relay never owns BLE). Then pass each
frame your own BLE stack receives to `relay.receiveFrame(...)`. Verify every name
against the installed types.

```ts
import { Platform, NativeModules, AppRegistry } from "react-native";
import { createMMKV } from "react-native-mmkv";
import {
  createMobileRelay,
  createRelayNativeBindings,
  createMmkvRelayStore,
  type StoredRelayMessage,
} from "@honch/react-native-relay";

// uploaderConfig is RelayUploaderConfig — ALL of these fields are required.
// endpointUrl is the capture BASE; the relay appends `/capture` itself.
const uploaderConfig = {
  endpointUrl: "https://i.honch.io",        // capture base (secret/native config)
  projectKey: PROJECT_KEY,                  // honch_… key, from secret ref
  relayId: "my-app-relay",                  // stable id for this relay app
  relaySdkPlatform: "react-native",
  relaySdkVersion: "0.1.0",                 // your relay package version
  streamId: (m: StoredRelayMessage) => `relay-${m.deviceId}`,
  messageId: (m: StoredRelayMessage) => Number(m.sequence),
};

// Native upload scheduling is ANDROID-ONLY. createRelayNativeBindings THROWS if
// the native module is missing, so guard by platform — on iOS leave it undefined
// (foreground-only drains; see below). Do not call it unconditionally.
const schedulerNative =
  Platform.OS === "android" && NativeModules.HonchReactNativeRelay
    ? createRelayNativeBindings(NativeModules.HonchReactNativeRelay).schedulerNative
    : undefined;

const relay = createMobileRelay({
  // createMMKV is the react-native-mmkv v4 API (the package supports >=2 <5);
  // on mmkv v2/v3 construct the instance with `new MMKV({ id: "honch-relay" })`
  // instead. createMmkvRelayStore only needs an MMKV-like { getString, set, remove }.
  durableStore: createMmkvRelayStore(createMMKV({ id: "honch-relay" })), // survives restarts
  uploaderConfig,
  schedulerNative,
});

// Android: register the headless task WorkManager invokes for background drains.
// Required for scheduled uploads to run when the app is backgrounded/cold.
if (Platform.OS === "android") {
  AppRegistry.registerHeadlessTask("HonchRelayUpload", () => async () => {
    await relay.drainUploads();
  });
}

await relay.startUploadScheduler();
```

**iOS upload scheduling is foreground-only.** With no `schedulerNative`,
`startUploadScheduler()` drains once immediately; drive subsequent uploads by
calling `relay.drainUploads()` from the host app's foreground lifecycle (e.g. an
`AppState` `active` listener). On **Android**, keep `androidx.work:work-runtime`
available so WorkManager can launch the `HonchRelayUpload` task.

Feed frames from **your** BLE stack (the relay never scans/connects). The relay
decodes each frame, stamps `$relayed=true`, preserves the device's original
`device_id`/`timestamp`, durably queues it, and returns `ackBytes` you must write
back over the ACK characteristic so the device can release the message:

```ts
hostBle.onRelayFrame(async ({ deviceId, frameBytes }) => {
  await relay.receiveFrame(deviceId, frameBytes, {
    acknowledge: async ({ ackBytes }) => {
      await hostBle.writeRelayAck(deviceId, ackBytes); // -> ACK Write characteristic
    },
  });
});
```

Do not parse the frame yourself. There is **no** `bleNative`/`frameEvents`
option and **no** `subscribeNativeFrames()` — the returned relay exposes
`receiveFrame`, `pending`, `startUploadScheduler`, `stopUploadScheduler`, and
`drainUploads`. Confirm these against the installed package's types before
emitting code.

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
