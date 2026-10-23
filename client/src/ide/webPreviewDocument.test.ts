import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOOP_GUARD, loopGuardCall } from './loopProtect';
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
    expect(doc).toContain(`while (${loopGuardCall(9)}&&(i < 5)) {}`);
    expect(doc).toContain(`<script type="module">for (;${loopGuardCall(11)};) {}</script>`);
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

  it('still stops a loop whose dialogs return at once (the browser stopped showing them)', () => {
    vi.useFakeTimers();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { fakeWindow } = runCapture({ alert: () => undefined, prompt: () => null });
    const guard = fakeWindow[LOOP_GUARD] as (line: number) => boolean;
    const alert = fakeWindow.alert as (message: string) => void;
    const prompt = fakeWindow.prompt as (message: string) => string | null;

    // while (true) { alert('hi'); g = prompt('Guess') } — each pass takes 10 ms, all of it outside the dialogs.
    let passes = 0;
    expect(() => {
      for (;;) {
        guard(2);
        alert('hi');
        prompt('Guess');
        now += 10;
        if (++passes > 1_000) throw new Error('the guard never fired');
      }
    }).toThrow(/line 2 ran for more than 1 second/);
    expect(passes).toBe(LOOP_TIME_LIMIT_MS / 10 + 1); // stopped once more than 1 s has gone by
  });

  it('only takes the time spent inside a dialog off the budget', () => {
    vi.useFakeTimers();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const confirm = vi.fn(() => {
      now += 5_000;
      return true;
    });
    const { fakeWindow } = runCapture({ confirm });
    const guard = fakeWindow[LOOP_GUARD] as (line: number) => boolean;

    expect(guard(3)).toBe(true);
    now += 600; // looping before the dialog…
    (fakeWindow.confirm as () => boolean)();
    now += 400; // …and after it: 1 s of looping in all
    expect(guard(3)).toBe(true);
    now += 1;
    expect(() => guard(3)).toThrow(/line 3/);
  });

  it('ignores <head> and <script> inside attribute values, <noscript> and <iframe>', () => {
    const capture = '<script>(function(){';
    const gt = buildPreviewDocument('<!doctype html><html><head data-note="a>b"><title>x</title></head></html>', CHANNEL);
    expect(gt).toContain(`<head data-note="a>b">${capture}`);
    const inAttr = buildPreviewDocument('<!doctype html><html data-x="<head>"><head></head></html>', CHANNEL);
    expect(inAttr).toContain(`<html data-x="<head>"><head>${capture}`);
    const noscript = buildPreviewDocument("<!doctype html><html><noscript><head></noscript><head></head></html>", CHANNEL);
    expect(noscript).toContain(`</noscript><head>${capture}`);
    const quoted = buildPreviewDocument("<html><head title='<script>' ></head></html>", CHANNEL);
    expect(quoted).toContain(`<head title='<script>' >${capture}`);
  });

  it('leaves script text in attribute values alone (a nested frame has no loop guard)', () => {
    const srcdoc = '<iframe srcdoc="<script>for (let i = 0; i < 3; i++) document.write(i)</script>"></iframe>';
    const doc = buildPreviewDocument(`<body>${srcdoc}\n<div title="<script>"></div>\n<script>\nwhile (true) {}\n</script></body>`, CHANNEL);
    expect(doc).toContain(srcdoc);
    expect(doc).toContain('<div title="<script>"></div>');
    expect(doc).toContain(`<script>\nwhile (${loopGuardCall(4)}&&(true)) {}\n</script>`);
  });

  it('guards a script that follows "<!--" inside an attribute value', () => {
    const doc = buildPreviewDocument('<body><img alt="<!-- arrow">\n<script>\nwhile (true) {}\n</script></body>', CHANNEL);
    expect(doc).toContain(`while (${loopGuardCall(3)}&&(true))`);
  });

  it('reads a script hidden in <!-- … --> to its real end, like the browser', () => {
    const script = '<script><!--\ndocument.write("<script>x()</script>");\nwhile (true) {}\n//--></script>';
    const doc = buildPreviewDocument(`<body>${script}<p>after</p></body>`, CHANNEL);
    expect(doc).toContain(`while (${loopGuardCall(3)}&&(true)) {}\n//--></script><p>after</p>`);
    expect(maskHtml(script).replace(/ +/g, ' ')).toBe('<script> \n \n \n </script>');
    expect(pageHasScripts('<script><!-- document.write("<script>") --></script>')).toBe(true);
  });

  it('reads script types from the tag, not from other attributes', () => {
    const doc = buildPreviewDocument(
      '<script data-src="x.js" title="type=text/plain">for (;;) {}</script><script type="text/plain" data-type="module">for (;;) {}</script>',
      CHANNEL,
    );
    expect(doc).toContain(`<script data-src="x.js" title="type=text/plain">for (;${loopGuardCall(1)};) {}</script>`);
    expect(doc).toContain('<script type="text/plain" data-type="module">for (;;) {}</script>');
  });
});

describe('maskHtml', () => {
  it('blanks comments and raw text but keeps length and line breaks', () => {
    const html = '<p>a</p><!-- <head>\n --><script>if (a<b) x()</script><style>p{}</style>';
    const masked = maskHtml(html);
    expect(masked.length).toBe(html.length);
    expect(masked).toBe('<p>a</p>' + ' '.repeat(11) + '\n' + ' '.repeat(4) + '<script>' + ' '.repeat(12) + '</script><style>   </style>');
  });

  it('blanks attribute values, so "<!--" or ">" inside one is not markup', () => {
    expect(maskHtml('<img alt="<!-- arrow"><p>x</p>')).toBe('<img alt="          "><p>x</p>');
    expect(maskHtml("<a title='a>b' href=x.html>y</a>")).toBe("<a title='   ' href=      >y</a>");
    expect(maskHtml('<noscript><p>x</p></noscript><!-- c --!><b>')).toBe('<noscript>        </noscript>' + ' '.repeat(11) + '<b>');
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

  it('reads attributes properly', () => {
    expect(pageHasScripts('<img alt="<!-- arrow">\n<script>while (true) {}</script>')).toBe(true);
    expect(pageHasScripts('<button onclick=go()>Go</button>')).toBe(true);
    expect(pageHasScripts('<p title="<script>">x</p>')).toBe(false);
    expect(pageHasScripts('<p title="x onclick=y">x</p>')).toBe(false);
  });

  it('counts scripts inside an iframe srcdoc, which the loop guard cannot reach', () => {
    expect(pageHasScripts('<body><iframe srcdoc="<script>while (true) {}</script>"></iframe></body>')).toBe(true);
    expect(pageHasScripts(`<iframe srcdoc='<button onclick="go()">Go</button>'></iframe>`)).toBe(true);
    expect(pageHasScripts('<iframe srcdoc="<h1>Just text</h1>"></iframe>')).toBe(false);
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
