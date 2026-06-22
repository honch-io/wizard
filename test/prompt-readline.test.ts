import { afterEach, describe, expect, it, vi } from "vitest";

// Capture what the readline prompter writes, and script its answers.
const questionMock = vi.fn<(prompt: string) => Promise<string>>();

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: questionMock,
    close: () => {},
  }),
}));

afterEach(() => {
  questionMock.mockReset();
});

describe("createPrompter (readline / non-TTY)", () => {
  it("renders each option's badge and hint inline in the select list", async () => {
    questionMock.mockResolvedValueOnce("1");
    const { createPrompter } = await import("../src/cli/prompt.js");
    const prompter = createPrompter();

    const answer = await prompter.select({
      title: "Select SDK",
      message: "Which SDK should I set up?",
      defaultValue: "esp-idf",
      options: [
        {
          label: "ESP-IDF",
          value: "esp-idf",
          badge: "(detected)",
          hint: "Run an ESP-IDF build",
        },
        { label: "C/POSIX", value: "c-posix", hint: "Run CMake configure" },
      ],
    });

    expect(answer).toBe("esp-idf");
    const rendered = questionMock.mock.calls[0][0];
    expect(rendered).toContain("ESP-IDF (detected)");
    expect(rendered).toContain("Run an ESP-IDF build");
    expect(rendered).toContain("Run CMake configure");
  });

  it("re-prompts on an unrecognized answer instead of silently using the default", async () => {
    // A typo must not silently install the default/first SDK — re-ask until the
    // answer is valid.
    questionMock.mockResolvedValueOnce("banana").mockResolvedValueOnce("2");
    const { createPrompter } = await import("../src/cli/prompt.js");
    const prompter = createPrompter();

    const answer = await prompter.select({
      title: "Select SDK",
      message: "Which SDK should I set up?",
      defaultValue: "esp-idf",
      options: [
        { label: "ESP-IDF", value: "esp-idf" },
        { label: "C/POSIX", value: "c-posix" },
      ],
    });

    expect(answer).toBe("c-posix");
    expect(questionMock).toHaveBeenCalledTimes(2);
  });

  it("accepts the default on a bare enter", async () => {
    questionMock.mockResolvedValueOnce("");
    const { createPrompter } = await import("../src/cli/prompt.js");
    const prompter = createPrompter();

    const answer = await prompter.select({
      title: "Select SDK",
      message: "Which SDK should I set up?",
      defaultValue: "c-posix",
      options: [
        { label: "ESP-IDF", value: "esp-idf" },
        { label: "C/POSIX", value: "c-posix" },
      ],
    });

    expect(answer).toBe("c-posix");
    expect(questionMock).toHaveBeenCalledTimes(1);
  });

  it("defaults confirm to yes on a bare enter, matching the TUI's Install default", async () => {
    questionMock.mockResolvedValueOnce("");
    const { createPrompter } = await import("../src/cli/prompt.js");
    const prompter = createPrompter();

    const confirmed = await prompter.confirm("Install Honch?");

    expect(confirmed).toBe(true);
    expect(questionMock.mock.calls[0][0]).toContain("[Y/n]");
  });

  it("treats an explicit 'n' as decline", async () => {
    questionMock.mockResolvedValueOnce("n");
    const { createPrompter } = await import("../src/cli/prompt.js");
    const prompter = createPrompter();

    await expect(prompter.confirm("Install Honch?")).resolves.toBe(false);
  });
});
