// Keeps student programs off the network. The worker runs on the app's origin, so a request from a program would
// carry the signed-in user's cookies (a teacher's, while grading). The server refuses API requests that lack a
// token only the page holds; this removes the means as well. Called before student code runs and never undone:
// the worker serves one language, and JavaScript workers are thrown away after every run.

export const NETWORK_BLOCKED_MESSAGE = "Programs can't use the internet in CodeClass.";

/** Network APIs, and constructors of new workers that would have them again. */
const BLOCKED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
] as const;
/** Objects whose methods reach the network (e.g. `caches.open(…).add(url)`); replaced by undefined. */
const REMOVED_GLOBALS = ['caches'] as const;

/** Throws the student-facing error; usable as a function or with `new`. */
export function networkBlocked(): never {
  throw new Error(NETWORK_BLOCKED_MESSAGE);
}

export interface BlockNetworkOptions {
  /** Requests `fetch` may still make (the Python runner downloads packages from the Pyodide CDN). */
  allowFetch?: (url: URL) => boolean;
}

function define(target: object, name: string, value: unknown): void {
  try {
    Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
  } catch {
    // Not configurable here; nothing more can be done from inside the worker.
  }
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function guardedFetch(realFetch: Fetch, allow: (url: URL) => boolean): Fetch {
  return function fetch(input, init) {
    let request: RequestInfo;
    let url: URL;
    try {
      // Checks the URL that is actually requested: a Request's URL cannot change, and anything else is turned into
      // a string once, so an object cannot show one URL to the check and another to fetch.
      request = typeof Request !== 'undefined' && input instanceof Request ? input : String(input);
      url = new URL(typeof request === 'string' ? request : request.url, globalThis.location?.href);
    } catch {
      return Promise.reject(new Error(NETWORK_BLOCKED_MESSAGE));
    }
    if (!allow(url)) return Promise.reject(new Error(NETWORK_BLOCKED_MESSAGE));
    return realFetch(typeof request === 'string' ? url.href : request, init);
  };
}

let blocked = false;

/** Replaces the worker's network APIs with ones that throw `NETWORK_BLOCKED_MESSAGE`. Safe to call repeatedly. */
export function blockNetwork(options: BlockNetworkOptions = {}): void {
  if (blocked) return;
  blocked = true;
  const scope = globalThis as unknown as Record<string, unknown>;
  const realFetch = typeof scope.fetch === 'function' ? (scope.fetch as Fetch).bind(globalThis) : null;
  for (const name of BLOCKED_GLOBALS) {
    // Leave missing ones missing, so feature checks such as `typeof WebTransport` still say so.
    if (name in scope) define(scope, name, networkBlocked);
  }
  if (realFetch && options.allowFetch) define(scope, 'fetch', guardedFetch(realFetch, options.allowFetch));
  for (const name of REMOVED_GLOBALS) {
    if (name in scope) define(scope, name, undefined);
  }
  const navigator = scope.navigator as Record<string, unknown> | undefined;
  if (navigator && typeof navigator.sendBeacon === 'function') define(navigator, 'sendBeacon', networkBlocked);
}
