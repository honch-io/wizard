import { describe, expect, it } from "vitest";
import { promptTitle } from "../src/cli/prompt.js";

describe("promptTitle", () => {
  it("maps known prompts to a friendly category", () => {
    expect(promptTitle("Organization slug")).toBe("Organization");
    expect(promptTitle("Project name")).toBe("Honch project");
    expect(promptTitle("Device model")).toBe("Device profile");
  });

  it("falls back to the prompt itself, not a generic label", () => {
    // So a text prompt's heading is never less informative than the question.
    expect(promptTitle("Anything to add?")).toBe("Anything to add?");
  });
});
