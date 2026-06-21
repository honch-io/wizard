import { readFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";

export type InstallOutcome = "success" | "failed" | "reverted";

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

// Rough blended $/Mtok for the pinned Claude model. The metered token total
// sums input+output+cache at face value, so this is an approximation for
// cost-per-install trends, not billing.
const BLENDED_USD_PER_MTOK = 3;

export function estimateCostUsd(totalTokens: number): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  return (
    Math.round((totalTokens / 1_000_000) * BLENDED_USD_PER_MTOK * 100) / 100
  );
}

export function buildInstallProperties(input: {
  target?: string;
  outcome: InstallOutcome;
  agentRan: boolean;
  durationMs: number;
  totalTokens: number;
}): Record<string, unknown> {
  return {
    wizard_version: wizardVersion(),
    os: platform(),
    arch: arch(),
    target: input.target,
    outcome: input.outcome,
    agent_ran: input.agentRan,
    duration_ms: input.durationMs,
    total_tokens: input.totalTokens,
    est_cost_usd: estimateCostUsd(input.totalTokens),
  };
}
