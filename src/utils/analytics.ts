import type { WizardSession } from '@lib/wizard-session';
import type { ApiUser } from '@lib/api';

/**
 * Telemetry is disabled in the Honch wizard.
 *
 * This module preserves the analytics call surface used across the codebase
 * but performs NO network I/O — nothing is sent anywhere. (PostHog's wizard
 * streamed run state to PostHog's internal analytics project; that is
 * intentionally removed in the fork.)
 */

export function sessionProperties(
  session: WizardSession,
): Record<string, unknown> {
  return {
    integration: session.integration,
    detected_framework: session.detectedFrameworkLabel,
    typescript: session.typescript,
    project_id: session.credentials?.projectId,
    discovered_features: session.discoveredFeatures,
    additional_features: session.additionalFeatureQueue,
    run_phase: session.runPhase,
  };
}

export function groupsFromUser(
  user: ApiUser | null,
  host: string,
): Record<string, string> {
  const groups: Record<string, string> = { instance: host };
  if (!user) return groups;

  const organizationId = user.organization?.id;
  if (organizationId) groups.organization = organizationId;

  const customerId = user.organization?.customer_id;
  if (customerId) groups.customer = customerId;

  const projectUuid = user.team?.uuid;
  if (projectUuid) groups.project = projectUuid;

  return groups;
}

/** No-op analytics — every method is a sink; nothing leaves the machine. */
class Analytics {
  setDistinctId(_distinctId: string): void {}
  setTag(
    _key: string,
    _value: string | boolean | number | null | undefined,
  ): void {}
  setGroups(_groups: Record<string, string>): void {}
  captureException(
    _error: Error,
    _properties: Record<string, unknown> = {},
  ): void {}
  capture(_eventName: string, _properties?: Record<string, unknown>): void {}
  wizardCapture(
    _eventName: string,
    _properties?: Record<string, unknown>,
  ): void {}
  getFeatureFlag(_flagKey: string): Promise<string | boolean | undefined> {
    return Promise.resolve(undefined);
  }
  getAllFlagsForWizard(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }
  shutdown(_status: 'success' | 'error' | 'cancelled'): Promise<void> {
    return Promise.resolve();
  }
}

export const analytics = new Analytics();
