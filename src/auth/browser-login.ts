/**
 * Browser (loopback) login for the Honch wizard — PKCE authorization-code flow.
 *
 * The backend (honch-io/platform) deliberately never sends the bearer token
 * through the loopback URL. Instead it uses PKCE: only a short-lived, one-time
 * authorization `code` travels through the browser, and the CLI redeems it for
 * the token over a direct back-channel POST. The flow:
 *
 *   1. CLI generates a random `code_verifier` and its S256 challenge
 *      `code_challenge = base64url(sha256(code_verifier))`.
 *   2. CLI opens, in the browser:
 *        GET {api}/api/auth/cli/login?redirect_uri=<loopback>&state=<nonce>&code_challenge=<challenge>
 *      The backend 302s the browser to the global web login page
 *        {FRONTEND_URL}/login?cli_redirect=<loopback>&state=<nonce>&code_challenge=<challenge>
 *   3. The user signs in by any method. The logged-in web app mints a one-time
 *      `code` (bound to the user + loopback + challenge) and forwards the
 *      browser to  <loopback>?code=<code>&state=<nonce>.
 *   4. CLI verifies `state`, then POSTs to
 *        {api}/api/auth/cli/exchange  { code, codeVerifier }
 *      The backend verifies sha256(codeVerifier) === code_challenge and returns
 *        { accessToken, tokenType: "bearer" }.
 *
 * `state` is a CSRF/mix-up guard; `code_verifier` proves the redeeming CLI is
 * the same one that started the flow. The resolved token is the normal user
 * bearer, which the caller persists via the credentials store.
 *
 * NOTE: `redirect_uri` must be `http://127.0.0.1[:port]/callback` or
 * `http://localhost[:port]/callback` — the backend rejects anything else.
 */

import { createHash, randomBytes } from "node:crypto";
import * as http from "node:http";

import { openBrowser } from "./open-browser.js";

/**
 * Loopback ports the CLI tries in order for the OAuth callback server. The
 * backend allowlists these for the cli login redirect_uri.
 */
const OAUTH_PORTS = [8239, 8238, 8240, 8237, 8236, 8235] as const;

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
  /** Fetch impl for the token-exchange back-channel; injectable for tests. */
  fetcher?: typeof fetch;
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

/** PKCE S256 challenge for a verifier — must match the backend's
 *  `createHash("sha256").update(verifier).digest("base64url")`. */
function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/**
 * Redeem the one-time authorization code for the user bearer over the direct
 * back-channel. The code + verifier are the proof; no auth header is sent.
 */
async function exchangeCodeForToken(
  apiBaseUrl: string,
  code: string,
  codeVerifier: string,
  fetcher: typeof fetch,
): Promise<string> {
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/api/auth/cli/exchange`;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, codeVerifier }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Honch to complete login at ${url}. Check your network or pass --api-base-url.`,
      { cause: err },
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Login failed: token exchange returned HTTP ${response.status}${
        text ? ` - ${text}` : ""
      }`,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const accessToken = (body as { accessToken?: unknown } | undefined)
    ?.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Login failed: Honch did not return an access token.");
  }
  return accessToken;
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
        server.once("error", onError);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", onError);
          resolve();
        });
      });
      return { server, port };
    } catch (err) {
      server.close();
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw err;
    }
  }
  throw new Error(
    `Could not start the local login server: ports ${OAUTH_PORTS.join(
      ", ",
    )} are all in use. Free one and retry, or pass a token with --token.`,
  );
}

/**
 * Run the browser login flow and resolve with the user bearer. Rejects on
 * timeout, state mismatch, a missing authorization code, a failed token
 * exchange, or if no loopback port is free.
 */
export function loginViaBrowser(
  options: BrowserLoginOptions,
): Promise<BrowserLoginResult> {
  const { apiBaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const open = options.open ?? openBrowser;
  const fetcher = options.fetcher ?? fetch;
  const state = randomBytes(32).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = pkceChallenge(codeVerifier);

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
    const html = { "Content-Type": "text/html", Connection: "close" };

    const onCallback = async (
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ): Promise<void> => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404, {
          "Content-Type": "text/plain",
          Connection: "close",
        });
        res.end("Not found");
        return;
      }

      const returnedState = url.searchParams.get("state");
      if (!returnedState || returnedState !== state) {
        res.writeHead(400, html);
        res.end(errorHtml("Security check failed (state mismatch)."));
        finish(() =>
          reject(
            new Error(
              "Login failed: state parameter mismatch (possible CSRF). Please run honcho-wizard login again.",
            ),
          ),
        );
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, html);
        res.end(errorHtml("No authorization code was returned by Honch."));
        finish(() =>
          reject(
            new Error(
              "Login failed: the platform did not return an authorization code.",
            ),
          ),
        );
        return;
      }

      // Redeem the code over the back-channel before reporting success — a
      // failed exchange must surface as a login failure, not a green tab.
      try {
        const token = await exchangeCodeForToken(
          apiBaseUrl,
          code,
          codeVerifier,
          fetcher,
        );
        res.writeHead(200, html);
        res.end(SUCCESS_HTML);
        finish(() => resolve({ token }));
      } catch (err) {
        res.writeHead(502, html);
        res.end(errorHtml("Could not complete sign-in. Please try again."));
        finish(() =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
      }
    };

    const handler: http.RequestListener = (req, res) => {
      void onCallback(req, res);
    };

    startCallbackServer(handler)
      .then(({ server: started, port }) => {
        server = started;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const loginUrl =
          `${apiBaseUrl.replace(/\/+$/, "")}/api/auth/cli/login` +
          `?redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&state=${state}` +
          `&code_challenge=${encodeURIComponent(codeChallenge)}`;

        timer = setTimeout(() => {
          finish(() =>
            reject(
              new Error(
                "Login timed out after 5 minutes. Run honcho-wizard login to try again.",
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
