// Readable formatting of JavaScript values for the console shims, modelled on Node's util.inspect / util.format
// (`[ 1, 2, 3 ]`, `{ name: 'Sam' }`, `Map(1) { 'a' => 1 }`), without colours or Node-only internals.

export interface InspectOptions {
  /** Nesting levels shown before objects collapse to `[Object]` / `[Array]`. Default 2. */
  depth?: number;
  /** Maximum single-line width before entries go on their own lines. Default 80. */
  breakLength?: number;
  /** Items shown per array/Map/Set before "... n more items". Default 100. */
  maxArrayLength?: number;
}

interface Context {
  depth: number;
  breakLength: number;
  maxArrayLength: number;
  seen: object[];
}

const MAX_STRING_LENGTH = 10_000;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ESCAPES: Record<string, string> = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '\\': '\\\\' };

export function inspect(value: unknown, options: InspectOptions = {}): string {
  const ctx: Context = {
    depth: options.depth ?? 2,
    breakLength: options.breakLength ?? 80,
    maxArrayLength: options.maxArrayLength ?? 100,
    seen: [],
  };
  return formatValue(value, ctx, 0);
}

/** Formats console.log arguments like Node's util.format: printf-style specifiers, strings unquoted at top level. */
export function formatLogArgs(args: readonly unknown[]): string {
  if (args.length === 0) return '';
  const parts: string[] = [];
  let index = 0;
  const first = args[0];
  if (typeof first === 'string') {
    index = 1;
    if (args.length > 1 && first.includes('%')) {
      parts.push(
        first.replace(/%([sdifjoOc%])/g, (match, spec: string) => {
          if (spec === '%') return '%';
          if (index >= args.length) return match;
          return formatSpecifier(spec, args[index++]);
        }),
      );
    } else {
      parts.push(first);
    }
  }
  for (; index < args.length; index++) {
    const arg = args[index];
    parts.push(typeof arg === 'string' ? arg : inspect(arg));
  }
  return parts.join(' ');
}

function formatSpecifier(spec: string, arg: unknown): string {
  switch (spec) {
    case 's':
      if (typeof arg === 'string') return arg;
      if (typeof arg === 'bigint') return `${arg}n`;
      if (typeof arg === 'symbol') return arg.toString();
      if (typeof arg === 'number') return formatNumber(arg);
      if (typeof arg === 'object' && arg !== null) return inspect(arg, { depth: 1 });
      return String(arg);
    case 'd':
      if (typeof arg === 'bigint') return `${arg}n`;
      if (typeof arg === 'symbol' || (typeof arg === 'object' && arg !== null)) return 'NaN';
      return formatNumber(Number(arg));
    case 'i':
      if (typeof arg === 'bigint') return `${arg}n`;
      if (typeof arg === 'symbol') return 'NaN';
      return formatNumber(Number.parseInt(String(arg), 10));
    case 'f':
      if (typeof arg === 'symbol') return 'NaN';
      return formatNumber(Number.parseFloat(String(arg)));
    case 'j':
      try {
        return JSON.stringify(arg) ?? 'undefined';
      } catch {
        return '[Circular]';
      }
    case 'o':
    case 'O':
      return inspect(arg, { depth: spec === 'o' ? 4 : 2 });
    case 'c':
      return '';
    default:
      return `%${spec}`;
  }
}

/** Node-style box table for console.table, or null when `data` is not an object (then it is logged normally). */
export function formatConsoleTable(data: unknown, columns?: readonly unknown[]): string | null {
  if (data === null || typeof data !== 'object') return null;
  let indexHeader = '(index)';
  let rows: Array<[string, unknown]>;
  if (data instanceof Map) {
    rows = [...data.entries()].map(([key, value]) => [typeof key === 'string' ? key : inspect(key), value]);
  } else if (data instanceof Set) {
    indexHeader = '(iteration index)';
    rows = [...data.values()].map((value, i) => [String(i), value]);
  } else if (Array.isArray(data)) {
    rows = data.map((value, i) => [String(i), value]);
  } else {
    rows = Object.keys(data).map((key) => [key, (data as Record<string, unknown>)[key]]);
  }

  const keys: string[] = [];
  let hasValues = false;
  for (const [, value] of rows) {
    if (isTableRecord(value)) {
      for (const key of Object.keys(value)) if (!keys.includes(key)) keys.push(key);
    } else {
      hasValues = true;
    }
  }
  const valueKeys = columns ? columns.map(String) : keys;
  const header = [indexHeader, ...valueKeys, ...(hasValues ? ['Values'] : [])];
  const cell = (value: unknown) => inspect(value, { depth: 0, breakLength: Infinity, maxArrayLength: 3 });
  const body = rows.map(([label, value]) => {
    const record = isTableRecord(value) ? (value as Record<string, unknown>) : null;
    const cells = valueKeys.map((key) => (record && Object.prototype.hasOwnProperty.call(record, key) ? cell(record[key]) : ''));
    if (hasValues) cells.push(record ? '' : cell(value));
    return [label, ...cells];
  });

  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const line = (left: string, mid: string, right: string) => left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right;
  const row = (cells: string[]) => `│${cells.map((c, i) => ` ${c.padEnd(widths[i]!)} `).join('│')}│`;
  return [line('┌', '┬', '┐'), row(header), line('├', '┼', '┤'), ...body.map(row), line('└', '┴', '┘')].join('\n');
}

function isTableRecord(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp);
}

export function formatNumber(n: number): string {
  return Object.is(n, -0) ? '-0' : String(n);
}

export function quoteString(s: string): string {
  let quote = "'";
  if (s.includes("'")) {
    if (!s.includes('"')) quote = '"';
    else if (!s.includes('`') && !s.includes('${')) quote = '`';
  }
  let text = s.length > MAX_STRING_LENGTH ? s.slice(0, MAX_STRING_LENGTH) : s;
  text = text.replace(/[\x00-\x1f\x7f\\]/g, (c) => ESCAPES[c] ?? `\\x${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  if (quote === "'") text = text.replace(/'/g, "\\'");
  const more = s.length - MAX_STRING_LENGTH;
  return `${quote}${text}${quote}${more > 0 ? `... ${more} more character${more === 1 ? '' : 's'}` : ''}`;
}

/** "TypeError: x is not a function" (or just the name when there is no message). */
export function errorHeadline(err: { name?: unknown; message?: unknown }): string {
  const name = typeof err.name === 'string' && err.name ? err.name : 'Error';
  const message = typeof err.message === 'string' ? err.message : '';
  return message ? `${name}: ${message}` : name;
}

function formatValue(value: unknown, ctx: Context, level: number): string {
  switch (typeof value) {
    case 'string':
      return quoteString(value);
    case 'number':
      return formatNumber(value);
    case 'bigint':
      return `${value}n`;
    case 'boolean':
    case 'undefined':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return formatFunction(value);
  }
  if (value === null) return 'null';
  return formatObject(value as object, ctx, level);
}

function formatFunction(fn: Function): string {
  let source = '';
  try {
    source = Function.prototype.toString.call(fn);
  } catch {
    // Revoked proxies and similar exotic functions cannot be stringified.
  }
  const name = fn.name;
  if (source.startsWith('class')) {
    const parent = Object.getPrototypeOf(fn) as Function | null;
    const extendsText = parent && parent !== Function.prototype && parent.name ? ` extends ${parent.name}` : '';
    return `[class ${name || '(anonymous)'}${extendsText}]`;
  }
  const ctorName = safeConstructorName(fn);
  const type = ctorName && ctorName.endsWith('Function') ? ctorName : 'Function';
  return name ? `[${type}: ${name}]` : `[${type} (anonymous)]`;
}

/** Constructor name of the value's prototype; null for null-prototype objects. */
function safeConstructorName(value: object): string | null {
  try {
    const proto = Object.getPrototypeOf(value) as { constructor?: unknown } | null;
    if (proto === null) return null;
    const ctor = proto.constructor;
    return typeof ctor === 'function' && ctor.name ? ctor.name : 'Object';
  } catch {
    return 'Object';
  }
}

function formatObject(obj: object, ctx: Context, level: number): string {
  if (ctx.seen.includes(obj)) return '[Circular]';
  const name = safeConstructorName(obj);

  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString();
  if (obj instanceof RegExp) return String(obj);
  if (obj instanceof Error) return level === 0 ? errorHeadline(obj) : `[${errorHeadline(obj)}]`;
  if (obj instanceof Number) return `[Number: ${formatNumber(obj.valueOf())}]`;
  if (obj instanceof String) return `[String: ${quoteString(obj.valueOf())}]`;
  if (obj instanceof Boolean) return `[Boolean: ${obj.valueOf()}]`;
  if (obj instanceof Promise) return 'Promise { <pending> }';
  if (obj instanceof WeakMap) return 'WeakMap { <items unknown> }';
  if (obj instanceof WeakSet) return 'WeakSet { <items unknown> }';
  if (obj instanceof ArrayBuffer) return `ArrayBuffer { byteLength: ${obj.byteLength} }`;

  if (level > ctx.depth) {
    if (Array.isArray(obj)) return '[Array]';
    return name === null ? '[Object: null prototype]' : `[${name}]`;
  }

  ctx.seen.push(obj);
  try {
    let prefix = '';
    let braces: [string, string] = ['{', '}'];
    let entries: string[];
    if (Array.isArray(obj)) {
      braces = ['[', ']'];
      if (name !== 'Array') prefix = `${name ?? 'Array'}(${obj.length})`;
      entries = [...arrayEntries(obj, ctx, level), ...propertyEntries(obj, ctx, level, true)];
    } else if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
      const typed = obj as unknown as ArrayLike<number | bigint>;
      braces = ['[', ']'];
      prefix = `${name ?? 'TypedArray'}(${typed.length})`;
      entries = limited(Array.from(typed), ctx, (v) => (typeof v === 'bigint' ? `${v}n` : formatNumber(v)));
    } else if (obj instanceof Map) {
      prefix = `${name ?? 'Map'}(${obj.size})`;
      entries = limited([...obj.entries()], ctx, ([k, v]) => `${formatValue(k, ctx, level + 1)} => ${formatValue(v, ctx, level + 1)}`);
    } else if (obj instanceof Set) {
      prefix = `${name ?? 'Set'}(${obj.size})`;
      entries = limited([...obj.values()], ctx, (v) => formatValue(v, ctx, level + 1));
    } else {
      if (name === null) prefix = '[Object: null prototype]';
      else if (name !== 'Object') prefix = name;
      entries = propertyEntries(obj, ctx, level, false);
    }
    const open = prefix ? `${prefix} ${braces[0]}` : braces[0];
    if (entries.length === 0) return `${open}${braces[1]}`;
    return joinEntries(entries, open, braces[1], ctx, level);
  } finally {
    ctx.seen.pop();
  }
}

function limited<T>(items: T[], ctx: Context, format: (item: T) => string): string[] {
  const shown = items.slice(0, ctx.maxArrayLength).map(format);
  const more = items.length - shown.length;
  if (more > 0) shown.push(`... ${more} more item${more === 1 ? '' : 's'}`);
  return shown;
}

function arrayEntries(arr: unknown[], ctx: Context, level: number): string[] {
  const entries: string[] = [];
  const limit = Math.min(arr.length, ctx.maxArrayLength);
  let i = 0;
  while (i < limit) {
    if (!Object.prototype.hasOwnProperty.call(arr, i)) {
      let holes = 0;
      while (i < arr.length && !Object.prototype.hasOwnProperty.call(arr, i)) {
        holes++;
        i++;
      }
      entries.push(`<${holes} empty item${holes === 1 ? '' : 's'}>`);
      continue;
    }
    entries.push(formatValue(arr[i], ctx, level + 1));
    i++;
  }
  const more = arr.length - i;
  if (more > 0) entries.push(`... ${more} more item${more === 1 ? '' : 's'}`);
  return entries;
}

function propertyEntries(obj: object, ctx: Context, level: number, skipIndices: boolean): string[] {
  const entries: string[] = [];
  for (const key of Reflect.ownKeys(obj)) {
    if (skipIndices && typeof key === 'string' && (key === 'length' || /^(0|[1-9]\d*)$/.test(key))) continue;
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    if (!descriptor || !descriptor.enumerable) continue;
    const label = typeof key === 'symbol' ? `[${key.toString()}]` : IDENTIFIER.test(key) ? key : quoteString(key);
    let text: string;
    if (descriptor.get && descriptor.set) text = '[Getter/Setter]';
    else if (descriptor.get) text = '[Getter]';
    else if (descriptor.set) text = '[Setter]';
    else text = formatValue(descriptor.value, ctx, level + 1);
    entries.push(`${label}: ${text}`);
  }
  return entries;
}

function joinEntries(entries: string[], open: string, close: string, ctx: Context, level: number): string {
  const indentation = '  '.repeat(level);
  const singleLine = `${open} ${entries.join(', ')} ${close}`;
  if (indentation.length + singleLine.length <= ctx.breakLength && !entries.some((e) => e.includes('\n'))) {
    return singleLine;
  }
  const inner = `\n${indentation}  `;
  return `${open}${inner}${entries.join(`,${inner}`)}\n${indentation}${close}`;
}
