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
 * to the event loop, every guarded loop throws. Time spent in alert/confirm/prompt dialogs doesn't count, so a
 * guessing game that prompts in a loop keeps working. Kept on a single line so line numbers in the student's inline
 * scripts are unchanged.
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
['alert','confirm','prompt','print'].forEach(function(n){var f=window[n];if(typeof f==='function')window[n]=function(){try{return f.apply(window,arguments)}finally{if(T)T=now()}}});
window.addEventListener('error',function(e){var x=e.error;if(x&&x.ccLoop){send('stderr',[x.message]);return}
send('stderr',[(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')])});
window.addEventListener('unhandledrejection',function(e){var r=e.reason;send('stderr',[r&&r.ccLoop?r.message:'Uncaught (in promise) '+fmt(r)])});
})();`;
  return `<script>${js.replace(/\n/g, '')}</script>`;
}

const MASK_START = /<!--|<(script|style|textarea|title)(?=[\s/>])[^>]*>/gi;
const blank = (text: string) => text.replace(/[^\n]/g, ' ');

/**
 * The page with every comment and the text inside <script>, <style>, <textarea> and <title> replaced by spaces
 * (line breaks kept), so tag searches only see real markup and indices still match the original.
 */
export function maskHtml(html: string): string {
  let out = '';
  let last = 0;
  const re = new RegExp(MASK_START.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1]?.toLowerCase();
    let from: number;
    let end: number;
    if (tag) {
      from = m.index + m[0].length;
      const close = new RegExp(`</${tag}`, 'gi');
      close.lastIndex = from;
      end = close.exec(html)?.index ?? html.length;
    } else {
      from = m.index;
      // `<!-->` and `<!--->` are (empty) comments too.
      const close = html.indexOf('-->', m.index + 2);
      end = close < 0 ? html.length : close + 3;
    }
    out += html.slice(last, from) + blank(html.slice(from, end));
    last = end;
    re.lastIndex = end;
  }
  return out + html.slice(last);
}

/** True when the page runs JavaScript: a <script> element or an inline event handler such as onclick. */
export function pageHasScripts(html: string): boolean {
  const masked = maskHtml(html);
  return /<script(?=[\s/>])/i.test(masked) || /<[a-z][^>]*?\son[a-z]+\s*=/i.test(masked);
}

const JS_TYPE = /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/i;

/** Whether a <script> start tag's attributes describe inline JavaScript (no `src`, a JavaScript `type`). */
function isInlineJavaScript(attrs: string): boolean {
  if (/(?:^|\s)src\s*=/i.test(attrs)) return false;
  const type = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  const value = (type ? (type[1] ?? type[2] ?? type[3] ?? '') : '').trim();
  return value === '' || JS_TYPE.test(value);
}

/** Adds the loop guard to every inline script (see loopProtect.ts). */
function protectScripts(html: string, masked: string): string {
  let out = '';
  let last = 0;
  let line = 1;
  let counted = 0;
  for (const m of masked.matchAll(/<script(?=[\s/>])([^>]*)>/gi)) {
    if (!isInlineJavaScript(m[1] ?? '')) continue;
    const start = m.index + m[0].length;
    // Script text is blank in the mask, so the next '<' starts its end tag.
    const close = masked.indexOf('<', start);
    const end = close < 0 ? html.length : close;
    for (; counted < start; counted++) if (html.charCodeAt(counted) === 10) line++;
    out += html.slice(last, start) + protectLoops(html.slice(start, end), line);
    last = end;
  }
  return out + html.slice(last);
}

/**
 * The preview document: inline scripts get loop protection, and the capture script goes first in <head> — or, when
 * there is no <head> or a script comes before it, after any doctype/<html> tag (else at the very start). Comments and
 * script/style text are ignored when looking for those tags.
 */
export function buildPreviewDocument(html: string, channel: string): string {
  const page = protectScripts(html, maskHtml(html));
  const masked = maskHtml(page);
  const head = /<head(?=[\s>])[^>]*>/i.exec(masked);
  const firstScript = masked.search(/<script(?=[\s/>])/i);
  const at =
    head && (firstScript < 0 || firstScript > head.index)
      ? head.index + head[0].length
      : (/^\s*(?:<!doctype[^>]*>\s*)?(?:<html(?=[\s>])[^>]*>)?/i.exec(masked)?.[0].length ?? 0);
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
