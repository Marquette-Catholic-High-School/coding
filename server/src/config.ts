import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  /**
   * Prod: one server on PORT (default 3000) serving API + built client.
   * Dev: API on API_PORT (default 3001) behind the Vite proxy — PORT is left to Vite.
   */
  port: isProd ? Number(process.env.PORT ?? 3000) : Number(process.env.API_PORT ?? 3001),
  /** Interface to listen on. Set HOST=127.0.0.1 behind a reverse proxy; unset means every interface. */
  host: process.env.HOST || undefined,
  dbPath: process.env.DATABASE_PATH ?? path.resolve(serverRoot, '../data/codeclass.db'),
  clientDist: path.resolve(serverRoot, '../client/dist'),
  sessionDays: 30,
  /** Set COOKIE_SECURE=1 when serving over HTTPS. */
  cookieSecure: process.env.COOKIE_SECURE === '1',
};
