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

## Live install view

While the agent works, the run view shows what's happening in real time:

- A **Changed files** panel lists the files Claude creates (`+`) and edits
  (`~`) as it goes, so you can see the install take shape.
- The header carries a live **elapsed timer** and a **token-usage meter**
  (e.g. `12.3k tokens`) — the same usage that counts against the daily free
  install budget, so you always know where you stand.
- Use `↑`/`↓` to scroll back through Claude's output during the run.

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
| `--config <path>` | Read config from an explicit file you maintain (e.g. a committed CI config) instead of the remembered settings |
| `--no-save-config` | Don't remember this run's settings |
| `--try` | Scaffold a starter project (from `honch-io/starters`) when the directory is empty |
| `--dry-run`, `-n` | Preview the plan without running the agent or changing files |
| `--yes`, `-y` | Skip confirmation prompts when inputs are complete |
| `--help`, `-h` | Show help |

Every flag has an environment-variable equivalent (`HONCH_WIZARD_*`), e.g.
`HONCH_WIZARD_INSTALL_DIR`, `HONCH_WIZARD_TARGET`, `HONCH_WIZARD_AUTH_TOKEN`,
`HONCH_WIZARD_DEVICE_MODEL`, `HONCH_WIZARD_CONFIG`, `HONCH_WIZARD_NO_SAVE_CONFIG`,
`HONCH_WIZARD_TRY`, `HONCH_WIZARD_YES`, `HONCH_WIZARD_DRY_RUN`,
`HONCH_WIZARD_NO_ANALYTICS`.

## Reproducible / CI installs

The wizard remembers each project's non-secret choices (target, device model,
project name/id, API base URL — **never tokens or API keys**) in
`~/.config/honch-wizard/projects.json`, keyed by the project's path. **Nothing is
written into your project.** Later runs in the same directory reuse those answers
instead of re-prompting; `--no-save-config` (or `HONCH_WIZARD_NO_SAVE_CONFIG=1`)
skips remembering.

For unattended/CI installs, supply the values explicitly — flags, `HONCH_WIZARD_*`
env vars, or a standalone config file you maintain and point at with
`--config <path>` (or `HONCH_WIZARD_CONFIG`). Each value resolves with the
precedence **CLI flag > env var > config > prompt**.

## Try Honch in an empty folder

Run the wizard in an empty directory (or pass `--try`) and it offers to scaffold
a minimal starter project for the chosen SDK — fetched from
[`honch-io/starters`](https://github.com/honch-io/starters) — and then wires
Honch into it, so you can evaluate Honch from scratch in seconds.

## Telemetry

After an install the wizard may ask one optional, skippable "was this helpful?"
question. On authenticated runs it also sends **coarse install metrics** — SDK
target, outcome, duration, wizard version, and OS/arch — to help improve the
installer. **It never sends your code, file contents, project names or paths, or
any keys.** Opt out any time with `HONCH_WIZARD_NO_ANALYTICS=1` (the standard
`DO_NOT_TRACK=1` is honored too).

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
