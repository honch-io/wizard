# Task 1.2 Report — Layer honch.config.json under CLI flags and env

## Status

DONE

## Changes

### `src/config/honch-config.ts`
- Added `loadHonchConfigFromPath(filePath: string): HonchConfig | undefined`.
- Refactored `loadHonchConfig(dir)` to call `loadHonchConfigFromPath` internally — no API or behaviour change; Task 1.1 tests still pass unchanged.

### `src/cli/options.ts`
- Added import for `loadHonchConfig` and `loadHonchConfigFromPath`.
- `parseOptions` now:
  1. Resolves `installDir` first (as before).
  2. Determines the config file path: `--config <path>` flag > `HONCH_WIZARD_CONFIG` env > default `<installDir>/honch.config.json`.
  3. Loads the config via the resolved path.
  4. Layers config values under flags/env for `target`, `apiBaseUrl`, `deviceModel`, and `projectName` (precedence: CLI flag > env var > config > hard-coded default).

### `test/options.test.ts`
- Added 9 new test cases under a `config file layering` describe block covering:
  - Config supplies `target` when no flag/env is set.
  - `--target` flag overrides config.
  - Env var overrides config; flag overrides env var.
  - Config supplies `apiBaseUrl`; flag overrides it.
  - Config supplies `deviceModel` and `projectName`.
  - `--config` flag points at a custom config file path.
  - `HONCH_WIZARD_CONFIG` env points at a custom config file path.
  - `--config` flag overrides `HONCH_WIZARD_CONFIG` env.
  - All tests use temp dirs/files to avoid any dependency on the real cwd.

## CliOptions shape change

No structural change to the `CliOptions` type. The config-location override (`--config` / `HONCH_WIZARD_CONFIG`) is consumed entirely inside `parseOptions` and is not surfaced as a field in `CliOptions` — it is a resolution-time input only, consistent with how `installDir` is resolved.

## projectId handling

`CliOptions` does not carry a `projectId` field (it is provisioned later in the workflow). The task spec says to scope to the four fields above if `CliOptions` doesn't carry it. `projectId` from the config file is therefore not threaded through here; it remains available via `loadHonchConfig`/`loadHonchConfigFromPath` for any future step that needs it.

## Verification

```
bun run typecheck   → clean
bun run test test/options.test.ts test/honch-config.test.ts → 17 passed (17)
bun run format:check → no issues
```
