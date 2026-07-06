---
name: honch-micropython
description: Install the Honch MicroPython Device SDK — the `_honch_core` native user C module plus its Python wrapper — into a MicroPython firmware build without weakening the native queue, TLS, or retry behavior.
---

# Honch MicroPython Install Skill

Device SDK for MicroPython. A thin Python wrapper exposes the six-function
contract; the real queue/encoder/transport lives in the `_honch_core` native
user C module that must be compiled into the firmware. The wrapper is **not**
standalone pure Python.

## When this target applies

- A **MicroPython firmware build** (a MicroPython source tree / a `ports/<port>`
  build, a `manifest.py`, or `USER_C_MODULES` usage). Common on ESP32, RP2,
  STM32.
- If the project is plain ESP-IDF C, use the `esp-idf` skill. If it is desktop/
  embedded-Linux C, use the `c-posix` skill.

## Ground-truth rule (read this first)

After building, **read the wrapper's `.py` source and the `_honch_core` module's
docstrings/signatures** in the firmware, and consult
https://docs.honch.io/sdks/micropython. Treat the installed module as the only
source of truth. Do **not** invent APIs. If the build does not include
`_honch_core`, the wrapper cannot work — fix the build, do not stub it out.

The Python surface is a **class** you instantiate — `honch.Honch(...)` — with
instance methods. There is **no** module-level `honch.init(...)` / `honch.track(...)`.

```python
import honch

client = honch.Honch(
    api_key=API_KEY,                 # required (project key, honch_…, from secret/env)
    # endpoint_url is OPTIONAL — omit it to use the SDK default (https://i.honch.io).
    device_id=DEVICE_ID,             # required, caller-owned, stable per device
    device_model="esp32-cam",        # required
    firmware_version=FIRMWARE_VERSION, # required, existing app/OTA/build version
    event_buffer=bytearray(8192),    # required: a real bytearray (>= 8192), NOT a size int
)

client.track("boot", {"reset_reason": "power_on"})  # properties is an optional dict
client.identify("user_123", {"plan": "beta"})
client.set_property("plan", "pro")
client.session_start("run"); client.session_end()
client.flush()
client.tick()                        # call periodically to drive delivery
client.reset()                       # clears identity/state
client.shutdown()                    # flush + release on exit
```

Known hallucinations to never emit:

- `honch.init(...)` / module-level `honch.track(...)` — do not exist. Construct
  `honch.Honch(...)` and call methods on the instance.
- `event_buffer_size=` (an int) — the required keyword is `event_buffer=` and it
  takes an actual `bytearray` (blank/missing → `InvalidArgumentError`).
- `device_id`, `api_key`, `device_model`, `firmware_version`, and `event_buffer`
  are all **required** — a blank value raises `InvalidArgumentError`.
  `endpoint_url` is **optional**: blank/omitted falls back to the SDK default
  (`https://i.honch.io`), so leave it unset unless targeting a non-default host.
- Source `firmware_version` from the project's existing firmware/app/build
  version. If none exists, add one project-owned constant and use it here; do
  not paste a one-time installer value into the Honch call.

Confirm exact wrapper class/keyword/method names against the installed module
before emitting code.

## Add the SDK to the firmware build

`_honch_core` is a **user C module**: the module source must be present at
firmware-build time. Get it from a source identical on every machine — vendor
the SDK into the project, **never** reference an absolute path to a checkout
under someone's home directory (it breaks for everyone else and in CI).

0. **Vendor the SDK into the repo** as a git submodule, referenced by a path
   **relative to the project**. You cannot run `git` yourself (the wizard's Bash
   sandbox allows only package managers), so **report this as a step the user
   must run** — do not attempt it as a Bash command:
   ```bash
   git submodule add https://github.com/honch-io/SDK.git third_party/honch
   git submodule update --init --recursive
   ```
   (If the canonical SDK repo URL is unknown or private and unresolvable, ask the
   user with `wizard_ask` — do not hardcode a local checkout path.) If
   `third_party/honch` already exists in the repo, skip this step and wire the
   build against the existing checkout.
1. Point `USER_C_MODULES` at the vendored module's cmake fragment, using the
   project-relative submodule path:
   ```bash
   make USER_C_MODULES=$(pwd)/third_party/honch/ports/micropython/usermod/honch/micropython.cmake
   ```
   (For make-based ports without cmake, point at the module's `*.mk` per the
   port's convention; check the vendored
   `third_party/honch/ports/micropython/usermod/honch` directory for what is
   provided.)
2. Freeze the Python wrapper into the firmware via `manifest.py`, again using the
   in-repo submodule path:
   ```python
   # in the board/port manifest.py
   freeze("$(MPY_DIR)/../third_party/honch/ports/micropython/wrapper", "honch.py")
   ```
3. **Do not** also copy duplicate `/lib/honch` files onto the device filesystem
   when the wrapper is already frozen — that creates two competing copies.

## Configure safely

- **Never** hardcode the raw project API key in frozen source or on-device
  files. Inject it via the wizard's secret-ref env tool, a build-time define, or
  a gitignored on-device secrets file — not committed source.
- `endpoint_url` is optional and defaults to the HTTPS capture base
  (`https://i.honch.io`) — leave it unset. If you do set it, keep it HTTPS;
  never disable TLS verification.
- Provide a caller-owned `device_id` (stable across reboots), `device_model`,
  codebase-sourced `firmware_version`, `api_key`, and an `event_buffer`
  (`bytearray(>= 8192)`). `endpoint_url` is optional (see above).

## Where to initialize

Construct `honch.Honch(...)` once at startup after the network is connected and
secrets are loaded, and hold the instance. Call `client.tick()` periodically
(e.g. from your main loop or a timer task) to drive uploads; call
`client.flush()` before sleep/shutdown.

## Verify

- Firmware changes usually **cannot** be validated by running them on the host.
  If a MicroPython build toolchain for the target port is present, build the
  firmware and confirm `_honch_core` links and `import honch` resolves.
- If the toolchain is absent, do not install one. Report the **exact** build
  steps the user must run (the `make ... USER_C_MODULES=...` command, the port,
  the board, and the flashing step) so they can build and flash.

## Hard rules

- Do not weaken TLS, auth, queue durability, or retry policy.
- Do not reimplement the queue/encoder in Python or hand-build wire bytes — the
  native `_honch_core` owns encoding and transport.
- Preserve event timestamps and the native queue semantics.
- Read the installed wrapper/module and https://docs.honch.io as the only
  sources of truth.
