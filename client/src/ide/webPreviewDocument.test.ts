import { describe, expect, it, vi } from 'vitest';
import { buildPreviewDocument, createChannelId, readPreviewMessage } from './webPreviewDocument';

const CHANNEL = 'cc-preview-test';

function injectedScript(doc: string): string {
  const m = /<script>(.*?)<\/script>/.exec(doc);
  if (!m) throw new Error('no capture script');
  return m[1]!;
}

describe('buildPreviewDocument', () => {
  it('puts the capture script first in <head>', () => {
    const doc = buildPreviewDocument('<!doctype html><html><head><title>x</title></head><body></body></html>', CHANNEL);
    expect(doc.startsWith('<!doctype html><html><head><script>')).toBe(true);
    expect(doc).toContain('</script><title>x</title>');
  });

  it('does not mistake <header> for <head>', () => {
    const doc = buildPreviewDocument('<!doctype html>\n<body><header>Hi</header></body>', CHANNEL);
    expect(doc.startsWith('<!doctype html>\n<script>')).toBe(true);
    expect(doc).toContain('<header>Hi</header>');
  });

  it('goes after <html> when there is no <head>, or at the start of a fragment', () => {
    expect(buildPreviewDocument('<html lang="en"><body>x</body></html>', CHANNEL).startsWith('<html lang="en"><script>')).toBe(true);
    expect(buildPreviewDocument('<h1>Hi</h1>', CHANNEL).startsWith('<script>')).toBe(true);
  });

  it('adds no line breaks, so line numbers in student scripts are unchanged', () => {
    const html = '<html>\n<head>\n</head>\n<body>\n<script>oops()</script>\n</body>\n</html>';
    const doc = buildPreviewDocument(html, CHANNEL);
    expect(doc.split('\n').length).toBe(html.split('\n').length);
  });

  it('forwards console output and errors to the parent on its channel', () => {
    const posted: unknown[] = [];
    const listeners: Record<string, (e: unknown) => void> = {};
    const fakeConsole = { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fakeWindow = { addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn) };
    const fakeParent = { postMessage: (data: unknown) => posted.push(data) };

    const js = injectedScript(buildPreviewDocument('<p>x</p>', CHANNEL));
    new Function('window', 'console', 'parent', js)(fakeWindow, fakeConsole, fakeParent);

    const log = fakeConsole.log as unknown as (...args: unknown[]) => void;
    log('Score:', 3, { a: [1, 2] }, undefined);
    (fakeConsole.warn as unknown as (...args: unknown[]) => void)('careful');
    listeners.error!({ message: 'ReferenceError: x is not defined', lineno: 12 });

    expect(posted).toEqual([
      { channel: CHANNEL, stream: 'stdout', text: 'Score: 3 {"a":[1,2]} undefined\n' },
      { channel: CHANNEL, stream: 'stderr', text: 'careful\n' },
      { channel: CHANNEL, stream: 'stderr', text: 'ReferenceError: x is not defined (line 12)\n' },
    ]);
  });
});

describe('readPreviewMessage', () => {
  it('accepts well-formed messages on the right channel only', () => {
    expect(readPreviewMessage({ channel: CHANNEL, stream: 'stdout', text: 'hi\n' }, CHANNEL)).toEqual({ stream: 'stdout', text: 'hi\n' });
    expect(readPreviewMessage({ channel: 'other', stream: 'stdout', text: 'hi' }, CHANNEL)).toBeNull();
    expect(readPreviewMessage({ channel: CHANNEL, stream: 'system', text: 'hi' }, CHANNEL)).toBeNull();
    expect(readPreviewMessage({ channel: CHANNEL, stream: 'stdout', text: 5 }, CHANNEL)).toBeNull();
    expect(readPreviewMessage('hi', CHANNEL)).toBeNull();
  });

  it('truncates very long messages', () => {
    const msg = readPreviewMessage({ channel: CHANNEL, stream: 'stdout', text: 'x'.repeat(20_000) }, CHANNEL);
    expect(msg!.text.length).toBeLessThan(10_010);
  });
});

describe('createChannelId', () => {
  it('is unique per call', () => {
    expect(createChannelId()).not.toBe(createChannelId());
  });
});
