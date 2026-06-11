/**
 * Browser (loopback) login for the Honch wizard.
 *
 * Mirrors the OAuth "loopback redirect" pattern: the CLI starts a throwaway
 * HTTP server on a localhost port, opens the platform's CLI-login URL in the
 * browser, and waits for the platform to redirect back to
 * `http://127.0.0.1:<port>/callback?token=…&state=…`. The `state` is a random
 * nonce the CLI generated and verifies on the way back (CSRF / mix-up guard).
 *
 * The platform side (honch-io/platform) implements:
 *   GET /api/auth/cli/login?redirect_uri=<loopback>&state=<nonce>
 *     → drives the existing GitHub OAuth, then 302s the browser to
 *       <redirect_uri>?token=<user-bearer>&state=<nonce>
 *
 * On success the resolved `token` is the normal user bearer, which the caller
 * persists via the credentials store.
 */
import * as http from 'node:http';
import { randomBytes } from 'node:crypto';

import { OAUTH_PORTS } from '@lib/constants';
import { openBrowser } from './open-browser';

/** Default time to wait for the user to finish the browser flow. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface BrowserLoginOptions {
  /** Platform API base URL (backend), e.g. https://api.honch.io. */
  apiBaseUrl: string;
  /** Overall timeout; defaults to 5 minutes. */
  timeoutMs?: number;
  /** Called with the login URL so the caller can print it for manual opening. */
  onUrl?: (url: string) => void;
  /** Browser opener; injectable for tests. Defaults to {@link openBrowser}. */
  open?: (url: string) => void;
}

export interface BrowserLoginResult {
  /** The user bearer returned by the platform. */
  token: string;
}

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Honch</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px">
<h2>You're signed in to Honch ✓</h2>
<p>You can close this tab and return to your terminal.</p>
</body></html>`;

function errorHtml(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Honch</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px">
<h2>Login failed</h2>
<p>${message}</p>
<p>Return to your terminal and run <code>honcho-wizard login</code> again.</p>
</body></html>`;
}

/**
 * Bind an HTTP server to the first available loopback port from
 * {@link OAUTH_PORTS}. Throws if every candidate port is in use.
 */
async function startCallbackServer(
  handler: http.RequestListener,
): Promise<{ server: http.Server; port: number }> {
  for (const port of OAUTH_PORTS) {
    const server = http.createServer(handler);
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException): void => reject(err);
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onError);
          resolve();
        });
      });
      return { server, port };
    } catch (err) {
      server.close();
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') continue;
      throw err;
    }
  }
  throw new Error(
    `Could not start the local login server: ports ${OAUTH_PORTS.join(
      ', ',
    )} are all in use. Free one and retry, or pass a token with --token.`,
  );
}

/**
 * Run the browser login flow and resolve with the user bearer. Rejects on
 * timeout, state mismatch, a missing token, or if no loopback port is free.
 */
export function loginViaBrowser(
  options: BrowserLoginOptions,
): Promise<BrowserLoginResult> {
  const { apiBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const open = options.open ?? openBrowser;
  const state = randomBytes(32).toString('hex');

  return new Promise<BrowserLoginResult>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let server: http.Server | undefined;

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (server) server.close();
      action();
    };

    // This server lives for a single request then closes; tell clients not to
    // hold the connection open (avoids lingering keep-alive sockets).
    const html = { 'Content-Type': 'text/html', Connection: 'close' };

    const handler: http.RequestListener = (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404, {
          'Content-Type': 'text/plain',
          Connection: 'close',
        });
        res.end('Not found');
        return;
      }

      const returnedState = url.searchParams.get('state');
      if (!returnedState || returnedState !== state) {
        res.writeHead(400, html);
        res.end(errorHtml('Security check failed (state mismatch).'));
        finish(() =>
          reject(
            new Error(
              'Login failed: state parameter mismatch (possible CSRF). Please run honcho-wizard login again.',
            ),
          ),
        );
        return;
      }

      const token = url.searchParams.get('token');
      if (!token) {
        res.writeHead(400, html);
        res.end(errorHtml('No token was returned by Honch.'));
        finish(() =>
          reject(
            new Error('Login failed: the platform did not return a token.'),
          ),
        );
        return;
      }

      res.writeHead(200, html);
      res.end(SUCCESS_HTML);
      finish(() => resolve({ token }));
    };

    startCallbackServer(handler)
      .then(({ server: started, port }) => {
        server = started;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const loginUrl =
          `${apiBaseUrl.replace(/\/+$/, '')}/api/auth/cli/login` +
          `?redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&state=${state}`;

        timer = setTimeout(() => {
          finish(() =>
            reject(
              new Error(
                'Login timed out after 5 minutes. Run honcho-wizard login to try again.',
              ),
            ),
          );
        }, timeoutMs);

        options.onUrl?.(loginUrl);
        open(loginUrl);
      })
      .catch((err) => finish(() => reject(err)));
  });
}
