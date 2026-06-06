# Honcho Wizard

Agent-powered Honch SDK setup for client projects.

```sh
bun install
bun run dev -- --install-dir /path/to/client
```

The installed binary name is `honcho`.

## Local Dry Run

You can exercise scanning, confirmation, and setup report generation without a
running platform API by supplying local project values:

```sh
bun run build
node dist/bin.mjs \
  --install-dir . \
  --target c-posix \
  --project-name Local \
  --project-api-key honch_test \
  --device-model TestDevice \
  --firmware-version 0.0.1 \
  --yes
```

This writes `honch-setup-report.md` in the target project and does not modify
SDK source files unless `--run-agent` is also provided.

## Commands

```sh
bun run dev -- --help
bun run build
bun run test
bun run typecheck
bun run format:check
```

## Environment

| Variable | Purpose |
| --- | --- |
| `HONCH_WIZARD_API_BASE_URL` | Platform API base URL |
| `HONCH_WIZARD_INSTALL_DIR` | Target project directory |
| `HONCH_WIZARD_TARGET` | SDK target: `esp-idf`, `c-posix`, or `micropython` |
| `HONCH_WIZARD_YES` | Skip confirmation prompts when all inputs are supplied |
| `HONCH_WIZARD_AUTH_TOKEN` | Existing Honch platform bearer token |
| `HONCH_WIZARD_CAPTURE_HOST` | Capture host written into SDK config |
| `HONCH_WIZARD_DEVICE_MODEL` | Device model used by the SDK install |
| `HONCH_WIZARD_FIRMWARE_VERSION` | Firmware version used by the SDK install |
| `HONCH_WIZARD_PROJECT_NAME` | Project name for local/offline testing |
| `HONCH_WIZARD_PROJECT_API_KEY` | Project API key for local/offline testing |
| `HONCH_WIZARD_RUN_AGENT` | Set to `1` to run Claude Agent SDK through platform proxy |

## Layout

```text
src/
  agent/      Prompt assembly and agent run configuration
  cli/        CLI option parsing
  sdk/        SDK target detection and target metadata
  secrets/    In-memory secret vault
  ui/         Ink terminal UI
SPEC/         Product and implementation spec
test/         Unit tests
```
