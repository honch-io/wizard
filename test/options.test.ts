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

  it("parses local project credentials for offline report testing", () => {
    const options = parseOptions(
      [
        "--project-name",
        "Camera",
        "--project-api-key",
        "honch_test",
        "--device-model",
        "ActionCam",
      ],
      {},
    );

    expect(options.projectName).toBe("Camera");
    expect(options.projectApiKey).toBe("honch_test");
    expect(options.deviceModel).toBe("ActionCam");
  });

  it("runs the agent by default and opts out with --dry-run", () => {
    expect(parseOptions([], {}).runAgent).toBe(true);
    expect(parseOptions(["--dry-run"], {}).runAgent).toBe(false);
    expect(parseOptions(["-n"], {}).runAgent).toBe(false);
    expect(parseOptions([], { HONCH_WIZARD_DRY_RUN: "1" }).runAgent).toBe(
      false,
    );
  });
});
