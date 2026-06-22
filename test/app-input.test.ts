import { describe, expect, it } from "vitest";
import { editText } from "../src/ui/App.js";

const key = (
  over: Partial<{
    leftArrow: boolean;
    rightArrow: boolean;
    backspace: boolean;
    delete: boolean;
    ctrl: boolean;
    meta: boolean;
  }> = {},
) => ({
  leftArrow: false,
  rightArrow: false,
  backspace: false,
  delete: false,
  ctrl: false,
  meta: false,
  ...over,
});

describe("editText", () => {
  it("inserts a character at the cursor, not just the end", () => {
    expect(editText({ value: "ac", cursor: 1 }, key(), "b")).toEqual({
      value: "abc",
      cursor: 2,
    });
  });

  it("moves the cursor left and right within bounds", () => {
    expect(
      editText({ value: "abc", cursor: 2 }, key({ leftArrow: true }), ""),
    ).toEqual({
      value: "abc",
      cursor: 1,
    });
    expect(
      editText({ value: "abc", cursor: 0 }, key({ leftArrow: true }), ""),
    ).toEqual({
      value: "abc",
      cursor: 0,
    });
    expect(
      editText({ value: "abc", cursor: 3 }, key({ rightArrow: true }), ""),
    ).toEqual({
      value: "abc",
      cursor: 3,
    });
  });

  it("backspaces the character before the cursor", () => {
    expect(
      editText({ value: "abc", cursor: 2 }, key({ backspace: true }), ""),
    ).toEqual({
      value: "ac",
      cursor: 1,
    });
    // At the start there's nothing to delete.
    expect(
      editText({ value: "abc", cursor: 0 }, key({ backspace: true }), ""),
    ).toEqual({
      value: "abc",
      cursor: 0,
    });
  });

  it("treats delete like backspace (terminals disagree on which Backspace sends)", () => {
    expect(
      editText({ value: "abc", cursor: 2 }, key({ delete: true }), ""),
    ).toEqual({
      value: "ac",
      cursor: 1,
    });
  });

  it("clears the whole field on ctrl+u", () => {
    expect(
      editText({ value: "abc", cursor: 3 }, key({ ctrl: true }), "u"),
    ).toEqual({
      value: "",
      cursor: 0,
    });
  });

  it("ignores other ctrl/meta combos and empty input", () => {
    const state = { value: "abc", cursor: 1 };
    expect(editText(state, key({ ctrl: true }), "a")).toEqual(state);
    expect(editText(state, key({ meta: true }), "x")).toEqual(state);
    expect(editText(state, key(), "")).toEqual(state);
  });
});
