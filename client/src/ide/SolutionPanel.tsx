import { Box, Button, Group, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import type { Language } from '@codeclass/shared';
import { IconLock, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import type { Ref } from 'react';
import { CopyIconButton } from '../components/CopyIconButton';
import { CodeEditor } from './CodeEditor';
import classes from './ide.module.css';
import type { CodeEditorHandle } from './types';

export interface SolutionPanelProps {
  /** What to show (see `solutionContent`): the code, or a note about when it will be available. */
  content: { code: string } | { note: string };
  language: Pick<Language, 'kind' | 'pseudocode' | 'name'>;
  /** Stacked layout (small screens): the panel has no height of its own. */
  mobile: boolean;
  /** The solution is running in the console; shows Stop in place of Run solution. */
  running: boolean;
  /** False while something else is running. */
  canRun: boolean;
  /** Runs the solution in the console, or for web pages shows it in the preview. */
  onRun: () => void;
  onStop: () => void;
  /** Line of the solution's last runtime error. */
  errorLine: number | null;
  editorRef?: Ref<CodeEditorHandle>;
}

const MIN_EDITOR_HEIGHT = 120;

/** Read-only reference solution with Run solution and Copy, or a note saying when it will be available. */
export function SolutionPanel({ content, language, mobile, running, canRun, onRun, onStop, errorLine, editorRef }: SolutionPanelProps) {
  // The editor grows with the solution up to the height left in the panel, then scrolls.
  const area = useElementSize<HTMLDivElement>();

  if (!('code' in content)) {
    return (
      <Box p="md">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon color="gray" variant="light" size={36} radius="xl">
            <IconLock size={20} />
          </ThemeIcon>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={600} size="sm">
              Not available yet
            </Text>
            <Text size="sm" c="dimmed">
              {content.note}
            </Text>
          </Stack>
        </Group>
      </Box>
    );
  }

  const isWeb = language.kind === 'web';
  const editor = (
    <CodeEditor
      ref={editorRef}
      value={content.code}
      language={language}
      readOnly
      height="auto"
      minHeight={MIN_EDITOR_HEIGHT}
      maxHeight={mobile ? '45dvh' : area.height > 0 ? area.height : undefined}
      errorLine={errorLine}
      fontSize={13}
      ariaLabel={`Solution (${language.name})`}
    />
  );

  const toolbar = (
    <Group justify="space-between" gap="xs" style={{ flexShrink: 0 }}>
      {running ? (
        <Button size="xs" variant="light" color="red" leftSection={<IconPlayerStop size={14} />} onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Tooltip label="Shows the solution in the page preview" disabled={!isWeb}>
          <Button size="xs" variant="light" leftSection={<IconPlayerPlay size={14} />} disabled={!canRun} onClick={onRun}>
            Run solution
          </Button>
        </Tooltip>
      )}
      <CopyIconButton value={content.code} label="Copy solution" />
    </Group>
  );

  if (mobile) {
    return (
      <Stack gap="sm" p="md">
        {toolbar}
        {editor}
      </Stack>
    );
  }

  return (
    <Stack gap="sm" p="md" h="100%" style={{ minHeight: 0 }}>
      {toolbar}
      <Box ref={area.ref} className={classes.fill}>
        {editor}
      </Box>
    </Stack>
  );
}
