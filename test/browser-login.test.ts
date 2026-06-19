import { createHash } from "node:crypto";
import * as http from "node:http";

import { describe, expect, it } from "vitest";
import { loginViaBrowser } from "../src/auth/browser-login.js";

/** Fire a GET at the loopback callback, simulating the platform's redirect.
 *  `agent: false` forces a one-off socket so requests don't pool across tests. */
function hit(url: string): void {
  http
    .get(url, { agent: false }, (res) => {
      res.resume();
    })
    .on("error", () => undefined);
}

/** A fetcher that records OAuth calls and returns a fixed token. */
function oauthFetcher(accessToken: string): {
  fetcher: typeof fetch;
  calls: { url: string; body: Record<string, unknown> }[];
} {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = ((
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    if (String(url).endsWith("/api/oauth/register")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            client_id: "honch_client_123",
            client_name: "Honcho Wizard",
            redirect_uris: calls.at(-1)?.body.redirect_uris,
            scope: calls.at(-1)?.body.scope,
            token_endpoint_auth_method: "none",
            client_id_issued_at: 123,
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          access_token: accessToken,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "refresh_tok",
          scope: "read:projects",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("loginViaBrowser", () => {
  it("registers an OAuth client and exchanges the callback code via PKCE", async () => {
    const { fetcher, calls } = oauthFetcher("user_tok");
    const result = await loginViaBrowser({
      apiBaseUrl: "https://api.honch.io",
      fetcher,
      open: (loginUrl) => {
        const u = new URL(loginUrl);
        const redirectUri = u.searchParams.get("redirect_uri") as string;
        const state = u.searchParams.get("state") as string;
        hit(`${redirectUri}?code=auth_code_123&state=${state}`);
      },
    });

    expect(result.token).toBe("user_tok");
    expect(result.clientId).toBe("honch_client_123");
    expect(result.refreshToken).toBe("refresh_tok");
    expect(result.scope).toBe("read:projects");
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.honch.io/api/oauth/register");
    expect(calls[0].body).toMatchObject({
      client_name: "Honcho Wizard",
      scope: "read:projects",
      token_endpoint_auth_method: "none",
    });
    expect(calls[0].body.redirect_uris).toEqual([
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/),
    ]);
    expect(calls[1].url).toBe("https://api.honch.io/api/oauth/token");
    expect(calls[1].body).toMatchObject({
      grant_type: "authorization_code",
      code: "auth_code_123",
      client_id: "honch_client_123",
    });
    expect(typeof calls[1].body.code_verifier).toBe("string");
  });

  it("sends a code_challenge that is the S256 hash of the verifier it later sends", async () => {
    const { fetcher, calls } = oauthFetcher("tok");
    let challenge = "";
    await loginViaBrowser({
      apiBaseUrl: "https://api.honch.io",
      fetcher,
      open: (loginUrl) => {
        const u = new URL(loginUrl);
        challenge = u.searchParams.get("code_challenge") as string;
        const redirectUri = u.searchParams.get("redirect_uri") as string;
        const state = u.searchParams.get("state") as string;
        hit(`${redirectUri}?code=c&state=${state}`);
      },
    });

    const verifier = calls[1].body.code_verifier as string;
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("builds a loopback redirect_uri and the OAuth authorize URL", async () => {
    const { fetcher } = oauthFetcher("t");
    let captured = "";
    await loginViaBrowser({
      apiBaseUrl: "https://api.honch.io/",
      fetcher,
      open: (loginUrl) => {
        captured = loginUrl;
        const u = new URL(loginUrl);
        const redirectUri = u.searchParams.get("redirect_uri") as string;
        const state = u.searchParams.get("state") as string;
        hit(`${redirectUri}?code=c&state=${state}`);
      },
    });
    const u = new URL(captured);
    expect(`${u.origin}${u.pathname}`).toBe(
      "https://api.honch.io/api/oauth/authorize",
    );
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("honch_client_123");
    expect(u.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
    expect(u.searchParams.get("scope")).toBe("read:projects");
    expect(u.searchParams.get("state")).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("rejects when the returned state does not match", async () => {
    const { fetcher, calls } = oauthFetcher("tok");
    await expect(
      loginViaBrowser({
        apiBaseUrl: "https://api.honch.io",
        fetcher,
        open: (loginUrl) => {
          const u = new URL(loginUrl);
          const redirectUri = u.searchParams.get("redirect_uri") as string;
          hit(`${redirectUri}?code=c&state=wrong`);
        },
      }),
    ).rejects.toThrow(/state parameter mismatch/);
    // A bad state must never reach the exchange.
    expect(calls).toHaveLength(1);
  });

  it("rejects when no authorization code is returned", async () => {
    const { fetcher } = oauthFetcher("tok");
    await expect(
      loginViaBrowser({
        apiBaseUrl: "https://api.honch.io",
        fetcher,
        open: (loginUrl) => {
          const u = new URL(loginUrl);
          const redirectUri = u.searchParams.get("redirect_uri") as string;
          const state = u.searchParams.get("state") as string;
          hit(`${redirectUri}?state=${state}`);
        },
      }),
    ).rejects.toThrow(/did not return an authorization code/);
  });

  it("rejects when the token exchange fails", async () => {
    const { fetcher } = oauthFetcherWithTokenResponse(
      new Response('{"success":false}', { status: 401 }),
    );
    await expect(
      loginViaBrowser({
        apiBaseUrl: "https://api.honch.io",
        fetcher,
        open: (loginUrl) => {
          const u = new URL(loginUrl);
          const redirectUri = u.searchParams.get("redirect_uri") as string;
          const state = u.searchParams.get("state") as string;
          hit(`${redirectUri}?code=c&state=${state}`);
        },
      }),
    ).rejects.toThrow(/token exchange returned HTTP 401/);
  });

  it("refreshes an OAuth session with the saved refresh token", async () => {
    const { refreshOAuthSession } = await import(
      "../src/auth/browser-login.js"
    );
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher = ((
      url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "new_access",
            token_type: "bearer",
            expires_in: 7200,
            refresh_token: "new_refresh",
            scope: "read:projects",
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const result = await refreshOAuthSession({
      apiBaseUrl: "https://api.honch.io",
      clientId: "honch_client_123",
      refreshToken: "old_refresh",
      scope: "read:projects",
      fetcher,
    });

    expect(result.token).toBe("new_access");
    expect(result.refreshToken).toBe("new_refresh");
    expect(calls).toEqual([
      {
        url: "https://api.honch.io/api/oauth/token",
        body: {
          grant_type: "refresh_token",
          refresh_token: "old_refresh",
          client_id: "honch_client_123",
          scope: "read:projects",
        },
      },
    ]);
  });

  it("rejects on timeout", async () => {
    const { fetcher } = oauthFetcher("tok");
    await expect(
      loginViaBrowser({
        apiBaseUrl: "https://api.honch.io",
        fetcher,
        timeoutMs: 50,
        open: () => undefined,
      }),
    ).rejects.toThrow(/timed out/);
  });
});

function oauthFetcherWithTokenResponse(response: Response): {
  fetcher: typeof fetch;
} {
  const fetcher = ((
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    if (String(url).endsWith("/api/oauth/register")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            client_id: "honch_client_123",
            client_name: "Honcho Wizard",
            redirect_uris: body.redirect_uris,
            scope: body.scope,
            token_endpoint_auth_method: "none",
            client_id_issued_at: 123,
          }),
          { status: 201 },
        ),
      );
    }
    return Promise.resolve(response);
  }) as unknown as typeof fetch;
  return { fetcher };
}
