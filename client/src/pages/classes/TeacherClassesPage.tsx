import { Button, Card, EmptyState, SegmentedControl, SimpleGrid, Skeleton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArchive, IconPlus, IconSchool } from '@tabler/icons-react';
import { useSearchParams } from 'react-router';
import { useClasses } from '../../api/classes';
import { useCurrentUser } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { usePageTitle } from '../../hooks/usePageTitle';
import { ClassCardGrid } from './ClassCard';
import { CreateClassModal } from './CreateClassModal';

type View = 'active' | 'archived';

function GridSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} h={150} radius="md" />
      ))}
    </SimpleGrid>
  );
}

export function TeacherClassesPage() {
  usePageTitle('Classes');
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('show') === 'archived' ? 'archived' : 'active';
  const classes = useClasses(view === 'archived');
  const [createOpened, createModal] = useDisclosure(false);

  const setView = (next: View) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'archived') p.set('show', 'archived');
        else p.delete('show');
        return p;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle={user.role === 'admin' ? 'Every class in CodeClass.' : 'Your classes. Students join with the class code.'}
        actions={
          <Button leftSection={<IconPlus size={18} />} onClick={createModal.open}>
            New class
          </Button>
        }
      />
      <SegmentedControl
        mb="lg"
        value={view}
        onChange={setView}
        data={[
          { label: 'Active', value: 'active' },
          { label: 'Archived', value: 'archived' },
        ]}
      />
      <QueryState query={classes} loader={<GridSkeleton />}>
        {({ classes: list }) => {
          if (list.length > 0) return <ClassCardGrid classes={list} />;
          if (view === 'archived') {
            return (
              <Card py={48}>
                <EmptyState
                  variant="light"
                  color="gray"
                  size="lg"
                  icon={<IconArchive size={32} />}
                  title="No archived classes"
                  description="When a class finishes, archive it from its Settings tab. Its work is kept and you can unarchive it any time."
                />
              </Card>
            );
          }
          return (
            <Card py={48}>
              <EmptyState
                variant="light"
                size="lg"
                icon={<IconSchool size={32} />}
                title="No classes yet"
                description="Create a class, choose the languages it uses, then share its code so your students can join."
              >
                <EmptyState.Actions>
                  <Button size="md" leftSection={<IconPlus size={18} />} onClick={createModal.open}>
                    Create your first class
                  </Button>
                </EmptyState.Actions>
              </EmptyState>
            </Card>
          );
        }}
      </QueryState>
      <CreateClassModal opened={createOpened} onClose={createModal.close} />
    </>
  );
}
