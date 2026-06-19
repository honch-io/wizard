# Contributing

Honcho Wizard currently depends on unreleased platform support. Before testing
agent installs, make sure the local platform repo is checked out to:

```sh
cd /Users/morgana/Development/honch-io/platform
git checkout feat/honcho-wizard-platform
```

That branch contains the wizard auth token endpoint and the Claude Code LLM
gateway proxy. The wizard will not run the agent path correctly against platform
`main` until those changes are merged.

## Local Setup

Start platform infrastructure and backend first:

```sh
cd /Users/morgana/Development/honch-io/platform/infra
docker compose up -d

cd /Users/morgana/Development/honch-io/platform/backend
bun run dev
```

The backend `.env` must include `ANTHROPIC_API_KEY`. Do not commit that file.

Then build and run the wizard:

```sh
cd /Users/morgana/Development/honch-io/honcho-wizard
bun install
bun run build

node dist/bin.mjs \
  --install-dir /private/tmp/honcho-wizard-target \
  --api-base-url http://localhost:3001 \
  --run-agent
```

## Checks

Run these before pushing wizard changes:

```sh
bun run format
bun run test
bun run typecheck
bun run build
bun run format:check
```

Use Conventional Commits for all commits, for example:

```sh
fix(wizard): proxy Claude Code API requests
feat(wizard): stream agent tool output
docs: add handoff instructions
```
