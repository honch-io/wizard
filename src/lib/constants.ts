/**
 * Shared constants for the Honch wizard.
 */

import { VERSION } from './version';

// ── Integration / CLI ───────────────────────────────────────────────

/**
 * Honch SDK targets. Detection order matters: most specific first (esp-idf
 * before c-posix, since both are CMake). Mobile targets follow firmware.
 */
export enum Integration {
  // Firmware (Device SDK)
  espIdf = 'esp-idf',
  cPosix = 'c-posix',
  micropython = 'micropython',

  // Mobile (App SDK / relay)
  reactNativeRelay = 'react-native-relay',
  iosSwift = 'ios-swift',
  androidKotlin = 'android-kotlin',
}

export interface Args {
  debug: boolean;
  integration: Integration;
}

// ── Environment ──────────────────────────────────────────────────────

import { IS_DEV } from '@env';
export { IS_DEV };
export const DEBUG = false;

// ── URLs ─────────────────────────────────────────────────────────────

/** Honch platform API base — mints wizard tokens, lists projects, hosts the LLM proxy. */
export const DEFAULT_API_BASE_URL = IS_DEV
  ? 'http://localhost:3000'
  : 'https://app.honch.io';
/** Honch event-ingestion host the device/app SDK uploads to (X-Honch-Project-Key). */
export const DEFAULT_CAPTURE_HOST = IS_DEV
  ? 'http://localhost:8000'
  : 'https://i.honch.io';
/** Back-compat generic aliases for the two hosts above. */
export const DEFAULT_URL = DEFAULT_API_BASE_URL;
export const DEFAULT_HOST_URL = DEFAULT_CAPTURE_HOST;
export const ISSUES_URL = 'https://github.com/honch-io/wizard/issues';
export const HONCH_DOCS_URL = 'https://docs.honch.io';
export const SDK_REPO_URL = 'https://github.com/honch-io/SDK';

// Honch ships its per-target skills bundled with the wizard (src/skills →
// dist/skills) and copies them in locally — there is no remote skill registry.
// See lib/local-skills.ts.

// ── Auth ─────────────────────────────────────────────────────────────

/**
 * Candidate localhost ports for the (legacy) browser-callback overlay. The
 * Honch wizard authenticates with a pasted bearer token, so this is dormant;
 * retained only because the port-conflict overlay still references it.
 */
export const OAUTH_PORTS = [8239, 8238, 8240, 8237, 8236, 8235] as const;
export const DUMMY_PROJECT_API_KEY = '_YOUR_HONCH_PROJECT_KEY_';

// ── Wizard run / variants ───────────────────────────────────────────

export const WIZARD_REMARK_EVENT_NAME = 'wizard remark';
/** Feature flag key whose value selects a variant from WIZARD_VARIANTS. */
export const WIZARD_VARIANT_FLAG_KEY = 'wizard-variant';
/** Feature flag key that gates the intro-screen "Tools" menu. */
export const WIZARD_TOOLS_MENU_FLAG_KEY = 'wizard-tools-menu';
/** Variant key -> metadata for wizard run (VARIANT flag selects which entry to use). */
export const WIZARD_VARIANTS: Record<string, Record<string, string>> = {
  base: { VARIANT: 'base' },
  subagents: { VARIANT: 'subagents' },
};
/** User-Agent for wizard HTTP requests and MCP server identification. */
export const WIZARD_USER_AGENT = `honch/wizard; version: ${VERSION}`;

// ── HTTP headers ─────────────────────────────────────────────────────

/** Header prefix for PostHog properties (e.g. X-POSTHOG-PROPERTY-VARIANT). */
export const POSTHOG_PROPERTY_HEADER_PREFIX = 'X-POSTHOG-PROPERTY-';
/** Header prefix for PostHog feature flags. */
export const POSTHOG_FLAG_HEADER_PREFIX = 'X-POSTHOG-FLAG-';

// ── Timeouts ─────────────────────────────────────────────────────────

/** Timeout for framework / project detection probes (ms). */
export const DETECTION_TIMEOUT_MS = 10_000;

/** Timeout for the OAuth authorization flow (ms). */
export const OAUTH_TIMEOUT_MS = 360_000;
