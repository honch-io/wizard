import { http, HttpResponse, passthrough } from 'msw';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_HOST_URL,
} from '../../src/lib/constants';
import { fixtureTracker } from './fixture-tracker';

export const shouldRecord = process.env.RECORD_FIXTURES === 'true';

export const handlers = [
  http.post(`${DEFAULT_API_BASE_URL}/api/wizard/initialize`, () => {
    return HttpResponse.json({
      hash: 'mock-wizard-hash-123',
    });
  }),

  http.get(`${DEFAULT_API_BASE_URL}/api/wizard/data`, ({ request }) => {
    const accessToken = request.headers.get('X-PostHog-Wizard-Hash');
    if (accessToken === 'mock-wizard-hash-123') {
      return HttpResponse.json({
        project_api_key: 'mock-project-api-key',
        host: DEFAULT_HOST_URL,
        user_distinct_id: 'mock-user-id',
        personal_api_key: 'mock-personal-api-key',
      });
    }
    return HttpResponse.json({ error: 'Invalid wizard hash' }, { status: 401 });
  }),

  http.post(`${DEFAULT_API_BASE_URL}/api/wizard/query`, async ({ request }) => {
    const requestBody = await request.clone().text();

    const fixture = fixtureTracker.retrieveQueryFixture(requestBody);

    if (fixture) {
      fixtureTracker.markFixtureAsUsed(requestBody);
      return HttpResponse.json({ data: fixture });
    }

    if (shouldRecord) {
      return passthrough();
    }

    throw new Error(
      'Missing fixture for LLM query. Rerun using RECORD_FIXTURES=true',
    );
  }),
];
