import { describe, expect, it } from "vitest";
import { isTerminalTooSmall, MIN_TERMINAL } from "../src/ui/App.js";

describe("isTerminalTooSmall", () => {
  it("is false at exactly the minimum", () => {
    expect(isTerminalTooSmall(MIN_TERMINAL.width, MIN_TERMINAL.height)).toBe(
      false,
    );
  });

  it("is false for a comfortably large terminal", () => {
    expect(isTerminalTooSmall(120, 40)).toBe(false);
  });

  it("is true when the width is below the minimum", () => {
    expect(isTerminalTooSmall(MIN_TERMINAL.width - 1, 40)).toBe(true);
  });

  it("is true when the height is below the minimum", () => {
    expect(isTerminalTooSmall(120, MIN_TERMINAL.height - 1)).toBe(true);
  });
});
