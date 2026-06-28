import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

/** Thrown when the user deliberately cancels the wizard (chose "Cancel" on the
 * install plan, or pressed ESC during a prompt). bin.ts treats this as a clean
 * exit landing on the calm CancelledView — never the red "failed" screen. */
export class WizardCancelledError extends Error {
  constructor(message = "Wizard cancelled") {
    super(message);
    this.name = "WizardCancelledError";
  }
}

export type WizardStepId =
  | "scan"
  | "target"
  | "auth"
  | "project"
  | "config"
  | "features"
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
  /** When set, the install ran in "Try Honch" mode and scaffolded into this
   * temporary scratch project directory. */
  tempProject?: string;
  /** The directory the install is actually targeting. In Try mode this is the
   * temp scratch dir; otherwise it matches the cwd. The sidebar renders it so
   * the path reflects where the work lands. */
  installDir?: string;
};

export type PromptOption = {
  label: string;
  value: string;
  hint?: string;
  badge?: string;
  /** Multi-select only: initial checked state (defaults to true). */
  checked?: boolean;
  /** Multi-select only: a row that cannot be toggled off (the SDK core). */
  locked?: boolean;
  /** Multi-select only: pre-formatted footprint estimate shown after the label. */
  stat?: string;
  /** Multi-select only: numeric footprint, summed into the live total. */
  flashBytes?: number;
  ramBytes?: number;
  /** Multi-select only: wire bytes of this feature's headline event (per-event
   * network cost; shown per row, not summed into the footprint total). */
  wireBytesPerEvent?: number;
};

export type PromptRequest = {
  id: number;
  title: string;
  message: string;
  kind: "text" | "password" | "select" | "confirm" | "multiselect";
  options: PromptOption[];
  defaultValue?: string;
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

export type MultiSelectConfig = {
  title: string;
  message: string;
  options: PromptOption[];
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
  /** Cumulative tokens the agent has consumed during the current step, for the
   * live usage meter. Summed per assistant turn; reset on a new step. */
  usageTokens: number;
  /** Wall-clock start of the agent run (epoch ms), set once when Claude first
   * starts. The elapsed timer is derived from this so it survives a pause/
   * resume (which remounts the run view) instead of restarting from zero. */
  agentStartedAt?: number;
  /** The daily token budget for this install (from the platform). When set, the
   * run header shows how much of the budget is used rather than a raw count. */
  tokenBudget?: number;
  /** Tokens already spent today before this run started, so the live meter can
   * show total daily usage = baseline + this run's `usageTokens`. */
  tokensUsedBaseline?: number;
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
  multiSelect(config: MultiSelectConfig): Promise<string[]>;
  confirm(prompt: string): Promise<boolean>;
  close(): void;
  cancel?(message?: string): void;
  setStep?(id: WizardStepId, detail?: string): void;
  completeStep?(id: WizardStepId, detail?: string): void;
  setSummary?(summary: Partial<WizardSummary>): void;
  addRunMessage?(message: string, kind?: RunMessageKind): void;
  setChangedFile?(path: string, op: "create" | "edit"): void;
  addUsage?(tokens: number): void;
  setTokenBudget?(budget: number, usedBaseline: number): void;
  markAgentStart?(): void;
  setTransientStatus?(message?: string): void;
  onInterrupt?(handler: () => void): void;
  finish?(summary: Partial<WizardSummary>): void;
  fail?(message: string): void;
};

const INITIAL_STEPS: WizardStep[] = [
  { id: "scan", label: "Welcome", status: "pending" },
  { id: "target", label: "Select SDK", status: "pending" },
  { id: "auth", label: "Connect", status: "pending" },
  { id: "project", label: "Project", status: "pending" },
  { id: "config", label: "Configure", status: "pending" },
  { id: "features", label: "Features", status: "pending" },
  { id: "confirm", label: "Confirm", status: "pending" },
  { id: "agent", label: "Install", status: "pending" },
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
      usageTokens: 0,
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

  multiSelect(config: MultiSelectConfig): Promise<string[]> {
    return new Promise((resolve, reject) => {
      // The picker joins enabled option values with a comma; split it back
      // into the selected list (empty -> []).
      this.pending = {
        resolve: (value) =>
          resolve(value ? value.split(",").filter(Boolean) : []),
        reject,
      };
      this.update({
        currentPrompt: {
          id: ++this.promptId,
          title: config.title,
          message: config.message,
          kind: "multiselect",
          options: config.options,
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
      usageTokens: 0,
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

  addUsage(tokens: number) {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    this.update({ usageTokens: this.snapshot.usageTokens + tokens });
  }

  /** Record the daily budget and the tokens already spent today, so the meter
   * can show usage against the cap. Best-effort — skipped if the platform read
   * fails, leaving the meter to fall back to a raw token count. */
  setTokenBudget(budget: number, usedBaseline: number) {
    if (!Number.isFinite(budget) || budget <= 0) return;
    this.update({
      tokenBudget: budget,
      tokensUsedBaseline: Math.max(0, usedBaseline),
    });
  }

  /** Start the agent clock once. Idempotent, so resuming after a pause keeps
   * counting from the original start instead of resetting to zero. */
  markAgentStart() {
    if (this.snapshot.agentStartedAt) return;
    this.update({ agentStartedAt: Date.now() });
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

export function promptTitle(prompt: string) {
  if (prompt.startsWith("Organization")) return "Organization";
  if (prompt.startsWith("Project")) return "Honch project";
  if (prompt.startsWith("Device")) return "Device profile";
  // Fall back to the prompt itself so an unrecognized question's heading is
  // never less informative than the question (vs a generic "Wizard input").
  return prompt;
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
      // The echo suppression hangs off readline's private `_writeToOutput`. If
      // it isn't a function (different/newer readline internals), skip the
      // custom masking and read normally rather than crashing on `.call`.
      if (typeof restore !== "function") {
        return await rl.question("");
      }
      rlAny._writeToOutput = (chunk: string) => {
        if (chunk.includes("\n") || chunk.includes("\r"))
          restore.call(rl, chunk);
      };
      try {
        return await rl.question("");
      } finally {
        rlAny._writeToOutput = restore;
      }
    },
    async multiSelect(config) {
      // Non-interactive path: keep the full feature set (everything is on by
      // default). The TUI is where features get toggled off.
      output.write(`${config.message}\n`);
      return config.options
        .filter((option) => option.checked !== false)
        .map((option) => option.value);
    },
    async select(config) {
      // Mirror the TUI: show each option's badge (e.g. "(detected)") inline and
      // its hint on a dim second line, so the readline path is at parity.
      const list = config.options
        .map((option, index) => {
          const badge = option.badge ? ` ${option.badge}` : "";
          const hint = option.hint ? `\n       ${option.hint}` : "";
          return `  ${index + 1}) ${option.label}${badge}${hint}`;
        })
        .join("\n");
      const base = `${config.message}\n${list}\n> `;
      let prompt = base;
      // Re-ask on an unrecognized answer rather than silently falling back to a
      // default — a typo must never quietly select the wrong SDK. A bare enter
      // still accepts the default (or first option). Bounded so a closed/looping
      // stdin can't spin forever.
      for (let attempt = 0; attempt < 5; attempt++) {
        const answer = (await rl.question(prompt)).trim();
        if (answer === "") {
          const fallback =
            config.defaultValue ?? config.options[0]?.value ?? "";
          if (fallback) return fallback;
        } else {
          const byIndex = /^\d+$/.test(answer)
            ? config.options[Number(answer) - 1]
            : undefined;
          const byValue = config.options.find(
            (option) => option.value === answer || option.label === answer,
          );
          const chosen = byIndex?.value ?? byValue?.value;
          if (chosen) return chosen;
        }
        prompt = `Please enter a number between 1 and ${config.options.length}, or an option name.\n${base}`;
      }
      throw new Error("No valid selection after several attempts.");
    },
    async confirm(prompt) {
      // Align with the TUI, which pre-selects "Install Honch": default to yes on
      // a bare enter, so the two front-ends agree on the safe-but-expected path.
      const answer = await rl.question(`${prompt} [Y/n] `);
      const normalized = answer.trim().toLowerCase();
      return normalized === "" || normalized === "y" || normalized === "yes";
    },
    close() {
      rl.close();
    },
  };
}
