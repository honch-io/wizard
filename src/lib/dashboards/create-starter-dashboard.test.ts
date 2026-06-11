import { PlatformClient } from '@lib/platform/client';
import {
  createStarterDashboard,
  dashboardUrl,
} from '@lib/dashboards/create-starter-dashboard';

const BASE = 'https://app.honch.io';
const PROJECT = 'proj-123';
const BEARER = 'user-bearer-token';

type Recorded = { url: string; method: string; body: unknown; auth?: string };

/**
 * Build a PlatformClient backed by a stub fetcher that records every request
 * and hands back deterministic ids, so we exercise the real client + the
 * orchestrator end to end without a network.
 */
type FailInfo = { kind: 'insight' | 'dashboard' | 'tile'; index: number };

function fakeClient(opts?: { fail?: (info: FailInfo) => boolean }): {
  client: PlatformClient;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  let insightSeq = 0;
  let insightIdx = -1;
  let tileIdx = -1;
  const fetcher = ((url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({
      url,
      method: init.method,
      body,
      auth: init.headers?.Authorization,
    });
    let payload: unknown = {};
    let status = 201;
    if (url.endsWith('/saved-insights')) {
      insightIdx++;
      if (opts?.fail?.({ kind: 'insight', index: insightIdx })) status = 403;
      else payload = { id: `insight-${++insightSeq}`, name: body.name };
    } else if (url.endsWith('/dashboards')) {
      if (opts?.fail?.({ kind: 'dashboard', index: 0 })) status = 500;
      else payload = { id: 'dash-1', name: body.name };
    } else if (url.endsWith('/tiles')) {
      tileIdx++;
      if (opts?.fail?.({ kind: 'tile', index: tileIdx })) status = 500;
      else payload = { ok: true };
    }
    return Promise.resolve(
      new Response(
        status >= 400
          ? JSON.stringify({ message: 'nope' })
          : JSON.stringify(payload),
        {
          status,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
  }) as unknown as typeof fetch;
  return { client: new PlatformClient(BASE, fetcher), calls };
}

describe('dashboardUrl', () => {
  it('builds the frontend dashboard URL', () => {
    expect(dashboardUrl('https://app.honch.io/', 'p', 'd')).toBe(
      'https://app.honch.io/p/dashboards/d',
    );
  });
});

describe('createStarterDashboard', () => {
  it('creates baseline + per-event insights, the dashboard, and tiles', async () => {
    const { client, calls } = fakeClient();

    const result = await createStarterDashboard({
      userBearer: BEARER,
      projectId: PROJECT,
      apiBaseUrl: BASE,
      dashboardName: 'My Overview',
      events: [{ name: 'button_press' }, { name: 'temp_reading' }],
      client,
    });

    // 4 insights (2 baseline + 2 custom), 1 dashboard, 4 tiles.
    const insightCalls = calls.filter((c) => c.url.endsWith('/saved-insights'));
    const dashCalls = calls.filter((c) => c.url.endsWith('/dashboards'));
    const tileCalls = calls.filter((c) => c.url.endsWith('/tiles'));
    expect(insightCalls).toHaveLength(4);
    expect(dashCalls).toHaveLength(1);
    expect(tileCalls).toHaveLength(4);

    expect(result.dashboardUrl).toBe(
      'https://app.honch.io/proj-123/dashboards/dash-1',
    );
    expect(result.insightNames).toEqual([
      'Total events',
      'Active devices',
      'button_press',
      'temp_reading',
    ]);
  });

  it('authenticates every request with the user bearer', async () => {
    const { client, calls } = fakeClient();
    await createStarterDashboard({
      userBearer: BEARER,
      projectId: PROJECT,
      apiBaseUrl: BASE,
      dashboardName: 'X',
      events: [],
      client,
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.auth).toBe(`Bearer ${BEARER}`);
    }
  });

  it('tiles reference the created insight ids in order', async () => {
    const { client, calls } = fakeClient();
    await createStarterDashboard({
      userBearer: BEARER,
      projectId: PROJECT,
      apiBaseUrl: BASE,
      dashboardName: 'X',
      events: [],
      client,
    });
    const tiles = calls.filter((c) => c.url.endsWith('/tiles'));
    expect(tiles.map((t) => (t.body as any).insightId)).toEqual([
      'insight-1',
      'insight-2',
    ]);
    expect((tiles[0].body as any).layouts.sm).toMatchObject({ x: 0, y: 0 });
  });

  it('builds the link from frontendUrl when it differs from the API base', async () => {
    const { client } = fakeClient();
    const result = await createStarterDashboard({
      userBearer: BEARER,
      projectId: PROJECT,
      apiBaseUrl: 'http://localhost:3001',
      frontendUrl: 'http://localhost:5173',
      dashboardName: 'X',
      events: [],
      client,
    });
    expect(result.dashboardUrl).toBe(
      'http://localhost:5173/proj-123/dashboards/dash-1',
    );
  });

  it('propagates a first-insight (auth) failure', async () => {
    const { client } = fakeClient({
      fail: (f) => f.kind === 'insight' && f.index === 0,
    });
    await expect(
      createStarterDashboard({
        userBearer: BEARER,
        projectId: PROJECT,
        apiBaseUrl: BASE,
        dashboardName: 'X',
        events: [],
        client,
      }),
    ).rejects.toThrow();
  });

  it('tolerates a later-insight failure and keeps the rest', async () => {
    // Fail the 3rd insight (a custom event); baseline + others survive.
    const { client } = fakeClient({
      fail: (f) => f.kind === 'insight' && f.index === 2,
    });
    const result = await createStarterDashboard({
      userBearer: BEARER,
      projectId: PROJECT,
      apiBaseUrl: BASE,
      dashboardName: 'X',
      events: [{ name: 'a' }, { name: 'b' }],
      client,
    });
    // 4 specs total (2 baseline + a + b); index 2 ('a') dropped → 3 tiles.
    expect(result.insightNames).toEqual([
      'Total events',
      'Active devices',
      'b',
    ]);
  });

  it('tolerates a failed tile without losing the dashboard', async () => {
    const { client } = fakeClient({
      fail: (f) => f.kind === 'tile' && f.index === 1,
    });
    const result = await createStarterDashboard({
      userBearer: BEARER,
      projectId: PROJECT,
      apiBaseUrl: BASE,
      dashboardName: 'X',
      events: [],
      client,
    });
    expect(result.dashboardId).toBe('dash-1');
    // 2 baseline insights, tile #1 (index 1) failed → only 1 tile survives.
    expect(result.insightNames).toEqual(['Total events']);
  });
});
