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
- **The POSIX/core API is client-handle based**, unlike the ESP-IDF port's
  global singleton. Every call takes a `honch_client_t *client` (and `honch_init`
  takes `honch_client_t **client`). Do **not** drop the client handle or copy the
  ESP-IDF `honch_init(&cfg)` / `honch_track("evt", …)` shape.
- POSIX/core functions return **`honch_status_t`** (success `HONCH_OK`; use
  `honch_status_string()` for the message), **not** `honch_err_t` / `int` /
  `errno`.
- Build properties with `honch_prop()` / `honch_i64()` / `honch_str()` /
  `honch_bool()` / `honch_f64()` from `honch/core/wire_v2.h`; never hand-init a
  `honch_property_t`.

## Verified public API (`honch.h`)

The POSIX port is the **client-handle** form of the contract (confirm against the
installed `honch/honch.h`):

```c
typedef struct honch_client honch_client_t;
typedef enum { HONCH_OK = 0, HONCH_ERR_INVALID_ARG, /* ... */ } honch_status_t;

honch_status_t honch_init(honch_client_t **client, const honch_config_t *config);
honch_status_t honch_shutdown(honch_client_t *client);
honch_status_t honch_track(honch_client_t *client, const char *event, const honch_property_t *properties, size_t property_count);
honch_status_t honch_identify(honch_client_t *client, const char *distinct_id, const honch_property_t *traits, size_t trait_count);
honch_status_t honch_set_property(honch_client_t *client, const char *key, honch_value_t value);
honch_status_t honch_session_start(honch_client_t *client, const char *session_name);
honch_status_t honch_session_end(honch_client_t *client);
honch_status_t honch_flush(honch_client_t *client);
honch_status_t honch_tick(honch_client_t *client);
honch_status_t honch_reset(honch_client_t *client);
const char *honch_get_device_id(honch_client_t *client);
const char *honch_status_string(honch_status_t status);
```

The POSIX `honch_config_t` includes a **durable queue directory** in addition to
the common fields. Confirm the exact field names against the installed header;
the verified set is:

```c
typedef struct {
    const char *api_key;            // required (project key, honch_…)
    const char *endpoint_url;       // required, e.g. "https://i.honch.io"
    const char *device_id;          // optional, NULL to derive
    const char *device_model;       // required
    const char *firmware_version;   // required
    const char *environment;        // optional, defaults to "production"
    const char *queue_directory;    // required, writable path for the durable queue
    uint32_t    batch_size;         // optional
    uint32_t    max_queued_events;  // optional
    uint32_t    max_event_bytes;    // optional, recommend >= 8192
    uint32_t    transport_timeout_ms; // optional
    /* ...confirm the full struct against the installed honch.h... */
} honch_config_t;
```

For a property-less event call `honch_track(client, "service.start", NULL, 0)`.

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
     GIT_REPOSITORY https://github.com/honch-io/SDK.git
     GIT_TAG        v0.2.0          # pin a real tag; verify against the repo
     SOURCE_SUBDIR  ports/posix
   )
   FetchContent_MakeAvailable(honch)
   target_link_libraries(your_target PRIVATE honch::honch_posix)
   ```
   This pulls the SDK from git — a source identical on every machine. If the repo
   URL or tag is unknown, ask the user with `wizard_ask`; **never** hardcode a
   path to a local SDK checkout (it breaks for everyone else and in CI) and do
   not guess a tag that may not exist.

## Configure safely

- **Never** hardcode the raw project API key. Read it from the environment
  (`getenv`) wired through the wizard's secret-ref env tool, or from a
  gitignored config file — not from committed source.
- `endpoint_url` must be the HTTPS capture base (`https://i.honch.io`).
  Do not add any insecure / skip-TLS option in production.
- `queue_directory` must be a writable, persistent path so the queue survives
  restarts. Do not point it at a tmpfs you wipe on boot.

## Where to initialize

Call `honch_init()` once during process startup, after config/secrets are
loaded and before you emit events. It allocates a `honch_client_t` you pass to
every other call.

**`honch_tick()` is blocking, not just cooperative.** A tick that flushes runs a
synchronous DNS resolution + TLS handshake + HTTP POST on the calling thread and
can block for up to `transport_timeout_ms`. There is no SDK-owned background
thread — you own the cadence — so drive delivery deliberately:

- Run `honch_tick(client)` on its own **dedicated worker thread**. Never call it
  on a latency-sensitive path — your main event loop, a request-handling hot
  path, or a `select`/`poll`/`epoll` loop — or a single slow flush stalls the
  whole process for seconds. Never call it from a **signal handler**: it is not
  async-signal-safe.
- If you create that thread with a custom (non-default) stack, keep it
  TLS-capable — the TLS handshake alone needs several KB. The default pthread
  stack is large enough; only the manually-shrunk case is a hazard.
- Unless `honch.h` documents the client handle as thread-safe, **serialize
  access to it**: don't call `honch_track()` from app threads while
  `honch_tick()` runs on another. Funnel events through one thread or guard the
  handle with a mutex.

Call `honch_flush(client)` and `honch_shutdown(client)` on graceful exit so
queued events are sent.

```c
#include "honch.h"

int main(void) {
    const honch_config_t cfg = {
        .api_key          = getenv("HONCH_API_KEY"),   // secret ref / env
        .endpoint_url     = "https://i.honch.io",
        .device_model     = "edge-gateway-v1",
        .firmware_version = "0.1.0",
        .queue_directory  = "/var/lib/honch/queue",    // durable
    };
    honch_client_t *client = NULL;
    if (honch_init(&client, &cfg) != HONCH_OK) return 1;

    honch_track(client, "service.start", NULL, 0);
    /* On a dedicated thread, periodically: honch_tick(client);
       it blocks on TLS+POST — never on your main/event loop. */
    honch_flush(client);
    honch_shutdown(client);
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
