import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseOptions } from "../src/cli/options.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "honch-options-"));
  tempDirs.push(dir);
  return dir;
}

function writeTempConfig(dir: string, config: Record<string, unknown>) {
  writeFileSync(
    path.join(dir, "honch.config.json"),
    JSON.stringify(config, null, 2),
  );
}

function writeConfigAt(filePath: string, config: Record<string, unknown>) {
  writeFileSync(filePath, JSON.stringify(config, null, 2));
}

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

  describe("config file layering", () => {
    it("config supplies target when no flag or env var is set", () => {
      const dir = makeTempDir();
      writeTempConfig(dir, { target: "micropython" });

      const options = parseOptions(["--install-dir", dir], {});

      expect(options.target).toBe("micropython");
    });

    it("a --target flag overrides config", () => {
      const dir = makeTempDir();
      writeTempConfig(dir, { target: "micropython" });

      const options = parseOptions(
        ["--install-dir", dir, "--target", "esp-idf"],
        {},
      );

      expect(options.target).toBe("esp-idf");
    });

    it("an env var overrides config, and a flag overrides the env var", () => {
      const dir = makeTempDir();
      writeTempConfig(dir, { target: "micropython" });

      const withEnv = parseOptions(["--install-dir", dir], {
        HONCH_WIZARD_TARGET: "c-posix",
      });
      expect(withEnv.target).toBe("c-posix");

      const withFlag = parseOptions(
        ["--install-dir", dir, "--target", "arduino"],
        { HONCH_WIZARD_TARGET: "c-posix" },
      );
      expect(withFlag.target).toBe("arduino");
    });

    it("config supplies apiBaseUrl when no flag or env var is set", () => {
      const dir = makeTempDir();
      writeTempConfig(dir, { apiBaseUrl: "https://staging.honch.io" });

      const options = parseOptions(["--install-dir", dir], {});

      expect(options.apiBaseUrl).toBe("https://staging.honch.io");
    });

    it("an env var overrides a config apiBaseUrl", () => {
      const dir = makeTempDir();
      writeTempConfig(dir, { apiBaseUrl: "https://staging.honch.io" });

      const options = parseOptions(["--install-dir", dir], {
        HONCH_WIZARD_API_BASE_URL: "https://env.honch.io",
      });

      expect(options.apiBaseUrl).toBe("https://env.honch.io");
    });

    it("an env var overrides a config deviceModel", () => {
      const dir = makeTempDir();
      writeTempConfig(dir, { deviceModel: "ConfigCam" });

      const options = parseOptions(["--install-dir", dir], {
        HONCH_WIZARD_DEVICE_MODEL: "EnvCam",
      });

      expect(options.deviceModel).toBe("EnvCam");
    });

    it("config apiBaseUrl is overridden by flag", () => {
      const dir = makeTempDir();
      writeTempConfig(dir, { apiBaseUrl: "https://staging.honch.io" });

      const options = parseOptions(
        ["--install-dir", dir, "--api-base-url", "https://custom.honch.io"],
        {},
      );

      expect(options.apiBaseUrl).toBe("https://custom.honch.io");
    });

    it("config supplies deviceModel and projectName when not in flags or env", () => {
      const dir = makeTempDir();
      writeTempConfig(dir, {
        deviceModel: "ActionCam",
        projectName: "MyCam",
      });

      const options = parseOptions(["--install-dir", dir], {});

      expect(options.deviceModel).toBe("ActionCam");
      expect(options.projectName).toBe("MyCam");
    });

    it("--config flag overrides the config file location", () => {
      const dir = makeTempDir();
      const configPath = path.join(dir, "custom-config.json");
      writeConfigAt(configPath, { target: "c-posix" });
      // no honch.config.json in installDir — only the custom path should be read
      const installDir = makeTempDir();

      const options = parseOptions(
        ["--install-dir", installDir, "--config", configPath],
        {},
      );

      expect(options.target).toBe("c-posix");
    });

    it("HONCH_WIZARD_CONFIG env overrides the config file location", () => {
      const dir = makeTempDir();
      const configPath = path.join(dir, "env-config.json");
      writeConfigAt(configPath, { target: "react-native-relay" });
      const installDir = makeTempDir();

      const options = parseOptions(["--install-dir", installDir], {
        HONCH_WIZARD_CONFIG: configPath,
      });

      expect(options.target).toBe("react-native-relay");
    });

    it("--config flag overrides HONCH_WIZARD_CONFIG env", () => {
      const dir = makeTempDir();
      const flagConfigPath = path.join(dir, "flag-config.json");
      const envConfigPath = path.join(dir, "env-config.json");
      writeConfigAt(flagConfigPath, { target: "c-posix" });
      writeConfigAt(envConfigPath, { target: "micropython" });
      const installDir = makeTempDir();

      const options = parseOptions(
        ["--install-dir", installDir, "--config", flagConfigPath],
        { HONCH_WIZARD_CONFIG: envConfigPath },
      );

      expect(options.target).toBe("c-posix");
    });
  });
});
