import { getUpdateAction, PACKAGE_NAME, type UpdateAction } from "./action.js";
import { readVersionInfo, writeVersionInfo } from "./cache.js";
import { isNewer, isSourceBuildVersion } from "./version.js";

const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
// Only hit the network at most this often; otherwise reuse the cached result.
const THROTTLE_MS = 20 * 60 * 60 * 1000; // 20 hours
const FETCH_TIMEOUT_MS = 1500;

export type UpgradeInfo = { latestVersion: string; action: UpdateAction };

export type UpgradeCheckOptions = {
  currentVersion: string;
  /** Injected for tests; defaults to Date.now(). */
  now?: number;
  /** Injected for tests; `undefined` means "detect", `null` means "no action". */
  action?: UpdateAction | null;
  /** Injected for tests; defaults to a timed fetch of the npm registry. */
  fetchLatest?: () => Promise<string | undefined>;
};

/**
 * Decide whether to offer an upgrade on startup. Returns the latest version and
 * the update action when a strictly-newer, non-dismissed release exists.
 *
 * Network access is throttled (20h) and time-boxed (1.5s), and any failure
 * falls back to the cached value, so startup is never blocked for long and
 * offline runs proceed silently.
 */
export async function getUpgradeVersion(
  options: UpgradeCheckOptions,
): Promise<UpgradeInfo | null> {
  if (process.env.HONCH_NO_UPDATE_CHECK) return null;
  if (isSourceBuildVersion(options.currentVersion)) return null;

  const action =
    options.action !== undefined ? options.action : getUpdateAction();
  if (!action) return null;

  const now = options.now ?? Date.now();
  const cached = readVersionInfo();
  let latestVersion = cached?.latestVersion;

  const fresh =
    cached && now - Date.parse(cached.lastCheckedAt) < THROTTLE_MS;
  if (!fresh) {
    const fetched = await (options.fetchLatest ?? fetchLatestFromRegistry)();
    if (fetched) {
      latestVersion = fetched;
      writeVersionInfo({
        latestVersion: fetched,
        lastCheckedAt: new Date(now).toISOString(),
        dismissedVersion: cached?.dismissedVersion,
      });
    }
  }

  if (!latestVersion) return null;
  if (!isNewer(latestVersion, options.currentVersion)) return null;
  if (cached?.dismissedVersion === latestVersion) return null;
  return { latestVersion, action };
}

async function fetchLatestFromRegistry(): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
