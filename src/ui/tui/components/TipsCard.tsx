/**
 * TipsCard — Shows Honch usage tips during the agent run.
 * Reactively shows/hides tips based on discovered features.
 * Supports toggling additional features via key bindings.
 */

import { Box, Text, useInput } from 'ink';
import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { AdditionalFeature } from '@lib/wizard-session';

/** A discrete tip shown in the TipsCard during the agent run. */
interface Tip {
  /** Unique identifier */
  id: string;
  /** Title line */
  title: string;
  /** Description shown below the title */
  description: string;
  /** Optional URL shown after the description */
  url?: string;
  /** When provided, the tip is only shown if this returns true */
  visible?: (store: WizardStore) => boolean;
  /** Optional key binding that toggles an AdditionalFeature */
  toggle?: {
    /** The key the user presses (lowercase) */
    key: string;
    /** The additional feature to enqueue */
    feature: AdditionalFeature;
    /** Label shown when toggled on */
    enabledLabel: string;
    /** Prompt shown when not yet toggled */
    prompt: string;
    /** Returns true if already toggled */
    isEnabled: (store: WizardStore) => boolean;
  };
}

const TIPS: Tip[] = [
  {
    id: 'identify',
    title: 'Identify devices and users with Honch',
    description:
      'Every event carries a stable device_id. Call identify() to attach a user id so events from the same person line up across sessions and devices.',
  },
  {
    id: 'properties',
    title: 'Get way more detail using properties',
    description:
      'Attach properties to any event — firmware version, screen, button, battery level — to slice and filter your data in the Honch dashboard.',
  },
  {
    id: 'sessions',
    title: 'Group activity into sessions',
    description:
      'Wrap related events with session_start() / session_end() to analyze a single hardware session end-to-end.',
  },
];

export const TipsCard = ({ store }: { store: WizardStore }) => {
  useInput((input) => {
    for (const tip of TIPS) {
      if (
        tip.toggle &&
        input.toLowerCase() === tip.toggle.key &&
        (!tip.visible || tip.visible(store)) &&
        !tip.toggle.isEnabled(store)
      ) {
        store.enableFeature(tip.toggle.feature);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={Colors.accent}>
        Tips
      </Text>
      <Box height={1} />

      {TIPS.filter((tip) => !tip.visible || tip.visible(store)).map((tip) => (
        <Box key={tip.id} flexDirection="column" marginBottom={1}>
          <Text>
            <Text color={Colors.accent}>{Icons.diamond} </Text>
            <Text bold>{tip.title}</Text>
          </Text>

          {tip.toggle ? (
            tip.toggle.isEnabled(store) ? (
              <Text color={Colors.success}>
                {Icons.check} {tip.toggle.enabledLabel}
              </Text>
            ) : (
              <Text dimColor>
                {tip.toggle.prompt} Press{' '}
                <Text bold color={Colors.accent}>
                  {tip.toggle.key.toUpperCase()}
                </Text>{' '}
                to enable.
              </Text>
            )
          ) : (
            <Text dimColor>
              {tip.description}
              {tip.url && (
                <>
                  {' '}
                  <Text color="cyan">{tip.url}</Text>
                </>
              )}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
};
