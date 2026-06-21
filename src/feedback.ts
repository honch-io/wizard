import type { Prompter } from "./cli/prompt.js";
import type { FeedbackBody, PlatformClient } from "./platform/client.js";

/**
 * Ask the user, after a completed install, whether it was helpful and send their
 * answer to the platform. Strictly opt-in: nothing is sent unless they pick a
 * rating (choosing "Skip" sends nothing), and delivery failures — including the
 * endpoint not existing yet — never surface or block the wizard.
 */
export async function collectFeedback(
  prompter: Prompter,
  client: Pick<PlatformClient, "sendFeedback">,
  accessToken: string,
  base: { target: string; outcome: FeedbackBody["outcome"] },
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
    await client.sendFeedback(accessToken, {
      ...base,
      rating,
      ...(comment ? { comment } : {}),
    });
  } catch {
    // Feedback delivery is best-effort — never block or fail the wizard on it.
  }
}
