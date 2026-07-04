import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  detectSdkTargets,
  type ProjectFiles,
  type SdkTarget,
} from "@honch/agent-core";

const CANDIDATE_FILES = new Set([
  "CMakeLists.txt",
  "idf_component.yml",
  "manifest.py",
  "boot.py",
  "main.py",
  "package.json",
  "requirements.txt",
  "pyproject.toml",
]);

// Non-hidden directories that never hold the user's own project sources
// (dependencies, build output, generated/vendored trees). Hidden directories —
// `.git`, `.venv`, `.platformio`, `.espressif`, … — are skipped wholesale by the
// dotfile check in collectFiles, so they don't need listing here.
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "__pycache__",
  "managed_components",
  "venv",
  "target",
  "out",
]);

// How deep detection looks. Real project-root signals live shallow: the root
// itself (0), `main/CMakeLists.txt` (1), and `components/<x>/CMakeLists.txt`
// (2). Going deeper only reaches into unrelated nested trees.
const MAX_DEPTH = 2;

// A file at a directory's top level that marks it as an actual project root.
// Detection only runs when the launch directory is itself a project — running
// somewhere that isn't one (e.g. a home directory) must not adopt an SDK from a
// nested, unrelated tree. `.ino` is matched by extension separately.
const PROJECT_ROOT_ANCHORS = new Set([
  "cmakelists.txt",
  "idf_component.yml",
  "platformio.ini",
  "sketch.yaml",
  "package.json",
  "pyproject.toml",
  "setup.py",
  "pipfile",
  "requirements.txt",
  "manifest.py",
  "boot.py",
  "main.py",
]);

export type ProjectScan = {
  root: string;
  files: ProjectFiles;
  detectedTargets: SdkTarget[];
};

export function scanProject(root: string): ProjectScan {
  const files: ProjectFiles = {};
  collectFiles(root, root, files, 0);

  // Grounding: only attribute an SDK when the launch directory is itself a
  // project root. Otherwise the scan's files came from unrelated subtrees and
  // any "detection" would be a guess, not a fact.
  const detectedTargets = isProjectRoot(root) ? detectSdkTargets(files) : [];

  return { root, files, detectedTargets };
}

function isProjectRoot(dir: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (!PROJECT_ROOT_ANCHORS.has(lower) && !lower.endsWith(".ino")) continue;
    try {
      if (statSync(path.join(dir, entry)).isFile()) return true;
    } catch {
      // Unreadable entry — ignore and keep looking.
    }
  }
  return false;
}

function collectFiles(
  root: string,
  dir: string,
  files: ProjectFiles,
  depth: number,
) {
  if (depth > MAX_DEPTH) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Only the top-level read is fatal — a missing/unreadable --install-dir is a
    // user-facing path/permission problem worth a clear message. Deeper dirs are
    // skipped non-fatally below via the per-entry stat guard.
    if (dir === root) {
      throw new Error(
        `Couldn't read the project directory ${dir} — check the path and permissions.`,
      );
    }
    return;
  }

  for (const entry of entries) {
    // Hidden entries are toolchain caches, VCS metadata, and editor state —
    // never the user's project sources. Skipping them keeps detection grounded
    // in the actual project (e.g. ~/.platformio / ~/.espressif can't leak in).
    if (entry.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = path.join(dir, entry);
    const relativePath = path.relative(root, fullPath);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(fullPath);
    } catch {
      // A single unreadable entry (e.g. a dangling symlink or a permission
      // hole) shouldn't sink the whole scan — skip it.
      continue;
    }

    if (stat.isDirectory()) {
      collectFiles(root, fullPath, files, depth + 1);
      continue;
    }

    if (!CANDIDATE_FILES.has(entry) && !entry.endsWith(".cmake")) continue;
    if (stat.size > 128 * 1024) continue;
    files[relativePath] = readFileSync(fullPath, "utf8");
  }
}
