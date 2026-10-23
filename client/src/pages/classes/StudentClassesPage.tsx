import { Button, Card, EmptyState, Group, SimpleGrid, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ClassSummary } from '@codeclass/shared';
import { IconClipboardList, IconPlus, IconSchool, IconUser } from '@tabler/icons-react';
import { Link } from 'react-router';
import { useClasses } from '../../api/classes';
import classes from '../../components/cards.module.css';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { usePageTitle } from '../../hooks/usePageTitle';
import { JoinClassModal } from '../student/JoinClassModal';

function ClassCard({ cls }: { cls: ClassSummary }) {
  return (
    <Card component={Link} to={`/classes/${cls.id}`} className={classes.linkCard}>
      <Text fw={650} size="lg" lineClamp={2}>
        {cls.name}
      </Text>
      <Text size="sm" c="dimmed" lineClamp={2} mb="md" style={{ flex: 1 }}>
        {cls.description}
      </Text>
      <Group gap="lg">
        <Group gap={6} wrap="nowrap">
          <IconUser size={16} color="var(--mantine-color-dimmed)" />
          <Text size="sm">{cls.ownerName}</Text>
        </Group>
        <Group gap={6} wrap="nowrap">
          <IconClipboardList size={16} color="var(--mantine-color-dimmed)" />
          <Text size="sm">
            {cls.assignmentCount} assignment{cls.assignmentCount === 1 ? '' : 's'}
          </Text>
        </Group>
      </Group>
    </Card>
  );
}

export function StudentClassesPage() {
  const query = useClasses();
  const [joinOpened, join] = useDisclosure(false);
  usePageTitle('My classes');

  return (
    <>
      <PageHeader
        title="My classes"
        subtitle="Classes you've joined. Open one to see its assignments."
        actions={
          <Button leftSection={<IconPlus size={18} />} onClick={join.open}>
            Join class
          </Button>
        }
      />
      <QueryState query={query}>
        {({ classes: list }) =>
          list.length === 0 ? (
            <Card py={48}>
              <EmptyState
                variant="light"
                size="lg"
                icon={<IconSchool size={32} />}
                title="Join your first class"
                description="Ask your teacher for the 6-character class code, then enter it here."
              >
                <EmptyState.Actions>
                  <Button size="md" leftSection={<IconPlus size={18} />} onClick={join.open}>
                    Join a class
                  </Button>
                </EmptyState.Actions>
              </EmptyState>
            </Card>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {list.map((cls) => (
                <ClassCard key={cls.id} cls={cls} />
              ))}
            </SimpleGrid>
          )
        }
      </QueryState>
      <JoinClassModal opened={joinOpened} onClose={join.close} />
    </>
  );
}
