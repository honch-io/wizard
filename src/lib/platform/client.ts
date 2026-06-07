/**
 * Minimal client for the Honch platform backend (prado).
 *
 * The wizard uses exactly two endpoints, both authenticated with the user's
 * NORMAL bearer token (the backend rejects the minted wizard token here):
 *
 *   POST /api/wizard/token  → mint a short-lived wizard JWT (aud "honcho-wizard")
 *                             used ONLY to authenticate the agent's LLM calls
 *                             through the proxy at /api/wizard/llm.
 *   GET  /api/projects      → list the user's projects; each carries its
 *                             `apiKey` (the honch_… capture key the device
 *                             SDK sends as X-Honch-Project-Key).
 *
 * The raw user bearer never leaves this module except to mint the wizard
 * token; only the minted token is handed to the agent SDK.
 */

export type Fetcher = typeof fetch;

export type TokenResponse = {
  accessToken: string;
  tokenType: 'bearer';
};

export type ProjectResponse = {
  id: string;
  name: string;
  apiKey: string;
  organizationId?: string;
};

export class PlatformClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(baseUrl: string, fetcher: Fetcher = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetcher = fetcher;
  }

  /** Mint a short-lived wizard token for the LLM proxy. Needs the user bearer. */
  async createWizardToken(userBearer: string): Promise<TokenResponse> {
    return this.post<TokenResponse>('/api/wizard/token', {}, userBearer);
  }

  /** List the user's projects; each includes its honch_ capture apiKey. */
  async listProjects(userBearer: string): Promise<ProjectResponse[]> {
    return this.get<ProjectResponse[]>('/api/projects', userBearer);
  }

  private async get<T>(path: string, accessToken?: string): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(accessToken),
    });
    return parseJson<T>(response);
  }

  private async post<T>(
    path: string,
    body: unknown,
    accessToken?: string,
  ): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify(body),
    });
    return parseJson<T>(response);
  }

  private headers(accessToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(formatPlatformError(response.status, body));
  }
  return body as T;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function formatPlatformError(status: number, body: unknown): string {
  const detail = platformErrorDetail(body);
  return detail
    ? `Honch platform request failed: HTTP ${status} - ${detail}`
    : `Honch platform request failed: HTTP ${status}`;
}

function platformErrorDetail(body: unknown): string | undefined {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.length > 0) {
    return record.message;
  }
  if (typeof record.error === 'string' && record.error.length > 0) {
    return record.error;
  }
  return undefined;
}
