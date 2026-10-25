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
import {
  IconAbc,
  IconArrowBackUp,
  IconBrowser,
  IconBulb,
  IconChecklist,
  IconClearAll,
  IconFileText,
  IconLock,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BADGE_NO_SHRINK, LanguageBadge } from '../components/badges';
import { Markdown } from '../components/Markdown';
import { notifyError } from '../components/notify';
import { interactiveInputSupported, isRunnable, preloadRuntime, useCodeRunner, type OutputChunk, type RunOutcome, type RunTarget } from '../runtime';
import { CodeEditor } from './CodeEditor';
import { ConsolePanel } from './ConsolePanel';
import { cssSize } from './editorTheme';
import classes from './ide.module.css';
import {
  loadingMessage,
  parseSideTab,
  resolveSideTab,
  SIDE_TABS,
  solutionContent,
  summarizeTests,
  testsBadgeColor,
  type SideTab,
} from './ideUtils';
import { SolutionPanel } from './SolutionPanel';
import { TestsPanel } from './TestsPanel';
import type { CodeEditorHandle, CodeWorkspaceProps } from './types';
import { useFitLevel } from './useFitLevel';
import { WebPreview } from './WebPreview';
import { pageHasScripts } from './webPreviewDocument';
import { WordBank } from './WordBank';

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
  solutionCode,
  solutionNote,
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
  const solution = solutionContent(solutionCode, solutionNote);
  const solutionText = solution && 'code' in solution ? solution.code : null;
  const available: Record<SideTab, boolean> = {
    instructions: hasInstructions,
    tests: hasTestsTab,
    words: hasWords,
    solution: solution != null,
  };
  const tabs = SIDE_TABS.filter((t) => available[t]);
  const hasSide = tabs.length > 0;

  const tabKey = storageKey ? `${storageKey}:tab` : null;
  const [chosenTab, setChosenTab] = useState<SideTab | null>(() => readStored(tabKey, parseSideTab));
  useEffect(() => {
    setChosenTab(readStored(tabKey, parseSideTab));
  }, [tabKey]);
  // A remembered tab the panel no longer has (say, a solution that was hidden again) falls back to the first one.
  const sideTab = resolveSideTab(chosenTab, tabs);
  const selectTab = (tab: SideTab) => {
    setChosenTab(tab);
    writeStored(tabKey, tab);
  };

  // ----- Running programs -----
  const canInteract = kind === 'pseudocode' || interactiveInputSupported();
  const showStdinBox = !isWeb && kindSupportsInput(kind) && !canInteract;
  const [stdinText, setStdinText] = useState('');
  const [errorLine, setErrorLine] = useState<number | null>(null);
  // Whether the last program run was the solution (its error line then belongs to the solution's editor).
  const [ranSolution, setRanSolution] = useState(false);
  const solutionEditorRef = useRef<CodeEditorHandle>(null);
  const [solutionLineRequest, setSolutionLineRequest] = useState<{ line: number; column?: number } | null>(null);
  // The outcome the user cleared from the console (so its footer stays hidden until the next run).
  const [clearedOutcome, setClearedOutcome] = useState<RunOutcome | null>(null);

  useEffect(() => {
    setErrorLine(runner.lastOutcome?.error?.line ?? null);
  }, [runner.lastOutcome]);

  const busy = runner.isRunning || runner.testsRunning;

  // ----- Web pages -----
  const [previewHtml, setPreviewHtml] = useState(code);
  // The preview shows the solution page (from Run solution) until the editor's page is shown again.
  const [previewingSolution, setPreviewingSolution] = useState(false);
  const showPreview = (html: string, isSolution = false) => {
    setPreviewHtml(html);
    setPreviewingSolution(isSolution);
  };
  const [reloadKey, setReloadKey] = useState(0);
  const [webOutput, setWebOutput] = useState<OutputChunk[]>([]);
  // Plain HTML/CSS updates as you type. A page with scripts only updates on Run, so half-typed code (say, a `while`
  // loop whose body isn't written yet) never runs by itself; its inline scripts are loop-protected as well.
  const runsScripts = useMemo(() => isWeb && pageHasScripts(code), [isWeb, code]);
  // What was last typed in this editor; any other new `code` was loaded or replaced by the page and shows at once.
  const typedCode = useRef<string | null>(null);

  useEffect(() => {
    if (!isWeb) return;
    if (code !== typedCode.current) {
      showPreview(code);
      return;
    }
    if (runsScripts) return;
    const timer = window.setTimeout(() => showPreview(code), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [isWeb, code, runsScripts]);
  const previewStale = runsScripts && !previewingSolution && previewHtml !== code;

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
  /** Runs `program` in the console (web: shows it in the preview), with the Input box's lines when there is one. */
  const runProgram = (program: string, isSolution: boolean) => {
    if (isWeb) {
      showPreview(program, isSolution);
      setReloadKey((k) => k + 1);
      return;
    }
    if (busy) return;
    setErrorLine(null);
    setClearedOutcome(null);
    setRanSolution(isSolution);
    void runner.run(program, showStdinBox ? inputLines(stdinText) : undefined);
  };

  const handleRun = () => runProgram(code, false);

  const handleRunSolution = () => {
    if (solutionText != null) runProgram(solutionText, true);
  };

  const handleRunTests = async () => {
    if (busy || tests.length === 0) return;
    if (hasTestsTab) selectTab('tests');
    try {
      const results: TestResult[] = await runner.runTests(code, tests, compareMode);
      // Stopped part-way: the panel shows what ran, but incomplete results aren't reported to the page.
      if (results.length === tests.length) onTestResults?.(results);
    } catch (err) {
      notifyError(err, "Couldn't run the tests");
    }
  };

  // Stops the program or the test run, whichever is going.
  const handleStop = () => runner.stop();

  const handleClear = () => {
    if (isWeb) {
      setWebOutput([]);
      return;
    }
    runner.clearOutput();
    setClearedOutcome(runner.lastOutcome);
  };

  const handleChange = (value: string) => {
    if (!ranSolution) setErrorLine(null);
    typedCode.current = value;
    onCodeChange?.(value);
  };

  const goToLine = (line: number, column?: number) => editorRef.current?.goToLine(line, column);

  // An error in the solution: open the Solution tab, then move its editor to the line once it is mounted.
  const goToSolutionLine = (line: number, column?: number) => {
    selectTab('solution');
    setSolutionLineRequest({ line, column });
  };
  useEffect(() => {
    if (!solutionLineRequest || sideTab !== 'solution') return;
    solutionEditorRef.current?.goToLine(solutionLineRequest.line, solutionLineRequest.column);
    setSolutionLineRequest(null);
  }, [solutionLineRequest, sideTab]);

  const outcome = runner.lastOutcome && runner.lastOutcome !== clearedOutcome && !runner.isRunning ? runner.lastOutcome : null;
  const consoleEmpty = isWeb ? webOutput.length === 0 : runner.output.length === 0 && outcome == null;
  // This session's test run (even part-way), else the stored results — also when a run was stopped before any finished.
  const testResults =
    runner.testsRunning || (runner.testResults?.length ?? 0) > 0 ? runner.testResults : (initialTestResults ?? null);
  const testSummary = summarizeTests(tests, testResults);

  // ----- Pieces -----
  // The toolbar stays on one line by dropping the shortcut hint (level 1), then showing Run tests as an icon
  // (level 2); only at level 3 does it wrap.
  const toolbarFit = useFitLevel<HTMLDivElement>(3);
  const showKbdHint = toolbarFit.level === 0;
  const toolbarWrap = toolbarFit.level < 3 ? 'nowrap' : 'wrap';
  const canRunTests = tests.length > 0 && kindSupportsTests(kind);

  const toolbar = (
    <Group
      ref={toolbarFit.ref}
      justify="space-between"
      gap="sm"
      wrap={toolbarWrap}
      className={toolbarWrap === 'nowrap' ? classes.noShrink : undefined}
      role="toolbar"
      aria-label="Code tools"
    >
      <Group gap="xs" wrap={toolbarWrap}>
        <LanguageBadge kind={kind} name={language.name} />
        {!editable && (
          <Badge variant="light" color="gray" leftSection={<IconLock size={12} />} {...BADGE_NO_SHRINK}>
            Read-only
          </Badge>
        )}
        {busy ? (
          <Button color="red" variant="light" leftSection={<IconPlayerStop size={18} />} onClick={handleStop}>
            Stop
          </Button>
        ) : (
          <Tooltip label={`Run (${MOD_KEY} + Enter)`} disabled={showKbdHint}>
            <Button leftSection={<IconPlayerPlay size={18} />} onClick={handleRun}>
              Run
            </Button>
          </Tooltip>
        )}
        {showKbdHint && (
          <Group gap={4} wrap="nowrap" visibleFrom="md">
            <Kbd size="xs">{MOD_KEY}</Kbd>
            <Text size="xs" c="dimmed">
              +
            </Text>
            <Kbd size="xs">Enter</Kbd>
          </Group>
        )}
        {canRunTests &&
          (toolbarFit.level >= 2 ? (
            <Tooltip label="Run tests">
              <ActionIcon
                variant="default"
                size="input-sm"
                aria-label="Run tests"
                onClick={() => void handleRunTests()}
                loading={runner.testsRunning}
                disabled={runner.isRunning}
              >
                <IconChecklist size={18} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Button
              variant="default"
              leftSection={<IconChecklist size={18} />}
              onClick={() => void handleRunTests()}
              loading={runner.testsRunning}
              disabled={runner.isRunning}
            >
              Run tests
            </Button>
          ))}
        <Tooltip label="Clear console">
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Clear console" onClick={handleClear} disabled={consoleEmpty || busy}>
            <IconClearAll size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {toolbarRight && (
        <Group gap="sm" wrap={toolbarWrap}>
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
        errorLine={ranSolution ? null : errorLine}
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
      onEndInput={() => runner.endInput()}
      outcome={outcome}
      loadingMessage={loadingMessage(kind)}
      onGoToLine={!ranSolution ? goToLine : solutionText != null ? goToSolutionLine : undefined}
      emptyMessage={`Press Run (or ${MOD_KEY} + Enter) to see what your program prints.`}
      above={stdinBox}
    />
  );

  const preview = (
    <Box className={`${classes.column} ${classes.fill}`}>
      <div className={classes.paneHeader}>
        <Group gap={6} wrap="nowrap">
          {previewingSolution ? <IconBulb size={16} aria-hidden /> : <IconBrowser size={16} aria-hidden />}
          <Text size="sm" fw={600}>
            {previewingSolution ? 'Solution' : 'Page'}
          </Text>
        </Group>
        {previewingSolution ? (
          <Button size="compact-xs" variant="light" leftSection={<IconArrowBackUp size={14} />} onClick={handleRun}>
            Back to page
          </Button>
        ) : previewStale ? (
          <Tooltip label={`Pages with scripts update when you press Run (${MOD_KEY} + Enter)`} multiline maw={260}>
            <Button size="compact-xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={handleRun}>
              Show changes
            </Button>
          </Tooltip>
        ) : (
          <Text size="xs" c="dimmed" truncate style={{ minWidth: 0 }}>
            {runsScripts ? 'Updates when you press Run' : 'Updates as you type'}
          </Text>
        )}
      </div>
      <Box className={classes.fill}>
        <WebPreview html={previewHtml} reloadKey={reloadKey} onConsole={handleWebConsole} height="100%" />
      </Box>
    </Box>
  );

  const panelStyle = isMobile ? undefined : { flex: 1, minHeight: 0 };
  // Side tabs fit on one line by showing only their icons when the panel is narrow.
  const tabsFit = useFitLevel<HTMLDivElement>(1);
  const iconTabs = tabsFit.level > 0;
  // Icon tabs drop the count badge (it moves into the tooltip and label) so up to four fit a narrow panel.
  const sideTabButton = (value: SideTab, label: string, icon: ReactNode, right?: ReactNode, ariaLabel = label) => (
    <Tooltip key={value} label={ariaLabel} disabled={!iconTabs}>
      <Tabs.Tab
        value={value}
        leftSection={icon}
        rightSection={iconTabs ? undefined : right}
        aria-label={iconTabs ? ariaLabel : undefined}
        px={iconTabs ? 6 : undefined}
      >
        {iconTabs ? null : label}
      </Tabs.Tab>
    </Tooltip>
  );
  const sidePanel = hasSide ? (
    <Tabs
      value={sideTab}
      onChange={(v) => v && selectTab(v as SideTab)}
      keepMounted={false}
      h={isMobile ? undefined : '100%'}
      style={isMobile ? undefined : { display: 'flex', flexDirection: 'column' }}
    >
      <Tabs.List
        ref={tabsFit.ref}
        px="xs"
        grow={iconTabs}
        className={iconTabs ? undefined : classes.noShrink}
        style={{ flexShrink: 0, flexWrap: 'nowrap', overflowX: iconTabs ? 'auto' : undefined }}
      >
        {hasInstructions && sideTabButton('instructions', 'Instructions', <IconFileText size={16} />)}
        {hasTestsTab &&
          sideTabButton(
            'tests',
            'Tests',
            <IconChecklist size={16} />,
            tests.length > 0 ? (
              <Badge size="xs" variant="light" circle color={testsBadgeColor(testSummary)}>
                {tests.length}
              </Badge>
            ) : undefined,
            tests.length > 0 ? `Tests (${tests.length})` : 'Tests',
          )}
        {hasWords && sideTabButton('words', 'Words', <IconAbc size={16} />)}
        {solution && sideTabButton('solution', 'Solution', <IconBulb size={16} />)}
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
              onStop={handleStop}
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
      {solution && (
        <Tabs.Panel value="solution" style={panelStyle}>
          <SolutionPanel
            content={solution}
            language={language}
            mobile={isMobile}
            running={ranSolution && runner.isRunning}
            canRun={!busy}
            onRun={handleRunSolution}
            onStop={handleStop}
            errorLine={ranSolution ? errorLine : null}
            editorRef={solutionEditorRef}
          />
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
