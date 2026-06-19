import { describe, expect, it } from "vitest";
import {
  formatReportMarkdown,
  reportFooterHint,
  visibleReportLines,
} from "../src/ui/report-view.js";

describe("report view helpers", () => {
  const markdown = `# Honch Setup Report

## Summary

- SDK target: ESP-IDF
- Branch: \`honch/setup\`

## Verification

- dry run: no files modified
`;

  it("formats markdown into styled terminal lines", () => {
    const lines = formatReportMarkdown(markdown);

    expect(lines[0]).toMatchObject({ kind: "h1", text: "Honch Setup Report" });
    expect(lines.find((line) => line.text === "Summary")).toMatchObject({
      kind: "h2",
    });
    expect(
      lines.find((line) => line.text.includes("SDK target")),
    ).toMatchObject({
      kind: "bullet",
      segments: [{ text: "SDK target: ESP-IDF", code: false }],
    });
    expect(
      lines.find((line) => line.text.includes("Branch"))?.segments,
    ).toEqual([
      { text: "Branch: ", code: false },
      { text: "honch/setup", code: true },
    ]);
  });

  it("returns a scroll window and overflow counts", () => {
    const lines = formatReportMarkdown(markdown);
    const windowed = visibleReportLines(lines, 4, 1);

    expect(windowed.maxOffset).toBeGreaterThan(0);
    expect(windowed.before).toBeGreaterThan(0);
    expect(windowed.after).toBeGreaterThan(0);
    expect(windowed.lines).toHaveLength(4);
  });

  it("shows the report open key in the completed footer", () => {
    expect(reportFooterHint("/tmp/client/honch-setup-report.md")).toBe(
      "↑/↓ scroll · E open honch-setup-report.md · ctrl+c exit",
    );
  });
});
