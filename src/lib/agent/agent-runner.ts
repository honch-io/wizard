/**
 * Unified program runner.
 *
 * Single configurable pipeline for all programs. Each program
 * provides a ProgramRun (via the `run` field on ProgramConfig)
 * that controls:
 *   - Whether a skill is pre-installed or discovered at runtime
 *   - How the agent prompt is built
 *   - What MCP servers and package manager detector to use
 *   - What happens after the agent completes
 *
 * The pipeline itself is fixed:
 *   init → health check → settings → OAuth → [skill install] →
 *   agent init → prompt → run → errors → [postRun] → outro
 */

import {
  type WizardSession,
  type AdditionalFeature,
  type Credentials,
  OutroKind,
} from '@lib/wizard-session';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { analytics, groupsFromUser } from '@utils/analytics';
import { getUI } from '@ui';
import {
  initializeAgent,
  runAgent as executeAgent,
  AgentErrorType,
  AgentSignals,
  buildWizardMetadata,
  checkAllSettingsConflicts,
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
} from './agent-interface';
import {
  evaluateWizardReadiness,
  WizardReadiness,
  SIGNUP_WIZARD_READINESS_CONFIG,
  getBlockingServiceKeys,
  SERVICE_LABELS,
} from '@lib/health-checks/readiness';
import { enableDebugLogs, initLogFile, logToFile } from '@utils/debug';
import { createBenchmarkPipeline } from '@lib/middleware/benchmark';
import { wizardAbort, WizardError, registerCleanup } from '@utils/wizard-abort';
import { formatScanReport, writeScanReport } from '@lib/yara-hooks';
import { detectNodePackageManagers } from '@lib/detection/package-manager';
import type { PackageManagerDetector } from '@lib/detection/package-manager';
import { installLocalSkill, type InstallSkillResult } from '@lib/local-skills';
import { createWizardAskBridge } from '@lib/wizard-ask-bridge';
import type { WizardRunOptions } from '@utils/types';

import type { ProgramConfig } from '@lib/programs/program-step';
import { assemblePrompt, type PromptContext } from './agent-prompt';

export type { PromptContext };

// ── Types ────────────────────────────────────────────────────────────

export type { Credentials };

/**
 * A known `[ABORT] <reason>` case. First matching entry is rendered on
 * the error outro; unmatched aborts use a generic fallback.
 */
export interface AbortCase {
  match: RegExp;
  message: string;
  body: string;
  docsUrl?: string;
}

/**
 * Unified agent run configuration.
 *
 * Every program provides one of these — either as a static object
 * or via a function that builds one from the session. The runner
 * assembles the final prompt from `prompt` + `skillId`.
 */
export interface ProgramRun {
  /** Analytics label (e.g. 'revenue-analytics-setup', 'nextjs') */
  integrationLabel: string;
  /** Skill ID to pre-install. Omit for agent-driven skill discovery. */
  skillId?: string;
  /** Additional program-specific prompt instructions. Appended after the default project prompt. */
  customPrompt?: (ctx: PromptContext) => string;
  /** Additional MCP servers (e.g. Svelte MCP) */
  additionalMcpServers?: Record<string, { url: string }>;
  /** Package manager detector. Defaults to detectNodePackageManagers. */
  detectPackageManager?: PackageManagerDetector;
  spinnerMessage: string;
  successMessage: string;
  estimatedDurationMinutes: number;
  reportFile: string;
  docsUrl: string;
  errorMessage?: string;
  additionalFeatureQueue?: readonly AdditionalFeature[];
  /** Known `[ABORT] <reason>` cases this program can render. */
  abortCases?: AbortCase[];
  /** Runs after agent completes, before outro (e.g. env var upload). */
  postRun?: (session: WizardSession, credentials: Credentials) => Promise<void>;
  /** Custom outro data. Omit for default built from successMessage/reportFile/docsUrl. */
  buildOutroData?: (
    session: WizardSession,
    credentials: Credentials,
    cloudRegion: import('@utils/types').CloudRegion | undefined,
  ) => WizardSession['outroData'];
  /**
   * Per-run cap on `wizard_ask` invocations. Defaults to 10. The 4th call
   * always returns a "batch your questions" error regardless of the cap.
   */
  maxQuestions?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Decide whether the `wizard_ask` overlay should be wired for this run.
 * Disabled in non-interactive modes (CI, signup) — there's no human to
 * answer. Per-program disabling is done by adding WIZARD_ASK_TOOL_NAME to
 * the program's `disallowedTools` so the SDK rejects calls outright.
 * Extracted so the policy can be unit-tested directly.
 */
export function shouldDisableAsk(
  session: Pick<WizardSession, 'ci' | 'signup'>,
): boolean {
  return session.ci || session.signup;
}

function sessionToOptions(session: WizardSession): WizardRunOptions {
  return {
    installDir: session.installDir,
    debug: session.debug,
    default: false,
    signup: session.signup,
    localMcp: session.localMcp,
    ci: session.ci,
    benchmark: session.benchmark,
    projectId: session.projectId,
    apiKey: session.apiKey,
    yaraReport: session.yaraReport,
  };
}

// ── Runner ───────────────────────────────────────────────────────────

/**
 * Resolve a ProgramConfig's agent run definition and execute the pipeline.
 * Entry point for bin.ts — handles buildRunConfig, bootstrap, and (future) run field.
 */
export async function runAgent(
  programConfig: ProgramConfig,
  session: WizardSession,
): Promise<void> {
  if (!programConfig.run) {
    throw new Error(`Program "${programConfig.id}" has no run configuration.`);
  }

  const runDef =
    typeof programConfig.run === 'function'
      ? await programConfig.run(session)
      : programConfig.run;

  await runProgram(session, runDef, programConfig);
}

/**
 * Run a program's agent pipeline.
 *
 * This is the single execution path for all programs — both skill-based
 * (revenue analytics) and framework-based (core integration). The
 * `ProgramRun` controls what varies between them; `programConfig` carries
 * the program-level static metadata (tool allow/disallow lists, etc.).
 */
export async function runProgram(
  session: WizardSession,
  config: ProgramRun,
  programConfig: ProgramConfig,
): Promise<void> {
  // 1. Init logging + debug
  initLogFile();
  session.skillId = config.skillId ?? config.integrationLabel;
  logToFile(`[agent-runner] START ${config.integrationLabel}`);

  if (session.debug) {
    enableDebugLogs();
  }

  // 2. Health check (guarded — skip if TUI already ran it)
  if (!session.readinessResult) {
    logToFile('[agent-runner] evaluating wizard readiness');
    const readinessConfig = session.signup
      ? SIGNUP_WIZARD_READINESS_CONFIG
      : undefined;
    const readiness = await evaluateWizardReadiness(readinessConfig);
    logToFile(`[agent-runner] readiness=${readiness.decision}`);
    if (readiness.decision === WizardReadiness.No) {
      const blockingKeys = getBlockingServiceKeys(
        readiness.health,
        readinessConfig,
      );
      const blockingLabels = blockingKeys.map(
        (k) => `${SERVICE_LABELS[k]} (${readiness.health[k].status})`,
      );
      logToFile(`[agent-runner] blocked by: ${blockingLabels.join(', ')}`);

      await getUI().showBlockingOutage(readiness);

      await wizardAbort({
        message:
          'Cannot start — external services are down:\n' +
          blockingLabels.map((l) => `  - ${l}`).join('\n') +
          '\n\nPlease try again later.',
      });
    } else if (readiness.decision === WizardReadiness.YesWithWarnings) {
      getUI().setReadinessWarnings(readiness);
    }
  }

  // 3. Settings conflicts
  const settingsConflicts = checkAllSettingsConflicts(session.installDir);
  logToFile(
    `[agent-runner] settings conflicts: ${
      settingsConflicts.length > 0
        ? settingsConflicts
            .map((c) => `${c.source}(${c.keys.join(',')})`)
            .join('; ')
        : 'none'
    }`,
  );

  if (settingsConflicts.length > 0) {
    for (const conflict of settingsConflicts) {
      const level = conflict.source === 'managed' ? 'org' : conflict.source;
      analytics.wizardCapture('settings conflict detected', {
        level,
        keys: conflict.keys,
      });
    }
    await getUI().showSettingsOverride(settingsConflicts, () =>
      backupAndFixClaudeSettings(session.installDir),
    );
    logToFile('[agent-runner] settings override resolved');
  }

  analytics.wizardCapture('agent started', {
    integration: config.integrationLabel,
    program_id: programConfig.id,
    skill_id: config.skillId ?? null,
  });

  // 4. Auth: resolve the wizard token + project capture key from the bearer.
  logToFile('[agent-runner] resolving Honch project data');
  let projectData: Awaited<ReturnType<typeof getOrAskForProjectData>>;
  try {
    projectData = await getOrAskForProjectData({
      token: session.token,
      apiBaseUrl: session.apiBaseUrl,
      captureHost: session.captureHost,
      project: session.project,
    });
  } catch (error) {
    logToFile('[agent-runner] failed to resolve Honch project data:', error);
    throw error;
  }
  const {
    projectApiKey,
    host,
    apiBaseUrl,
    accessToken,
    projectId,
    cloudRegion,
    roleAtOrganization,
    user,
  } = projectData;
  logToFile(
    `[agent-runner] resolved Honch project ${projectId}; capture host ${host}; platform ${apiBaseUrl}`,
  );

  session.credentials = { accessToken, projectApiKey, host, projectId };
  session.roleAtOrganization = roleAtOrganization;
  session.apiUser = user;
  getUI().setCredentials(session.credentials);
  getUI().setRoleAtOrganization(roleAtOrganization);
  getUI().setApiUser(user);

  analytics.setGroups(groupsFromUser(user, host));
  logToFile('[agent-runner] stored Honch credentials in session');

  // 5. Skill install (if skillId provided). The per-target skill ships bundled
  // with the wizard (src/skills → dist/skills); we copy it into the project's
  // .claude/skills/ rather than fetching it from a remote registry.
  let skillPath: string | undefined;
  if (config.skillId) {
    logToFile(`[agent-runner] installing bundled skill ${config.skillId}`);
    const installResult = installLocalSkill(config.skillId, session.installDir);
    if (installResult.kind !== 'ok') {
      await abortOnInstallFailure(config.integrationLabel, installResult);
      return;
    }
    skillPath = installResult.path;
    logToFile(`[agent-runner] skill installed at ${skillPath}`);
  }

  // 6. Initialize agent
  logToFile('[agent-runner] initializing Claude agent');
  const spinner = getUI().spinner();
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardMetadata = buildWizardMetadata(wizardFlags);

  const restoreSettings = () => restoreClaudeSettings(session.installDir);
  getUI().onEnterScreen('outro', restoreSettings);

  if (session.yaraReport) {
    registerCleanup(() => {
      const reportPath = writeScanReport();
      if (reportPath) {
        const summary = formatScanReport();
        getUI().log.info(`YARA scan report: ${reportPath}${summary ?? ''}`);
      }
    });
  }

  getUI().startRun();

  // wizard_ask is only available in interactive mode. CI/signup users have
  // no way to answer; we omit the bridge so the tool returns an actionable
  // error rather than hanging on a never-resolving prompt.
  const askDisabled = shouldDisableAsk(session);
  const askBridge = askDisabled
    ? undefined
    : createWizardAskBridge({
        getSource: () => session.skillId ?? config.integrationLabel,
        showQuestion: (q) => getUI().requestQuestion(q),
      });

  const agent = await initializeAgent(
    {
      workingDirectory: session.installDir,
      platformToken: accessToken,
      apiBaseUrl,
      additionalMcpServers: config.additionalMcpServers,
      detectPackageManager:
        config.detectPackageManager ?? detectNodePackageManagers,
      wizardFlags,
      wizardMetadata,
      integrationLabel: config.integrationLabel,
      askBridge,
      askMaxQuestions: config.maxQuestions,
      // Enables the create_starter_dashboard tool. Uses the user bearer
      // (session.token) — the project API rejects the wizard JWT — and keeps
      // it local to this process; only the dashboard URL flows to the UI.
      dashboards: session.token
        ? {
            userBearer: session.token,
            projectId,
            apiBaseUrl,
            frontendUrl: session.frontendUrl,
            onCreated: (url) => getUI().setDashboardUrl(url),
          }
        : undefined,
      allowedTools: programConfig.allowedTools,
      disallowedTools: programConfig.disallowedTools,
      getPendingQuestion: () => session.pendingQuestion,
    },
    sessionToOptions(session),
  );

  const middleware = session.benchmark
    ? createBenchmarkPipeline(spinner, sessionToOptions(session))
    : undefined;

  // 7. Build prompt
  const prompt = assemblePrompt(config, {
    projectId,
    projectApiKey,
    host,
    skillPath,
  });

  // 8. Run agent
  const agentResult = await executeAgent(
    agent,
    prompt,
    sessionToOptions(session),
    spinner,
    {
      estimatedDurationMinutes: config.estimatedDurationMinutes,
      spinnerMessage: config.spinnerMessage,
      successMessage: config.successMessage,
      errorMessage: config.errorMessage ?? `${config.integrationLabel} failed`,
      additionalFeatureQueue: config.additionalFeatureQueue ?? [],
      abortCases: config.abortCases,
    },
    middleware,
  );

  // 9. Error handling (full set from both runners)
  if (agentResult.error === AgentErrorType.ABORT) {
    const reason = agentResult.message ?? '';
    const matched = config.abortCases?.find((c) => c.match.test(reason));
    const outroData: WizardSession['outroData'] = matched
      ? {
          kind: OutroKind.Error,
          message: matched.message,
          body: matched.body,
          docsUrl: matched.docsUrl,
        }
      : {
          kind: OutroKind.Error,
          message: `${config.integrationLabel} aborted`,
          body: reason || 'The agent aborted the program.',
          docsUrl: config.docsUrl,
        };
    analytics.wizardCapture('agent aborted', {
      integration: config.integrationLabel,
      reason,
      matched: matched?.message ?? null,
    });
    await wizardAbort({
      outroData,
      error: new WizardError(`Agent aborted: ${reason}`, {
        integration: config.integrationLabel,
        error_type: AgentErrorType.ABORT,
        reason,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    await wizardAbort({
      message:
        'Could not access the wizard tools\n\n' +
        'The wizard was unable to connect to its in-process tools.\n' +
        'This could be due to a network issue or a configuration problem.\n\n' +
        `Please try again, or check the documentation:\n${config.docsUrl}`,
      error: new WizardError('Agent could not access wizard tools', {
        integration: config.integrationLabel,
        error_type: AgentErrorType.MCP_MISSING,
        signal: AgentSignals.ERROR_MCP_MISSING,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.RESOURCE_MISSING) {
    await wizardAbort({
      message:
        'Could not access the setup resource\n\n' +
        'This may indicate a version mismatch or a temporary service issue.\n\n' +
        `Please try again, or check the documentation:\n${config.docsUrl}`,
      error: new WizardError('Agent could not access setup resource', {
        integration: config.integrationLabel,
        error_type: AgentErrorType.RESOURCE_MISSING,
        signal: AgentSignals.ERROR_RESOURCE_MISSING,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.YARA_VIOLATION) {
    await wizardAbort({
      message:
        'Security violation detected.\nPlease report this to: the Honch team',
      error: new WizardError('YARA scanner terminated session', {
        integration: config.integrationLabel,
        error_type: AgentErrorType.YARA_VIOLATION,
      }),
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    analytics.wizardCapture('agent api error', {
      integration: config.integrationLabel,
      error_type: agentResult.error,
      error_message: agentResult.message,
    });

    await wizardAbort({
      message: `API Error\n\n${
        agentResult.message || 'Unknown error'
      }\n\nPlease report this to: the Honch team`,
      error: new WizardError(`API error: ${agentResult.message}`, {
        integration: config.integrationLabel,
        error_type: agentResult.error,
      }),
    });
  }

  // 10. Post-run hooks
  if (config.postRun) {
    await config.postRun(session, {
      accessToken,
      projectApiKey,
      host,
      projectId,
    });
  }

  // 11. Outro
  // Push outro data through the UI (not via direct `session.outroData = ...`
  // mutation) so the live store gets the value. agent-runner's `session`
  // parameter is captured at runAgent() invocation time, and any `setKey`
  // call between then and here (e.g. setDashboardUrl, setNotebookUrl) forks
  // the session reference — direct mutation then lands on a stale snapshot
  // that the screen never reads. UI.setOutroData() goes through the store
  // and also merges in any post-snapshot URLs from the live session.
  const outroData = config.buildOutroData
    ? config.buildOutroData(
        session,
        { accessToken, projectApiKey, host, projectId },
        cloudRegion,
      )
    : {
        kind: OutroKind.Success,
        message: config.successMessage,
        reportFile: config.reportFile,
        docsUrl: config.docsUrl,
        continueUrl: session.signup
          ? `${session.frontendUrl.replace(/\/+$/, '')}/products?source=wizard`
          : undefined,
      };
  if (outroData) {
    getUI().setOutroData(outroData);
  }

  getUI().outro(config.successMessage);

  // 12. Analytics shutdown
  await analytics.shutdown('success');
}

// ── Shared error helpers ─────────────────────────────────────────────

async function abortOnInstallFailure(
  integrationLabel: string,
  result: InstallSkillResult,
): Promise<void> {
  if (result.kind === 'ok') return;

  const message = (() => {
    switch (result.kind) {
      case 'skill-not-found':
        return `No bundled skill found for "${result.skillId}".\nThis is a wizard packaging bug — please report it to the Honch team.`;
      case 'copy-failed':
        return `Failed to install the bundled skill: ${result.message}\nCheck that the install directory is writable and try again.`;
    }
  })();

  await wizardAbort({
    message,
    error: new WizardError(`Skill install failed: ${result.kind}`, {
      integration: integrationLabel,
      error_type: result.kind,
    }),
  });
}
