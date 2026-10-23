import { Badge, Tooltip } from '@mantine/core';
import { IconCalendarDue, IconCalendarOff } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { BADGE_NO_SHRINK } from '../../components/badges';

/** "Due in 3 days" with the exact date in a tooltip; orange when under 48 hours remain on unfinished work. */
export function DueBadge({ dueAt, done = false }: { dueAt: string | null; done?: boolean }) {
  if (!dueAt) {
    return (
      <Badge variant="light" color="gray" tt="none" leftSection={<IconCalendarOff size={12} />} {...BADGE_NO_SHRINK}>
        No due date
      </Badge>
    );
  }
  const due = dayjs(dueAt);
  const hoursLeft = due.diff(dayjs(), 'hour', true);
  const soon = !done && hoursLeft > 0 && hoursLeft < 48;
  return (
    <Tooltip label={due.format('ddd D MMM YYYY, h:mm A')}>
      <Badge variant="light" color={soon ? 'orange' : 'gray'} tt="none" leftSection={<IconCalendarDue size={12} />} {...BADGE_NO_SHRINK}>
        Due {due.fromNow()}
      </Badge>
    </Tooltip>
  );
}
