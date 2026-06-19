import { spawn } from "node:child_process";

export type OpenCommand = {
  command: string;
  args: string[];
};

export function openReportCommand(
  reportPath: string,
  platform: NodeJS.Platform = process.platform,
): OpenCommand {
  if (platform === "darwin") return { command: "open", args: [reportPath] };
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", reportPath] };
  }
  return { command: "xdg-open", args: [reportPath] };
}

export function openReport(reportPath: string): void {
  const { command, args } = openReportCommand(reportPath);
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The report path remains visible in the terminal for manual opening.
  }
}
