# Honch Wizard

The Honch wizard (`npx -y @honch/wizard <token>`) installs Honch SDKs into
client projects with an AI-assisted terminal flow. It is an installer and
orchestrator, not an SDK implementation.

## Scope

- Detect a target project.
- Resolve a Honch bearer token into a short-lived wizard token and project
  capture key.
- Copy the bundled target skill into the client project.
- Run the agent through the Honch LLM proxy.
- Show live diffs and write `honch-setup-report.md`.

## Supported Targets

V1 targets:

- ESP-IDF
- C/POSIX
- MicroPython

Preview/future targets:

- React Native relay
- iOS Swift
- Android Kotlin

## Architecture Rules

- Keep SDK-specific install knowledge in bundled skills under `src/skills/`.
- Keep runner infrastructure product-agnostic.
- Keep local tools responsible for sensitive writes and project detection.
- Add capabilities through typed program configs or target configs, not runner
  branches.
- Do not hardcode capture keys in source files.
- Do not invent Honch SDK APIs, wire formats, lifecycle behavior, queue
  semantics, TLS defaults, or retry policy in this repo.

## Development

Use Bun for local scripts:

```sh
bun install
bun run build
bun run test
bun run typecheck
bun run format:check
```

Run locally against a project:

```sh
bun run try --install-dir=<path> <honch-token>
```

## Notes

This fork keeps some generic infrastructure inherited from PostHog's wizard
(agent runner, Ink TUI primitives, local tools, scanner plumbing). PostHog
programs, web-framework installs, OAuth signup, remote MCP setup, and telemetry
are not part of the Honch wizard flow.
