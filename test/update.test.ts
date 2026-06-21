import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commandString, getUpdateAction } from "../src/update/action.js";
import {
  dismissVersion,
  readVersionInfo,
  writeVersionInfo,
} from "../src/update/cache.js";
import { getUpgradeVersion } from "../src/update/check.js";
import {
  isNewer,
  isSourceBuildVersion,
  parseVersion,
} from "../src/update/version.js";

describe("version comparison", () => {
  it("compares plain semver", () => {
    expect(isNewer("2.1.3", "2.1.2")).toBe(true);
    expect(isNewer("2.2.0", "2.1.9")).toBe(true);
    expect(isNewer("3.0.0", "2.9.9")).toBe(true);
    expect(isNewer("2.1.2", "2.1.2")).toBe(false);
    expect(isNewer("2.1.1", "2.1.2")).toBe(false);
  });

  it("never treats a prerelease as newer", () => {
    expect(isNewer("2.2.0-beta.1", "2.1.0")).toBe(false);
    expect(parseVersion("2.2.0-beta.1")).toBeNull();
  });

  it("flags unparseable / source builds", () => {
    expect(isSourceBuildVersion("0.0.0")).toBe(true);
    expect(isSourceBuildVersion("nonsense")).toBe(true);
    expect(isSourceBuildVersion("2.1.2")).toBe(false);
  });
});

describe("install-method detection", () => {
  afterEach(() => {
    delete process.env.HONCH_UPDATE_ACTION;
  });

  it("maps the running path to a package manager", () => {
    expect(
      getUpdateAction("/usr/local/lib/node_modules/@honch/start/dist/bin.mjs")
        ?.manager,
    ).toBe("npm");
    expect(
      getUpdateAction(
        "/Users/x/.bun/install/global/node_modules/@honch/start/dist/bin.mjs",
      )?.manager,
    ).toBe("bun");
    expect(
      getUpdateAction(
        "/Users/x/Library/pnpm/global/5/node_modules/@honch/start/dist/bin.mjs",
      )?.manager,
    ).toBe("pnpm");
  });

  it("returns null for a dev/local run", () => {
    expect(
      getUpdateAction(
        "/Users/x/Development/honch-io/honcho-wizard/dist/bin.mjs",
      ),
    ).toBeNull();
  });

  it("honors the HONCH_UPDATE_ACTION override and builds the command", () => {
    process.env.HONCH_UPDATE_ACTION = "npm";
    const action = getUpdateAction("/wherever/dist/bin.mjs");
    if (!action) throw new Error("expected an update action");
    expect(action.manager).toBe("npm");
    expect(commandString(action)).toBe("npm install -g @honch/start@latest");
  });
});

describe("update cache", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "honch-update-"));
    process.env.HONCH_WIZARD_VERSION_FILE = path.join(dir, "version.json");
  });

  afterEach(() => {
    delete process.env.HONCH_WIZARD_VERSION_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips version info and records dismissals", () => {
    writeVersionInfo({
      latestVersion: "2.2.0",
      lastCheckedAt: "2026-06-21T00:00:00.000Z",
    });
    expect(readVersionInfo()?.latestVersion).toBe("2.2.0");

    dismissVersion("2.2.0");
    const info = readVersionInfo();
    expect(info?.dismissedVersion).toBe("2.2.0");
    expect(info?.latestVersion).toBe("2.2.0");
  });
});

describe("getUpgradeVersion", () => {
  let dir: string;
  const action = {
    manager: "npm" as const,
    command: "npm",
    args: ["install", "-g", "@honch/start@latest"],
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "honch-update-"));
    process.env.HONCH_WIZARD_VERSION_FILE = path.join(dir, "version.json");
  });

  afterEach(() => {
    delete process.env.HONCH_WIZARD_VERSION_FILE;
    delete process.env.HONCH_NO_UPDATE_CHECK;
    rmSync(dir, { recursive: true, force: true });
  });

  it("offers a newer, non-dismissed version", async () => {
    const result = await getUpgradeVersion({
      currentVersion: "2.1.2",
      action,
      now: 1_000_000,
      fetchLatest: async () => "2.1.3",
    });
    expect(result).toEqual({ latestVersion: "2.1.3", action });
  });

  it("stays silent when already current", async () => {
    const result = await getUpgradeVersion({
      currentVersion: "2.1.3",
      action,
      now: 1_000_000,
      fetchLatest: async () => "2.1.3",
    });
    expect(result).toBeNull();
  });

  it("respects a skipped (dismissed) version", async () => {
    writeVersionInfo({
      latestVersion: "2.1.3",
      lastCheckedAt: new Date(1_000_000).toISOString(),
      dismissedVersion: "2.1.3",
    });
    const result = await getUpgradeVersion({
      currentVersion: "2.1.2",
      action,
      now: 1_000_000,
      fetchLatest: async () => "2.1.3",
    });
    expect(result).toBeNull();
  });

  it("uses the cache and skips the network when checked recently", async () => {
    const now = 50_000_000;
    writeVersionInfo({
      latestVersion: "2.1.3",
      lastCheckedAt: new Date(now).toISOString(),
    });
    let fetched = false;
    const result = await getUpgradeVersion({
      currentVersion: "2.1.2",
      action,
      now,
      fetchLatest: async () => {
        fetched = true;
        return "9.9.9";
      },
    });
    expect(fetched).toBe(false);
    expect(result?.latestVersion).toBe("2.1.3");
  });

  it("returns null when the check is disabled or no manager is detected", async () => {
    process.env.HONCH_NO_UPDATE_CHECK = "1";
    expect(
      await getUpgradeVersion({
        currentVersion: "2.1.2",
        action,
        now: 1,
        fetchLatest: async () => "2.1.3",
      }),
    ).toBeNull();
    delete process.env.HONCH_NO_UPDATE_CHECK;

    expect(
      await getUpgradeVersion({
        currentVersion: "2.1.2",
        action: null,
        now: 1,
        fetchLatest: async () => "2.1.3",
      }),
    ).toBeNull();
  });
});
