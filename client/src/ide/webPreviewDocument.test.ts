import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOOP_GUARD } from './loopProtect';
import { buildPreviewDocument, createChannelId, LOOP_TIME_LIMIT_MS, maskHtml, pageHasScripts, readPreviewMessage } from './webPreviewDocument';

const CHANNEL = 'cc-preview-test';

function injectedScript(doc: string): string {
  const m = /<script>(\(function\(\)\{var C=.*?)<\/script>/.exec(doc);
  if (!m) throw new Error('no capture script');
  return m[1]!;
}

/** Runs the capture script against fakes; returns what it posted, its event listeners and the window it set up. */
function runCapture(windowProps: Record<string, unknown> = {}) {
  const posted: unknown[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  const fakeConsole = { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fakeWindow: Record<string, unknown> = {
    ...windowProps,
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
  };
  const fakeParent = { postMessage: (data: unknown) => posted.push(data) };
  const js = injectedScript(buildPreviewDocument('<p>x</p>', CHANNEL));
  new Function('window', 'console', 'parent', js)(fakeWindow, fakeConsole, fakeParent);
  return { posted, listeners, fakeConsole, fakeWindow };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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
    const { posted, listeners, fakeConsole } = runCapture();

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

  it('ignores a <head> mentioned in a comment (the capture script must not end up inside it)', () => {
    const html =
      '<!doctype html>\n<!-- Put your CSS inside <head> and your content inside <body> -->\n<html><head></head><body><script>console.log("hi")</script></body></html>';
    const doc = buildPreviewDocument(html, CHANNEL);
    expect(doc).toContain('<!-- Put your CSS inside <head> and your content inside <body> -->\n<html><head><script>(function(){');
    expect(doc.indexOf('<script>(function(){')).toBeGreaterThan(doc.indexOf('-->'));
  });

  it('ignores <head> inside <title>, <style> and scripts, and comments before the doctype', () => {
    const titled = buildPreviewDocument('<html><title>My <head> page</title><head></head><body></body></html>', CHANNEL);
    expect(titled).toContain('<title>My <head> page</title><head><script>(function(){');
    const commented = buildPreviewDocument('<!-- My page -->\n<!DOCTYPE html>\n<body><p>x</p></body>', CHANNEL);
    expect(commented.startsWith('<!-- My page -->\n<!DOCTYPE html>\n<script>(function(){')).toBe(true);
  });

  it('goes before a script that comes ahead of <head>, so the loop guard exists when it runs', () => {
    const doc = buildPreviewDocument('<html><script>let a = 1;</script><head></head></html>', CHANNEL);
    expect(doc.startsWith('<html><script>(function(){')).toBe(true);
  });

  it('adds loop protection to inline scripts only, with page line numbers', () => {
    const html = [
      '<!doctype html>',
      '<html><head></head><body>',
      '<!-- <script>while (true) {}</script> -->',
      '<textarea><script>while (true) {}</script></textarea>',
      '<script type="text/template">while (true) {}</script>',
      '<script src="x.js">while (true) {}</script>',
      '<script>',
      'let i = 0;',
      'while (i < 5) {}',
      '</script>',
      '<script type="module">for (;;) {}</script>',
      '</body></html>',
    ].join('\n');
    const doc = buildPreviewDocument(html, CHANNEL);
    expect(doc.split('\n').length).toBe(html.split('\n').length);
    expect(doc).toContain(`while (${LOOP_GUARD}(9)&&(i < 5)) {}`);
    expect(doc).toContain(`<script type="module">for (;${LOOP_GUARD}(11);) {}</script>`);
    expect(doc.match(/while \(true\) \{\}/g)).toHaveLength(4);
  });

  it('stops loops that keep the page busy for too long and reports the loop line', () => {
    vi.useFakeTimers();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { posted, listeners, fakeWindow } = runCapture();
    const guard = fakeWindow[LOOP_GUARD] as (line: number) => boolean;

    expect(guard(7)).toBe(true);
    now += LOOP_TIME_LIMIT_MS;
    expect(guard(7)).toBe(true);
    now += 1;
    let thrown: unknown;
    try {
      guard(7);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(() => guard(8)).toThrow(/line 8/);

    listeners.error!({ message: 'Uncaught Error', lineno: 1, error: thrown });
    expect(posted).toEqual([
      {
        channel: CHANNEL,
        stream: 'stderr',
        text: 'The loop on line 7 ran for more than 1 second, so it was stopped. Is there a loop that never ends?\n',
      },
    ]);

    // Once the page gets back to the event loop, loops get a fresh budget.
    vi.runAllTimers();
    now += 60_000;
    expect(guard(7)).toBe(true);
    now += LOOP_TIME_LIMIT_MS - 1;
    expect(guard(7)).toBe(true);
  });

  it("doesn't count time spent in dialogs, so a loop that prompts keeps going", () => {
    vi.useFakeTimers();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const prompt = vi.fn(() => {
      now += 30_000; // the student thinks about their guess
      return '42';
    });
    const { fakeWindow } = runCapture({ prompt });
    const guard = fakeWindow[LOOP_GUARD] as (line: number) => boolean;
    const wrappedPrompt = fakeWindow.prompt as (message: string) => string;

    for (let round = 0; round < 3; round++) {
      expect(guard(4)).toBe(true);
      expect(wrappedPrompt('Guess?')).toBe('42');
      now += 10;
    }
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(guard(4)).toBe(true);
  });
});

describe('maskHtml', () => {
  it('blanks comments and raw text but keeps length and line breaks', () => {
    const html = '<p>a</p><!-- <head>\n --><script>if (a<b) x()</script><style>p{}</style>';
    const masked = maskHtml(html);
    expect(masked.length).toBe(html.length);
    expect(masked).toBe('<p>a</p>' + ' '.repeat(11) + '\n' + ' '.repeat(4) + '<script>' + ' '.repeat(12) + '</script><style>   </style>');
  });
});

describe('pageHasScripts', () => {
  it('finds script elements and inline event handlers', () => {
    expect(pageHasScripts('<body><script>x()</script></body>')).toBe(true);
    expect(pageHasScripts('<body onload="go()"></body>')).toBe(true);
    expect(pageHasScripts('<button type="button" onclick="go()">Go</button>')).toBe(true);
  });

  it('ignores scripts mentioned in comments or text', () => {
    expect(pageHasScripts('<h1>Hi</h1><p>Use <code>onclick</code> = …</p>')).toBe(false);
    expect(pageHasScripts('<!-- <script>later</script> --><textarea><script></textarea>')).toBe(false);
    expect(pageHasScripts('<!doctype html><html><head><style>.online{}</style></head><body class="one"></body></html>')).toBe(false);
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
