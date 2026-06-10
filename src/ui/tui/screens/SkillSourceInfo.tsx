/**
 * Shared "Skill: <id> / Docs: <url>" block for intro screens.
 *
 * Honch ships its per-target skills bundled with the wizard (no remote
 * registry), so `useSkillEntry` resolves the entry from the local bundle on
 * disk. `<SkillSourceInfo>` renders the block, taking the entry as a prop so
 * the caller can reuse the same hook result for additional UI (e.g. showing
 * `skillEntry.name`) without invoking the hook twice.
 */

import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { readLocalSkill } from '@lib/local-skills';
import { HONCH_DOCS_URL } from '@lib/constants';

export type SkillEntry = { id: string; name: string; docsUrl: string };

export function useSkillEntry(skillId: string | null): {
  skillEntry: SkillEntry | null;
  fetchFailed: boolean;
} {
  const [skillEntry, setSkillEntry] = useState<SkillEntry | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (!skillId) {
      setSkillEntry(null);
      setFetchFailed(true);
      return;
    }
    const local = readLocalSkill(skillId);
    if (local) {
      setSkillEntry({
        id: local.id,
        name: local.name,
        docsUrl: `${HONCH_DOCS_URL}/sdks/${local.id}`,
      });
      setFetchFailed(false);
    } else {
      setSkillEntry(null);
      setFetchFailed(true);
    }
  }, [skillId]);

  return { skillEntry, fetchFailed };
}

interface SkillSourceInfoProps {
  skillId: string | null;
  skillEntry: SkillEntry | null;
  fetchFailed: boolean;
}

export const SkillSourceInfo = ({
  skillId,
  skillEntry,
  fetchFailed,
}: SkillSourceInfoProps) => (
  <Box flexDirection="column">
    <Text>
      Skill:{' '}
      <Text italic color="cyan">
        {skillId ?? 'unknown'}
      </Text>
    </Text>
    <Text>
      Source:{' '}
      <Text color="cyan">
        {skillEntry
          ? 'bundled with the wizard'
          : fetchFailed
          ? 'unavailable'
          : 'Loading...'}
      </Text>
    </Text>
    {skillEntry ? (
      <Text>
        Docs: <Text color="cyan">{skillEntry.docsUrl}</Text>
      </Text>
    ) : null}
  </Box>
);
