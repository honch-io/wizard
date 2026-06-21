import path from "node:path";
import { z } from "zod";
import {
  loadHonchConfig,
  loadHonchConfigFromPath,
} from "../config/honch-config.js";
import type { SdkTargetId } from "../sdk/targets.js";

const targetSchema = z.enum([
  "esp-idf",
  "c-posix",
  "micropython",
  "arduino",
  "react-native-relay",
]);

export type CliOptions = {
  apiBaseUrl: string;
  installDir: string;
  target?: SdkTargetId;
  authToken?: string;
  deviceModel?: string;
  projectName?: string;
  projectApiKey?: string;
  runAgent: boolean;
  yes: boolean;
  help: boolean;
  saveConfig: boolean;
};

type Env = Record<string, string | undefined>;

export function parseOptions(argv: string[], env: Env): CliOptions {
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const booleanKey = booleanFlagName(arg);
    if (booleanKey) {
      flags.set(booleanKey, true);
      continue;
    }
    if (arg.startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      flags.set(arg.slice(2), argv[i + 1]);
      i += 1;
    }
  }

  // Resolve installDir first — it's the key for this project's remembered config.
  const installDir = path.resolve(
    stringFlag(flags, "install-dir") ??
      env.HONCH_WIZARD_INSTALL_DIR ??
      process.cwd(),
  );

  // Prior answers for this project come from the user-dir registry (keyed by
  // installDir). `--config <path>` / HONCH_WIZARD_CONFIG instead reads an
  // explicit standalone file (a committed/CI config), bypassing the registry.
  const configPathOverride =
    stringFlag(flags, "config") ?? env.HONCH_WIZARD_CONFIG;
  const fileConfig = configPathOverride
    ? loadHonchConfigFromPath(configPathOverride)
    : loadHonchConfig(installDir);

  const rawTarget =
    stringFlag(flags, "target") ??
    env.HONCH_WIZARD_TARGET ??
    fileConfig?.target ??
    undefined;
  const target = rawTarget ? targetSchema.parse(rawTarget) : undefined;

  return {
    apiBaseUrl:
      stringFlag(flags, "api-base-url") ??
      env.HONCH_WIZARD_API_BASE_URL ??
      fileConfig?.apiBaseUrl ??
      "https://api.honch.io",
    installDir,
    target,
    authToken:
      stringFlag(flags, "auth-token") ??
      env.HONCH_WIZARD_AUTH_TOKEN ??
      undefined,
    deviceModel:
      stringFlag(flags, "device-model") ??
      env.HONCH_WIZARD_DEVICE_MODEL ??
      fileConfig?.deviceModel ??
      undefined,
    projectName:
      stringFlag(flags, "project-name") ??
      env.HONCH_WIZARD_PROJECT_NAME ??
      fileConfig?.projectName ??
      undefined,
    projectApiKey:
      stringFlag(flags, "project-api-key") ??
      env.HONCH_WIZARD_PROJECT_API_KEY ??
      undefined,
    // Real install is the default; --dry-run previews without the agent.
    runAgent: !(
      booleanFlag(flags, "dry-run") || env.HONCH_WIZARD_DRY_RUN === "1"
    ),
    yes: booleanFlag(flags, "yes") || env.HONCH_WIZARD_YES === "1",
    help: booleanFlag(flags, "help"),
    // Write honch.config.json by default; --no-save-config or env var disables it.
    saveConfig: !(
      booleanFlag(flags, "no-save-config") ||
      env.HONCH_WIZARD_NO_SAVE_CONFIG === "1"
    ),
  };
}

function stringFlag(flags: Map<string, string | boolean>, key: string) {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function booleanFlag(flags: Map<string, string | boolean>, key: string) {
  return flags.get(key) === true;
}

function booleanFlagName(arg: string) {
  if (arg === "--yes" || arg === "-y") return "yes";
  if (arg === "--help" || arg === "-h") return "help";
  if (arg === "--dry-run" || arg === "-n") return "dry-run";
  if (arg === "--no-save-config") return "no-save-config";
  return undefined;
}
