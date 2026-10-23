import { ActionIcon, Badge, Box, Button, Card, EmptyState, Group, Menu, SimpleGrid, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { Language, Project } from '@codeclass/shared';
import { IconClock, IconCode, IconDots, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useLanguageMap } from '../../api/languages';
import { useProjects } from '../../api/projects';
import { BADGE_NO_SHRINK, LanguageBadge } from '../../components/badges';
import classes from '../../components/cards.module.css';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { usePageTitle } from '../../hooks/usePageTitle';
import { NewProjectModal, RenameProjectModal, useConfirmDeleteProject } from '../student/ProjectModals';

function ProjectLanguageBadge({ language, languageId }: { language: Language | undefined; languageId: string }) {
  if (language) return <LanguageBadge kind={language.kind} name={language.name} />;
  return (
    <Tooltip label="This language isn't available any more.">
      <Badge variant="outline" color="gray" tt="none" {...BADGE_NO_SHRINK}>
        {languageId}
      </Badge>
    </Tooltip>
  );
}

function ProjectCard({
  project,
  language,
  onRename,
  onDelete,
}: {
  project: Project;
  language: Language | undefined;
  onRename: () => void;
  onDelete: () => void;
}) {
  const preview = project.code.trim();
  return (
    <Box pos="relative" h="100%">
      <Card component={Link} to={`/playground/${project.id}`} className={classes.linkCard}>
        <Text fw={650} size="lg" lineClamp={2} pr={36}>
          {project.title}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace" lineClamp={3} mt={4} mb="md" style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {preview || 'No code yet'}
        </Text>
        <Group gap="lg" wrap="wrap">
          <ProjectLanguageBadge language={language} languageId={project.languageId} />
          <Group gap={6} wrap="nowrap">
            <IconClock size={16} color="var(--mantine-color-dimmed)" />
            <Text size="sm">
              Edited <RelativeTime date={project.updatedAt} inherit />
            </Text>
          </Group>
        </Group>
      </Card>
      <Menu position="bottom-end" withinPortal width={200}>
        <Menu.Target>
          <Tooltip label="Project actions">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={`Actions for ${project.title}`}
              pos="absolute"
              top="var(--mantine-spacing-md)"
              right="var(--mantine-spacing-md)"
            >
              <IconDots size={18} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconPencil size={16} />} onClick={onRename}>
            Rename
          </Menu.Item>
          <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={onDelete}>
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Box>
  );
}

export function ProjectsPage() {
  const query = useProjects();
  const languages = useLanguageMap();
  const [newOpened, newModal] = useDisclosure(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const confirmDelete = useConfirmDeleteProject();
  usePageTitle('Playground');

  return (
    <>
      <PageHeader
        title="Playground"
        subtitle="Practice coding in any language — projects are private to you."
        actions={
          <Button leftSection={<IconPlus size={18} />} onClick={newModal.open}>
            New project
          </Button>
        }
      />
      <QueryState query={query}>
        {({ projects }) =>
          projects.length === 0 ? (
            <Card py={48}>
              <EmptyState
                variant="light"
                size="lg"
                icon={<IconCode size={32} />}
                title="Start your first project"
                description="Try out ideas in any language your school has installed. Only you can see your projects."
              >
                <EmptyState.Actions>
                  <Button size="md" leftSection={<IconPlus size={18} />} onClick={newModal.open}>
                    New project
                  </Button>
                </EmptyState.Actions>
              </EmptyState>
            </Card>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  language={languages.get(project.languageId)}
                  onRename={() => setRenaming(project)}
                  onDelete={() => confirmDelete(project)}
                />
              ))}
            </SimpleGrid>
          )
        }
      </QueryState>
      <NewProjectModal opened={newOpened} onClose={newModal.close} />
      {renaming && <RenameProjectModal project={renaming} onClose={() => setRenaming(null)} />}
    </>
  );
}
