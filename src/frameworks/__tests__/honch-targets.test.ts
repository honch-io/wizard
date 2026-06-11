import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HONCH_TARGETS } from '@frameworks/honch-targets';
import { Integration } from '@lib/constants';

function target(id: Integration) {
  const config = HONCH_TARGETS.find((t) => t.metadata.integration === id);
  if (!config) throw new Error(`missing target: ${id}`);
  return config;
}

function detects(id: Integration, dir: string): Promise<boolean> {
  return target(id).detection.detect({ installDir: dir } as never);
}

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'honch-detect-'));
}

describe('HONCH_TARGETS set', () => {
  it('ships exactly the firmware targets and the React Native relay', () => {
    const ids = HONCH_TARGETS.map((t) => t.metadata.integration).sort();
    expect(ids).toEqual(
      [
        Integration.espIdf,
        Integration.arduino,
        Integration.cPosix,
        Integration.micropython,
        Integration.reactNativeRelay,
      ].sort(),
    );
  });

  it('has no native iOS/Android App SDK target (no such SDK exists)', () => {
    const labels = HONCH_TARGETS.map((t) => t.metadata.name.toLowerCase());
    for (const config of HONCH_TARGETS) {
      expect(config.metadata.integration).not.toBe('ios-swift');
      expect(config.metadata.integration).not.toBe('android-kotlin');
    }
    expect(labels.some((l) => l.includes('ios') || l.includes('android'))).toBe(
      false,
    );
  });
});

describe('arduino detection', () => {
  it('detects a .ino sketch at the project root', async () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'blink.ino'), 'void setup(){} void loop(){}');
    expect(await detects(Integration.arduino, dir)).toBe(true);
  });

  it('detects a .ino sketch one directory deep', async () => {
    const dir = tempProject();
    mkdirSync(join(dir, 'MySketch'));
    writeFileSync(join(dir, 'MySketch', 'MySketch.ino'), '// sketch');
    expect(await detects(Integration.arduino, dir)).toBe(true);
  });

  it('detects a PlatformIO arduino-framework project', async () => {
    const dir = tempProject();
    writeFileSync(
      join(dir, 'platformio.ini'),
      '[env:esp32dev]\nplatform = espressif32\nframework = arduino\n',
    );
    expect(await detects(Integration.arduino, dir)).toBe(true);
  });

  it('does not fire on an ESP-IDF project, and ESP-IDF wins it', async () => {
    const dir = tempProject();
    writeFileSync(
      join(dir, 'CMakeLists.txt'),
      'include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n',
    );
    writeFileSync(join(dir, 'sdkconfig.defaults'), 'CONFIG_X=y\n');
    expect(await detects(Integration.arduino, dir)).toBe(false);
    expect(await detects(Integration.espIdf, dir)).toBe(true);
  });

  it('does not let an Arduino sketch be claimed by esp-idf or c-posix', async () => {
    const dir = tempProject();
    writeFileSync(
      join(dir, 'sketch.yaml'),
      'default_fqbn: esp32:esp32:esp32\n',
    );
    expect(await detects(Integration.arduino, dir)).toBe(true);
    expect(await detects(Integration.espIdf, dir)).toBe(false);
    expect(await detects(Integration.cPosix, dir)).toBe(false);
  });
});

describe('react-native-relay agent context', () => {
  const lines =
    target(Integration.reactNativeRelay).prompts.getAdditionalContextLines?.(
      {},
    ) ?? [];
  const text = lines.join('\n');

  it('warns the invented relay options do not exist', () => {
    // The only mentions of these names must be in a "there is no …" warning,
    // never presented as valid config keys.
    expect(text).toContain('no bleNative/frameEvents option');
    expect(text).toContain('no subscribeNativeFrames()');
  });

  it('presents the real createMobileRelay three-key shape', () => {
    expect(text).toContain(
      'createMobileRelay({ durableStore, uploaderConfig, schedulerNative })',
    );
    expect(text).toContain('receiveFrame(deviceId, frameBytes');
    // The full RelayUploaderConfig must be spelled out, not just two fields.
    expect(text).toContain('relaySdkPlatform');
    expect(text).toContain('messageId(message)');
  });
});
