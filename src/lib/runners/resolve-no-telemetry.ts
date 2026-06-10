/**
 * `--no-telemetry` flips `telemetry: false` via yargs negation;
 * the Honch env var is honoured separately for non-yargs callers.
 */
export function resolveNoTelemetry(options: Record<string, unknown>): boolean {
  if (options.telemetry === false) return true;
  const env =
    process.env.HONCH_WIZARD_NO_TELEMETRY ??
    process.env.POSTHOG_WIZARD_NO_TELEMETRY;
  if (env == null || env === '') return false;
  const norm = env.toLowerCase();
  return norm !== '0' && norm !== 'false';
}
