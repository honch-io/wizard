---
name: honch-arduino
description: Install the Honch Arduino ESP32 (preview) Device SDK into a sketch or PlatformIO project without weakening TLS, the RAM queue, flush/retry, or the application's ownership of Wi-Fi and task scheduling.
---

# Honch Arduino ESP32 Install Skill

Preview Device SDK: a thin C++ wrapper (`HonchClass`) around the canonical Honch
C core for the **ESP32 Arduino** core. The firmware queues events in a
caller-owned RAM buffer and uploads compact chunks directly to Honch over the
device's own Wi-Fi/TLS stack (`POST /capture`).

> **Preview `0.1.0`.** The Arduino *wrapper* is `0.1.0`; events still report the
> shared C-core runtime `0.2.0` in `$sdk_version`. Use for evaluation / controlled
> pilots until the product has passed TLS, offline-queue, flush, retry, and
> power-cycle validation on the target board.

## When this target applies

- An **ESP32 Arduino** project: a `.ino` sketch, a `sketch.yaml` (arduino-cli),
  or a PlatformIO project with `framework = arduino`. **ESP32 only.**
- Not for bare ESP-IDF (use the `esp-idf` skill), non-ESP32 Arduino boards, BLE
  relay, or OTA — none are supported by this port.

## Ground-truth rule (read this first)

After the library is added, **read the installed `Honch.h`** and treat it as the
only source of truth for symbols and signatures. Also consult
https://docs.honch.io/sdks/arduino. Do **not** invent APIs. If the installed
header and the docs disagree, the **installed header wins**.

Known hallucinations to never emit:

- This is a **C++ wrapper singleton**, not the C global-singleton or the
  client-handle form. Call through `honch::defaultClient()` —
  `honch::defaultClient().begin(config)`, `honch::defaultClient().track(...)`.
  There is no `honch_init()` / `honch_track()` free function here.
- Wrapper methods return **`bool`** (true on success), **not** `honch_err_t` /
  `HONCH_OK` / `esp_err_t`. On `false`, read `honch::defaultClient().lastError()`
  for the reason (e.g. `"busy"`, `"offline"`).
- `honch_capture(...)` — does not exist. The call is `.track(...)`.
- Build properties with `honch_prop()` / `honch_i64()` / `honch_str()` /
  `honch_bool()` / `honch_f64()` from `honch/core` (pulled in via `Honch.h`);
  never hand-initialize a `honch_property_t` / `honch_value_t`.
- The config is a `HonchConfig` **struct**, not positional arguments. The queue
  is a caller-owned `uint8_t[]` passed as `eventBuffer` / `eventBufferSize` —
  there is no `honch_event_t` / `.events` / `.event_count`.

## Verified public API (`Honch.h`)

```cpp
struct HonchConfig {
  const char *apiKey;            // required (project key, honch_…)
  const char *host;              // required, e.g. "https://i.honch.io"
  const char *rootCaPem;         // TLS root CA for the capture endpoint (production)
  const char *deviceId;          // optional, NULL to derive
  const char *deviceModel;       // required
  const char *firmwareVersion;   // required, from the project's version source
  const char *environment;       // optional, defaults to "production"
  uint8_t    *eventBuffer;       // required, caller-owned RAM for the queue
  size_t      eventBufferSize;   // required, recommend >= 8192
  uint32_t    flushIntervalSeconds;  // optional, default 60
  uint32_t    flushMinIntervalMs;    // optional, default 10000
  uint32_t    flushEventThreshold;   // optional, default 30
  bool      (*connectivityCallback)();   // optional, false while offline/radio off
  bool        insecureSkipTlsVerify;     // keep false in production
  const honch_state_storage_ops_t *stateStorageOps; // optional, durable state
  const honch_event_queue_ops_t   *eventQueueOps;   // optional, durable queue
  uint32_t    transportTimeoutMs;        // optional, default 3000 (clamped to 10000)
};

// All through the wrapper singleton honch::defaultClient():
bool  begin(const HonchConfig &config);
bool  track(const char *eventName, const honch_property_t *properties = nullptr, size_t propertyCount = 0);
bool  identify(const char *distinctId, const honch_property_t *traits = nullptr, size_t traitCount = 0);
bool  setProperty(const char *key, honch_value_t value);
bool  sessionStart(const char *sessionName);
bool  sessionEnd();
bool  flush();
bool  tick();            // .loop() is an alias
bool  shutdown();
bool  reset();
const char *deviceId();  // borrowed; valid until the next reset()/shutdown()
const char *lastError(); // reason string after a false return
```

For a property-less event call `honch::defaultClient().track("app_started", nullptr, 0)`.

## Add the SDK dependency

The library is **`Honch`** (`architectures=esp32`, header `Honch.h`). Get it from
a source identical on every machine — never a local checkout path.

- **PlatformIO**: add to `platformio.ini` `lib_deps` (pin a real published
  version/tag; verify it exists), e.g.
  ```ini
  [env:esp32dev]
  platform = espressif32
  board = esp32dev
  framework = arduino
  lib_deps = https://github.com/honch-io/SDK.git
  ```
- **arduino-cli**: `arduino-cli lib install Honch` (once published) or vendor the
  `ports/arduino` library into the sketchbook `libraries/` directory.

If the canonical repo URL/tag is unknown or private, ask with `wizard_ask` — do
not hardcode a local path or guess a tag that may not exist.

## Configure safely (secrets are compile-time on Arduino)

Arduino has no runtime env; the key must be baked in at build time. **Never
commit the raw key.**

- **PlatformIO** (preferred): write the key with the wizard's `set_env_values`
  tool, then inject it via a build flag that reads the environment at build time:
  ```ini
  build_flags =
    -DHONCH_API_KEY="\"${sysenv.HONCH_API_KEY}\""
    -DHONCH_HOST="\"${sysenv.HONCH_HOST}\""
  ```
  and in the sketch use `HONCH_API_KEY` / `HONCH_HOST`. The env var must be
  present in the shell that runs `pio run`.
- **Plain `.ino` / arduino-cli**: keep the key in a **gitignored** secrets header
  (e.g. `arduino_secrets.h` with `#define HONCH_API_KEY "honch_…"`), add it to
  `.gitignore`, and `#include` it. Do not check the real value into VCS.
- `host` must be the HTTPS capture base (`https://i.honch.io`); set `rootCaPem`
  to that endpoint's root CA and keep `insecureSkipTlsVerify = false` in
  production. `insecureSkipTlsVerify` is for intentional local testing only.

## Where to initialize and how to pump

Bring up Wi-Fi **before** `begin()` — `begin()` does synchronous work and the
first flush needs the network. Then drive delivery from a **dedicated
low-priority FreeRTOS pump task with a `>= 8192`-byte stack**: `tick()` runs a
**synchronous** HTTPS POST and can block up to `transportTimeoutMs`, so it must
never run on an ISR, a control loop, a sensor/UI deadline, a watchdog path, or a
latency-sensitive `loop()`. The SDK starts no hidden background task.

```cpp
#include <WiFi.h>
#include <Honch.h>

static uint8_t s_eventBuffer[8192];   // caller-owned, >= 8192
extern const char HONCH_ROOT_CA_PEM[]; // root CA for the capture endpoint

static void honchPumpTask(void *arg) {
  (void)arg;
  for (;;) {
    honch::defaultClient().tick();    // synchronous HTTPS POST; own task only
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

void setup() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(250);

  HonchConfig config = {
    .apiKey          = HONCH_API_KEY,          // from build flag / gitignored header
    .host            = HONCH_HOST,             // "https://i.honch.io"
    .rootCaPem       = HONCH_ROOT_CA_PEM,
    .deviceModel     = "esp32-devkit",
    .firmwareVersion = FIRMWARE_VERSION,
    .eventBuffer     = s_eventBuffer,
    .eventBufferSize = sizeof(s_eventBuffer),
  };

  if (honch::defaultClient().begin(config)) {
    honch::defaultClient().track("app_started", nullptr, 0);
    xTaskCreatePinnedToCore(honchPumpTask, "honch-pump", 8192, nullptr, 1, nullptr, 1);
  }
}

void loop() { /* application work; pump runs on its own task */ }
```

Then instrument real interactions (boot, button presses, sensor readings, state
changes, error paths, low-rate heartbeats) with meaningful event names and
low-cardinality properties — not just the example event. Build properties with
the `honch_prop()` helpers:

```cpp
const honch_property_t props[] = {
  honch_prop("rssi", honch_i64(WiFi.RSSI())),
  honch_prop("mode", honch_str("hdr")),
};
honch::defaultClient().track("recording_started", props, 2);
```

The default RAM queue is lost across reset/power loss; provide `eventQueueOps` /
`stateStorageOps` backed by durable storage if events must survive reboots.

## Verify

- If a toolchain is present: `pio run` (PlatformIO) or
  `arduino-cli compile --fqbn esp32:esp32:esp32 <sketch-dir>`. Resolve every
  error against `Honch.h` before reporting success.
- If no toolchain/board is available, do not install one; report the exact
  compile command for the user.
- Before reporting success, inspect the diff/status — if no sketch/build file
  changed, the install is incomplete.

## Hard rules

- Do not weaken TLS (`rootCaPem` set, `insecureSkipTlsVerify` false), auth, queue
  durability, or retry. The SDK owns all event encoding — never hand-build chunk
  bytes.
- Keep delivery cooperative and application-owned: pump `tick()` from your own
  low-priority task, never from an ISR or latency-sensitive path.
- Do not commit the raw key; use a build flag from the environment or a
  gitignored secrets header.
- Read `Honch.h` and https://docs.honch.io as the only sources of truth.
