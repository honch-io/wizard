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

  it("does not accept a static firmware version from flags or environment", () => {
    expect(
      parseOptions(["--firmware-version", "1.2.3"], {}),
    ).not.toHaveProperty("firmwareVersion");
    expect(
      parseOptions([], { HONCH_WIZARD_FIRMWARE_VERSION: "1.2.3" }),
    ).not.toHaveProperty("firmwareVersion");
  });

  it("runs the agent by default and opts out with --dry-run", () => {
    expect(parseOptions([], {}).runAgent).toBe(true);
    expect(parseOptions(["--dry-run"], {}).runAgent).toBe(false);
    expect(parseOptions(["-n"], {}).runAgent).toBe(false);
    expect(parseOptions([], { HONCH_WIZARD_DRY_RUN: "1" }).runAgent).toBe(
      false,
    );
  });

  describe("flag / env / default precedence", () => {
    it("falls back to env vars when no flag is set", () => {
      const options = parseOptions([], {
        HONCH_WIZARD_TARGET: "c-posix",
        HONCH_WIZARD_API_BASE_URL: "https://env.honch.io",
        HONCH_WIZARD_DEVICE_MODEL: "EnvCam",
        HONCH_WIZARD_PROJECT_NAME: "EnvCam project",
      });

      expect(options.target).toBe("c-posix");
      expect(options.apiBaseUrl).toBe("https://env.honch.io");
      expect(options.deviceModel).toBe("EnvCam");
      expect(options.projectName).toBe("EnvCam project");
    });

    it("a flag overrides the env var", () => {
      const options = parseOptions(
        [
          "--target",
          "arduino",
          "--api-base-url",
          "https://custom.honch.io",
          "--device-model",
          "FlagCam",
        ],
        {
          HONCH_WIZARD_TARGET: "c-posix",
          HONCH_WIZARD_API_BASE_URL: "https://env.honch.io",
          HONCH_WIZARD_DEVICE_MODEL: "EnvCam",
        },
      );

      expect(options.target).toBe("arduino");
      expect(options.apiBaseUrl).toBe("https://custom.honch.io");
      expect(options.deviceModel).toBe("FlagCam");
    });

    it("apiBaseUrl defaults to production when nothing is set", () => {
      expect(parseOptions([], {}).apiBaseUrl).toBe("https://api.honch.io");
    });

    it("target and deviceModel are undefined when neither flag nor env is set", () => {
      const options = parseOptions([], {});
      expect(options.target).toBeUndefined();
      expect(options.deviceModel).toBeUndefined();
    });
  });
});
