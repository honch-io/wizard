/**
 * Integration learn-deck — the narrative script played while the agent
 * runs the Honch integration flow. Weaves typewriter lines, pauses,
 * `clear` markers, and the diagram blocks into one sequence.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { WizardStore } from '@ui/tui/store';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import { StatusPeekTrigger } from '@ui/tui/components/StatusPeekTrigger';
import { HONCH_DATA_FLOW } from './data-flow.js';
import { PRODUCT_SUITE_BLOCK } from './product-suite.js';
import { LINE_CHART_BLOCK } from './line-chart.js';
import { FUNNEL_BLOCK } from './funnel.js';

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => [
  {
    content: 'Welcome.',
    pause: 3000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 160,
  },

  { content: 'The Wizard is an agent.', pause: 4000 },

  {
    content: 'It installs the Honch SDK into your project on your behalf.',
    pause: 5000,
  },

  {
    content:
      "As we speak, it's reading your build files and the Honch docs to wire it in.",
    pause: 6000,
  },

  { type: 'clear', pause: 2000 },

  {
    pause: 5000,
    persist: true,
    content: <StatusPeekTrigger store={store} />,
  },

  {
    pause: 6000,
    content: (
      <Text>
        Press{' '}
        <Text color={Colors.accent} bold>
          S
        </Text>{' '}
        to expand or collapse the status.
      </Text>
    ),
  },

  { type: 'clear', pause: 2000 },

  {
    content: 'It takes about five minutes.',
    pause: 2000,
  },

  {
    content: 'So grab some coffee ☕️.',
    pause: 2000,
  },

  {
    content: 'Or stick around and learn about Honch.',
    pause: 5000,
  },

  { type: 'clear', pause: 3000 },

  {
    content: 'Events are the foundation of Honch.',
    pause: 4000,
  },

  {
    content:
      'Every time something happens on your device or in your app — a boot, a button press, a screen view — you capture an event with honch_track().',
    pause: 6000,
  },

  {
    content:
      'The SDK queues events locally and uploads them to the Honch capture host.',
    pause: 6000,
  },

  { type: 'clear', pause: 1000 },

  { content: "Here's the flow.", pause: 1000 },

  HONCH_DATA_FLOW,

  { type: 'clear', pause: 2000 },

  {
    content:
      'With enough event data, you can answer powerful questions about how your hardware is used.',
    pause: 4000,
  },

  { content: 'And create insights.', pause: 4000 },

  { type: 'clear', pause: 500 },

  { content: 'Like trends to measure adoption.', pause: 2500 },

  LINE_CHART_BLOCK,

  { type: 'clear', pause: 500 },

  { content: 'Or funnels to reveal where users drop off.', pause: 2500 },

  FUNNEL_BLOCK,

  { type: 'clear', pause: 1000 },

  {
    content: 'Use those signals to decide what to build next.',
    pause: 4000,
  },

  { content: 'Honch works across every device and app you ship.', pause: 3000 },

  PRODUCT_SUITE_BLOCK,
];
