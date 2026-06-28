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
3. **Pick your features** — choose which optional SDK features to compile in
   (error tracking — crashes + logs, lifecycle events, sessions, battery).
   Everything is on by default; turn off what a device doesn't need to shrink the
   build, with a **measured** flash/RAM delta shown per feature (ESP32, ESP-IDF
   v6.0.1). The core is always included.
4. **Confirms** the plan — and offers to do the work on a fresh git branch so
   you can review or discard it.
5. **Installs** by running the Claude Agent SDK (through Honch's hosted LLM
   proxy) with local MCP tools for package detection and safe `.env` updates.
   The firmware version and capture host are sourced/defaulted automatically —
   you don't enter them.
6. **Reports** what changed in `honch-setup-report.md`, viewable in the terminal.

On launch it also checks npm for a newer release (throttled, and silent when
offline) and offers a one-keystroke self-update. Set `HONCH_NO_UPDATE_CHECK=1`
to skip the check.

## Live install view

While the agent works, the run view shows what's happening in real time:

- A **Changed files** panel lists the files Claude creates (`+`) and edits
  (`~`) as it goes, so you can see the install take shape.
- The header carries a live **elapsed timer** and a **usage meter** showing how
  much of your **daily install budget** you've used (e.g. `34% of daily limit`),
  so you always know where you stand. The timer keeps counting across a
  pause/resume rather than restarting.
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
| `--try` | Skip straight to "Try Honch": scaffold a starter project (from `honch-io/starters`) into a temporary scratch folder |
| `--dry-run`, `-n` | Preview the plan without running the agent or changing files |
| `--yes`, `-y` | Skip confirmation prompts when inputs are complete |
| `--help`, `-h` | Show help |

Every flag has an environment-variable equivalent (`HONCH_WIZARD_*`), e.g.
`HONCH_WIZARD_INSTALL_DIR`, `HONCH_WIZARD_TARGET`, `HONCH_WIZARD_AUTH_TOKEN`,
`HONCH_WIZARD_DEVICE_MODEL`, `HONCH_WIZARD_TRY`, `HONCH_WIZARD_YES`,
`HONCH_WIZARD_DRY_RUN`, `HONCH_WIZARD_NO_ANALYTICS`. Each value resolves with the
precedence **CLI flag > env var > prompt**.

## The welcome screen

The first screen is the SDK choice. The wizard scans the current directory and
always offers three things:

- **Continue with the detected SDK** — shown (and pre-selected) when the scan
  recognizes one.
- **Choose a different SDK** (or **Choose an SDK** when nothing was detected) —
  the full SDK picker.
- **Try Honch in a scratch project** — see below.

`--target <id>` or `--yes` skips this screen and installs into the current
directory, preserving the non-interactive behavior.

## Try Honch from anywhere

Pick **Try Honch in a scratch project** (or pass `--try`) from *any* directory.
The wizard asks which SDK to try, scaffolds a minimal starter for it — fetched
from [`honch-io/starters`](https://github.com/honch-io/starters) — into a fresh
temporary folder, and wires Honch in there, so you can evaluate Honch from
scratch in seconds without touching your current project. The final report shows
the temporary project's path, and pressing **`E`** opens that folder.

## Telemetry

After an install the wizard may ask one optional, skippable "was this helpful?"
question. It also sends **coarse install metrics** to **PostHog** — SDK target,
outcome, duration, wizard version, OS/arch, token count, and an estimated cost —
to help improve the installer. **It never sends your code, file contents, project
names or paths, project IDs, or any keys.** The key shipped in the binary is
PostHog's public ingest key (read-only; cannot access your data).

The wizard emits a funnel of events:
`wizard_started → wizard_target_selected → wizard_authenticated →
wizard_project_selected → wizard_confirmed → wizard_install_started →
wizard_install_completed` (plus `wizard_feedback` when you answer the feedback
prompt).

Opt out any time with `HONCH_WIZARD_NO_ANALYTICS=1` (the standard
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
