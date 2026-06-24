import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    // On the resource-constrained macOS GitHub runner (~3 vCPU / 7 GB), the
    // default per-core worker count lets the heavy integration tests — each
    // spawning its own indexer / server / native-addon subprocess — starve one
    // another into nondeterministic timeouts and racy I/O (different tests fail
    // each run; all pass locally and on Linux CI). Cap concurrency there so the
    // macOS smoke-test is reliable. Linux CI and local dev keep full parallelism.
    // (Vitest 4: maxWorkers/minWorkers are top-level — poolOptions was removed.)
    ...((process.platform === 'darwin' && process.env.CI) ? { maxWorkers: 1, minWorkers: 1 } : {}),
    // Prevent V8 Turboshaft WASM background compilation OOM when loading
    // multiple tree-sitter grammars (cpp=4.4M, kotlin=3.9M, swift=3M).
    execArgv: ['--no-wasm-tier-up', '--no-wasm-dynamic-tiering', '--v8-pool-size=1'],
    include: ['tests/**/*.test.js'],
    exclude: [
      'node_modules', 'dist',
      'tests/embedding/embedding-perf.test.js',
      // Heavy ORT-loading tests (~23s each). Run with: npm run test:extra
      ...(process.env.SWEET_SEARCH_EXTRA_TESTS ? [] : [
        'tests/embedding/direct-ort-bypass.test.js',
        'tests/embedding/embedding-correctness.test.js',
      ]),
    ],
    testTimeout: 30000,
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['core/**/*.js', 'core/**/*.mjs'],
      exclude: ['node_modules/**', 'vitest.config.js'],
    },
    benchmark: {
      include: ['scripts/benchmark*.js', 'core/training/query-router/benchmark*.js', 'eval/scripts/*bench*.js', '__tests__/**/*.bench.js'],
      outputFile: '.sweet-search/benchmark-results.json',
    },
  },
});
