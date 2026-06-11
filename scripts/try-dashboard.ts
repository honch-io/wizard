/**
 * Local smoke test for the starter-dashboard feature.
 *
 * Exercises the SAME code path the wizard uses (createStarterDashboard →
 * PlatformClient) against a local platform, without the agent/LLM. Every API
 * call goes to whatever `--api-base-url` you pass, so it proves the requests
 * land locally.
 *
 * Usage:
 *   HONCH_BEARER=<userJWT> HONCH_PROJECT_ID=<uuid> \
 *     bun run try:dashboard -- --api-base-url=http://localhost:3001 boot button_press
 *
 * (Anything after the flags is treated as an instrumented event name. Baseline
 * tiles — total events + active devices — are always added on top.)
 */

import { createStarterDashboard } from '@lib/dashboards/create-starter-dashboard';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}

async function main(): Promise<void> {
  const apiBaseUrl =
    arg('api-base-url') ??
    process.env.HONCH_WIZARD_API_BASE_URL ??
    'http://localhost:3001';
  const frontendUrl =
    arg('frontend-url') ?? process.env.HONCH_WIZARD_FRONTEND_URL;
  const userBearer = arg('bearer') ?? process.env.HONCH_BEARER;
  const projectId = arg('project-id') ?? process.env.HONCH_PROJECT_ID;

  if (!userBearer || !projectId) {
    console.error(
      'Missing credentials. Set HONCH_BEARER and HONCH_PROJECT_ID (or pass --bearer= and --project-id=).',
    );
    process.exit(1);
  }

  const events = process.argv
    .slice(2)
    .filter((a) => !a.startsWith('--'))
    .map((name) => ({ name }));

  console.log(`→ Creating starter dashboard via ${apiBaseUrl}`);
  console.log(`  project: ${projectId}`);
  console.log(
    `  custom events: ${
      events.length
        ? events.map((e) => e.name).join(', ')
        : '(none — baseline only)'
    }`,
  );

  const result = await createStarterDashboard({
    userBearer,
    projectId,
    apiBaseUrl,
    frontendUrl,
    dashboardName: 'Wizard Local Test',
    events,
  });

  console.log('\n✓ Done.');
  console.log(`  insights: ${result.insightNames.join(', ')}`);
  console.log(`  dashboard URL: ${result.dashboardUrl}`);
}

main().catch((err) => {
  console.error('\n✗ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
