import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  dropCursor,
  gutterLineClass,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { Box, VisuallyHidden, useComputedColorScheme } from '@mantine/core';
import { useId } from '@mantine/hooks';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cssSize, editorTheme, sizeTheme } from './editorTheme';
import classes from './ide.module.css';
import { languageSupport } from './languages';
import type { CodeEditorProps } from './types';

/** Marks transactions that apply a new `value` from props, so they don't echo back through onChange. */
const externalChange = Annotation.define<boolean>();

const setErrorLine = StateEffect.define<number | null>();

const errorLineDecoration = Decoration.line({ class: 'cm-errorLine' });

class ErrorGutterMarker extends GutterMarker {
  elementClass = 'cm-errorLineGutter';
}
const errorGutterMarker = new ErrorGutterMarker();

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setErrorLine)) continue;
      const n = effect.value;
      next = n != null && n >= 1 && n <= tr.state.doc.lines ? Decoration.set([errorLineDecoration.range(tr.state.doc.line(n).from)]) : Decoration.none;
    }
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    gutterLineClass.from(field, (decorations) => {
      const markers: Range<GutterMarker>[] = [];
      decorations.between(0, Number.MAX_SAFE_INTEGER, (from) => {
        markers.push(errorGutterMarker.range(from));
      });
      return RangeSet.of(markers);
    }),
  ],
});

/** The smallest single replacement that turns `a` into `b`, so a prop update keeps the cursor where it was. */
function minimalChange(a: string, b: string): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

function accessibility(readOnly: boolean, label: string, describedBy: string): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.contentAttributes.of({
      'aria-label': label,
      'aria-describedby': describedBy,
      'aria-readonly': String(readOnly),
      'aria-multiline': 'true',
    }),
  ];
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly,
  height = '100%',
  minHeight,
  maxHeight,
  errorLine,
  onRun,
  autoFocus,
  ariaLabel,
  fontSize = 14,
  withBorder = true,
  ref,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [compartments] = useState(createCompartments);
  const hintId = useId();

  const scheme = useComputedColorScheme('light', { getInitialValueInEffect: false });
  const isReadOnly = Boolean(readOnly) || !onChange;
  const label = ariaLabel ?? 'Code editor';

  // Pseudocode configs are often rebuilt with the same content; only reconfigure when the content changes.
  const configKey = language.kind === 'pseudocode' ? JSON.stringify(language.pseudocode ?? null) : '';
  const languageExtension = useMemo(
    () => languageSupport(language.kind, language.pseudocode),
    [language.kind, configKey],
  );
  const sizeExtension = useMemo(
    () => sizeTheme({ fontSize, height, minHeight, maxHeight }),
    [fontSize, height, minHeight, maxHeight],
  );
  const accessExtension = useMemo(() => accessibility(isReadOnly, label, hintId), [isReadOnly, label, hintId]);

  // Latest props for callbacks and for (re)creating the view without listing them as effect dependencies.
  const latest = useRef({ value, onChange, onRun, autoFocus, scheme, languageExtension, sizeExtension, accessExtension });
  // Declared before the view is created, so creation sees the current props.
  useLayoutEffect(() => {
    latest.current = { value, onChange, onRun, autoFocus, scheme, languageExtension, sizeExtension, accessExtension };
  });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const initial = latest.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          EditorState.tabSize.of(4),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          errorLineField,
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                preventDefault: true,
                run: () => {
                  const run = latest.current.onRun;
                  if (!run) return false;
                  run();
                  return true;
                },
              },
            ]),
          ),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.every((tr) => tr.annotation(externalChange))) return;
            latest.current.onChange?.(update.state.doc.toString());
          }),
          compartments.language.of(initial.languageExtension),
          compartments.theme.of(editorTheme(initial.scheme)),
          compartments.size.of(initial.sizeExtension),
          compartments.access.of(initial.accessExtension),
        ],
      }),
    });
    viewRef.current = view;
    if (initial.autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: minimalChange(current, value), annotations: externalChange.of(true) });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.language.reconfigure(languageExtension) });
  }, [compartments, languageExtension]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.theme.reconfigure(editorTheme(scheme)) });
  }, [compartments, scheme]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.size.reconfigure(sizeExtension) });
  }, [compartments, sizeExtension]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.access.reconfigure(accessExtension) });
  }, [compartments, accessExtension]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setErrorLine.of(errorLine ?? null) });
  }, [errorLine]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      goToLine(line: number, column?: number) {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        const target = doc.line(Math.min(Math.max(1, Math.round(line)), doc.lines));
        const pos = Math.min(target.from + Math.max(0, (column ?? 1) - 1), target.to);
        view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
        view.focus();
      },
    }),
    [],
  );

  const auto = height === 'auto';
  return (
    <Box
      className={classes.editor}
      mod={{ 'with-border': withBorder, fill: !auto && height === '100%' }}
      style={auto || height === '100%' ? undefined : { height: cssSize(height) }}
    >
      <div ref={hostRef} style={auto ? undefined : { height: '100%' }} />
      <VisuallyHidden id={hintId}>
        {isReadOnly ? 'Read-only. ' : ''}Press Escape then Tab to move focus out of the editor.
        {onRun ? ' Press Control or Command plus Enter to run your code.' : ''}
      </VisuallyHidden>
    </Box>
  );
}

function createCompartments() {
  return { language: new Compartment(), theme: new Compartment(), size: new Compartment(), access: new Compartment() };
}
