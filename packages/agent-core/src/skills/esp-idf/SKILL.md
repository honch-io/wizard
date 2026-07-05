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
  BLE-only and relays through a phone, use the `react-native-relay` skill on the
  app side instead — the firmware still uses this SDK but drains to a buffer
  rather than uploading.

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
    const char *firmware_version;    // required, from the project's version source
    const char *environment;         // optional, defaults to "production"
    uint8_t    *event_buffer;        // required, caller-owned RAM for the queue
    size_t      event_buffer_size;   // required, recommend >= 8192
    uint32_t    flush_interval_seconds;      // optional, default 120
    uint32_t    flush_min_interval_ms;       // optional, default 15000
    uint32_t    flush_event_threshold;       // optional, default 20
    uint32_t    flush_max_batches;           // optional, default 1
    uint32_t    shutdown_flush_max_batches;  // optional, default 1
    uint32_t    transport_timeout_ms;        // optional, default 8000
    int       (*battery_callback)(void);     // optional, returns 0-100 or -1
    int         battery_low_threshold;       // optional, default 15
    bool      (*connectivity_callback)(void);// optional, false while offline
    const honch_state_storage_ops_t *state_storage_ops; // optional, durable identity/version state
    const honch_event_queue_ops_t   *event_queue_ops;   // optional, replaces the default RAM queue
    bool        enable_error_tracking;       // optional, emits recovered $crash after abnormal reset
    bool        enable_crash_symbolication;  // optional, adds build id + fault addrs from ESP coredump
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

The ESP-IDF component's `REQUIRES` name depends on **how** it is added, and
getting this wrong is the most common reason the build won't resolve the
component:

- **Registry-managed** (`idf.py add-dependency "honch/honch"`): it installs to
  `managed_components/honch__honch/`, so the CMake component name — and the
  `REQUIRES` name — is **`honch__honch`** (`<namespace>__<name>`).
- **Git submodule** vendored at `components/honch`: the name is the directory,
  **`honch`**.

Always get it from a source that is identical on every machine — **never** bake a
local filesystem path into committed build files. A path like
`EXTRA_COMPONENT_DIRS "/Users/.../SDK/ports/esp-idf"` only exists on one
developer's laptop; it breaks for everyone else and in CI.

1. **Preferred — ESP Component Registry:**
   ```
   idf.py add-dependency "honch/honch^0.3.0"
   ```
   The registry namespace is **`honch/honch`** — **NOT** `honch-io/honch`. The
   GitHub org slug (`honch-io`) is not the registry namespace; `honch-io/honch`
   does not resolve and breaks `idf.py reconfigure`. If no toolchain is present,
   hand-author `main/idf_component.yml` with the exact same coordinates instead of
   running the command:
   ```yaml
   dependencies:
     idf:
       version: ">=5.0"
     honch/honch: "^0.3.0"
   ```
   The component manager fetches it on the next `idf.py reconfigure`/`build`.
   Verify the resolved version against the installed `honch.h`.
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

Then add the component to your app's `REQUIRES` — using the name that matches how
you added it (see above): **`honch__honch`** for the registry-managed component,
or **`honch`** for a `components/honch` submodule:
```cmake
# Registry-managed (added via idf.py add-dependency "honch/honch…"):
idf_component_register(SRCS "app_main.c" INCLUDE_DIRS "." REQUIRES honch__honch)
# Or, for a components/honch git submodule instead:
# idf_component_register(SRCS "app_main.c" INCLUDE_DIRS "." REQUIRES honch)
```

## Configure safely

- **Never** write the raw project API key into source or `sdkconfig`. Use the
  wizard's `set_env_values` tool to write `CONFIG_HONCH_API_KEY` /
  `CONFIG_HONCH_HOST` into the gitignored `sdkconfig.defaults.local`, and read
  them via `CONFIG_*`.
- **Declare the `CONFIG_HONCH_*` symbols first — this is the #0 prerequisite.**
  The Honch SDK component ships **no Kconfig**; `CONFIG_HONCH_API_KEY` and
  `CONFIG_HONCH_HOST` do not exist until *your app component* declares them. If
  they aren't declared, `idf.py reconfigure` discards the keys from
  `sdkconfig.defaults*` as unknown symbols and any `CONFIG_HONCH_API_KEY`
  reference in C fails to compile — the provisioned key never reaches the
  firmware. So add (or extend) `main/Kconfig.projbuild` with a `menu` declaring
  both string symbols, then read them in C via `CONFIG_HONCH_API_KEY` /
  `CONFIG_HONCH_HOST`:
  ```kconfig
  menu "Honch"
      config HONCH_API_KEY
          string "Honch API Key"
          default ""
      config HONCH_HOST
          string "Honch Host"
          default "https://i.honch.io"
  endmenu
  ```
- **Make the key actually take effect — this is the #1 silent failure on
  ESP-IDF.** A value in `sdkconfig.defaults*` is ineffective unless BOTH hold:
  1. **No stale `sdkconfig` shadows it.** ESP-IDF: a value already in the
     build-time `sdkconfig` always overrides the defaults files. A leftover
     `sdkconfig` (from a prior build, a previous wizard run, or local dev) will
     keep an OLD `CONFIG_HONCH_API_KEY`, and the firmware flashes with the wrong
     key → capture returns `401` with no build-time error.
  2. **CMakeLists wires the file in.** Bare ESP-IDF does NOT read
     `sdkconfig.defaults.local` — it must appear in `SDKCONFIG_DEFAULTS`
     (set before `project()`), e.g.
     `set(SDKCONFIG_DEFAULTS "sdkconfig.defaults;sdkconfig.defaults.local")`.

  `set_env_values` now reconciles both automatically when you write to
  `sdkconfig.defaults.local` (it strips any shadowing `CONFIG_HONCH_*` from an
  existing `sdkconfig` and wires `SDKCONFIG_DEFAULTS`). **Read its output** — if
  it prints a `WARNING:` about wiring, fix CMakeLists yourself before continuing.
- **Verify the effective key before reporting success.** If the toolchain is
  present, run `idf.py reconfigure` and confirm the generated `sdkconfig`'s
  `CONFIG_HONCH_API_KEY` matches the provisioned key
  (`grep CONFIG_HONCH_API_KEY sdkconfig`). If no toolchain is available, tell the
  user the exact command and that a stale `sdkconfig` (if any) was reconciled, so
  a plain `idf.py build` will now pick up the provisioned key.
- Set `host` to the capture base (`https://i.honch.io`), plus
  `device_model`, `firmware_version`, and a caller-owned `uint8_t` event buffer
  (`>= 8192` bytes) with its size.
- Do not point `host` at a non-TLS URL and do not add any
  `insecure_skip_tls_verify` flag in production.
- **Be frugal with the radio and the user's data plan.** The SDK ships
  conservative delivery defaults — `flush_interval_seconds` 120,
  `flush_min_interval_ms` 15000, `flush_max_batches` 1, `flush_event_threshold`
  20, `transport_timeout_ms` 8000. Leave them unless the product genuinely needs
  faster delivery; never disable `flush_min_interval_ms` (benchmark/factory
  modes only) or crank the flush cadence. Prefer low-rate, meaningful events
  (boot, state changes, low-rate heartbeats) over per-loop or per-sample tracks
  — each flush is a TLS round trip on the device's own connection.

## Completion criteria

This install is not complete if you only add markdown, a report, a skill file,
dependency metadata, or Kconfig defaults. A successful ESP-IDF integration must
modify executable firmware/build files and wire Honch into real behavior:

- add the component dependency and the matching `REQUIRES` (`honch__honch` for the
  registry-managed component, `honch` for a `components/honch` submodule);
- initialize Honch after the device has network/IP, never before async Wi-Fi is
  ready;
- drive `honch_tick()` from an application-owned low-priority task **with a
  TLS-capable stack (`>= 8192` bytes)** — a flushing tick runs a synchronous TLS
  handshake on that task's stack, so an undersized stack reboot-loops the device;
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
        .firmware_version  = FIRMWARE_VERSION,         // existing app/OTA/build version
        .event_buffer      = s_honch_event_buffer,
        .event_buffer_size = sizeof(s_honch_event_buffer),
    };
    honch_err_t err = honch_init(&cfg);
    if (err != HONCH_OK) { ESP_LOGE("honch", "init failed: %d", err); return; }

    honch_track("firmware.boot", NULL, 0);   // example event
}

// Drive delivery from a low-priority, application-owned task. honch_tick() is
// cooperative (no SDK-owned background thread — your firmware owns the task,
// its priority, affinity, and watchdog policy) but it is NOT non-blocking: a
// tick that flushes runs a synchronous DNS + TLS handshake + HTTP POST on THIS
// task's stack and can block for up to transport_timeout_ms. So:
//   - never call it from an ISR, control loop, UI loop, or watchdog path; and
//   - give the task a TLS-capable stack. Floor: >= 8192 BYTES — the mbedTLS
//     handshake alone needs several KB. ESP-IDF's xTaskCreate sizes the stack
//     in bytes (not words); smaller values like 3072/4096 overflow on the
//     first flush and reboot-loop the device. The SDK's own example uses 8192.
static void honch_tick_task(void *arg)
{
    for (;;) { honch_tick(); vTaskDelay(pdMS_TO_TICKS(5000)); }
}

// Spawn it after honch_init() succeeds (e.g. at the end of honch_start()).
// The stack size is the whole point — do not shrink it:
//   xTaskCreate(honch_tick_task, "honch_tick", 8192, NULL, 2, NULL);
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
