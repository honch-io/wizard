import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { SecretVault } from "../secrets/vault.js";

export type EnvValue = string | { secretRef: string };

export function detectPackageManager(workingDirectory: string): string[] {
  const managers: string[] = [];
  if (existsSync(path.join(workingDirectory, "bun.lock"))) managers.push("bun");
  if (existsSync(path.join(workingDirectory, "pnpm-lock.yaml")))
    managers.push("pnpm");
  if (existsSync(path.join(workingDirectory, "yarn.lock")))
    managers.push("yarn");
  if (existsSync(path.join(workingDirectory, "package-lock.json")))
    managers.push("npm");
  if (existsSync(path.join(workingDirectory, "requirements.txt")))
    managers.push("pip");
  if (existsSync(path.join(workingDirectory, "pyproject.toml")))
    managers.push("python");
  if (existsSync(path.join(workingDirectory, "CMakeLists.txt")))
    managers.push("cmake");
  return managers;
}

export function checkEnvKeys(
  workingDirectory: string,
  filePath: string,
  keys: string[],
): Record<string, boolean> {
  const envPath = resolveSafePath(workingDirectory, filePath);
  const contents = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const present = new Set(
    contents
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
      .filter((key): key is string => Boolean(key)),
  );

  return Object.fromEntries(keys.map((key) => [key, present.has(key)]));
}

export function setEnvValues(
  workingDirectory: string,
  filePath: string,
  values: Record<string, EnvValue>,
  secretVault: SecretVault,
) {
  const envPath = resolveSafePath(workingDirectory, filePath);
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const byKey = new Map<string, string>();

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) byKey.set(match[1], match[2]);
  }

  for (const [key, value] of Object.entries(values)) {
    byKey.set(key, resolveEnvValue(value, secretVault));
  }

  const next = Array.from(byKey.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  // Env files hold the project API key — keep them owner-only. writeFileSync's
  // mode only applies on create, so chmod afterwards to tighten existing files.
  writeFileSync(envPath, `${next}\n`, { mode: 0o600 });
  chmodSync(envPath, 0o600);

  return {
    keys: Object.keys(values),
    valuesReturned: false,
  };
}

function resolveEnvValue(value: EnvValue, secretVault: SecretVault) {
  if (typeof value === "string") return value;
  return secretVault.resolve(value.secretRef);
}

function resolveSafePath(workingDirectory: string, filePath: string) {
  // Reject absolute inputs outright — env files are always project-relative.
  if (path.isAbsolute(filePath)) {
    throw new Error(`Path must be relative to the project: ${filePath}`);
  }
  // Resolve the project root through symlinks so the containment check compares
  // real paths, not lexical ones.
  const root = realpathSync(path.resolve(workingDirectory));
  const target = path.resolve(root, filePath);

  // Resolve the target's real parent directory. A symlinked parent (e.g.
  // `config -> /etc`) would otherwise pass a lexical check and let the write
  // land outside the project.
  const parent = path.dirname(target);
  const realParent = existsSync(parent) ? realpathSync(parent) : parent;
  if (realParent !== root && !realParent.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes the project: ${filePath}`);
  }

  const safePath = path.join(realParent, path.basename(target));
  // Never follow a symlink at the final component (e.g. `.env -> ~/.ssh/x`).
  if (existsSync(safePath) && lstatSync(safePath).isSymbolicLink()) {
    throw new Error(`Refusing to follow a symlink: ${filePath}`);
  }
  return safePath;
}
