// CodeMirror themes built only from Mantine CSS variables, so the editor follows the app's light/dark scheme.

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Tag, tags as t } from '@lezer/highlight';

/** Keywords of pseudocode constructs the class hasn't learned yet (struck through and dimmed). */
export const lockedKeywordTag = Tag.define(t.keyword);

type Scheme = 'light' | 'dark';

/** Picks the light or dark shade of a Mantine palette color. */
function shade(scheme: Scheme, color: string, light: number, dark: number): string {
  return `var(--mantine-color-${color}-${scheme === 'light' ? light : dark})`;
}

function chrome(scheme: Scheme): Extension {
  const dark = scheme === 'dark';
  const subtleBg = dark ? 'var(--mantine-color-dark-6)' : 'var(--mantine-color-gray-0)';
  const border = 'var(--mantine-color-default-border)';
  const selection = 'color-mix(in srgb, var(--mantine-color-blue-filled) 28%, transparent)';

  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--mantine-color-body)',
        color: 'var(--mantine-color-text)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: 'var(--mantine-font-family-monospace)',
        lineHeight: '1.6',
      },
      '.cm-content': { caretColor: 'var(--mantine-color-text)', padding: '6px 0' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--mantine-color-text)', borderLeftWidth: '2px' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: selection },
      '.cm-gutters': {
        backgroundColor: subtleBg,
        color: 'var(--mantine-color-dimmed)',
        borderRight: `1px solid ${border}`,
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '32px' },
      '.cm-activeLine': {
        backgroundColor: dark ? 'color-mix(in srgb, var(--mantine-color-dark-5) 35%, transparent)' : 'var(--mantine-color-gray-0)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: dark ? 'var(--mantine-color-dark-5)' : 'var(--mantine-color-gray-2)',
        color: 'var(--mantine-color-text)',
      },
      '.cm-errorLine': { backgroundColor: 'var(--mantine-color-red-light)' },
      '.cm-errorLineGutter': {
        backgroundColor: 'var(--mantine-color-red-light-hover)',
        color: 'var(--mantine-color-red-text)',
        fontWeight: '700',
      },
      '&.cm-focused .cm-matchingBracket': {
        backgroundColor: 'var(--mantine-primary-color-light-hover)',
        outline: '1px solid var(--mantine-primary-color-filled)',
      },
      '&.cm-focused .cm-nonmatchingBracket': {
        backgroundColor: 'var(--mantine-color-red-light)',
        outline: '1px solid var(--mantine-color-red-filled)',
      },
      '.cm-selectionMatch': { backgroundColor: 'var(--mantine-color-yellow-light)' },
      '.cm-searchMatch': {
        backgroundColor: 'var(--mantine-color-yellow-light-hover)',
        outline: '1px solid var(--mantine-color-yellow-outline)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--mantine-color-orange-light-hover)' },
      '.cm-foldPlaceholder': { backgroundColor: subtleBg, border: `1px solid ${border}`, color: 'var(--mantine-color-dimmed)' },

      // Panels (search) and their form controls.
      '.cm-panels': { backgroundColor: subtleBg, color: 'var(--mantine-color-text)' },
      '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${border}` },
      '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${border}` },
      '.cm-panel.cm-search': { fontFamily: 'var(--mantine-font-family)', fontSize: 'var(--mantine-font-size-sm)', padding: '6px 8px' },
      '.cm-panel.cm-search label': { fontSize: 'var(--mantine-font-size-xs)' },
      '.cm-panel.cm-search [name=close]': { color: 'var(--mantine-color-dimmed)', fontSize: '18px', right: '8px' },
      '.cm-textfield': {
        backgroundColor: 'var(--mantine-color-body)',
        color: 'var(--mantine-color-text)',
        border: `1px solid ${border}`,
        borderRadius: 'var(--mantine-radius-sm)',
        padding: '2px 6px',
      },
      '.cm-textfield:focus': { outline: '2px solid var(--mantine-primary-color-filled)', outlineOffset: '-1px' },
      '.cm-button': {
        backgroundImage: 'none',
        backgroundColor: 'var(--mantine-color-default)',
        color: 'var(--mantine-color-default-color)',
        border: `1px solid ${border}`,
        borderRadius: 'var(--mantine-radius-sm)',
        padding: '2px 8px',
      },
      '.cm-button:hover': { backgroundColor: 'var(--mantine-color-default-hover)' },
      '.cm-button:focus-visible': { outline: '2px solid var(--mantine-primary-color-filled)', outlineOffset: '1px' },

      // Tooltips: autocomplete, lint messages.
      '.cm-tooltip': {
        backgroundColor: 'var(--mantine-color-body)',
        color: 'var(--mantine-color-text)',
        border: `1px solid ${border}`,
        borderRadius: 'var(--mantine-radius-sm)',
        boxShadow: 'var(--mantine-shadow-md)',
        overflow: 'hidden',
      },
      '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--mantine-font-family-monospace)' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px !important' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--mantine-primary-color-filled)',
        color: 'var(--mantine-color-white)',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': { color: 'inherit' },
      '.cm-completionDetail': { color: 'var(--mantine-color-dimmed)', fontStyle: 'normal', marginLeft: '8px' },
      '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
      '.cm-completionInfo': {
        fontFamily: 'var(--mantine-font-family)',
        fontSize: 'var(--mantine-font-size-sm)',
        padding: '6px 10px',
        maxWidth: '320px',
      },
      '.cm-tooltip.cm-completionInfo': { backgroundColor: 'var(--mantine-color-body)' },
      '.cm-diagnostic': { fontFamily: 'var(--mantine-font-family)', fontSize: 'var(--mantine-font-size-sm)', padding: '6px 10px' },
      '.cm-diagnostic-error': { borderLeft: '4px solid var(--mantine-color-red-filled)' },
      '.cm-diagnostic-warning': { borderLeft: '4px solid var(--mantine-color-yellow-filled)' },
      '.cm-diagnostic-info': { borderLeft: '4px solid var(--mantine-color-blue-filled)' },
      '.cm-lintRange-error': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy var(--mantine-color-red-filled)',
        textUnderlineOffset: '3px',
      },
      '.cm-lintRange-warning': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy var(--mantine-color-yellow-filled)',
        textUnderlineOffset: '3px',
      },
      '.cm-lint-marker': { width: '0.9em', height: '0.9em' },
      '.cm-panel.cm-panel-lint ul [aria-selected]': { backgroundColor: 'var(--mantine-primary-color-light)' },
    },
    { dark },
  );
}

function highlighting(scheme: Scheme): Extension {
  const c = (color: string) => shade(scheme, color, 8, 4);
  const style = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.modifier], color: c('violet'), fontWeight: '600' },
    { tag: lockedKeywordTag, color: 'var(--mantine-color-dimmed)', textDecoration: 'line-through', fontWeight: '400' },
    { tag: [t.operatorKeyword], color: c('violet'), fontWeight: '600' },
    { tag: [t.string, t.special(t.string), t.regexp], color: c('green') },
    { tag: [t.number, t.bool, t.null, t.atom, t.constant(t.variableName)], color: c('orange') },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--mantine-color-dimmed)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: c('blue') },
    { tag: [t.standard(t.variableName), t.standard(t.function(t.variableName))], color: c('cyan') },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: 'var(--mantine-color-text)' },
    { tag: [t.typeName, t.className, t.namespace], color: c('cyan') },
    { tag: [t.propertyName, t.attributeName], color: c('indigo') },
    { tag: [t.attributeValue], color: c('green') },
    { tag: [t.tagName, t.angleBracket], color: c('grape') },
    { tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator, t.definitionOperator], color: c('pink') },
    { tag: [t.self, t.special(t.variableName)], color: c('violet') },
    { tag: [t.meta, t.processingInstruction, t.documentMeta], color: 'var(--mantine-color-dimmed)' },
    { tag: [t.heading], fontWeight: '700' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.strong], fontWeight: '700' },
    { tag: [t.link, t.url], color: c('blue'), textDecoration: 'underline' },
    { tag: [t.invalid], color: 'var(--mantine-color-red-text)' },
  ]);
  return syntaxHighlighting(style);
}

const themes: Record<Scheme, Extension> = {
  light: [chrome('light'), highlighting('light')],
  dark: [chrome('dark'), highlighting('dark')],
};

export function editorTheme(scheme: Scheme): Extension {
  return themes[scheme];
}

function cssSize(value: string | number | undefined): string | undefined {
  if (value == null) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

/**
 * Font size and sizing rules. A fixed height (the default '100%') makes the editor fill its wrapper;
 * 'auto' grows with the content between minHeight and maxHeight.
 */
export function sizeTheme(options: {
  fontSize: number;
  height: string | number;
  minHeight?: string | number;
  maxHeight?: string | number;
}): Extension {
  const auto = options.height === 'auto';
  return EditorView.theme({
    '&': {
      fontSize: `${options.fontSize}px`,
      height: auto ? 'auto' : '100%',
      maxHeight: auto ? (cssSize(options.maxHeight) ?? 'none') : 'none',
    },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-content, .cm-gutter': { minHeight: auto ? (cssSize(options.minHeight) ?? '120px') : '0' },
  });
}

export { cssSize };
