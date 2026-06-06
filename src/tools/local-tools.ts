import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  writeFileSync(envPath, `${next}\n`);

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
  const resolved = path.resolve(workingDirectory, filePath);
  const root = path.resolve(workingDirectory);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes working directory: ${filePath}`);
  }
  return resolved;
}
