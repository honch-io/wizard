import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildAgentPrompt } from "./agent/prompt.js";
import { runAgent } from "./agent/runner.js";
import { loginViaBrowser } from "./auth/browser-login.js";
import { loadAuthSession, saveAuthSession } from "./auth/session.js";
import type { CliOptions } from "./cli/options.js";
import { createPrompter, type Prompter } from "./cli/prompt.js";
import { installEspIdfHonchSubmodule } from "./firmware/esp-idf-install.js";
import {
  type VerificationOutcome,
  verifyFirmwareInstall,
} from "./firmware/verify.js";
import { PlatformClient, type ProjectResponse } from "./platform/client.js";
import { scanProject } from "./project/scan.js";
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
        ? scan.detectedTargets.map(
            (target) => `Detected a ${target.label} project`,
          )
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
    const auth = await resolveAuth(options, platformClient, prompter);
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

    prompter.setStep?.("config", "collecting device configuration");
    const deviceModel = await requiredInput(
      options.deviceModel,
      "Device model:",
      prompter,
    );
    prompter.setSummary?.({ deviceModel });
    const firmwareVersion = await requiredInput(
      options.firmwareVersion,
      "Firmware version:",
      prompter,
    );
    prompter.setSummary?.({ firmwareVersion });
    const captureHost =
      options.captureHost ??
      normalizeDefault(
        await prompter.question("Capture host:", { sensitive: false }),
        "https://capture.honch.io",
      ) ??
      "https://capture.honch.io";
    prompter.setSummary?.({ captureHost });
    const projectApiKey =
      project.apiKey ?? (await prompter.question("Project API key:"));
    const projectApiKeyRef = vault.put("Honch project API key", projectApiKey);
    prompter.completeStep?.("config", "device and capture settings ready");

    prompter.setStep?.("confirm", "waiting for confirmation");
    const confirmed =
      options.yes ||
      (await prompter.confirm(
        `Install Honch ${target.label} into ${options.installDir}?`,
      ));
    if (!confirmed) {
      throw new Error("Wizard cancelled before project mutation");
    }
    prompter.completeStep?.("confirm", "install approved");

    let agentRan = false;
    const verification: string[] = [];
    if (options.runAgent && auth.wizardToken) {
      prompter.setStep?.("agent", "running Claude Agent SDK");
      if (target.id === "esp-idf") {
        prompter.addRunMessage?.(
          "Registering Honch SDK component (git submodule)",
        );
        const install = installEspIdfHonchSubmodule(options.installDir);
        verification.push(install.message);
        prompter.addRunMessage?.(install.message);
      }
      prompter.addRunMessage?.("Building Honch SDK installation prompt");
      const prompt = buildAgentPrompt({
        targetId: target.id,
        projectApiKeyRef,
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
      for (const result of verifyFirmwareInstall(
        target.id,
        options.installDir,
        undefined,
        projectApiKey,
      )) {
        const line = formatVerificationOutcome(result);
        verification.push(line);
        prompter.addRunMessage?.(line);
      }
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

async function resolveTarget(
  requested: SdkTargetId | undefined,
  detected: SdkTarget[],
  prompter: Prompter,
): Promise<SdkTarget> {
  if (requested) return SDK_TARGETS[requested];
  const recommendedId = detected[0]?.id ?? "esp-idf";
  const answer = await prompter.question(
    `SDK target (${Object.keys(SDK_TARGETS).join(", ")}):`,
    {
      recommend: {
        value: recommendedId,
        source: detected.length > 0 ? "detected" : "recommended",
      },
    },
  );
  return SDK_TARGETS[answer as SdkTargetId] ?? SDK_TARGETS[recommendedId];
}

async function resolveAuth(
  options: CliOptions,
  platformClient: PlatformClient,
  prompter: Prompter,
) {
  if (options.projectApiKey) {
    return { accessToken: "", wizardToken: undefined, mode: "local API key" };
  }

  if (options.authToken) {
    const wizardToken = options.runAgent
      ? (await platformClient.createWizardToken(options.authToken)).accessToken
      : undefined;
    saveAuthSession({
      apiBaseUrl: options.apiBaseUrl,
      accessToken: options.authToken,
    });
    return { accessToken: options.authToken, wizardToken, mode: "token" };
  }

  const saved = loadAuthSession(options.apiBaseUrl);
  if (saved) {
    prompter.addRunMessage?.(
      saved.email
        ? `Using saved Honch session for ${saved.email}`
        : "Using saved Honch session",
    );
    const wizardToken = options.runAgent
      ? (await platformClient.createWizardToken(saved.accessToken)).accessToken
      : undefined;
    return {
      accessToken: saved.accessToken,
      wizardToken,
      mode: "saved session",
    };
  }

  prompter.addRunMessage?.("Opening your browser to sign in to Honch…");
  const { token: accessToken } = await loginViaBrowser({
    apiBaseUrl: options.apiBaseUrl,
    onUrl: (url) =>
      prompter.addRunMessage?.(`If your browser didn't open, visit:\n${url}`),
  });
  const wizardToken = options.runAgent
    ? (await platformClient.createWizardToken(accessToken)).accessToken
    : undefined;
  saveAuthSession({
    apiBaseUrl: options.apiBaseUrl,
    accessToken,
  });
  return { accessToken, wizardToken, mode: "browser login" };
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

  const organizationId = await prompter.question(
    "Organization ID (leave blank for single-org accounts):",
  );
  const projects = await platformClient.listProjects(
    accessToken,
    organizationId || undefined,
  );
  const existing = projects[0];
  const answer = await prompter.question(
    existing
      ? `Project name or blank for ${existing.name}:`
      : "Project name to create:",
  );
  const projectName = answer.trim();
  if (!projectName && existing) return existing;
  const byName = projects.find((project) => project.name === projectName);
  if (byName) return byName;
  return platformClient.createProject(
    accessToken,
    projectName || "Honch Project",
    organizationId || undefined,
  );
}

async function requiredInput(
  value: string | undefined,
  prompt: string,
  prompter: Prompter,
) {
  return value ?? prompter.question(prompt);
}

function normalizeDefault(value: string, fallback: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function formatVerificationOutcome(outcome: VerificationOutcome): string {
  const marker =
    outcome.status === "passed" ? "✓" : outcome.status === "failed" ? "✗" : "•";
  return `${marker} ${outcome.label}: ${outcome.detail}`;
}
