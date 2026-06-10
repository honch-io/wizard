/**
 * Tests for the Honch wizard's external-service health checks.
 *
 * The wizard's LLM runs through the Honch platform proxy, so readiness only
 * sanity-checks the generic infra it depends on: Anthropic (the model), GitHub
 * and npm (SDK installs), and Cloudflare. PostHog-specific checks were removed
 * in the fork.
 *
 * Mock data is modelled on live Statuspage.io v2 API responses.
 *   status.json  – page-level rollup (indicator: none | minor | major | critical)
 *   summary.json – rollup plus component list (operational | degraded_performance
 *                  | partial_outage | major_outage | under_maintenance)
 */

import {
  checkAllExternalServices,
  checkAnthropicHealth,
  checkCloudflareComponentHealth,
  checkCloudflareOverallHealth,
  checkGithubHealth,
  checkNpmComponentHealth,
  checkNpmOverallHealth,
  DEFAULT_WIZARD_READINESS_CONFIG,
  evaluateWizardReadiness,
  ServiceHealthStatus,
  WizardReadiness,
} from '@lib/health-checks/index';

// ---------------------------------------------------------------------------
// Statuspage.io v2 response factories
// ---------------------------------------------------------------------------

function makeStatuspageStatus(opts: {
  pageName: string;
  pageUrl: string;
  indicator: 'none' | 'minor' | 'major' | 'critical';
  description: string;
}) {
  return {
    page: { id: 'p', name: opts.pageName, url: opts.pageUrl },
    status: { indicator: opts.indicator, description: opts.description },
  };
}

function makeStatuspageSummary(opts: {
  pageName: string;
  pageUrl: string;
  indicator: 'none' | 'minor' | 'major' | 'critical';
  description: string;
  components: { id: string; name: string; status: string; position: number }[];
}) {
  return {
    page: { id: 'p', name: opts.pageName, url: opts.pageUrl },
    status: { indicator: opts.indicator, description: opts.description },
    components: opts.components.map((c) => ({
      ...c,
      page_id: 'p',
      group_id: null,
      group: false,
      only_show_if_degraded: false,
    })),
    incidents: [],
    scheduled_maintenances: [],
  };
}

const ANTHROPIC_STATUS_HEALTHY = makeStatuspageStatus({
  pageName: 'Claude',
  pageUrl: 'https://status.claude.com',
  indicator: 'none',
  description: 'All Systems Operational',
});

const GITHUB_STATUS_HEALTHY = makeStatuspageStatus({
  pageName: 'GitHub',
  pageUrl: 'https://www.githubstatus.com',
  indicator: 'none',
  description: 'All Systems Operational',
});

const NPM_STATUS_HEALTHY = makeStatuspageStatus({
  pageName: 'npm',
  pageUrl: 'https://status.npmjs.org',
  indicator: 'none',
  description: 'All Systems Operational',
});

const NPM_SUMMARY_HEALTHY = makeStatuspageSummary({
  pageName: 'npm',
  pageUrl: 'https://status.npmjs.org',
  indicator: 'none',
  description: 'All Systems Operational',
  components: [
    {
      id: 'a',
      name: 'www.npmjs.com website',
      status: 'operational',
      position: 1,
    },
    {
      id: 'b',
      name: 'Package installation',
      status: 'operational',
      position: 2,
    },
  ],
});

const CLOUDFLARE_STATUS_HEALTHY = makeStatuspageStatus({
  pageName: 'Cloudflare',
  pageUrl: 'https://www.cloudflarestatus.com',
  indicator: 'none',
  description: 'All Systems Operational',
});

const CLOUDFLARE_SUMMARY_HEALTHY = makeStatuspageSummary({
  pageName: 'Cloudflare',
  pageUrl: 'https://www.cloudflarestatus.com',
  indicator: 'none',
  description: 'All Systems Operational',
  components: [
    {
      id: 'c',
      name: 'Cloudflare Sites and Services',
      status: 'operational',
      position: 1,
    },
  ],
});

// ---------------------------------------------------------------------------
// URLs the checks fetch (must match statuspage.ts)
// ---------------------------------------------------------------------------

const URLS = {
  anthropicStatus: 'https://status.claude.com/api/v2/status.json',
  githubStatus: 'https://www.githubstatus.com/api/v2/status.json',
  npmStatus: 'https://status.npmjs.org/api/v2/status.json',
  npmSummary: 'https://status.npmjs.org/api/v2/summary.json',
  cloudflareStatus: 'https://www.cloudflarestatus.com/api/v2/status.json',
  cloudflareSummary: 'https://www.cloudflarestatus.com/api/v2/summary.json',
} as const;

const HEALTHY_RESPONSES: Record<string, { body: string; contentType: string }> =
  {
    [URLS.anthropicStatus]: {
      body: JSON.stringify(ANTHROPIC_STATUS_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.githubStatus]: {
      body: JSON.stringify(GITHUB_STATUS_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.npmStatus]: {
      body: JSON.stringify(NPM_STATUS_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.npmSummary]: {
      body: JSON.stringify(NPM_SUMMARY_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.cloudflareStatus]: {
      body: JSON.stringify(CLOUDFLARE_STATUS_HEALTHY),
      contentType: 'application/json',
    },
    [URLS.cloudflareSummary]: {
      body: JSON.stringify(CLOUDFLARE_SUMMARY_HEALTHY),
      contentType: 'application/json',
    },
  };

function allHealthyFetchMock(url: string | URL | Request): Promise<Response> {
  const urlStr =
    typeof url === 'string'
      ? url
      : url instanceof URL
      ? url.toString()
      : url.url;
  const entry = HEALTHY_RESPONSES[urlStr];
  if (entry) {
    return Promise.resolve(
      new Response(entry.body, {
        status: 200,
        headers: { 'Content-Type': entry.contentType },
      }),
    );
  }
  return Promise.resolve(new Response('Not found', { status: 404 }));
}

function overrideFetch(overrides: Record<string, () => Promise<Response>>) {
  return (url: string | URL | Request): Promise<Response> => {
    const urlStr =
      typeof url === 'string'
        ? url
        : url instanceof URL
        ? url.toString()
        : url.url;
    if (overrides[urlStr]) return overrides[urlStr]();
    return allHealthyFetchMock(urlStr);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('health-checks', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = jest.fn(allHealthyFetchMock);
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  describe('individual status checks', () => {
    it('returns healthy for indicator=none', async () => {
      expect((await checkAnthropicHealth()).status).toBe(
        ServiceHealthStatus.Healthy,
      );
      expect((await checkGithubHealth()).status).toBe(
        ServiceHealthStatus.Healthy,
      );
      expect((await checkNpmOverallHealth()).status).toBe(
        ServiceHealthStatus.Healthy,
      );
      expect((await checkCloudflareOverallHealth()).status).toBe(
        ServiceHealthStatus.Healthy,
      );
    });

    it('maps a critical indicator to Down', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.npmStatus]: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(
                  makeStatuspageStatus({
                    pageName: 'npm',
                    pageUrl: 'https://status.npmjs.org',
                    indicator: 'critical',
                    description: 'Major Service Outage',
                  }),
                ),
                { status: 200 },
              ),
            ),
        }),
      );
      expect((await checkNpmOverallHealth()).status).toBe(
        ServiceHealthStatus.Down,
      );
    });

    it('treats a network error as Degraded (status pages never hard-block)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.anthropicStatus]: () => Promise.reject(new Error('boom')),
        }),
      );
      expect((await checkAnthropicHealth()).status).toBe(
        ServiceHealthStatus.Degraded,
      );
    });

    it('reports component health', async () => {
      expect((await checkNpmComponentHealth()).status).toBe(
        ServiceHealthStatus.Healthy,
      );
      expect((await checkCloudflareComponentHealth()).status).toBe(
        ServiceHealthStatus.Healthy,
      );
    });
  });

  describe('checkAllExternalServices', () => {
    it('returns exactly the six generic service keys', async () => {
      const health = await checkAllExternalServices();
      const keys = Object.keys(health).sort();
      expect(keys).toEqual(
        [
          'anthropic',
          'cloudflareComponents',
          'cloudflareOverall',
          'github',
          'npmComponents',
          'npmOverall',
        ].sort(),
      );
      for (const val of Object.values(health)) {
        expect(val.status).toBe(ServiceHealthStatus.Healthy);
      }
    });

    it('does not ping any PostHog endpoint', async () => {
      await checkAllExternalServices();
      const calledUrls = (global.fetch as jest.Mock).mock.calls.map(
        (c: unknown[]) =>
          typeof c[0] === 'string' ? c[0] : (c[0] as URL).toString(),
      );
      expect(calledUrls.some((u) => u.includes('posthog'))).toBe(false);
      expect(calledUrls).toContain(URLS.anthropicStatus);
    });
  });

  describe('evaluateWizardReadiness', () => {
    it('returns Yes when all services are healthy', async () => {
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.Yes);
    });

    it('returns YesWithWarnings when Anthropic is degraded (no longer blocks)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.anthropicStatus]: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(
                  makeStatuspageStatus({
                    pageName: 'Claude',
                    pageUrl: 'https://status.claude.com',
                    indicator: 'minor',
                    description: 'Minor Service Outage',
                  }),
                ),
                { status: 200 },
              ),
            ),
        }),
      );
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.YesWithWarnings);
      expect(result.health.anthropic.status).toBe(ServiceHealthStatus.Degraded);
    });

    it('returns No when Anthropic is down (downBlocksRun)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.anthropicStatus]: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(
                  makeStatuspageStatus({
                    pageName: 'Claude',
                    pageUrl: 'https://status.claude.com',
                    indicator: 'critical',
                    description: 'Major Service Outage',
                  }),
                ),
                { status: 200 },
              ),
            ),
        }),
      );
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.No);
      expect(result.health.anthropic.status).toBe(ServiceHealthStatus.Down);
    });

    it('returns No when npm overall is down (downBlocksRun)', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.npmStatus]: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(
                  makeStatuspageStatus({
                    pageName: 'npm',
                    pageUrl: 'https://status.npmjs.org',
                    indicator: 'critical',
                    description: 'Major Service Outage',
                  }),
                ),
                { status: 200 },
              ),
            ),
        }),
      );
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.No);
      expect(result.health.npmOverall.status).toBe(ServiceHealthStatus.Down);
    });

    it('returns YesWithWarnings when a non-blocking service is degraded', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        overrideFetch({
          [URLS.cloudflareStatus]: () =>
            Promise.resolve(
              new Response(
                JSON.stringify(
                  makeStatuspageStatus({
                    pageName: 'Cloudflare',
                    pageUrl: 'https://www.cloudflarestatus.com',
                    indicator: 'minor',
                    description: 'Minor Service Outage',
                  }),
                ),
                { status: 200 },
              ),
            ),
        }),
      );
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.decision).toBe(WizardReadiness.YesWithWarnings);
    });

    it('includes human-readable reasons for the checked services', async () => {
      const result = await evaluateWizardReadiness(
        DEFAULT_WIZARD_READINESS_CONFIG,
      );
      expect(result.reasons.some((r) => r.includes('Anthropic'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('GitHub'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('npm'))).toBe(true);
      expect(result.reasons.every((r) => !r.includes('PostHog'))).toBe(true);
    });
  });
});
