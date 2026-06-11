/**
 * PRODUCT_SUITE_BLOCK — Two-column listing of Honch SDK targets + capabilities.
 */

import { Text } from 'ink';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

export const PRODUCT_SUITE_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 1000,
  pause: 15000,
  lines: [
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'ESP-IDF (firmware)    '}
      <Text color="cyan">{'◆ '}</Text>
      {'Local event queue'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'C / POSIX (firmware)  '}
      <Text color="cyan">{'◆ '}</Text>
      {'Sessions & identity'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'MicroPython (firmware)'}
      <Text color="cyan">{'◆ '}</Text>
      {'BLE relay topology'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'React Native relay    '}
      <Text color="cyan">{'◆ '}</Text>
      {'Durable retry queue'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Auto device events    '}
      <Text color="cyan">{'◆ '}</Text>
      {'Live colored diffs'}
    </Text>,
  ],
};
