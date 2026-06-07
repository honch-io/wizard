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
    endpoint_url="https://capture.honch.io",
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

`_honch_core` is a **user C module**. It is compiled in via `USER_C_MODULES`;
the wrapper `.py` is frozen via the build's `manifest.py`.

1. Point `USER_C_MODULES` at the module's cmake fragment when building:
   ```bash
   make USER_C_MODULES=<path-to>/honch/SDK/ports/micropython/usermod/honch/micropython.cmake
   ```
   (For make-based ports without cmake, point at the module's `*.mk` per the
   port's convention; check the SDK's `ports/micropython/usermod/honch`
   directory for what is provided.)
2. Freeze the Python wrapper into the firmware via `manifest.py` when
   appropriate:
   ```python
   # in the board/port manifest.py
   freeze("<path-to>/honch/SDK/ports/micropython/wrapper", "honch.py")
   ```
3. **Do not** also copy duplicate `/lib/honch` files onto the device filesystem
   when the wrapper is already frozen — that creates two competing copies.

## Configure safely

- **Never** hardcode the raw project API key in frozen source or on-device
  files. Inject it via the wizard's secret-ref env tool, a build-time define, or
  a gitignored on-device secrets file — not committed source.
- `endpoint_url` must be the HTTPS capture base (`https://capture.honch.io`). Do
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
