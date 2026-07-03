/**
 * Reconcile the two independent "did Claude change files?" signals into one
 * coherent verdict, so the setup report can never claim success and failure at
 * once.
 *
 * - `agentWroteFiles`: the agent issued a Write/Edit/MultiEdit on a project file
 *   (the live file events, excluding the setup report itself). This is
 *   *authoritative* that the agent wrote something — it is observed at the tool
 *   layer, so it sees through submodules, nested repos, `.gitignore`, and
 *   non-git projects.
 * - `gitChangedCount`: files the pre-run git snapshot diff detected as changed.
 *   A useful backstop (it catches writes made via Bash rather than the file
 *   tools) but it is *blind* to submodule/nested-repo contents, ignored paths,
 *   and projects that aren't a git work tree at all.
 *
 * OR-combining them means a genuinely-integrated project is never reported as
 * "no changes" just because git couldn't see through a submodule — which is the
 * exact false-negative that produced a "Honch was not installed" report sitting
 * directly above the agent's own "integration is complete" summary.
 */
export type InstallOutcomeSignals = {
  agentWroteFiles: boolean;
  gitChangedCount: number;
};

export type InstallOutcome = {
  /** True when the agent changed project files by any observed means. */
  integrated: boolean;
  /**
   * True when the agent demonstrably wrote files but git couldn't confirm them
   * (submodule / nested repo / ignored path / non-git project). The changes are
   * real but won't show at the repo root, so the report must say where to look.
   */
  unverifiedByGit: boolean;
};

export function resolveInstallOutcome(
  signals: InstallOutcomeSignals,
): InstallOutcome {
  const integrated = signals.agentWroteFiles || signals.gitChangedCount > 0;
  const unverifiedByGit =
    signals.agentWroteFiles && signals.gitChangedCount === 0;
  return { integrated, unverifiedByGit };
}
