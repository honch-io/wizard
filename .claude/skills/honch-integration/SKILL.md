---
name: honch-integration
description: Integrate the Honch analytics SDK into this codebase. Use when asked to add Honch, wire up Honch analytics/telemetry, relay device events to Honch, or send events to capture.honch.io. Auto-detects the right target (firmware vs mobile vs relay) from the project's build files and installs the matching SDK against its real contract.
---

# Honch Integration (portable)

Standalone guide for integrating Honch into any repo. It is self-contained: it
does not need the Honch setup wizard. Pick the target from the project's build
files, install the matching SDK with that project's own build system, wire it
into the lifecycle, and verify.

> **The one hard rule:** the installed SDK headers (`honch.h`) / module
> interface and https://docs.honch.io are the **only** source of truth. Never
> invent APIs. Never hand-encode the wire format. Never weaken TLS, auth, queue
> durability, or retry. If an installed header and the docs disagree, the
> **installed header wins**.

## The six-function contract (every Honch SDK)

```
init(config)            # api/project key + capture host
track(event, properties)
identify(distinct_id, properties)
set_property(key, value)
flush()
reset()
```

Same contract, same wire format, same dashboard semantics on every platform —
only the language idiom changes. Device SDKs add `session_start` /
`session_end` and a `tick()`/drain pump; App SDKs add relay ingest.

## Auto-pick the target

Detect from build files (in priority order):

| Signal in the repo | Target | SDK surface |
|---|---|---|
| ESP-IDF tree: top `CMakeLists.txt` with `project.cmake`, `main/`, `idf_component.yml` | **esp-idf** (Device) | C `honch_*`, `honch.h` |
| MicroPython build: `manifest.py`, `USER_C_MODULES`, a `ports/<port>` tree | **micropython** (Device) | `import honch` + native `_honch_core` |
| Other C/C++ CMake on a POSIX host (no ESP-IDF) | **c-posix** (Device) | C `honch_*`, `honch.h` |
| `package.json` with `react-native` (+ `ios/`/`android/`) | **react-native-relay** | `@honch/react-native-relay`, `createMobileRelay()` |
| Native iOS: `Package.swift` / `Podfile` / `.xcodeproj`, Swift | **ios-swift** (App) | `Analytics.shared.*` |
| Native Android: `build.gradle(.kts)`, `AndroidManifest.xml`, Kotlin | **android-kotlin** (App) | `Analytics.shared.*` |

Device vs App vs Relay:
- **Device SDK** — runs on hardware with its own network; queues locally and
  uploads directly (esp-idf, c-posix, micropython).
- **App SDK** — runs in a companion iOS/Android app; does **Mode A** (the app's
  own analytics) **and Mode B** (relay a paired device's events).
- **Mobile relay** (`@honch/react-native-relay`) — RN uploader for a paired
  BLE-only device; relay only, not app analytics.

A BLE-only device uses a Device SDK that **drains to a buffer** instead of
uploading; the paired app (App SDK or RN relay) uploads those bytes.

## Capture endpoint / header / content-type (verified)

All SDKs send here; integrations never call it by hand, but configure it
correctly:

- **Endpoint:** `POST https://capture.honch.io/capture` (aliases `/e`,
  `/chunks`).
- **Auth header:** `X-Honch-Project-Key: <honch_… project key>`.
- **Content-Type:** `application/vnd.honch.chunk` (compact binary chunk wire).
- The capture base host to configure in `init` is `https://capture.honch.io`.

The SDK owns all encoding. **Never hand-build the request body** and never
emulate the chunk wire.

## Relay topology (drain_to_buffer ↔ ingestRelayedEvents)

For BLE-only devices with no internet of their own:

```
Device SDK                         App SDK / RN relay              Cloud
honch_drain_to_buffer(buf,     ──▶ ingestRelayedEvents(data)  ──▶  /capture
  cap, &written) produces a       (RN: subscribeNativeFrames /
  sealed envelope of bytes:        the relay's ingest entry)
[magic | sdk_version |            decodes, stamps $relayed=true,
 event_count | events(CBOR) |     preserves device_id + timestamp,
 crc32]                           re-queues for the app's upload
```

- The customer owns the BLE/GATT transport; Honch is **a payload, not a
  protocol**. Move the bytes however the app already moves device data.
- The magic bytes let the app's packet router recognize a Honch envelope.
- **Never** hand-decode the envelope or re-encode events when relaying — the
  events ride through unchanged.

## Identity & timestamp rules

| ID | Owned by | Notes |
|---|---|---|
| `device_id` | Device SDK | stable for the device's life; resets on factory reset |
| `distinct_id` | SDK | starts as `device_id`, becomes the user id after `identify()` |
| `session_id` | Device SDK | one hardware session; ends on `session_end()` |
| `person_id` | Cloud | unifies identities server-side; never reset client-side |

Timestamps: every event carries `timestamp` (set on-device at creation = when it
happened) and `received_at` (server-stamped at ingest). **`timestamp` is
authoritative and must never be overwritten** on relay/queue/upload hops —
funnels and retention sort by it. Relayed events: the app preserves the device's
original `timestamp` and `device_id`, sets `$relayed = true`, and stamps
`$sdk_platform = "ios"`/`"android"`; it may stamp the paired `$device_id` on its
own events so cross-device funnels join.

## Install, configure, verify (per target)

1. **Add the dependency** with the project's own build system:
   - esp-idf: `idf.py add-dependency "honch-io/honch^0.2.0"`, else wire the
     local component via `EXTRA_COMPONENT_DIRS` + `REQUIRES honch`.
   - c-posix: CMake `find_package(honch_posix REQUIRED)` → link
     `honch::honch_posix`, else `FetchContent` with `SOURCE_SUBDIR ports/posix`.
   - micropython: build with `USER_C_MODULES=.../ports/micropython/usermod/
     honch/micropython.cmake`; freeze the wrapper via `manifest.py`.
   - react-native: add `@honch/react-native-relay` (+ `react-native-mmkv`) with
     the detected package manager; `pod install` on iOS.
   - ios-swift: SwiftPM package or CocoaPods `pod 'HonchAnalytics'`.
   - android-kotlin: Gradle `implementation("io.honch:analytics-android:…")`.
   Pin real published versions; verify against the installed artifact.
2. **Read the installed `honch.h` / module interface** and confirm every symbol
   before writing code.
3. **Configure safely** — never hardcode the raw key. Use env / Kconfig /
   xcconfig / `gradle.properties` / a secret-ref tool. Set the capture host to
   `https://capture.honch.io`. Never disable TLS / ATS / cleartext rules.
4. **Initialize once** in the lifecycle: Device SDK after network/IP is up and
   pump `tick()` from a low-priority task; App SDK in app launch and wire
   `ingestRelayedEvents` into the existing BLE receive path.
5. **Verify**: build only if the toolchain is present and resolve every error
   against the header; otherwise print the exact build command for the user.

## Anti-hallucination (firmware C, verified)

- `honch_capture(...)` does **not** exist — use `honch_track(...)`.
- `honch_event_t`, `.events`, `.event_count` do **not** exist — the queue is a
  caller-owned `uint8_t` buffer (`event_buffer` / `event_buffer_size`, `>= 8192`).
- Honch C calls return `honch_err_t` (success `HONCH_OK`), **not** `esp_err_t`/
  `int`/`errno`.

## Hard rules (all targets)

- Read the installed SDK headers (`honch.h`) and https://docs.honch.io as the
  only source of truth; never invent APIs.
- Never hand-encode the wire format or hand-decode the relay envelope.
- Never weaken TLS, auth, request validation, queue durability, or retry.
- Preserve `timestamp` and `device_id` through every relay/queue hop; let the
  SDK set `$relayed`.
- Never touch the customer's BLE pairing/bonding, GATT services, or network
  stack — Honch produces and consumes bytes only.
