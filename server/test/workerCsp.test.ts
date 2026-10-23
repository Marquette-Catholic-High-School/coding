// Production static serving: the code-runner worker script gets its own Content-Security-Policy, so student code
// can only reach the Pyodide CDN and /assets/ (wasm), never /api.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { startTestServer } from './helpers';

vi.mock('../src/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/config')>();
  const [{ mkdtempSync }, { tmpdir }, { join }] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  const clientDist = mkdtempSync(join(tmpdir(), 'codeclass-dist-'));
  return { config: { ...original.config, isProd: true, clientDist } };
});

const dist = config.clientDist;

let srv: Awaited<ReturnType<typeof startTestServer>>;
let origin: string;
beforeAll(async () => {
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>CodeClass</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'worker-mDjuYiji.js'), 'self.onmessage = () => {};');
  fs.writeFileSync(path.join(dist, 'assets', 'index-CURt3OnL.js'), 'console.log(1);');
  srv = await startTestServer();
  origin = srv.base.replace(/\/api$/, '');
});
afterAll(async () => {
  await srv.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

function directives(csp: string | null): Record<string, string[]> {
  return Object.fromEntries(
    (csp ?? '').split(';').map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name!, sources];
    }),
  );
}

describe('runner worker CSP', () => {
  it('limits the worker to its own origin and the Pyodide CDN, with no nested workers', async () => {
    const res = await fetch(`${origin}/assets/worker-mDjuYiji.js`);
    expect(res.status).toBe(200);
    const csp = directives(res.headers.get('content-security-policy'));
    expect(csp['default-src']).toEqual(["'none'"]);
    expect(csp['script-src']).toEqual(
      expect.arrayContaining(["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net']),
    );
    expect(csp['connect-src']).toEqual(["'self'", 'https://cdn.jsdelivr.net']);
    expect(csp['worker-src']).toEqual(["'none'"]);
    expect(csp['child-src']).toEqual(["'none'"]);
    // Cross-origin isolation still applies to the worker.
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  });

  it('ignores forwarded headers (nothing request-controlled goes into the policy)', async () => {
    const plain = (await fetch(`${origin}/assets/worker-mDjuYiji.js`)).headers.get('content-security-policy');
    const forwarded = await fetch(`${origin}/assets/worker-mDjuYiji.js`, {
      headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': "* http; connect-src *" },
    });
    expect(forwarded.headers.get('content-security-policy')).toBe(plain);
  });

  it('leaves other files and the page alone', async () => {
    expect((await fetch(`${origin}/assets/index-CURt3OnL.js`)).headers.get('content-security-policy')).toBeNull();
    const page = await fetch(`${origin}/classes`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toBeNull();
  });
});
