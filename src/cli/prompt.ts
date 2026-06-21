import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

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
  deviceModel?: string;
  runMode?: string;
  reportPath?: string;
  reportMarkdown?: string;
  branch?: string;
  baseBranch?: string;
  reverted?: boolean;
  /** Whether Claude actually changed project files (false = report-only run). */
  integrated?: boolean;
};

export type PromptOption = {
  label: string;
  value: string;
  hint?: string;
  badge?: string;
};

export type PromptRequest = {
  id: number;
  title: string;
  message: string;
  kind: "text" | "password" | "select" | "confirm" | "welcome";
  options: PromptOption[];
  defaultValue?: string;
  lines?: string[];
};

export type QuestionOptions = {
  sensitive?: boolean;
};

export type SelectConfig = {
  title: string;
  message: string;
  options: PromptOption[];
  defaultValue?: string;
};

export type RunMessageKind = "tool" | "assistant" | "status" | "error" | "info";

export type RunMessage = { id: number; text: string; kind: RunMessageKind };

export type TuiSnapshot = {
  steps: WizardStep[];
  summary: WizardSummary;
  currentPrompt?: PromptRequest;
  runMessages: RunMessage[];
  /** Files created or edited by the agent during the current step.
   * Deduped by path; first op wins (create stays create even if later edited). */
  changedFiles: { path: string; op: "create" | "edit" }[];
  /** A single transient line pinned at the bottom of the run view (e.g. API
   * retries), updated in place rather than appended to the log. */
  transientStatus?: string;
  error?: string;
  completed?: boolean;
  cancelled?: boolean;
};

export type Prompter = {
  question(prompt: string, options?: QuestionOptions): Promise<string>;
  select(config: SelectConfig): Promise<string>;
  confirm(prompt: string): Promise<boolean>;
  welcome?(config: { body: string; lines: string[] }): Promise<void>;
  close(): void;
  cancel?(message?: string): void;
  setStep?(id: WizardStepId, detail?: string): void;
  completeStep?(id: WizardStepId, detail?: string): void;
  setSummary?(summary: Partial<WizardSummary>): void;
  addRunMessage?(message: string, kind?: RunMessageKind): void;
  setChangedFile?(path: string, op: "create" | "edit"): void;
  setTransientStatus?(message?: string): void;
  onInterrupt?(handler: () => void): void;
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
  private interruptHandler?: () => void;

  constructor(summary: WizardSummary) {
    this.snapshot = {
      steps: INITIAL_STEPS.map((step) => ({ ...step })),
      summary,
      runMessages: [],
      changedFiles: [],
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** Register a one-shot interrupt handler (ESC during the agent run). */
  onInterrupt(handler: () => void) {
    this.interruptHandler = handler;
  }

  /** Fire the current interrupt handler, if any (called by the UI on ESC). */
  interrupt() {
    const handler = this.interruptHandler;
    this.interruptHandler = undefined;
    handler?.();
  }

  question(prompt: string, options?: QuestionOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = this.buildRequest(prompt, options ?? {});
      this.pending = { resolve, reject };
      this.update({ currentPrompt: request });
    });
  }

  select(config: SelectConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.update({
        currentPrompt: {
          id: ++this.promptId,
          title: config.title,
          message: config.message,
          kind: "select",
          options: config.options,
          defaultValue: config.defaultValue,
        },
      });
    });
  }

  welcome(config: { body: string; lines: string[] }): Promise<void> {
    return new Promise((resolve) => {
      this.pending = { resolve: () => resolve(), reject: () => resolve() };
      this.update({
        currentPrompt: {
          id: ++this.promptId,
          title: "Welcome",
          message: config.body,
          kind: "welcome",
          options: [],
          lines: config.lines,
        },
      });
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
    // Keep the answered prompt on screen until the next step/prompt replaces
    // it. Clearing it here left a frame where MainArea fell back to the run
    // view and flashed the previous step's run messages between prompts.
    pending.resolve(value);
  }

  setStep(id: WizardStepId, detail?: string) {
    // Entering a step drops the prior step's run output and any answered
    // prompt, so the transition never re-renders the previous step's view.
    this.update({
      steps: this.computeSteps(id, "active", detail),
      runMessages: [],
      changedFiles: [],
      transientStatus: undefined,
      currentPrompt: undefined,
    });
  }

  completeStep(id: WizardStepId, detail?: string) {
    this.update({ steps: this.computeSteps(id, "done", detail) });
  }

  setSummary(summary: Partial<WizardSummary>) {
    this.update({ summary: { ...this.snapshot.summary, ...summary } });
  }

  addRunMessage(message: string, kind: RunMessageKind = "info") {
    // Keep a message as one entry — including multi-line agent prose — so the
    // run view renders it as a single block under one marker (RunView wraps and
    // budgets rows per line) instead of one bullet per line. Trim trailing
    // whitespace on each line but preserve the internal newlines.
    const text = message
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
    if (!text) return;
    const last =
      this.snapshot.runMessages[this.snapshot.runMessages.length - 1];
    // Collapse an exact repeat of the previous line (defensive — the agent
    // runner now emits each block once).
    if (last?.text === text && last.kind === kind) return;
    const next = [
      ...this.snapshot.runMessages,
      { id: ++this.runMessageId, text, kind },
    ];
    // A real log line means progress resumed, so any retry banner is stale.
    this.update({ runMessages: next.slice(-500), transientStatus: undefined });
  }

  setChangedFile(path: string, op: "create" | "edit") {
    // Dedupe by path, preserve insertion order, first op wins.
    const existing = this.snapshot.changedFiles.find(
      (entry) => entry.path === path,
    );
    if (existing) return;
    this.update({
      changedFiles: [...this.snapshot.changedFiles, { path, op }],
    });
  }

  setTransientStatus(message?: string) {
    this.update({ transientStatus: message });
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
    this.interruptHandler = undefined;
    this.update({ currentPrompt: undefined, cancelled: true });
    pending?.reject(new Error(message));
  }

  close() {
    // The CLI paints a final completion/error frame after runWorkflow returns.
    // Keep listeners alive until Ink unmounts the app.
  }

  private buildRequest(
    prompt: string,
    options: QuestionOptions,
  ): PromptRequest {
    const normalized = prompt.replace(/:$/, "");
    return {
      id: ++this.promptId,
      title: promptTitle(normalized),
      message: normalized,
      kind: options.sensitive ? "password" : "text",
      options: [],
    };
  }

  private computeSteps(
    id: WizardStepId,
    status: WizardStep["status"],
    detail?: string,
  ): WizardStep[] {
    return this.snapshot.steps.map((step) => {
      if (step.id === id) return { ...step, status, detail };
      if (status === "active" && step.status === "active") {
        return { ...step, status: "done" };
      }
      return step;
    });
  }

  private update(patch: Partial<TuiSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function promptTitle(prompt: string) {
  if (prompt.startsWith("Organization")) return "Organization";
  if (prompt.startsWith("Project")) return "Honch project";
  if (prompt.startsWith("Device")) return "Device profile";
  return "Wizard input";
}

export function createPrompter(): Prompter {
  const rl = createInterface({ input, output });

  return {
    async question(prompt, options) {
      if (!options?.sensitive) return rl.question(`${prompt} `);
      // Mask secret input: write the prompt, then suppress character echo until
      // the user submits (newline passes through). Restores echo afterwards.
      output.write(`${prompt} `);
      const rlAny = rl as unknown as {
        _writeToOutput?: (chunk: string) => void;
      };
      const restore = rlAny._writeToOutput;
      rlAny._writeToOutput = (chunk: string) => {
        if (chunk.includes("\n") || chunk.includes("\r"))
          restore?.call(rl, chunk);
      };
      try {
        return await rl.question("");
      } finally {
        rlAny._writeToOutput = restore;
      }
    },
    async select(config) {
      const list = config.options
        .map((option, index) => `  ${index + 1}) ${option.label}`)
        .join("\n");
      const answer = (
        await rl.question(`${config.message}\n${list}\n> `)
      ).trim();
      const byIndex = config.options[Number(answer) - 1];
      const byValue = config.options.find(
        (option) => option.value === answer || option.label === answer,
      );
      return (
        byIndex?.value ??
        byValue?.value ??
        config.defaultValue ??
        config.options[0]?.value ??
        ""
      );
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
