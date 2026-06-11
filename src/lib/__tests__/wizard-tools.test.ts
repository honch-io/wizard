import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ASK_BATCH_THRESHOLD,
  DEFAULT_ASK_MAX_QUESTIONS,
  WIZARD_TOOL_NAMES,
  __test,
  ensureGitignoreCoverage,
  ensureSdkconfigDefaultsWired,
  evaluateAskCap,
  isEspIdfSdkconfigDefaults,
  mergeEnvValues,
  parseEnvKeys,
  resolveEnvPath,
  stripSdkconfigKeys,
} from '@lib/wizard-tools';
import type { AuditCheck } from '@lib/programs/audit/types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-tools-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const seedChecks: AuditCheck[] = [
  {
    id: 'sdk-installed',
    area: 'Installation',
    label: 'Honch SDK installed',
    status: 'pending',
  },
  {
    id: 'sdk-up-to-date',
    area: 'Installation',
    label: 'SDK up to date',
    status: 'pending',
  },
  {
    id: 'init-correct',
    area: 'Installation',
    label: 'Init is correct',
    status: 'pending',
  },
];

const extraChecks: AuditCheck[] = [
  {
    id: 'runtime-reviewed',
    area: 'Runtime',
    label: 'Runtime reviewed',
    status: 'pending',
  },
  {
    id: 'config-reviewed',
    area: 'Configuration',
    label: 'Configuration reviewed',
    status: 'pending',
  },
];

describe('resolveEnvPath', () => {
  it('resolves paths inside the working directory and rejects paths that escape it', () => {
    expect(resolveEnvPath('/project', '.env.local')).toBe(
      path.resolve('/project', '.env.local'),
    );
    expect(resolveEnvPath('/project', 'config/.env')).toBe(
      path.resolve('/project', 'config/.env'),
    );
    expect(resolveEnvPath('/project', '.')).toBe(path.resolve('/project'));
    expect(() => resolveEnvPath('/project', '../etc/passwd')).toThrow(
      'Path traversal rejected',
    );
    expect(() => resolveEnvPath('/project', '/etc/passwd')).toThrow(
      'Path traversal rejected',
    );
  });
});

describe('parseEnvKeys', () => {
  it('extracts keys from assignments while ignoring comments, blanks, and malformed lines', () => {
    const keys = parseEnvKeys(`
# COMMENT=ignored

FOO=bar
  BAR = "quoted"
MY_KEY_2='single quoted'
not a key value pair
DB_URL=postgres://host:5432/db?opt=1
`);

    expect(keys).toEqual(new Set(['FOO', 'BAR', 'MY_KEY_2', 'DB_URL']));
  });
});

describe('mergeEnvValues', () => {
  it('updates existing keys in place, appends new keys, and preserves values containing equals signs', () => {
    const result = mergeEnvValues('FOO=old\nDB_URL=old://host', {
      FOO: 'new',
      DB_URL: 'postgres://new:5432/db?opt=1',
      BAR: 'added',
    });

    expect(result).toBe(
      'FOO=new\nDB_URL=postgres://new:5432/db?opt=1\nBAR=added\n',
    );
  });
});

describe('isEspIdfSdkconfigDefaults', () => {
  it('matches ESP-IDF Kconfig defaults files and nothing else', () => {
    expect(isEspIdfSdkconfigDefaults('sdkconfig.defaults')).toBe(true);
    expect(isEspIdfSdkconfigDefaults('sdkconfig.defaults.local')).toBe(true);
    expect(isEspIdfSdkconfigDefaults('sdkconfig.defaults.esp32s3')).toBe(true);
    expect(isEspIdfSdkconfigDefaults('app/sdkconfig.defaults.local')).toBe(
      true,
    );

    expect(isEspIdfSdkconfigDefaults('sdkconfig')).toBe(false);
    expect(isEspIdfSdkconfigDefaults('.env.local')).toBe(false);
    expect(isEspIdfSdkconfigDefaults('my.sdkconfig.defaults')).toBe(false);
  });
});

describe('stripSdkconfigKeys', () => {
  it('removes only the targeted CONFIG_ lines and reports them once', () => {
    const sdkconfig = [
      'CONFIG_IDF_TARGET="esp32s3"',
      'CONFIG_HONCH_API_KEY="honch_stale"',
      'CONFIG_HONCH_HOST="https://i.honch.io"',
      'CONFIG_FREERTOS_HZ=1000',
    ].join('\n');

    const { content, stripped } = stripSdkconfigKeys(sdkconfig, [
      'CONFIG_HONCH_API_KEY',
      'CONFIG_HONCH_HOST',
    ]);

    expect(stripped).toEqual(['CONFIG_HONCH_API_KEY', 'CONFIG_HONCH_HOST']);
    expect(content).toBe(
      'CONFIG_IDF_TARGET="esp32s3"\nCONFIG_FREERTOS_HZ=1000',
    );
  });

  it('is a no-op when the key is absent', () => {
    const sdkconfig = 'CONFIG_IDF_TARGET="esp32s3"';
    const { content, stripped } = stripSdkconfigKeys(sdkconfig, [
      'CONFIG_HONCH_API_KEY',
    ]);
    expect(stripped).toEqual([]);
    expect(content).toBe(sdkconfig);
  });
});

describe('ensureSdkconfigDefaultsWired', () => {
  const cmake =
    'cmake_minimum_required(VERSION 3.16)\n' +
    'include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n' +
    'project(pyramid)\n';

  it('inserts a SDKCONFIG_DEFAULTS line before the project.cmake include', () => {
    const { content, changed } = ensureSdkconfigDefaultsWired(
      cmake,
      'sdkconfig.defaults.local',
    );
    expect(changed).toBe(true);
    expect(content).toContain(
      'set(SDKCONFIG_DEFAULTS "sdkconfig.defaults;sdkconfig.defaults.local")',
    );
    // must precede the include so it is set before project()
    expect(content.indexOf('SDKCONFIG_DEFAULTS')).toBeLessThan(
      content.indexOf('project.cmake'),
    );
  });

  it('appends to an existing SDKCONFIG_DEFAULTS list and is idempotent', () => {
    const withList = 'set(SDKCONFIG_DEFAULTS "sdkconfig.defaults")\n' + cmake;
    const first = ensureSdkconfigDefaultsWired(
      withList,
      'sdkconfig.defaults.local',
    );
    expect(first.changed).toBe(true);
    expect(first.content).toContain(
      'set(SDKCONFIG_DEFAULTS "sdkconfig.defaults;sdkconfig.defaults.local")',
    );

    const second = ensureSdkconfigDefaultsWired(
      first.content,
      'sdkconfig.defaults.local',
    );
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  it('is idempotent across the quoted, unquoted, and multi-line forms', () => {
    const unquoted =
      'set(SDKCONFIG_DEFAULTS sdkconfig.defaults sdkconfig.defaults.local)\n' +
      cmake;
    const multiline =
      'set(SDKCONFIG_DEFAULTS\n  "sdkconfig.defaults"\n  "sdkconfig.defaults.local")\n' +
      cmake;
    for (const variant of [unquoted, multiline]) {
      const result = ensureSdkconfigDefaultsWired(
        variant,
        'sdkconfig.defaults.local',
      );
      expect(result.changed).toBe(false);
      expect(result.status).toBe('already');
      expect(result.content).toBe(variant);
    }
  });

  it('never inserts a second declaration when SDKCONFIG_DEFAULTS exists in a form it will not edit', () => {
    const uneditable = 'set(SDKCONFIG_DEFAULTS ${OTHER_DEFAULTS})\n' + cmake;
    const { content, changed, status } = ensureSdkconfigDefaultsWired(
      uneditable,
      'sdkconfig.defaults.local',
    );
    expect(changed).toBe(false);
    expect(status).toBe('unparseable');
    expect(content).toBe(uneditable);
    // exactly one SDKCONFIG_DEFAULTS declaration remains
    expect(content.match(/SDKCONFIG_DEFAULTS/g)).toHaveLength(1);
  });

  it('reports no change when the project.cmake include is missing', () => {
    const { content, changed, status } = ensureSdkconfigDefaultsWired(
      'project(bare)\n',
      'sdkconfig.defaults.local',
    );
    expect(changed).toBe(false);
    expect(status).toBe('no-include');
    expect(content).toBe('project(bare)\n');
  });
});

describe('ensureGitignoreCoverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => cleanup(tmpDir));

  it('creates or appends missing entries and does not duplicate trimmed matches', () => {
    ensureGitignoreCoverage(tmpDir, '.env.local');
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8')).toBe(
      '.env.local\n',
    );

    ensureGitignoreCoverage(tmpDir, '.env.local');
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8')).toBe(
      '.env.local\n',
    );

    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules');
    ensureGitignoreCoverage(tmpDir, '.env');
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8')).toBe(
      'node_modules\n.env\n',
    );

    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '  .env.local  \n');
    ensureGitignoreCoverage(tmpDir, '.env.local');
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8')).toBe(
      '  .env.local  \n',
    );
  });
});

describe('audit ledger helpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => cleanup(tmpDir));

  it('writes, replaces, and reads a ledger without leaving temporary files behind', () => {
    const target = path.join(tmpDir, __test.AUDIT_CHECKS_FILE);

    __test.writeLedgerAtomic(target, seedChecks);
    expect(__test.readLedger(target)).toEqual(seedChecks);
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);

    __test.writeLedgerAtomic(target, [seedChecks[0]]);
    expect(__test.readLedger(target)).toEqual([seedChecks[0]]);
  });

  it('treats missing or invalid ledger files as empty ledgers', () => {
    expect(__test.readLedger(path.join(tmpDir, 'missing.json'))).toEqual([]);

    const target = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(target, '{not json');
    expect(__test.readLedger(target)).toEqual([]);
  });

  it('patches known checks with metadata and reports unknown check ids without changing the ledger', () => {
    const { next, unknown } = __test.applyAuditUpdates(seedChecks, [
      {
        id: 'sdk-installed',
        status: 'pass',
        file: 'package.json',
        details: '@honch/react-native-relay found',
      },
      { id: 'does-not-exist', status: 'warning' },
    ]);

    expect(unknown).toEqual(['does-not-exist']);
    expect(next).toEqual([
      {
        ...seedChecks[0],
        status: 'pass',
        file: 'package.json',
        details: '@honch/react-native-relay found',
      },
      seedChecks[1],
      seedChecks[2],
    ]);
  });

  it('appends new checks after existing checks and rejects duplicates without mutating', () => {
    expect(
      __test.applyAuditAdditions(seedChecks, extraChecks).next.map((c) => c.id),
    ).toEqual([
      'sdk-installed',
      'sdk-up-to-date',
      'init-correct',
      'runtime-reviewed',
      'config-reviewed',
    ]);

    const duplicateExisting = __test.applyAuditAdditions(seedChecks, [
      { ...extraChecks[0], id: 'sdk-installed' },
    ]);
    expect(duplicateExisting).toEqual({
      next: seedChecks,
      duplicates: ['sdk-installed'],
    });

    const duplicateAddition = __test.applyAuditAdditions(seedChecks, [
      extraChecks[0],
      { ...extraChecks[1], id: extraChecks[0].id },
    ]);
    expect(duplicateAddition).toEqual({
      next: seedChecks,
      duplicates: ['runtime-reviewed'],
    });
  });

  it('requires a seeded on-disk ledger before appending checks', () => {
    const target = path.join(tmpDir, __test.AUDIT_CHECKS_FILE);

    expect(__test.appendAuditChecksToLedger(target, extraChecks)).toEqual({
      ok: false,
      reason: 'missing-ledger',
    });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('appends checks to disk and rejects duplicate ids without changing the existing file', () => {
    const target = path.join(tmpDir, __test.AUDIT_CHECKS_FILE);
    __test.writeLedgerAtomic(target, seedChecks);

    expect(__test.appendAuditChecksToLedger(target, extraChecks)).toEqual({
      ok: true,
      added: 2,
    });
    expect(__test.readLedger(target)).toEqual([...seedChecks, ...extraChecks]);

    expect(
      __test.appendAuditChecksToLedger(target, [
        { ...extraChecks[0], id: 'sdk-installed' },
      ]),
    ).toEqual({
      ok: false,
      reason: 'duplicate-ids',
      ids: ['sdk-installed'],
    });
    expect(__test.readLedger(target)).toEqual([...seedChecks, ...extraChecks]);
  });
});

describe('makeMutex', () => {
  it('serializes concurrent ledger add and resolve operations without losing either change', async () => {
    const tmpDir = makeTmpDir();
    try {
      const target = path.join(tmpDir, __test.AUDIT_CHECKS_FILE);
      __test.writeLedgerAtomic(target, seedChecks);

      const run = __test.makeMutex();
      await Promise.all([
        run(() => {
          const current = __test.readLedger(target);
          const { next } = __test.applyAuditUpdates(current, [
            { id: 'sdk-installed', status: 'pass' },
          ]);
          __test.writeLedgerAtomic(target, next);
        }),
        run(() => {
          __test.appendAuditChecksToLedger(target, [extraChecks[0]]);
        }),
      ]);

      const final = __test.readLedger(target);
      expect(final.find((c) => c.id === 'sdk-installed')?.status).toBe('pass');
      expect(final.find((c) => c.id === extraChecks[0].id)).toEqual(
        extraChecks[0],
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  it('continues running queued tasks after a previous task fails', async () => {
    const run = __test.makeMutex();

    await expect(
      run(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(run(() => 42)).resolves.toBe(42);
  });
});

describe('WIZARD_TOOL_NAMES', () => {
  it('exposes audit_add_checks so future programs can append checks through the MCP server', () => {
    expect(WIZARD_TOOL_NAMES.auditAddChecks).toBe(
      'mcp__wizard-tools__audit_add_checks',
    );
  });

  it('exposes wizard_ask so skills can collect structured input from the user', () => {
    expect(WIZARD_TOOL_NAMES.wizardAsk).toBe('mcp__wizard-tools__wizard_ask');
  });
});

describe('evaluateAskCap', () => {
  const MAX = DEFAULT_ASK_MAX_QUESTIONS;

  it('allows calls under both the adjacency threshold and the max cap', () => {
    for (let i = 0; i < ASK_BATCH_THRESHOLD; i++) {
      expect(evaluateAskCap(i, MAX)).toEqual({ kind: 'ok' });
    }
  });

  it('returns the adjacency error once the threshold is hit', () => {
    expect(evaluateAskCap(ASK_BATCH_THRESHOLD, MAX)).toEqual({
      kind: 'capped',
      reason: 'adjacency',
      message: expect.stringMatching(/batch/i),
    });
  });

  it('escalates to the max_questions reason once the cap is reached', () => {
    expect(evaluateAskCap(MAX, MAX)).toEqual({
      kind: 'capped',
      reason: 'max_questions',
      message: expect.stringMatching(/cap reached/i),
    });
  });

  it('honors a custom maxQuestions override smaller than the adjacency threshold', () => {
    // With maxQuestions=2 (below ASK_BATCH_THRESHOLD), the per-run cap wins.
    expect(evaluateAskCap(2, 2)).toEqual({
      kind: 'capped',
      reason: 'max_questions',
      message: expect.any(String),
    });
  });
});
