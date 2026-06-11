import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  installLocalSkill,
  localSkillExists,
  localSkillsDir,
  readLocalSkill,
} from '@lib/local-skills';

describe('local-skills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'honch-skills-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves the bundled skills dir containing every target', () => {
    const dir = localSkillsDir();
    expect(fs.existsSync(path.join(dir, 'esp-idf', 'SKILL.md'))).toBe(true);
    for (const id of [
      'esp-idf',
      'c-posix',
      'micropython',
      'react-native-relay',
      'ios-swift',
      'android-kotlin',
    ]) {
      expect(localSkillExists(id)).toBe(true);
    }
  });

  it('resolves skills through the .bin symlink (npx / global install layout)', () => {
    // Reproduce an npx install:
    //   <root>/node_modules/honcho-wizard/dist/{bin.js,skills/esp-idf/SKILL.md}
    //   <root>/node_modules/.bin/honcho-wizard  ->  ../honcho-wizard/dist/bin.js
    // npx runs the .bin SYMLINK, so process.argv[1] points at `.bin/<name>`
    // whose dirname has no skills — resolution must follow the symlink.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'honch-npx-'));
    const pkgDist = path.join(root, 'node_modules', 'honcho-wizard', 'dist');
    const skillDir = path.join(pkgDist, 'skills', 'esp-idf');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: x\n---\n');
    fs.writeFileSync(path.join(pkgDist, 'bin.js'), '');
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const symlink = path.join(binDir, 'honcho-wizard');
    fs.symlinkSync(path.join(pkgDist, 'bin.js'), symlink);

    const prevArgv1 = process.argv[1];
    process.argv[1] = symlink;
    try {
      // realpath both sides: macOS tmpdir lives under /var -> /private/var.
      expect(fs.realpathSync(localSkillsDir())).toBe(
        fs.realpathSync(path.join(pkgDist, 'skills')),
      );
    } finally {
      process.argv[1] = prevArgv1;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads the skill name from SKILL.md frontmatter', () => {
    expect(readLocalSkill('esp-idf')).toEqual({
      id: 'esp-idf',
      name: 'honch-esp-idf',
    });
  });

  it('returns null for an unknown skill', () => {
    expect(readLocalSkill('not-a-target')).toBeNull();
    expect(localSkillExists('not-a-target')).toBe(false);
  });

  it('installs a bundled skill into <installDir>/.claude/skills/<id>/', () => {
    const result = installLocalSkill('esp-idf', tmpDir);
    expect(result).toEqual({ kind: 'ok', path: '.claude/skills/esp-idf' });

    const installed = path.join(tmpDir, '.claude', 'skills', 'esp-idf');
    expect(fs.existsSync(path.join(installed, 'SKILL.md'))).toBe(true);
    // Marker so the keep-skills screen can identify wizard-installed skills.
    expect(fs.existsSync(path.join(installed, '.honch-wizard'))).toBe(true);

    // Copied content is the real skill, not a stub — including the
    // anti-hallucination guidance the agent relies on.
    const md = fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8');
    expect(md).toContain('honch_track');
    expect(md).toContain('honch.h');
  });

  it('reports skill-not-found for an unknown id without writing anything', () => {
    const result = installLocalSkill('not-a-target', tmpDir);
    expect(result).toEqual({
      kind: 'skill-not-found',
      skillId: 'not-a-target',
    });
    expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(false);
  });
});
