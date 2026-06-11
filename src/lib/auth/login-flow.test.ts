import * as http from 'node:http';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { join } from 'node:path';

import { performBrowserLogin } from './login-flow';
import { readSavedToken } from './credentials-store';

/**
 * A mock platform implementing the real PKCE flow:
 *  - GET  /api/auth/cli/login  → 302 to the loopback with `?code&state`
 *  - POST /api/auth/cli/exchange → trades the code for `issued` bearer
 *  - POST /api/wizard/token    → validates the bearer (accepts `accepts`)
 *
 * `issued` is what the exchange hands back; `accepts` is the bearer the
 * token-mint route honors. Make them differ to simulate a rejected token.
 */
function startMockPlatform(opts: {
  issued: string;
  accepts?: string;
}): Promise<{ apiBaseUrl: string; close: () => void }> {
  const accepts = opts.accepts ?? opts.issued;
  const AUTH_CODE = 'auth_code_xyz';

  const readBody = (req: http.IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
    });

  const server = http.createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (u.pathname === '/api/auth/cli/login') {
        const redirect = u.searchParams.get('redirect_uri') as string;
        const state = u.searchParams.get('state') as string;
        // Real backend requires a PKCE challenge here.
        if (!u.searchParams.get('code_challenge')) {
          res.writeHead(400);
          res.end('missing code_challenge');
          return;
        }
        res.writeHead(302, {
          Location: `${redirect}?code=${AUTH_CODE}&state=${state}`,
        });
        res.end();
        return;
      }

      if (u.pathname === '/api/auth/cli/exchange' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as {
          code?: string;
          codeVerifier?: string;
        };
        if (body.code === AUTH_CODE && body.codeVerifier) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ accessToken: opts.issued, tokenType: 'bearer' }),
          );
        } else {
          res.writeHead(400);
          res.end('bad code');
        }
        return;
      }

      if (u.pathname === '/api/wizard/token' && req.method === 'POST') {
        if (req.headers.authorization === `Bearer ${accepts}`) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accessToken: 'wiz', tokenType: 'bearer' }));
        } else {
          res.writeHead(401);
          res.end('unauthorized');
        }
        return;
      }

      res.writeHead(404);
      res.end();
    })();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        apiBaseUrl: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}

/** Stand in for the browser: follow cli/login's redirect to the loopback. */
function followRedirect(loginUrl: string): void {
  void (async () => {
    const res = await fetch(loginUrl, { redirect: 'manual' });
    const location = res.headers.get('location');
    if (location) await fetch(location);
  })();
}

describe('performBrowserLogin', () => {
  let tmp: string;
  const prevOverride = process.env.HONCH_WIZARD_CONFIG_DIR;
  const silentIO = { info: () => undefined };

  beforeEach(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'honch-login-'));
    process.env.HONCH_WIZARD_CONFIG_DIR = join(tmp, '.honch');
  });

  afterEach(() => {
    if (prevOverride === undefined) delete process.env.HONCH_WIZARD_CONFIG_DIR;
    else process.env.HONCH_WIZARD_CONFIG_DIR = prevOverride;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('signs in via PKCE, validates, and persists the token', async () => {
    const platform = await startMockPlatform({ issued: 'user_jwt_42' });
    try {
      const token = await performBrowserLogin(platform.apiBaseUrl, {
        io: silentIO,
        open: followRedirect,
      });
      expect(token).toBe('user_jwt_42');
      expect(readSavedToken(platform.apiBaseUrl)).toBe('user_jwt_42');
    } finally {
      platform.close();
    }
  });

  it('does not persist a token the platform rejects', async () => {
    // Exchange issues "bad", but the token-mint route only accepts "good".
    const platform = await startMockPlatform({
      issued: 'bad',
      accepts: 'good',
    });
    try {
      await expect(
        performBrowserLogin(platform.apiBaseUrl, {
          io: silentIO,
          open: followRedirect,
        }),
      ).rejects.toThrow(/HTTP 401/);
      expect(readSavedToken(platform.apiBaseUrl)).toBeNull();
    } finally {
      platform.close();
    }
  });
});
