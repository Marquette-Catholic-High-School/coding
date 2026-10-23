import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cssSize } from './editorTheme';
import classes from './ide.module.css';
import type { WebPreviewProps } from './types';
import { buildPreviewDocument, createChannelId, readPreviewMessage } from './webPreviewDocument';

/**
 * Renders a student's web page in a sandboxed iframe. No `allow-same-origin`: the page runs in an opaque origin
 * and can't reach the app's cookies, storage or DOM. Console output comes back through postMessage.
 */
export function WebPreview({ html, reloadKey = 0, onConsole, height = 400 }: WebPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(createChannelId);
  const onConsoleRef = useRef(onConsole);
  useLayoutEffect(() => {
    onConsoleRef.current = onConsole;
  });

  const srcDoc = useMemo(() => buildPreviewDocument(html, channel), [html, channel]);

  useEffect(() => {
    function handle(event: MessageEvent) {
      const frame = iframeRef.current?.contentWindow;
      if (!frame || event.source !== frame) return;
      const msg = readPreviewMessage(event.data, channel);
      if (msg) onConsoleRef.current?.(msg);
    }
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [channel]);

  return (
    <iframe
      key={reloadKey}
      ref={iframeRef}
      title="Web page preview"
      sandbox="allow-scripts allow-modals"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className={classes.preview}
      style={{ height: cssSize(height) }}
    />
  );
}
