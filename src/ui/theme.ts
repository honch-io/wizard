/** Shared color palette for the wizard's terminal UI. */
export const COLORS = {
  accent: "#ea5924",
  secondary: "#58a6ff",
  label: "#6f7895",
  value: "#d8dee9",
  neutral: "#8b93a7",
  success: "#8bd17c",
  /** Amber warning state — e.g. the token meter between 75% and 90% of budget. */
  warning: "#e3b341",
  failure: "#ff6b5f",
  help: "#a7adbb",
  rule: "#2d3545",
} as const;

/** Centralized marker glyphs, so every screen reads from one consistent,
 * visually-distinct set instead of scattering literals. All are single-column
 * so they never shift layout widths. */
export const GLYPHS = {
  /** Sidebar timeline. */
  stepDone: "✓",
  stepActive: "●",
  stepPending: "○",
  /** Outcome headers. */
  success: "✓",
  warn: "⚠",
  error: "✗",
  /** A quota/rate limit — an expected pause, not a crash. */
  limit: "⏳",
  /** A deliberate cancel / no-op. */
  cancelled: "◌",
  /** A revert back to the prior state. */
  reverted: "↩",
  /** The heading marker on a prompt/step screen. */
  heading: "◉",
} as const;
