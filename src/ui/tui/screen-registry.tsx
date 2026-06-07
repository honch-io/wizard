/**
 * ScreenId registry — maps screen names to React components.
 *
 * The Honch fork ships a single program (SDK integration) plus the generic
 * agent-skill runner. ScreenIds belonging to removed PostHog programs (audit,
 * doctor, revenue, source-maps, migration, MCP install, OAuth) are kept in the
 * enum for type-exhaustiveness but are never navigated to; they map to a
 * harmless placeholder so this Record stays total without dragging the router,
 * store, and sequences through a coordinated enum edit.
 */

import type { ReactNode } from 'react';
import type { WizardStore } from './store.js';
import { ScreenId, Overlay, type ScreenName } from './router.js';

import { SettingsOverrideScreen } from './screens/SettingsOverrideScreen.js';
import { ManagedSettingsScreen } from './screens/ManagedSettingsScreen.js';
import { PortConflictScreen } from './screens/PortConflictScreen.js';
import { PostHogIntegrationIntroScreen } from './screens/PostHogIntegrationIntroScreen.js';
import { AgentSkillIntroScreen } from './screens/AgentSkillIntroScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { KeepSkillsScreen } from './screens/KeepSkillsScreen.js';
import { OutroScreen } from './screens/OutroScreen.js';
import { ExitScreen } from './screens/ExitScreen.js';
import { WizardAskScreen } from './screens/WizardAskScreen.js';

// Removed PostHog programs left these services behind; the Honch wizard needs
// no per-screen services, so this is intentionally empty.
export type ScreenServices = Record<string, never>;

export function createServices(_store: WizardStore): ScreenServices {
  return {};
}

export function createScreens(
  store: WizardStore,
  _services: ScreenServices,
): Record<ScreenName, ReactNode> {
  // Placeholder for ScreenIds that belong to removed programs and are never
  // reached at runtime.
  const removed = <ExitScreen />;

  return {
    // Overlays
    [Overlay.SettingsOverride]: <SettingsOverrideScreen store={store} />,
    [Overlay.ManagedSettings]: <ManagedSettingsScreen store={store} />,
    [Overlay.PortConflict]: <PortConflictScreen store={store} />,
    [Overlay.WizardAsk]: <WizardAskScreen store={store} />,
    [Overlay.ManualAuthCode]: removed,
    [Overlay.AuthError]: removed,

    // Honch wizard flow
    [ScreenId.Intro]: <PostHogIntegrationIntroScreen store={store} />,
    [ScreenId.AgentSkillIntro]: <AgentSkillIntroScreen store={store} />,
    [ScreenId.Setup]: <SetupScreen store={store} />,
    [ScreenId.Run]: <RunScreen store={store} />,
    [ScreenId.KeepSkills]: <KeepSkillsScreen store={store} />,
    [ScreenId.Outro]: <OutroScreen store={store} />,
    [ScreenId.Exit]: <ExitScreen />,

    // Removed PostHog program screens (unreachable placeholders)
    [ScreenId.RevenueIntro]: removed,
    [ScreenId.SourceMapsIntro]: removed,
    [ScreenId.SourceMapsOutro]: removed,
    [ScreenId.MigrationIntro]: removed,
    [ScreenId.AuditIntro]: removed,
    [ScreenId.AuditRun]: removed,
    [ScreenId.AuditOutro]: removed,
    [ScreenId.Audit3000Intro]: removed,
    [ScreenId.Audit3000Run]: removed,
    [ScreenId.Audit3000Outro]: removed,
    [ScreenId.HealthCheck]: removed,
    [ScreenId.DoctorIntro]: removed,
    [ScreenId.DoctorReport]: removed,
    [ScreenId.Auth]: removed,
    [ScreenId.Mcp]: removed,
    [ScreenId.McpSuggestedPrompts]: removed,
    [ScreenId.McpAdd]: removed,
    [ScreenId.McpRemove]: removed,
  };
}
