import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SDK_TARGETS, type SdkTargetId } from "../sdk/targets.js";

const CONFIG_FILENAME = "honch.config.json";

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

export type HonchConfig = {
  target?: SdkTargetId;
  deviceModel?: string;
  projectId?: string;
  projectName?: string;
  apiBaseUrl?: string;
};

export function loadHonchConfig(dir: string): HonchConfig | undefined {
  return loadHonchConfigFromPath(path.join(dir, CONFIG_FILENAME));
}

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

export function writeHonchConfig(dir: string, config: HonchConfig): void {
  const file = path.join(dir, CONFIG_FILENAME);
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
