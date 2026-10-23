import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type RequestHandler } from 'express';
import { loadUser } from './auth';
import { config } from './config';
import { errorHandler, HttpError, notFound } from './http';
import { router as adminUsersRouter } from './routes/adminUsers';
import { router as assignmentsRouter } from './routes/assignments';
import { router as authRouter } from './routes/auth';
import { router as classesRouter } from './routes/classes';
import { router as dashboardRouter } from './routes/dashboard';
import { router as languagesRouter } from './routes/languages';
import { router as projectsRouter } from './routes/projects';
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

/** CSRF defence in depth (cookies are also SameSite=Lax): state-changing API calls must carry our header. */
const requireApiHeader: RequestHandler = (req, _res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-codeclass') !== '1') {
    throw new HttpError(403, 'Missing request header');
  }
  next();
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(isolationHeaders);

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(cookieParser());
  api.use(requireApiHeader);
  api.use(loadUser);
  api.use(setupRouter);
  api.use(authRouter);
  api.use(adminUsersRouter);
  api.use(languagesRouter);
  api.use(classesRouter);
  api.use(rosterRouter);
  api.use(assignmentsRouter);
  api.use(submissionsRouter);
  api.use(projectsRouter);
  api.use(dashboardRouter);
  api.use(() => {
    throw notFound('Unknown API route');
  });
  api.use(errorHandler);
  app.use('/api', api);

  // Production: serve the built client and fall back to index.html for client-side routes.
  if (config.isProd && fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }
  return app;
}
