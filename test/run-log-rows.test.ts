import { describe, expect, it } from "vitest";
import type { RunMessage, RunMessageKind } from "../src/cli/prompt.js";
import { messageRows } from "../src/ui/run-log.js";

const msg = (kind: RunMessageKind, text: string): RunMessage => ({
  id: 1,
  text,
  kind,
});

describe("messageRows", () => {
  it("counts a short status line as a single row", () => {
    expect(messageRows(msg("status", "ok"), 80)).toBe(1);
  });

  it("wraps a long tool line across multiple rows instead of clipping it", () => {
    // 4-char connector prefix + 100 chars over a width of 40 → 3 rows.
    expect(messageRows(msg("tool", "x".repeat(100)), 40)).toBe(3);
  });

  it("counts an assistant turn as a separator row plus its wrapped lines", () => {
    expect(messageRows(msg("assistant", "hello"), 80)).toBe(2);
    expect(messageRows(msg("assistant", `a\n${"b".repeat(85)}`), 80)).toBe(4);
  });
});
