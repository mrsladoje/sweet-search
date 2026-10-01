import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    // Prevent V8 Turboshaft WASM background compilation OOM when loading
    // multiple tree-sitter grammars (cpp=4.4M, kotlin=3.9M, swift=3M).
    execArgv: ['--no-wasm-tier-up', '--no-wasm-dynamic-tiering', '--v8-pool-size=1'],
    include: ['tests/**/*.test.js'],
    // `init` records each repo for `uninstall --all`. Tests must never write
    // temp repos into the developer's real ~/.cache/sweet-search/repos.json.
    env: {
      SWEET_SEARCH_REPO_REGISTRY: join(tmpdir(), `sweet-search-test-repos-${process.pid}.json`),
      // The Claude Code rules-layout switch (write-claude-rules.js) must not leak in from the
      // developer's shell: tests assert the product default and pass the switch explicitly.
      SS_VARIANT_CC_RULES_IN_PROMPT: '',
      // Same for the opencode cache-key switches (install-opencode-harness.js, opencode-cache-key-plugin.mjs).
      SWEET_SEARCH_OC_CACHE_KEY: '',
      SWEET_SEARCH_OC_CACHE_SHARDS: '',
    },
    // Kill fixture processes orphaned by timed-out tests, before a run starts
    // and again after it ends. A run that inherits the previous run's orphans
    // measures machine load instead of the code under test — see the file
    // header for the feedback loop this breaks.
    globalSetup: ['tests/setup/reap-test-fixtures.js'],
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
