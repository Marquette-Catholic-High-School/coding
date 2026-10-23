import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Cross-origin isolation enables SharedArrayBuffer, which the code runners use for interactive input().
// The production server sends the same headers (server/src/app.ts).
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
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
