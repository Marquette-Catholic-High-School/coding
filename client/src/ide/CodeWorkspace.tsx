// STUB — replaced by the full IDE layout.
import { Stack } from '@mantine/core';
import { CodeEditor } from './CodeEditor';
import type { CodeWorkspaceProps } from './types';

export function CodeWorkspace({ language, code, onCodeChange, readOnly, toolbarRight, banner }: CodeWorkspaceProps) {
  return (
    <Stack>
      {banner}
      {toolbarRight}
      <CodeEditor value={code} onChange={onCodeChange} language={language} readOnly={readOnly} />
    </Stack>
  );
}
