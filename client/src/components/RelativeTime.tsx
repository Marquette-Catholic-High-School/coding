import { Text, Tooltip, type TextProps } from '@mantine/core';
import dayjs from 'dayjs';

/** "in 3 days" / "2 hours ago" with the absolute date/time in a tooltip. Renders a dimmed dash for null. */
export function RelativeTime({ date, prefix, ...textProps }: { date: string | null | undefined; prefix?: string } & TextProps) {
  if (!date) {
    return (
      <Text span c="dimmed" {...textProps}>
        —
      </Text>
    );
  }
  const d = dayjs(date);
  return (
    <Tooltip label={d.format('ddd D MMM YYYY, h:mm A')}>
      <Text span {...textProps}>
        {prefix ? `${prefix} ` : ''}
        {d.fromNow()}
      </Text>
    </Tooltip>
  );
}
