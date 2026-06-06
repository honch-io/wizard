# Honcho Wizard

Agent-powered Honch SDK setup for client projects.

```sh
bun install
bun run dev -- --install-dir /path/to/client
```

The installed binary name is `honcho`.

The wizard is an interactive terminal UI. It scans the target project, prompts
for Honch auth or signup, lets the user pick or create a project, confirms the
planned install, then writes a setup report. Passing `--run-agent` runs the
Claude Agent SDK through the Honch platform LLM proxy and exposes local MCP
tools for package detection and safe `.env` updates.

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

## Platform Agent Run

Run the platform API from the platform branch that includes the wizard proxy,
then point the wizard at it:

```sh
bun run build
node dist/bin.mjs \
  --install-dir /path/to/client \
  --api-base-url http://127.0.0.1:3000 \
  --run-agent
```

The platform must be configured with its Anthropic provider credentials. The
wizard asks for Honch login/signup, organization, project, device model,
firmware version, capture host, and final confirmation before the agent mutates
the target project.

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
  platform/   Honch auth, project, and wizard-token client
  project/    Target-project disk scanning
  report/     Setup report generation
  sdk/        SDK target detection and target metadata
  secrets/    In-memory secret vault
  tools/      Local Claude Agent SDK MCP tools
  ui/         Ink terminal UI
SPEC/         Product and implementation spec
test/         Unit tests
```
