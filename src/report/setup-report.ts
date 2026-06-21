export type SetupReportInput = {
  targetLabel: string;
  projectName: string;
  deviceModel: string;
  agentRan: boolean;
  /** Whether Claude actually changed project files. undefined = not applicable. */
  integrated?: boolean;
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

  // When the agent ran but changed nothing, lead with an honest outcome and
  // Claude's reason so the report explains itself instead of implying success.
  const notIntegrated = input.agentRan && input.integrated === false;
  const outcomeSection = notIntegrated
    ? `## Outcome

Honch was **not** integrated — Claude made no changes to this project.

${input.agentSummary ? `${input.agentSummary}\n\n` : ""}`
    : "";

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
