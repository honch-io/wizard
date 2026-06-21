import { describe, expect, it } from "vitest";
import { describeFailure } from "../src/ui/App.js";

describe("describeFailure", () => {
  it("treats a network error as a calm 'can't reach Honch' notice", () => {
    const result = describeFailure(
      "request to https://api.honch.io failed, reason: getaddrinfo ENOTFOUND",
    );
    expect(result.tone).toBe("limit");
    expect(result.title).toBe("Can't reach Honch");
    expect(result.lines[0]).toContain("check your connection");
  });

  it("treats an expired sign-in as a calm auth notice", () => {
    const result = describeFailure("401 Unauthorized: token expired");
    expect(result.tone).toBe("limit");
    expect(result.title).toBe("Sign-in expired");
  });

  it("keeps the daily budget message as an expected limit", () => {
    const result = describeFailure("daily token budget exceeded");
    expect(result.tone).toBe("limit");
    expect(result.title).toBe("Daily install limit reached");
  });

  it("falls back to a generic failure for an unknown error", () => {
    const result = describeFailure("something unexpected broke");
    expect(result.tone).toBe("error");
    expect(result.title).toBe("Wizard failed");
    expect(result.lines).toEqual(["something unexpected broke"]);
  });
});
