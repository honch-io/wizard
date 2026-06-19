export type SetupReportInput = {
  targetLabel: string;
  projectName: string;
  captureHost: string;
  deviceModel: string;
  agentRan: boolean;
  verification: string[];
  branch?: string;
  baseBranch?: string;
};

export function buildSetupReport(input: SetupReportInput) {
  const base = input.baseBranch ?? "your previous branch";
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
- Capture host: ${input.captureHost}
- Device model: ${input.deviceModel}
- Agent execution: ${input.agentRan ? "ran" : "not run"}${input.branch ? `\n- Branch: ${input.branch}` : ""}

## Verification

${input.verification.map((line) => `- ${line}`).join("\n")}

${branchSection}## Next Steps

- Review the SDK integration changes before committing them in the client project.
- Run the target project's normal build and firmware checks.
- Confirm production TLS trust, connectivity ownership, and queue durability before shipping.
`;
}
