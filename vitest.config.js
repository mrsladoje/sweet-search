import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    // Prevent V8 Turboshaft WASM background compilation OOM when loading
    // multiple tree-sitter grammars (cpp=4.4M, kotlin=3.9M, swift=3M).
    execArgv: ['--no-wasm-tier-up', '--no-wasm-dynamic-tiering', '--v8-pool-size=1'],
    include: ['tests/**/*.test.js', 'evaluation/__tests__/**/*.test.js'],
    exclude: ['node_modules', 'dist', 'tests/embedding/embedding-perf.test.js'],
    testTimeout: 30000,
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['core/**/*.js', 'core/**/*.mjs'],
      exclude: ['node_modules/**', 'vitest.config.js'],
    },
    benchmark: {
      include: ['scripts/benchmark*.js', 'training/benchmark*.js', 'eval/scripts/*bench*.js', '__tests__/**/*.bench.js'],
      outputFile: '.sweet-search/benchmark-results.json',
    },
  },
});
