import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FetchTarball,
  scaffoldStarter,
  starterAvailable,
} from "../src/scaffold/starter.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "honch-scaffold-"));
  tempDirs.push(dir);
  return dir;
}

/** Build a gzipped tarball shaped like GitHub's: a `<top>/<target>/...` tree. */
async function buildStartersTarball(): Promise<Uint8Array> {
  const src = makeTempDir();
  const top = "starters-test";
  mkdirSync(path.join(src, top, "esp-idf", "main"), { recursive: true });
  mkdirSync(path.join(src, top, "c-posix"), { recursive: true });
  writeFileSync(
    path.join(src, top, "esp-idf", "CMakeLists.txt"),
    "project(x)\n",
  );
  writeFileSync(
    path.join(src, top, "esp-idf", "main", "app_main.c"),
    "void app_main(void) {}\n",
  );
  writeFileSync(path.join(src, top, "c-posix", "main.c"), "int main(){}\n");

  const chunks: Buffer[] = [];
  for await (const chunk of createTar({ gzip: true, cwd: src }, [top])) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

describe("scaffoldStarter", () => {
  it("extracts only the target's folder into the install dir", async () => {
    const tarball = await buildStartersTarball();
    const fetchTarball: FetchTarball = async () => tarball;
    const installDir = makeTempDir();

    const result = await scaffoldStarter(installDir, "esp-idf", {
      fetchTarball,
      ref: "test",
    });

    // esp-idf files land at the project root (the two leading path components
    // are stripped); c-posix is excluded.
    expect(existsSync(path.join(installDir, "CMakeLists.txt"))).toBe(true);
    expect(existsSync(path.join(installDir, "main", "app_main.c"))).toBe(true);
    expect(existsSync(path.join(installDir, "main.c"))).toBe(false);
    expect(result.files.sort()).toEqual(["CMakeLists.txt", "main/app_main.c"]);
  });

  it("knows which targets have a starter", () => {
    expect(starterAvailable("esp-idf")).toBe(true);
    expect(starterAvailable("c-posix")).toBe(true);
    expect(starterAvailable("micropython")).toBe(true);
    expect(starterAvailable("arduino")).toBe(false);
    expect(starterAvailable("react-native-relay")).toBe(false);
  });

  it("rejects a target with no starter without fetching anything", async () => {
    let fetched = false;
    const fetchTarball: FetchTarball = async () => {
      fetched = true;
      return new Uint8Array();
    };
    const installDir = makeTempDir();

    await expect(
      scaffoldStarter(installDir, "arduino", { fetchTarball }),
    ).rejects.toThrow(/no starter/i);
    expect(fetched).toBe(false);
  });
});
