import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  dirtyGit: boolean;
};

export function scanProject(root: string): ProjectScan {
  const files: ProjectFiles = {};
  collectFiles(root, root, files, 0);

  return {
    root,
    files,
    detectedTargets: detectSdkTargets(files),
    dirtyGit: existsSync(path.join(root, ".git")),
  };
}

function collectFiles(
  root: string,
  dir: string,
  files: ProjectFiles,
  depth: number,
) {
  if (depth > 3) return;

  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = path.join(dir, entry);
    const relativePath = path.relative(root, fullPath);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      collectFiles(root, fullPath, files, depth + 1);
      continue;
    }

    if (!CANDIDATE_FILES.has(entry) && !entry.endsWith(".cmake")) continue;
    if (stat.size > 128 * 1024) continue;
    files[relativePath] = readFileSync(fullPath, "utf8");
  }
}
