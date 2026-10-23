import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';

// Cross-origin isolation enables SharedArrayBuffer, which the code runners use for interactive input().
// The production server sends the same headers (server/src/app.ts).
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * Content-Security-Policy for the code-runner worker script (a worker's CSP comes from its own script response): the
 * dev twin of the production policy in server/src/app.ts. https://cdn.jsdelivr.net is the Pyodide CDN
 * (PYODIDE_INDEX_URL). In production connect-src is limited to the built /assets/; in dev the wasm files come from
 * node_modules, so it allows 'self'.
 */
const RUNNER_WORKER_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "connect-src 'self' https://cdn.jsdelivr.net",
].join('; ');

/** The runner worker: `/src/runtime/worker.ts?worker_file&type=module` in dev, `/assets/worker-<hash>.js` when built. */
function isRunnerWorker(url = ''): boolean {
  return url.includes('worker_file') || /^\/(src\/runtime\/worker\.ts|assets\/worker-[\w-]+\.js)/.test(url);
}

const runnerWorkerCsp: Connect.NextHandleFunction = (req, res, next) => {
  if (isRunnerWorker(req.url)) res.setHeader('Content-Security-Policy', RUNNER_WORKER_CSP);
  next();
};

function runnerWorkerCspPlugin(): Plugin {
  return {
    name: 'codeclass-runner-worker-csp',
    configureServer: (server) => void server.middlewares.use(runnerWorkerCsp),
    configurePreviewServer: (server) => void server.middlewares.use(runnerWorkerCsp),
  };
}

export default defineConfig({
  plugins: [react(), runnerWorkerCspPlugin()],
  server: {
    port: 5173,
    headers: isolationHeaders,
    proxy: { '/api': 'http://localhost:3001' },
  },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['sql.js', 'wasmoon'] },
  build: { chunkSizeWarningLimit: 1500 },
});
