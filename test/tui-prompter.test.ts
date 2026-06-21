import { describe, expect, it } from "vitest";
import { TuiPrompter } from "../src/cli/prompt.js";

describe("TuiPrompter", () => {
  it("turns a select() call into a selectable TUI prompt", async () => {
    const prompter = new TuiPrompter({
      targetProject: "/tmp/client",
      platformApi: "https://app.honch.io",
    });

    const answer = prompter.select({
      title: "Select your SDK",
      message: "Which SDK should I set up?",
      options: [
        { label: "ESP-IDF", value: "esp-idf" },
        { label: "C/POSIX", value: "c-posix" },
      ],
    });
    const prompt = prompter.getSnapshot().currentPrompt;

    expect(prompt?.kind).toBe("select");
    expect(prompt?.title).toBe("Select your SDK");
    expect(prompt?.options.map((option) => option.value)).toEqual([
      "esp-idf",
      "c-posix",
    ]);

    prompter.answer("c-posix");
    await expect(answer).resolves.toBe("c-posix");
  });

  it("carries the badge and default value through select()", () => {
    const prompter = new TuiPrompter({});

    void prompter.select({
      title: "Detected SDK",
      message: "Use it, or pick a different SDK?",
      defaultValue: "micropython",
      options: [
        { label: "Use MicroPython", value: "micropython", badge: "(detected)" },
        { label: "Choose a different SDK", value: "__other__" },
      ],
    });
    const prompt = prompter.getSnapshot().currentPrompt;

    expect(prompt?.defaultValue).toBe("micropython");
    expect(prompt?.options.find((o) => o.value === "micropython")?.badge).toBe(
      "(detected)",
    );
  });

  it("tracks progress and summary state for the app", () => {
    const prompter = new TuiPrompter({
      targetProject: "/tmp/client",
      platformApi: "https://app.honch.io",
    });

    prompter.setStep("scan", "reading project files");
    prompter.setSummary({ sdkTarget: "ESP-IDF" });
    prompter.completeStep("scan", "detected ESP-IDF");

    const snapshot = prompter.getSnapshot();

    expect(snapshot.summary.sdkTarget).toBe("ESP-IDF");
    expect(snapshot.steps.find((step) => step.id === "scan")).toMatchObject({
      status: "done",
      detail: "detected ESP-IDF",
    });
  });

  it("keeps a multiline run message as one block under a single marker", () => {
    const prompter = new TuiPrompter({});

    prompter.addRunMessage("Edit main/app_main.c\nhonch_init(&config);");

    expect(
      prompter.getSnapshot().runMessages.map((message) => message.text),
    ).toEqual(["Edit main/app_main.c\nhonch_init(&config);"]);
  });

  it("collapses an exact consecutive duplicate run message", () => {
    const prompter = new TuiPrompter({});

    prompter.addRunMessage("Reading CMakeLists.txt", "tool");
    prompter.addRunMessage("Reading CMakeLists.txt", "tool");

    expect(prompter.getSnapshot().runMessages).toHaveLength(1);
  });

  it("accumulates usage tokens and resets them on a new step", () => {
    const prompter = new TuiPrompter({});

    prompter.addUsage(128);
    prompter.addUsage(72);
    expect(prompter.getSnapshot().usageTokens).toBe(200);

    prompter.setStep("agent");
    expect(prompter.getSnapshot().usageTokens).toBe(0);
  });

  it("marks sensitive questions as password prompts", async () => {
    const prompter = new TuiPrompter({});

    const answer = prompter.question("Password:", { sensitive: true });

    expect(prompter.getSnapshot().currentPrompt?.kind).toBe("password");

    prompter.answer("secret");
    await expect(answer).resolves.toBe("secret");
  });

  it("rejects a pending prompt when cancelled", async () => {
    const prompter = new TuiPrompter({});

    const answer = prompter.question("Email:");
    prompter.cancel("Wizard cancelled");

    await expect(answer).rejects.toThrow("Wizard cancelled");
    expect(prompter.getSnapshot().currentPrompt).toBeUndefined();
    expect(prompter.getSnapshot().cancelled).toBe(true);
  });
});
