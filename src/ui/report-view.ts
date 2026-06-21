import path from "node:path";

export type ReportSegment = {
  text: string;
  code: boolean;
};

export type ReportLine = {
  id: string;
  kind: "h1" | "h2" | "bullet" | "text" | "blank";
  text: string;
  segments: ReportSegment[];
};

export type ReportWindow = {
  lines: ReportLine[];
  before: number;
  after: number;
  maxOffset: number;
};

export function formatReportMarkdown(markdown: string): ReportLine[] {
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw, index): ReportLine => {
      const line = raw.trimEnd();
      const id = String(index);
      if (line.trim() === "") {
        return { id, kind: "blank", text: "", segments: [] };
      }
      if (line.startsWith("# ")) {
        const text = line.slice(2).trim();
        return { id, kind: "h1", text, segments: [{ text, code: false }] };
      }
      if (line.startsWith("## ")) {
        const text = line.slice(3).trim();
        return { id, kind: "h2", text, segments: [{ text, code: false }] };
      }
      if (line.startsWith("- ")) {
        const text = line.slice(2).trim();
        return { id, kind: "bullet", text, segments: inlineSegments(text) };
      }
      return { id, kind: "text", text: line, segments: inlineSegments(line) };
    });
}

export function visibleReportLines(
  lines: ReportLine[],
  height: number,
  offset: number,
): ReportWindow {
  const visible = Math.max(height, 1);
  const maxOffset = Math.max(lines.length - visible, 0);
  const clamped = Math.min(Math.max(offset, 0), maxOffset);
  const start = clamped;
  const end = Math.min(start + visible, lines.length);

  return {
    lines: lines.slice(start, end),
    before: start,
    after: Math.max(lines.length - end, 0),
    maxOffset,
  };
}

export function reportFooterHint(reportPath?: string, tempProject?: string) {
  // In Try mode, "E" opens the scratch project folder rather than the report.
  const target = tempProject
    ? path.basename(tempProject)
    : reportPath
      ? path.basename(reportPath)
      : "honch-setup-report.md";
  return `↑/↓ scroll · E open ${target} · q quit`;
}

function inlineSegments(line: string): ReportSegment[] {
  const parts = line.split("`");
  return parts
    .map((text, index) => ({ text, code: index % 2 === 1 }))
    .filter((segment) => segment.text.length > 0);
}
