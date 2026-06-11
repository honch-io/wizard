/**
 * Unified in-process MCP server for the Honch wizard.
 *
 * Provides tools that run locally (secret values never leave the machine):
 * - check_env_keys: Check which env var keys exist in a .env file
 * - set_env_values: Create/update env vars in a .env file
 * - detect_package_manager: Detect the project's package manager(s)
 * - audit_seed_checks / audit_add_checks / audit_resolve_checks: Audit ledger ownership
 *
 * Skill installation is NOT here: Honch ships its per-target skills bundled with
 * the wizard and copies them in locally (see lib/local-skills.ts). There is no
 * remote skill registry and no load_skill_menu / install_skill tool.
 */

import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import type { PackageManagerDetector } from './detection/package-manager';
import {
  AUDIT_CHECKS_FILE,
  coerceAuditChecks,
  type AuditCheck,
  type AuditStatus,
} from './programs/audit/types';
import type { WizardAskBridge } from './wizard-ask-bridge';
import { createSecretVault, type SecretVault } from './secret-vault';

// ---------------------------------------------------------------------------
// SDK dynamic import (ESM module loaded once, cached)
// ---------------------------------------------------------------------------

let _sdkModule: any = null;
async function getSDKModule(): Promise<any> {
  if (!_sdkModule) {
    _sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return _sdkModule;
}

// ---------------------------------------------------------------------------
// Options for creating the wizard tools server
// ---------------------------------------------------------------------------

export interface WizardToolsOptions {
  /** Root directory of the project being analyzed */
  workingDirectory: string;

  /** Framework-specific package manager detector */
  detectPackageManager: PackageManagerDetector;

  /**
   * Bridge that drives the `wizard_ask` overlay. When omitted, the
   * `wizard_ask` tool is still registered but returns an error explaining
   * the host is non-interactive — keeps the tool surface stable across
   * CI/dev environments.
   */
  askBridge?: WizardAskBridge;

  /**
   * Per-run cap on `wizard_ask` invocations. Defaults to {@link DEFAULT_ASK_MAX_QUESTIONS}.
   * The 4th call always returns a "batch your questions" error regardless
   * of this cap — see {@link ASK_BATCH_THRESHOLD}.
   */
  askMaxQuestions?: number;

  /**
   * Optional secret vault. When provided, tools that handle sensitive
   * values (wizard_ask with `sensitive: true`, set_env_values) route
   * those values through the vault and return opaque refs to the agent
   * instead of raw strings — so the LLM never sees them. When omitted
   * (e.g. in unit tests), a fresh vault is created internally.
   */
  secretVault?: SecretVault;
}

/** Default per-run cap on wizard_ask calls when no override is provided. */
export const DEFAULT_ASK_MAX_QUESTIONS = 10;
/** Calls past this number always return a batch-it error. */
export const ASK_BATCH_THRESHOLD = 3;

export type AskCapDecision =
  | { kind: 'ok' }
  | {
      kind: 'capped';
      reason: 'max_questions' | 'adjacency';
      message: string;
    };

/**
 * Pure decision function for the wizard_ask caps. Returns whether the
 * upcoming call should proceed and, if not, the error message to surface
 * to the agent. Extracted so the policy can be unit-tested without
 * spinning up an MCP server.
 */
export function evaluateAskCap(
  callCount: number,
  maxQuestions: number,
): AskCapDecision {
  if (callCount >= maxQuestions) {
    return {
      kind: 'capped',
      reason: 'max_questions',
      message: `Error: wizard_ask cap reached (${maxQuestions} calls in this run). Proceed with sensible defaults using the answers you already have, or emit [ABORT] requirements-incomplete.`,
    };
  }
  if (callCount >= ASK_BATCH_THRESHOLD) {
    return {
      kind: 'capped',
      reason: 'adjacency',
      message: `Error: too many wizard_ask calls in a row (${callCount} so far). Batch the remaining questions into a single call — the schema accepts up to 8 questions per invocation.`,
    };
  }
  return { kind: 'ok' };
}

// ---------------------------------------------------------------------------
// Env file helpers
// ---------------------------------------------------------------------------

/**
 * Resolve filePath relative to workingDirectory, rejecting path traversal.
 */
export function resolveEnvPath(
  workingDirectory: string,
  filePath: string,
): string {
  const resolved = path.resolve(workingDirectory, filePath);
  if (
    !resolved.startsWith(workingDirectory + path.sep) &&
    resolved !== workingDirectory
  ) {
    throw new Error(
      `Path traversal rejected: "${filePath}" resolves outside working directory`,
    );
  }
  return resolved;
}

/**
 * Ensure the given env file basename is covered by .gitignore in the working directory.
 * Creates .gitignore if it doesn't exist; appends the entry if missing.
 */
export function ensureGitignoreCoverage(
  workingDirectory: string,
  envFileName: string,
): void {
  const gitignorePath = path.join(workingDirectory, '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    // Check if the file (or a glob covering it) is already listed
    if (content.split('\n').some((line) => line.trim() === envFileName)) {
      return;
    }
    const newContent = content.endsWith('\n')
      ? `${content}${envFileName}\n`
      : `${content}\n${envFileName}\n`;
    fs.writeFileSync(gitignorePath, newContent, 'utf8');
  } else {
    fs.writeFileSync(gitignorePath, `${envFileName}\n`, 'utf8');
  }
}

/**
 * Parse a .env file's content and return the set of defined key names.
 */
export function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * Merge key-value pairs into existing .env content.
 * Updates existing keys in-place, appends new keys at the end.
 */
export function mergeEnvValues(
  content: string,
  values: Record<string, string>,
): string {
  let result = content;
  const updatedKeys = new Set<string>();

  for (const [key, value] of Object.entries(values)) {
    const regex = new RegExp(`^(\\s*${key}\\s*=).*$`, 'm');
    if (regex.test(result)) {
      result = result.replace(regex, `$1${value}`);
      updatedKeys.add(key);
    }
  }

  const newKeys = Object.entries(values).filter(
    ([key]) => !updatedKeys.has(key),
  );
  if (newKeys.length > 0) {
    if (result.length > 0 && !result.endsWith('\n')) {
      result += '\n';
    }
    for (const [key, value] of newKeys) {
      result += `${key}=${value}\n`;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// ESP-IDF sdkconfig reconciliation
//
// ESP-IDF has a subtle, dangerous default: a value already present in the
// build-time `sdkconfig` ALWAYS wins over anything in the `sdkconfig.defaults*`
// files, and bare ESP-IDF does not even read `sdkconfig.defaults.local` unless
// CMakeLists lists it in SDKCONFIG_DEFAULTS. So writing a project key into
// `sdkconfig.defaults.local` is silently ineffective when (a) a stale
// `sdkconfig` already pins that key, or (b) the defaults file is not wired into
// the build. Either way the firmware is flashed with the wrong/old key and
// capture returns 401 — with no error at config or build time. These helpers
// make a defaults-file write actually take effect.
// ---------------------------------------------------------------------------

/** True if `filePath` is an ESP-IDF Kconfig defaults file (sdkconfig.defaults[.local|.<target>]). */
export function isEspIdfSdkconfigDefaults(filePath: string): boolean {
  return /^sdkconfig\.defaults(\.[A-Za-z0-9_.-]+)?$/.test(
    path.basename(filePath),
  );
}

/**
 * Remove the given CONFIG_* keys from an existing `sdkconfig` body so they no
 * longer shadow the values supplied by the defaults files. Returns the new
 * content and the list of keys actually stripped (in first-seen order).
 */
export function stripSdkconfigKeys(
  content: string,
  keys: readonly string[],
): { content: string; stripped: string[] } {
  const keySet = new Set(keys);
  const stripped: string[] = [];
  const kept = content.split('\n').filter((line) => {
    const match = line.match(/^\s*(CONFIG_[A-Za-z0-9_]+)\s*=/);
    if (match && keySet.has(match[1])) {
      if (!stripped.includes(match[1])) stripped.push(match[1]);
      return false;
    }
    return true;
  });
  return { content: kept.join('\n'), stripped };
}

/**
 * Ensure the ESP-IDF root CMakeLists wires `defaultsFileName` into
 * SDKCONFIG_DEFAULTS (it is NOT read otherwise). SDKCONFIG_DEFAULTS must be set
 * before `project()`, so a freshly-created entry is inserted just above the
 * `include(... project.cmake)` line. Idempotent and conservative — it never
 * edits a SDKCONFIG_DEFAULTS it can't safely parse, and never inserts a second
 * one. The returned `status` lets the caller decide whether to warn:
 *  - `already`     — the file is already referenced; nothing to do.
 *  - `wired`       — appended to / created a SDKCONFIG_DEFAULTS (content changed).
 *  - `unparseable` — a SDKCONFIG_DEFAULTS exists in a form we won't rewrite; the
 *                    caller must tell the user to add the file manually.
 *  - `no-include`  — no `project.cmake` include found; not a standard root file.
 */
export function ensureSdkconfigDefaultsWired(
  content: string,
  defaultsFileName: string,
): {
  content: string;
  changed: boolean;
  status: 'already' | 'wired' | 'unparseable' | 'no-include';
} {
  const hasDefaultsVar = /SDKCONFIG_DEFAULTS/i.test(content);

  // Already references this defaults file anywhere — assume it is wired in and
  // leave the file untouched (covers quoted, unquoted, and multi-line lists).
  if (hasDefaultsVar && content.includes(defaultsFileName)) {
    return { content, changed: false, status: 'already' };
  }

  // Append to a single-line quoted list, the only form we rewrite safely.
  const quoted = content.match(
    /set\s*\(\s*SDKCONFIG_DEFAULTS\s+"([^"]*)"\s*\)/i,
  );
  if (quoted) {
    return {
      content: content.replace(
        quoted[0],
        `set(SDKCONFIG_DEFAULTS "${quoted[1]};${defaultsFileName}")`,
      ),
      changed: true,
      status: 'wired',
    };
  }

  // A SDKCONFIG_DEFAULTS exists but not in a form we can safely edit — do not
  // risk a conflicting second declaration; let the caller warn instead.
  if (hasDefaultsVar) {
    return { content, changed: false, status: 'unparseable' };
  }

  const includeMatch = content.match(
    /^[^\n]*include\([^\n]*project\.cmake[^\n]*\)[^\n]*$/m,
  );
  if (!includeMatch) return { content, changed: false, status: 'no-include' };
  const line = `set(SDKCONFIG_DEFAULTS "sdkconfig.defaults;${defaultsFileName}")\n`;
  return {
    content: content.replace(includeMatch[0], `${line}${includeMatch[0]}`),
    changed: true,
    status: 'wired',
  };
}

// ---------------------------------------------------------------------------
// Audit ledger helpers
// ---------------------------------------------------------------------------

const AUDIT_STATUSES: readonly AuditStatus[] = [
  'pending',
  'pass',
  'error',
  'warning',
  'suggestion',
];

const auditCheckSchema = z.object({
  id: z.string().min(1),
  area: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(AUDIT_STATUSES as [AuditStatus, ...AuditStatus[]]),
  file: z.string().optional(),
  details: z.string().optional(),
});

const auditUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(AUDIT_STATUSES as [AuditStatus, ...AuditStatus[]]),
  file: z.string().optional(),
  details: z.string().optional(),
});

/**
 * Atomically write JSON: write to .tmp then rename. The rename is what bumps
 * the file's mtime, which is what the UI's file watcher polls on.
 */
function writeLedgerAtomic(targetPath: string, checks: AuditCheck[]): void {
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(checks, null, 2), 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Apply a batch of patches to the ledger by id. Returns the new array and the
 * list of update ids that didn't match any existing check.
 */
function applyAuditUpdates(
  current: AuditCheck[],
  updates: Array<{
    id: string;
    status: AuditStatus;
    file?: string;
    details?: string;
  }>,
): { next: AuditCheck[]; unknown: string[] } {
  const byId = new Map(current.map((c) => [c.id, c]));
  const unknown: string[] = [];

  for (const u of updates) {
    const existing = byId.get(u.id);
    if (!existing) {
      unknown.push(u.id);
      continue;
    }
    byId.set(u.id, {
      ...existing,
      status: u.status,
      ...(u.file !== undefined ? { file: u.file } : {}),
      ...(u.details !== undefined ? { details: u.details } : {}),
    });
  }

  return {
    next: current.map((c) => byId.get(c.id) ?? c),
    unknown,
  };
}

/**
 * Append new checks to a seeded ledger. Duplicate ids are reported without
 * mutating the current ledger, including duplicates inside the additions.
 */
function applyAuditAdditions(
  current: AuditCheck[],
  additions: AuditCheck[],
): { next: AuditCheck[]; duplicates: string[] } {
  const existingIds = new Set(current.map((c) => c.id));
  const additionIds = new Set<string>();
  const duplicates: string[] = [];

  for (const check of additions) {
    if (existingIds.has(check.id) || additionIds.has(check.id)) {
      duplicates.push(check.id);
      continue;
    }
    additionIds.add(check.id);
  }

  if (duplicates.length > 0) {
    return { next: current, duplicates };
  }

  return { next: [...current, ...additions], duplicates: [] };
}

function readLedger(targetPath: string): AuditCheck[] {
  if (!fs.existsSync(targetPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    return coerceAuditChecks(parsed);
  } catch {
    return [];
  }
}

type AppendAuditChecksResult =
  | { ok: true; added: number }
  | { ok: false; reason: 'missing-ledger' }
  | { ok: false; reason: 'duplicate-ids'; ids: string[] };

function appendAuditChecksToLedger(
  targetPath: string,
  additions: AuditCheck[],
): AppendAuditChecksResult {
  if (!fs.existsSync(targetPath)) {
    return { ok: false, reason: 'missing-ledger' };
  }

  const current = readLedger(targetPath);
  const { next, duplicates } = applyAuditAdditions(current, additions);
  if (duplicates.length > 0) {
    return { ok: false, reason: 'duplicate-ids', ids: duplicates };
  }

  writeLedgerAtomic(targetPath, next);
  return { ok: true, added: additions.length };
}

/**
 * Single async mutex shared by audit tools — guarantees a read-modify-write
 * cycle on the ledger is atomic across concurrent tool calls (e.g. future subagents).
 */
function makeMutex() {
  let chain: Promise<unknown> = Promise.resolve();
  return async function run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = chain.then(() => fn());
    chain = next.catch(() => undefined);
    return next;
  };
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

const SERVER_NAME = 'wizard-tools';

/**
 * Create the unified in-process MCP server with all wizard tools.
 * Must be called asynchronously because the SDK is an ESM module loaded via dynamic import.
 */
export async function createWizardToolsServer(options: WizardToolsOptions) {
  const {
    workingDirectory,
    detectPackageManager,
    askBridge,
    askMaxQuestions = DEFAULT_ASK_MAX_QUESTIONS,
    secretVault = createSecretVault(),
  } = options;
  const sdk = await getSDKModule();
  const { tool, createSdkMcpServer } = sdk;

  // Per-server counter for wizard_ask call accounting (adjacency + total cap).
  let askCallCount = 0;

  // -- check_env_keys -------------------------------------------------------

  const checkEnvKeys = tool(
    'check_env_keys',
    'Check which environment variable keys are present or missing in a .env file. Never reveals values.',
    {
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
      keys: z
        .array(z.string())
        .describe('Environment variable key names to check'),
    },
    (args: { filePath: string; keys: string[] }) => {
      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      logToFile(`check_env_keys: ${resolved}, keys: ${args.keys.join(', ')}`);

      const existingKeys: Set<string> = fs.existsSync(resolved)
        ? parseEnvKeys(fs.readFileSync(resolved, 'utf8'))
        : new Set<string>();

      const results: Record<string, 'present' | 'missing'> = {};
      for (const key of args.keys) {
        results[key] = existingKeys.has(key) ? 'present' : 'missing';
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    },
  );

  // -- set_env_values -------------------------------------------------------

  const setEnvValues = tool(
    'set_env_values',
    'Create or update environment variable keys in a .env file. Creates the file if it does not exist. Ensures .gitignore coverage. Each value can be either a literal string or a secret reference of the form `{ "secretRef": "secret:..." }` returned by another tool (e.g. wizard_ask). Secret references are resolved locally — the actual value is written to the file but never returned to the agent.',
    {
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
      values: z
        .record(
          z.string(),
          z.union([z.string(), z.object({ secretRef: z.string() })]),
        )
        .describe(
          'Key → (literal string OR { secretRef } pointing to a vaulted secret)',
        ),
    },
    (args: {
      filePath: string;
      values: Record<string, string | { secretRef: string }>;
    }) => {
      // Block the old generic PostHog key name; Honch uses target-specific keys.
      const forbidden = Object.keys(args.values).find(
        (k) => k.toUpperCase() === 'POSTHOG_KEY',
      );
      if (forbidden) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: "${forbidden}" is not a valid Honch env var name. Use the target-specific key name from the Honch integration guide (for example HONCH_API_KEY or HONCH_PROJECT_KEY).`,
            },
          ],
          isError: true,
        };
      }

      // Resolve any secret refs from the vault before writing.
      const resolvedValues: Record<string, string> = {};
      const resolvedRefKeys: string[] = [];
      for (const [key, val] of Object.entries(args.values)) {
        if (typeof val === 'string') {
          resolvedValues[key] = val;
        } else {
          const secret = secretVault.get(val.secretRef);
          if (secret === undefined) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: secret reference "${val.secretRef}" for key "${key}" is not known to the vault. The ref may have expired, been minted in a different run, or been mistyped.`,
                },
              ],
              isError: true,
            };
          }
          resolvedValues[key] = secret;
          resolvedRefKeys.push(key);
        }
      }

      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      logToFile(
        `set_env_values: ${resolved}, keys: ${Object.keys(resolvedValues).join(
          ', ',
        )}${
          resolvedRefKeys.length > 0
            ? ` (secret refs: ${resolvedRefKeys.join(', ')})`
            : ''
        }`,
      );

      const existing = fs.existsSync(resolved)
        ? fs.readFileSync(resolved, 'utf8')
        : '';
      const content = mergeEnvValues(existing, resolvedValues);

      // Ensure parent directory exists
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolved, content, 'utf8');

      // Ensure .gitignore coverage for this env file
      const envFileName = path.basename(resolved);
      ensureGitignoreCoverage(workingDirectory, envFileName);

      // ESP-IDF: a defaults file is silently ineffective unless (a) no stale
      // `sdkconfig` shadows the keys, and (b) CMakeLists wires the file into
      // SDKCONFIG_DEFAULTS. Reconcile both deterministically so the provisioned
      // key actually compiles into the firmware instead of an old/leftover one.
      const notes: string[] = [];
      if (isEspIdfSdkconfigDefaults(resolved)) {
        const keys = Object.keys(resolvedValues);

        // ESP-IDF writes `sdkconfig` next to the top-level CMakeLists (the
        // project root = workingDirectory), regardless of where the defaults
        // file lives.
        const sdkconfigPath = path.join(workingDirectory, 'sdkconfig');
        if (fs.existsSync(sdkconfigPath)) {
          const { content: reconciled, stripped } = stripSdkconfigKeys(
            fs.readFileSync(sdkconfigPath, 'utf8'),
            keys,
          );
          if (stripped.length > 0) {
            fs.writeFileSync(sdkconfigPath, reconciled, 'utf8');
            logToFile(
              `set_env_values: stripped ${stripped.join(
                ', ',
              )} from ${sdkconfigPath} to clear stale shadow`,
            );
            notes.push(
              `Removed ${stripped.join(
                ', ',
              )} from existing sdkconfig so the new value is not shadowed (ESP-IDF: sdkconfig overrides defaults).`,
            );
          }
        }

        const cmakePath = path.join(workingDirectory, 'CMakeLists.txt');
        if (fs.existsSync(cmakePath)) {
          const before = fs.readFileSync(cmakePath, 'utf8');
          const {
            content: after,
            changed,
            status,
          } = ensureSdkconfigDefaultsWired(before, envFileName);
          if (changed) {
            fs.writeFileSync(cmakePath, after, 'utf8');
            notes.push(
              `Wired ${envFileName} into SDKCONFIG_DEFAULTS in CMakeLists.txt (bare ESP-IDF does not read it otherwise).`,
            );
          } else if (status === 'unparseable') {
            notes.push(
              `WARNING: CMakeLists.txt sets SDKCONFIG_DEFAULTS in a form the wizard will not edit — confirm it includes "${envFileName}", or ESP-IDF will not read this file.`,
            );
          } else if (status === 'no-include') {
            notes.push(
              `WARNING: could not locate the project.cmake include in CMakeLists.txt — add "${envFileName}" to SDKCONFIG_DEFAULTS before project(), or ESP-IDF will not read this file.`,
            );
          }
        } else {
          notes.push(
            `WARNING: no root CMakeLists.txt found — ensure ${envFileName} is listed in SDKCONFIG_DEFAULTS, or ESP-IDF will not read it.`,
          );
        }

        notes.push(
          'Before flashing, run `idf.py reconfigure` and confirm CONFIG_HONCH_API_KEY in the generated sdkconfig matches the provisioned key.',
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text:
              `Updated ${Object.keys(args.values).length} key(s) in ${
                args.filePath
              }` +
              (notes.length > 0
                ? `\n${notes.map((note) => `- ${note}`).join('\n')}`
                : ''),
          },
        ],
      };
    },
  );

  // -- detect_package_manager -----------------------------------------------

  const detectPM = tool(
    'detect_package_manager',
    'Detect which package manager(s) the project uses. Returns the name, install command, and run command for each detected package manager. Call this before running any install commands.',
    {},
    async () => {
      logToFile(`detect_package_manager: scanning ${workingDirectory}`);

      const result = await detectPackageManager(workingDirectory);

      logToFile(
        `detect_package_manager: detected ${result.detected.length} package manager(s)`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // -- audit_seed_checks ----------------------------------------------------

  const auditLedgerPath = path.join(workingDirectory, AUDIT_CHECKS_FILE);
  const auditMutex = makeMutex();

  const auditSeedChecks = tool(
    'audit_seed_checks',
    'Seed the audit ledger at .honch-audit-checks.json with the full set of pending checks. Call this once at the start of the audit. Atomically replaces any existing ledger.',
    {
      checks: z
        .array(auditCheckSchema)
        .describe('Full pending checklist to write to the ledger'),
    },
    async (args: { checks: AuditCheck[] }) => {
      return auditMutex(() => {
        writeLedgerAtomic(auditLedgerPath, args.checks);
        logToFile(`audit_seed_checks: wrote ${args.checks.length} entries`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Seeded ${args.checks.length} audit checks.`,
            },
          ],
        };
      });
    },
  );

  // -- audit_add_checks -----------------------------------------------------

  const auditAddChecks = tool(
    'audit_add_checks',
    'Append one or more pending checks to the existing audit ledger at .honch-audit-checks.json. Call audit_seed_checks first. Atomically rejects duplicate ids without changing the ledger.',
    {
      checks: z
        .array(auditCheckSchema)
        .min(1)
        .describe('Additional checks to append to the existing ledger'),
    },
    async (args: { checks: AuditCheck[] }) => {
      return auditMutex(() => {
        const result = appendAuditChecksToLedger(auditLedgerPath, args.checks);

        if (!result.ok) {
          if (result.reason === 'missing-ledger') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: audit ledger does not exist. Run audit_seed_checks first.',
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: duplicate check id(s): ${result.ids.join(
                  ', ',
                )}. Check ids must be unique.`,
              },
            ],
            isError: true,
          };
        }

        logToFile(`audit_add_checks: added ${result.added} entries`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Added ${result.added} audit check(s).`,
            },
          ],
        };
      });
    },
  );

  // -- audit_resolve_checks -------------------------------------------------

  const auditResolveChecks = tool(
    'audit_resolve_checks',
    "Resolve one or more audit checks by id. Patches each entry's status (and optional file/details) and writes the ledger back atomically. Concurrent calls serialize.",
    {
      updates: z
        .array(auditUpdateSchema)
        .min(1)
        .describe('Patches to apply, keyed by check id'),
    },
    async (args: {
      updates: Array<{
        id: string;
        status: AuditStatus;
        file?: string;
        details?: string;
      }>;
    }) => {
      return auditMutex(() => {
        const current = readLedger(auditLedgerPath);
        const { next, unknown } = applyAuditUpdates(current, args.updates);

        if (unknown.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: unknown check id(s): ${unknown.join(
                  ', ',
                )}. Run audit_seed_checks first or check the id.`,
              },
            ],
            isError: true,
          };
        }

        writeLedgerAtomic(auditLedgerPath, next);
        logToFile(
          `audit_resolve_checks: applied ${args.updates.length} update(s)`,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: `Resolved ${args.updates.length} check(s).`,
            },
          ],
        };
      });
    },
  );

  // -- wizard_ask -----------------------------------------------------------

  const askQuestionSchema = z.object({
    id: z
      .string()
      .min(1)
      .describe('Stable key for the answer in the response map'),
    prompt: z.string().min(1).describe('Question text shown to the user'),
    kind: z
      .enum(['single', 'multi', 'text'])
      .describe(
        "'single' = pick one option, 'multi' = pick any, 'text' = free-form single-line answer",
      ),
    options: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .optional()
      .describe('Required for kind=single|multi; ignored for kind=text'),
    required: z.boolean().optional().describe('Defaults to true'),
    sensitive: z
      .boolean()
      .optional()
      .describe(
        "Only valid for kind='text'. When true, the user's answer is stored in the wizard's secret vault and returned to you as { secretRef: 'secret:...' } instead of the raw string. Use for API keys, tokens, and any other secret the user types in.",
      ),
  });

  const wizardAsk = tool(
    'wizard_ask',
    'Ask the user one or more structured questions and wait for their answers. ' +
      'Use this whenever you would otherwise inline a question in your text output. ' +
      'Batch related questions into a single call — do not call this multiple times in a row.',
    {
      questions: z.array(askQuestionSchema).min(1).max(8),
    },
    async (args: {
      questions: Array<{
        id: string;
        prompt: string;
        kind: 'single' | 'multi' | 'text';
        options?: { label: string; value: string }[];
        required?: boolean;
        sensitive?: boolean;
      }>;
    }) => {
      if (!askBridge) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: wizard_ask is not available in this environment (CI / non-interactive). Proceed with sensible defaults or emit [ABORT] requirements-incomplete.',
            },
          ],
          isError: true,
        };
      }

      const capDecision = evaluateAskCap(askCallCount, askMaxQuestions);
      if (capDecision.kind === 'capped') {
        analytics.wizardCapture('wizard_ask capped', {
          reason: capDecision.reason,
          call_count: askCallCount,
          max_questions: askMaxQuestions,
        });
        return {
          content: [{ type: 'text' as const, text: capDecision.message }],
          isError: true,
        };
      }

      // Validate that single/multi questions include options. The schema
      // alone can't enforce a per-kind requirement.
      for (const q of args.questions) {
        if (
          (q.kind === 'single' || q.kind === 'multi') &&
          (!q.options || q.options.length === 0)
        ) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: question "${q.id}" has kind="${q.kind}" but no options. Provide at least one { label, value } option, or change kind to "text".`,
              },
            ],
            isError: true,
          };
        }
        if (q.sensitive && q.kind !== 'text') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: question "${q.id}" sets sensitive=true but kind="${q.kind}". Only kind="text" answers can be vaulted as secrets.`,
              },
            ],
            isError: true,
          };
        }
      }

      const ids = new Set<string>();
      for (const q of args.questions) {
        if (ids.has(q.id)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: duplicate question id "${q.id}". Each question must have a unique id.`,
              },
            ],
            isError: true,
          };
        }
        ids.add(q.id);
      }

      askCallCount += 1;

      try {
        const answers = await askBridge.request({ questions: args.questions });

        // For any question marked sensitive, move the raw answer into the
        // vault and replace it with an opaque ref before returning to the
        // agent — so the secret never enters the LLM conversation.
        const sensitiveById = new Map(
          args.questions
            .filter((q) => q.sensitive)
            .map((q) => [q.id, q.prompt]),
        );
        const sanitised: Record<
          string,
          string | string[] | { secretRef: string }
        > = {};
        for (const [id, answer] of Object.entries(answers)) {
          const label = sensitiveById.get(id);
          if (
            label !== undefined &&
            typeof answer === 'string' &&
            answer !== '__cancelled__'
          ) {
            const ref = secretVault.put(answer, {
              label,
              source: 'wizard_ask',
            });
            sanitised[id] = { secretRef: ref };
            logToFile(`wizard_ask: vaulted answer for "${id}" as ${ref}`);
          } else {
            sanitised[id] = answer;
          }
        }

        logToFile(
          `wizard_ask: resolved ${Object.keys(answers).length} answer(s) for ${
            args.questions.length
          } question(s)`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ answers: sanitised }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        logToFile(`wizard_ask: error: ${err?.message ?? err}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: wizard_ask failed: ${err?.message ?? String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -- Assemble server ------------------------------------------------------

  return createSdkMcpServer({
    name: SERVER_NAME,
    version: '1.0.0',
    tools: [
      checkEnvKeys,
      setEnvValues,
      detectPM,
      auditSeedChecks,
      auditAddChecks,
      auditResolveChecks,
      wizardAsk,
    ],
  });
}

/** Tool names exposed by the wizard-tools server, keyed for selective use. */
// SDK expects MCP tool names in allowedTools/disallowedTools to be the
// fully-qualified `mcp__<server>__<tool>` form (sdk.d.ts: "Fully-qualified
// MCP tool name, e.g. mcp__server__tool_name."). The colon form silently
// fails to match, which made every program's `disallowedTools` entry a no-op.
export const WIZARD_TOOL_NAMES = {
  checkEnvKeys: `mcp__${SERVER_NAME}__check_env_keys`,
  setEnvValues: `mcp__${SERVER_NAME}__set_env_values`,
  detectPackageManager: `mcp__${SERVER_NAME}__detect_package_manager`,
  auditSeedChecks: `mcp__${SERVER_NAME}__audit_seed_checks`,
  auditAddChecks: `mcp__${SERVER_NAME}__audit_add_checks`,
  auditResolveChecks: `mcp__${SERVER_NAME}__audit_resolve_checks`,
  wizardAsk: `mcp__${SERVER_NAME}__wizard_ask`,
} as const;

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const __test = {
  writeLedgerAtomic,
  readLedger,
  applyAuditAdditions,
  appendAuditChecksToLedger,
  applyAuditUpdates,
  makeMutex,
  AUDIT_CHECKS_FILE,
};
