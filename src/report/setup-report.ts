export type SetupReportInput = {
  targetLabel: string;
  projectName: string;
  captureHost: string;
  deviceModel: string;
  firmwareVersion: string;
  agentRan: boolean;
  verification: string[];
};

export function buildSetupReport(input: SetupReportInput) {
  return `# Honch Setup Report

## Summary

- SDK target: ${input.targetLabel}
- Honch project: ${input.projectName}
- Capture host: ${input.captureHost}
- Device model: ${input.deviceModel}
- Firmware version: ${input.firmwareVersion}
- Agent execution: ${input.agentRan ? "ran" : "not run"}

## Verification

${input.verification.map((line) => `- ${line}`).join("\n")}

## Next Steps

- Review the SDK integration changes before committing them in the client project.
- Run the target project's normal build and firmware checks.
- Confirm production TLS trust, connectivity ownership, and queue durability before shipping.
`;
}
