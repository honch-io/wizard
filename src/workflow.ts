import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildAgentPrompt } from "./agent/prompt.js";
import { runAgent } from "./agent/runner.js";
import type { CliOptions } from "./cli/options.js";
import { createPrompter, type Prompter } from "./cli/prompt.js";
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
    const scan = scanProject(options.installDir);
    const target = await resolveTarget(
      options.target,
      scan.detectedTargets,
      prompter,
    );
    const auth = await resolveAuth(options, platformClient, prompter);
    const project = await resolveProject(
      options,
      auth.accessToken,
      platformClient,
      prompter,
    );
    const deviceModel = await requiredInput(
      options.deviceModel,
      "Device model:",
      prompter,
    );
    const firmwareVersion = await requiredInput(
      options.firmwareVersion,
      "Firmware version:",
      prompter,
    );
    const captureHost =
      options.captureHost ??
      (await prompter.question("Capture host:", { sensitive: false })) ??
      "https://capture.honch.io";
    const projectApiKey =
      project.apiKey ?? (await prompter.question("Project API key:"));
    const projectApiKeyRef = vault.put("Honch project API key", projectApiKey);

    const confirmed =
      options.yes ||
      (await prompter.confirm(
        `Install Honch ${target.label} into ${options.installDir}?`,
      ));
    if (!confirmed) {
      throw new Error("Wizard cancelled before project mutation");
    }

    let agentRan = false;
    const verification: string[] = [];
    if (options.runAgent && auth.wizardToken) {
      const prompt = buildAgentPrompt({
        targetId: target.id,
        projectApiKeyRef,
        captureHost,
        deviceModel,
        firmwareVersion,
      });
      await runAgent({
        cwd: options.installDir,
        prompt,
        platformToken: auth.wizardToken,
        llmBaseUrl: `${options.apiBaseUrl.replace(/\/+$/, "")}/api/wizard/llm`,
        mcpServers: {
          "honcho-tools": createLocalToolsServer({
            workingDirectory: options.installDir,
            secretVault: vault,
          }),
        },
      });
      agentRan = true;
      verification.push("agent run completed");
    } else {
      verification.push("dry run: no files modified");
    }

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
) {
  if (options.projectApiKey) {
    return { accessToken: "", wizardToken: undefined };
  }

  if (options.authToken) {
    const wizardToken = options.runAgent
      ? (await platformClient.createWizardToken(options.authToken)).accessToken
      : undefined;
    return { accessToken: options.authToken, wizardToken };
  }

  const mode = (
    await prompter.question("Login or signup? [login/signup]:")
  ).trim();
  const email = await prompter.question("Email:");
  const password = await prompter.question("Password:", { sensitive: true });
  const token =
    mode === "signup"
      ? await platformClient.register({ email, password })
      : await platformClient.login({ email, password });
  const wizardToken = options.runAgent
    ? (await platformClient.createWizardToken(token.accessToken)).accessToken
    : undefined;
  return { accessToken: token.accessToken, wizardToken };
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
  if (!answer && existing) return existing;
  const byName = projects.find((project) => project.name === answer);
  if (byName) return byName;
  return platformClient.createProject(
    accessToken,
    answer,
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
