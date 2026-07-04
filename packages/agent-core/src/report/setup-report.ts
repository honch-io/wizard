export type SetupReportInput = {
  targetLabel: string;
  projectName: string;
  deviceModel: string;
  agentRan: boolean;
  /** Whether Claude actually changed project files. undefined = not applicable. */
  integrated?: boolean;
  /**
   * True when Claude demonstrably wrote files but git couldn't confirm them
   * (submodule / nested repo / ignored path / non-git project) — the changes
   * are real but won't show at the repo root, so the report says where to look.
   */
  unverifiedByGit?: boolean;
  /** Claude's closing explanation — surfaced when nothing was integrated. */
  agentSummary?: string;
  verification: string[];
  branch?: string;
  baseBranch?: string;
  /** True when this was a "Try Honch" scratch-project run, so Next Steps give
   * kick-the-tires guidance instead of ship-readiness checks. */
  tryMode?: boolean;
};

/** Tailor the closing "Next Steps" to the run's mode. A Try/scratch run gets
 * kick-the-tires guidance; ship-readiness checks only make sense for a real
 * integrated install. A dry run / no-change run stays generic. */
function nextSteps(input: SetupReportInput): string[] {
  if (input.tryMode) {
    return [
      "Skim the files Claude added to see how Honch wires in.",
      "Build and run the scratch project to watch events flow.",
      "Copy this folder somewhere permanent if you want to keep experimenting — it's a temporary scratch project.",
    ];
  }
  const integrated = input.agentRan && input.integrated !== false;
  if (integrated) {
    return [
      "Review the SDK integration changes before committing them in the client project.",
      "Run the target project's normal build and firmware checks.",
      "Confirm production TLS trust, connectivity ownership, and queue durability before shipping.",
    ];
  }
  return [
    "Review the SDK integration changes before committing them in the client project.",
    "Run the target project's normal build and firmware checks.",
  ];
}

export function buildSetupReport(input: SetupReportInput) {
  const base = input.baseBranch ?? "your previous branch";

  // The report is built from two independent facts: the wizard's own verified
  // finding (did files change on disk / via Claude's tools?) and Claude's
  // closing message (which can wrongly claim success). Never assert the latter
  // as fact — otherwise the report contradicts itself ("not integrated" sitting
  // above "integration is complete"). Claude's summary is either the honest
  // account of a real integration, or an explicitly-flagged unverified claim.
  const notIntegrated = input.agentRan && input.integrated === false;
  const integratedButUnseen =
    input.agentRan && input.integrated !== false && input.unverifiedByGit;

  let outcomeSection = "";
  if (notIntegrated) {
    // Verified finding: nothing changed. Claude's message, if any, is shown only
    // as an attributed, explicitly-unverified account — never as the report's
    // own claim — so a "success" summary can't masquerade as the outcome.
    outcomeSection = `## Outcome

Honch was **not** integrated — the wizard detected no file changes in this project.

${
  input.agentSummary
    ? `> **Note:** the summary below is Claude's own account and is **unverified** — the wizard found no changed files on disk. The changes may have landed in a submodule or nested path this check can't see, or the run never applied them. Before trusting it, run \`git status\` in the project and look for the files Claude names.

### Claude's account (unverified)

${input.agentSummary}

`
    : ""
}`;
  } else if (integratedButUnseen) {
    // Verified finding: Claude wrote files, but they aren't visible at the repo
    // root (submodule / nested repo / ignored path / non-git project), so a
    // plain `git status` here can look clean. Point the user at the real files.
    outcomeSection = `## Outcome

Honch was integrated — but the changes aren't visible from the project root, so \`git status\` here may look clean. This usually means they're inside a submodule, a nested module, or an ignored path. Review the changed files directly before building.

${input.agentSummary ? `${input.agentSummary}\n\n` : ""}`;
  }

  const branchSection = input.branch
    ? `## Review Claude's changes

Claude's work was committed on branch \`${input.branch}\`.

- Review:  \`git diff ${base}..${input.branch}\`
- Merge:   \`git checkout ${base} && git merge ${input.branch}\`
- Discard: \`git checkout ${base} && git branch -D ${input.branch}\`

`
    : "";

  return `# Honch Setup Report

## Summary

- SDK target: ${input.targetLabel}
- Honch project: ${input.projectName}
- Device model: ${input.deviceModel}
- Agent execution: ${input.agentRan ? (input.integrated === false ? "ran — no changes made" : "ran") : "not run"}${input.branch ? `\n- Branch: ${input.branch}` : ""}

${outcomeSection}## Verification

${input.verification.map((line) => `- ${line}`).join("\n")}

${branchSection}## Next Steps

${nextSteps(input)
  .map((line) => `- ${line}`)
  .join("\n")}
`;
}
