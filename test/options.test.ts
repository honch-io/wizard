import { describe, expect, it } from "vitest";
import { parseOptions } from "../src/cli/options.js";

describe("parseOptions", () => {
  it("uses flags before environment defaults", () => {
    const options = parseOptions(
      ["--install-dir", "/tmp/client", "--target", "esp-idf", "--yes"],
      {
        HONCH_WIZARD_INSTALL_DIR: "/tmp/env",
        HONCH_WIZARD_TARGET: "c-posix",
      },
    );

    expect(options.installDir).toBe("/tmp/client");
    expect(options.target).toBe("esp-idf");
    expect(options.yes).toBe(true);
  });

  it("defaults to the current working directory", () => {
    const options = parseOptions([], {});

    expect(options.installDir).toBe(process.cwd());
    expect(options.yes).toBe(false);
  });
});
