import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// blockNetwork() changes globals for good, so every test loads a fresh copy of the module and puts the globals back.
const NAMES = ['fetch', 'WebSocket', 'BroadcastChannel', 'XMLHttpRequest', 'caches', 'Worker'] as const;
const scope = globalThis as unknown as Record<string, unknown>;
let saved: Map<string, PropertyDescriptor | undefined>;

async function load() {
  vi.resetModules();
  return import('./lang/network');
}

beforeEach(() => {
  saved = new Map(NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
});

afterEach(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete scope[name];
  }
});

describe('blockNetwork', () => {
  it('replaces the network APIs with ones that explain why they are off', async () => {
    const realFetch = vi.fn(async () => new Response('secret'));
    scope.fetch = realFetch;
    scope.XMLHttpRequest = class {};
    scope.caches = { open: () => null };
    const { blockNetwork, NETWORK_BLOCKED_MESSAGE } = await load();
    blockNetwork();
    const fetchFromProgram = scope.fetch as (url: string, init?: unknown) => unknown;
    expect(() => fetchFromProgram('/api/assignments/1', { method: 'PATCH' })).toThrow(NETWORK_BLOCKED_MESSAGE);
    expect(() => new (scope.XMLHttpRequest as new () => unknown)()).toThrow(NETWORK_BLOCKED_MESSAGE);
    if (typeof WebSocket !== 'undefined' || saved.get('WebSocket')) {
      expect(() => new (scope.WebSocket as new (url: string) => unknown)('ws://localhost/')).toThrow(NETWORK_BLOCKED_MESSAGE);
    }
    expect(scope.caches).toBeUndefined();
    expect(realFetch).not.toHaveBeenCalled();
  });

  it('leaves missing APIs missing', async () => {
    delete scope.Worker;
    const { blockNetwork } = await load();
    blockNetwork();
    expect('Worker' in globalThis).toBe(false);
  });

  it('lets fetch reach allowed URLs only, checking the URL that is actually requested', async () => {
    const realFetch = vi.fn(async (_input: unknown) => new Response('ok'));
    scope.fetch = realFetch;
    const { blockNetwork, NETWORK_BLOCKED_MESSAGE } = await load();
    const cdn = 'https://cdn.jsdelivr.net/pyodide/v1/full/';
    blockNetwork({ allowFetch: (url) => url.href.startsWith(cdn) });
    const guarded = scope.fetch as (input: unknown) => Promise<Response>;
    await expect(guarded(`${cdn}numpy.whl`)).resolves.toBeInstanceOf(Response);
    expect(realFetch).toHaveBeenLastCalledWith(`${cdn}numpy.whl`, undefined);
    await expect(guarded('/api/me')).rejects.toThrow(NETWORK_BLOCKED_MESSAGE);
    await expect(guarded(`${cdn}../../../npm/x`)).rejects.toThrow(NETWORK_BLOCKED_MESSAGE);
    await expect(guarded(new Request('https://example.com/'))).rejects.toThrow(NETWORK_BLOCKED_MESSAGE);
    // An object that names the CDN to the check and the API to fetch gets the checked URL.
    let calls = 0;
    const shifty = { toString: () => (calls++ === 0 ? `${cdn}a.whl` : 'https://evil.example/') };
    await guarded(shifty);
    expect(realFetch).toHaveBeenLastCalledWith(`${cdn}a.whl`, undefined);
    expect(realFetch).toHaveBeenCalledTimes(2);
  });
});
