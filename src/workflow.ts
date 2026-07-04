import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSetupReport, resolveInstallOutcome } from "@honch/agent-core";
import { buildAgentPrompt, type DisabledFeature } from "./agent/prompt.js";
import { runAgent } from "./agent/runner.js";
import { analyticsDisabled, buildInstallProperties } from "./analytics.js";
import {
  type BrowserLoginResult,
  loginViaBrowser,
  refreshOAuthSession,
} from "./auth/browser-login.js";
import {
  type AuthSession,
  loadAuthSession,
  saveAuthSession,
} from "./auth/session.js";
import type { CliOptions } from "./cli/options.js";
import {
  createPrompter,
  type Prompter,
  WizardCancelledError,
} from "./cli/prompt.js";
import { collectFeedback } from "./feedback.js";
import { installEspIdfHonchSubmodule } from "./firmware/esp-idf-install.js";
import {
  type VerificationOutcome,
  verifyFirmwareInstall,
} from "./firmware/verify.js";
import { PlatformClient, type ProjectResponse } from "./platform/client.js";
import { capturePostHog, newRunId } from "./posthog.js";
import { scanProject } from "./project/scan.js";
import {
  availableBranchName,
  changedFilesSince,
  commitAll,
  createBranch,
  currentBranch,
  gitInit,
  hasCommits,
  isGitWorkTree,
  restoreProject,
  snapshotProject,
} from "./project/snapshot.js";
import { scaffoldStarter, starterAvailable } from "./scaffold/starter.js";
import {
  HONCH_FEATURES,
  SDK_TARGETS,
  type SdkTarget,
  type SdkTargetId,
  targetSupportsFeatures,
} from "./sdk/targets.js";
import { createSecretVault } from "./secrets/vault.js";
import { createLocalToolsServer } from "./tools/mcp-server.js";

export type WorkflowResult = {
  reportPath: string;
  agentRan: boolean;
};

/** Sentinel value for the "create a new project" option. */
const CREATE_NEW_PROJECT = "__create_new_project__";

export async function runWorkflow(
  options: CliOptions,
  deps: {
    prompter?: Prompter;
    platformClient?: PlatformClient;
    scaffold?: (
      installDir: string,
      target: SdkTargetId,
    ) => Promise<{ files: string[] }>;
  } = {},
): Promise<WorkflowResult> {
  const prompter = deps.prompter ?? createPrompter();
  const platformClient =
    deps.platformClient ?? new PlatformClient(options.apiBaseUrl);
  const vault = createSecretVault();
  const startedAt = Date.now();
  // Mutable so the "Try Honch" path can re-point the install at a fresh temp
  // scratch directory. The initial scan still runs on the cwd (= options.installDir).
  let installDir = options.installDir;
  const analyticsId = newRunId();
  let totalTokens = 0;
  const track = (event: string, properties?: Record<string, unknown>) => {
    if (analyticsDisabled()) return;
    void capturePostHog({ event, distinctId: analyticsId, properties });
  };

  try {
    track("wizard_started");
    prompter.setStep?.("scan", "reading project files");
    const scan = scanProject(installDir);
    prompter.completeStep?.(
      "scan",
      scan.detectedTargets.length > 0
        ? `detected ${scan.detectedTargets.map((target) => target.label).join(", ")}`
        : "no target auto-detected",
    );

    prompter.setStep?.("target", "selecting SDK target");

    // The welcome screen *is* the SDK choice. From any directory it always
    // offers a "Try Honch" scratch project; when a non-interactive flag is set
    // we preserve the old behavior (install into the cwd, no Try).
    const scaffold = deps.scaffold ?? scaffoldStarter;
    let scaffoldNote: string | undefined;
    let tryMode = false;
    const detected = scan.detectedTargets[0];

    let target: SdkTarget;
    if (options.target || options.yes) {
      // Non-interactive: honor the requested target (or the detected one) and
      // install into the cwd — never re-point or scaffold.
      target = await resolveTarget(
        options.target,
        scan.detectedTargets,
        prompter,
      );
    } else if (options.tryMode) {
      // --try: go straight to the Try path, defaulting the SDK to the detected one.
      ({ target, scaffoldNote } = await runTryPath(
        scan.detectedTargets,
        prompter,
        scaffold,
        (dir) => {
          installDir = dir;
        },
      ));
      tryMode = true;
    } else {
      const tryOption = {
        label: "Try Honch in a scratch project",
        value: "try",
        hint: "no setup — I'll scaffold a throwaway project to play in",
      };
      const choice = await prompter.select({
        title: "Welcome to Honch",
        message: detected
          ? `I looked around ${options.installDir} and detected ${detected.label}. What would you like to do?`
          : `I looked around ${options.installDir} but couldn't identify an SDK. You can set Honch up here, or try it in a throwaway scratch project.`,
        // With a detected SDK, lead with continuing it. With nothing detected,
        // the user still ran honch in THIS directory, so default to setting up
        // here and keep the scratch project as the secondary escape hatch.
        defaultValue: detected ? "continue" : "different",
        options: detected
          ? [
              {
                label: `Continue with ${detected.label}`,
                value: "continue",
                badge: "(detected)",
              },
              { label: "Choose a different SDK", value: "different" },
              tryOption,
            ]
          : [
              { label: "Set up Honch in this folder", value: "different" },
              tryOption,
            ],
      });
      if (choice === "continue" && detected) {
        target = detected;
      } else if (choice === "try") {
        ({ target, scaffoldNote } = await runTryPath(
          scan.detectedTargets,
          prompter,
          scaffold,
          (dir) => {
            installDir = dir;
          },
        ));
        tryMode = true;
      } else {
        target = await resolveTarget(undefined, scan.detectedTargets, prompter);
      }
    }

    // Reflect the resolved install dir in the sidebar — in Try mode this is the
    // temp scratch dir, otherwise the cwd.
    prompter.setSummary?.({ sdkTarget: target.label, installDir });
    prompter.completeStep?.("target", target.label);
    track("wizard_target_selected", { target: target.id });

    prompter.setStep?.("auth", "connecting Honch account");
    const auth = await resolveAuth(options, prompter);
    prompter.setSummary?.({ authMode: auth.mode });
    prompter.completeStep?.(
      "auth",
      auth.accessToken
        ? "platform authenticated"
        : "local credentials supplied",
    );
    if (auth.accessToken) track("wizard_authenticated");

    prompter.setStep?.("project", "loading Honch projects");
    const project = await resolveProject(
      options,
      auth.accessToken,
      platformClient,
      prompter,
    );
    prompter.setSummary?.({ projectName: project.name });
    prompter.completeStep?.("project", project.name);
    track("wizard_project_selected");

    // Mint the wizard LLM token now that the project is known, so the platform
    // meters proxy usage against this project (the installer is free, tracked
    // per project). Offline runs (local API key) have no platform token.
    const wizardToken =
      options.runAgent && auth.accessToken
        ? (await platformClient.createWizardToken(auth.accessToken, project.id))
            .accessToken
        : undefined;

    prompter.setStep?.("config", "collecting device configuration");
    const deviceModel = await requiredInput(
      options.deviceModel,
      "Device model:",
      prompter,
    );
    prompter.setSummary?.({ deviceModel });
    // Neither firmware version nor capture host is collected here. Firmware is a
    // per-release value the project already tracks in its own code (the agent
    // wires Honch's firmware_version to that source); the capture host is
    // defaulted by the SDK, so the agent leaves it unset.
    const projectApiKey =
      project.apiKey ?? (await requiredSecret("Project API key:", prompter));
    const projectApiKeyRef = vault.put("Honch project API key", projectApiKey);
    prompter.completeStep?.("config", "device settings ready");

    // Pick your features — let the user compile out optional features they don't
    // need (smaller flash/RAM). Everything is on by default, so confirming
    // unchanged installs the full SDK. Skipped for non-interactive runs and the
    // React Native relay (which has no compile-time toggles).
    prompter.setStep?.("features", "choosing SDK features");
    let disabledFeatures: DisabledFeature[] = [];
    if (!options.yes && targetSupportsFeatures(target.id)) {
      const enabled = await prompter.multiSelect({
        title: "Pick your features",
        message:
          "Everything's on by default — turn off what this device doesn't need. The core is always included.",
        options: HONCH_FEATURES.map((feature) => ({
          label: feature.label,
          value: feature.id,
          hint: feature.hint,
          checked: true,
          locked: feature.locked,
          flashBytes: feature.flashBytes,
          ramBytes: feature.ramBytes,
          wireBytesPerEvent: feature.wireBytesPerEvent,
        })),
      });
      const enabledSet = new Set(enabled);
      disabledFeatures = HONCH_FEATURES.filter(
        (feature) =>
          feature.toggle && !feature.locked && !enabledSet.has(feature.id),
      ).map((feature) => ({
        toggle: feature.toggle as string,
        espIdfConfig: feature.espIdfConfig,
      }));
    }
    prompter.completeStep?.(
      "features",
      disabledFeatures.length > 0
        ? `${disabledFeatures.length} feature(s) stripped`
        : "all features on",
    );
    track("wizard_features_selected", {
      disabledCount: disabledFeatures.length,
      disabled: disabledFeatures.map((feature) => feature.toggle),
    });

    prompter.setStep?.("confirm", "waiting for confirmation");
    // The ESP-IDF flow git-inits the project itself, so revert always works
    // there; for other targets it only works if this is already a git repo.
    const gitRepo = isGitWorkTree(installDir);
    const revertable = target.id === "esp-idf" || gitRepo;
    const canBranch = options.runAgent && gitRepo && hasCommits(installDir);

    // What the user is signing up for, on every confirm path.
    const expectations =
      "\n\nClaude will edit files here and run build checks — usually 1-3 minutes, and it counts against your daily install budget.";

    let branch: string | undefined;
    let baseBranch: string | undefined;
    let installReverted = false;
    if (options.yes) {
      // Non-interactive: install on the current branch, no prompt.
    } else if (canBranch) {
      const desired = availableBranchName(installDir, "honch/setup");
      const choice = await prompter.select({
        title: "Review install plan",
        message: `Install the Honch ${target.label} SDK into the project at ${installDir}?${expectations}`,
        defaultValue: "branch",
        options: [
          { label: "Work on a new branch", value: "branch", hint: desired },
          { label: "Work on the current branch", value: "current" },
          { label: "Cancel", value: "cancel" },
        ],
      });
      if (choice === "cancel") {
        prompter.cancel?.("Wizard cancelled before project mutation");
        throw new WizardCancelledError(
          "Wizard cancelled before project mutation",
        );
      }
      if (choice === "branch") branch = desired;
    } else if (options.runAgent && !revertable) {
      // Not a git repo and Claude is about to edit files. Offer to init git
      // inline so the user gets the revert safety net without dropping out to
      // run `git init` and starting over.
      const choice = await prompter.select({
        title: "Review install plan",
        message: `Install the Honch ${target.label} SDK into the project at ${installDir}?${expectations}\n\nThis folder isn't a git repo, so Claude's changes can't be auto-reverted.`,
        defaultValue: "install",
        options: [
          { label: "Install Honch", value: "install" },
          {
            label: "Initialize git, then install",
            value: "init",
            hint: "lets you review and undo Claude's changes",
          },
          { label: "Cancel", value: "cancel" },
        ],
      });
      if (choice === "cancel") {
        prompter.cancel?.("Wizard cancelled before project mutation");
        throw new WizardCancelledError(
          "Wizard cancelled before project mutation",
        );
      }
      if (choice === "init") {
        gitInit(installDir);
        prompter.addRunMessage?.(
          "Initialized a git repo so Claude's changes can be reverted.",
          "status",
        );
      }
      track("wizard_confirmed");
    } else {
      const confirmed = await prompter.confirm(
        `Install the Honch ${target.label} SDK into the project at ${installDir}?${expectations}`,
      );
      if (!confirmed) {
        prompter.cancel?.("Wizard cancelled before project mutation");
        throw new WizardCancelledError(
          "Wizard cancelled before project mutation",
        );
      }
      track("wizard_confirmed");
    }
    prompter.completeStep?.(
      "confirm",
      branch ? `branch ${branch}` : "install approved",
    );

    let agentRan = false;
    // Whether Claude actually changed project files. undefined = not applicable
    // (dry run / reverted / non-git project where we can't tell).
    let integrated: boolean | undefined;
    let unverifiedByGit = false;
    let agentSummary: string | undefined;
    const verification: string[] = [];
    if (scaffoldNote) verification.push(scaffoldNote);
    if (options.runAgent && wizardToken) {
      prompter.setStep?.("agent", "running Claude Agent SDK");
      if (branch) {
        baseBranch = currentBranch(installDir);
        createBranch(installDir, branch);
        prompter.addRunMessage?.(
          `Working on a new branch: ${branch}`,
          "status",
        );
      }
      if (target.id === "esp-idf") {
        prompter.addRunMessage?.(
          "Registering Honch SDK component (git submodule)",
          "status",
        );
        const install = installEspIdfHonchSubmodule(installDir);
        verification.push(install.message);
        prompter.addRunMessage?.(install.message, "status");
      }
      prompter.addRunMessage?.("Preparing the install plan", "status");
      const prompt = buildAgentPrompt({
        targetId: target.id,
        projectApiKeyRef,
        deviceModel,
        disabledFeatures,
      });
      prompter.addRunMessage?.(
        "Handing off to Claude — press esc to pause",
        "status",
      );
      // Snapshot the project right before Claude touches it so the user can
      // revert its work if they pause the run.
      const snapshot = snapshotProject(installDir);
      // Anchor the run timer once; it survives a pause/resume from here on.
      prompter.markAgentStart?.();
      track("wizard_install_started");
      // Seed the daily-budget meter with the tokens already spent today, so it
      // shows usage against the cap (live total = this baseline + run tokens).
      // Re-synced on resume because `setStep` zeroes the run's local counter.
      // Best-effort: a failure just leaves the meter on a raw token count.
      const refreshBudget = async () => {
        try {
          const usage = await platformClient.getWizardUsage(wizardToken);
          prompter.setTokenBudget?.(usage.budget, usage.used);
        } catch {
          // Meter degrades to a raw token count; never block the install.
        }
      };
      await refreshBudget();

      let sessionId: string | undefined;
      let nextPrompt = prompt;
      let outcome: "completed" | "kept" | "reverted" = "completed";
      let lastMessages: string[] = [];
      // Authoritative record of files Claude actually wrote (Write/Edit tool
      // calls), accumulated across pause/resume. Observed at the tool layer, so
      // unlike the git snapshot it sees through submodules, nested repos,
      // ignored paths, and non-git projects. The report Claude writes itself
      // never counts as an integration.
      const agentWrittenFiles = new Set<string>();

      while (true) {
        const abort = new AbortController();
        prompter.onInterrupt?.(() => {
          prompter.addRunMessage?.("Pausing Claude…", "status");
          abort.abort();
        });
        const result = await runAgent({
          cwd: installDir,
          prompt: nextPrompt,
          resume: sessionId,
          platformToken: wizardToken,
          abortController: abort,
          llmBaseUrl: `${options.apiBaseUrl.replace(/\/+$/, "")}/api/wizard/llm`,
          onEvent: (event) => {
            if (event.kind === "retry") {
              prompter.setTransientStatus?.(event.text);
            } else if (event.kind === "file") {
              prompter.setChangedFile?.(event.text, event.op ?? "edit");
              if (path.basename(event.text) !== "honch-setup-report.md") {
                agentWrittenFiles.add(event.text);
              }
            } else if (event.kind === "usage") {
              prompter.addUsage?.(event.tokens ?? 0);
              totalTokens += event.tokens ?? 0;
            } else {
              prompter.addRunMessage?.(event.text, event.kind);
            }
          },
          mcpServers: {
            "honch-tools": createLocalToolsServer({
              workingDirectory: installDir,
              secretVault: vault,
            }),
          },
        });
        sessionId = result.sessionId ?? sessionId;
        if (result.messages.length > 0) lastMessages = result.messages;

        if (!abort.signal.aborted) break;

        const choice = await resolveInterruption(
          installDir,
          snapshot,
          prompter,
          verification,
        );
        if (choice === "continue") {
          prompter.setStep?.("agent", "resuming Claude");
          prompter.addRunMessage?.("Resuming Claude…", "status");
          // Re-sync the budget baseline: the proxy metered the pre-pause spend,
          // and setStep just zeroed the run's local token counter.
          await refreshBudget();
          nextPrompt =
            "Continue the Honch SDK installation from where you left off.";
          continue;
        }
        outcome = choice === "revert" ? "reverted" : "kept";
        break;
      }

      // Clear the agent-loop interrupt handler so a later ESC (e.g. during the
      // feedback prompt) doesn't fire a stale abort against the finished run.
      prompter.onInterrupt?.(() => {});

      agentRan = outcome !== "reverted";
      if (outcome === "completed") {
        // Did Claude actually touch project files? Combine two signals so a real
        // integration is never reported as "no changes": the git snapshot diff
        // (catches Bash writes, but is blind to submodules / nested repos /
        // ignored paths / non-git projects) and Claude's own Write/Edit tool
        // calls (authoritative, and sees through all of those). The setup report
        // Claude writes itself doesn't count — a report-only run isn't an install.
        const gitChanged = changedFilesSince(installDir, snapshot).filter(
          (file) => file !== "honch-setup-report.md",
        );
        const resolved = resolveInstallOutcome({
          agentWroteFiles: agentWrittenFiles.size > 0,
          gitChangedCount: gitChanged.length,
        });
        integrated = resolved.integrated;
        unverifiedByGit = resolved.unverifiedByGit;
        agentSummary = lastMessages.at(-1)?.trim();
        if (!integrated) {
          prompter.addRunMessage?.(
            "Claude did not change any project files",
            "error",
          );
        } else if (unverifiedByGit) {
          prompter.addRunMessage?.(
            "Claude changed files that aren't visible at the project root (submodule or ignored path) — review them directly",
            "status",
          );
        }
        prompter.addRunMessage?.("Verifying the integration", "status");
        verification.push("agent run completed");
        for (const result of verifyFirmwareInstall(
          target.id,
          installDir,
          undefined,
          projectApiKey,
        )) {
          const line = formatVerificationOutcome(result);
          verification.push(line);
          prompter.addRunMessage?.(
            line,
            result.status === "failed" ? "error" : "status",
          );
        }
      }
      if (branch && outcome !== "reverted") {
        commitAll(installDir, `honch: install ${target.label} SDK`);
        prompter.setSummary?.({ branch, baseBranch });
        prompter.addRunMessage?.(`Committed changes on ${branch}`, "status");
      }
      if (outcome === "reverted") {
        prompter.setSummary?.({ reverted: true });
        installReverted = true;
      }
      prompter.completeStep?.(
        "agent",
        outcome === "completed"
          ? "install completed"
          : outcome === "kept"
            ? "paused — changes kept"
            : "reverted",
      );
    } else {
      prompter.setStep?.("agent", "dry run");
      verification.push("dry run: no files modified");
      prompter.addRunMessage?.("Dry run — target files were not modified.");
      prompter.completeStep?.("agent", "skipped mutation");
    }

    prompter.setStep?.("report", "writing setup report");
    const report = buildSetupReport({
      targetLabel: target.label,
      projectName: project.name,
      deviceModel,
      agentRan,
      integrated,
      unverifiedByGit,
      agentSummary,
      verification,
      branch: installReverted ? undefined : branch,
      baseBranch,
      tryMode,
    });
    const reportPath = path.join(installDir, "honch-setup-report.md");
    writeFileSync(reportPath, report);
    prompter.setSummary?.({
      reportPath,
      reportMarkdown: report,
      integrated,
      // In Try mode the report knows it ran in a scratch project so the done
      // screen can surface (and offer to open) the temp folder.
      ...(tryMode ? { tempProject: installDir } : {}),
    });
    prompter.completeStep?.("report", reportPath);

    const outcome: "success" | "failed" | "reverted" = installReverted
      ? "reverted"
      : integrated === false
        ? "failed"
        : "success";

    track(
      "wizard_install_completed",
      buildInstallProperties({
        target: target.id,
        outcome,
        agentRan,
        durationMs: Date.now() - startedAt,
        totalTokens,
      }),
    );

    // Only ask for feedback after a successful/kept install — never after a bad
    // outcome (reverted or no-change failure), where it would read as tone-deaf.
    // This runs after the report step completes, so the user has seen the result.
    if (options.runAgent && !options.yes && outcome === "success") {
      await collectFeedback(
        prompter,
        { target: target.id, outcome },
        analyticsId,
      );
    }

    return { reportPath, agentRan };
  } finally {
    prompter.close();
  }
}

/**
 * Build the SDK picker option list — `{label, value, hint}` per id, with the
 * detected id (if any) badged "(detected)". Callers pass the ids in display
 * order (resolveTarget already sorts detected-first; runTryPath passes the
 * starter-capable ids in their own order).
 */
function buildTargetOptions(ids: SdkTargetId[], detectedId?: SdkTargetId) {
  return ids.map((id) => ({
    label: SDK_TARGETS[id].label,
    value: id,
    hint: SDK_TARGETS[id].verificationHint,
    ...(id === detectedId ? { badge: "(detected)" } : {}),
  }));
}

async function resolveTarget(
  requested: SdkTargetId | undefined,
  detected: SdkTarget[],
  prompter: Prompter,
  message?: string,
): Promise<SdkTarget> {
  if (requested) return SDK_TARGETS[requested];

  // Always show every SDK in a single list. When the scan detected one, pin it
  // to the top, badge it, and pre-select it — so "enter" accepts the detected
  // SDK while every other option stays one keypress away.
  const detectedTarget = detected[0];
  const orderedIds = (Object.keys(SDK_TARGETS) as SdkTargetId[]).sort(
    (a, b) => {
      if (a === detectedTarget?.id) return -1;
      if (b === detectedTarget?.id) return 1;
      return 0;
    },
  );
  const options = buildTargetOptions(orderedIds, detectedTarget?.id);

  const answer = await prompter.select({
    title: "Select SDK",
    message:
      message ??
      (detectedTarget
        ? `Detected ${detectedTarget.label} — press enter to use it, or pick another SDK.`
        : "Which SDK should I set up?"),
    ...(detectedTarget ? { defaultValue: detectedTarget.id } : {}),
    options,
  });
  return (
    SDK_TARGETS[answer as SdkTargetId] ??
    detectedTarget ??
    SDK_TARGETS["esp-idf"]
  );
}

/**
 * The "Try Honch" path: pick a starter-capable SDK, create a fresh temp scratch
 * directory, re-point the install there (via `setInstallDir`), and scaffold the
 * chosen starter into it (no confirm — Try is itself an explicit choice).
 */
async function runTryPath(
  detected: SdkTarget[],
  prompter: Prompter,
  scaffold: (
    installDir: string,
    target: SdkTargetId,
  ) => Promise<{ files: string[] }>,
  setInstallDir: (dir: string) => void,
): Promise<{ target: SdkTarget; scaffoldNote: string }> {
  // Only SDKs with a starter folder can be scaffolded into a scratch project.
  const starterIds = (Object.keys(SDK_TARGETS) as SdkTargetId[]).filter(
    starterAvailable,
  );
  const detectedId = detected[0]?.id;
  const detectedTryable =
    detectedId && starterIds.includes(detectedId) ? detectedId : undefined;
  const answer = await prompter.select({
    title: "Try Honch",
    message: "Which SDK do you want to try?",
    ...(detectedTryable ? { defaultValue: detectedTryable } : {}),
    options: buildTargetOptions(starterIds, detectedTryable),
  });
  const target =
    SDK_TARGETS[answer as SdkTargetId] ?? SDK_TARGETS[starterIds[0]];

  // Name the scratch dir by SDK for readability (honch-try-c-posix-Ab12Cd).
  // mkdtemp atomically creates a unique, 0700, unguessable leaf with the temp
  // dir as the ONLY fixed parent — no stable intermediate path (e.g. a shared
  // <tmpdir>/honch) an attacker on a multi-user box could pre-plant as a symlink
  // and redirect the install (which may seed a project key) into their space.
  const installDir = mkdtempSync(
    path.join(tmpdir(), `honch-try-${target.id}-`),
  );
  setInstallDir(installDir);

  const { files } = await scaffold(installDir, target.id);
  return {
    target,
    scaffoldNote: `scaffolded a starter ${target.label} project (${files.length} files)`,
  };
}

async function resolveAuth(options: CliOptions, prompter: Prompter) {
  // Note: the wizard LLM token is NOT minted here. It's created after the
  // project is selected (see runWorkflow) so it can be scoped to that project
  // for per-project usage metering.
  if (options.projectApiKey) {
    return { accessToken: "", mode: "local API key" };
  }

  if (options.authToken) {
    saveAuthSession({
      apiBaseUrl: options.apiBaseUrl,
      accessToken: options.authToken,
    });
    return { accessToken: options.authToken, mode: "token" };
  }

  const saved = loadAuthSession(options.apiBaseUrl);
  if (saved) {
    const activeSession = await refreshSavedSession(
      options.apiBaseUrl,
      saved,
      prompter,
    );
    if (activeSession) {
      prompter.addRunMessage?.(
        activeSession.email
          ? `Using saved Honch session for ${activeSession.email}`
          : "Using saved Honch session",
      );
      return {
        accessToken: activeSession.accessToken,
        mode: "saved session",
      };
    }
    prompter.addRunMessage?.(
      "Saved Honch session expired; opening your browser to sign in again.",
    );
  }

  prompter.addRunMessage?.("Opening your browser to sign in to Honch…");
  const login = await loginViaBrowser({
    apiBaseUrl: options.apiBaseUrl,
    onUrl: (url) =>
      prompter.addRunMessage?.(`If your browser didn't open, visit:\n${url}`),
  });
  saveBrowserAuthSession(options.apiBaseUrl, login);
  return { accessToken: login.token, mode: "browser login" };
}

async function refreshSavedSession(
  apiBaseUrl: string,
  saved: AuthSession,
  prompter: Prompter,
): Promise<AuthSession | undefined> {
  if (!saved.clientId || !saved.refreshToken) return saved;
  if (!shouldRefresh(saved)) return saved;

  try {
    const refreshed = await refreshOAuthSession({
      apiBaseUrl,
      clientId: saved.clientId,
      refreshToken: saved.refreshToken,
      scope: saved.scope,
    });
    saveBrowserAuthSession(apiBaseUrl, refreshed, saved.email);
    return {
      ...saved,
      accessToken: refreshed.token,
      refreshToken: refreshed.refreshToken ?? saved.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
      savedAt: new Date().toISOString(),
    };
  } catch {
    if (isExpired(saved)) return undefined;
    prompter.addRunMessage?.(
      "Could not refresh saved Honch session; using the cached access token.",
    );
    return saved;
  }
}

function saveBrowserAuthSession(
  apiBaseUrl: string,
  login: BrowserLoginResult,
  email?: string,
) {
  saveAuthSession({
    apiBaseUrl,
    accessToken: login.token,
    clientId: login.clientId,
    refreshToken: login.refreshToken,
    expiresAt: login.expiresAt,
    scope: login.scope,
    email,
  });
}

function shouldRefresh(session: AuthSession) {
  if (!session.expiresAt) return true;
  const expiresAt = Date.parse(session.expiresAt);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - Date.now() < 60_000;
}

function isExpired(session: AuthSession) {
  if (!session.expiresAt) return true;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt <= Date.now();
}

async function resolveProject(
  options: CliOptions,
  accessToken: string,
  platformClient: PlatformClient,
  prompter: Prompter,
): Promise<ProjectResponse> {
  if (options.projectApiKey) {
    return {
      id: "local",
      name: options.projectName ?? "Local Honch Project",
      apiKey: options.projectApiKey,
    };
  }

  const organizationId = await resolveOrganization(
    accessToken,
    platformClient,
    prompter,
  );

  const projects = await platformClient.listProjects(
    accessToken,
    organizationId,
  );

  // Let the user pick one of their existing projects, or create a new one.
  if (projects.length > 0) {
    const choice = await prompter.select({
      title: "Choose a project",
      message: "Pick an existing Honch project, or create a new one.",
      defaultValue: projects[0].id,
      options: [
        ...projects.map((project) => ({
          label: project.name,
          value: project.id,
        })),
        { label: "＋ Create a new project", value: CREATE_NEW_PROJECT },
      ],
    });
    const picked = projects.find((project) => project.id === choice);
    if (picked) return picked;
  }

  const name = (await prompter.question("Project name:")).trim();
  return platformClient.createProject(
    accessToken,
    name || "Honch Project",
    organizationId,
  );
}

async function resolveInterruption(
  installDir: string,
  snapshot: string | undefined,
  prompter: Prompter,
  verification: string[],
): Promise<"continue" | "revert" | "keep"> {
  const choice = await prompter.select({
    title: "Paused — what next?",
    message: "What would you like to do?",
    defaultValue: "continue",
    options: [
      { label: "Resume — let Claude keep working", value: "continue" },
      ...(snapshot
        ? [{ label: "Revert to before Claude's work", value: "revert" }]
        : []),
      { label: "Keep changes and stop here", value: "keep" },
    ],
  });

  if (choice === "revert" && snapshot) {
    restoreProject(installDir, snapshot);
    prompter.addRunMessage?.("Reverted Claude's changes.", "status");
    verification.push("interrupted — reverted Claude's changes");
    return "revert";
  }
  if (choice === "keep") {
    prompter.addRunMessage?.("Kept Claude's changes.", "status");
    verification.push("interrupted — kept Claude's changes");
    return "keep";
  }
  return "continue";
}

async function resolveOrganization(
  accessToken: string,
  platformClient: PlatformClient,
  prompter: Prompter,
): Promise<string | undefined> {
  const organizations = await platformClient.listOrganizations(accessToken);
  if (organizations.length === 0) return undefined;
  if (organizations.length === 1) return organizations[0].id;

  return prompter.select({
    title: "Choose an organization",
    message: "Which organization should this project belong to?",
    defaultValue: organizations[0].id,
    options: organizations.map((org) => ({
      label: org.name,
      value: org.id,
      hint: `You have ${org.role} privileges of ${org.name}`,
    })),
  });
}

/** Resolve a required value: use the preset if it's non-empty, otherwise ask,
 * re-asking until the user enters something non-empty. Mirrors requiredSecret —
 * a required field must never proceed empty and fail deeper in the install. */
export async function requiredInput(
  value: string | undefined,
  prompt: string,
  prompter: Prompter,
) {
  const provided = value?.trim();
  if (provided) return provided;
  while (true) {
    const answer = (await prompter.question(prompt)).trim();
    if (answer) return answer;
  }
}

/** Ask for a sensitive value, re-asking until the user enters something
 * non-empty. We don't validate the format — just guard against an accidental
 * empty submit that would fail deeper in the install. */
async function requiredSecret(prompt: string, prompter: Prompter) {
  while (true) {
    const value = (await prompter.question(prompt, { sensitive: true })).trim();
    if (value) return value;
  }
}

function formatVerificationOutcome(outcome: VerificationOutcome): string {
  const marker =
    outcome.status === "passed" ? "✓" : outcome.status === "failed" ? "✗" : "•";
  return `${marker} ${outcome.label}: ${outcome.detail}`;
}
