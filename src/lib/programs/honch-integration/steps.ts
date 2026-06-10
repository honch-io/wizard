/**
 * Honch integration program — the default wizard flow.
 *
 * Steps define their own gate predicates and onInit callbacks.
 * The store derives gate promises and fires init work from these definitions.
 */

import type { ProgramStep } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import { RunPhase } from '@lib/wizard-session';
import { detectHonchIntegration } from './detect.js';

function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

export const HONCH_INTEGRATION_PROGRAM: ProgramStep[] = [
  {
    id: 'detect',
    label: 'Detecting framework',
    // Headless step: no screen. onReady fires after bin.ts assigns the
    // session — runs framework detection, context gathering, version
    // check, and feature discovery. Results are written to the store
    // for the IntroScreen to render.
    onReady: (ctx) => detectHonchIntegration(ctx),
  },
  {
    id: 'intro',
    label: 'Welcome',
    screenId: 'intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    id: 'setup',
    label: 'Setup',
    screenId: 'setup',
    show: needsSetup,
    isComplete: (session) => !needsSetup(session),
  },
  {
    id: 'run',
    label: 'Integration',
    screenId: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screenId: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
  {
    id: 'keep-skills',
    label: 'Keep Skills',
    screenId: 'keep-skills',
  },
];
