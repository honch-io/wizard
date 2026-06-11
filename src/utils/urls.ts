/**
 * The Honch wizard LLM proxy lives at `${apiBaseUrl}/api/wizard/llm`.
 *
 * The agent SDK appends `/v1/messages` (etc.) to ANTHROPIC_BASE_URL; the
 * backend strips the `/api/wizard/llm` prefix and re-targets Anthropic. The
 * input is the platform API base URL (e.g. https://api.honch.io), NOT the
 * capture host or the app/frontend host.
 */
export const getLlmGatewayUrlFromHost = (apiBaseUrl: string): string =>
  `${apiBaseUrl.replace(/\/+$/, '')}/api/wizard/llm`;
