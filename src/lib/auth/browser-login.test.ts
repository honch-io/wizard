import * as http from 'node:http';

import { loginViaBrowser } from './browser-login';

/** Fire a GET at the loopback callback, simulating the platform's redirect.
 *  `agent: false` forces a one-off socket so requests don't pool across tests. */
function hit(url: string): void {
  http
    .get(url, { agent: false }, (res) => {
      res.resume();
    })
    .on('error', () => undefined);
}

describe('loginViaBrowser', () => {
  it('resolves with the token from a valid callback', async () => {
    const result = await loginViaBrowser({
      apiBaseUrl: 'https://app.honch.io',
      open: (loginUrl) => {
        const u = new URL(loginUrl);
        const redirectUri = u.searchParams.get('redirect_uri') as string;
        const state = u.searchParams.get('state') as string;
        hit(`${redirectUri}?token=user_tok&state=${state}`);
      },
    });
    expect(result.token).toBe('user_tok');
  });

  it('builds a loopback redirect_uri and the CLI-login URL', async () => {
    let captured = '';
    await loginViaBrowser({
      apiBaseUrl: 'https://app.honch.io/',
      open: (loginUrl) => {
        captured = loginUrl;
        const u = new URL(loginUrl);
        const redirectUri = u.searchParams.get('redirect_uri') as string;
        const state = u.searchParams.get('state') as string;
        hit(`${redirectUri}?token=t&state=${state}`);
      },
    });
    const u = new URL(captured);
    expect(`${u.origin}${u.pathname}`).toBe(
      'https://app.honch.io/api/auth/cli/login',
    );
    expect(u.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
    expect(u.searchParams.get('state')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects when the returned state does not match', async () => {
    await expect(
      loginViaBrowser({
        apiBaseUrl: 'https://app.honch.io',
        open: (loginUrl) => {
          const u = new URL(loginUrl);
          const redirectUri = u.searchParams.get('redirect_uri') as string;
          hit(`${redirectUri}?token=user_tok&state=wrong`);
        },
      }),
    ).rejects.toThrow(/state parameter mismatch/);
  });

  it('rejects when no token is returned', async () => {
    await expect(
      loginViaBrowser({
        apiBaseUrl: 'https://app.honch.io',
        open: (loginUrl) => {
          const u = new URL(loginUrl);
          const redirectUri = u.searchParams.get('redirect_uri') as string;
          const state = u.searchParams.get('state') as string;
          hit(`${redirectUri}?state=${state}`);
        },
      }),
    ).rejects.toThrow(/did not return a token/);
  });

  it('rejects on timeout', async () => {
    await expect(
      loginViaBrowser({
        apiBaseUrl: 'https://app.honch.io',
        timeoutMs: 50,
        open: () => undefined,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
