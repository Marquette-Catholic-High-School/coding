import { Typography } from '@mantine/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

/** Renders teacher-written Markdown (sanitized) with Mantine typography styles. */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true, breaks: true })), [source]);
  return (
    <Typography>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </Typography>
  );
}
