import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Request, type RequestHandler, type Response } from 'express';
import { PYODIDE_INDEX_URL } from '@codeclass/shared';
import { hasCsrfToken, loadUser, requireSameAccount } from './auth';
import { config } from './config';
import { db } from './db';
import { csrfRefused, errorHandler, HttpError, notFound } from './http';
import { router as adminUsersRouter } from './routes/adminUsers';
import { router as assignmentsRouter } from './routes/assignments';
import { router as authRouter } from './routes/auth';
import { router as classesRouter } from './routes/classes';
import { router as dashboardRouter } from './routes/dashboard';
import { router as invitesRouter } from './routes/invites';
import { router as languagesRouter } from './routes/languages';
import { router as projectsRouter } from './routes/projects';
import { router as reportsRouter } from './routes/reports';
import { router as rosterRouter } from './routes/roster';
import { router as setupRouter } from './routes/setup';
import { router as submissionsRouter } from './routes/submissions';

/**
 * Cross-origin isolation lets the in-browser runners use SharedArrayBuffer for interactive input().
 * Every response must carry these headers (Vite sets the same ones in dev).
 */
const isolationHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
};

/** Endpoints a signed-out visitor uses (setup, sign-in, registration, join preview): no anti-CSRF token needed. */
function isSignedOutEndpoint(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return req.path === '/setup' || /^\/join\/[^/]+$/.test(req.path);
  return req.method === 'POST' && (req.path === '/setup' || req.path === '/auth/login' || req.path === '/auth/register');
}

/**
 * CSRF defence (cookies are also SameSite=Lax). State-changing API calls must carry `x-codeclass: 1`. Every call made
 * with a valid session, GET included, must also echo the session's anti-CSRF token in `x-codeclass-token`. Student code
 * that a teacher runs (Autograde, Run on the grading page, preview) executes in a Web Worker on our origin, whose
 * requests carry the teacher's session cookie; workers can't read the `cc_csrf` cookie, so those requests fail here.
 */
const requireCsrfToken: RequestHandler = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-codeclass') !== '1') {
    throw new HttpError(403, 'Missing request header');
  }
  if (req.user && !isSignedOutEndpoint(req) && !hasCsrfToken(req, res)) throw csrfRefused();
  next();
};

/** Origin of the Pyodide CDN that the Python runner loads its runtime and packages from. */
const PYODIDE_ORIGIN = new URL(PYODIDE_INDEX_URL).origin;

/**
 * Content-Security-Policy for the code-runner worker script (a worker's CSP comes from its own script response).
 * Student code may only reach our own origin (the sql.js / wasmoon wasm under /assets/) and the Pyodide CDN, so it can't
 * send anything elsewhere, and it can't start nested workers. Same-origin `/api` calls from a worker are refused by
 * `requireCsrfToken` because workers can't read the token cookie. Same policy as the dev server (client/vite.config.ts).
 */
const RUNNER_WORKER_CSP = [
  "default-src 'none'",
  `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' ${PYODIDE_ORIGIN}`,
  `connect-src 'self' ${PYODIDE_ORIGIN}`,
  "worker-src 'none'",
  "child-src 'none'",
].join('; ');

/** The built runner worker, e.g. `assets/worker-mDjuYiji.js`. */
const RUNNER_WORKER_FILE = /[\\/]assets[\\/]worker-[\w-]+\.js$/;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(isolationHeaders);

  const api = express.Router();
  // Liveness check for install/update scripts and monitoring: no session, and it proves the database answers.
  api.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  api.use(express.json({ limit: '1mb' }));
  api.use(cookieParser());
  api.use(loadUser);
  api.use(requireCsrfToken);
  api.use(requireSameAccount);
  api.use(setupRouter);
  api.use(authRouter);
  api.use(adminUsersRouter);
  api.use(languagesRouter);
  api.use(classesRouter);
  api.use(rosterRouter);
  api.use(invitesRouter);
  api.use(assignmentsRouter);
  api.use(submissionsRouter);
  api.use(projectsRouter);
  api.use(dashboardRouter);
  api.use(reportsRouter);
  api.use(() => {
    throw notFound('Unknown API route');
  });
  api.use(errorHandler);
  app.use('/api', api);

  // Production: serve the built client and fall back to index.html for client-side routes.
  if (config.isProd && fs.existsSync(config.clientDist)) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res: Response, filePath) => {
          if (RUNNER_WORKER_FILE.test(filePath)) res.setHeader('Content-Security-Policy', RUNNER_WORKER_CSP);
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }
  return app;
}
