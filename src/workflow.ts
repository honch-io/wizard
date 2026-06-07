import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildAgentPrompt } from "./agent/prompt.js";
import { runAgent } from "./agent/runner.js";
import { loadAuthSession, saveAuthSession } from "./auth/session.js";
import type { CliOptions } from "./cli/options.js";
import { createPrompter, GO_BACK, type Prompter } from "./cli/prompt.js";
import { PlatformClient, type ProjectResponse } from "./platform/client.js";
import { type ProjectScan, scanProject } from "./project/scan.js";
import { buildSetupReport } from "./report/setup-report.js";
import {
  SDK_TARGETS,
  type SdkTarget,
  type SdkTargetId,
} from "./sdk/targets.js";
import { createSecretVault, type SecretVault } from "./secrets/vault.js";
import { createLocalToolsServer } from "./tools/mcp-server.js";

export type WorkflowResult = {
  reportPath: string;
  agentRan: boolean;
};

type AuthResult = {
  accessToken: string;
  wizardToken: string | undefined;
  mode: string;
};

type WorkflowState = {
  target?: SdkTarget;
  auth?: AuthResult;
  project?: ProjectResponse;
  projectApiKeyRef?: string;
  deviceModel?: string;
  firmwareVersion?: string;
  captureHost?: string;
};

type StepDeps = {
  options: CliOptions;
  prompter: Prompter;
  platformClient: PlatformClient;
  vault: SecretVault;
  scan: ProjectScan;
};

type Step = (
  deps: StepDeps,
  state: WorkflowState,
  canBack: boolean,
) => Promise<void>;

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
    prompter.completeStep?.(
      "scan",
      scan.detectedTargets.length > 0
        ? `detected ${scan.detectedTargets.map((target) => target.label).join(", ")}`
        : "no target auto-detected",
    );

    const state: WorkflowState = {};
    const stepDeps: StepDeps = {
      options,
      prompter,
      platformClient,
      vault,
      scan,
    };

    // Interactive steps support going back: a step that throws GO_BACK returns
    // the driver to the previous step instead of aborting the wizard.
    const steps: Step[] = [
      stepTarget,
      stepAuth,
      stepProject,
      stepDeviceModel,
      stepFirmware,
      stepCaptureHost,
      stepConfirm,
    ];

    let index = 0;
    while (index < steps.length) {
      try {
        await steps[index](stepDeps, state, index > 0);
        index += 1;
      } catch (error) {
        if (error === GO_BACK) {
          index = Math.max(0, index - 1);
          continue;
        }
        throw error;
      }
    }

    // Past confirmation the wizard mutates the target project, so there is no
    // going back from here.
    const target = state.target as SdkTarget;
    const auth = state.auth as AuthResult;
    const project = state.project as ProjectResponse;
    const deviceModel = state.deviceModel as string;
    const firmwareVersion = state.firmwareVersion as string;
    const captureHost = state.captureHost as string;

    let agentRan = false;
    const verification: string[] = [];
    if (options.runAgent && auth.wizardToken) {
      prompter.setStep?.("agent", "running Claude Agent SDK");
      prompter.addRunMessage?.("Building Honch SDK installation prompt");
      const prompt = buildAgentPrompt({
        targetId: target.id,
        projectApiKeyRef: state.projectApiKeyRef as string,
        captureHost,
        deviceModel,
        firmwareVersion,
      });
      prompter.addRunMessage?.("Starting agent with local Honcho MCP tools");
      await runAgent({
        cwd: options.installDir,
        prompt,
        platformToken: auth.wizardToken,
        llmBaseUrl: `${options.apiBaseUrl.replace(/\/+$/, "")}/api/wizard/llm`,
        onEvent: (event) => {
          prompter.addRunMessage?.(event.text);
        },
        mcpServers: {
          "honcho-tools": createLocalToolsServer({
            workingDirectory: options.installDir,
            secretVault: vault,
          }),
        },
      });
      agentRan = true;
      verification.push("agent run completed");
      prompter.completeStep?.("agent", "agent install completed");
    } else {
      prompter.setStep?.("agent", "dry run selected");
      verification.push("dry run: no files modified");
      prompter.addRunMessage?.(
        "Dry run selected; target files were not mutated",
      );
      prompter.completeStep?.("agent", "skipped mutation");
    }

    prompter.setStep?.("report", "writing setup report");
    const report = buildSetupReport({
      targetLabel: target.label,
      projectName: project.name,
      captureHost,
      deviceModel,
      firmwareVersion,
      agentRan,
      verification,
    });
    const reportPath = path.join(options.installDir, "honch-setup-report.md");
    writeFileSync(reportPath, report);
    prompter.setSummary?.({ reportPath });
    prompter.completeStep?.("report", reportPath);
    return { reportPath, agentRan };
  } finally {
    prompter.close();
  }
}

const stepTarget: Step = async (deps, state) => {
  deps.prompter.setStep?.("target", "selecting SDK target");
  const target = await resolveTarget(
    deps.options.target,
    deps.scan.detectedTargets,
    deps.prompter,
  );
  state.target = target;
  deps.prompter.setSummary?.({ sdkTarget: target.label });
  deps.prompter.completeStep?.("target", target.label);
};

const stepAuth: Step = async (deps, state, canBack) => {
  deps.prompter.setStep?.("auth", "connecting Honch account");
  const auth = await resolveAuth(
    deps.options,
    deps.platformClient,
    deps.prompter,
    canBack,
  );
  state.auth = auth;
  deps.prompter.setSummary?.({ authMode: auth.mode });
  deps.prompter.completeStep?.(
    "auth",
    auth.accessToken ? "platform authenticated" : "local credentials supplied",
  );
};

const stepProject: Step = async (deps, state, canBack) => {
  deps.prompter.setStep?.("project", "loading Honch projects");
  const project = await resolveProject(
    deps.options,
    (state.auth as AuthResult).accessToken,
    deps.platformClient,
    deps.prompter,
    canBack,
  );
  state.project = project;
  const projectApiKey =
    project.apiKey ??
    (await deps.prompter.question("Project API key:", { allowBack: canBack }));
  state.projectApiKeyRef = deps.vault.put(
    "Honch project API key",
    projectApiKey,
  );
  deps.prompter.setSummary?.({ projectName: project.name });
  deps.prompter.completeStep?.("project", project.name);
};

const stepDeviceModel: Step = async (deps, state, canBack) => {
  deps.prompter.setStep?.("config", "collecting device configuration");
  state.deviceModel = await requiredInput(
    deps.options.deviceModel,
    "Device model:",
    deps.prompter,
    { allowBack: canBack, defaultValue: state.deviceModel },
  );
  deps.prompter.setSummary?.({ deviceModel: state.deviceModel });
};

const stepFirmware: Step = async (deps, state, canBack) => {
  deps.prompter.setStep?.("config", "collecting device configuration");
  state.firmwareVersion = await requiredInput(
    deps.options.firmwareVersion,
    "Firmware version:",
    deps.prompter,
    { allowBack: canBack, defaultValue: state.firmwareVersion },
  );
  deps.prompter.setSummary?.({ firmwareVersion: state.firmwareVersion });
};

const stepCaptureHost: Step = async (deps, state, canBack) => {
  deps.prompter.setStep?.("config", "collecting device configuration");
  if (deps.options.captureHost) {
    state.captureHost = deps.options.captureHost;
  } else {
    const answer = await deps.prompter.question("Capture host:", {
      allowBack: canBack,
      defaultValue: state.captureHost ?? "https://capture.honch.io",
    });
    state.captureHost = normalizeDefault(answer, "https://capture.honch.io");
  }
  deps.prompter.setSummary?.({ captureHost: state.captureHost });
  deps.prompter.completeStep?.("config", "device and capture settings ready");
};

const stepConfirm: Step = async (deps, state, canBack) => {
  deps.prompter.setStep?.("confirm", "waiting for confirmation");
  const confirmed =
    deps.options.yes ||
    (await deps.prompter.confirm(
      `Install Honch ${(state.target as SdkTarget).label} into ${deps.options.installDir}?`,
      { allowBack: canBack },
    ));
  if (!confirmed) {
    throw new Error("Wizard cancelled before project mutation");
  }
  deps.prompter.completeStep?.("confirm", "install approved");
};

async function resolveTarget(
  requested: SdkTargetId | undefined,
  detected: SdkTarget[],
  prompter: Prompter,
): Promise<SdkTarget> {
  if (requested) return SDK_TARGETS[requested];
  if (detected.length === 1) return detected[0];
  const answer = await prompter.question(
    `SDK target (${Object.keys(SDK_TARGETS).join(", ")}):`,
  );
  return SDK_TARGETS[answer as SdkTargetId] ?? SDK_TARGETS["esp-idf"];
}

async function resolveAuth(
  options: CliOptions,
  platformClient: PlatformClient,
  prompter: Prompter,
  canBack: boolean,
): Promise<AuthResult> {
  if (options.projectApiKey) {
    return { accessToken: "", wizardToken: undefined, mode: "local API key" };
  }

  if (options.authToken) {
    const authToken = options.authToken;
    const wizardToken = options.runAgent
      ? (
          await withRetry(prompter, "Connecting to Honch", () =>
            platformClient.createWizardToken(authToken),
          )
        ).accessToken
      : undefined;
    saveAuthSession({
      apiBaseUrl: options.apiBaseUrl,
      accessToken: authToken,
    });
    return { accessToken: authToken, wizardToken, mode: "token" };
  }

  const saved = loadAuthSession(options.apiBaseUrl);
  if (saved) {
    prompter.addRunMessage?.(
      saved.email
        ? `Using saved Honch session for ${saved.email}`
        : "Using saved Honch session",
    );
    const wizardToken = options.runAgent
      ? (
          await withRetry(prompter, "Connecting to Honch", () =>
            platformClient.createWizardToken(saved.accessToken),
          )
        ).accessToken
      : undefined;
    return {
      accessToken: saved.accessToken,
      wizardToken,
      mode: "saved session",
    };
  }

  // Fresh login/signup. A failed sign-in re-prompts credentials instead of
  // aborting the whole wizard.
  while (true) {
    const mode = (
      await prompter.question("Login or signup? [login/signup]:", {
        allowBack: canBack,
      })
    ).trim();
    const email = await prompter.question("Email:");
    const password = await prompter.question("Password:", { sensitive: true });
    try {
      const token =
        mode === "signup"
          ? await platformClient.register({ email, password })
          : await platformClient.login({ email, password });
      const wizardToken = options.runAgent
        ? (
            await withRetry(prompter, "Connecting to Honch", () =>
              platformClient.createWizardToken(token.accessToken),
            )
          ).accessToken
        : undefined;
      saveAuthSession({
        apiBaseUrl: options.apiBaseUrl,
        accessToken: token.accessToken,
        email,
      });
      return { accessToken: token.accessToken, wizardToken, mode };
    } catch (error) {
      if (error === GO_BACK) throw error;
      const choice = await prompter.select(
        "Sign-in failed",
        describeError(error),
        [
          { label: "Try again", value: "retry", hint: "re-enter credentials" },
          { label: "Cancel", value: "cancel", hint: "exit the wizard" },
        ],
      );
      if (choice !== "retry") throw error;
    }
  }
}

async function resolveProject(
  options: CliOptions,
  accessToken: string,
  platformClient: PlatformClient,
  prompter: Prompter,
  canBack: boolean,
): Promise<ProjectResponse> {
  if (options.projectApiKey) {
    return {
      id: "local",
      name: options.projectName ?? "Local Honch Project",
      apiKey: options.projectApiKey,
    };
  }

  // Each Honch account belongs to exactly one organization, which the platform
  // resolves automatically from the session — no need to ask the user for it.
  const projects = await withRetry(prompter, "Loading projects", () =>
    platformClient.listProjects(accessToken),
  );
  const existing = projects[0];
  const answer = await prompter.question(
    existing
      ? `Project name or blank for ${existing.name}:`
      : "Project name to create:",
    { allowBack: canBack },
  );
  const projectName = answer.trim();
  if (!projectName && existing) return existing;
  const byName = projects.find((project) => project.name === projectName);
  if (byName) return byName;
  return withRetry(prompter, "Creating project", () =>
    platformClient.createProject(accessToken, projectName || "Honch Project"),
  );
}

async function requiredInput(
  value: string | undefined,
  prompt: string,
  prompter: Prompter,
  options?: { allowBack?: boolean; defaultValue?: string },
) {
  return value ?? prompter.question(prompt, options);
}

/**
 * Runs a platform call, and on failure offers the user a Retry/Cancel choice
 * instead of crashing the wizard. Re-throws GO_BACK untouched so the step
 * driver can still navigate backwards.
 */
async function withRetry<T>(
  prompter: Prompter,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (error === GO_BACK) throw error;
      const choice = await prompter.select(
        `${label} failed`,
        describeError(error),
        [
          { label: "Retry", value: "retry", hint: "try again" },
          { label: "Cancel", value: "cancel", hint: "exit the wizard" },
        ],
      );
      if (choice !== "retry") throw error;
    }
  }
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "fetch failed" || message.includes("ECONNREFUSED")) {
    return "Could not reach the Honch platform. Make sure it is running, then retry.";
  }
  return message;
}

function normalizeDefault(value: string, fallback: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}
