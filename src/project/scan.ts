import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  detectSdkTargets,
  type ProjectFiles,
  type SdkTarget,
} from "../sdk/targets.js";

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

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".venv",
  "__pycache__",
]);

export type ProjectScan = {
  root: string;
  files: ProjectFiles;
  detectedTargets: SdkTarget[];
};

export function scanProject(root: string): ProjectScan {
  const files: ProjectFiles = {};
  collectFiles(root, root, files, 0);

  return {
    root,
    files,
    detectedTargets: detectSdkTargets(files),
  };
}

function collectFiles(
  root: string,
  dir: string,
  files: ProjectFiles,
  depth: number,
) {
  if (depth > 3) return;

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
