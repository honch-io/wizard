import { describe, expect, it } from "vitest";
import { resolveKeyAction } from "../src/ui/App.js";

const key = (
  over: Partial<{ ctrl: boolean; escape: boolean; return: boolean }> = {},
) => ({
  ctrl: false,
  escape: false,
  return: false,
  ...over,
});

describe("resolveKeyAction", () => {
  it("does nothing when ESC is pressed during a prompt (no silent cancel)", () => {
    expect(
      resolveKeyAction(key({ escape: true }), "", {
        dismissable: false,
        installing: false,
        hasPrompt: true,
      }),
    ).toBe("none");
  });

  it("pauses (interrupts) when ESC is pressed during the agent run", () => {
    expect(
      resolveKeyAction(key({ escape: true }), "", {
        dismissable: false,
        installing: true,
        hasPrompt: false,
      }),
    ).toBe("interrupt");
  });

  it("cancels on ctrl+c during a live prompt", () => {
    expect(
      resolveKeyAction(key({ ctrl: true }), "c", {
        dismissable: false,
        installing: false,
        hasPrompt: true,
      }),
    ).toBe("cancel");
  });

  it("exits on ctrl+c on a terminal screen", () => {
    expect(
      resolveKeyAction(key({ ctrl: true }), "c", {
        dismissable: true,
        installing: false,
        hasPrompt: false,
      }),
    ).toBe("exit");
  });

  it("exits on enter or q on a terminal screen", () => {
    const state = { dismissable: true, installing: false, hasPrompt: false };
    expect(resolveKeyAction(key({ return: true }), "", state)).toBe("exit");
    expect(resolveKeyAction(key(), "q", state)).toBe("exit");
  });
});
