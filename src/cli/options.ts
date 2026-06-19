import path from "node:path";
import { z } from "zod";
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

  const rawTarget =
    stringFlag(flags, "target") ?? env.HONCH_WIZARD_TARGET ?? undefined;
  const target = rawTarget ? targetSchema.parse(rawTarget) : undefined;

  return {
    apiBaseUrl:
      stringFlag(flags, "api-base-url") ??
      env.HONCH_WIZARD_API_BASE_URL ??
      "https://api.honch.io",
    installDir: path.resolve(
      stringFlag(flags, "install-dir") ??
        env.HONCH_WIZARD_INSTALL_DIR ??
        process.cwd(),
    ),
    target,
    authToken:
      stringFlag(flags, "auth-token") ??
      env.HONCH_WIZARD_AUTH_TOKEN ??
      undefined,
    deviceModel:
      stringFlag(flags, "device-model") ??
      env.HONCH_WIZARD_DEVICE_MODEL ??
      undefined,
    projectName:
      stringFlag(flags, "project-name") ??
      env.HONCH_WIZARD_PROJECT_NAME ??
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
  return undefined;
}
