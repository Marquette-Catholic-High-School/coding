import { ActionIcon, Alert, Card, Code, Group, Stack, Text, Tooltip } from '@mantine/core';
import type { Language, Project } from '@codeclass/shared';
import { IconAlertCircle, IconPencil, IconTrash } from '@tabler/icons-react';
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useLanguages } from '../../api/languages';
import { useProject, useUpdateProject } from '../../api/projects';
import { LanguageBadge } from '../../components/badges';
import { CopyIconButton } from '../../components/CopyIconButton';
import { NotFoundCard } from '../../components/NotFoundCard';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { useAutosave } from '../../hooks/useAutosave';
import { usePageTitle } from '../../hooks/usePageTitle';
import { CodeWorkspace } from '../../ide';
import { RenameProjectModal, useConfirmDeleteProject } from '../student/ProjectModals';
import { SaveStatus } from '../student/SaveStatus';

/** The language is gone (uninstalled, or hidden from students because it was turned off): show the code to copy. */
function UnavailableLanguage({ project }: { project: Project }) {
  return (
    <Stack gap="md">
      <Alert variant="light" color="red" icon={<IconAlertCircle />} title="This project's language isn't available any more">
        <Text size="sm">
          "{project.languageId}" has been uninstalled or turned off, so this project can't be opened in the editor. Your code is still here —
          copy it into a new project to keep working on it.
        </Text>
      </Alert>
      <Card padding="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600}>Your code</Text>
          <CopyIconButton value={project.code} label="Copy code" />
        </Group>
        <Code block>{project.code || ' '}</Code>
      </Card>
    </Stack>
  );
}

function ProjectEditor({ project, language }: { project: Project; language: Language | undefined }) {
  const navigate = useNavigate();
  const update = useUpdateProject(project.id);
  const confirmDelete = useConfirmDeleteProject();
  const [renaming, setRenaming] = useState(false);
  const [code, setCode] = useState(project.code);
  const editable = language?.enabled ?? false;

  const autosave = useAutosave<string>({
    enabled: editable,
    initialSavedAt: project.updatedAt,
    save: (value) => update.mutateAsync({ code: value }),
  });
  const queueSave = autosave.update;
  const handleCodeChange = useCallback(
    (value: string) => {
      setCode(value);
      queueSave(value);
    },
    [queueSave],
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Playground', to: '/playground' }, { label: project.title }]}
        title={project.title}
        badges={
          <>
            <Tooltip label="Rename project">
              <ActionIcon variant="subtle" color="gray" aria-label="Rename project" onClick={() => setRenaming(true)}>
                <IconPencil size={18} />
              </ActionIcon>
            </Tooltip>
            {language && <LanguageBadge kind={language.kind} name={language.name} />}
          </>
        }
        actions={
          <Tooltip label="Delete project">
            <ActionIcon
              variant="subtle"
              color="red"
              size="lg"
              aria-label="Delete project"
              onClick={() => confirmDelete(project, () => navigate('/playground', { replace: true }))}
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        }
      />
      {language ? (
        <CodeWorkspace
          language={language}
          code={code}
          onCodeChange={editable ? handleCodeChange : undefined}
          readOnly={!editable}
          storageKey="playground"
          toolbarRight={editable ? <SaveStatus autosave={autosave} /> : undefined}
          banner={
            editable ? undefined : (
              <Alert variant="light" color="red" icon={<IconAlertCircle />} title={`${language.name} is turned off`}>
                <Text size="sm">An admin turned this language off, so this project is read-only. Your code is safe.</Text>
              </Alert>
            )
          }
        />
      ) : (
        <UnavailableLanguage project={project} />
      )}
      {renaming && <RenameProjectModal project={project} onClose={() => setRenaming(false)} />}
    </>
  );
}

function ProjectView({ projectId }: { projectId: number }) {
  const project = useProject(projectId);
  const languages = useLanguages();
  usePageTitle(project.data?.project.title ?? 'Project');

  // Once loaded, keep the editor mounted even if a background refetch fails.
  if (project.data && languages.data) {
    const { project: p } = project.data;
    return <ProjectEditor project={p} language={languages.data.languages.find((l) => l.id === p.languageId)} />;
  }
  return (
    <QueryState query={project} notFound={<NotFoundCard title="We couldn't find that project" description="It may have been deleted." />}>
      {() => <QueryState query={languages}>{() => null}</QueryState>}
    </QueryState>
  );
}

export function ProjectPage() {
  const projectId = Number(useParams().projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) return <NotFoundCard />;
  return <ProjectView key={projectId} projectId={projectId} />;
}
