/**
 * Strict major.minor.patch parsing. Any non-numeric component (e.g. a
 * prerelease tag like `0-beta`) yields null, so prereleases are never treated
 * as upgrades — matching Codex's update behavior.
 */
export function parseVersion(value: string): [number, number, number] | null {
  const parts = value.trim().split(".");
  if (parts.length < 3) return null;
  const [major, minor, patch] = parts;
  if (![major, minor, patch].every((part) => /^\d+$/.test(part))) return null;
  return [Number(major), Number(minor), Number(patch)];
}

/** True when `latest` is a strictly newer release than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const parsedLatest = parseVersion(latest);
  const parsedCurrent = parseVersion(current);
  if (!parsedLatest || !parsedCurrent) return false;
  for (let i = 0; i < 3; i += 1) {
    if (parsedLatest[i] !== parsedCurrent[i]) {
      return parsedLatest[i] > parsedCurrent[i];
    }
  }
  return false;
}

/** A source/dev build reports 0.0.0 (or unparseable) and is never checked. */
export function isSourceBuildVersion(version: string): boolean {
  const parsed = parseVersion(version);
  return !parsed || (parsed[0] === 0 && parsed[1] === 0 && parsed[2] === 0);
}
