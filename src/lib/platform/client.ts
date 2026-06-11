/**
 * Minimal client for the Honch platform backend (prado).
 *
 * Every endpoint here is authenticated with the user's NORMAL bearer token —
 * the backend's project API rejects the minted wizard token (aud
 * "honcho-wizard"), which is scoped only to the LLM proxy:
 *
 *   POST /api/wizard/token  → mint a short-lived wizard JWT (aud "honcho-wizard")
 *                             used ONLY to authenticate the agent's LLM calls
 *                             through the proxy at /api/wizard/llm.
 *   GET  /api/projects      → list the user's projects; each carries its
 *                             `apiKey` (the honch_… capture key the device
 *                             SDK sends as X-Honch-Project-Key).
 *   POST /api/projects/{id}/saved-insights        → create a chart definition.
 *   POST /api/projects/{id}/dashboards            → create a dashboard.
 *   POST /api/projects/{id}/dashboards/{d}/tiles  → attach an insight as a tile.
 *
 * The raw user bearer never leaves this module except to mint the wizard
 * token; only the minted token is handed to the agent SDK. The starter
 * dashboard is created locally by the wizard process so the bearer never
 * reaches the LLM.
 */

export type Fetcher = typeof fetch;
type FetchInit = NonNullable<Parameters<Fetcher>[1]>;

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

/** Body for `POST /api/projects/{projectId}/saved-insights`. */
export type SavedInsightCreate = {
  name: string;
  description?: string;
  query: unknown;
};

export type SavedInsightResponse = {
  id: string;
  name: string;
};

/** Body for `POST /api/projects/{projectId}/dashboards`. */
export type DashboardCreate = {
  name: string;
  description?: string;
};

export type DashboardResponse = {
  id: string;
  name: string;
};

/** Body for `POST /api/projects/{projectId}/dashboards/{id}/tiles`. */
export type TileCreate = {
  insightId: string;
  layouts?: unknown;
  color?: string | null;
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

  /** Create a saved insight (chart). Needs the user bearer + manage-data. */
  async createSavedInsight(
    userBearer: string,
    projectId: string,
    body: SavedInsightCreate,
  ): Promise<SavedInsightResponse> {
    return this.post<SavedInsightResponse>(
      `/api/projects/${projectId}/saved-insights`,
      body,
      userBearer,
    );
  }

  /** Create a dashboard. Needs the user bearer + manage-data. */
  async createDashboard(
    userBearer: string,
    projectId: string,
    body: DashboardCreate,
  ): Promise<DashboardResponse> {
    return this.post<DashboardResponse>(
      `/api/projects/${projectId}/dashboards`,
      body,
      userBearer,
    );
  }

  /** Attach a saved insight to a dashboard as a tile. */
  async addDashboardTile(
    userBearer: string,
    projectId: string,
    dashboardId: string,
    body: TileCreate,
  ): Promise<unknown> {
    return this.post<unknown>(
      `/api/projects/${projectId}/dashboards/${dashboardId}/tiles`,
      body,
      userBearer,
    );
  }

  private async get<T>(path: string, accessToken?: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetch(url, {
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
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetch(url, {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify(body),
    });
    return parseJson<T>(response);
  }

  private async fetch(url: string, init: FetchInit): Promise<Response> {
    try {
      return await this.fetcher(url, init);
    } catch (error) {
      throw new Error(
        `Could not reach Honch platform at ${url}. Check DNS/network access, or pass --api-base-url=<platform-url>. ${formatFetchCause(
          error,
        )}`,
        { cause: error },
      );
    }
  }

  private headers(accessToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }
}

function formatFetchCause(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return `Cause: ${error.message}`;
  }
  return '';
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
