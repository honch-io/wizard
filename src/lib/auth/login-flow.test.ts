import * as http from 'node:http';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { join } from 'node:path';

import { performBrowserLogin } from './login-flow';
import { readSavedToken } from './credentials-store';

/** A mock platform: cli/login redirects to the loopback; wizard/token validates. */
function startMockPlatform(validBearer: string): Promise<{
  apiBaseUrl: string;
  close: () => void;
}> {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (u.pathname === '/api/auth/cli/login') {
      const redirect = u.searchParams.get('redirect_uri') as string;
      const state = u.searchParams.get('state') as string;
      res.writeHead(302, {
        Location: `${redirect}?token=${validBearer}&state=${state}`,
      });
      res.end();
      return;
    }
    if (u.pathname === '/api/wizard/token' && req.method === 'POST') {
      if (req.headers.authorization === `Bearer ${validBearer}`) {
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

  it('signs in, validates, and persists the token', async () => {
    const platform = await startMockPlatform('user_jwt_42');
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
    // Platform accepts only "good"; drive the callback with "bad" → 401.
    const platform = await startMockPlatform('good');
    try {
      await expect(
        performBrowserLogin(platform.apiBaseUrl, {
          io: silentIO,
          open: (loginUrl) => {
            const u = new URL(loginUrl);
            const redirect = u.searchParams.get('redirect_uri') as string;
            const state = u.searchParams.get('state') as string;
            void fetch(`${redirect}?token=bad&state=${state}`);
          },
        }),
      ).rejects.toThrow(/HTTP 401/);
      expect(readSavedToken(platform.apiBaseUrl)).toBeNull();
    } finally {
      platform.close();
    }
  });
});
