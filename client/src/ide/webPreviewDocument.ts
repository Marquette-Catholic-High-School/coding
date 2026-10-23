// Builds the srcDoc for the sandboxed web preview: the student's HTML plus a console-capture script.

/** Message posted from the preview iframe to the parent window. */
export interface PreviewConsoleMessage {
  channel: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

/** A random id so the parent only accepts messages from its own preview. */
export function createChannelId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `cc-preview-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Console capture: forwards console.log/info/debug (stdout), console.warn/error (stderr) and uncaught errors to
 * the parent. Kept on a single line so line numbers in the student's inline scripts are unchanged.
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
window.addEventListener('error',function(e){send('stderr',[(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')])});
window.addEventListener('unhandledrejection',function(e){var r=e.reason;send('stderr',['Uncaught (in promise) '+fmt(r)])});
})();`;
  return `<script>${js.replace(/\n/g, '')}</script>`;
}

/** Inserts the capture script first in <head>; without a <head>, after any doctype/<html> tag, else at the start. */
export function buildPreviewDocument(html: string, channel: string): string {
  const script = captureScript(channel);
  const head = /<head(?=[\s>])[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  const lead = /^\s*(?:<!doctype[^>]*>\s*)?(?:<html(?=[\s>])[^>]*>)?/i.exec(html);
  const at = lead ? lead[0].length : 0;
  return html.slice(0, at) + script + html.slice(at);
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
