import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'server/test/**/*.test.ts', 'client/src/**/*.test.ts'],
    environment: 'node',
    // Each test file gets its own module graph, so every server test file has a fresh in-memory database.
    env: { DATABASE_PATH: ':memory:', NODE_ENV: 'test' },
  },
});
