/**
 * Orchestrates creation of a starter dashboard on the Honch platform after the
 * SDK is wired up: a deterministic baseline (total events, active devices) plus
 * one trends tile per event the agent instrumented.
 *
 * Runs LOCALLY in the wizard process using the user's bearer token (the project
 * API rejects the minted wizard token), so the bearer never reaches the LLM.
 */

import { PlatformClient } from '@lib/platform/client';
import {
  buildStarterInsightSpecs,
  tileLayoutForIndex,
  type StarterEvent,
} from './insight-specs';

export interface CreateStarterDashboardOptions {
  /** User bearer token (NOT the wizard JWT). */
  userBearer: string;
  /** Honch project UUID. */
  projectId: string;
  /** Platform base URL the API calls go to, e.g. https://app.honch.io. */
  apiBaseUrl: string;
  /**
   * App URL used to build the dashboard link. Defaults to {@link apiBaseUrl}
   * (same host in the hosted product); set explicitly for split-host setups.
   */
  frontendUrl?: string;
  /** Dashboard title. */
  dashboardName: string;
  /** Events the agent instrumented; baseline tiles are always added on top. */
  events: readonly StarterEvent[];
  /** Injectable client for tests; defaults to a real PlatformClient. */
  client?: PlatformClient;
}

export interface CreateStarterDashboardResult {
  dashboardId: string;
  dashboardUrl: string;
  /** Names of the insights that became tiles, in dashboard order. */
  insightNames: string[];
}

/** Build the frontend dashboard URL: `{origin}/{projectId}/dashboards/{id}`. */
export function dashboardUrl(
  apiBaseUrl: string,
  projectId: string,
  dashboardId: string,
): string {
  const origin = apiBaseUrl.replace(/\/+$/, '');
  return `${origin}/${projectId}/dashboards/${dashboardId}`;
}

export async function createStarterDashboard(
  options: CreateStarterDashboardOptions,
): Promise<CreateStarterDashboardResult> {
  const { userBearer, projectId, apiBaseUrl, dashboardName, events } = options;
  const linkOrigin = options.frontendUrl ?? apiBaseUrl;
  const client = options.client ?? new PlatformClient(apiBaseUrl);

  const specs = buildStarterInsightSpecs(events);

  // Create each saved insight. The FIRST call surfaces auth/permission failures
  // (e.g. a viewer-role user without PROJECT_MANAGE_DATA) — let that throw so
  // the caller reports it. Once past it, tolerate individual failures so one
  // flaky insight doesn't sink the whole dashboard.
  const insights: { id: string; name: string }[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    try {
      const created = await client.createSavedInsight(userBearer, projectId, {
        name: spec.name,
        description: spec.description,
        query: spec.query,
      });
      insights.push({ id: created.id, name: spec.name });
    } catch (error) {
      if (i === 0) throw error;
    }
  }

  if (insights.length === 0) {
    throw new Error('No insights could be created for the dashboard.');
  }

  const dashboard = await client.createDashboard(userBearer, projectId, {
    name: dashboardName,
    description: 'Starter dashboard created by the Honch wizard.',
  });

  // Best-effort tiles: a single rejected tile shouldn't lose the dashboard.
  const tiled: string[] = [];
  for (let i = 0; i < insights.length; i++) {
    try {
      await client.addDashboardTile(userBearer, projectId, dashboard.id, {
        insightId: insights[i].id,
        layouts: tileLayoutForIndex(tiled.length),
      });
      tiled.push(insights[i].name);
    } catch {
      // skip — the insight still exists and can be added to the board manually
    }
  }

  return {
    dashboardId: dashboard.id,
    dashboardUrl: dashboardUrl(linkOrigin, projectId, dashboard.id),
    insightNames: tiled,
  };
}
