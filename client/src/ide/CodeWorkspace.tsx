import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Kbd,
  ScrollArea,
  Splitter,
  Stack,
  Tabs,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery, type SplitterPaneSize } from '@mantine/hooks';
import { inputLines, kindSupportsInput, kindSupportsTests, type TestResult } from '@codeclass/shared';
import { IconAbc, IconChecklist, IconClearAll, IconFileText, IconLock, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BADGE_NO_SHRINK, LanguageBadge } from '../components/badges';
import { Markdown } from '../components/Markdown';
import { notifyError } from '../components/notify';
import { interactiveInputSupported, isRunnable, preloadRuntime, useCodeRunner, type OutputChunk, type RunOutcome, type RunTarget } from '../runtime';
import { CodeEditor } from './CodeEditor';
import { ConsolePanel } from './ConsolePanel';
import { cssSize } from './editorTheme';
import classes from './ide.module.css';
import { loadingMessage, summarizeTests } from './ideUtils';
import { TestsPanel } from './TestsPanel';
import type { CodeEditorHandle, CodeWorkspaceProps } from './types';
import { WebPreview } from './WebPreview';
import { WordBank } from './WordBank';

type SideTab = 'instructions' | 'tests' | 'words';
const SIDE_TABS: readonly SideTab[] = ['instructions', 'tests', 'words'];

const MOBILE_QUERY = '(max-width: 47.99em)';
const WEB_OUTPUT_LIMIT = 2000;
const PREVIEW_DEBOUNCE_MS = 600;
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

// ---------------------------------------------------------------------------
// localStorage (may be unavailable: private mode, blocked storage)
// ---------------------------------------------------------------------------

function readStored<T>(key: string | null, parse: (raw: unknown) => T | null): T | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? null : parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStored(key: string | null, value: unknown): void {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the layout just isn't remembered.
  }
}

function parseSizes(count: number) {
  return (raw: unknown): number[] | null =>
    Array.isArray(raw) && raw.length === count && raw.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)
      ? (raw as number[])
      : null;
}

function toPercents(sizes: SplitterPaneSize[]): number[] {
  return sizes.map((s) => (typeof s === 'number' ? s : parseFloat(s)));
}

/**
 * Splitter pane sizes (percentages) remembered under `key`, falling back to `defaults`. Changes from dragging,
 * the keyboard or a double-click reset are written shortly after they settle, and on unmount.
 */
function usePaneSizes(key: string | null, defaults: number[]) {
  const sizes = useMemo(() => readStored(key, parseSizes(defaults.length)) ?? defaults, [key, defaults]);
  const pending = useRef<number[] | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current);
      if (pending.current) writeStored(key, pending.current);
      pending.current = null;
    };
  }, [key]);

  const save = (next: SplitterPaneSize[]) => {
    pending.current = toPercents(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      writeStored(key, pending.current);
      pending.current = null;
    }, 300);
  };
  return [sizes, save] as const;
}

// Defaults are module constants so usePaneSizes' memo stays stable.
const SIZES = {
  sideMain: [30, 70],
  editorConsole: [66, 34],
  webSide: [24, 38, 38],
  webNoSide: [50, 50],
  previewConsole: [72, 28],
};

function ScrollPanel({ mobile, children }: { mobile: boolean; children: ReactNode }) {
  if (mobile) {
    return (
      <ScrollArea.Autosize mah="45dvh" type="auto">
        <Box p="md">{children}</Box>
      </ScrollArea.Autosize>
    );
  }
  return (
    <ScrollArea h="100%" type="auto">
      <Box p="md">{children}</Box>
    </ScrollArea>
  );
}

export function CodeWorkspace({
  language,
  code,
  onCodeChange,
  readOnly,
  instructions,
  tests = [],
  compareMode = 'trim',
  hiddenTestCount = 0,
  initialTestResults,
  onTestResults,
  toolbarRight,
  banner,
  height = 'calc(100dvh - 210px)',
  storageKey,
}: CodeWorkspaceProps) {
  const kind = language.kind;
  const isWeb = kind === 'web';
  const editable = !readOnly && onCodeChange != null;
  const isMobile = useMediaQuery(MOBILE_QUERY, false, { getInitialValueInEffect: false });

  // Pages may rebuild the language object on every render; only a real config change makes a new target.
  const pseudocodeKey = kind === 'pseudocode' ? JSON.stringify(language.pseudocode ?? null) : '';
  const target = useMemo<RunTarget>(() => ({ kind, pseudocode: language.pseudocode }), [kind, pseudocodeKey]);
  const runner = useCodeRunner(target);
  const editorRef = useRef<CodeEditorHandle>(null);

  useEffect(() => {
    if (isRunnable(target.kind)) preloadRuntime(target);
  }, [target]);

  // ----- Side panel tabs -----
  const hasInstructions = Boolean(instructions?.trim());
  const hasTestsTab = kindSupportsTests(kind) && (tests.length > 0 || hiddenTestCount > 0);
  const hasWords = kind === 'pseudocode' && language.pseudocode != null;
  const tabs = SIDE_TABS.filter((t) => (t === 'instructions' ? hasInstructions : t === 'tests' ? hasTestsTab : hasWords));
  const hasSide = tabs.length > 0;

  const tabKey = storageKey ? `${storageKey}:tab` : null;
  const parseTab = (raw: unknown) => (SIDE_TABS.includes(raw as SideTab) ? (raw as SideTab) : null);
  const [chosenTab, setChosenTab] = useState<SideTab | null>(() => readStored(tabKey, parseTab));
  useEffect(() => {
    setChosenTab(readStored(tabKey, parseTab));
  }, [tabKey]);
  const sideTab = chosenTab && tabs.includes(chosenTab) ? chosenTab : (tabs[0] ?? null);
  const selectTab = (tab: SideTab) => {
    setChosenTab(tab);
    writeStored(tabKey, tab);
  };

  // ----- Running programs -----
  const canInteract = kind === 'pseudocode' || interactiveInputSupported();
  const showStdinBox = !isWeb && kindSupportsInput(kind) && !canInteract;
  const [stdinText, setStdinText] = useState('');
  const [errorLine, setErrorLine] = useState<number | null>(null);
  // The outcome the user cleared from the console (so its footer stays hidden until the next run).
  const [clearedOutcome, setClearedOutcome] = useState<RunOutcome | null>(null);

  useEffect(() => {
    setErrorLine(runner.lastOutcome?.error?.line ?? null);
  }, [runner.lastOutcome]);

  const busy = runner.isRunning || runner.testsRunning;

  // ----- Web pages -----
  const [previewHtml, setPreviewHtml] = useState(code);
  const [reloadKey, setReloadKey] = useState(0);
  const [webOutput, setWebOutput] = useState<OutputChunk[]>([]);

  useEffect(() => {
    if (!isWeb) return;
    const timer = window.setTimeout(() => setPreviewHtml(code), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [isWeb, code]);

  // Every reload runs the page again, so earlier console messages no longer apply.
  useEffect(() => {
    setWebOutput([]);
  }, [previewHtml, reloadKey]);

  const handleWebConsole = (chunk: { stream: 'stdout' | 'stderr'; text: string }) => {
    setWebOutput((prev) => {
      if (prev.length < WEB_OUTPUT_LIMIT) return [...prev, chunk];
      if (prev[prev.length - 1]?.stream === 'system') return prev;
      return [...prev, { stream: 'system', text: 'Output limit reached — later messages are not shown.\n' }];
    });
  };

  // ----- Actions -----
  const handleRun = () => {
    if (isWeb) {
      setPreviewHtml(code);
      setReloadKey((k) => k + 1);
      return;
    }
    if (busy) return;
    setErrorLine(null);
    setClearedOutcome(null);
    void runner.run(code, showStdinBox ? inputLines(stdinText) : undefined);
  };

  const handleRunTests = async () => {
    if (busy || tests.length === 0) return;
    if (hasTestsTab) selectTab('tests');
    try {
      const results: TestResult[] = await runner.runTests(code, tests, compareMode);
      onTestResults?.(results);
    } catch (err) {
      notifyError(err, "Couldn't run the tests");
    }
  };

  const handleClear = () => {
    if (isWeb) {
      setWebOutput([]);
      return;
    }
    runner.clearOutput();
    setClearedOutcome(runner.lastOutcome);
  };

  const handleChange = (value: string) => {
    setErrorLine(null);
    onCodeChange?.(value);
  };

  const goToLine = (line: number, column?: number) => editorRef.current?.goToLine(line, column);

  const outcome = runner.lastOutcome && runner.lastOutcome !== clearedOutcome && !runner.isRunning ? runner.lastOutcome : null;
  const consoleEmpty = isWeb ? webOutput.length === 0 : runner.output.length === 0 && outcome == null;
  const testResults = runner.testResults ?? initialTestResults ?? null;
  const testSummary = summarizeTests(tests, testResults);

  // ----- Pieces -----
  const toolbar = (
    <Group justify="space-between" gap="sm" wrap="wrap" role="toolbar" aria-label="Code tools">
      <Group gap="xs" wrap="wrap">
        <LanguageBadge kind={kind} name={language.name} />
        {!editable && (
          <Badge variant="light" color="gray" leftSection={<IconLock size={12} />} {...BADGE_NO_SHRINK}>
            Read-only
          </Badge>
        )}
        {runner.isRunning ? (
          <Button color="red" variant="light" leftSection={<IconPlayerStop size={18} />} onClick={() => runner.stop()}>
            Stop
          </Button>
        ) : (
          <Button leftSection={<IconPlayerPlay size={18} />} onClick={handleRun} disabled={runner.testsRunning}>
            Run
          </Button>
        )}
        <Group gap={4} wrap="nowrap" visibleFrom="md">
          <Kbd size="xs">{MOD_KEY}</Kbd>
          <Text size="xs" c="dimmed">
            +
          </Text>
          <Kbd size="xs">Enter</Kbd>
        </Group>
        {tests.length > 0 && kindSupportsTests(kind) && (
          <Button
            variant="default"
            leftSection={<IconChecklist size={18} />}
            onClick={() => void handleRunTests()}
            loading={runner.testsRunning}
            disabled={runner.isRunning}
          >
            Run tests
          </Button>
        )}
        <Tooltip label="Clear console">
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Clear console" onClick={handleClear} disabled={consoleEmpty || busy}>
            <IconClearAll size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {toolbarRight && (
        <Group gap="sm" wrap="wrap">
          {toolbarRight}
        </Group>
      )}
    </Group>
  );

  const editor = (
    <Box className={classes.fill}>
      <CodeEditor
        ref={editorRef}
        value={code}
        onChange={editable ? handleChange : undefined}
        language={language}
        readOnly={!editable}
        errorLine={errorLine}
        onRun={handleRun}
        withBorder={false}
        ariaLabel={`${language.name} code`}
      />
    </Box>
  );

  const stdinBox = showStdinBox ? (
    <Box px="sm" pt="xs">
      <Textarea
        label="Input for your program"
        description="One answer per line, used in order each time your program asks."
        placeholder={'e.g.\nSam\n14'}
        size="xs"
        autosize
        minRows={2}
        maxRows={3}
        ff="monospace"
        value={stdinText}
        onChange={(e) => setStdinText(e.currentTarget.value)}
      />
    </Box>
  ) : null;

  const consolePanel = isWeb ? (
    <ConsolePanel
      output={webOutput}
      phase={null}
      emptyMessage="Messages from console.log() in your page show up here."
      title="Page console"
    />
  ) : (
    <ConsolePanel
      output={runner.output}
      phase={runner.phase}
      inputPrompt={runner.inputPrompt}
      onSubmitInput={(line) => runner.submitInput(line)}
      outcome={outcome}
      loadingMessage={loadingMessage(kind)}
      onGoToLine={goToLine}
      emptyMessage={`Press Run (or ${MOD_KEY} + Enter) to see what your program prints.`}
      above={stdinBox}
    />
  );

  const preview = (
    <Box className={classes.fill}>
      <WebPreview html={previewHtml} reloadKey={reloadKey} onConsole={handleWebConsole} height="100%" />
    </Box>
  );

  const panelStyle = isMobile ? undefined : { flex: 1, minHeight: 0 };
  const testsBadgeColor = testSummary ? (testSummary.passed === testSummary.total ? 'teal' : 'red') : 'gray';
  const sidePanel = hasSide ? (
    <Tabs
      value={sideTab}
      onChange={(v) => v && selectTab(v as SideTab)}
      keepMounted={false}
      h={isMobile ? undefined : '100%'}
      style={isMobile ? undefined : { display: 'flex', flexDirection: 'column' }}
    >
      <Tabs.List px="xs" style={{ flexShrink: 0 }}>
        {hasInstructions && (
          <Tabs.Tab value="instructions" leftSection={<IconFileText size={16} />}>
            Instructions
          </Tabs.Tab>
        )}
        {hasTestsTab && (
          <Tabs.Tab
            value="tests"
            leftSection={<IconChecklist size={16} />}
            rightSection={
              tests.length > 0 ? (
                <Badge size="xs" variant="light" circle color={testsBadgeColor}>
                  {tests.length}
                </Badge>
              ) : undefined
            }
          >
            Tests
          </Tabs.Tab>
        )}
        {hasWords && (
          <Tabs.Tab value="words" leftSection={<IconAbc size={16} />}>
            Words
          </Tabs.Tab>
        )}
      </Tabs.List>
      {hasInstructions && (
        <Tabs.Panel value="instructions" style={panelStyle}>
          <ScrollPanel mobile={isMobile}>
            <Markdown source={instructions ?? ''} />
          </ScrollPanel>
        </Tabs.Panel>
      )}
      {hasTestsTab && (
        <Tabs.Panel value="tests" style={panelStyle}>
          <ScrollPanel mobile={isMobile}>
            <TestsPanel
              tests={tests}
              results={testResults}
              hiddenTestCount={hiddenTestCount}
              running={runner.testsRunning}
              currentTestIndex={runner.currentTestIndex}
              canRun={!runner.isRunning}
              onRunTests={() => void handleRunTests()}
            />
          </ScrollPanel>
        </Tabs.Panel>
      )}
      {hasWords && language.pseudocode && (
        <Tabs.Panel value="words" style={panelStyle}>
          <ScrollPanel mobile={isMobile}>
            <WordBank config={language.pseudocode} compact />
          </ScrollPanel>
        </Tabs.Panel>
      )}
    </Tabs>
  ) : null;

  const structure = `${isWeb ? 'web' : 'code'}:${hasSide ? 'side' : 'full'}`;
  const layoutKey = storageKey ? `${storageKey}:layout:${structure}` : null;

  return (
    <Box className={classes.workspace} style={isMobile ? undefined : { height: cssSize(height), minHeight: 520 }}>
      {banner}
      {toolbar}
      {isMobile ? (
        <Stack gap="sm">
          {sidePanel && <Box className={classes.stack}>{sidePanel}</Box>}
          <Box className={`${classes.stack} ${classes.column}`} h="max(320px, 55dvh)">
            {editor}
          </Box>
          {isWeb && (
            <Box className={`${classes.stack} ${classes.column}`} h="max(320px, 50dvh)">
              {preview}
            </Box>
          )}
          <Box className={`${classes.stack} ${classes.column}`} h={isWeb ? 'max(180px, 25dvh)' : 'max(240px, 35dvh)'}>
            {consolePanel}
          </Box>
        </Stack>
      ) : (
        <Box className={classes.body}>
          <DesktopLayout
            key={layoutKey ?? structure}
            storageKey={layoutKey}
            isWeb={isWeb}
            side={sidePanel}
            editor={editor}
            console={consolePanel}
            preview={preview}
          />
        </Box>
      )}
    </Box>
  );
}

interface DesktopLayoutProps {
  storageKey: string | null;
  isWeb: boolean;
  side: ReactNode;
  editor: ReactNode;
  console: ReactNode;
  preview: ReactNode;
}

/** Resizable panels: [side] | editor over console, or for web pages [side] | editor | preview over console. */
function DesktopLayout({ storageKey, isWeb, side, editor, console, preview }: DesktopLayoutProps) {
  const key = (part: string) => (storageKey ? `${storageKey}:${part}` : null);
  const hasSide = side != null;
  const [outer, saveOuter] = usePaneSizes(key('outer'), isWeb ? (hasSide ? SIZES.webSide : SIZES.webNoSide) : SIZES.sideMain);
  const [inner, saveInner] = usePaneSizes(key('inner'), isWeb ? SIZES.previewConsole : SIZES.editorConsole);

  const sidePane = hasSide ? (
    <Splitter.Pane defaultSize={outer[0]!} min={15} max={55} className={classes.column}>
      {side}
    </Splitter.Pane>
  ) : null;

  if (isWeb) {
    const offset = hasSide ? 1 : 0;
    return (
      <Splitter h="100%" onSizeChange={saveOuter}>
        {sidePane}
        <Splitter.Pane defaultSize={outer[offset]!} min={20} className={classes.column}>
          {editor}
        </Splitter.Pane>
        <Splitter.Pane defaultSize={outer[offset + 1]!} min={20} className={classes.column}>
          <Splitter orientation="vertical" h="100%" onSizeChange={saveInner}>
            <Splitter.Pane defaultSize={inner[0]!} min={20} className={classes.column}>
              {preview}
            </Splitter.Pane>
            <Splitter.Pane defaultSize={inner[1]!} min={10} className={classes.column}>
              {console}
            </Splitter.Pane>
          </Splitter>
        </Splitter.Pane>
      </Splitter>
    );
  }

  const editorAndConsole = (
    <Splitter orientation="vertical" h="100%" onSizeChange={saveInner}>
      <Splitter.Pane defaultSize={inner[0]!} min={20} className={classes.column}>
        {editor}
      </Splitter.Pane>
      <Splitter.Pane defaultSize={inner[1]!} min={10} className={classes.column}>
        {console}
      </Splitter.Pane>
    </Splitter>
  );

  if (!hasSide) return editorAndConsole;

  return (
    <Splitter h="100%" onSizeChange={saveOuter}>
      {sidePane}
      <Splitter.Pane defaultSize={outer[1]!} min={35} className={classes.column}>
        {editorAndConsole}
      </Splitter.Pane>
    </Splitter>
  );
}
