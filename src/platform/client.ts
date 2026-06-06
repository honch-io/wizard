export type Fetcher = typeof fetch;

export type TokenResponse = {
  accessToken: string;
  tokenType: "bearer";
};

export type ProjectResponse = {
  id: string;
  name: string;
  apiKey?: string;
};

export class PlatformClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(baseUrl: string, fetcher: Fetcher = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetcher = fetcher;
  }

  async login(input: {
    email: string;
    password: string;
  }): Promise<TokenResponse> {
    return this.post<TokenResponse>("/api/auth/login", input);
  }

  async register(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<TokenResponse> {
    return this.post<TokenResponse>("/api/auth/register", input);
  }

  async createWizardToken(accessToken: string): Promise<TokenResponse> {
    return this.post<TokenResponse>("/api/wizard/token", {}, accessToken);
  }

  async listProjects(accessToken: string, organizationId?: string) {
    return this.get<ProjectResponse[]>(
      "/api/projects",
      accessToken,
      organizationId,
    );
  }

  async createProject(
    accessToken: string,
    name: string,
    organizationId?: string,
  ) {
    return this.post<ProjectResponse>(
      "/api/projects",
      { name },
      accessToken,
      organizationId,
    );
  }

  private async get<T>(
    path: string,
    accessToken?: string,
    organizationId?: string,
  ) {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.headers(accessToken, organizationId),
    });
    return parseJson<T>(response);
  }

  private async post<T>(
    path: string,
    body: unknown,
    accessToken?: string,
    organizationId?: string,
  ) {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(accessToken, organizationId),
      body: JSON.stringify(body),
    });
    return parseJson<T>(response);
  }

  private headers(accessToken?: string, organizationId?: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (organizationId) headers["X-Organization-Id"] = organizationId;
    return headers;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Platform request failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}
