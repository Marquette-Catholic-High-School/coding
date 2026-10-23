// Class-specific status badges, built like the shared ones in components/badges.tsx.

import { Badge, Tooltip } from '@mantine/core';
import { IconArchive, IconKey, IconLock } from '@tabler/icons-react';
import { BADGE_NO_SHRINK } from '../../components/badges';

export function ArchivedBadge() {
  return (
    <Tooltip label="Hidden from dashboards and closed to new students. All work is kept.">
      <Badge variant="light" color="gray" leftSection={<IconArchive size={12} />} {...BADGE_NO_SHRINK}>
        Archived
      </Badge>
    </Tooltip>
  );
}

export function JoiningOffBadge() {
  return (
    <Tooltip label="Students can't join with the class code or link. Turn joining on in Settings." multiline maw={300}>
      <Badge variant="light" color="gray" leftSection={<IconLock size={12} />} {...BADGE_NO_SHRINK}>
        Joining off
      </Badge>
    </Tooltip>
  );
}

export function TemporaryPasswordBadge() {
  return (
    <Tooltip label="Still using the temporary password you gave them. They'll choose their own after signing in." multiline maw={300}>
      <Badge variant="light" color="grape" size="sm" leftSection={<IconKey size={12} />} {...BADGE_NO_SHRINK}>
        Temp password
      </Badge>
    </Tooltip>
  );
}
