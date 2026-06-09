import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { basename, extname } from 'node:path';

import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import {
  DEFAULT_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
} from '@lib/framework-config';
import { tryGetPackageJson, isUsingTypeScript } from '@utils/setup-utils';
import { analytics } from '@utils/analytics';
import { detectFramework, gatherFrameworkContext } from '@lib/detection/index';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { wizardAbort } from '@utils/wizard-abort';
import { getUI } from '@ui/index';
import { WIZARD_TOOL_NAMES } from '@lib/wizard-tools';
import {
  verifyFirmwareInstall,
  type VerificationOutcome,
} from '@lib/firmware-verify';
import { installEspIdfHonchSubmodule } from '@lib/esp-idf-install';
import { HONCH_INTEGRATION_PROGRAM } from './steps.js';
import { getContentBlocks } from './content/index.js';

export const SETUP_REPORT_FILE = 'honch-setup-report.md';
export const EVENT_PLAN_FILE = '.honch-events.json';

const FIRMWARE_TARGETS = new Set(['esp-idf', 'c-posix', 'micropython']);
const SOURCE_CHANGE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hpp',
  '.ino',
  '.py',
  '.m',
  '.mm',
  '.swift',
  '.kt',
  '.kts',
  '.java',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
]);
const SOURCE_CHANGE_BASENAMES = new Set([
  'CMakeLists.txt',
  'Kconfig',
  'Kconfig.projbuild',
  'Package.swift',
  'Podfile',
  'build.gradle',
  'build.gradle.kts',
  'package.json',
  'idf_component.yml',
  'manifest.py',
]);

type ChangedPathState = Map<string, string>;

function getChangedPaths(installDir: string): string[] {
  try {
    const output = childProcess.execFileSync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      {
        cwd: installDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );

    return output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const path = line.slice(3);
        const renameIndex = path.indexOf(' -> ');
        return renameIndex >= 0 ? path.slice(renameIndex + 4) : path;
      });
  } catch {
    return [];
  }
}

function fingerprintPath(installDir: string, path: string): string {
  try {
    const stat = fs.statSync(`${installDir}/${path}`);
    if (!stat.isFile()) {
      return `non-file:${stat.mode}:${stat.size}:${stat.mtimeMs}`;
    }

    const data = fs.readFileSync(`${installDir}/${path}`);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return 'missing';
  }
}

function getChangedPathState(installDir: string): ChangedPathState {
  const state: ChangedPathState = new Map();
  for (const path of getChangedPaths(installDir)) {
    state.set(path, fingerprintPath(installDir, path));
  }
  return state;
}

export function hasExecutableIntegrationChange(paths: string[]): boolean {
  return paths.some((path) => {
    if (
      path.startsWith('.claude/') ||
      path.endsWith('.md') ||
      path === SETUP_REPORT_FILE
    ) {
      return false;
    }

    return (
      SOURCE_CHANGE_EXTENSIONS.has(extname(path)) ||
      SOURCE_CHANGE_BASENAMES.has(basename(path))
    );
  });
}

export function hasExecutableIntegrationDelta(
  before: ChangedPathState,
  after: ChangedPathState,
): boolean {
  return Array.from(after.entries()).some(([path, fingerprint]) => {
    return (
      hasExecutableIntegrationChange([path]) && before.get(path) !== fingerprint
    );
  });
}

function formatVerificationSection(outcomes: VerificationOutcome[]): string {
  const lines = outcomes.map((o) => `- ${o.label}: ${o.status} — ${o.detail}`);
  return `\n## Wizard verification\n\n${lines.join('\n')}\n`;
}

/**
 * Run a target-appropriate build check after the agent finishes (firmware only;
 * mobile targets verify through the agent's own package-manager build scripts).
 * Records outcomes in the setup report and surfaces them in the UI. Never
 * throws — a failed build is reported, not fatal.
 */
function runFirmwareVerification(installDir: string, targetId: string): void {
  const outcomes = verifyFirmwareInstall(targetId, installDir);
  if (outcomes.length === 0) return;

  for (const o of outcomes) {
    const line = `${o.label}: ${o.detail}`;
    if (o.status === 'passed') getUI().log.success(line);
    else if (o.status === 'failed') getUI().log.error(line);
    else getUI().log.warn(line);
  }

  try {
    const reportPath = `${installDir}/${SETUP_REPORT_FILE}`;
    const section = formatVerificationSection(outcomes);
    if (fs.existsSync(reportPath)) {
      fs.appendFileSync(reportPath, section);
    } else {
      fs.writeFileSync(reportPath, `# Honch Setup Report\n${section}`);
    }
  } catch (error) {
    analytics.captureException(error as Error);
  }
}

/**
 * Register the Honch SDK as a git submodule at components/honch before the
 * agent runs. The agent cannot do this itself (its Bash allowlist blocks git /
 * idf.py), so the wizard owns the component install; the agent only wires
 * `REQUIRES honch`, init, and tracking into the existing component. Aborts the
 * install on failure rather than leaving SDK setup as a manual follow-up.
 */
async function installEspIdfComponent(installDir: string): Promise<void> {
  getUI().log.step('Registering the Honch SDK component (components/honch)…');
  try {
    const result = installEspIdfHonchSubmodule(installDir);
    getUI().log.success(result.message);
  } catch (error) {
    await wizardAbort({
      message:
        'Could not register the Honch ESP-IDF SDK submodule at components/honch.\n\n' +
        `${(error as Error).message}\n\n` +
        'Resolve the git state (commit or stash changes, or remove a conflicting ' +
        'components/honch) and re-run.',
    });
  }
}

async function ensureExecutableIntegrationChange(
  session: WizardSession,
  before: ChangedPathState,
): Promise<void> {
  const after = getChangedPathState(session.installDir);
  if (after.size === 0 || hasExecutableIntegrationDelta(before, after)) {
    return;
  }

  await wizardAbort({
    message:
      'Honch integration did not modify app or firmware source code.\n\n' +
      'The installer changed only documentation, reports, or assistant skill files. ' +
      'A successful Honch install must wire SDK init and real track calls into executable project code.',
  });
}

export const honchIntegrationConfig: ProgramConfig = {
  command: 'integrate',
  description: 'Install the Honch SDK into your project',
  id: 'honch-integration',
  steps: HONCH_INTEGRATION_PROGRAM,
  getContentBlocks,
  disallowedTools: [
    WIZARD_TOOL_NAMES.auditSeedChecks,
    WIZARD_TOOL_NAMES.auditAddChecks,
    WIZARD_TOOL_NAMES.auditResolveChecks,
  ],
  // wizard_ask is enabled so the agent can ask the few topology questions that
  // change the integration (e.g. firmware → "is there a companion relay app?").

  // CI-mode prerequisite work: the headless equivalent of the detect step's
  // onReady hook. Auto-detect the target, then gather context.
  ciPreRun: async (session: WizardSession): Promise<void> => {
    const integration = await detectFramework(session.installDir);
    if (!integration) {
      await wizardAbort({
        message: 'Could not auto-detect a Honch target for this project.',
      });
      return;
    }
    session.integration = integration;
    analytics.setTag('integration', integration);

    const frameworkConfig = FRAMEWORK_REGISTRY[integration];
    session.frameworkConfig = frameworkConfig;

    const context = await gatherFrameworkContext(frameworkConfig, {
      installDir: session.installDir,
      debug: session.debug,
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
      ci: true,
      benchmark: session.benchmark,
      yaraReport: session.yaraReport,
    });
    for (const [key, value] of Object.entries(context)) {
      if (!(key in session.frameworkContext)) {
        session.frameworkContext[key] = value;
      }
    }
  },

  run: async (session: WizardSession): Promise<ProgramRun> => {
    const config = session.frameworkConfig!;

    const typeScriptDetected = isUsingTypeScript({
      installDir: session.installDir,
    });
    session.typescript = typeScriptDetected;

    const usesPackageJson = config.detection.usesPackageJson !== false;
    if (usesPackageJson) {
      const packageJson = await tryGetPackageJson({
        installDir: session.installDir,
      });
      if (
        packageJson &&
        !(await import('@utils/package-json')).hasDeclaredDependency(
          config.detection.packageName,
          packageJson,
        )
      ) {
        getUI().log.warn(
          `${config.detection.packageDisplayName} is not installed yet — the agent will add it.`,
        );
      }
    }

    const frameworkContext = session.frameworkContext;
    Object.entries(config.analytics.getTags(frameworkContext)).forEach(
      ([key, value]) => analytics.setTag(key, value),
    );

    const targetId = config.metadata.integration;
    const isFirmware = FIRMWARE_TARGETS.has(targetId);

    // Deterministic component install the agent can't do (Bash blocks git).
    // Runs before the change-state baseline so the submodule isn't counted as
    // an agent source edit.
    if (targetId === 'esp-idf') {
      await installEspIdfComponent(session.installDir);
    }

    const preRunChangeState = getChangedPathState(session.installDir);

    return {
      integrationLabel: targetId,
      // Install the bundled per-target skill (src/skills/<targetId>) into the
      // project so the agent reads the target-specific, anti-hallucination
      // install guide — not just the generic prompt below.
      skillId: targetId,
      additionalMcpServers: config.metadata.additionalMcpServers,
      detectPackageManager: config.detection.detectPackageManager,
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
      reportFile: SETUP_REPORT_FILE,
      docsUrl: config.metadata.docsUrl,
      errorMessage: 'Honch integration failed',
      additionalFeatureQueue: session.additionalFeatureQueue,
      maxQuestions: 4,
      postRun: async (postRunSession) => {
        await ensureExecutableIntegrationChange(
          postRunSession,
          preRunChangeState,
        );
        if (isFirmware) {
          runFirmwareVerification(postRunSession.installDir, targetId);
        }
      },

      customPrompt: (ctx) => {
        const additionalLines = config.prompts.getAdditionalContextLines
          ? config.prompts.getAdditionalContextLines(frameworkContext)
          : [];
        const additionalContext =
          additionalLines.length > 0
            ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
            : '';

        const deviceLine = session.deviceModel
          ? `, device model "${session.deviceModel}"`
          : '';
        const firmwareLine = session.firmwareVersion
          ? `, firmware version "${session.firmwareVersion}"`
          : '';

        const topologyStep = isFirmware
          ? `\nSTEP 4b — Companion app / relay (BLE-only devices): some devices have no direct internet and rely on a companion mobile app to relay events. Use the wizard_ask tool to ask: "Does this device have a companion mobile app that relays its events to Honch?" If yes, ask whether that app lives in this same repo (and where). When a relay is used: on the DEVICE side, do NOT invent a drain/envelope API (there is no honch_drain_to_buffer and no hand-rolled wire frame) — read the installed SDK headers for the supported way to obtain frame bytes (e.g. the event_queue_ops hook in honch_config_t) and let the customer's existing BLE/transport carry them unchanged; if the companion app is in this repo, also integrate the app side (install @honch/react-native-relay or the platform App SDK) and feed each received frame to the relay's verified ingest call (React Native: receiveFrame(deviceId, frameBytes)), preserving device_id/timestamp. Confirm every symbol against the installed SDK; never hand-encode a frame.\n`
          : '';

        return `You are integrating the Honch ${
          config.metadata.name
        } SDK into this project. Honch is a device/app analytics SDK; events upload to the Honch capture host.

Project context:
- Honch project id: ${ctx.projectId}
- Honch capture key (sent as X-Honch-Project-Key): ${ctx.projectApiKey}
- Honch capture host: ${ctx.host}
- Target: ${config.metadata.name}
- TypeScript: ${typeScriptDetected ? 'Yes' : 'No'}
- Project type: ${config.prompts.projectTypeDetection}
- Package installation: ${
          config.prompts.packageInstallation ?? DEFAULT_PACKAGE_INSTALLATION
        }${additionalContext}

Authoritative sources — READ THESE, do not invent APIs:
1. Fetch and read the live docs for this target: ${
          config.metadata.docsUrl
        } (e.g. \`curl -sL ${
          config.metadata.docsUrl
        }\`), plus https://docs.honch.io/concepts.
2. After the SDK is added, the installed SDK headers/types (e.g. honch.h) are the ONLY source of truth for symbol names and signatures — read them before writing integration code.

Steps (in order):

STEP 1 — Read the docs above and inspect the project. Use the detect_package_manager tool (wizard-tools MCP) to learn the build/package system; do not guess.

STEP 2 — Add the Honch SDK dependency using the project's own build system (see the docs + package-installation note above).

STEP 3 — Configure safely. NEVER hardcode the raw capture key in source. Use the wizard-tools set_env_values tool (runs locally; secrets never reach the LLM) to write the key + host into the project's env/config, then read them via the platform's idiomatic mechanism (env / Kconfig / xcconfig / gradle property). Use check_env_keys first.

STEP 4 — Modify executable project code, not just docs/config. Initialize Honch once at app/firmware startup (the nearest existing init point). Configure the capture host and project key${deviceLine}${firmwareLine}. Preserve application ownership of networking, TLS, buffers, queues, scheduling, and shutdown.

STEP 4a — Instrument real interactions. Inspect the existing app/firmware behavior and wire track calls into the real interaction points users care about: boot/reset, button presses, screen/view changes, sensor readings, command handling, error paths, state changes, relay receive/send points, or periodic health/heartbeat signals. Use meaningful event names and low-cardinality properties. If a project is only a skeleton or mock app, create/extend the minimal runnable code needed to demonstrate the product interaction flow and instrument that code. Do not stop after writing markdown, installing a skill, adding dependency files, or adding config; success requires at least one executable source/build file with Honch init and real track calls.
${topologyStep}
STEP 5 — Verify. Run only build/test commands already available locally. If a required toolchain is missing, do NOT install it — report the exact command for the user to run.

STEP 6 — Before reporting success, inspect the diff/status and confirm executable code was changed, SDK init is wired, and real interaction events are tracked. Then write a concise markdown report to ./${SETUP_REPORT_FILE} (target, files changed, dependency/config changes, init location, interaction events added, verification run + result, manual follow-up).

Hard rules: treat the installed headers + ${
          config.metadata.docsUrl
        } as the only source of truth; never invent functions/fields/return codes; never hand-encode the Honch wire format (call SDK functions only); never weaken TLS, auth, queue durability, or retry; do not print the raw key; never present a docs-only/config-only change as a completed install. Read a file immediately before writing it.
`;
      },

      buildOutroData: (_sess, credentials) => {
        const envVars = config.environment.getEnvVars(
          credentials.projectApiKey,
          credentials.host,
        );
        const changes = [
          ...config.ui.getOutroChanges(frameworkContext),
          Object.keys(envVars).length > 0
            ? 'Wrote the Honch capture key + host to the project config'
            : '',
        ].filter(Boolean);

        return {
          kind: OutroKind.Success as const,
          message: 'Honch SDK installed.',
          reportFile: SETUP_REPORT_FILE,
          changes,
          docsUrl: config.metadata.docsUrl,
        };
      },
    };
  },
};

export { HONCH_INTEGRATION_PROGRAM } from './steps.js';
