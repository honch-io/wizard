# Honch C/POSIX Install Skill

Install the stable Honch C/POSIX SDK into CMake projects.

- Prefer `find_package(honch_posix REQUIRED)` when already installed.
- Otherwise use CMake `FetchContent` with `SOURCE_SUBDIR ports/posix`.
- Link targets with `honch::honch_posix`.
- Configure `api_key`, `endpoint_url`, `device_model`, `firmware_version`, and `queue_directory`.
- Keep event timestamps, queue durability, retry policy, and shutdown behavior intact.
- Verify with CMake configure/build or the project's existing tests.
