import { DEFAULT_API_BASE_URL } from '@lib/constants';
import type { CloudRegion } from './types';

/**
 * Honch is single-region. These helpers are retained with their original
 * signatures so existing call sites keep compiling, but they all resolve to
 * the configured Honch platform/capture hosts rather than PostHog regions.
 */

export const getAssetHostFromHost = (host: string): string => host;

export const getUiHostFromHost = (_host: string): string =>
  DEFAULT_API_BASE_URL;

export const getHostFromRegion = (_region: CloudRegion): string =>
  DEFAULT_API_BASE_URL;

export const getCloudUrlFromRegion = (_region?: CloudRegion): string =>
  DEFAULT_API_BASE_URL;

/** Honch has a single cloud; every token resolves to the same region. */
export function detectRegionFromToken(
  _accessToken: string,
): Promise<CloudRegion> {
  return Promise.resolve('us');
}

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
