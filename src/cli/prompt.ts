import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { SDK_TARGETS, type SdkTargetId } from "../sdk/targets.js";

export type WizardStepId =
  | "scan"
  | "target"
  | "auth"
  | "project"
  | "config"
  | "confirm"
  | "agent"
  | "report";

export type WizardStep = {
  id: WizardStepId;
  label: string;
  status: "pending" | "active" | "done";
  detail?: string;
};

export type WizardSummary = {
  targetProject?: string;
  platformApi?: string;
  sdkTarget?: string;
  authMode?: string;
  projectName?: string;
  captureHost?: string;
  deviceModel?: string;
  firmwareVersion?: string;
  runMode?: string;
  reportPath?: string;
};

export type PromptOption = {
  label: string;
  value: string;
  hint?: string;
};

export type PromptRequest = {
  id: number;
  title: string;
  message: string;
  kind: "text" | "password" | "select" | "confirm";
  options: PromptOption[];
  defaultValue?: string;
};

export type TuiSnapshot = {
  steps: WizardStep[];
  summary: WizardSummary;
  currentPrompt?: PromptRequest;
  runMessages: Array<{ id: number; text: string }>;
  error?: string;
  completed?: boolean;
};

export type Prompter = {
  question(prompt: string, options?: { sensitive?: boolean }): Promise<string>;
  confirm(prompt: string): Promise<boolean>;
  close(): void;
  cancel?(message?: string): void;
  setStep?(id: WizardStepId, detail?: string): void;
  completeStep?(id: WizardStepId, detail?: string): void;
  setSummary?(summary: Partial<WizardSummary>): void;
  addRunMessage?(message: string): void;
  finish?(summary: Partial<WizardSummary>): void;
  fail?(message: string): void;
};

const INITIAL_STEPS: WizardStep[] = [
  { id: "scan", label: "Scan project", status: "pending" },
  { id: "target", label: "SDK target", status: "pending" },
  { id: "auth", label: "Honch auth", status: "pending" },
  { id: "project", label: "Project", status: "pending" },
  { id: "config", label: "SDK config", status: "pending" },
  { id: "confirm", label: "Confirm", status: "pending" },
  { id: "agent", label: "AI install", status: "pending" },
  { id: "report", label: "Report", status: "pending" },
];

type PendingPrompt = {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

export class TuiPrompter implements Prompter {
  private snapshot: TuiSnapshot;
  private listeners = new Set<() => void>();
  private promptId = 0;
  private runMessageId = 0;
  private pending?: PendingPrompt;

  constructor(summary: WizardSummary) {
    this.snapshot = {
      steps: INITIAL_STEPS.map((step) => ({ ...step })),
      summary,
      runMessages: [],
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  question(prompt: string, options?: { sensitive?: boolean }): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = this.buildRequest(prompt, options?.sensitive ?? false);
      this.pending = { resolve, reject };
      this.update({ currentPrompt: request });
    });
  }

  confirm(prompt: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve: (value) => resolve(value === "yes"), reject };
      this.update({
        currentPrompt: {
          id: ++this.promptId,
          title: "Review install plan",
          message: prompt.replace(/\?$/, ""),
          kind: "confirm",
          options: [
            {
              label: "Install Honch",
              value: "yes",
              hint: "run selected setup path",
            },
            { label: "Cancel", value: "no", hint: "leave project untouched" },
          ],
        },
      });
    });
  }

  answer(value: string) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    this.update({ currentPrompt: undefined });
    pending.resolve(value);
  }

  setStep(id: WizardStepId, detail?: string) {
    this.updateSteps(id, "active", detail);
  }

  completeStep(id: WizardStepId, detail?: string) {
    this.updateSteps(id, "done", detail);
  }

  setSummary(summary: Partial<WizardSummary>) {
    this.update({ summary: { ...this.snapshot.summary, ...summary } });
  }

  addRunMessage(message: string) {
    this.update({
      runMessages: [
        ...this.snapshot.runMessages.slice(-6),
        { id: ++this.runMessageId, text: message },
      ],
    });
  }

  finish(summary: Partial<WizardSummary>) {
    this.update({
      completed: true,
      currentPrompt: undefined,
      summary: { ...this.snapshot.summary, ...summary },
    });
  }

  fail(message: string) {
    this.update({ error: message, currentPrompt: undefined });
  }

  cancel(message = "Wizard cancelled") {
    const pending = this.pending;
    this.pending = undefined;
    this.update({ currentPrompt: undefined, error: message });
    pending?.reject(new Error(message));
  }

  close() {
    // The CLI paints a final completion/error frame after runWorkflow returns.
    // Keep listeners alive until Ink unmounts the app.
  }

  private buildRequest(prompt: string, sensitive: boolean): PromptRequest {
    const normalized = prompt.replace(/:$/, "");

    if (prompt.startsWith("SDK target")) {
      return {
        id: ++this.promptId,
        title: "Choose SDK target",
        message: "Pick the firmware environment the agent should install into.",
        kind: "select",
        options: (Object.keys(SDK_TARGETS) as SdkTargetId[]).map((id) => ({
          label: SDK_TARGETS[id].label,
          value: id,
          hint: SDK_TARGETS[id].verificationHint,
        })),
      };
    }

    if (prompt.startsWith("Login or signup")) {
      return {
        id: ++this.promptId,
        title: "Connect Honch",
        message: "Use an existing account or create one before project setup.",
        kind: "select",
        options: [
          { label: "Login", value: "login", hint: "existing Honch account" },
          { label: "Signup", value: "signup", hint: "create a Honch account" },
        ],
      };
    }

    return {
      id: ++this.promptId,
      title: promptTitle(normalized),
      message: normalized,
      kind: sensitive ? "password" : "text",
      options: [],
      defaultValue: prompt.startsWith("Capture host")
        ? "https://capture.honch.io"
        : undefined,
    };
  }

  private updateSteps(
    id: WizardStepId,
    status: WizardStep["status"],
    detail?: string,
  ) {
    this.update({
      steps: this.snapshot.steps.map((step) => {
        if (step.id === id) return { ...step, status, detail };
        if (status === "active" && step.status === "active") {
          return { ...step, status: "done" };
        }
        return step;
      }),
    });
  }

  private update(patch: Partial<TuiSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function promptTitle(prompt: string) {
  if (prompt.startsWith("Email")) return "Account email";
  if (prompt.startsWith("Password")) return "Account password";
  if (prompt.startsWith("Organization")) return "Organization";
  if (prompt.startsWith("Project")) return "Honch project";
  if (prompt.startsWith("Device")) return "Device profile";
  if (prompt.startsWith("Firmware")) return "Firmware version";
  if (prompt.startsWith("Capture")) return "Capture endpoint";
  return "Wizard input";
}

export function createPrompter(): Prompter {
  const rl = createInterface({ input, output });

  return {
    async question(prompt) {
      return rl.question(`${prompt} `);
    },
    async confirm(prompt) {
      const answer = await rl.question(`${prompt} [y/N] `);
      return answer.trim().toLowerCase() === "y";
    },
    close() {
      rl.close();
    },
  };
}
