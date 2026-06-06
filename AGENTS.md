# Honcho Wizard Agent Instructions

These instructions apply to the standalone Honch SDK setup wizard.

## What This Repo Is

`honcho-wizard` is the customer-facing CLI that installs Honch SDKs into
client projects with an AI-assisted workflow. The installed binary is `honcho`.

The wizard is not an SDK implementation. It is a controlled installer and
orchestrator that detects a target project, gathers Honch credentials and device
metadata, asks for confirmation, runs an agent, verifies build/test checks, and
writes a setup report.

## SDK Safety Rules

- Keep SDK contract knowledge in bundled skills and typed target config.
- Do not change Honch SDK public APIs, wire format, lifecycle events, queue
  semantics, retry policy, TLS defaults, or capture headers from this repo.
- Never hardcode project API keys in source files. Route secrets through local
  tools or environment files.
- Do not add hidden installs, hidden network calls, hidden background work, or
  silent telemetry dropping.
- Default to explicit user confirmation before mutating client projects.
- Treat ESP-IDF, C/POSIX, and MicroPython as the only v1 install targets.
  Arduino ESP32 and React Native Relay are future/preview targets unless
  explicitly scoped.

## Working Rules

- Run `git status --short` before editing.
- Preserve user-owned dirty files.
- Use Bun for scripts, installs, tests, and lockfiles.
- Use TypeScript throughout.
- Use `apply_patch` for manual edits.
- Keep edits small and scoped.
- Update `SPEC/` and README when public CLI behavior, setup, or workflow
  changes.
- Default to ASCII unless a file already uses Unicode or product copy requires
  it.

## Architecture Rules

- Keep product integration knowledge out of runner infrastructure.
- Put SDK-specific install instructions in bundled skill markdown.
- Keep TUI screens as a function of session state.
- Keep local tools responsible for sensitive file writes and project detection.
- Add new capabilities as typed programs or target configs, not runner branches.

## Verification

Run focused checks before reporting completion:

```sh
bun run build
bun run test
bun run typecheck
bun run format:check
```

If dependencies are not installed, run `bun install` first after user approval
when network access is required.

## Commits

Use Conventional Commits and keep commits focused:

- `feat(wizard): add esp-idf install target`
- `fix(agent): preserve secret refs in prompts`
- `test(cli): cover target detection`
- `docs: update wizard spec`

Do not commit failed verification caused by agent-authored changes. Do not
commit secrets, local `.env` files, generated build output, or client-project
artifacts.
