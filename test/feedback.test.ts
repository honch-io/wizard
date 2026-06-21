import { describe, expect, it, vi } from "vitest";
import type { Prompter } from "../src/cli/prompt.js";
import { collectFeedback } from "../src/feedback.js";
import type { capturePostHog } from "../src/posthog.js";

// Minimal Prompter that returns scripted answers for select/question.
function stubPrompter(rating: string, comment = ""): Prompter {
  return {
    question: async () => comment,
    select: async () => rating,
    confirm: async () => false,
    close: () => {},
  } as Prompter;
}

describe("collectFeedback", () => {
  it("sends the rating and comment when the user opts in", async () => {
    const capture = vi.fn<typeof capturePostHog>().mockResolvedValue(undefined);
    await collectFeedback(
      stubPrompter("up", "loved it"),
      { target: "esp-idf", outcome: "success" },
      "run-id-123",
      capture,
    );

    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith({
      event: "wizard_feedback",
      distinctId: "run-id-123",
      properties: {
        target: "esp-idf",
        outcome: "success",
        rating: "up",
        comment: "loved it",
      },
    });
  });

  it("omits an empty comment", async () => {
    const capture = vi.fn<typeof capturePostHog>().mockResolvedValue(undefined);
    await collectFeedback(
      stubPrompter("down", ""),
      { target: "c-posix", outcome: "failed" },
      "run-id-abc",
      capture,
    );

    expect(capture).toHaveBeenCalledOnce();
    const call = capture.mock.calls[0][0];
    expect(call.properties).toEqual({
      target: "c-posix",
      outcome: "failed",
      rating: "down",
    });
    expect(call.properties).not.toHaveProperty("comment");
  });

  it("sends nothing when the user skips", async () => {
    const capture = vi.fn<typeof capturePostHog>().mockResolvedValue(undefined);
    await collectFeedback(
      stubPrompter("skip"),
      { target: "esp-idf", outcome: "success" },
      "run-id-xyz",
      capture,
    );

    expect(capture).not.toHaveBeenCalled();
  });

  it("never throws when delivery fails", async () => {
    const capture = vi
      .fn<typeof capturePostHog>()
      .mockRejectedValue(new Error("network down"));
    await expect(
      collectFeedback(
        stubPrompter("up"),
        { target: "esp-idf", outcome: "success" },
        "run-id-err",
        capture,
      ),
    ).resolves.toBeUndefined();
  });
});
