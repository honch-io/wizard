# Honcho Wizard Spec

## Summary

Honcho Wizard is a standalone Bun/TypeScript CLI that installs Honch SDKs into
client projects with a polished Ink terminal UI and an AI agent. The command is
`honcho`; the repository is `honcho-wizard`.

The v1 wizard supports stable SDK targets only:

- ESP-IDF
- C/POSIX
- MicroPython

Arduino ESP32 and React Native Relay are documented future/preview targets and
must not be installed by the v1 flow unless explicitly added later.

## User Flow

1. Launch `honcho` in or against a client project.
2. Show a branded intro and scan summary.
3. Authenticate with Honch through browser login/signup and localhost callback.
4. Select an existing organization/project or create a new project.
5. Detect or choose SDK target.
6. Collect device metadata: device model, firmware version, capture host, and
   environment.
7. Warn if the client project has a dirty git state.
8. Show the exact planned target/settings and require confirmation unless
   running with `--yes` and complete inputs.
9. Run the Claude Agent SDK through the Honch platform LLM proxy.
10. Run target-appropriate build/test verification.
11. Write a markdown setup report and show success/error outro.

## Platform Contract

The platform owns AI entitlement and project credentials:

- Browser login/signup uses the existing platform auth surface and returns a
  platform JWT to the CLI callback.
- The CLI exchanges that session for a short-lived wizard token.
- The CLI lists organizations/projects and creates a project when requested.
- The CLI uses the selected project API key as the SDK project key.
- The Claude Agent SDK points at the platform Anthropic-compatible proxy.
- Honch provider keys stay server-side and are never sent to the CLI, target
  project, or model context.

## Agent Architecture

The wizard follows the PostHog-inspired separation of concerns:

- Runner/TUI/session infrastructure is generic.
- SDK install knowledge lives in bundled skill markdown.
- Local tools handle target detection, package-manager detection, environment
  file writes, and secret refs.
- A session-scoped secret vault returns opaque `secret:<id>` refs to the agent.
- Tool permissions allow normal read/edit operations in the target project but
  deny direct `.env` reads/writes and dangerous shell commands.

## SDK Install Defaults

ESP-IDF:

- Prefer ESP Component Manager dependency:
  `idf.py add-dependency "honch-io/honch^0.2.0"`.
- Keep networking, Wi-Fi, time, TLS, and telemetry task ownership in the host
  firmware.
- Never weaken TLS defaults or add hidden SDK-owned worker tasks.

C/POSIX:

- Prefer existing CMake integration.
- Use `find_package(honch_posix REQUIRED)` when the SDK is already installed.
- Otherwise use CMake `FetchContent` with `SOURCE_SUBDIR ports/posix`.
- Configure `api_key`, `endpoint_url`, `device_model`,
  `firmware_version`, and `queue_directory`.

MicroPython:

- Configure firmware builds with `_honch_core` through
  `ports/micropython/usermod/honch/micropython.cmake`.
- Use `manifest.py` for frozen wrapper files when appropriate.
- Do not install duplicate `/lib/honch` wrapper files when already frozen.
- Report manual firmware build steps clearly because the SDK is not standalone
  pure Python.

## Verification

V1 verification is build/test only. The wizard does not send a smoke event and
does not start the local Honch sandbox stack.

Target checks should be conservative:

- ESP-IDF: run available non-flash build/test commands only when toolchain is
  already present.
- C/POSIX: run CMake configure/build or the project’s existing test command.
- MicroPython: run host tests or syntax checks when present; report firmware
  build steps when runtime validation cannot run.

## Test Coverage

Wizard tests cover:

- CLI flags and environment precedence.
- SDK target detection.
- Secret vault refs.
- Prompt assembly without raw secret leakage.
- Tool allowlist behavior.

Platform tests cover:

- Wizard-scoped token claims.
- Anthropic proxy request construction.
- Rejection of missing provider credentials.
- No forwarding of client `Authorization` headers upstream.
