/** Shared text helpers for the wizard. */

/** Trailing path segment of a file path (its "base name"), tolerant of trailing
 * slashes; falls back to the input when there's nothing after the last slash. */
export function basename(filePath: string): string {
  return filePath.replace(/\/+$/, "").split("/").pop() || filePath;
}
