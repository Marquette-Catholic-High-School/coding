import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  Input,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { Dropzone, type FileRejection } from '@mantine/dropzone';
import { useForm } from '@mantine/form';
import type { ClassSummary, InviteImportResponse } from '@codeclass/shared';
import { IconAlertTriangle, IconArrowLeft, IconEye, IconFileSpreadsheet, IconUpload, IconUsersPlus, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { useImportInvites } from '../../api/classes';
import { fieldErrors } from '../../api/client';
import { InviteOutcomeBadge } from '../../components/badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { decodeText, parseStudentList, type StudentList } from './csv';
import { importButtonLabel, importResultMessage, importTotals, isSkipped } from './importSummary';

const MAX_FILE_BYTES = 1024 * 1024;
/** `importInvitesSchema` takes at most this many entries per request. */
const MAX_ENTRIES = 1000;
/** Matched by MIME type or extension (Windows reports .csv files as an Excel type, so the extension matters). */
const ACCEPT = { 'text/csv': ['.csv'], 'text/plain': ['.txt'], 'text/tab-separated-values': ['.tsv'] };

const TRADE_OFF = "CodeClass can't check that people own the email address they sign up with, so check who joined on the Students tab.";

interface ChosenFile {
  name: string;
  size: number;
  text: string;
}

interface Preview {
  source: string;
  list: StudentList;
  result: InviteImportResponse;
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function rejectionMessage(rejections: FileRejection[]): string {
  const codes = new Set(rejections.flatMap((r) => r.errors.map((e) => e.code)));
  if (codes.has('too-many-files')) return 'Choose one file at a time.';
  if (codes.has('file-too-large')) return 'That file is over 1 MB. Keep just the name and email columns, or paste the list instead.';
  return "That isn't a CSV or text file. In Excel or Google Sheets, save or download the sheet as CSV first.";
}

function noEmailsMessage(source: string | null): string {
  return source
    ? `We couldn't find any email addresses in ${source}. It needs a column of student email addresses.`
    : "We couldn't find any email addresses. Paste one student per line, with their email address.";
}

/** Style guide §4 FileDropzone (compact, for a modal): idle / accept / reject icons, then the chosen file. */
function SpreadsheetDropzone({
  file,
  error,
  loading,
  onFile,
  onReject,
  onClear,
}: {
  file: ChosenFile | null;
  error: string | null;
  loading: boolean;
  onFile: (file: File) => void;
  onReject: (rejections: FileRejection[]) => void;
  onClear: () => void;
}) {
  return (
    <Input.Wrapper
      labelElement="div"
      label="Spreadsheet"
      description="A CSV file with a column of student email addresses (and names, if you like)."
      error={error}
    >
      {file ? (
        <Paper withBorder p="sm" mt={6}>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon size={40} variant="light" radius="md">
              <IconFileSpreadsheet size={22} />
            </ThemeIcon>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={500} truncate>
                {file.name}
              </Text>
              <Text size="xs" c="dimmed">
                {formatSize(file.size)}
              </Text>
            </div>
            <Tooltip label="Remove file">
              <ActionIcon variant="subtle" color="gray" size="lg" onClick={onClear} aria-label="Remove file">
                <IconX size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Paper>
      ) : (
        <Dropzone
          mt={6}
          multiple={false}
          maxSize={MAX_FILE_BYTES}
          accept={ACCEPT}
          loading={loading}
          inputProps={{ 'aria-label': 'Choose a spreadsheet file' }}
          onDrop={(files) => {
            if (files[0]) onFile(files[0]);
          }}
          onReject={onReject}
          style={error ? { borderColor: 'var(--mantine-color-error)' } : undefined}
        >
          <Group justify="center" gap="md" mih={96} wrap="nowrap" style={{ pointerEvents: 'none' }}>
            <Dropzone.Accept>
              <IconUpload size={32} stroke={1.5} color="var(--mantine-primary-color-filled)" />
            </Dropzone.Accept>
            <Dropzone.Reject>
              <IconX size={32} stroke={1.5} color="var(--mantine-color-red-6)" />
            </Dropzone.Reject>
            <Dropzone.Idle>
              <IconFileSpreadsheet size={32} stroke={1.5} color="var(--mantine-color-dimmed)" />
            </Dropzone.Idle>
            <div>
              <Text size="md" fw={500}>
                Drag a spreadsheet here or click to choose one
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                .csv or .txt · up to 1 MB
              </Text>
            </div>
          </Group>
        </Dropzone>
      )}
    </Input.Wrapper>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text fz={24} fw={700} lh={1.2}>
        {value.toLocaleString('en-US')}
      </Text>
    </Paper>
  );
}

function PreviewStep({ preview }: { preview: Preview }) {
  const [filter, setFilter] = useState<'all' | 'skipped'>('all');
  const { list, result } = preview;
  const totals = importTotals(result.counts);
  const rows = result.rows.map((row, index) => ({ row, index }));
  const visible = filter === 'skipped' ? rows.filter(({ row }) => isSkipped(row.outcome)) : rows;
  const columns = list.hasHeader
    ? [
        list.emailColumn ? `emails from “${list.emailColumn}”` : null,
        list.nameColumns.length > 0 ? `names from ${list.nameColumns.map((c) => `“${c}”`).join(' + ')}` : null,
      ].filter((part) => part !== null)
    : [];

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {preview.source} · {result.rows.length.toLocaleString('en-US')} {result.rows.length === 1 ? 'row' : 'rows'}
        {columns.length > 0 && ` · ${columns.join(', ')}`}. Nothing has changed yet.
      </Text>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <Tile label="Added now" value={totals.addedNow} />
        <Tile label="Join at sign-up" value={totals.joinLater} />
        <Tile label="Already added" value={totals.already} />
        <Tile label="Skipped" value={totals.skipped} />
      </SimpleGrid>
      {totals.skipped > 0 && totals.skipped < rows.length && (
        <SegmentedControl
          size="xs"
          style={{ alignSelf: 'flex-start' }}
          value={filter}
          onChange={(value) => setFilter(value === 'skipped' ? 'skipped' : 'all')}
          data={[
            { value: 'all', label: `All rows (${rows.length.toLocaleString('en-US')})` },
            { value: 'skipped', label: `Skipped (${totals.skipped.toLocaleString('en-US')})` },
          ]}
        />
      )}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={560} maxHeight={340}>
          <Table stickyHeader verticalSpacing="xs" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Email</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Result</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map(({ row, index }) => (
                <Table.Tr key={index}>
                  <Table.Td style={{ wordBreak: 'break-all' }}>
                    {row.email ? (
                      <Text size="sm">{row.email}</Text>
                    ) : (
                      <Text size="sm" c="dimmed" fs="italic">
                        (blank)
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={row.name || row.student ? undefined : 'dimmed'}>
                      {row.name || row.student?.name || '—'}
                    </Text>
                    {row.student && (
                      <Text size="xs" c="dimmed">
                        Account @{row.student.username}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <InviteOutcomeBadge outcome={row.outcome} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {totals.joinLater > 0 && (
        <Text size="sm" c="dimmed">
          Students who haven't signed up yet must use exactly the email address on this list. {TRADE_OFF}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Students tab → "Import from spreadsheet": a CSV file or a pasted list of student emails (+ optional names), parsed in
 * the browser, previewed with a dry run (what happens to each row), then imported.
 */
export function ImportStudentsModal({ cls, opened, onClose }: { cls: ClassSummary; opened: boolean; onClose: () => void }) {
  const check = useImportInvites(cls.id);
  const save = useImportInvites(cls.id);
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const form = useForm({ mode: 'uncontrolled', initialValues: { list: '' } });

  const close = () => {
    onClose();
    form.reset();
    setFile(null);
    setFileError(null);
    setPreview(null);
    check.reset();
    save.reset();
  };

  const showInputError = (message: string, fromFile: boolean) => {
    if (fromFile) setFileError(message);
    else form.setFieldError('list', message);
  };

  const runPreview = (text: string, source: ChosenFile | null) => {
    const list = parseStudentList(text);
    if (list.entries.length === 0) return showInputError(noEmailsMessage(source?.name ?? null), source !== null);
    if (list.entries.length > MAX_ENTRIES) {
      return showInputError(
        `That's ${list.entries.length.toLocaleString('en-US')} rows. Import at most 1,000 students at a time — split the list into parts.`,
        source !== null,
      );
    }
    check.mutate(
      { entries: list.entries, dryRun: true },
      {
        onSuccess: (result) => setPreview({ source: source?.name ?? 'Pasted list', list, result }),
        onError: (err) => {
          const message = fieldErrors(err).entries;
          if (message) showInputError(message, source !== null);
          else notifyError(err, "Couldn't check the list");
        },
      },
    );
  };

  const chooseFile = async (chosen: File) => {
    setFileError(null);
    setReading(true);
    try {
      const picked = { name: chosen.name, size: chosen.size, text: decodeText(await chosen.arrayBuffer()) };
      setFile(picked);
      runPreview(picked.text, picked);
    } catch {
      setFileError("Couldn't read that file. Try saving it again as CSV.");
    } finally {
      setReading(false);
    }
  };

  const submitList = form.onSubmit(({ list }) => {
    if (file) return runPreview(file.text, file);
    if (!list.trim()) return form.setFieldError('list', 'Choose a spreadsheet or paste a list of email addresses');
    runPreview(list, null);
  });

  const runImport = () => {
    if (!preview) return;
    save.mutate(
      { entries: preview.list.entries, dryRun: false },
      {
        onSuccess: (result) => {
          notifySuccess('Students imported', importResultMessage(result.counts));
          close();
        },
        onError: (err) => notifyError(err, "Couldn't import the students"),
      },
    );
  };

  const totals = preview ? importTotals(preview.result.counts) : null;

  return (
    <Modal opened={opened} onClose={close} title="Import students" size="lg">
      {cls.archived && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} mb="md">
          <Text size="sm">This class is archived. Unarchive it in Settings to add students.</Text>
        </Alert>
      )}
      {preview && totals ? (
        <Stack gap="md">
          <PreviewStep preview={preview} />
          <Group justify="space-between" gap="sm">
            <Button variant="default" leftSection={<IconArrowLeft size={18} />} onClick={() => setPreview(null)} disabled={save.isPending}>
              Back
            </Button>
            <Group gap="sm">
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
              <Button leftSection={<IconUsersPlus size={18} />} onClick={runImport} loading={save.isPending} disabled={totals.importable === 0 || cls.archived}>
                {totals.importable === 0 ? 'Nothing to import' : importButtonLabel(totals.importable)}
              </Button>
            </Group>
          </Group>
        </Stack>
      ) : (
        <form noValidate onSubmit={submitList}>
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Students whose CodeClass account already has the email address are added to {cls.name} now. Everyone else
              joins when they sign up with exactly the email address on your list. {TRADE_OFF}
            </Text>
            <SpreadsheetDropzone
              file={file}
              error={fileError}
              loading={reading}
              onFile={(chosen) => void chooseFile(chosen)}
              onReject={(rejections) => setFileError(rejectionMessage(rejections))}
              onClear={() => {
                setFile(null);
                setFileError(null);
              }}
            />
            {!file && (
              <>
                <Divider label="or paste a list" labelPosition="center" />
                <Textarea
                  aria-label="Paste a list"
                  description="One student per line: an email address, “Name <email>” or “Name, email”. Cells copied from a spreadsheet work too."
                  placeholder={'sam.patel@school.org\nJo Lee <jo.lee@school.org>'}
                  autosize
                  minRows={4}
                  maxRows={8}
                  spellCheck={false}
                  key={form.key('list')}
                  {...form.getInputProps('list')}
                />
              </>
            )}
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" leftSection={<IconEye size={18} />} loading={check.isPending || reading} disabled={cls.archived}>
                Preview
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
