import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadHonchConfig,
  writeHonchConfig,
} from "../src/config/honch-config.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "honch-config-"));
  tempDirs.push(dir);
  return dir;
}

describe("honch config persistence", () => {
  it("write-then-load round-trips a config object", () => {
    const dir = makeTempDir();

    writeHonchConfig(dir, {
      target: "esp-idf",
      deviceModel: "H1",
      projectId: "p1",
    });

    expect(loadHonchConfig(dir)).toMatchObject({
      target: "esp-idf",
      deviceModel: "H1",
      projectId: "p1",
    });
  });

  it("returns undefined when no config file exists", () => {
    const dir = makeTempDir();
    expect(loadHonchConfig(dir)).toBeUndefined();
  });

  it("returns undefined when config file contains invalid JSON", () => {
    const dir = makeTempDir();
    writeFileSync(path.join(dir, "honch.config.json"), "not-valid-json");
    expect(loadHonchConfig(dir)).toBeUndefined();
  });
});
