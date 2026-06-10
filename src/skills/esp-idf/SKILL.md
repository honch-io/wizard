---
name: honch-esp-idf
description: Install the Honch ESP-IDF Device SDK into a client ESP32 firmware project without weakening firmware ownership (Wi-Fi, networking, TLS, time sync, task scheduling, queues, shutdown stay application-owned).
---

# Honch ESP-IDF Install Skill

Device SDK for ESP-IDF. The firmware queues events locally and uploads them
directly to Honch over the device's own Wi-Fi/TLS stack.

## When this target applies

- The project is an **ESP-IDF** firmware (has top-level `CMakeLists.txt` with
  `include($ENV{IDF_PATH}/tools/cmake/project.cmake)`, a `main/` component, and
  usually `sdkconfig` / `sdkconfig.defaults`).
- The device has its own network connectivity (Wi-Fi STA or cellular). If it is
  BLE-only and relays through a phone, use the `react-native-relay`,
  `ios-swift`, or `android-kotlin` skill on the app side instead — the firmware
  still uses this SDK but drains to a buffer rather than uploading.

## Ground-truth rule (read this first)

Before writing any code, **read the SDK header `honch.h`** in the project (after
the component is added) and treat it as the only source of truth for symbols and
signatures. Also consult https://docs.honch.io/sdks/esp-idf. Do **not** invent
APIs. If the installed header and the docs disagree, the **installed header
wins**.

Known hallucinations to never emit:

- `honch_capture(...)` — does not exist. The call is `honch_track(...)`.
- `honch_event_t`, `.events`, `.event_count` — do not exist. The queue is a raw
  caller-owned `uint8_t` buffer passed as `.event_buffer` / `.event_buffer_size`.
- `esp_err_t` / `ESP_OK` / `esp_err_to_name()` for Honch calls — Honch functions
  return `honch_err_t`; success is `HONCH_OK`.
- Do not assume `honch_track` takes a JSON string. The verified header passes a
  `honch_property_t` array + count. Confirm against the installed `honch.h`.
- Do **not** hand-initialize a `honch_property_t`/`honch_value_t` by guessing
  field names. Build them with the `honch_prop()` / `honch_i64()` / `honch_str()`
  / `honch_bool()` / `honch_f64()` helpers from `honch/core/wire_v2.h`.
- `honch_set_property(key, value)` **does** exist as a real function — do not
  claim properties can only be set via the per-call array.

## Verified public API (`honch.h`)

```c
typedef enum {
    HONCH_OK = 0, HONCH_ERR_INVALID_ARG, HONCH_ERR_NOT_INITIALIZED,
    HONCH_ERR_ALREADY_INITIALIZED, HONCH_ERR_NO_MEM, HONCH_ERR_QUEUE_FULL,
    HONCH_ERR_IO, HONCH_ERR_TRANSPORT, HONCH_ERR_TIMEOUT, HONCH_ERR_BUSY,
    HONCH_ERR_NOT_SUPPORTED, HONCH_ERR_OFFLINE, HONCH_ERR_INTERNAL,
} honch_err_t;

typedef struct {
    const char *api_key;             // required (project key, honch_…)
    const char *host;                // required, e.g. "https://i.honch.io"
    const char *device_model;        // required
    const char *firmware_version;    // required
    const char *environment;         // optional, defaults to "production"
    uint8_t    *event_buffer;        // required, caller-owned RAM for the queue
    size_t      event_buffer_size;   // required, recommend >= 8192
    uint32_t    flush_interval_seconds;      // optional, default 60
    uint32_t    flush_min_interval_ms;       // optional, default 10000
    uint32_t    flush_event_threshold;       // optional, default 30
    uint32_t    flush_max_batches;           // optional, default 1
    uint32_t    shutdown_flush_max_batches;  // optional, default 1
    uint32_t    transport_timeout_ms;        // optional, default 3000
    int       (*battery_callback)(void);     // optional, returns 0-100 or -1
    int         battery_low_threshold;       // optional, default 15
    bool      (*connectivity_callback)(void);// optional, false while offline
    const honch_state_storage_ops_t *state_storage_ops; // optional, durable identity/version state
    const honch_event_queue_ops_t   *event_queue_ops;   // optional, replaces the default RAM queue
} honch_config_t;

honch_err_t honch_init(const honch_config_t *config);
honch_err_t honch_shutdown(void);
honch_err_t honch_track(const char *event, const honch_property_t *properties, size_t property_count);
honch_err_t honch_identify(const char *distinct_id, const honch_property_t *properties, size_t property_count);
honch_err_t honch_set_property(const char *key, honch_value_t value);
honch_err_t honch_session_start(const char *session_name);
honch_err_t honch_session_end(void);
honch_err_t honch_flush(void);
honch_err_t honch_tick(void);
honch_err_t honch_reset(void);
const char *honch_get_device_id(void);
honch_err_t honch_get_queue_stats(honch_queue_stats_t *stats);
```

**Building properties** (from `honch/core/wire_v2.h`, included via `honch.h`):

```c
honch_property_t props[] = {
    honch_prop("count", honch_i64(1)),
    honch_prop("screen", honch_str("home")),
    honch_prop("ok", honch_bool(true)),
};
honch_track("button_pressed", props, 3u);
```

For a property-less event call `honch_track("firmware.boot", NULL, 0)`.

The six-function contract (`init` / `track` / `identify` / `set_property` /
`flush` / `reset`) maps here as: `honch_init`, `honch_track`, `honch_identify`,
`honch_set_property`, `honch_flush`, `honch_reset`. Sessions add
`honch_session_start` / `honch_session_end`.

## Add the component

The ESP-IDF component is named `honch` (its `REQUIRES` name is `honch`). Always
get it from a source that is identical on every machine — **never** bake a
local filesystem path into committed build files. A path like
`EXTRA_COMPONENT_DIRS "/Users/.../SDK/ports/esp-idf"` only exists on one
developer's laptop; it breaks for everyone else and in CI.

1. **Preferred — ESP Component Registry** (once the SDK is published there):
   ```
   idf.py add-dependency "honch-io/honch^0.2.0"
   ```
   Install the version the project's `idf_component.yml` / registry resolves and
   verify against the installed `honch.h`.
2. **Fallback — git submodule** (use this when the registry entry isn't
   reachable, e.g. it 404s):
   ```bash
   git submodule add https://github.com/honch-io/SDK.git components/honch
   git submodule update --init --recursive
   ```
   The SDK **repository root is itself the ESP-IDF component**: its top-level
   `CMakeLists.txt` registers the component under `ESP_PLATFORM` and pulls in the
   shared `core/` sources via a repo-relative path. So vendoring the whole repo
   as `components/honch` is all that's needed — ESP-IDF auto-discovers anything
   under `components/`, so there is **no `EXTRA_COMPONENT_DIRS` and no absolute
   path**. (If the canonical SDK repo URL is unknown or the repo is private and
   you can't resolve it, ask the user with `wizard_ask` — do not fall back to a
   local checkout path.)

Then add `honch` to your app component's `REQUIRES` (use `honch`, **not**
`honch-io__honch`):
```cmake
idf_component_register(SRCS "app_main.c" INCLUDE_DIRS "." REQUIRES honch)
```

## Configure safely

- **Never** write the raw project API key into source or `sdkconfig`. Use the
  wizard's secret-ref env tool, or a gitignored `sdkconfig.defaults.local` /
  Kconfig value, and read it via `CONFIG_*`.
- Set `host` to the capture base (`https://i.honch.io`), plus
  `device_model`, `firmware_version`, and a caller-owned `uint8_t` event buffer
  (`>= 8192` bytes) with its size.
- Do not point `host` at a non-TLS URL and do not add any
  `insecure_skip_tls_verify` flag in production.

## Completion criteria

This install is not complete if you only add markdown, a report, a skill file,
dependency metadata, or Kconfig defaults. A successful ESP-IDF integration must
modify executable firmware/build files and wire Honch into real behavior:

- add the component dependency and `REQUIRES honch`;
- initialize Honch after the device has network/IP, never before async Wi-Fi is
  ready;
- drive `honch_tick()` from an application-owned low-priority task;
- add `honch_track(...)` calls at real product interaction points, not just a
  throwaway example.

For firmware, good interaction points include boot/reset, button presses,
sensor readings, command handling, connectivity transitions, error paths, state
changes, and low-rate health/heartbeat events. If the repo is only a mock or
empty ESP-IDF skeleton, create or extend the minimal runnable `app_main.c`
needed to demonstrate the product behavior and instrument that behavior.

## Wire into the firmware lifecycle

`honch_init()` requires an active network/IP. On ESP32 (Wi-Fi STA), bring up
Wi-Fi first and call `honch_init()` only **after** `IP_EVENT_STA_GOT_IP` — never
directly from `app_main()` when Wi-Fi is async. Minimal shape:

```c
#include "honch.h"

static uint8_t s_honch_event_buffer[16384]; // caller-owned, >= 8192

static void honch_start(const char *api_key)
{
    const honch_config_t cfg = {
        .api_key           = api_key,                  // from CONFIG_*/secret ref
        .host              = "https://i.honch.io",
        .device_model      = "esp32-s3-devkitc",
        .firmware_version  = "0.1.0",
        .event_buffer      = s_honch_event_buffer,
        .event_buffer_size = sizeof(s_honch_event_buffer),
    };
    honch_err_t err = honch_init(&cfg);
    if (err != HONCH_OK) { ESP_LOGE("honch", "init failed: %d", err); return; }

    honch_track("firmware.boot", NULL, 0);   // example event
}

// Drive delivery from a low-priority task; never from ISR / control loops /
// watchdog-sensitive paths. honch_tick() is cooperative and non-blocking.
static void honch_tick_task(void *arg)
{
    for (;;) { honch_tick(); vTaskDelay(pdMS_TO_TICKS(5000)); }
}
```

Then instrument real firmware interactions. Example shapes:

```c
static void track_button_press(uint32_t count)
{
    honch_property_t props[] = {
        honch_prop("button", honch_str("boot")),
        honch_prop("count", honch_i64((int64_t)count)),
    };
    honch_track("button.pressed", props, 2u);
}

static void track_heartbeat(uint32_t beat, uint32_t free_heap)
{
    honch_property_t props[] = {
        honch_prop("beat", honch_i64((int64_t)beat)),
        honch_prop("free_heap", honch_i64((int64_t)free_heap)),
    };
    honch_track("firmware.heartbeat", props, 2u);
}
```

Do not call `honch_track` from an ISR. In ISR/control-loop paths, set a flag or
queue application-owned state, then call Honch from a normal task.

## Verify

- If the toolchain is present: `idf.py set-target esp32s3 && idf.py build`.
  Resolve every compile error against `honch.h` before reporting success — a
  clean build is the proof the API was used correctly.
- If no toolchain is available, do not install one; report the exact build
  command the user must run.
- Before reporting success, inspect the diff/status. If no executable firmware
  or build file changed, the install is incomplete.

## Hard rules

- Do not weaken TLS, auth, request validation, queue durability, or retry policy.
- Do not change Honch SDK public APIs, the wire format, lifecycle, or queue
  semantics. The SDK owns all event encoding — never hand-build chunk bytes.
- Keep delivery cooperative and application-owned; no hidden background work.
- Read `honch.h` and https://docs.honch.io as the only sources of truth.
