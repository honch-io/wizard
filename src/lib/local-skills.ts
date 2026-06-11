/**
 * Local (bundled) skill resolution + install.
 *
 * The Honch wizard ships its per-target install skills in-repo under
 * `src/skills/<id>/SKILL.md` (copied to `dist/skills/` at build time). Unlike
 * PostHog's wizard — which fetched skills from a remote context-mill GitHub
 * release — Honch has NO remote skill registry: the deep install knowledge
 * travels with the wizard binary so a run works offline. That matters for
 * firmware dev, where the machine flashing an ESP32 may not have open egress to
 * github.com.
 *
 * This module locates that bundled directory and copies the matching skill into
 * the target project's `.claude/skills/<id>/` — exactly where the agent prompt
 * tells the agent to read it from (see agent-prompt.ts `skillPrompt`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { logToFile } from '@utils/debug';

/** A bundled skill, identified by its directory id + frontmatter name. */
export type LocalSkill = { id: string; name: string };

/**
 * Result of {@link installLocalSkill}. Mirrors the old remote installer's
 * result shape minus the network-only cases (`menu-fetch-failed`,
 * `download-failed`), which can't happen for an on-disk copy.
 */
export type InstallSkillResult =
  | { kind: 'ok'; path: string }
  | { kind: 'skill-not-found'; skillId: string }
  | { kind: 'copy-failed'; message: string };

function safeIsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A bundled skill that is guaranteed to exist — used as the sentinel that marks
 * the real skills directory among the candidates below.
 */
const SENTINEL_SKILL = path.join('esp-idf', 'SKILL.md');

/**
 * Anchor directories the skills dir may sit under, most-reliable first:
 *  - the entry script's dir: the published build's `dist/` (argv[1] is
 *    `…/honcho-wizard/dist/bin.js`), or `<repo>` under `tsx bin.ts`.
 *  - `__dirname`, and one/two levels up: defined under jest (ts-jest →
 *    CommonJS) and tsx as this module's dir (`src/lib`). Undefined in the Node
 *    ESM bundle — `typeof` guards that.
 *  - cwd: the wizard repo in dev (`pnpm try` runs from the repo, not the
 *    --install-dir).
 */
function searchAnchors(): string[] {
  const anchors: string[] = [];
  if (process.argv[1]) anchors.push(path.dirname(process.argv[1]));
  if (typeof __dirname !== 'undefined') {
    anchors.push(__dirname, path.join(__dirname, '..'));
  }
  anchors.push(process.cwd());
  return anchors;
}

/** Layouts the skills dir takes relative to an anchor. */
const RELATIVE_SKILL_DIRS = ['skills', 'src/skills', 'dist/skills'];

/**
 * Resolve the bundled skills directory by probing each (anchor × layout) pair
 * for the sentinel skill. Works under the built bundle (`dist/skills`), tsx
 * (`src/skills`), and jest (same) without relying on `__dirname` being present
 * in the ESM bundle. Falls back to `<cwd>/skills` if nothing matches.
 */
export function localSkillsDir(): string {
  for (const anchor of searchAnchors()) {
    for (const rel of RELATIVE_SKILL_DIRS) {
      const candidate = path.join(anchor, rel);
      if (fs.existsSync(path.join(candidate, SENTINEL_SKILL))) {
        return candidate;
      }
    }
  }
  return path.join(process.cwd(), 'skills');
}

/** True when a bundled skill directory with a SKILL.md exists for this id. */
export function localSkillExists(skillId: string): boolean {
  return fs.existsSync(path.join(localSkillsDir(), skillId, 'SKILL.md'));
}

/** Parse the `name:` field from a SKILL.md YAML frontmatter block. */
function parseSkillName(skillMd: string, fallback: string): string {
  const fm = skillMd.match(/^---\s*\n([\s\S]*?)\n---/);
  const block = fm ? fm[1] : skillMd;
  const name = block.match(/^name:\s*(.+?)\s*$/m);
  return name ? name[1].trim() : fallback;
}

/** Read a bundled skill's metadata, or null if it isn't bundled. */
export function readLocalSkill(skillId: string): LocalSkill | null {
  const skillMdPath = path.join(localSkillsDir(), skillId, 'SKILL.md');
  try {
    const md = fs.readFileSync(skillMdPath, 'utf8');
    return { id: skillId, name: parseSkillName(md, skillId) };
  } catch {
    return null;
  }
}

/**
 * Copy a bundled skill into the target project's `.claude/skills/<id>/`.
 * Uses the same install location the old remote downloader used, so the agent
 * prompt's "read `.claude/skills/<id>/SKILL.md`" instruction is unchanged and
 * the keep-skills screen can offer to retain it.
 */
export function installLocalSkill(
  skillId: string,
  installDir: string,
): InstallSkillResult {
  const srcDir = path.join(localSkillsDir(), skillId);
  if (!safeIsDir(srcDir)) {
    return { kind: 'skill-not-found', skillId };
  }
  const destDir = path.join(installDir, '.claude', 'skills', skillId);
  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(srcDir, destDir, { recursive: true });
    // Marker so the keep-skills screen can tell wizard-installed skills apart.
    fs.writeFileSync(path.join(destDir, '.honch-wizard'), '');
    // Forward slashes — this is interpolated into the agent prompt, which runs
    // on POSIX in practice and reads cleaner than a backslash path.
    const relPath = `.claude/skills/${skillId}`;
    logToFile(`installLocalSkill: ${skillId} -> ${relPath}`);
    return { kind: 'ok', path: relPath };
  } catch (err: any) {
    logToFile(`installLocalSkill: error: ${err?.message ?? err}`);
    return { kind: 'copy-failed', message: err?.message ?? String(err) };
  }
}
