import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "@honch/start";

export type PackageManager = "npm" | "bun" | "pnpm";

export type UpdateAction = {
  manager: PackageManager;
  command: string;
  args: string[];
};

const ACTIONS: Record<PackageManager, UpdateAction> = {
  npm: { manager: "npm", command: "npm", args: ["install", "-g", `${PACKAGE_NAME}@latest`] },
  bun: { manager: "bun", command: "bun", args: ["install", "-g", `${PACKAGE_NAME}@latest`] },
  pnpm: { manager: "pnpm", command: "pnpm", args: ["add", "-g", `${PACKAGE_NAME}@latest`] },
};

export function commandString(action: UpdateAction): string {
  return [action.command, ...action.args].join(" ");
}

/**
 * Work out how this binary was installed so we know which manager can update
 * it. Returns null for a local/dev run (e.g. a symlinked `npm install -g .` or
 * `tsx src/bin.ts`), so the wizard never nags during development.
 *
 * Detection is path-based because, unlike Codex's npm/bun launcher shims, our
 * bin is the Node entry itself — there's no wrapper to set an env var.
 * `HONCH_UPDATE_ACTION=npm|bun|pnpm` forces a manager (used for testing).
 */
export function getUpdateAction(selfPath?: string): UpdateAction | null {
  const forced = process.env.HONCH_UPDATE_ACTION;
  if (forced === "npm" || forced === "bun" || forced === "pnpm") {
    return ACTIONS[forced];
  }

  let resolved: string;
  try {
    resolved = (selfPath ?? realpathSync(fileURLToPath(import.meta.url))).replace(/\\/g, "/");
  } catch {
    return null;
  }

  if (resolved.includes("/.bun/")) return ACTIONS.bun;
  if (resolved.includes("/pnpm/")) return ACTIONS.pnpm;
  if (resolved.includes(`/node_modules/${PACKAGE_NAME}`)) return ACTIONS.npm;
  return null;
}
