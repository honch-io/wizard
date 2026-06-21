import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { SdkTargetId } from "../sdk/targets.js";

const CONFIG_FILENAME = "honch.config.json";

const honchConfigSchema = z.object({
  target: z
    .enum([
      "esp-idf",
      "c-posix",
      "micropython",
      "arduino",
      "react-native-relay",
    ])
    .optional(),
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
