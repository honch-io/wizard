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

The Python surface follows the six-function contract:

```python
import honch

honch.init(
    api_key=API_KEY,                 # project key, honch_… (from secret/env)
    endpoint_url="https://is.honch.io",
    device_id=DEVICE_ID,             # caller-owned, stable per device
    device_model="esp32-cam",
    firmware_version="0.1.0",
    event_buffer_size=8192,          # caller-owned native queue buffer (>= 8192)
)
honch.track("boot", {"reset_reason": "power_on"})
honch.identify("user_123")
honch.flush()
honch.tick()                         # call periodically to drive delivery
honch.reset()
```

Confirm exact wrapper function/keyword names against the installed module before
emitting code.

## Add the SDK to the firmware build

`_honch_core` is a **user C module**: the module source must be present at
firmware-build time. Get it from a source identical on every machine — vendor
the SDK into the project, **never** reference an absolute path to a checkout
under someone's home directory (it breaks for everyone else and in CI).

0. **Vendor the SDK into the repo** as a git submodule, then reference it by a
   path **relative to the project**:
   ```bash
   git submodule add https://github.com/honch-io/SDK.git third_party/honch
   git submodule update --init --recursive
   ```
   (If the canonical SDK repo URL is unknown or private and unresolvable, ask the
   user with `wizard_ask` — do not hardcode a local checkout path.)
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
- `endpoint_url` must be the HTTPS capture base (`https://is.honch.io`). Do
  not disable TLS verification.
- Provide a caller-owned `device_id` (stable across reboots), `device_model`,
  `firmware_version`, `api_key`, `endpoint_url`, and an event buffer size
  (`>= 8192`).

## Where to initialize

Call `honch.init(...)` once at startup after the network is connected and
secrets are loaded. Call `honch.tick()` periodically (e.g. from your main loop
or a timer task) to drive uploads; call `honch.flush()` before sleep/shutdown.

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
