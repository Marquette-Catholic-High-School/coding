// Builds the srcDoc for the sandboxed web preview: the student's HTML with loop-protected inline scripts, plus a
// console-capture script that also defines the loop guard.

import { LOOP_GUARD, protectLoops } from './loopProtect';

/** Message posted from the preview iframe to the parent window. */
export interface PreviewConsoleMessage {
  channel: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

/** How long the page's scripts may keep looping without giving the browser a break. */
export const LOOP_TIME_LIMIT_MS = 1000;

/** A random id so the parent only accepts messages from its own preview. */
export function createChannelId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `cc-preview-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Console capture: forwards console.log/info/debug (stdout), console.warn/error (stderr) and uncaught errors to
 * the parent. Also defines the loop guard: once loops have run for LOOP_TIME_LIMIT_MS without the page getting back
 * to the event loop, every guarded loop throws. Time spent inside alert/confirm/prompt dialogs doesn't count, so a
 * guessing game that prompts in a loop keeps working — but only that time is taken off, so a loop whose dialogs return
 * at once (the browser stopped showing them) is still stopped. Kept on a single line so line numbers in the student's
 * inline scripts are unchanged.
 */
function captureScript(channel: string): string {
  const js = `(function(){var C=${JSON.stringify(channel)};
function fmt(v){if(typeof v==='string')return v;if(v instanceof Error)return v.name+': '+v.message;
if(v&&typeof v==='object'&&v.nodeType===1)return '<'+String(v.tagName).toLowerCase()+'>';
if(typeof v==='function')return 'function '+(v.name||'(anonymous)');if(typeof v==='undefined')return 'undefined';
try{var s=JSON.stringify(v);return s===undefined?String(v):s}catch(e){return String(v)}}
function send(stream,args){try{parent.postMessage({channel:C,stream:stream,text:Array.prototype.map.call(args,fmt).join(' ')+'\\n'},'*')}catch(e){}}
['log','info','debug','warn','error'].forEach(function(level){var orig=console[level];
console[level]=function(){send(level==='warn'||level==='error'?'stderr':'stdout',arguments);if(orig)orig.apply(console,arguments)}});
var now=Date.now,later=setTimeout,T=0;
Object.defineProperty(window,${JSON.stringify(LOOP_GUARD)},{value:function(line){var t=now();
if(!T){T=t;later(function(){T=0},0)}else if(t-T>${LOOP_TIME_LIMIT_MS}){var e=new Error('The loop on line '+line+' ran for more than ${LOOP_TIME_LIMIT_MS / 1000} second, so it was stopped. Is there a loop that never ends?');e.ccLoop=1;throw e}
return true}});
['alert','confirm','prompt','print'].forEach(function(n){var f=window[n];if(typeof f==='function')window[n]=function(){var s=now();try{return f.apply(window,arguments)}finally{var e=now();if(T){T+=e-s;if(T>e)T=e}}}});
window.addEventListener('error',function(e){var x=e.error;if(x&&x.ccLoop){send('stderr',[x.message]);return}
send('stderr',[(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')])});
window.addEventListener('unhandledrejection',function(e){var r=e.reason;send('stderr',[r&&r.ccLoop?r.message:'Uncaught (in promise) '+fmt(r)])});
})();`;
  return `<script>${js.replace(/\n/g, '')}</script>`;
}

/**
 * Elements whose content is text, not markup (scripting is on in the preview, so <noscript> is one too; everything
 * after <plaintext> is text).
 */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'iframe', 'noembed', 'noframes', 'xmp', 'plaintext']);

/** A start or end tag found by scanHtml. */
interface HtmlTag {
  /** Lower-cased tag name. */
  name: string;
  isEnd: boolean;
  /** Index of '<' and just past '>'. */
  start: number;
  end: number;
  attrs: { name: string; value: string }[];
  /** For raw-text elements (script, style, …): where their text ends (the end tag, or the end of the page). */
  textEnd?: number;
}

const blank = (text: string) => text.replace(/[^\n]/g, ' ');
const SPACE = /[\t\n\f\r ]/;

/**
 * Where the text of a <script> starting at `from` ends. Like the browser, it follows the old `<!-- … -->` hiding
 * pattern: between those, a "<script>" (say, in a document.write string) means the next "</script>" doesn't end it.
 */
function scriptTextEnd(html: string, from: number): number {
  const re = /<!--|-->|<(\/?)script(?=[\t\n\f\r />])/gi;
  re.lastIndex = from;
  let state: 'data' | 'escaped' | 'double' = 'data';
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0] === '<!--') {
      if (state === 'data') state = 'escaped';
    } else if (m[0] === '-->') state = 'data';
    else if (m[1]) {
      if (state !== 'double') return m.index;
      state = 'escaped';
    } else if (state === 'escaped') state = 'double';
  }
  return html.length;
}

/** Where the text of raw-text element `name` starting at `from` ends: at its end tag, or the end of the page. */
function rawTextEnd(html: string, name: string, from: number): number {
  if (name === 'plaintext') return html.length;
  if (name === 'script') return scriptTextEnd(html, from);
  const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'gi');
  close.lastIndex = from;
  return close.exec(html)?.index ?? html.length;
}

/**
 * A small HTML tokenizer: the tags of the page (with their attributes), and the page with every comment, attribute
 * value and the text inside raw-text elements (<script>, <style>, <textarea>, <title>, …) replaced by spaces (line
 * breaks kept), so tag searches only see real markup and indices still match the original. A tag that never ends
 * (half-typed at the end of the page) isn't listed.
 */
function scanHtml(html: string): { masked: string; tags: HtmlTag[] } {
  const tags: HtmlTag[] = [];
  const n = html.length;
  let out = '';
  let last = 0;
  const blankRange = (from: number, to: number) => {
    if (to <= from) return;
    out += html.slice(last, from) + blank(html.slice(from, to));
    last = to;
  };
  /** Index just past the next '>' from `from` (or the end of the page). */
  const pastGt = (from: number) => {
    const gt = html.indexOf('>', from);
    return gt < 0 ? n : gt + 1;
  };

  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (html.startsWith('<!--', i)) {
      // `<!-->` and `<!--->` are (empty) comments too; `--!>` also ends one.
      const close = /--!?>/g;
      close.lastIndex = i + 2;
      const m = close.exec(html);
      const end = m ? m.index + m[0].length : n;
      blankRange(i, end);
      i = end;
      continue;
    }
    const next = html[i + 1] ?? '';
    if (next === '!' || next === '?' || (next === '/' && !/[A-Za-z]/.test(html[i + 2] ?? ''))) {
      // Doctype (kept), or a bogus comment such as `<?xml …>` or `</ x>` (blanked). `</>` is dropped.
      const end = pastGt(i + 2);
      if (!/^<!doctype/i.test(html.slice(i, i + 9))) blankRange(i, end);
      i = end;
      continue;
    }
    const isEnd = next === '/';
    const nameStart = isEnd ? i + 2 : i + 1;
    if (!/[A-Za-z]/.test(html[nameStart] ?? '')) {
      i++; // a '<' in text
      continue;
    }
    let k = nameStart;
    while (k < n && !SPACE.test(html[k]!) && html[k] !== '/' && html[k] !== '>') k++;
    const name = html.slice(nameStart, k).toLowerCase();
    const attrs: HtmlTag['attrs'] = [];
    for (;;) {
      while (k < n && (SPACE.test(html[k]!) || html[k] === '/')) k++;
      if (k >= n || html[k] === '>') break;
      const nameAt = k++; // an attribute name may start with '='
      while (k < n && !SPACE.test(html[k]!) && html[k] !== '/' && html[k] !== '>' && html[k] !== '=') k++;
      const attr = { name: html.slice(nameAt, k).toLowerCase(), value: '' };
      attrs.push(attr);
      let p = k;
      while (p < n && SPACE.test(html[p]!)) p++;
      if (html[p] !== '=') continue;
      p++;
      while (p < n && SPACE.test(html[p]!)) p++;
      const quote = html[p];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, p + 1);
        const valueEnd = close < 0 ? n : close;
        attr.value = html.slice(p + 1, valueEnd);
        blankRange(p + 1, valueEnd);
        k = close < 0 ? n : close + 1;
      } else {
        let valueEnd = p;
        while (valueEnd < n && !SPACE.test(html[valueEnd]!) && html[valueEnd] !== '>') valueEnd++;
        attr.value = html.slice(p, valueEnd);
        blankRange(p, valueEnd);
        k = valueEnd;
      }
    }
    if (k >= n) break; // the page ends inside the tag
    const tag: HtmlTag = { name, isEnd, start: i, end: k + 1, attrs };
    tags.push(tag);
    i = tag.end;
    if (!isEnd && RAW_TEXT.has(name)) {
      tag.textEnd = rawTextEnd(html, name, i);
      blankRange(i, tag.textEnd);
      i = tag.textEnd;
    }
  }
  return { masked: out + html.slice(last), tags };
}

/**
 * The page with every comment, attribute value and the text inside <script>, <style>, <textarea>, <title> (and the
 * other raw-text elements) replaced by spaces, line breaks kept, so indices still match the original.
 */
export function maskHtml(html: string): string {
  return scanHtml(html).masked;
}

const isEventHandler = (attr: { name: string }) => /^on[a-z]+$/.test(attr.name);

/** An iframe `srcdoc` that runs JavaScript of its own (the loop guard can't reach into it). */
const isScriptedSrcdoc = (attr: { name: string; value?: string | null }) =>
  attr.name === 'srcdoc' && /<script\b|\bon[a-z]+\s*=/i.test(attr.value ?? '');

/**
 * True when the page runs JavaScript: a <script> element, an inline event handler such as onclick, or an iframe
 * `srcdoc` containing either (such pages only re-render on Run, so a half-typed loop can't freeze the editor).
 */
export function pageHasScripts(html: string): boolean {
  return scanHtml(html).tags.some(
    (t) => !t.isEnd && (t.name === 'script' || t.attrs.some(isEventHandler) || t.attrs.some(isScriptedSrcdoc)),
  );
}

const JS_TYPE = /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/i;

/** Whether a <script> start tag describes inline JavaScript (no `src`, a JavaScript `type`). */
function isInlineJavaScript(tag: HtmlTag): boolean {
  if (tag.attrs.some((a) => a.name === 'src')) return false;
  const type = (tag.attrs.find((a) => a.name === 'type')?.value ?? '').trim();
  return type === '' || JS_TYPE.test(type);
}

/** Adds the loop guard to every inline script (see loopProtect.ts). Script text in attribute values is left alone. */
function protectScripts(html: string, tags: HtmlTag[]): string {
  let out = '';
  let last = 0;
  let line = 1;
  let counted = 0;
  for (const tag of tags) {
    if (tag.isEnd || tag.name !== 'script' || tag.textEnd === undefined || !isInlineJavaScript(tag)) continue;
    const start = tag.end;
    for (; counted < start; counted++) if (html.charCodeAt(counted) === 10) line++;
    out += html.slice(last, start) + protectLoops(html.slice(start, tag.textEnd), line);
    last = tag.textEnd;
  }
  return out + html.slice(last);
}

/**
 * The preview document: inline scripts get loop protection, and the capture script goes first in <head> — or, when
 * there is no <head> or a script comes before it, after any doctype/<html> tag (else at the very start). Comments,
 * attribute values and script/style text are ignored when looking for those tags.
 */
export function buildPreviewDocument(html: string, channel: string): string {
  const page = protectScripts(html, scanHtml(html).tags);
  const { masked, tags } = scanHtml(page);
  const head = tags.find((t) => !t.isEnd && t.name === 'head');
  const firstScript = tags.find((t) => !t.isEnd && t.name === 'script');
  const at =
    head && (!firstScript || firstScript.start > head.start)
      ? head.end
      : (/^\s*(?:<!doctype[^>]*>\s*)?(?:<html(?=[\s/>])[^>]*>)?/i.exec(masked)?.[0].length ?? 0);
  return page.slice(0, at) + captureScript(channel) + page.slice(at);
}

/** Validates a message event's data against the expected channel. */
export function readPreviewMessage(data: unknown, channel: string): Omit<PreviewConsoleMessage, 'channel'> | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Partial<PreviewConsoleMessage>;
  if (msg.channel !== channel) return null;
  if (msg.stream !== 'stdout' && msg.stream !== 'stderr') return null;
  if (typeof msg.text !== 'string') return null;
  return { stream: msg.stream, text: msg.text.length > 10_000 ? `${msg.text.slice(0, 10_000)}…\n` : msg.text };
}
