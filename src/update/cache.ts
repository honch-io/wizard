import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

// Cached result of the last registry check, alongside the auth session under
// ~/.config/honch-wizard. `dismissedVersion` records a "skip this version"
// choice so we don't prompt again for that exact release.
const versionInfoSchema = z.object({
  latestVersion: z.string(),
  lastCheckedAt: z.string(),
  dismissedVersion: z.string().optional(),
});

export type VersionInfo = z.infer<typeof versionInfoSchema>;

export function versionFile() {
  return (
    process.env.HONCH_WIZARD_VERSION_FILE ??
    path.join(homedir(), ".config", "honch-wizard", "version.json")
  );
}

export function readVersionInfo(): VersionInfo | undefined {
  const file = versionFile();
  if (!existsSync(file)) return undefined;
  try {
    return versionInfoSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
}

export function writeVersionInfo(info: VersionInfo) {
  const file = versionFile();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
}

/** Persist a "skip this version" choice, preserving the cached latest/timestamp. */
export function dismissVersion(version: string) {
  const previous = readVersionInfo();
  writeVersionInfo({
    latestVersion: previous?.latestVersion ?? version,
    lastCheckedAt: previous?.lastCheckedAt ?? new Date(0).toISOString(),
    dismissedVersion: version,
  });
}
