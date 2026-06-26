import { describe, expect, it } from "vitest";
import type { Prompter } from "../src/cli/prompt.js";
import { requiredInput } from "../src/workflow.js";

function fakePrompter(answers: string[]): {
  prompter: Prompter;
  calls: () => number;
} {
  let i = 0;
  let count = 0;
  const prompter = {
    question: async () => {
      count++;
      return answers[i++] ?? "";
    },
    select: async () => "",
    confirm: async () => true,
    multiSelect: async () => [],
    close: () => {},
  } as unknown as Prompter;
  return { prompter, calls: () => count };
}

describe("requiredInput", () => {
  it("returns a provided value without asking", async () => {
    const { prompter, calls } = fakePrompter([]);
    expect(await requiredInput("esp32", "Device model:", prompter)).toBe(
      "esp32",
    );
    expect(calls()).toBe(0);
  });

  it("re-asks until a non-empty value is entered", async () => {
    const { prompter, calls } = fakePrompter(["", "  ", "esp32-s3"]);
    expect(await requiredInput(undefined, "Device model:", prompter)).toBe(
      "esp32-s3",
    );
    expect(calls()).toBe(3);
  });

  it("ignores a whitespace-only provided value and asks instead", async () => {
    const { prompter } = fakePrompter(["esp32"]);
    expect(await requiredInput("   ", "Device model:", prompter)).toBe("esp32");
  });
});
