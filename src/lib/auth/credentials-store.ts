/**
 * On-disk store for the user's Honch login token.
 *
 * `honch login` performs a browser OAuth flow and saves the resulting user
 * bearer here so subsequent `honch` runs are zero-friction (no paste). The
 * file lives at `~/.honch/config.json` (dir 0700, file 0600) and is keyed by
 * platform base URL so a dev token (localhost) never clobbers a prod token.
 *
 * The saved token is the NORMAL user bearer (the same value the wizard would
 * otherwise ask you to paste). On each run it is exchanged at
 * `POST /api/wizard/token` for the short-lived wizard token; this file never
 * holds the minted wizard token.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

import { runtimeEnv } from '@env';

const CONFIG_VERSION = 1 as const;

export interface SavedAccount {
  /** The user bearer obtained via `honch login`. */
  token: string;
  /** ISO timestamp of when it was saved (informational only). */
  savedAt: string;
}

interface ConfigFile {
  version: number;
  /** Accounts keyed by normalized platform base URL. */
  accounts: Record<string, SavedAccount>;
}

/**
 * `~/.honch` — the wizard's per-user config directory. Override with
 * `HONCH_WIZARD_CONFIG_DIR` (used in CI/tests and for relocating config).
 */
export function getConfigDir(): string {
  const override = runtimeEnv('HONCH_WIZARD_CONFIG_DIR');
  if (override && override.length > 0) return override;
  return join(os.homedir(), '.honch');
}

/** `~/.honch/config.json` — where the login token is persisted. */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

/** Strip a trailing slash so `https://app.honch.io` and `.../` share a key. */
function normalizeKey(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

function readConfig(): ConfigFile {
  let raw: string;
  try {
    raw = fs.readFileSync(getConfigPath(), 'utf8');
  } catch {
    return { version: CONFIG_VERSION, accounts: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ConfigFile>;
    const accounts =
      parsed && typeof parsed.accounts === 'object' && parsed.accounts
        ? parsed.accounts
        : {};
    return { version: CONFIG_VERSION, accounts };
  } catch {
    // Corrupt file — treat as empty rather than crashing the wizard.
    return { version: CONFIG_VERSION, accounts: {} };
  }
}

/**
 * Return the saved user bearer for `apiBaseUrl`, or null if none. Never
 * throws — a missing or unreadable file resolves to null.
 */
export function readSavedToken(apiBaseUrl: string): string | null {
  const account = readConfig().accounts[normalizeKey(apiBaseUrl)];
  const token = account?.token;
  return token && token.length > 0 ? token : null;
}

/**
 * Persist `token` for `apiBaseUrl`, creating `~/.honch` (0700) if needed and
 * writing the file 0600. Returns the config path so callers can show it.
 */
export function saveToken(apiBaseUrl: string, token: string): string {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const config = readConfig();
  config.accounts[normalizeKey(apiBaseUrl)] = {
    token,
    savedAt: new Date().toISOString(),
  };

  const path = getConfigPath();
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  // mkdir/writeFile `mode` is ignored if the path already exists, so tighten
  // explicitly in case the file pre-dated this write.
  try {
    fs.chmodSync(path, 0o600);
  } catch {
    // best-effort (e.g. exotic filesystems); the file is still written.
  }
  return path;
}

/**
 * Remove the saved token for `apiBaseUrl` (or every account when omitted).
 * Returns true if anything was removed.
 */
export function clearToken(apiBaseUrl?: string): boolean {
  const config = readConfig();
  if (apiBaseUrl === undefined) {
    const had = Object.keys(config.accounts).length > 0;
    config.accounts = {};
    if (had) {
      fs.writeFileSync(
        getConfigPath(),
        `${JSON.stringify(config, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
    return had;
  }
  const key = normalizeKey(apiBaseUrl);
  if (!(key in config.accounts)) return false;
  delete config.accounts[key];
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  return true;
}
