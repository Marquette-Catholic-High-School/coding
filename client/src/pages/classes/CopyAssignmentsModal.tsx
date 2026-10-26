import { Alert, Button, Checkbox, Divider, Group, List, Modal, Paper, ScrollArea, Select, Skeleton, Stack, Switch, Text } from '@mantine/core';
import type { AssignmentListItem, AssignmentsResponse, ClassSummary, CopyAssignmentsResponse, Language } from '@codeclass/shared';
import { IconAlertTriangle, IconCopy } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { useClassAssignments, useCopyAssignments } from '../../api/assignments';
import { useClasses } from '../../api/classes';
import { useLanguageMap, useLanguages } from '../../api/languages';
import { useCurrentUser } from '../../auth/AuthProvider';
import { DraftBadge, LanguageBadge, UnavailableLanguageBadge } from '../../components/badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { ErrorAlert, QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { copyButtonLabel, copySummary, languageWarnings, MAX_COPY_AT_ONCE, skippedTitle, sourceClassOptions } from './copyAssignments';

/** Copies assignments from another class the teacher manages (or this one) into `cls`. */
export function CopyAssignmentsModal({ cls, opened, onClose }: { cls: ClassSummary; opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Copy assignments" size="lg">
      <CopyAssignmentsBody cls={cls} onClose={onClose} />
    </Modal>
  );
}

/** Runs useClassAssignments for the chosen class (the hook needs an id, so it only mounts once there is one). */
function SourceAssignments({
  classId,
  children,
}: {
  classId: number;
  children: (query: UseQueryResult<AssignmentsResponse>) => ReactNode;
}) {
  const query = useClassAssignments(classId);
  return <>{children(query)}</>;
}

function ListSkeleton() {
  return (
    <Stack gap="xs">
      <Skeleton h={44} />
      <Skeleton h={44} />
      <Skeleton h={44} />
    </Stack>
  );
}

function AssignmentChecklist({
  list,
  selected,
  onChange,
  sourceName,
  languages,
}: {
  list: AssignmentListItem[];
  selected: ReadonlySet<number>;
  onChange: (next: ReadonlySet<number>) => void;
  sourceName: string;
  languages: Map<string, Language>;
}) {
  if (list.length === 0) {
    return (
      <Paper withBorder p="md">
        <Text size="sm" c="dimmed">
          {sourceName} has no assignments yet.
        </Text>
      </Paper>
    );
  }
  const count = list.filter((a) => selected.has(a.id)).length;
  const toggle = (id: number, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <Paper withBorder>
      <Group justify="space-between" wrap="nowrap" px="md" py="sm">
        <Checkbox
          label="Select all"
          checked={count === list.length}
          indeterminate={count > 0 && count < list.length}
          onChange={(event) => onChange(new Set(event.currentTarget.checked ? list.map((a) => a.id) : []))}
        />
        <Text size="sm" c="dimmed">
          {count} of {list.length} selected
        </Text>
      </Group>
      <Divider />
      <ScrollArea.Autosize mah={320} type="auto">
        <Stack gap={0}>
          {list.map((a, i) => {
            const language = languages.get(a.languageId);
            return (
              <Fragment key={a.id}>
                {i > 0 && <Divider />}
                <Checkbox
                  px="md"
                  py="sm"
                  checked={selected.has(a.id)}
                  onChange={(event) => toggle(a.id, event.currentTarget.checked)}
                  label={
                    <Group gap={6}>
                      <Text span size="sm" fw={600}>
                        {a.title}
                      </Text>
                      {language ? (
                        <LanguageBadge kind={language.kind} name={language.name} />
                      ) : (
                        <UnavailableLanguageBadge languageId={a.languageId} />
                      )}
                      {!a.published && <DraftBadge />}
                    </Group>
                  }
                  description={a.dueAt ? <RelativeTime date={a.dueAt} prefix="Due" inherit /> : 'No due date'}
                />
              </Fragment>
            );
          })}
        </Stack>
      </ScrollArea.Autosize>
    </Paper>
  );
}

function CopyAssignmentsBody({ cls, onClose }: { cls: ClassSummary; onClose: () => void }) {
  const user = useCurrentUser();
  const activeClasses = useClasses(false);
  const archivedClasses = useClasses(true);
  const languagesQuery = useLanguages();
  const languages = useLanguageMap();
  const copy = useCopyAssignments(cls.id);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [keepDueDates, setKeepDueDates] = useState(false);
  const [publish, setPublish] = useState(false);
  // What the last copy skipped, kept on screen until the dialog closes (the notification only counts them).
  const [skipped, setSkipped] = useState<CopyAssignmentsResponse | null>(null);

  const classesError = activeClasses.error ?? archivedClasses.error;
  const classOptions =
    activeClasses.data && archivedClasses.data
      ? sourceClassOptions(activeClasses.data.classes, archivedClasses.data.classes, cls, user.id)
      : [];
  const allClasses = [...(activeClasses.data?.classes ?? []), ...(archivedClasses.data?.classes ?? [])];
  const sourceName = allClasses.find((c) => c.id === sourceId)?.name ?? cls.name;

  const submit = async (chosen: AssignmentListItem[]) => {
    setSkipped(null);
    try {
      // Oldest first: copies made together share a creation time and the list shows newer ones first, so this keeps
      // the order teachers see in the source class.
      const ordered = [...chosen].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
      const result = await copy.mutateAsync({ assignmentIds: ordered.map((a) => a.id), keepDueDates, publish });
      const summary = copySummary(result, (id) => languages.get(id)?.name ?? id, publish);
      if (summary) notifySuccess(summary.title, summary.message);
      if (result.skipped.length === 0) {
        onClose();
      } else {
        setSkipped(result);
        setSelected(new Set());
      }
    } catch (err) {
      notifyError(err, "Couldn't copy the assignments");
    }
  };

  const content = (query: UseQueryResult<AssignmentsResponse> | null) => {
    const list = query?.data?.assignments ?? [];
    const chosen = list.filter((a) => selected.has(a.id));
    const tooMany = chosen.length > MAX_COPY_AT_ONCE;
    const warnings = languageWarnings(chosen, cls.languageIds, languagesQuery.isSuccess ? languages : undefined);
    return (
      <>
        {query && (
          <QueryState query={query} loader={<ListSkeleton />}>
            {({ assignments }) => (
              <AssignmentChecklist
                list={assignments}
                selected={selected}
                onChange={setSelected}
                sourceName={sourceName}
                languages={languages}
              />
            )}
          </QueryState>
        )}
        {tooMany && (
          <Text size="sm" c="red">
            You can copy up to {MAX_COPY_AT_ONCE} assignments at a time.
          </Text>
        )}
        {warnings.length > 0 && (
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
            <Stack gap={4}>
              {warnings.map((line) => (
                <Text key={line} size="sm">
                  {line}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}
        <Switch
          label="Keep due dates"
          description="Off: the copies have no due date, so you can set new ones."
          checked={keepDueDates}
          onChange={(event) => setKeepDueDates(event.currentTarget.checked)}
        />
        <Switch
          label="Publish straight away"
          description="Off: the copies are drafts, so you can adjust them before students see them."
          checked={publish}
          onChange={(event) => setPublish(event.currentTarget.checked)}
        />
        {skipped && (
          <Alert
            variant="light"
            color="yellow"
            icon={<IconAlertTriangle size={18} />}
            title={skippedTitle(skipped)}
            withCloseButton
            closeButtonLabel="Dismiss"
            onClose={() => setSkipped(null)}
          >
            <List size="sm" spacing={4}>
              {skipped.skipped.map((s) => (
                <List.Item key={s.sourceId}>
                  <b>{s.title}</b>: {s.reason}
                </List.Item>
              ))}
            </List>
          </Alert>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {skipped ? 'Close' : 'Cancel'}
          </Button>
          <Button
            leftSection={<IconCopy size={18} />}
            loading={copy.isPending}
            disabled={chosen.length === 0 || tooMany}
            onClick={() => void submit(chosen)}
          >
            {copyButtonLabel(chosen.length)}
          </Button>
        </Group>
      </>
    );
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Copies keep the instructions, language, starter code, tests, points and solution. Students&apos; work isn&apos;t copied.
      </Text>
      {classesError ? (
        <ErrorAlert
          error={classesError}
          title="Couldn't load your classes"
          onRetry={() => {
            void activeClasses.refetch();
            void archivedClasses.refetch();
          }}
        />
      ) : (
        <Select
          data-autofocus
          label="Copy from"
          placeholder={classOptions.length > 0 ? 'Choose a class' : 'Loading your classes…'}
          description={sourceId === cls.id ? 'Copies made within this class get "(copy)" added to their titles.' : undefined}
          data={classOptions}
          disabled={classOptions.length === 0}
          searchable={classOptions.reduce((n, g) => n + g.items.length, 0) > 8}
          nothingFoundMessage="No class matches"
          allowDeselect={false}
          value={sourceId == null ? null : String(sourceId)}
          onChange={(value) => {
            setSourceId(value == null ? null : Number(value));
            setSelected(new Set());
          }}
        />
      )}
      {sourceId == null ? (
        content(null)
      ) : (
        <SourceAssignments key={sourceId} classId={sourceId}>
          {content}
        </SourceAssignments>
      )}
    </Stack>
  );
}
