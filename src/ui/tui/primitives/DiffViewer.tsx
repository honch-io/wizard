/**
 * DiffViewer — renders live colored file diffs from the agent's
 * Write/Edit/MultiEdit calls. Additions are green, deletions red, context dim.
 */

import { Box, Text } from 'ink';
import type { FileDiff, FileDiffLine } from '@lib/wizard-session';

interface DiffViewerProps {
  diffs: FileDiff[];
}

const LINE_COLOR: Record<FileDiffLine['kind'], string> = {
  add: 'green',
  del: 'red',
  ctx: 'gray',
  hunk: 'cyan',
};

const LINE_PREFIX: Record<FileDiffLine['kind'], string> = {
  add: '+',
  del: '-',
  ctx: ' ',
  hunk: ' ',
};

export const DiffViewer = ({ diffs }: DiffViewerProps) => {
  if (diffs.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color="gray">No file changes yet…</Text>
      </Box>
    );
  }

  // Most recent change first.
  const ordered = [...diffs].reverse();

  return (
    <Box flexDirection="column" paddingX={1}>
      {ordered.map((diff, i) => (
        <Box key={`${diff.path}-${i}`} flexDirection="column" marginBottom={1}>
          <Text>
            <Text color="cyan" bold>
              {diff.tool}{' '}
            </Text>
            <Text bold>{diff.path} </Text>
            <Text color="green">+{diff.added}</Text>
            <Text color="gray">/</Text>
            <Text color="red">-{diff.removed}</Text>
          </Text>
          {diff.lines.map((line, j) => (
            <Text key={j} color={LINE_COLOR[line.kind]} wrap="truncate-end">
              {LINE_PREFIX[line.kind]}
              {line.text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
};
