import * as http from 'node:http';
import { createHash } from 'node:crypto';

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

/** A fetcher that records the exchange call and returns a fixed token. */
function tokenFetcher(accessToken: string): {
  fetcher: typeof fetch;
  calls: { url: string; body: any }[];
} {
  const calls: { url: string; body: any }[] = [];
  const fetcher = ((
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    return Promise.resolve(
      new Response(JSON.stringify({ accessToken, tokenType: 'bearer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe('loginViaBrowser', () => {
  it('exchanges the callback code for a token via PKCE', async () => {
    const { fetcher, calls } = tokenFetcher('user_tok');
    const result = await loginViaBrowser({
      apiBaseUrl: 'https://api.honch.io',
      fetcher,
      open: (loginUrl) => {
        const u = new URL(loginUrl);
        const redirectUri = u.searchParams.get('redirect_uri') as string;
        const state = u.searchParams.get('state') as string;
        hit(`${redirectUri}?code=auth_code_123&state=${state}`);
      },
    });

    expect(result.token).toBe('user_tok');
    // Exchanged at the backend exchange route with the code + verifier.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.honch.io/api/auth/cli/exchange');
    expect(calls[0].body.code).toBe('auth_code_123');
    expect(typeof calls[0].body.codeVerifier).toBe('string');
  });

  it('sends a code_challenge that is the S256 hash of the verifier it later sends', async () => {
    const { fetcher, calls } = tokenFetcher('tok');
    let challenge = '';
    await loginViaBrowser({
      apiBaseUrl: 'https://api.honch.io',
      fetcher,
      open: (loginUrl) => {
        const u = new URL(loginUrl);
        challenge = u.searchParams.get('code_challenge') as string;
        const redirectUri = u.searchParams.get('redirect_uri') as string;
        const state = u.searchParams.get('state') as string;
        hit(`${redirectUri}?code=c&state=${state}`);
      },
    });

    const verifier = calls[0].body.codeVerifier as string;
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('builds a loopback redirect_uri and the CLI-login URL', async () => {
    const { fetcher } = tokenFetcher('t');
    let captured = '';
    await loginViaBrowser({
      apiBaseUrl: 'https://api.honch.io/',
      fetcher,
      open: (loginUrl) => {
        captured = loginUrl;
        const u = new URL(loginUrl);
        const redirectUri = u.searchParams.get('redirect_uri') as string;
        const state = u.searchParams.get('state') as string;
        hit(`${redirectUri}?code=c&state=${state}`);
      },
    });
    const u = new URL(captured);
    expect(`${u.origin}${u.pathname}`).toBe(
      'https://api.honch.io/api/auth/cli/login',
    );
    expect(u.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
    expect(u.searchParams.get('state')).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects when the returned state does not match', async () => {
    const { fetcher, calls } = tokenFetcher('tok');
    await expect(
      loginViaBrowser({
        apiBaseUrl: 'https://api.honch.io',
        fetcher,
        open: (loginUrl) => {
          const u = new URL(loginUrl);
          const redirectUri = u.searchParams.get('redirect_uri') as string;
          hit(`${redirectUri}?code=c&state=wrong`);
        },
      }),
    ).rejects.toThrow(/state parameter mismatch/);
    // A bad state must never reach the exchange.
    expect(calls).toHaveLength(0);
  });

  it('rejects when no authorization code is returned', async () => {
    const { fetcher } = tokenFetcher('tok');
    await expect(
      loginViaBrowser({
        apiBaseUrl: 'https://api.honch.io',
        fetcher,
        open: (loginUrl) => {
          const u = new URL(loginUrl);
          const redirectUri = u.searchParams.get('redirect_uri') as string;
          const state = u.searchParams.get('state') as string;
          hit(`${redirectUri}?state=${state}`);
        },
      }),
    ).rejects.toThrow(/did not return an authorization code/);
  });

  it('rejects when the token exchange fails', async () => {
    const fetcher = (() =>
      Promise.resolve(
        new Response('{"success":false}', { status: 401 }),
      )) as unknown as typeof fetch;
    await expect(
      loginViaBrowser({
        apiBaseUrl: 'https://api.honch.io',
        fetcher,
        open: (loginUrl) => {
          const u = new URL(loginUrl);
          const redirectUri = u.searchParams.get('redirect_uri') as string;
          const state = u.searchParams.get('state') as string;
          hit(`${redirectUri}?code=c&state=${state}`);
        },
      }),
    ).rejects.toThrow(/token exchange returned HTTP 401/);
  });

  it('rejects on timeout', async () => {
    await expect(
      loginViaBrowser({
        apiBaseUrl: 'https://api.honch.io',
        timeoutMs: 50,
        open: () => undefined,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
