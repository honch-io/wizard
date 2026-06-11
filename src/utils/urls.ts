import { DEFAULT_API_BASE_URL } from '@lib/constants';
import type { CloudRegion } from './types';

/**
 * Honch is single-region. Retained with its original signature so the existing
 * call site keeps compiling, but it resolves to the configured Honch platform
 * host rather than a PostHog region.
 */
export const getCloudUrlFromRegion = (_region?: CloudRegion): string =>
  DEFAULT_API_BASE_URL;

/**
 * The Honch wizard LLM proxy lives at `${apiBaseUrl}/api/wizard/llm`.
 *
 * The agent SDK appends `/v1/messages` (etc.) to ANTHROPIC_BASE_URL; the
 * backend strips the `/api/wizard/llm` prefix and re-targets Anthropic. The
 * input is the platform base URL (e.g. https://app.honch.io), NOT the capture
 * host.
 */
export const getLlmGatewayUrlFromHost = (apiBaseUrl: string): string =>
  `${apiBaseUrl.replace(/\/+$/, '')}/api/wizard/llm`;
