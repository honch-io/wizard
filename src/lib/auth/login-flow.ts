/**
 * Shared browser-login routine used by both `honch login` and the default run
 * (when it finds no token). Runs the loopback flow, validates the returned
 * bearer against the platform, persists it, and returns it.
 *
 * Throws on failure so callers decide how to exit (the `login` command prints
 * and exits; the default run lets the wizard's top-level handler report it).
 */
import { loginViaBrowser } from './browser-login';
import { saveToken } from './credentials-store';
import { PlatformClient } from '@lib/platform/client';

export interface LoginIO {
  info: (message: string) => void;
}

const defaultIO: LoginIO = {
  info: (message) => process.stdout.write(`${message}\n`),
};

export interface PerformLoginOptions {
  /** Where to print progress; defaults to stdout. */
  io?: LoginIO;
  /** Injected browser opener (tests). Defaults to the real opener. */
  open?: (url: string) => void;
}

/**
 * Sign in via the browser and return the saved user bearer. The token is
 * persisted to `~/.honch/config.json` (keyed by `apiBaseUrl`) before returning.
 */
export async function performBrowserLogin(
  apiBaseUrl: string,
  options: PerformLoginOptions = {},
): Promise<string> {
  const io = options.io ?? defaultIO;

  io.info('\nOpening your browser to sign in to Honch…');

  const { token } = await loginViaBrowser({
    apiBaseUrl,
    open: options.open,
    onUrl: (url) =>
      io.info(
        `\nIf your browser didn't open, visit this URL to continue:\n\n  ${url}\n`,
      ),
  });

  // Confirm the bearer works (and the platform is reachable) before we claim
  // success or hand it to the rest of the wizard.
  await new PlatformClient(apiBaseUrl).createWizardToken(token);

  const path = saveToken(apiBaseUrl, token);
  io.info(`\x1b[1;92m✓ Signed in.\x1b[0m Token saved to ${path}`);
  return token;
}
