// Public props of the IDE components. Pages import components from './index' only.

import type { CompareMode, Language, PseudocodeConfig, TestCase, TestResult } from '@codeclass/shared';
import type { ReactNode } from 'react';

export interface CodeEditorProps {
  value: string;
  /** Omit (or set readOnly) for a read-only viewer. */
  onChange?: (value: string) => void;
  language: Pick<Language, 'kind' | 'pseudocode'>;
  readOnly?: boolean;
  /** CSS height. Default '100%' (fills the parent, which must have a height). */
  height?: string | number;
  /** Used when height is 'auto' (e.g. starter-code field in a form). */
  minHeight?: string | number;
  maxHeight?: string | number;
  /** Highlights a line (e.g. the line of the last runtime error). */
  errorLine?: number | null;
  /** Ctrl/Cmd+Enter. */
  onRun?: () => void;
  autoFocus?: boolean;
  ariaLabel?: string;
  /** Font size in px (default 14). */
  fontSize?: number;
}

export interface CodeWorkspaceProps {
  language: Language;
  code: string;
  /** Omit for read-only (e.g. a submitted assignment, or the teacher viewing student work). */
  onCodeChange?: (code: string) => void;
  readOnly?: boolean;
  /** Markdown shown in the "Instructions" side tab. */
  instructions?: string;
  /** Tests the user may run from the "Tests" tab. */
  tests?: TestCase[];
  compareMode?: CompareMode;
  /** Shown as "+ N hidden tests your teacher will run". */
  hiddenTestCount?: number;
  /** Results to show before the user runs tests (e.g. stored with the submission). */
  initialTestResults?: TestResult[] | null;
  /** Fires after the user runs tests in the workspace. */
  onTestResults?: (results: TestResult[]) => void;
  /** Controls at the right end of the toolbar (save status, Submit…). */
  toolbarRight?: ReactNode;
  /** Optional node rendered above the editor area (e.g. teacher feedback alert). */
  banner?: ReactNode;
  /** CSS height of the whole workspace. Default 'calc(100dvh - 210px)' with a 520px minimum. */
  height?: string | number;
  /** Persist panel layout/tab per page in localStorage under this key. */
  storageKey?: string;
}

export interface WordBankProps {
  config: PseudocodeConfig;
  /** Show constructs the class hasn't learned yet (greyed out with a lock). Default true. */
  showLocked?: boolean;
  /** Tighter layout for side panels. */
  compact?: boolean;
}

export interface WebPreviewProps {
  /** Full HTML document written by the student. */
  html: string;
  /** Change to force a reload of the preview. */
  reloadKey?: number;
  /** console.log / errors from inside the page. */
  onConsole?: (chunk: { stream: 'stdout' | 'stderr'; text: string }) => void;
  height?: string | number;
}
