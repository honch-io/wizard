export type Fetcher = typeof fetch;

export type TokenResponse = {
  accessToken: string;
  tokenType: "bearer";
};

export type ProjectResponse = {
  id: string;
  name: string;
  apiKey?: string;
  organizationId?: string;
};

export type OrganizationResponse = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export type WizardUsage = {
  used: number;
  budget: number;
  remaining: number;
  resetsAt: number;
};

export type FeedbackBody = {
  target: string;
  outcome: "success" | "failed" | "reverted";
  rating?: "up" | "down";
  comment?: string;
};

// Experience analytics — deliberately coarse. NEVER carries code, file contents,
// project names/paths, env values, or keys.
export type AnalyticsPayload = {
  event: "install";
  wizardVersion: string;
  os: string;
  arch: string;
  target?: string;
  outcome: "success" | "failed" | "reverted";
  agentRan: boolean;
  durationMs: number;
};

export class PlatformClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(baseUrl: string, fetcher: Fetcher = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetcher = fetcher;
  }

  async createWizardToken(
    accessToken: string,
    projectId?: string,
  ): Promise<TokenResponse> {
    const path = projectId
      ? `/api/wizard/token?project_id=${encodeURIComponent(projectId)}`
      : "/api/wizard/token";
    return this.post<TokenResponse>(path, {}, accessToken);
  }

  /** Read today's token usage against the daily budget. Authed with the
   * short-lived wizard token, so it shares the per-project metering subject the
   * LLM proxy uses. */
  async getWizardUsage(wizardToken: string): Promise<WizardUsage> {
    return this.get<WizardUsage>("/api/wizard/usage", wizardToken);
  }

  async listOrganizations(accessToken: string) {
    return this.get<OrganizationResponse[]>("/api/organizations", accessToken);
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

  /** Post opt-in install feedback. Never includes secrets — callers pass only
   * the bare metadata in `FeedbackBody`. */
  async sendFeedback(accessToken: string, body: FeedbackBody): Promise<void> {
    await this.post<unknown>("/api/wizard/feedback", body, accessToken);
  }

  /** Post coarse install-experience analytics (see `AnalyticsPayload`). */
  async sendAnalytics(
    accessToken: string,
    payload: AnalyticsPayload,
  ): Promise<void> {
    await this.post<unknown>("/api/wizard/analytics", payload, accessToken);
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
