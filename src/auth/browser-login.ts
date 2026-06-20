/**
 * Browser (loopback) login for the Honch wizard — OAuth PKCE code flow.
 *
 * The platform never sends the bearer token through the loopback URL. Only a
 * short-lived authorization code travels through the browser, and the CLI
 * redeems it over a direct back-channel POST. The flow:
 *
 *   1. Register a public OAuth client for the selected loopback redirect URI.
 *   2. Open {api}/api/oauth/authorize with response_type=code and PKCE S256.
 *   3. The frontend consent page redirects to <loopback>?code=...&state=....
 *   4. Exchange the code at {api}/api/oauth/token.
 *
 * `state` guards against CSRF/mix-up; `code_verifier` proves the redeeming CLI
 * is the same process that started the flow.
 */

import { createHash, randomBytes } from "node:crypto";
import * as http from "node:http";

import { openBrowser } from "./open-browser.js";

/**
 * Loopback ports the CLI tries in order for the OAuth callback server. The
 * dynamically registered OAuth client is scoped to the first port that binds.
 */
const OAUTH_PORTS = [8239, 8238, 8240, 8237, 8236, 8235] as const;

/** Default time to wait for the user to finish the browser flow. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SCOPE = "read:projects";
const CLIENT_NAME = "Honch Wizard";

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
  /** OAuth client id returned by dynamic client registration. */
  clientId: string;
  /** Opaque refresh token returned by the OAuth token endpoint. */
  refreshToken?: string;
  /** ISO timestamp when the access token expires. */
  expiresAt?: string;
  /** Space-delimited OAuth scopes granted to the client. */
  scope: string;
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
<p>Return to your terminal and run <code>honch</code> again.</p>
</body></html>`;
}

/** PKCE S256 challenge for a verifier — must match the backend's
 *  `createHash("sha256").update(verifier).digest("base64url")`. */
function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

type OAuthTokenResponse = {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
};

async function registerOAuthClient(
  apiBaseUrl: string,
  redirectUri: string,
  fetcher: typeof fetch,
): Promise<{ clientId: string; scope: string }> {
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/api/oauth/register`;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        scope: DEFAULT_SCOPE,
        token_endpoint_auth_method: "none",
      }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Honch to start OAuth login at ${url}. Check your network or pass --api-base-url.`,
      { cause: err },
    );
  }

  const body = await parseOAuthResponse(response, "client registration");
  const clientId = (body as { client_id?: unknown }).client_id;
  const scope = (body as { scope?: unknown }).scope;
  if (typeof clientId !== "string" || clientId.length === 0) {
    throw new Error("Login failed: Honch did not return an OAuth client id.");
  }

  return {
    clientId,
    scope:
      typeof scope === "string" && scope.length > 0 ? scope : DEFAULT_SCOPE,
  };
}

/** Redeem the one-time authorization code for the user bearer. */
async function exchangeCodeForToken(
  apiBaseUrl: string,
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  fetcher: typeof fetch,
): Promise<BrowserLoginResult> {
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/api/oauth/token`;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Honch to complete login at ${url}. Check your network or pass --api-base-url.`,
      { cause: err },
    );
  }

  return tokenResultFromResponse(response, clientId, "token exchange");
}

export async function refreshOAuthSession(options: {
  apiBaseUrl: string;
  clientId: string;
  refreshToken: string;
  scope?: string;
  fetcher?: typeof fetch;
}): Promise<BrowserLoginResult> {
  const fetcher = options.fetcher ?? fetch;
  const url = `${options.apiBaseUrl.replace(/\/+$/, "")}/api/oauth/token`;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: options.refreshToken,
        client_id: options.clientId,
        ...(options.scope ? { scope: options.scope } : {}),
      }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Honch to refresh login at ${url}. Check your network or pass --api-base-url.`,
      { cause: err },
    );
  }

  return tokenResultFromResponse(response, options.clientId, "token refresh");
}

async function tokenResultFromResponse(
  response: Response,
  clientId: string,
  label: "token exchange" | "token refresh",
): Promise<BrowserLoginResult> {
  const body = (await parseOAuthResponse(
    response,
    label,
  )) as OAuthTokenResponse;
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Login failed: Honch did not return an access token.");
  }

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 0;
  const refreshToken =
    typeof body.refresh_token === "string" && body.refresh_token.length > 0
      ? body.refresh_token
      : undefined;
  const scope =
    typeof body.scope === "string" && body.scope.length > 0
      ? body.scope
      : DEFAULT_SCOPE;

  return {
    token: accessToken,
    clientId,
    refreshToken,
    expiresAt:
      expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined,
    scope,
  };
}

async function parseOAuthResponse(response: Response, label: string) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Login failed: ${label} returned HTTP ${response.status}${
        text ? ` - ${text}` : ""
      }`,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `Login failed: Honch returned an invalid ${label} response.`,
    );
  }
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
  const oauthClient = {
    clientId: "",
    redirectUri: "",
    scope: DEFAULT_SCOPE,
  };

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
              "Login failed: state parameter mismatch (possible CSRF). Please run honch again.",
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

      // Redeem the code over the back-channel before reporting success; a
      // failed exchange must surface as a login failure, not a green tab.
      try {
        const token = await exchangeCodeForToken(
          apiBaseUrl,
          code,
          oauthClient.clientId,
          oauthClient.redirectUri,
          codeVerifier,
          fetcher,
        );
        res.writeHead(200, html);
        res.end(SUCCESS_HTML);
        finish(() => resolve(token));
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
        oauthClient.redirectUri = redirectUri;
        return registerOAuthClient(apiBaseUrl, redirectUri, fetcher).then(
          (client) => {
            oauthClient.clientId = client.clientId;
            oauthClient.scope = client.scope;
            const loginUrl = buildAuthorizeUrl({
              apiBaseUrl,
              clientId: client.clientId,
              redirectUri,
              state,
              codeChallenge,
              scope: client.scope,
            });

            timer = setTimeout(() => {
              finish(() =>
                reject(
                  new Error(
                    "Login timed out after 5 minutes. Run honch to try again.",
                  ),
                ),
              );
            }, timeoutMs);

            options.onUrl?.(loginUrl);
            open(loginUrl);
          },
        );
      })
      .catch((err) => finish(() => reject(err)));
  });
}

function buildAuthorizeUrl(input: {
  apiBaseUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
}) {
  const url = new URL(
    "/api/oauth/authorize",
    `${input.apiBaseUrl.replace(/\/+$/, "")}/`,
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scope);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
