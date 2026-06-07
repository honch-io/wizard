import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAuthSession, saveAuthSession } from "../src/auth/session.js";

const previousSessionFile = process.env.HONCH_WIZARD_SESSION_FILE;
const tempDirs: string[] = [];

afterEach(() => {
  process.env.HONCH_WIZARD_SESSION_FILE = previousSessionFile;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("auth session persistence", () => {
  it("loads a saved session for the same platform URL", () => {
    const sessionPath = useTempSessionFile();

    saveAuthSession({
      apiBaseUrl: "http://localhost:3001/",
      accessToken: "platform-jwt",
      email: "user@example.com",
    });

    expect(loadAuthSession("http://localhost:3001")).toMatchObject({
      apiBaseUrl: "http://localhost:3001",
      accessToken: "platform-jwt",
      email: "user@example.com",
    });
    expect(sessionPath.endsWith("session.json")).toBe(true);
  });

  it("ignores sessions saved for a different platform URL", () => {
    useTempSessionFile();

    saveAuthSession({
      apiBaseUrl: "https://app.honch.io",
      accessToken: "platform-jwt",
    });

    expect(loadAuthSession("http://localhost:3001")).toBeUndefined();
  });
});

function useTempSessionFile() {
  const dir = mkdtempSync(path.join(tmpdir(), "honcho-wizard-session-"));
  tempDirs.push(dir);
  const file = path.join(dir, "session.json");
  process.env.HONCH_WIZARD_SESSION_FILE = file;
  return file;
}
