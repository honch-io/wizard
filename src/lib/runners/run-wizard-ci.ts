import { HONCH_DOCS_URL } from '@lib/constants';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import type { ProgramConfig } from '@lib/programs/program-step';
import { resolveNoTelemetry } from './resolve-no-telemetry';

function tokenFromOptions(
  options: Record<string, unknown>,
): string | undefined {
  return (
    (options.token as string | undefined) ??
    (Array.isArray(options._) && options._.length > 0
      ? String(options._[0])
      : undefined) ??
    process.env.HONCH_WIZARD_TOKEN
  );
}

/**
 * The single CI validation layer: requires a Honch bearer token and install-dir.
 * Every CI entry point routes through `runWizardCI`, so this is the one place
 * these checks live. UI must be initialized before calling.
 */
export function validateCiOptions(options: Record<string, unknown>): void {
  if (!tokenFromOptions(options)) {
    getUI().intro('Honch Wizard');
    getUI().log.error(
      'CI mode requires a Honch bearer token. Pass it as <token>, --token <token>, or HONCH_WIZARD_TOKEN.',
    );
    process.exit(1);
  }
  if (!options.installDir) {
    getUI().intro('Honch Wizard');
    getUI().log.error(
      'CI mode requires --install-dir (directory to install in)',
    );
    process.exit(1);
  }
}

/**
 * CI-mode pipeline shared by every non-interactive entry point.
 *
 * Validates flags, builds a `ci:true` session, runs `config.ciPreRun` (or the
 * program's `onReady` hooks by default), executes `runAgent`, and routes any
 * failure through `wizardAbort`. `wizardAbort` owns all exits — never add a
 * raw `process.exit` here.
 */
export function runWizardCI(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  setUI(new LoggingUI());
  validateCiOptions(options);

  void (async () => {
    const path = await import('path');
    const { buildSession } = await import('@lib/wizard-session');
    const { readEnvironment } = await import('@utils/environment');
    const { configureLogFileFromEnvironment, logToFile } = await import(
      '@utils/debug'
    );
    const { wizardAbort, WizardError } = await import('@utils/wizard-abort');

    configureLogFileFromEnvironment();

    const env = readEnvironment();
    const installDir = path.isAbsolute(options.installDir as string)
      ? (options.installDir as string)
      : path.join(process.cwd(), options.installDir as string);

    const session = buildSession({
      ...env,
      debug:
        (options.debug as boolean | undefined) ??
        (env.debug as boolean | undefined),
      installDir,
      token: tokenFromOptions(options),
      apiBaseUrl:
        (options.apiBaseUrl as string | undefined) ??
        (env.apiBaseUrl as string | undefined),
      frontendUrl:
        (options.frontendUrl as string | undefined) ??
        (env.frontendUrl as string | undefined),
      captureHost:
        (options.captureHost as string | undefined) ??
        (env.captureHost as string | undefined),
      project:
        (options.project as string | undefined) ??
        (env.project as string | undefined),
      deviceModel:
        (options.deviceModel as string | undefined) ??
        (env.deviceModel as string | undefined),
      firmwareVersion:
        (options.firmwareVersion as string | undefined) ??
        (env.firmwareVersion as string | undefined),
      ci: true,
      localMcp:
        (options.localMcp as boolean | undefined) ??
        (env.localMcp as boolean | undefined),
      benchmark:
        (options.benchmark as boolean | undefined) ??
        (env.benchmark as boolean | undefined),
      yaraReport:
        (options.yaraReport as boolean | undefined) ??
        (env.yaraReport as boolean | undefined),
      noTelemetry: resolveNoTelemetry(options),
    });
    session.programLabel = config.id;
    if (config.skillId) {
      session.skillId = config.skillId;
    }
    const runDef = typeof config.run === 'object' ? config.run : null;

    getUI().intro('Welcome to the Honch setup wizard');
    getUI().log.info(`Running ${config.id} in CI mode`);

    try {
      if (config.ciPreRun) {
        await config.ciPreRun(session);
      } else {
        const readyCtx = {
          session,
          setFrameworkContext: (key: string, value: unknown) => {
            session.frameworkContext[key] = value;
          },
          setFrameworkConfig: () => undefined,
          setDetectedFramework: () => undefined,
          setUnsupportedVersion: () => undefined,
          addDiscoveredFeature: () => undefined,
          setDetectionComplete: () => undefined,
        };
        for (const step of config.steps) {
          if (step.onReady) {
            await step.onReady(readyCtx);
          }
        }

        const detectError = session.frameworkContext.detectError as
          | { kind: string; [k: string]: unknown }
          | undefined;
        if (detectError) {
          await wizardAbort({
            message: `Prerequisites not met: ${detectError.kind}\n\nSee ${
              runDef?.docsUrl ?? HONCH_DOCS_URL
            }`,
            error: new WizardError(`${config.id} prerequisites failed`, {
              integration: config.id,
              detect_error_kind: detectError.kind,
            }),
          });
        }
      }

      const { runAgent } = await import('@lib/agent/agent-runner');
      await runAgent(config, session);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack =
        error instanceof Error && error.stack ? error.stack : undefined;

      logToFile(`[bin.ts CI] ERROR: ${errorMessage}`);
      if (errorStack) logToFile(`[bin.ts CI] STACK: ${errorStack}`);

      const debugInfo = session.debug && errorStack ? `\n\n${errorStack}` : '';
      const docsUrl =
        session.frameworkConfig?.metadata.docsUrl ??
        runDef?.docsUrl ??
        HONCH_DOCS_URL;
      await wizardAbort({
        message: `Something went wrong: ${errorMessage}\n\nYou can read the documentation at ${docsUrl} to set up manually.${debugInfo}`,
        error: error as Error,
      });
    }
  })().catch(() => {
    process.exit(1);
  });
}
