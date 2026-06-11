/**
 * Pure builders for the starter-dashboard insight specs.
 *
 * These produce the exact `query` AST the Honch platform expects on
 * `POST /api/projects/{projectId}/saved-insights` (see the backend's
 * `insights.dto.ts` — TrendsQuery / EventsNode / mathSchema). Kept
 * dependency-free so the wire shapes can be unit-tested without a network.
 *
 * The device is freshly instrumented when the wizard runs, so there are no
 * events yet: every spec is forward-looking and references the event names the
 * agent just wired up. `event: null` on an EventsNode means "all events".
 */

/** A single Trends series entry. */
export interface EventsNode {
  kind: 'EventsNode';
  /** Event name, or null for "all events". */
  event: string | null;
  math: TrendsMath;
  name?: string;
}

/** Subset of the platform's mathSchema we actually emit. */
export type TrendsMath = 'total' | 'unique_device' | 'monthly_active_device';

export interface TrendsQuery {
  kind: 'TrendsQuery';
  interval: 'day';
  series: EventsNode[];
  dateRange: { date_from: string };
}

/** Body for `POST /saved-insights`. */
export interface InsightSpec {
  name: string;
  description: string;
  query: TrendsQuery;
}

/** Default look-back window for every starter insight. */
const DEFAULT_DATE_FROM = '-30d';

/** Hard cap on per-event tiles so a chatty integration can't bloat the board. */
export const MAX_CUSTOM_EVENT_INSIGHTS = 8;

function trends(series: EventsNode[]): TrendsQuery {
  return {
    kind: 'TrendsQuery',
    interval: 'day',
    series,
    dateRange: { date_from: DEFAULT_DATE_FROM },
  };
}

/**
 * Baseline insights that work for any project regardless of which custom
 * events were instrumented. These rely only on built-in capture semantics
 * (event volume + the device-actor `unique_device` math).
 */
export function baselineInsightSpecs(): InsightSpec[] {
  return [
    {
      name: 'Total events',
      description: 'All events captured per day across every device.',
      query: trends([{ kind: 'EventsNode', event: null, math: 'total' }]),
    },
    {
      name: 'Active devices',
      description: 'Unique devices sending events per day.',
      query: trends([
        { kind: 'EventsNode', event: null, math: 'unique_device' },
      ]),
    },
  ];
}

/** Trends-over-time insight for a single instrumented event. */
export function customEventInsightSpec(
  eventName: string,
  label?: string,
): InsightSpec {
  const title = (label?.trim() || eventName).slice(0, 200);
  return {
    name: title,
    description: `Daily count of "${eventName}" events.`,
    query: trends([{ kind: 'EventsNode', event: eventName, math: 'total' }]),
  };
}

export interface StarterEvent {
  name: string;
  label?: string;
}

/**
 * Assemble the full ordered spec list: baseline first, then one tile per
 * unique custom event (deduped, trimmed, capped). Events whose name collides
 * with a baseline are dropped — the baseline already covers "all events".
 */
export function buildStarterInsightSpecs(
  events: readonly StarterEvent[],
): InsightSpec[] {
  const seen = new Set<string>();
  const custom: InsightSpec[] = [];
  for (const event of events) {
    const name = event.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    custom.push(customEventInsightSpec(name, event.label));
    if (custom.length >= MAX_CUSTOM_EVENT_INSIGHTS) break;
  }
  return [...baselineInsightSpecs(), ...custom];
}

// --- Tile layout ----------------------------------------------------------

export interface TileLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
}

/** Per-breakpoint layouts; the platform requires at least `sm`. */
export interface TileLayouts {
  sm: TileLayout;
}

const TILE_WIDTH = 6; // half of a 12-column grid
const TILE_HEIGHT = 5;
const COLUMNS = 2;

/** Deterministic 2-column grid placement for the i-th tile (0-based). */
export function tileLayoutForIndex(index: number): TileLayouts {
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  return {
    sm: {
      x: col * TILE_WIDTH,
      y: row * TILE_HEIGHT,
      w: TILE_WIDTH,
      h: TILE_HEIGHT,
      minW: 2,
      minH: 2,
    },
  };
}
