import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildAgentPrompt } from "./agent/prompt.js";
import { runAgent } from "./agent/runner.js";
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
import { createPrompter, type Prompter } from "./cli/prompt.js";
import { installEspIdfHonchSubmodule } from "./firmware/esp-idf-install.js";
import {
  type VerificationOutcome,
  verifyFirmwareInstall,
} from "./firmware/verify.js";
import { PlatformClient, type ProjectResponse } from "./platform/client.js";
import { scanProject } from "./project/scan.js";
import {
  availableBranchName,
  changedFilesSince,
  commitAll,
  createBranch,
  currentBranch,
  hasCommits,
  isGitWorkTree,
  restoreProject,
  snapshotProject,
} from "./project/snapshot.js";
import { buildSetupReport } from "./report/setup-report.js";
import {
  SDK_TARGETS,
  type SdkTarget,
  type SdkTargetId,
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
  } = {},
): Promise<WorkflowResult> {
  const prompter = deps.prompter ?? createPrompter();
  const platformClient =
    deps.platformClient ?? new PlatformClient(options.apiBaseUrl);
  const vault = createSecretVault();

  try {
    prompter.setStep?.("scan", "reading project files");
    const scan = scanProject(options.installDir);
    const findings =
      scan.detectedTargets.length > 0
        ? scan.detectedTargets.map((target) => `Detected ${target.label}`)
        : ["No SDK auto-detected — you can pick one on the next screen."];
    if (prompter.welcome && !options.yes) {
      await prompter.welcome({
        body: "Hey — welcome to the Honch installer! I'll wire the Honch SDK into your project in a few quick steps. First, I took a look around to see what you're working with.",
        lines: findings,
      });
    }
    prompter.completeStep?.(
      "scan",
      scan.detectedTargets.length > 0
        ? `detected ${scan.detectedTargets.map((target) => target.label).join(", ")}`
        : "no target auto-detected",
    );

    prompter.setStep?.("target", "selecting SDK target");
    const target = await resolveTarget(
      options.target,
      scan.detectedTargets,
      prompter,
    );
    prompter.setSummary?.({ sdkTarget: target.label });
    prompter.completeStep?.("target", target.label);

    prompter.setStep?.("auth", "connecting Honch account");
    const auth = await resolveAuth(options, prompter);
    prompter.setSummary?.({ authMode: auth.mode });
    prompter.completeStep?.(
      "auth",
      auth.accessToken
        ? "platform authenticated"
        : "local credentials supplied",
    );

    prompter.setStep?.("project", "loading Honch projects");
    const project = await resolveProject(
      options,
      auth.accessToken,
      platformClient,
      prompter,
    );
    prompter.setSummary?.({ projectName: project.name });
    prompter.completeStep?.("project", project.name);

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
      project.apiKey ??
      (await prompter.question("Project API key:", { sensitive: true }));
    const projectApiKeyRef = vault.put("Honch project API key", projectApiKey);
    prompter.completeStep?.("config", "device settings ready");

    prompter.setStep?.("confirm", "waiting for confirmation");
    // The ESP-IDF flow git-inits the project itself, so revert always works
    // there; for other targets it only works if this is already a git repo.
    const gitRepo = isGitWorkTree(options.installDir);
    const revertable = target.id === "esp-idf" || gitRepo;
    const canBranch =
      options.runAgent && gitRepo && hasCommits(options.installDir);

    let branch: string | undefined;
    let baseBranch: string | undefined;
    let installReverted = false;
    if (options.yes) {
      // Non-interactive: install on the current branch, no prompt.
    } else if (canBranch) {
      const desired = availableBranchName(options.installDir, "honch/setup");
      const choice = await prompter.select({
        title: "Review install plan",
        message: `Install Honch ${target.label} into ${options.installDir}?`,
        defaultValue: "branch",
        options: [
          { label: "Work on a new branch", value: "branch", hint: desired },
          { label: "Work on the current branch", value: "current" },
          { label: "Cancel", value: "cancel" },
        ],
      });
      if (choice === "cancel") {
        throw new Error("Wizard cancelled before project mutation");
      }
      if (choice === "branch") branch = desired;
    } else {
      const warning =
        options.runAgent && !revertable
          ? "\n\n⚠ This folder isn't a git repo, so Claude's changes can't be auto-reverted. Run `git init` first if you want that safety net."
          : "";
      const confirmed = await prompter.confirm(
        `Install Honch ${target.label} into ${options.installDir}?${warning}`,
      );
      if (!confirmed) {
        throw new Error("Wizard cancelled before project mutation");
      }
    }
    prompter.completeStep?.(
      "confirm",
      branch ? `branch ${branch}` : "install approved",
    );

    let agentRan = false;
    // Whether Claude actually changed project files. undefined = not applicable
    // (dry run / reverted / non-git project where we can't tell).
    let integrated: boolean | undefined;
    let agentSummary: string | undefined;
    const verification: string[] = [];
    if (options.runAgent && wizardToken) {
      prompter.setStep?.("agent", "running Claude Agent SDK");
      if (branch) {
        baseBranch = currentBranch(options.installDir);
        createBranch(options.installDir, branch);
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
        const install = installEspIdfHonchSubmodule(options.installDir);
        verification.push(install.message);
        prompter.addRunMessage?.(install.message, "status");
      }
      prompter.addRunMessage?.("Preparing the install plan", "status");
      const prompt = buildAgentPrompt({
        targetId: target.id,
        projectApiKeyRef,
        deviceModel,
      });
      prompter.addRunMessage?.(
        "Handing off to Claude — press esc to pause",
        "status",
      );
      // Snapshot the project right before Claude touches it so the user can
      // revert its work if they pause the run.
      const snapshot = snapshotProject(options.installDir);

      let sessionId: string | undefined;
      let nextPrompt = prompt;
      let outcome: "completed" | "kept" | "reverted" = "completed";
      let lastMessages: string[] = [];

      while (true) {
        const abort = new AbortController();
        prompter.onInterrupt?.(() => {
          prompter.addRunMessage?.("Pausing Claude…", "status");
          abort.abort();
        });
        const result = await runAgent({
          cwd: options.installDir,
          prompt: nextPrompt,
          resume: sessionId,
          platformToken: wizardToken,
          abortController: abort,
          llmBaseUrl: `${options.apiBaseUrl.replace(/\/+$/, "")}/api/wizard/llm`,
          onEvent: (event) => {
            if (event.kind === "retry") {
              prompter.setTransientStatus?.(event.text);
            } else {
              prompter.addRunMessage?.(event.text, event.kind);
            }
          },
          mcpServers: {
            "honch-tools": createLocalToolsServer({
              workingDirectory: options.installDir,
              secretVault: vault,
            }),
          },
        });
        sessionId = result.sessionId ?? sessionId;
        if (result.messages.length > 0) lastMessages = result.messages;

        if (!abort.signal.aborted) break;

        const choice = await resolveInterruption(
          options.installDir,
          snapshot,
          prompter,
          verification,
        );
        if (choice === "continue") {
          prompter.setStep?.("agent", "resuming Claude");
          prompter.addRunMessage?.("Resuming Claude…", "status");
          nextPrompt =
            "Continue the Honch SDK installation from where you left off.";
          continue;
        }
        outcome = choice === "revert" ? "reverted" : "kept";
        break;
      }

      agentRan = outcome !== "reverted";
      if (outcome === "completed") {
        // Did Claude actually touch project files? The setup report it writes
        // doesn't count — a report-only run means it couldn't integrate.
        const changed = changedFilesSince(options.installDir, snapshot).filter(
          (file) => file !== "honch-setup-report.md",
        );
        integrated = changed.length > 0;
        agentSummary = lastMessages.at(-1)?.trim();
        if (!integrated) {
          prompter.addRunMessage?.(
            "Claude did not change any project files",
            "error",
          );
        }
        prompter.addRunMessage?.("Verifying the integration", "status");
        verification.push("agent run completed");
        for (const result of verifyFirmwareInstall(
          target.id,
          options.installDir,
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
        commitAll(options.installDir, `honch: install ${target.label} SDK`);
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
          ? "agent install completed"
          : outcome === "kept"
            ? "stopped — changes kept"
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
      agentSummary,
      verification,
      branch: installReverted ? undefined : branch,
      baseBranch,
    });
    const reportPath = path.join(options.installDir, "honch-setup-report.md");
    writeFileSync(reportPath, report);
    prompter.setSummary?.({ reportPath, reportMarkdown: report, integrated });
    prompter.completeStep?.("report", reportPath);
    return { reportPath, agentRan };
  } finally {
    prompter.close();
  }
}

async function resolveTarget(
  requested: SdkTargetId | undefined,
  detected: SdkTarget[],
  prompter: Prompter,
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
  const options = orderedIds.map((id) => ({
    label: SDK_TARGETS[id].label,
    value: id,
    hint: SDK_TARGETS[id].verificationHint,
    ...(id === detectedTarget?.id ? { badge: "(detected)" } : {}),
  }));

  const answer = await prompter.select({
    title: "Select SDK",
    message: detectedTarget
      ? `Detected ${detectedTarget.label} — press enter to use it, or pick another SDK.`
      : "Which SDK should I set up?",
    ...(detectedTarget ? { defaultValue: detectedTarget.id } : {}),
    options,
  });
  return (
    SDK_TARGETS[answer as SdkTargetId] ??
    detectedTarget ??
    SDK_TARGETS["esp-idf"]
  );
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

  const name = (await prompter.question("New project name:")).trim();
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
    title: "Claude paused",
    message: "What would you like to do?",
    defaultValue: "continue",
    options: [
      { label: "Continue — let Claude keep working", value: "continue" },
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
      hint: org.role,
    })),
  });
}

async function requiredInput(
  value: string | undefined,
  prompt: string,
  prompter: Prompter,
) {
  return value ?? prompter.question(prompt);
}

function formatVerificationOutcome(outcome: VerificationOutcome): string {
  const marker =
    outcome.status === "passed" ? "✓" : outcome.status === "failed" ? "✗" : "•";
  return `${marker} ${outcome.label}: ${outcome.detail}`;
}
