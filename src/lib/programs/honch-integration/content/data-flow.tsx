/**
 * HONCH_DATA_FLOW — ASCII diagram of the Honch event ingestion flow.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

export const HONCH_DATA_FLOW: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 8000,
  lines: [
    <Text>
      <Text bold color="cyan">
        {'  Your device / app'}
      </Text>
    </Text>,
    <Text>
      <Text color="gray">{'    │  '}</Text>
      <Text>honch_track(event, props)</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    │  '}</Text>
      <Text dimColor>custom events + properties</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ↓  '}</Text>
      <Text dimColor>device + session ids</Text>
    </Text>,
    <Text>
      <Text bold color={Colors.accent}>
        {'  Honch SDK'}
      </Text>
      <Text dimColor>{'  (queues locally)'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ↓  '}</Text>
      <Text>HTTPS upload</Text>
    </Text>,
    <Text>
      <Text bold color={Colors.accent}>
        {'  Honch Cloud'}
      </Text>
    </Text>,
    <Text>
      <Text color="gray">{'    ↓  '}</Text>
      <Text>query + visualize</Text>
    </Text>,
    <Text bold color="green">
      {'  Dashboards & Insights'}
    </Text>,
  ],
};
