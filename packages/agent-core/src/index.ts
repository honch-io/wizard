export {
  type InstallOutcome,
  type InstallOutcomeSignals,
  resolveInstallOutcome,
} from "./report/install-outcome.js";
export {
  buildSetupReport,
  type SetupReportInput,
} from "./report/setup-report.js";
export {
  detectSdkTargets,
  HONCH_FEATURES,
  type ProjectFiles,
  SDK_TARGETS,
  type SdkTarget,
  type SdkTargetId,
  targetSupportsFeatures,
} from "./sdk/targets.js";
