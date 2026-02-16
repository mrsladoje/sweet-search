import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    include: ['__tests__/**/*.test.js', 'evaluation/__tests__/**/*.test.js', 'tests/**/*.test.js'],
    exclude: ['node_modules', 'dist', 'tests/embedding-perf.test.js'],
    testTimeout: 30000,
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['*.js'],
      exclude: ['__tests__/**', 'node_modules/**', 'vitest.config.js'],
    },
    benchmark: {
      include: ['__tests__/**/*.bench.js'],
      outputFile: '../../../.sweet-search/benchmark-results.json',
    },
  },
});
