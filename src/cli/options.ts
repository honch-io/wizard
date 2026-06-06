import path from "node:path";
import { z } from "zod";
import type { SdkTargetId } from "../sdk/targets.js";

const targetSchema = z.enum(["esp-idf", "c-posix", "micropython"]);

export type CliOptions = {
  apiBaseUrl: string;
  installDir: string;
  target?: SdkTargetId;
  yes: boolean;
  help: boolean;
};

type Env = Record<string, string | undefined>;

export function parseOptions(argv: string[], env: Env): CliOptions {
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--yes" || arg === "-y") {
      flags.set("yes", true);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      flags.set("help", true);
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
      "https://app.honch.io",
    installDir: path.resolve(
      stringFlag(flags, "install-dir") ??
        env.HONCH_WIZARD_INSTALL_DIR ??
        process.cwd(),
    ),
    target,
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
