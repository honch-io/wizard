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
};

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

- Review the SDK integration changes before committing them in the client project.
- Run the target project's normal build and firmware checks.
- Confirm production TLS trust, connectivity ownership, and queue durability before shipping.
`;
}
