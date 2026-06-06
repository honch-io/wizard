# Honch ESP-IDF Install Skill

Install the stable Honch ESP-IDF SDK without weakening firmware ownership.

- Prefer `idf.py add-dependency "honch-io/honch^0.2.0"`.
- Configure `api_key`, `host`, `device_model`, `firmware_version`, and a caller-owned event buffer.
- Keep Wi-Fi, network init, time, TLS trust, task priority, stack size, and shutdown ordering application-owned.
- Call `honch_tick()` from a low-priority task; never from ISR, control loops, or watchdog-sensitive paths.
- Do not set insecure TLS defaults for production.
- Verify with an ESP-IDF build only when the toolchain already exists.
