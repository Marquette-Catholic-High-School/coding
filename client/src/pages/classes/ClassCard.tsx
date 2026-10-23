import { Card, Group, SimpleGrid, Text } from '@mantine/core';
import type { ClassSummary } from '@codeclass/shared';
import { IconClipboardList, IconUser, IconUsers } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../../auth/AuthProvider';
import { CodeChip } from '../../components/badges';
import classes from '../../components/cards.module.css';
import { ArchivedBadge } from './classBadges';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Group gap={6} wrap="nowrap">
      {icon}
      <Text size="sm">{children}</Text>
    </Group>
  );
}

/** Link card for a class in the teacher's grids (classes page, dashboard). */
export function ClassCard({ cls }: { cls: ClassSummary }) {
  const user = useCurrentUser();
  const dimmed = 'var(--mantine-color-dimmed)';
  return (
    <Card component={Link} to={`/classes/${cls.id}`} className={classes.linkCard}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm" mb={4}>
        <Text fw={650} size="lg" lineClamp={2}>
          {cls.name}
        </Text>
        {cls.archived && <ArchivedBadge />}
      </Group>
      <Text size="sm" c="dimmed" lineClamp={2} mb="md" style={{ flex: 1 }}>
        {cls.description || 'No description'}
      </Text>
      <Group gap="lg">
        <Meta icon={<IconUsers size={16} color={dimmed} />}>{plural(cls.studentCount, 'student')}</Meta>
        <Meta icon={<IconClipboardList size={16} color={dimmed} />}>{plural(cls.assignmentCount, 'assignment')}</Meta>
        {cls.ownerId !== user.id && <Meta icon={<IconUser size={16} color={dimmed} />}>{cls.ownerName}</Meta>}
        {cls.joinCode && <CodeChip>{cls.joinCode}</CodeChip>}
      </Group>
    </Card>
  );
}

export function ClassCardGrid({ classes: list }: { classes: ClassSummary[] }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
      {list.map((c) => (
        <ClassCard key={c.id} cls={c} />
      ))}
    </SimpleGrid>
  );
}
