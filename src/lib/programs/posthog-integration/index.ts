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
import { POSTHOG_INTEGRATION_PROGRAM } from './steps.js';
import { getContentBlocks } from './content/index.js';

export const SETUP_REPORT_FILE = 'honch-setup-report.md';
export const EVENT_PLAN_FILE = '.honch-events.json';

const FIRMWARE_TARGETS = new Set(['esp-idf', 'c-posix', 'micropython']);

export const posthogIntegrationConfig: ProgramConfig = {
  command: 'integrate',
  description: 'Install the Honch SDK into your project',
  id: 'posthog-integration',
  steps: POSTHOG_INTEGRATION_PROGRAM,
  getContentBlocks,
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

    return {
      integrationLabel: targetId,
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
          ? `\nSTEP 4b — Companion app / relay (BLE-only devices): some devices have no direct internet and rely on a companion mobile app to relay events. Use the wizard_ask tool to ask: "Does this device have a companion mobile app that relays its events to Honch?" If yes, ask whether that app lives in this same repo (and where). When a relay is used, wire the DEVICE side to drain queued events into the sealed envelope (honch_drain_to_buffer) for the customer's existing BLE/transport to carry; if the companion app is in this repo, also integrate the app side (install @honch/react-native-relay or the iOS/Android App SDK) and call ingestRelayedEvents(data) on receipt, preserving device_id/timestamp.\n`
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

STEP 4 — Initialize Honch once at app/firmware startup (the nearest existing init point). Configure the capture host and project key${deviceLine}${firmwareLine}. Preserve application ownership of networking, TLS, buffers, queues, scheduling, and shutdown. Add at most one small example event if idiomatic; otherwise document where to call track.
${topologyStep}
STEP 5 — Verify. Run only build/test commands already available locally. If a required toolchain is missing, do NOT install it — report the exact command for the user to run.

STEP 6 — Write a concise markdown report to ./${SETUP_REPORT_FILE} (target, files changed, dependency/config changes, init location, verification run + result, manual follow-up).

Hard rules: treat the installed headers + ${
          config.metadata.docsUrl
        } as the only source of truth; never invent functions/fields/return codes; never hand-encode the Honch wire format (call SDK functions only); never weaken TLS, auth, queue durability, or retry; do not print the raw key. Read a file immediately before writing it.
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

export { POSTHOG_INTEGRATION_PROGRAM } from './steps.js';
