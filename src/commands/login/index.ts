import type { Arguments } from 'yargs';

import { DEFAULT_API_BASE_URL } from '@lib/constants';
import type { Command } from '../command';

/**
 * `honcho-wizard login` — browser sign-in that saves a token for future runs.
 *
 * Opens the platform's CLI-login page, completes the loopback OAuth handshake,
 * sanity-checks the returned bearer against the platform, and persists it to
 * `~/.honch/config.json`. After this, bare `honcho-wizard`
 * (or `npx -y honcho-wizard`) runs with no token prompt.
 *
 * The default run auto-triggers the same flow when it finds no token, so this
 * command is mainly for signing in ahead of time or refreshing an expired
 * login.
 */
export const loginCommand: Command = {
  name: 'login',
  description:
    'Sign in to Honch in your browser and save the token for future runs',
  examples: [
    ['honcho-wizard login', 'Open the browser, sign in, and save your token'],
  ],
  handler: (argv) => {
    void runLogin(argv);
  },
};

async function runLogin(argv: Arguments): Promise<void> {
  const apiBaseUrl =
    (argv['api-base-url'] as string | undefined) ?? DEFAULT_API_BASE_URL;

  const { performBrowserLogin } = await import('@lib/auth/login-flow');

  try {
    await performBrowserLogin(apiBaseUrl);
    process.stdout.write(
      'Run `honcho-wizard` in your project to install the Honch SDK.\n\n',
    );
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n\x1b[1;91m✖ Login failed:\x1b[0m ${message}\n\n`);
    process.exit(1);
  }
}
