# Honcho Wizard

Agent-powered Honch SDK setup for client projects.

```sh
bun install
bun run dev -- --install-dir /path/to/client
```

The installed binary name is `honcho`.

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
