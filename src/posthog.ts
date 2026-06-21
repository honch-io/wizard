import { randomUUID } from "node:crypto";

// PostHog *public* project key — an ingest-only key that is safe to embed in a
// distributed client (it cannot read data). Override for a different project /
// self-hosted instance via env.
const DEFAULT_POSTHOG_KEY = "phc_tPWRdoGpDLXkSN5ZkYBTCbtTDki2hWdQKdFLZA9AQUxa";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export function posthogConfig(
  env: Record<string, string | undefined> = process.env,
): {
  key: string;
  host: string;
} {
  return {
    key: env.HONCH_WIZARD_POSTHOG_KEY ?? DEFAULT_POSTHOG_KEY,
    host: (env.HONCH_WIZARD_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST).replace(
      /\/+$/,
      "",
    ),
  };
}

/**
 * A throwaway id used to correlate the events from a single wizard run (install
 * + optional feedback) without identifying the user. Deliberately not stable
 * across runs — paired with `$process_person_profile: false`, no PostHog person
 * profile is ever created.
 */
export function newRunId(): string {
  return randomUUID();
}

export type PostHogEvent = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
};

/**
 * Send one event to PostHog's capture endpoint. Best-effort and PII-free by
 * construction (callers pass only coarse, non-identifying properties). A
 * missing key or any network/parse failure is swallowed so telemetry never
 * blocks or fails the wizard.
 */
export async function capturePostHog(
  evt: PostHogEvent,
  opts: {
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<void> {
  const { key, host } = posthogConfig(opts.env);
  if (!key) return;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    await doFetch(`${host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: evt.event,
        distinct_id: evt.distinctId,
        properties: {
          ...evt.properties,
          // Anonymous-only: never create or update a PostHog person profile.
          $process_person_profile: false,
        },
      }),
    });
  } catch {
    // Telemetry is best-effort — never surface a delivery failure.
  }
}
