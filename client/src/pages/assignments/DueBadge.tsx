import { Badge, Tooltip } from '@mantine/core';
import { IconCalendarDue, IconCalendarOff } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { BADGE_NO_SHRINK } from '../../components/badges';

/** Teacher-facing due date: "Due in 3 days" (orange inside 48 hours) with the exact date in a tooltip. */
export function DueBadge({ dueAt, allowLate }: { dueAt: string | null; allowLate?: boolean }) {
  if (!dueAt) {
    return (
      <Badge variant="light" color="gray" tt="none" leftSection={<IconCalendarOff size={12} />} {...BADGE_NO_SHRINK}>
        No due date
      </Badge>
    );
  }
  const due = dayjs(dueAt);
  const hoursLeft = due.diff(dayjs(), 'hour', true);
  const soon = hoursLeft > 0 && hoursLeft < 48;
  const late = allowLate === undefined ? '' : allowLate ? ' · late work accepted' : ' · no late work';
  return (
    <Tooltip label={`${due.format('ddd D MMM YYYY, h:mm A')}${late}`}>
      <Badge variant="light" color={soon ? 'orange' : 'gray'} tt="none" leftSection={<IconCalendarDue size={12} />} {...BADGE_NO_SHRINK}>
        Due {due.fromNow()}
      </Badge>
    </Tooltip>
  );
}
