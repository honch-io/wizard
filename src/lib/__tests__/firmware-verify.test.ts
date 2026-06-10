import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CommandResult,
  type CommandRunner,
  verifyFirmwareInstall,
} from '@lib/firmware-verify';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'honch-verify-'));
}

function makeRunner(handler: (file: string, args: string[]) => CommandResult): {
  run: CommandRunner;
  calls: string[];
} {
  const calls: string[] = [];
  const run: CommandRunner = (file, args) => {
    calls.push([file, ...args].join(' '));
    return handler(file, args);
  };
  return { run, calls };
}

const ok = (output = ''): CommandResult => ({ ok: true, output });
const fail = (output: string): CommandResult => ({ ok: false, output });

describe('verifyFirmwareInstall — esp-idf', () => {
  it('reconfigures when idf.py is present', () => {
    const { run, calls } = makeRunner(() => ok('done'));
    const outcomes = verifyFirmwareInstall('esp-idf', '/tmp/p', run);

    expect(outcomes[0]).toMatchObject({ status: 'passed' });
    expect(calls).toContain('idf.py reconfigure');
  });

  it('reports a pending step when idf.py is missing', () => {
    const { run } = makeRunner((file) =>
      file === 'idf.py' ? fail('not found') : ok(),
    );
    const outcomes = verifyFirmwareInstall('esp-idf', '/tmp/p', run);

    expect(outcomes[0].status).toBe('pending');
    expect(outcomes[0].detail).toContain('idf.py');
  });

  it('fails when sdkconfig has an empty CONFIG_HONCH_API_KEY', () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'sdkconfig'), 'CONFIG_HONCH_API_KEY=""\n');
    const { run } = makeRunner(() => fail('no idf'));

    const outcomes = verifyFirmwareInstall('esp-idf', dir, run);
    const keyCheck = outcomes.find((o) => o.label === 'ESP-IDF Honch key');

    expect(keyCheck?.status).toBe('failed');
    expect(keyCheck?.detail).toContain('empty CONFIG_HONCH_API_KEY');
  });

  it('passes the key check when sdkconfig has a non-empty key', () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'sdkconfig'), 'CONFIG_HONCH_API_KEY="honch_x"\n');
    const { run } = makeRunner(() => ok());

    const keyCheck = verifyFirmwareInstall('esp-idf', dir, run).find(
      (o) => o.label === 'ESP-IDF Honch key',
    );
    expect(keyCheck?.status).toBe('passed');
  });
});

describe('verifyFirmwareInstall — c-posix', () => {
  it('configures with cmake when CMakeLists is present', () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'CMakeLists.txt'), 'project(app C)\n');
    const { run, calls } = makeRunner(() => ok('-- Configuring done'));

    const [check] = verifyFirmwareInstall('c-posix', dir, run);

    expect(check.status).toBe('passed');
    expect(
      calls.some((c) => c.startsWith('cmake -S ') && c.includes(' -B ')),
    ).toBe(true);
  });

  it('surfaces a failed configure with the last output line', () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'CMakeLists.txt'), 'project(app C)\n');
    const { run } = makeRunner((file, args) =>
      file === 'cmake' && args[0] === '--version'
        ? ok('cmake version 3.30')
        : fail('CMake Error: honch_posix not found\n'),
    );

    const [check] = verifyFirmwareInstall('c-posix', dir, run);

    expect(check.status).toBe('failed');
    expect(check.detail).toContain('honch_posix not found');
  });

  it('is pending when there is no CMakeLists', () => {
    const dir = tempProject();
    const { run } = makeRunner(() => ok());

    expect(verifyFirmwareInstall('c-posix', dir, run)[0].status).toBe(
      'pending',
    );
  });
});

describe('verifyFirmwareInstall — micropython', () => {
  it('syntax-checks python sources and notes the firmware build', () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'boot.py'), "print('boot')\n");
    const { run, calls } = makeRunner(() => ok());

    const outcomes = verifyFirmwareInstall('micropython', dir, run);

    expect(outcomes.map((o) => o.status)).toEqual(['passed', 'pending']);
    expect(calls.some((c) => c.includes('py_compile boot.py'))).toBe(true);
    expect(outcomes[1].detail).toContain('firmware');
  });

  it('reports pending checks when no python interpreter is available', () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'main.py'), "print('main')\n");
    const { run } = makeRunner(() => fail('not found'));

    const outcomes = verifyFirmwareInstall('micropython', dir, run);

    expect(outcomes[0].status).toBe('pending');
    expect(outcomes[0].detail).toContain('py_compile');
  });
});

describe('verifyFirmwareInstall — non-firmware', () => {
  it('returns no checks for mobile targets', () => {
    expect(
      verifyFirmwareInstall('react-native-relay', '/tmp/p', () => ok()),
    ).toEqual([]);
  });
});
