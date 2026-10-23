// STUB — replaced by the CodeMirror implementation.
import { Textarea } from '@mantine/core';
import type { CodeEditorProps } from './types';

export function CodeEditor({ value, onChange, readOnly, ariaLabel }: CodeEditorProps) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange?.(e.currentTarget.value)}
      readOnly={readOnly || !onChange}
      aria-label={ariaLabel ?? 'Code editor'}
      ff="monospace"
      autosize
      minRows={10}
    />
  );
}
