---
name: honch-ios-swift
description: Install the Honch iOS (Swift) App SDK. Mode A instruments the app's own analytics (track/identify/…); Mode B relays events from a paired BLE-only Honch device via ingestRelayedEvents(data). Same six-function contract.
---

# Honch iOS (Swift) App SDK Install Skill

The App SDK runs in the customer's companion iOS app and operates in **two modes
simultaneously** in the same install:

- **Mode A — the app's own analytics.** Instrument taps, screens, exports.
  Events upload directly to the cloud. Stamps `$sdk_platform = "ios"`.
- **Mode B — relay for a paired BLE device.** Forward events produced by a
  BLE-only Honch Device SDK. Stamps `$relayed = true` and **preserves** the
  device's original `device_id` and `timestamp`. Triggered by
  `Analytics.shared.ingestRelayedEvents(data)`.

## When this target applies

- A native **iOS** app (an Xcode project/workspace, a `Package.swift`, or a
  `Podfile`; Swift sources). For React Native apps that only relay device
  events, use `react-native-relay` instead.

## Ground-truth rule (read this first)

After adding the package, **read the installed module's public interface**
(jump-to-definition on `Analytics`, or the framework headers) and consult
https://docs.honch.io. Treat the installed module as the only source of truth
for names and signatures. Do **not** invent APIs.

> The Analytics entry point and the relay-ingest method name shown in this skill
> (e.g. `Analytics.shared`, `ingestRelayedEvents`) are **illustrative and not
> verified against a shipped Swift SDK** — confirm the real type and method
> names against the installed package before emitting code. (The only relay
> ingest verified in the Honch SDK is the React Native relay's
> `receiveFrame(deviceId, frameBytes)`.)

## The six-function contract (Mode A)

```swift
import HonchAnalytics   // confirm the module name against the installed package

// Once, at app launch:
Analytics.shared.initialize(
    projectKey: projectKey,                 // honch_… key, from secret config
    host: "https://i.honch.io"        // capture host
)

Analytics.shared.track("video_exported", properties: ["duration": 30])
Analytics.shared.identify("user_98234")
Analytics.shared.setProperty("plan", value: "pro")
Analytics.shared.flush()
Analytics.shared.reset()                    // on sign-out
```

`init` / `track` / `identify` / `set_property` / `flush` / `reset` is the same
contract on every Honch SDK. The exact Swift spelling of the init call
(`initialize(...)` vs `init(...)`/`configure(...)`) and argument labels must be
confirmed against the installed module.

For app events tied to a specific paired device, also stamp that device's id so
cross-device funnels join — e.g. include `$device_id` in the event properties;
omit it for app-only events.

## Relay (Mode B)

In the customer's **existing** BLE handler, hand each complete Honch envelope to
the SDK. The SDK decodes it, stamps `$relayed = true`, preserves the original
`device_id`/`timestamp`, and adds the events to the app's own upload queue. **Do
not parse the envelope yourself; do not hand-encode anything.**

```swift
// Inside your CoreBluetooth peripheral:didUpdateValueForCharacteristic etc.
func handleDeviceData(_ data: Data) {
    if isHonchEnvelope(data) {                 // your packet router
        Analytics.shared.ingestRelayedEvents(data)
    }
}
```

Honch owns the payload, not the protocol — the BLE transport, pairing, and GATT
services stay the customer's. The device-side envelope is
`[magic | sdk_version | event_count | events (CBOR) | crc32]`; the magic bytes
let your router distinguish it from your own packets.

## Add the SDK dependency

Use the project's dependency manager:

- **Swift Package Manager** (preferred): in Xcode, File ▸ Add Packages, point at
  the Honch iOS SDK repo URL and pin a real released version; or in
  `Package.swift`:
  ```swift
  dependencies: [
    .package(url: "https://github.com/honch-io/honch-swift.git", from: "0.2.0"),
  ],
  // target deps: .product(name: "HonchAnalytics", package: "honch-swift")
  ```
  Confirm the repo URL, product, and module names against the published package;
  do not guess a tag that may not exist.
- **CocoaPods**: add `pod 'HonchAnalytics'` to the `Podfile`, then
  `pod install` (or `bundle exec pod install`), and open the `.xcworkspace`.

## Native permissions (only if you implement Mode B BLE)

Mode A needs no special permission. For Mode B you use CoreBluetooth in the
customer's app, so `Info.plist` must include:
- `NSBluetoothAlwaysUsageDescription` — user-facing reason string.
- Optionally the `bluetooth-central` background mode if you scan/connect in the
  background.

## Configure safely

- **Never** hardcode the raw project key in Swift source. Read it from a secret
  store / build config (xcconfig `HONCH_PROJECT_KEY`, then surfaced via
  `Info.plist` or a generated config), wired through the wizard's secret-ref env
  tool — not committed source.
- `host` must be the HTTPS capture base (`https://i.honch.io`). Do not
  disable App Transport Security or TLS validation for it.

## Where to initialize

Call the init exactly once, early in app launch (e.g.
`application(_:didFinishLaunchingWithOptions:)` or the SwiftUI `App` init),
before emitting events. Wire `ingestRelayedEvents` into the existing BLE receive
path. Call `reset()` on user sign-out.

## Verify

- If Xcode/`xcodebuild` is available: build the app (or
  `xcodebuild -scheme <Scheme> build`) and resolve every error against the
  installed module's interface.
- If the toolchain/simulator is unavailable, do not install it; print the exact
  `pod install` + build commands for the user.

## Hard rules

- Do not weaken TLS/ATS, auth, queue durability, or retry.
- Do not change the wire format; do not hand-decode the device envelope or
  hand-encode the capture body. In Mode B, preserve `device_id`/`timestamp` and
  let the SDK set `$relayed`.
- Do not touch the customer's BLE pairing/bonding or GATT services.
- Read the installed module interface and https://docs.honch.io as the only
  sources of truth.
