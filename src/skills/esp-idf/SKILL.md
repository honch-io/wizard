# Honch ESP-IDF Install Skill

Install the stable Honch ESP-IDF SDK into a client firmware project without
weakening firmware ownership (Wi-Fi, networking, TLS, time sync, task
scheduling, queues, and shutdown stay application-owned).

## Ground-truth rule (read this first)

Before writing any code, **read the SDK header `honch.h`** in the project
(after the component is added) and treat it as the only source of truth for
symbols and signatures. Do **not** invent APIs.

Known hallucinations to never emit:

- `honch_capture(...)` — does not exist. The call is `honch_track(...)`.
- `honch_event_t`, `.events`, `.event_count` — do not exist. The queue is a raw
  caller-owned `uint8_t` buffer passed as `.event_buffer` / `.event_buffer_size`.
- `esp_err_t` / `ESP_OK` / `esp_err_to_name()` for Honch calls — Honch functions
  return `honch_err_t`; success is `HONCH_OK`.

## Verified public API (`honch.h`)

```c
typedef enum { HONCH_OK = 0, HONCH_ERR_INVALID_ARG, /* ... */ } honch_err_t;

typedef struct {
    const char *api_key;             // required
    const char *host;                // required, e.g. "https://capture.honch.io"
    const char *device_model;        // required
    const char *firmware_version;    // required
    const char *environment;         // optional, defaults to "production"
    uint8_t    *event_buffer;        // required, caller-owned RAM for the queue
    size_t      event_buffer_size;   // required, recommend >= 8192
    uint32_t    flush_interval_seconds;  // optional, default 60
    uint32_t    flush_event_threshold;   // optional, default 30
    int       (*battery_callback)(void); // optional, returns 0-100 or -1
    int         battery_low_threshold;   // optional, default 15
    bool      (*connectivity_callback)(void); // optional, false while offline
    /* ...see honch.h for the full struct... */
} honch_config_t;

honch_err_t honch_init(const honch_config_t *config);
honch_err_t honch_shutdown(void);
honch_err_t honch_track(const char *event, const honch_property_t *properties, size_t property_count);
honch_err_t honch_identify(const char *distinct_id, const honch_property_t *properties, size_t property_count);
honch_err_t honch_session_start(const char *session_name);
honch_err_t honch_session_end(void);
honch_err_t honch_flush(void);
honch_err_t honch_tick(void);
honch_err_t honch_reset(void);
const char *honch_get_device_id(void);
```

For a property-less event call `honch_track("firmware.boot", NULL, 0)`.

## Add the component

The ESP-IDF component is named `honch` (its `REQUIRES` name is `honch`).

1. Preferred when published: `idf.py add-dependency "honch-io/honch^0.2.0"`.
2. If `add-dependency` fails to resolve (registry 404 / not found — currently the
   common case), wire the **local SDK component** instead:
   - In the **top-level** `CMakeLists.txt`, before `project(...)`, point at the
     SDK port directory:
     ```cmake
     set(EXTRA_COMPONENT_DIRS "<path-to>/honch/SDK/ports/esp-idf/honch")
     ```
   - In `main/CMakeLists.txt`, add `honch` to `REQUIRES` (use `honch`, **not**
     `honch-io__honch`):
     ```cmake
     idf_component_register(SRCS "app_main.c" INCLUDE_DIRS "." REQUIRES honch)
     ```
   - Do not duplicate the dependency in `main/idf_component.yml` when using the
     local path.

## Configure safely

- Never write the raw project API key into source. Use the project API key
  secret ref with the local Honcho MCP env tools, or a gitignored
  `sdkconfig.defaults.local` / Kconfig value, and read it via `CONFIG_*`.
- Set `host`, `device_model`, `firmware_version`, and a caller-owned
  `uint8_t` event buffer (`>= 8192` bytes) with its size.

## Wire into the firmware lifecycle

`honch_init()` requires an active network/IP. On ESP32-S3 (Wi-Fi STA), bring up
Wi-Fi first and call `honch_init()` only **after** `IP_EVENT_STA_GOT_IP` — never
directly from `app_main()` when Wi-Fi is async. Minimal shape:

```c
#include "honch.h"

static uint8_t s_honch_event_buffer[16384]; // caller-owned, >= 8192

static void honch_start(const char *api_key)
{
    const honch_config_t cfg = {
        .api_key          = api_key,
        .host             = CONFIG_HONCH_HOST,
        .device_model     = "esp32-s3-devkitc",
        .firmware_version = "0.1.0",
        .event_buffer     = s_honch_event_buffer,
        .event_buffer_size = sizeof(s_honch_event_buffer),
    };
    honch_err_t err = honch_init(&cfg);
    if (err != HONCH_OK) { ESP_LOGE("honch", "init failed: %d", err); return; }

    honch_track("firmware.boot", NULL, 0);   // example capture
}

// Drive delivery from a low-priority task; never from ISR / control loops /
// watchdog-sensitive paths. honch_tick() is cooperative and non-blocking.
static void honch_tick_task(void *arg)
{
    for (;;) { honch_tick(); vTaskDelay(pdMS_TO_TICKS(5000)); }
}
```

## Verify

- If the toolchain is present: `idf.py set-target esp32s3 && idf.py build`.
  Resolve every compile error against `honch.h` before reporting success — a
  clean build is the proof the API was used correctly.
- If no toolchain is available, do not install one; report the exact build
  command the user must run.

## Hard rules

- Do not weaken TLS, auth, request validation, queue durability, or retry policy.
- Do not change Honch SDK public APIs, wire format, lifecycle, or queue semantics.
- Keep delivery cooperative and application-owned; no hidden background work.
