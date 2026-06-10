import { Box, Text } from 'ink';
import { Colors } from '@ui/tui/styles';

const FEEDBACK = 'Feedback: the Honch team ';
const FEEDBACK_SHORT = ' the Honch team ';

interface TitleBarProps {
  version: string;
  width: number;
}

export const TitleBar = ({ version, width }: TitleBarProps) => {
  const fullTitle = ` Honch Wizard v${version}`;
  const needShort = width < fullTitle.length + FEEDBACK.length;
  const feedback = needShort ? FEEDBACK_SHORT : FEEDBACK;
  const title =
    needShort && fullTitle.length + feedback.length > width
      ? ` Wizard v${version}`
      : fullTitle;
  const gap = Math.max(0, width - title.length - feedback.length);
  const padding = ' '.repeat(gap);

  return (
    <Box width={width} overflow="hidden">
      <Text backgroundColor={Colors.accent} color={Colors.titleColor}>
        {title}
        {padding}
        {feedback}
      </Text>
    </Box>
  );
};
