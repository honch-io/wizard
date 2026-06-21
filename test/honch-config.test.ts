import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadHonchConfig,
  loadHonchConfigFromPath,
  writeHonchConfig,
} from "../src/config/honch-config.js";

let registryDir: string;

beforeEach(() => {
  // Point the project registry at a throwaway file so tests never touch the
  // real ~/.config/honch/projects.json.
  registryDir = mkdtempSync(path.join(tmpdir(), "honch-config-"));
  process.env.HONCH_WIZARD_PROJECTS_FILE = path.join(
    registryDir,
    "projects.json",
  );
});

afterEach(() => {
  delete process.env.HONCH_WIZARD_PROJECTS_FILE;
  rmSync(registryDir, { recursive: true, force: true });
});

describe("honch project registry", () => {
  it("write-then-load round-trips a project's config", () => {
    writeHonchConfig("/work/my-project", {
      target: "esp-idf",
      deviceModel: "H1",
      projectId: "p1",
    });

    expect(loadHonchConfig("/work/my-project")).toMatchObject({
      target: "esp-idf",
      deviceModel: "H1",
      projectId: "p1",
    });
  });

  it("keys entries by project path, so a different project is independent", () => {
    writeHonchConfig("/work/project-a", { target: "esp-idf" });
    writeHonchConfig("/work/project-b", { target: "c-posix" });

    expect(loadHonchConfig("/work/project-a")?.target).toBe("esp-idf");
    expect(loadHonchConfig("/work/project-b")?.target).toBe("c-posix");
    expect(loadHonchConfig("/work/never-seen")).toBeUndefined();
  });

  it("normalizes the project path when keying", () => {
    writeHonchConfig("/work/my-project", { target: "micropython" });
    expect(loadHonchConfig("/work/my-project/")?.target).toBe("micropython");
    expect(loadHonchConfig("/work/sub/../my-project")?.target).toBe(
      "micropython",
    );
  });

  it("returns undefined when no registry exists", () => {
    expect(loadHonchConfig("/work/my-project")).toBeUndefined();
  });

  it("returns undefined when the registry contains invalid JSON", () => {
    const file = process.env.HONCH_WIZARD_PROJECTS_FILE as string;
    writeFileSync(file, "not-valid-json");
    expect(loadHonchConfig("/work/my-project")).toBeUndefined();
  });

  it("reads an explicit standalone config file via loadHonchConfigFromPath", () => {
    const file = path.join(registryDir, "committed.json");
    writeFileSync(file, JSON.stringify({ target: "arduino" }));
    expect(loadHonchConfigFromPath(file)?.target).toBe("arduino");
    expect(
      loadHonchConfigFromPath(path.join(registryDir, "missing.json")),
    ).toBeUndefined();
  });
});
