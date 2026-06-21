import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { SDK_TARGETS, type SdkTargetId } from "../sdk/targets.js";

// Derive the target enum from the SDK target ids so it can't drift from the
// real source of truth in src/sdk/targets.ts.
const targetIds = Object.keys(SDK_TARGETS) as [SdkTargetId, ...SdkTargetId[]];

const honchConfigSchema = z.object({
  target: z.enum(targetIds).optional(),
  deviceModel: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  apiBaseUrl: z.string().optional(),
});

export type HonchConfig = z.infer<typeof honchConfigSchema>;

// Remembered per-project settings are stored in the user's config dir, keyed by
// the project's absolute path — never written into the user's project, so there
// is no stray file to gitignore or explain. It sits in the same folder the
// wizard already creates for the auth session and update cache.
const registrySchema = z.record(z.string(), honchConfigSchema);

export function projectsRegistryFile(): string {
  return (
    process.env.HONCH_WIZARD_PROJECTS_FILE ??
    path.join(homedir(), ".config", "honch-wizard", "projects.json")
  );
}

function readRegistry(): Record<string, HonchConfig> {
  const file = projectsRegistryFile();
  if (!existsSync(file)) return {};
  try {
    return registrySchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

/** Settings remembered for a project, keyed by its absolute path. */
export function loadHonchConfig(installDir: string): HonchConfig | undefined {
  return readRegistry()[path.resolve(installDir)];
}

/**
 * Read an explicit, standalone config file — the `--config <path>` opt-in for
 * teams who keep a committed config (e.g. in CI). This is read-only; the wizard
 * never writes here.
 */
export function loadHonchConfigFromPath(
  filePath: string,
): HonchConfig | undefined {
  if (!existsSync(filePath)) return undefined;

  try {
    return honchConfigSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

/** Remember a project's settings in the user-dir registry (never in the project). */
export function writeHonchConfig(
  installDir: string,
  config: HonchConfig,
): void {
  const file = projectsRegistryFile();
  const registry = readRegistry();
  registry[path.resolve(installDir)] = config;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`);
}
