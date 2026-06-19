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

function formatPlatformError(status: number, body: unknown) {
  const detail = platformErrorDetail(body);
  if (detail) {
    return `Platform request failed: HTTP ${status} - ${detail}`;
  }
  return `Platform request failed: HTTP ${status}`;
}

function platformErrorDetail(body: unknown) {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return undefined;

  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.length > 0) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.length > 0) {
    return knownPlatformError(record.error) ?? record.error;
  }
  return undefined;
}

function knownPlatformError(code: string) {
  const messages: Record<string, string> = {
    "auth.emailAlreadyRegistered":
      "Email already registered. Choose login instead of signup.",
    "auth.invalidCredentials": "Incorrect email or password.",
    "auth.alreadyHasOrganization": "You already belong to an organisation.",
  };
  return messages[code];
}
