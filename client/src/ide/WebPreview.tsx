// STUB — replaced by the sandboxed iframe preview.
import type { WebPreviewProps } from './types';

export function WebPreview({ html, height = 400 }: WebPreviewProps) {
  return <iframe title="Preview" sandbox="allow-scripts" srcDoc={html} style={{ width: '100%', height, border: 0 }} />;
}
