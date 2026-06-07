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
  : 'https://capture.honch.io';
/** Back-compat generic aliases for the two hosts above. */
export const DEFAULT_URL = DEFAULT_API_BASE_URL;
export const DEFAULT_HOST_URL = DEFAULT_CAPTURE_HOST;
export const ISSUES_URL = 'https://github.com/honch-io/wizard/issues';
export const CONTEXT_MILL_URL = 'https://github.com/PostHog/context-mill';
export const HONCH_DOCS_URL = 'https://docs.honch.io';
export const POSTHOG_DOCS_URL = HONCH_DOCS_URL;

/** Remote base URL for fetching the skill menu + downloading skills. */
export const REMOTE_SKILLS_BASE_URL =
  'https://github.com/PostHog/context-mill/releases/latest/download';
/** Local base URL when `--local-mcp` is set (served by context-mill dev server). */
export const LOCAL_SKILLS_BASE_URL = 'http://localhost:8765';

/**
 * Pick the skills base URL based on the session's localMcp flag.
 * Single source of truth — do not inline this ternary anywhere.
 */
export function getSkillsBaseUrl(localMcp: boolean): string {
  return localMcp ? LOCAL_SKILLS_BASE_URL : REMOTE_SKILLS_BASE_URL;
}

// ── Analytics (internal) ──────────────────────────────────────────────

export const ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY = 'sTMFPsFhdP1Ssg';
export const ANALYTICS_HOST_URL = 'https://internal-j.posthog.com';
export const ANALYTICS_TEAM_TAG = 'docs-and-wizard';

// ── OAuth / Auth ────────────────────────────────────────────────────

export const POSTHOG_OAUTH_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://oauth.posthog.com';
export const OAUTH_PORTS = [8239, 8238, 8240, 8237, 8236, 8235] as const;
export const POSTHOG_US_CLIENT_ID = 'c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM';
export const POSTHOG_EU_CLIENT_ID = 'bx2C5sZRN03TkdjraCcetvQFPGH6N2Y9vRLkcKEy';
export const POSTHOG_DEV_CLIENT_ID = 'DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ';
export const POSTHOG_PROXY_CLIENT_ID = POSTHOG_US_CLIENT_ID;
export const DUMMY_PROJECT_API_KEY = '_YOUR_HONCH_PROJECT_KEY_';

/**
 * Scopes the wizard requests during the agentic provisioning signup flow.
 *
 * Each entry is justified by what the wizard's agent step does after signup:
 * - user:read         identify the user for analytics + agent context
 * - project:read      look up the freshly-provisioned project
 * - llm_gateway:read  authenticate to gateway.{us,eu}.posthog.com/wizard
 *                     (the agent's LLM calls — without this scope, every
 *                     agent message returns 401)
 * - query:read        run HogQL queries when the agent needs data
 * - dashboard:write   create the onboarding dashboard during setup
 * - insight:write     create the onboarding insights during setup
 * - notebook:write    upload the events-audit report as a PostHog notebook
 *                     in step 6 of the events-audit skill (notebooks-create
 *                     MCP tool requires this scope)
 *
 * Must be a subset of `ALLOWED_PROVISIONING_SCOPES` in
 * `ee/api/agentic_provisioning/views.py` on the backend.
 */
export const WIZARD_PROVISIONING_SCOPES = [
  'user:read',
  'project:read',
  'llm_gateway:read',
  'dashboard:write',
  'insight:write',
  'query:read',
  'notebook:write',
] as const;

/**
 * Scopes the wizard requests during the OAuth login flow. Superset of
 * `WIZARD_PROVISIONING_SCOPES` with scopes that only apply to the login
 * path and are not in the provisioning allowlist:
 * - health_issue:read     used by `wizard doctor`
 * - wizard_session:read   list / retrieve / stream sessions
 * - wizard_session:write  stream run state to /api/projects/{id}/wizard/sessions/
 */
export const WIZARD_OAUTH_SCOPES = [
  ...WIZARD_PROVISIONING_SCOPES,
  'health_issue:read',
  'wizard_session:read',
  'wizard_session:write',
] as const;

// ── Wizard run / variants ───────────────────────────────────────────

export const WIZARD_INTERACTION_EVENT_NAME = 'wizard interaction';
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
