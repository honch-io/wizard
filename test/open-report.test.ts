import { describe, expect, it } from "vitest";
import { openReportCommand } from "../src/ui/open-report.js";

describe("openReportCommand", () => {
  it("uses the macOS opener", () => {
    expect(openReportCommand("/tmp/report.md", "darwin")).toEqual({
      command: "open",
      args: ["/tmp/report.md"],
    });
  });

  it("uses xdg-open on Linux", () => {
    expect(openReportCommand("/tmp/report.md", "linux")).toEqual({
      command: "xdg-open",
      args: ["/tmp/report.md"],
    });
  });

  it("uses cmd on Windows", () => {
    expect(openReportCommand("C:\\tmp\\report.md", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "C:\\tmp\\report.md"],
    });
  });
});
