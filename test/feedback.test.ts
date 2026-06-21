import { describe, expect, it } from "vitest";
import type { Prompter } from "../src/cli/prompt.js";
import { collectFeedback } from "../src/feedback.js";
import type { FeedbackBody } from "../src/platform/client.js";

type Sent = { token: string; body: FeedbackBody };

function stubClient(opts: { throws?: boolean } = {}) {
  const sent: Sent[] = [];
  return {
    sent,
    sendFeedback: async (token: string, body: FeedbackBody) => {
      sent.push({ token, body });
      if (opts.throws) throw new Error("network down");
    },
  };
}

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
    const client = stubClient();
    await collectFeedback(stubPrompter("up", "loved it"), client, "token-123", {
      target: "esp-idf",
      outcome: "success",
    });

    expect(client.sent).toEqual([
      {
        token: "token-123",
        body: {
          target: "esp-idf",
          outcome: "success",
          rating: "up",
          comment: "loved it",
        },
      },
    ]);
  });

  it("omits an empty comment", async () => {
    const client = stubClient();
    await collectFeedback(stubPrompter("down", ""), client, "t", {
      target: "c-posix",
      outcome: "failed",
    });

    expect(client.sent[0].body).toEqual({
      target: "c-posix",
      outcome: "failed",
      rating: "down",
    });
    expect(client.sent[0].body).not.toHaveProperty("comment");
  });

  it("sends nothing when the user skips", async () => {
    const client = stubClient();
    await collectFeedback(stubPrompter("skip"), client, "t", {
      target: "esp-idf",
      outcome: "success",
    });

    expect(client.sent).toEqual([]);
  });

  it("never throws when delivery fails", async () => {
    const client = stubClient({ throws: true });
    await expect(
      collectFeedback(stubPrompter("up"), client, "t", {
        target: "esp-idf",
        outcome: "success",
      }),
    ).resolves.toBeUndefined();
  });

  it("never carries a secret in the body", async () => {
    const client = stubClient();
    await collectFeedback(stubPrompter("up", "note"), client, "secret-token", {
      target: "esp-idf",
      outcome: "success",
    });

    const raw = JSON.stringify(client.sent[0].body);
    expect(raw).not.toContain("secret-token");
    expect(raw).not.toContain("apiKey");
  });
});
