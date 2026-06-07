/**
 * Central registry of all wizard programs.
 *
 * Adding a new program:
 *   1. Create src/lib/programs/<name>/ with index.ts exporting a ProgramConfig
 *   2. Import and add it to PROGRAM_REGISTRY below
 *   3. (If custom intro screen) add to src/ui/tui/screen-registry.tsx
 *
 * screen-sequences.ts, store.ts, and bin.ts all derive their wiring from
 * this array — no need to touch those files when adding a program.
 *
 * The Honch fork ships a single program (the SDK integration). The generic
 * agent-skill program is retained as the runtime skill runner.
 */

import type { ProgramConfig } from './program-step.js';
import { posthogIntegrationConfig } from './posthog-integration/index.js';
import { AGENT_SKILL_STEPS } from './agent-skill/index.js';
import { getContentBlocks as agentSkillContentBlocks } from './agent-skill/content/index.js';

// Generic skill program — invoked when the wizard runs an arbitrary skill
// chosen at runtime (session.skillId) rather than a registered named program.
// No CLI command, no run config.
const agentSkillConfig: ProgramConfig = {
  id: 'agent-skill',
  description: 'Run an arbitrary skill',
  steps: AGENT_SKILL_STEPS,
  getContentBlocks: agentSkillContentBlocks,
  allowedTools: ['Agent'],
};

export const PROGRAM_REGISTRY = [
  posthogIntegrationConfig,
  agentSkillConfig,
] as const satisfies readonly ProgramConfig[];

/**
 * Typed program names. Values come from each config's `id`, so there's no
 * parallel string list to keep in sync.
 */
export const Program = {
  PostHogIntegration: posthogIntegrationConfig.id,
  AgentSkill: agentSkillConfig.id,
} as const;

/** Compile-time union of every registered program id. */
export type ProgramId = (typeof PROGRAM_REGISTRY)[number]['id'];

/**
 * Look up a program config by its id. `ProgramId` is a union of every
 * registered id, so the lookup is statically guaranteed to find a match.
 */
export function getProgramConfig(id: ProgramId): ProgramConfig {
  return PROGRAM_REGISTRY.find((c) => c.id === id)!;
}

/** A program config that is exposed as a CLI subcommand. */
export type SubcommandProgram = ProgramConfig & { command: string };

/** All program configs that are exposed as CLI subcommands. */
export function getSubcommandPrograms(): SubcommandProgram[] {
  return PROGRAM_REGISTRY.filter(
    (c): c is SubcommandProgram => c.command != null,
  );
}
