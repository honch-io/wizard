# Honch

**Agent-powered installer for the [Honch](https://honch.io) SDK.**

`honch` scans your project, connects your Honch account, and wires the right
Honch SDK into your codebase for you — ESP-IDF, C/POSIX, MicroPython, Arduino,
or a React Native relay. It runs as an interactive terminal UI and finishes with
a setup report you can review.

## Quick start

Run it straight from npm — no install needed:

```sh
# npm
npx @honch/start

# bun
bunx @honch/start
```

By default it sets up the SDK in the current directory. Point it somewhere else
with `--install-dir`:

```sh
npx @honch/start --install-dir /path/to/your/project
```

## Install globally

```sh
# npm
npm install -g @honch/start

# bun
bun add -g @honch/start
```

Then run it anywhere:

```sh
honch
```

> Requires **Node.js ≥ 22**. Bun works too — `bunx` / `bun add -g` fetch and
> launch it under Node via its shebang.

## What it does

1. **Scans** the target project and detects the most likely SDK target.
2. **Connects** your Honch account (browser login/signup) and lets you pick or
   create a project.
3. **Confirms** the plan — and offers to do the work on a fresh git branch so
   you can review or discard it.
4. **Installs** by running the Claude Agent SDK (through Honch's hosted LLM
   proxy) with local MCP tools for package detection and safe `.env` updates.
   The firmware version and capture host are sourced/defaulted automatically —
   you don't enter them.
5. **Reports** what changed in `honch-setup-report.md`, viewable in the terminal.

On launch it also checks npm for a newer release (throttled, and silent when
offline) and offers a one-keystroke self-update. Set `HONCH_NO_UPDATE_CHECK=1`
to skip the check.

## Preview without changing anything

Use `--dry-run` (`-n`) to walk the flow and generate the setup report without
running the agent or touching your files:

```sh
npx @honch/start --dry-run
```

## Options

| Flag | Description |
| --- | --- |
| `--install-dir <path>` | Project to set up (defaults to the current directory) |
| `--target <id>` | `esp-idf`, `c-posix`, `micropython`, `arduino`, or `react-native-relay` |
| `--api-base-url <url>` | Honch platform API base URL (defaults to production) |
| `--auth-token <token>` | Use an existing Honch bearer token instead of logging in |
| `--device-model <name>` | Device model to configure |
| `--project-name <name>` | Honch project name (local/offline testing) |
| `--project-api-key <key>` | Honch project API key (local/offline testing) |
| `--config <path>` | Read the `honch.config.json` from this path instead of the install directory |
| `--no-save-config` | Don't write `honch.config.json` after a successful run |
| `--dry-run`, `-n` | Preview the plan without running the agent or changing files |
| `--yes`, `-y` | Skip confirmation prompts when inputs are complete |
| `--help`, `-h` | Show help |

Every flag has an environment-variable equivalent (`HONCH_WIZARD_*`), e.g.
`HONCH_WIZARD_INSTALL_DIR`, `HONCH_WIZARD_TARGET`, `HONCH_WIZARD_AUTH_TOKEN`,
`HONCH_WIZARD_DEVICE_MODEL`, `HONCH_WIZARD_CONFIG`,
`HONCH_WIZARD_NO_SAVE_CONFIG`, `HONCH_WIZARD_YES`, `HONCH_WIZARD_DRY_RUN`.

## Reproducible / CI installs

A successful run writes a `honch.config.json` in the project, recording the
non-secret choices it resolved (target, device model, project name/id, API base
URL) — **no tokens or API keys are ever written**. Later runs read it back so
the same install is reproducible without re-answering prompts, which makes it
handy for CI. Each value is resolved with the precedence **CLI flag > env var >
config file > prompt**, so the file fills in only what you haven't supplied
explicitly.

Point at a config elsewhere with `--config <path>` (or `HONCH_WIZARD_CONFIG`),
or skip writing one with `--no-save-config` (or `HONCH_WIZARD_NO_SAVE_CONFIG=1`).

## Development

```sh
git clone https://github.com/honch-io/wizard
cd wizard
bun install

bun run dev -- --help        # run from source
bun run build                # bundle to dist/
bun run test                 # unit tests
bun run typecheck            # tsc --noEmit
bun run format:check         # biome lint/format check
```

Run the local build against a project:

```sh
bun run build
node dist/bin.mjs --install-dir /path/to/project
```

## License

MIT
