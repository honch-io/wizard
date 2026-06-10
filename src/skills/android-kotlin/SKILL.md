---
name: honch-android-kotlin
description: Install the Honch Android (Kotlin) App SDK. Mode A instruments the app's own analytics (track/identify/…); Mode B relays events from a paired BLE-only Honch device via ingestRelayedEvents(data). Same six-function contract.
---

# Honch Android (Kotlin) App SDK Install Skill

The App SDK runs in the customer's companion Android app and operates in **two
modes simultaneously** in the same install:

- **Mode A — the app's own analytics.** Instrument taps, screens, exports.
  Events upload directly to the cloud. Stamps `$sdk_platform = "android"`.
- **Mode B — relay for a paired BLE device.** Forward events produced by a
  BLE-only Honch Device SDK. Stamps `$relayed = true` and **preserves** the
  device's original `device_id` and `timestamp`. Triggered by
  `Analytics.shared.ingestRelayedEvents(data)`.

## When this target applies

- A native **Android** app (a Gradle project with `build.gradle(.kts)`, an
  `AndroidManifest.xml`, Kotlin sources). For React Native apps that only relay
  device events, use `react-native-relay` instead.

## Ground-truth rule (read this first)

After adding the dependency, **read the installed library's public API** (the
`Analytics` type / its KDoc / decompiled signatures) and consult
https://docs.honch.io. Treat the installed library as the only source of truth
for names and signatures. Do **not** invent APIs.

> The Analytics entry point and the relay-ingest method name shown in this skill
> (e.g. `Analytics`, `ingestRelayedEvents`) are **illustrative and not verified
> against a shipped Android SDK** — confirm the real type and method names
> against the installed library before emitting code. (The only relay ingest
> verified in the Honch SDK is the React Native relay's
> `receiveFrame(deviceId, frameBytes)`.)

## The six-function contract (Mode A)

```kotlin
import io.honch.analytics.Analytics   // confirm package against the installed lib

// Once, at app startup (e.g. Application.onCreate):
Analytics.shared.initialize(
    context = applicationContext,
    projectKey = projectKey,                 // honch_… key, from secret config
    host = "https://capture.honch.io"         // capture host
)

Analytics.shared.track("video_exported", mapOf("duration" to 30))
Analytics.shared.identify("user_98234")
Analytics.shared.setProperty("plan", "pro")
Analytics.shared.flush()
Analytics.shared.reset()                      // on sign-out
```

`init` / `track` / `identify` / `set_property` / `flush` / `reset` is the same
contract on every Honch SDK. The exact Kotlin spelling (`initialize` vs
`init`/`configure`), whether a `Context` is required, and argument names must be
confirmed against the installed library.

For app events tied to a specific paired device, also stamp that device's id
(`$device_id` in the event properties) so cross-device funnels join; omit it for
app-only events.

## Relay (Mode B)

In the customer's **existing** BLE callback, hand each complete Honch envelope
to the SDK. It decodes, stamps `$relayed = true`, preserves the original
`device_id`/`timestamp`, and queues the events for the app's own upload. **Do
not parse the envelope yourself; do not hand-encode anything.**

```kotlin
// Inside your BluetoothGattCallback.onCharacteristicChanged(...) etc.
fun handleDeviceData(data: ByteArray) {
    if (isHonchEnvelope(data)) {              // your packet router
        Analytics.shared.ingestRelayedEvents(data)
    }
}
```

Honch owns the payload, not the protocol — BLE transport, pairing, and GATT
services stay the customer's. The device-side envelope is
`[magic | sdk_version | event_count | events (CBOR) | crc32]`; the magic bytes
let your router distinguish it from your own packets.

## Add the SDK dependency (Gradle)

In the module `build.gradle.kts` (verify the coordinate/version against the
published artifact; pin a real release):

```kotlin
dependencies {
    implementation("io.honch:analytics-android:0.2.0")
}
```

(Groovy DSL: `implementation 'io.honch:analytics-android:0.2.0'`.) Ensure the
repository that hosts it (e.g. `mavenCentral()`) is in the project's
`repositories`/`dependencyResolutionManagement`. Do not guess a version that may
not exist — ask or use the version the wizard provides.

## Native permissions (only if you implement Mode B BLE)

Mode A needs no special permission. For Mode B you use the Android BLE APIs, so
`AndroidManifest.xml` must declare, and you must request the runtime ones on
**Android 12+ (API 31+)**:
- `android.permission.BLUETOOTH_SCAN`
- `android.permission.BLUETOOTH_CONNECT`
- `android.permission.ACCESS_FINE_LOCATION` (where your scan requires it)

The customer's app already owns pairing/bonding and GATT — do not replace it.

## Configure safely

- **Never** hardcode the raw project key in Kotlin source. Read it from a secret
  store / build config (`gradle.properties` → `BuildConfig.HONCH_PROJECT_KEY`,
  or a generated resource), wired through the wizard's secret-ref env tool — not
  committed source. Do not check the key into VCS.
- `host` must be the HTTPS capture base (`https://capture.honch.io`). Do not
  relax `network_security_config` / cleartext settings for it.

## Where to initialize

Call the init exactly once, early — typically in your `Application.onCreate()`
with the application `Context` — before emitting events. Wire
`ingestRelayedEvents` into the existing BLE receive path. Call `reset()` on user
sign-out.

## Verify

- If the Android toolchain is available: assemble the app
  (`./gradlew :app:assembleDebug`) and resolve every error against the installed
  library's API.
- If the toolchain/SDK is unavailable, do not install it; print the exact
  `./gradlew` build command for the user.

## Hard rules

- Do not weaken TLS / network security config, auth, queue durability, or retry.
- Do not change the wire format; do not hand-decode the device envelope or
  hand-encode the capture body. In Mode B, preserve `device_id`/`timestamp` and
  let the SDK set `$relayed`.
- Do not touch the customer's BLE pairing/bonding or GATT services.
- Read the installed library API and https://docs.honch.io as the only sources
  of truth.
