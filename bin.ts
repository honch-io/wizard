#!/usr/bin/env node
import { satisfies } from 'semver';

const NODE_VERSION_RANGE = '>=18.17.0';

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  // eslint-disable-next-line no-console
  console.log(
    `Honch wizard requires Node.js ${NODE_VERSION_RANGE}. You are using Node.js ${process.version}. Please upgrade your Node.js version.`,
  );
  process.exit(1);
}

// Test mock server — only loaded when NODE_ENV is 'test'.
// In production builds, tsdown replaces process.env.NODE_ENV with 'production',
// making this block dead code.
if (process.env.NODE_ENV === 'test') {
  void (async () => {
    try {
      const { server } = await import('./e2e-tests/mocks/server.js');
      server.listen({
        onUnhandledRequest: 'bypass',
      });
    } catch (error) {
      // Mock server import failed - this can happen during non-E2E tests
    }
  })();
}

import { Wizard } from './src/wizard';
import { basicIntegrationCommand } from './src/commands/basic-integration';

// The Honch wizard has a single entry point: paste a bearer token and it
// installs the Honch SDK. (PostHog's audit / revenue / migration / doctor /
// mcp / sourcemap subcommands were removed in the fork.)
Wizard.use(basicIntegrationCommand).init();
