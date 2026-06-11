import { VERSION } from '@lib/version';
import { runtimeEnv } from '@env';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { startTUI as StartTUIFn } from '@ui/tui/start-tui';
import type { TaskStreamPush as TaskStreamPushClass } from '@lib/task-stream/task-stream-push';
import { resolveNoTelemetry } from './resolve-no-telemetry';
import { getLogFilePath, logToFile } from '@utils/debug';
import { DEFAULT_API_BASE_URL } from '@lib/constants';
import { readSavedToken } from '@lib/auth/credentials-store';

const WIZARD_VERSION = VERSION;

function getPositionalArgs(options: Record<string, unknown>): string[] {
  return Array.isArray(options._) ? options._.map(String) : [];
}

/**
 * Resolve the bearer token. Precedence:
 *   1. --token flag / HONCH_WIZARD_TOKEN env (folded into `options.token`)
 *   2. first positional arg  (`npx -y @honch/wizard <token>`)
 *   3. token saved by `honch login` (~/.honch/config.json, keyed by platform)
 * Falls through to undefined so getOrAskForProjectData can show the
 * "run honch login" guidance.
 */
function resolveToken(
  options: Record<string, unknown>,
  apiBaseUrl: string,
): string | undefined {
  const positional = getPositionalArgs(options);
  const explicit =
    (options.token as string | undefined) ??
    (positional.length > 0 ? positional[0] : undefined);
  if (explicit) return explicit;

  const saved = readSavedToken(apiBaseUrl);
  if (saved) {
    logToFile('[run-wizard] using saved Honch login (~/.honch/config.json)');
    return saved;
  }
  return undefined;
}

/**
 * Resolve the bearer for the interactive run. If none is provided or saved,
 * auto-start the browser login (PostHog-style) so a bare `npx @honch/wizard`
 * opens the browser, signs the user in, and continues — no separate
 * `honch login` step. This runs before the TUI mounts, so login progress
 * prints to plain stdout. Reached only from the interactive runner (the
 * command handler routes non-interactive/CI elsewhere), so a TTY is assumed.
 */
async function resolveTokenOrLogin(
  options: Record<string, unknown>,
  apiBaseUrl: string,
): Promise<string | undefined> {
  const existing = resolveToken(options, apiBaseUrl);
  if (existing) return existing;

  logToFile('[run-wizard] no token found; starting browser login');
  const { performBrowserLogin } = await import('@lib/auth/login-flow');
  return performBrowserLogin(apiBaseUrl);
}

function validateCliShape(options: Record<string, unknown>): void {
  const positional = getPositionalArgs(options);
  const allowedPositionalCount = options.token ? 0 : 1;
  if (positional.length <= allowedPositionalCount) return;

  const extra = positional.slice(allowedPositionalCount);
  const looksLikeBrokenInstallDir =
    extra.includes('install-dir') || extra.includes('=');
  const hint = looksLikeBrokenInstallDir
    ? ' Use --install-dir=/path or --install-dir /path; do not type "-- install-dir = /path".'
    : '';

  throw new Error(
    `Unexpected positional arguments: ${extra.join(' ')}.${hint}`,
  );
}

/**
 * Run a full wizard program in the TUI. Handles the full lifecycle: start TUI,
 * build session, run detection, wait for intro gate, execute the
 * agent pipeline, wait for outro dismissal, then exit.
 */
export function runWizard(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  let tui: ReturnType<typeof StartTUIFn> | null = null;
  let taskStream: TaskStreamPushClass | null = null;
  let onSignal: (() => void) | null = null;
  let exitInProgress = false;

  void (async () => {
    try {
      validateCliShape(options);
      const installDir = (options.installDir as string) || process.cwd();
      const apiBaseUrl =
        (options.apiBaseUrl as string | undefined) ?? DEFAULT_API_BASE_URL;

      // Resolve the bearer before mounting the TUI. With no token provided or
      // saved, this opens the browser and signs the user in, then continues.
      const resolvedToken = await resolveTokenOrLogin(options, apiBaseUrl);

      const { startTUI } = await import('@ui/tui/start-tui');
      const { buildSession, RunPhase } = await import('@lib/wizard-session');
      const { TaskStreamPush } = await import('@lib/task-stream/index');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tui = startTUI(WIZARD_VERSION, config.id as any);
      const activeTui = tui;

      const session = buildSession({
        debug: options.debug as boolean | undefined,
        localMcp: options.localMcp as boolean | undefined,
        installDir,
        // Bearer resolved above: --token / env / positional arg / saved login,
        // or freshly obtained via the browser login that just ran.
        token: resolvedToken,
        apiBaseUrl: options.apiBaseUrl as string | undefined,
        frontendUrl: options.frontendUrl as string | undefined,
        captureHost: options.captureHost as string | undefined,
        project: options.project as string | undefined,
        deviceModel: options.deviceModel as string | undefined,
        firmwareVersion: options.firmwareVersion as string | undefined,
        ci: false,
        benchmark: options.benchmark as boolean | undefined,
        yaraReport: options.yaraReport as boolean | undefined,
        noTelemetry: resolveNoTelemetry(options),
      });
      session.programLabel = config.id;
      if (options.skillId) {
        session.skillId = options.skillId as string;
      } else if (config.skillId) {
        session.skillId = config.skillId;
      }

      activeTui.store.session = session;

      // Honch wizard sends no telemetry — the run-state stream has no
      // destinations and stays disabled.
      taskStream = new TaskStreamPush({
        store: activeTui.store,
        programId: config.id,
        destinations: [],
        enabled: false,
      });
      const activeStream = taskStream;
      activeStream.attach();

      // Flush a terminal-phase push on Ctrl-C so the web app sees the
      // run ended in error rather than hanging on the last "running"
      // snapshot.
      let signalled = false;
      onSignal = (): void => {
        if (signalled || exitInProgress) return;
        signalled = true;
        if (activeTui.store.session.runPhase === RunPhase.Running) {
          activeTui.store.setRunPhase(RunPhase.Error);
        }
        void activeStream.shutdown(2000).finally(() => {
          try {
            activeTui.unmount();
          } catch {
            // terminal may already be torn down
          }
          process.exit(130);
        });
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);

      await activeTui.store.runReadyHooks();
      await activeTui.store.getGate('intro');

      const skipAgent = config.run == null;

      if (skipAgent) {
        const { getOrAskForProjectData } = await import('@utils/setup-utils');
        const { projectApiKey, host, accessToken, projectId } =
          await getOrAskForProjectData({
            token: session.token,
            apiBaseUrl: session.apiBaseUrl,
            captureHost: session.captureHost,
            project: session.project,
          });
        activeTui.store.setCredentials({
          accessToken,
          projectApiKey,
          host,
          projectId,
        });
      } else {
        const { runAgent } = await import('@lib/agent/agent-runner');
        await runAgent(config, activeTui.store.session);
      }

      const isDone = (): boolean =>
        skipAgent
          ? activeTui.store.session.outroDismissed
          : activeTui.store.session.skillsComplete;

      await new Promise<void>((resolve) => {
        const unsub = activeTui.store.subscribe(() => {
          if (isDone()) {
            unsub();
            resolve();
          }
        });
        if (isDone()) {
          unsub();
          resolve();
        }
      });

      exitInProgress = true;
      await activeStream.shutdown(2000);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      activeTui.unmount();
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logToFile('[run-wizard] ERROR:', err);

      // eslint-disable-next-line no-console
      console.error(
        `\nHonch wizard failed: ${message}\n\nLog: ${getLogFilePath()}\n`,
      );
      if (runtimeEnv('DEBUG') || runtimeEnv('HONCH_WIZARD_DEBUG')) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
      // The task-stream debounce timer keeps the event loop alive, so
      // we have to drain it before exiting on the error path.
      exitInProgress = true;
      if (onSignal) {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
      if (taskStream) {
        try {
          await taskStream.shutdown(2000);
        } catch {
          // ignore
        }
      }
      if (tui) {
        try {
          tui.unmount();
        } catch {
          // ignore
        }
      }
      process.exit(1);
    }
  })();
}
