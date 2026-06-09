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
  (installDir: string, run: CommandRunner) => VerificationOutcome[]
> = {
  'esp-idf': verifyEspIdf,
  'c-posix': verifyCPosix,
  micropython: verifyMicroPython,
};

/**
 * Run the build verification for a firmware target. Returns an empty array for
 * non-firmware (mobile) targets, which the agent verifies through its own
 * allowed package-manager build scripts.
 */
export function verifyFirmwareInstall(
  targetId: string,
  installDir: string,
  run: CommandRunner = runCommand,
): VerificationOutcome[] {
  return VERIFIERS[targetId]?.(installDir, run) ?? [];
}

function verifyEspIdf(
  installDir: string,
  run: CommandRunner,
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

  outcomes.push(...checkEspIdfApiKey(installDir));
  return outcomes;
}

/**
 * Guard the empty-key trap: a built sdkconfig with CONFIG_HONCH_API_KEY="" will
 * fail honch_init() at runtime. Surface it as a failed check so it is not
 * silently shipped.
 */
function checkEspIdfApiKey(installDir: string): VerificationOutcome[] {
  const sdkconfigPath = join(installDir, 'sdkconfig');
  if (!existsSync(sdkconfigPath)) return [];

  const value = readKconfigValue(sdkconfigPath, 'CONFIG_HONCH_API_KEY');
  if (value === null) return [];
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
  return [
    {
      label: 'ESP-IDF Honch key',
      status: 'passed',
      detail: 'sdkconfig key set.',
    },
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
