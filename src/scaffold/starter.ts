import { mkdirSync } from "node:fs";
import type { SdkTargetId } from "@honch/agent-core";
import { x as extractTar } from "tar";

// Bare starter projects (no Honch) live in a separate repo, one folder per
// target, so they can be maintained and verified independently of this CLI. The
// ref is pinned so a given wizard version always scaffolds a known-good starter.
const STARTERS_REPO = "honch-io/starters";
const STARTERS_REF = "v1";

// Only targets with a folder in the starters repo can be scaffolded today.
const STARTER_TARGETS: readonly SdkTargetId[] = [
  "esp-idf",
  "c-posix",
  "micropython",
];

export type ScaffoldResult = { files: string[] };

/** Fetches the gzipped repo tarball; injectable so tests stay offline. */
export type FetchTarball = (url: string) => Promise<Uint8Array>;

export function starterTarballUrl(ref: string = STARTERS_REF): string {
  return `https://codeload.github.com/${STARTERS_REPO}/tar.gz/refs/tags/${ref}`;
}

export function starterAvailable(target: SdkTargetId): boolean {
  return STARTER_TARGETS.includes(target);
}

const defaultFetchTarball: FetchTarball = async (url) => {
  const response = await fetch(url, {
    headers: { accept: "application/octet-stream" },
  });
  if (!response.ok) {
    throw new Error(`Could not download starters (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

/**
 * Scaffold the bare starter for `target` into `installDir` by downloading the
 * starters repo tarball and extracting only that target's folder. Returns the
 * list of created files (paths relative to `installDir`).
 *
 * GitHub wraps the archive in a top-level `starters-<ref>/` directory, so a
 * target file lives at `starters-<ref>/<target>/...`; we keep only that folder
 * and strip the two leading path components.
 */
export async function scaffoldStarter(
  installDir: string,
  target: SdkTargetId,
  opts: { fetchTarball?: FetchTarball; ref?: string } = {},
): Promise<ScaffoldResult> {
  if (!starterAvailable(target)) {
    throw new Error(`No starter project is available for ${target} yet.`);
  }

  const ref = opts.ref ?? STARTERS_REF;
  const fetchTarball = opts.fetchTarball ?? defaultFetchTarball;
  const data = await fetchTarball(starterTarballUrl(ref));

  mkdirSync(installDir, { recursive: true });
  const files: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = extractTar({
      cwd: installDir,
      strip: 2,
      // Keep only entries under `<top>/<target>/`.
      filter: (entryPath) => {
        const parts = entryPath.split("/");
        return parts.length > 2 && parts[1] === target;
      },
      onentry: (entry) => {
        if (entry.type === "File") {
          files.push(entry.path.split("/").slice(2).join("/"));
        }
      },
    });
    stream.on("close", resolve);
    stream.on("error", reject);
    stream.end(Buffer.from(data));
  });

  return { files };
}
