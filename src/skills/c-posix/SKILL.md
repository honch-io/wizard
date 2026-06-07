---
name: honch-c-posix
description: Install the Honch C/POSIX Device SDK into a CMake project (embedded Linux, desktop daemons, gateways) without weakening queue durability, TLS, retry, or shutdown behavior.
---

# Honch C/POSIX Install Skill

Device SDK for POSIX C (embedded Linux, gateways, desktop daemons). Queues
events to a durable on-disk directory and uploads directly to Honch over HTTPS.

## When this target applies

- A C/C++ project built with **CMake** that runs on a POSIX host (Linux/macOS)
  with a filesystem and a network stack. Look for a `CMakeLists.txt` plus a
  POSIX runtime (no ESP-IDF `project.cmake`, no `idf_component.yml`).
- For Arduino/ESP-IDF firmware use the `esp-idf` skill; for MicroPython use the
  `micropython` skill.

## Ground-truth rule (read this first)

After the dependency is added, **read the installed `honch.h`** and treat it as
the only source of truth for symbols and signatures. Also consult
https://docs.honch.io/sdks/c-posix. Do **not** invent APIs. If the installed
header and the docs disagree, the **installed header wins**.

Known hallucinations to never emit:

- `honch_capture(...)` — does not exist. The call is `honch_track(...)`.
- `honch_event_t`, `.events`, `.event_count` — do not exist.
- Honch functions return `honch_err_t` (success `HONCH_OK`), not `int`/`errno`.

## Verified public API (`honch.h`)

Same six-function contract as every Honch SDK. The C symbols match the ESP-IDF
port:

```c
typedef enum { HONCH_OK = 0, HONCH_ERR_INVALID_ARG, /* ... */ } honch_err_t;

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

The POSIX `honch_config_t` includes a **durable queue directory** in addition to
the common fields. Confirm the exact field names against the installed header;
the verified set is:

```c
typedef struct {
    const char *api_key;          // required (project key, honch_…)
    const char *endpoint_url;     // required, e.g. "https://capture.honch.io"
    const char *device_model;     // required
    const char *firmware_version; // required
    const char *environment;      // optional, defaults to "production"
    const char *queue_directory;  // required, writable path for the durable queue
    /* ...see honch.h for the full struct (flush interval/threshold, callbacks)... */
} honch_config_t;
```

For a property-less event call `honch_track("service.start", NULL, 0)`.

## Add the SDK dependency (CMake)

1. **Preferred** when the SDK is already installed on the host:
   ```cmake
   find_package(honch_posix REQUIRED)
   target_link_libraries(your_target PRIVATE honch::honch_posix)
   ```
2. **Otherwise** vendor it with `FetchContent`, building only the POSIX port:
   ```cmake
   include(FetchContent)
   FetchContent_Declare(
     honch
     GIT_REPOSITORY https://github.com/honch-io/honch.git
     GIT_TAG        v0.2.0          # pin a real tag; verify against the repo
     SOURCE_SUBDIR  ports/posix
   )
   FetchContent_MakeAvailable(honch)
   target_link_libraries(your_target PRIVATE honch::honch_posix)
   ```
   If the repo URL/tag is unknown, ask or point at the locally provided SDK
   checkout's `ports/posix` directory; do not guess a tag that may not exist.

## Configure safely

- **Never** hardcode the raw project API key. Read it from the environment
  (`getenv`) wired through the wizard's secret-ref env tool, or from a
  gitignored config file — not from committed source.
- `endpoint_url` must be the HTTPS capture base (`https://capture.honch.io`).
  Do not add any insecure / skip-TLS option in production.
- `queue_directory` must be a writable, persistent path so the queue survives
  restarts. Do not point it at a tmpfs you wipe on boot.

## Where to initialize

Call `honch_init()` once during process startup, after config/secrets are
loaded and before you emit events. Drive delivery by calling `honch_tick()`
periodically from a normal worker thread or your main loop (not a signal
handler). Call `honch_flush()` and `honch_shutdown()` on graceful exit so queued
events are sent.

```c
#include "honch.h"

int main(void) {
    const honch_config_t cfg = {
        .api_key          = getenv("HONCH_API_KEY"),   // secret ref / env
        .endpoint_url     = "https://capture.honch.io",
        .device_model     = "edge-gateway-v1",
        .firmware_version = "0.1.0",
        .queue_directory  = "/var/lib/honch/queue",    // durable
    };
    if (honch_init(&cfg) != HONCH_OK) return 1;

    honch_track("service.start", NULL, 0);
    /* ... periodically: honch_tick(); ... */
    honch_flush();
    honch_shutdown();
    return 0;
}
```

## Verify

- If CMake + a compiler are present: configure and build, e.g.
  `cmake -B build && cmake --build build`. Resolve every error against
  `honch.h`. Run the project's existing tests if any.
- If the toolchain is absent, do not install one; print the exact configure/
  build commands for the user to run.

## Hard rules

- Do not weaken TLS, auth, request validation, queue durability, or retry policy.
- Preserve event timestamps, queue-directory durability, retry, and graceful
  shutdown behavior.
- The SDK owns all event encoding — never hand-build the wire bytes.
- Read `honch.h` and https://docs.honch.io as the only sources of truth.
