/**
 * Wizard-side build verification for firmware targets.
 *
 * The agent's Bash allowlist (wizardCanUseTool) only permits package-manager
 * and build/lint scripts — it cannot run idf.py / cmake / make. So for firmware
 * targets the wizard runs a conservative, non-flash build check itself after the
 * agent finishes, records the outcome in the setup report, and (for ESP-IDF)
 * guards against a built sdkconfig that still has an empty CONFIG_HONCH_API_KEY.
 *
 * Each check probes for the toolchain first; when it is absent the wizard
 * records the exact command to run rather than failing the install. A failed
 * check is reported, not fatal — it may reflect a pre-existing project issue.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

export type VerificationStatus = 'passed' | 'failed' | 'pending';

export interface VerificationOutcome {
  label: string;
  status: VerificationStatus;
  detail: string;
}

export interface CommandResult {
  ok: boolean;
  output: string;
}

export type CommandRunner = (
  file: string,
  args: string[],
  options: { cwd: string },
) => CommandResult;

const VERIFIERS: Record<
  string,
  (
    installDir: string,
    run: CommandRunner,
    expectedApiKey?: string,
  ) => VerificationOutcome[]
> = {
  'esp-idf': verifyEspIdf,
  arduino: verifyArduino,
  'c-posix': verifyCPosix,
  micropython: verifyMicroPython,
};

/**
 * Run the build verification for a firmware target. Returns an empty array for
 * non-firmware (mobile) targets, which the agent verifies through its own
 * allowed package-manager build scripts. `expectedApiKey`, when provided, lets
 * the ESP-IDF check confirm the built sdkconfig carries the provisioned key
 * rather than a stale leftover one.
 */
export function verifyFirmwareInstall(
  targetId: string,
  installDir: string,
  run: CommandRunner = runCommand,
  expectedApiKey?: string,
): VerificationOutcome[] {
  return VERIFIERS[targetId]?.(installDir, run, expectedApiKey) ?? [];
}

function verifyEspIdf(
  installDir: string,
  run: CommandRunner,
  expectedApiKey?: string,
): VerificationOutcome[] {
  const outcomes: VerificationOutcome[] = [];

  if (toolAvailable(run, installDir, 'idf.py')) {
    // reconfigure validates the component/build graph without a flash build.
    const result = run('idf.py', ['reconfigure'], { cwd: installDir });
    outcomes.push(
      outcome(
        'ESP-IDF reconfigure',
        result,
        'Run `idf.py build` for a full firmware build.',
      ),
    );
  } else {
    outcomes.push(
      pending(
        'ESP-IDF build',
        'idf.py not on PATH; run `. $IDF_PATH/export.sh` then `idf.py build` to verify the Honch wiring.',
      ),
    );
  }

  outcomes.push(...checkEspIdfApiKey(installDir, expectedApiKey));
  return outcomes;
}

/** Show enough of a honch_ key to identify it without dumping the full secret. */
function maskKey(key: string): string {
  return key.length <= 12 ? key : `${key.slice(0, 12)}…`;
}

/**
 * Guard the two ways a built sdkconfig ships the wrong key:
 *  - CONFIG_HONCH_API_KEY="" → honch_init() fails at runtime.
 *  - a non-empty key that is NOT the provisioned one → a stale sdkconfig was
 *    shadowing the wizard's value, so the device authenticates with the wrong
 *    project key and capture returns 401. This is the exact failure the wizard's
 *    sdkconfig reconciliation prevents; verify it actually stuck.
 * Surface either as a failed check so it is not silently shipped.
 */
function checkEspIdfApiKey(
  installDir: string,
  expectedApiKey?: string,
): VerificationOutcome[] {
  const sdkconfigPath = join(installDir, 'sdkconfig');
  if (!existsSync(sdkconfigPath)) return [];

  const value = readKconfigValue(sdkconfigPath, 'CONFIG_HONCH_API_KEY');
  if (value === null) {
    // A built sdkconfig with no CONFIG_HONCH_API_KEY symbol at all means the app
    // never declared it in a Kconfig (the SDK component ships none), so the
    // provisioned key was dropped as an unknown symbol and never reached the
    // firmware. Surface it instead of passing silently.
    return [
      {
        label: 'ESP-IDF Honch key',
        status: 'failed',
        detail:
          'sdkconfig has no CONFIG_HONCH_API_KEY symbol — the app did not declare it in a Kconfig (e.g. main/Kconfig.projbuild), so the provisioned key was discarded as unknown. Declare config HONCH_API_KEY / HONCH_HOST and run `idf.py reconfigure`.',
      },
    ];
  }
  if (value.length === 0) {
    return [
      {
        label: 'ESP-IDF Honch key',
        status: 'failed',
        detail:
          'sdkconfig has an empty CONFIG_HONCH_API_KEY — flashed firmware would fail honch_init(). Set the key before building.',
      },
    ];
  }
  if (expectedApiKey && value !== expectedApiKey) {
    return [
      {
        label: 'ESP-IDF Honch key',
        status: 'failed',
        detail: `sdkconfig CONFIG_HONCH_API_KEY (${maskKey(
          value,
        )}) does not match the provisioned project key (${maskKey(
          expectedApiKey,
        )}) — a stale sdkconfig is shadowing the wizard's key. Run \`idf.py reconfigure\` and confirm the key matches before flashing.`,
      },
    ];
  }
  return [
    {
      label: 'ESP-IDF Honch key',
      status: 'passed',
      detail: expectedApiKey
        ? 'sdkconfig key matches the provisioned project key.'
        : 'sdkconfig key set.',
    },
  ];
}

/**
 * Arduino ESP32 builds need a full board core (downloaded on demand, network +
 * minutes) and a flashable board, so the wizard does not run a compile itself —
 * it records the exact command for the user. PlatformIO and arduino-cli get
 * their own command; if neither is on PATH we still surface the PlatformIO one
 * as the common default.
 */
function verifyArduino(
  installDir: string,
  run: CommandRunner,
): VerificationOutcome[] {
  const isPlatformIo = existsSync(join(installDir, 'platformio.ini'));
  if (isPlatformIo) {
    return [
      pending(
        'Arduino ESP32 build',
        toolAvailable(run, installDir, 'pio')
          ? 'Run `pio run` to compile the sketch against the Honch wiring.'
          : 'PlatformIO not on PATH; run `pio run` to compile the sketch against the Honch wiring.',
      ),
    ];
  }
  return [
    pending(
      'Arduino ESP32 build',
      'Run `arduino-cli compile --fqbn esp32:esp32:esp32 <sketch-dir>` to compile against the Honch wiring.',
    ),
  ];
}

function verifyCPosix(
  installDir: string,
  run: CommandRunner,
): VerificationOutcome[] {
  if (!existsSync(join(installDir, 'CMakeLists.txt'))) {
    return [
      pending(
        'C/POSIX build',
        "No CMakeLists.txt found; run the project's existing build or test command to verify.",
      ),
    ];
  }
  if (!toolAvailable(run, installDir, 'cmake')) {
    return [
      pending(
        'C/POSIX configure',
        'cmake not on PATH; run `cmake -S . -B build` to verify the Honch integration resolves.',
      ),
    ];
  }
  // Configure into an OS temp dir so the client project keeps no build artifacts.
  const buildDir = mkdtempSync(join(tmpdir(), 'honch-cmake-'));
  const result = run('cmake', ['-S', installDir, '-B', buildDir], {
    cwd: installDir,
  });
  return [
    outcome(
      'C/POSIX configure',
      result,
      'Run `cmake --build` to compile against the configured project.',
    ),
  ];
}

function verifyMicroPython(
  installDir: string,
  run: CommandRunner,
): VerificationOutcome[] {
  const firmwareNote = pending(
    'MicroPython firmware build',
    "The _honch_core C module builds with the firmware; run the port's `make` build to validate on-device.",
  );

  const sources = pythonSources(installDir);
  if (sources.length === 0) return [firmwareNote];

  const python = ['python3', 'python'].find((candidate) =>
    toolAvailable(run, installDir, candidate),
  );
  if (!python) {
    return [
      pending(
        'MicroPython syntax check',
        'No python interpreter on PATH; run `python -m py_compile` over the wrapper sources to verify.',
      ),
      firmwareNote,
    ];
  }

  const result = run(python, ['-m', 'py_compile', ...sources], {
    cwd: installDir,
  });
  return [
    outcome('MicroPython syntax check', result, 'Host syntax check only.'),
    firmwareNote,
  ];
}

function toolAvailable(
  run: CommandRunner,
  installDir: string,
  tool: string,
): boolean {
  return run(tool, ['--version'], { cwd: installDir }).ok;
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'build',
  'dist',
  '.venv',
  '__pycache__',
]);

function pythonSources(installDir: string): string[] {
  const found: string[] = [];
  collectPython(installDir, installDir, found, 0);
  return found.sort();
}

function collectPython(
  root: string,
  dir: string,
  found: string[],
  depth: number,
): void {
  if (depth > 2) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      collectPython(root, fullPath, found, depth + 1);
      continue;
    }
    if (entry.endsWith('.py')) found.push(relative(root, fullPath));
  }
}

function readKconfigValue(filePath: string, key: string): string | null {
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = new RegExp(`^${key}=(.*)$`).exec(line.trim());
    if (!match) continue;
    const raw = match[1].trim();
    if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
    return raw;
  }
  return null;
}

function outcome(
  label: string,
  result: CommandResult,
  passDetail: string,
): VerificationOutcome {
  if (result.ok) return { label, status: 'passed', detail: passDetail };
  return { label, status: 'failed', detail: lastLine(result.output) };
}

function pending(label: string, detail: string): VerificationOutcome {
  return { label, status: 'pending', detail };
}

function lastLine(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : 'command failed';
}

function runCommand(
  file: string,
  args: string[],
  options: { cwd: string },
): CommandResult {
  try {
    const output = execFileSync(file, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
    });
    return { ok: true, output };
  } catch (error) {
    const failure = error as Error & { stdout?: unknown; stderr?: unknown };
    const captured = [failure.stdout, failure.stderr]
      .map((value) => (typeof value === 'string' ? value : ''))
      .join('')
      .trim();
    return { ok: false, output: captured || failure.message };
  }
}
