import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.js', 'evaluation/__tests__/**/*.test.js', 'tests/**/*.test.js'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 60000,
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
