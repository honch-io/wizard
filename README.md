<h1>Honch wizard ✨</h1>

The Honch wizard installs the [Honch](https://honch.io) analytics SDK into your
project. Run it, sign in through your browser once, and it does the rest —
detect the target, resolve your project + capture key, read the live docs, and
wire the SDK in with an AI agent, showing you every code change live.

```sh
npx -y honcho-wizard
```

That's it. It opens your browser to sign in (and remembers you next time), then
handles everything else — no manual project picking.

## What it does

1. **Sign in once.** On first run it opens your browser to authenticate, then
   saves the login to `~/.honch/config.json` so future runs are zero-friction.
   It mints a short-lived wizard token (for the agent's LLM, proxied through the
   Honch platform) and looks up your project and its `honch_…` capture key.
   Already have a token? Pass it as `--token`/`HONCH_WIZARD_TOKEN` to skip the
   browser step.
2. **Auto-detects the target** from your build files:
   - **ESP-IDF** · **C/POSIX** · **MicroPython** (firmware / Device SDK)
   - **React Native relay** · **iOS (Swift)** · **Android (Kotlin)** (App SDK / relay)
3. **Reads `https://docs.honch.io` every run** and treats the installed SDK
   headers as the only source of truth — it never invents APIs or hand-encodes
   the wire format.
4. **Installs + wires the SDK** using your project's own build system, writing
   the capture key to env/config (never hardcoded) and initializing Honch at the
   right lifecycle point.
5. **Asks only when topology matters** — e.g. a firmware target with a companion
   mobile app that relays events over BLE.
6. **Shows live colored diffs** of every file as it's changed, plus a stage
   timeline, and writes a `honch-setup-report.md`.

## Flags

Run `honcho-wizard login` to sign in ahead of time (or refresh an expired
login); the default run does this automatically when it finds no saved login.

| Flag | Env | Default |
|------|-----|---------|
| `<token>` / `--token` | `HONCH_WIZARD_TOKEN` | — (optional; browser login if unset) |
| `--api-base-url` | `HONCH_WIZARD_API_BASE_URL` | `https://api.honch.io` (backend) |
| `--frontend-url` | `HONCH_WIZARD_FRONTEND_URL` | `https://app.honch.io` (app links) |
| `--capture-host` | `HONCH_WIZARD_CAPTURE_HOST` | `https://i.honch.io` |
| `--project` | `HONCH_WIZARD_PROJECT` | your only / first project |
| `--device-model` | `HONCH_WIZARD_DEVICE_MODEL` | — |
| `--firmware-version` | `HONCH_WIZARD_FIRMWARE_VERSION` | — |
| `--install-dir` | `HONCH_WIZARD_INSTALL_DIR` | cwd |

The wizard sends **no telemetry**.

## Integrating Honch by hand

The same install knowledge ships as a portable skill at
[`.claude/skills/honch-integration`](.claude/skills/honch-integration/SKILL.md)
and per-target guides under [`src/skills/`](src/skills) — drop them into any
project's `.claude/skills/` and run them with Claude Code without the wizard.

## Development

```sh
bun install
bun run build         # -> dist/bin.js
bun run typecheck
bun run test
node dist/bin.js --help
```

---

Forked from [PostHog/wizard](https://github.com/PostHog/wizard) (MIT). The
agent runner, Ink TUI, framework-config detection, secret vault, and in-process
MCP tools are PostHog's; the Honch fork swaps auth, targets, skills, prompt,
branding, and adds the live-diff view. See `LICENSE`.
