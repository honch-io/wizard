import { describe, expect, it } from "vitest";
import { TuiPrompter } from "../src/cli/prompt.js";

describe("TuiPrompter", () => {
  it("turns workflow questions into selectable TUI prompts", async () => {
    const prompter = new TuiPrompter({
      targetProject: "/tmp/client",
      platformApi: "https://app.honch.io",
    });

    const answer = prompter.question(
      "SDK target (esp-idf, c-posix, micropython, arduino, react-native-relay):",
    );
    const prompt = prompter.getSnapshot().currentPrompt;

    expect(prompt?.kind).toBe("select");
    expect(prompt?.title).toBe("Choose SDK target");
    expect(prompt?.options.map((option) => option.value)).toEqual([
      "esp-idf",
      "c-posix",
      "micropython",
      "arduino",
      "react-native-relay",
    ]);

    prompter.answer("c-posix");
    await expect(answer).resolves.toBe("c-posix");
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

  it("splits multiline run messages for live agent output", () => {
    const prompter = new TuiPrompter({});

    prompter.addRunMessage("Edit main/app_main.c\nhonch_init(&config);");

    expect(
      prompter.getSnapshot().runMessages.map((message) => message.text),
    ).toEqual(["Edit main/app_main.c", "honch_init(&config);"]);
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
    expect(prompter.getSnapshot().error).toBe("Wizard cancelled");
  });
});
