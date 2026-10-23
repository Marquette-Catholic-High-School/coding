import { Alert, Anchor, Box, Button, Code, Collapse, Group, Kbd, Loader, ScrollArea, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBulb,
  IconChevronRight,
  IconCircleCheck,
  IconClockExclamation,
  IconKeyboard,
  IconPlayerStop,
  IconTerminal2,
} from '@tabler/icons-react';
import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OutputChunk, RunOutcome, RunPhase } from '../runtime';
import classes from './ide.module.css';
import { consoleInputKey, formatDuration, tailSegments, type ConsoleSegment } from './ideUtils';

/** The console renders at most this many runs of output; earlier ones are replaced by a note. */
const MAX_CONSOLE_SEGMENTS = 2000;

export interface ConsolePanelProps {
  output: OutputChunk[];
  /** null when idle. */
  phase: RunPhase | null;
  inputPrompt?: string | null;
  /** Answers an input request; the console shows an input field while the program waits. */
  onSubmitInput?: (line: string) => void;
  /** Tells the program there is no more input (end of file); offered next to the input field and as Ctrl+D. */
  onEndInput?: () => void;
  /** Footer for the last finished run (hidden while running). */
  outcome?: RunOutcome | null;
  /** Shown while the runtime downloads/starts. */
  loadingMessage?: string;
  onGoToLine?: (line: number, column?: number) => void;
  emptyMessage: ReactNode;
  /** Extra content between the header and the output (the "Input for your program" box). */
  above?: ReactNode;
  title?: string;
}

function PhaseStatus({ phase }: { phase: RunPhase | null }) {
  if (phase === 'running') {
    return (
      <Group gap={6} wrap="nowrap">
        <Loader size={12} />
        <Text size="xs" c="dimmed">
          Running…
        </Text>
      </Group>
    );
  }
  if (phase === 'waiting-input') {
    return (
      <Group gap={6} wrap="nowrap">
        <IconKeyboard size={16} color="var(--mantine-color-dimmed)" aria-hidden />
        <Text size="xs" c="dimmed">
          Waiting for input
        </Text>
      </Group>
    );
  }
  if (phase === 'loading') {
    return (
      <Group gap={6} wrap="nowrap">
        <Loader size={12} />
        <Text size="xs" c="dimmed">
          Starting…
        </Text>
      </Group>
    );
  }
  return null;
}

function InputLine({
  prompt,
  onSubmit,
  onEnd,
}: {
  prompt: string | null;
  onSubmit: (line: string) => void;
  onEnd?: () => void;
}) {
  const [value, setValue] = useState('');
  const label = prompt?.trim() ? `Answer: ${prompt.trim()}` : 'Type a line of input for your program';
  // Anything already typed is sent as a last line first, so it isn't lost.
  const endInput = (end: () => void) => {
    if (value !== '') onSubmit(value);
    setValue('');
    end();
  };
  return (
    <Group px="sm" pb="xs" gap="xs" wrap="nowrap">
      <TextInput
        size="xs"
        ff="monospace"
        autoFocus
        style={{ flex: 1, minWidth: 0 }}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          const { key, ctrlKey, metaKey, altKey, shiftKey } = e;
          const action = consoleInputKey({ key, ctrlKey, metaKey, altKey, shiftKey, isComposing: e.nativeEvent.isComposing });
          if (action === 'submit') {
            e.preventDefault();
            onSubmit(value);
            setValue('');
          } else if (action === 'end' && onEnd) {
            e.preventDefault();
            endInput(onEnd);
          }
        }}
        leftSection={<IconChevronRight size={14} />}
        placeholder="Type your answer and press Enter"
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
      />
      {onEnd && (
        <Tooltip
          multiline
          maw={260}
          label={
            <>
              Tell your program there&apos;s no more input, for programs that read until the input ends (
              <Kbd size="xs">Ctrl</Kbd> + <Kbd size="xs">D</Kbd>)
            </>
          }
        >
          <Button size="xs" variant="default" style={{ flexShrink: 0 }} onClick={() => endInput(onEnd)} aria-keyshortcuts="Control+D">
            End input
          </Button>
        </Tooltip>
      )}
    </Group>
  );
}

/** The transcript text. Memoized: it only re-renders when the output changes, not on every phase change. */
const ConsoleText = memo(function ConsoleText({ segments, hidden }: { segments: ConsoleSegment[]; hidden: boolean }) {
  return (
    <pre className={classes.consoleText}>
      {hidden && <span className={classes.system}>{'… earlier output hidden\n'}</span>}
      {segments.map((s) => (
        <span key={s.key} className={classes[s.stream]}>
          {s.text}
        </span>
      ))}
    </pre>
  );
});

function ErrorFooter({ outcome, onGoToLine }: { outcome: RunOutcome; onGoToLine?: (line: number, column?: number) => void }) {
  const [showDetails, setShowDetails] = useState(false);
  const error = outcome.error;
  const timeout = outcome.status === 'timeout';
  const line = error?.line;
  const details = error?.details?.trim();
  const message = error?.message || (timeout ? 'Your program took too long, so it was stopped.' : 'Something went wrong.');

  const lineLink =
    line != null && onGoToLine ? (
      <Anchor component="button" type="button" inherit fw={700} onClick={() => onGoToLine(line, error?.column)}>
        line {line}
      </Anchor>
    ) : line != null ? (
      `line ${line}`
    ) : null;

  return (
    <Alert
      variant="light"
      color={timeout ? 'orange' : 'red'}
      icon={timeout ? <IconClockExclamation size={18} /> : <IconAlertTriangle size={18} />}
      title={
        timeout ? (
          <>Timed out{lineLink && <> on {lineLink}</>}</>
        ) : lineLink ? (
          <>Error on {lineLink}</>
        ) : (
          'Error'
        )
      }
      p="xs"
    >
      <Stack gap={6} align="flex-start">
        <Text size="sm">{message}</Text>
        {error?.hint && (
          <Group gap={6} wrap="nowrap" align="flex-start">
            <IconBulb size={16} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
            <Text size="sm">{error.hint}</Text>
          </Group>
        )}
        {details && details !== message && (
          <>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
              {showDetails ? 'Hide details' : 'Show details'}
            </Button>
            <Collapse expanded={showDetails} w="100%">
              <Code block className={classes.codeBlock} fz="xs" mah={220} style={{ overflow: 'auto' }}>
                {details}
              </Code>
            </Collapse>
          </>
        )}
      </Stack>
    </Alert>
  );
}

function OutcomeFooter({ outcome, onGoToLine }: { outcome: RunOutcome; onGoToLine?: (line: number, column?: number) => void }) {
  if (outcome.status === 'error' || outcome.status === 'timeout') {
    return <ErrorFooter outcome={outcome} onGoToLine={onGoToLine} />;
  }
  const stopped = outcome.status === 'stopped';
  return (
    <Group gap={6} wrap="nowrap">
      {stopped ? (
        <IconPlayerStop size={16} color="var(--mantine-color-dimmed)" aria-hidden />
      ) : (
        <IconCircleCheck size={16} color="var(--mantine-color-teal-filled)" aria-hidden />
      )}
      <Text size="xs" c="dimmed">
        {stopped ? 'Stopped' : `Finished in ${formatDuration(outcome.durationMs)}`}
      </Text>
    </Group>
  );
}

/** Program console: output transcript, inline input while the program waits, loading notice and run outcome. */
export function ConsolePanel({
  output,
  phase,
  inputPrompt = null,
  onSubmitInput,
  onEndInput,
  outcome,
  loadingMessage,
  onGoToLine,
  emptyMessage,
  above,
  title = 'Console',
}: ConsolePanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const { segments, hidden } = useMemo(() => tailSegments(output, MAX_CONSOLE_SEGMENTS), [output]);
  const waiting = phase === 'waiting-input' && onSubmitInput != null;
  const showOutcome = phase == null && outcome != null;
  const empty = segments.length === 0 && phase == null && !showOutcome;

  // Follow new output unless the user has scrolled up to read something.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (segments.length === 0) stickToBottom.current = true;
    if (viewport && stickToBottom.current) viewport.scrollTop = viewport.scrollHeight;
  }, [segments, phase, showOutcome]);

  return (
    <Box className={`${classes.column} ${classes.fill}`}>
      <div className={classes.paneHeader}>
        <Group gap={6} wrap="nowrap">
          <IconTerminal2 size={16} aria-hidden />
          <Text size="sm" fw={600}>
            {title}
          </Text>
        </Group>
        <PhaseStatus phase={phase} />
      </div>
      {above}
      <ScrollArea
        className={classes.fill}
        viewportRef={viewportRef}
        type="auto"
        onScrollPositionChange={() => {
          const v = viewportRef.current;
          if (v) stickToBottom.current = v.scrollHeight - v.scrollTop - v.clientHeight < 32;
        }}
      >
        <div role="log" aria-live="polite" aria-label={`${title} output`}>
          {empty ? (
            <Text size="sm" c="dimmed" px="sm" py="xs">
              {emptyMessage}
            </Text>
          ) : (
            <>
              {phase === 'loading' && loadingMessage && (
                <Group gap="xs" px="sm" pt="xs" wrap="nowrap">
                  <Loader size="xs" />
                  <Text size="sm" c="dimmed">
                    {loadingMessage}
                  </Text>
                </Group>
              )}
              {segments.length > 0 && <ConsoleText segments={segments} hidden={hidden} />}
              {waiting && <InputLine prompt={inputPrompt} onSubmit={onSubmitInput} onEnd={onEndInput} />}
              {showOutcome && (
                <div className={classes.consoleFooter}>
                  <OutcomeFooter outcome={outcome} onGoToLine={onGoToLine} />
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </Box>
  );
}
