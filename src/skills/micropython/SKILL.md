# Honch MicroPython Install Skill

Install the stable Honch MicroPython wrapper and `_honch_core` user module.

- Firmware must include `_honch_core`; the wrapper is not standalone pure Python.
- Configure `USER_C_MODULES` with `ports/micropython/usermod/honch/micropython.cmake`.
- Freeze wrapper files with `manifest.py` when appropriate.
- Do not install duplicate `/lib/honch` files when the wrapper is already frozen.
- Require caller-owned `device_id`, `device_model`, `firmware_version`, `api_key`, `endpoint_url`, and event buffer.
- Report firmware build steps clearly when runtime validation cannot run locally.
