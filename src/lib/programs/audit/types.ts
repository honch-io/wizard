/**
 * Minimal audit-ledger types.
 *
 * The PostHog "audit" program was removed in the Honch fork, but the generic
 * audit_* MCP tools in `wizard-tools.ts` still reference these types. They are
 * retained (and disabled for the Honch integration program via disallowedTools)
 * to keep the tool surface compiling. Safe to delete once the audit tools are
 * removed from `wizard-tools.ts`.
 */

export const AUDIT_CHECKS_FILE = '.honch-audit-checks.json';

export type AuditStatus = 'pending' | 'pass' | 'fail' | 'skip' | 'unknown';

export interface AuditCheck {
  id: string;
  title?: string;
  status: AuditStatus;
  detail?: string;
  [key: string]: unknown;
}

export function coerceAuditChecks(value: unknown): AuditCheck[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is AuditCheck =>
      typeof v === 'object' && v !== null && typeof (v as AuditCheck).id === 'string',
  );
}
