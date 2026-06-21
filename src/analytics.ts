import { readFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";
import type { AnalyticsPayload } from "./platform/client.js";

/**
 * Analytics is on by default (disclosed in the README) and disabled by
 * `HONCH_WIZARD_NO_ANALYTICS` or the cross-tool `DO_NOT_TRACK` standard.
 */
export function analyticsDisabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.HONCH_WIZARD_NO_ANALYTICS) || Boolean(env.DO_NOT_TRACK);
}

/** This CLI's own version, read from the manifest beside the bundle. */
export function wizardVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Assemble the experience-only analytics payload. By construction it carries no
 * code, file contents, project identifiers, paths, or secrets — only the coarse
 * fields below.
 */
export function buildAnalyticsPayload(input: {
  target?: string;
  outcome: AnalyticsPayload["outcome"];
  agentRan: boolean;
  durationMs: number;
}): AnalyticsPayload {
  return {
    event: "install",
    wizardVersion: wizardVersion(),
    os: platform(),
    arch: arch(),
    target: input.target,
    outcome: input.outcome,
    agentRan: input.agentRan,
    durationMs: input.durationMs,
  };
}
