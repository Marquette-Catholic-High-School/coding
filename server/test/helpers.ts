// Test helpers: start the real Express app on a random port against an in-memory DB (see vitest.config.ts).

import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Role } from '@codeclass/shared';
import { createApp } from '../src/app';
import { createSessionToken, hashPassword } from '../src/auth';
import { db } from '../src/db';

export interface TestResponse<T = any> {
  status: number;
  body: T;
}

/** Minimal API client that keeps the session cookie between calls. */
export class TestClient {
  cookie = '';
  constructor(private base: string) {}

  async request<T = any>(method: string, path: string, body?: unknown): Promise<TestResponse<T>> {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        'x-codeclass': '1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const sid = /sid=([^;]*)/.exec(setCookie)?.[1];
      this.cookie = sid ? `sid=${sid}` : '';
    }
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }
  get<T = any>(path: string) { return this.request<T>('GET', path); }
  post<T = any>(path: string, body: unknown = {}) { return this.request<T>('POST', path, body); }
  put<T = any>(path: string, body: unknown = {}) { return this.request<T>('PUT', path, body); }
  patch<T = any>(path: string, body: unknown = {}) { return this.request<T>('PATCH', path, body); }
  delete<T = any>(path: string) { return this.request<T>('DELETE', path); }
}

export async function startTestServer() {
  const server = createApp().listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return {
    base,
    /** A fresh, signed-out client. */
    client: () => new TestClient(base),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let counter = 0;

/** Inserts a user directly (bypassing the API). Password is "password123". */
export function insertUser(role: Role, overrides: { username?: string; name?: string; email?: string | null } = {}) {
  counter += 1;
  const username = overrides.username ?? `${role}${counter}`;
  const info = db
    .prepare('INSERT INTO users (username, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(username, overrides.email ?? null, overrides.name ?? `Test ${role} ${counter}`, role, hashPassword('password123'));
  return { id: Number(info.lastInsertRowid), username, password: 'password123' };
}

/** A client already signed in as `userId` (session created directly, independent of the auth routes). */
export function clientAs(base: string, userId: number): TestClient {
  const client = new TestClient(base);
  client.cookie = `sid=${createSessionToken(userId)}`;
  return client;
}

/** Inserts an installed language row directly. */
export function insertLanguage(id: string, kind: string, extra: { config?: unknown; ownerId?: number | null; enabled?: boolean } = {}) {
  db.prepare('INSERT INTO languages (id, kind, name, enabled, config, owner_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    kind,
    id,
    extra.enabled === false ? 0 : 1,
    extra.config === undefined ? null : JSON.stringify(extra.config),
    extra.ownerId ?? null,
  );
}
