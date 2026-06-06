import { SDK_TARGETS, type SdkTargetId } from "../sdk/targets.js";

export type AgentPromptInput = {
  targetId: SdkTargetId;
  projectApiKeyRef: string;
  captureHost: string;
  deviceModel: string;
  firmwareVersion: string;
};

export function buildAgentPrompt(input: AgentPromptInput): string {
  const target = SDK_TARGETS[input.targetId];

  return `You are installing the Honch ${target.label} SDK in this client project.

Use the bundled SDK skill at ${target.skillPath}. Read it before editing files.

Project context:
- SDK target: ${target.label}
- Honch project API key: ${input.projectApiKeyRef}
- Capture host: ${input.captureHost}
- Device model: ${input.deviceModel}
- Firmware version: ${input.firmwareVersion}

Rules:
- Do not hardcode the project API key in source files. Pass the secret ref to local wizard tools that write env/config values.
- Do not weaken TLS defaults or endpoint validation.
- Do not change Honch SDK public APIs, wire formats, lifecycle semantics, queue policies, or retry behavior.
- Keep SDK delivery cooperative and application-owned; do not add hidden background tasks.
- Run build/test verification only. Do not send a live smoke event unless the user explicitly asks.
- Write honch-setup-report.md with modified files, verification run, and manual steps.`;
}
