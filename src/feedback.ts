import type { InstallOutcome } from "./analytics.js";
import type { Prompter } from "./cli/prompt.js";
import { capturePostHog } from "./posthog.js";

/**
 * After a completed install, ask whether it was helpful and send the answer to
 * PostHog as a `wizard_feedback` event. Strictly opt-in (Skip sends nothing);
 * delivery is best-effort and never blocks the wizard.
 */
export async function collectFeedback(
  prompter: Prompter,
  base: { target: string; outcome: InstallOutcome },
  distinctId: string,
  capture: typeof capturePostHog = capturePostHog,
): Promise<void> {
  const rating = await prompter.select({
    title: "Quick feedback",
    message:
      "Was the Honch install helpful? (optional — pick Skip to say nothing)",
    options: [
      { label: "Yes", value: "up" },
      { label: "No", value: "down" },
      { label: "Skip", value: "skip" },
    ],
  });
  if (rating !== "up" && rating !== "down") return;
  const comment = (
    await prompter.question("Anything to add? (press enter to skip)")
  ).trim();
  try {
    await capture({
      event: "wizard_feedback",
      distinctId,
      properties: {
        target: base.target,
        outcome: base.outcome,
        rating,
        ...(comment ? { comment } : {}),
      },
    });
  } catch {
    // Feedback delivery is best-effort — never block or fail the wizard on it.
  }
}
