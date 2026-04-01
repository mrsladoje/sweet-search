# DDD Fix Plan — Phase 0 Baseline

**Date**: 2026-04-01
**Test suite**: 130 files, 3270 tests

## Known Failing Tests (4)

### 1. cli-flags.integration.test.js:242
- **Test**: `--files-from-stdin with --quiet > should produce structured JSON output when no files provided`
- **Error**: `parseQuietOutput` returns null — stdin+quiet mode produces no parseable JSON
- **Classification**: Pre-existing CLI output bug
- **Root cause**: `--quiet --files-from-stdin` with empty input does not produce JSON

### 2. flag-semantics.test.js:311
- **Test**: `--quiet should suppress progress output`
- **Error**: `[MaxSim] Tier 1: Native Rust + Rayon` leaks into stdout under `--quiet`
- **Classification**: Pre-existing CLI output bug
- **Root cause**: MaxSim native loader writes to stdout before quiet mode is established

### 3. local-reranker.test.js:234
- **Test**: `rerankBatched > should set source to batched variant`
- **Error**: Source is `local-gte-modernbert-int8` instead of `local-gte-modernbert-int8-batched`
- **Classification**: Pre-existing test expectation mismatch
- **Root cause**: `rerankBatched` delegates to `_doRerank` which uses same source as `rerank`

### 4. local-reranker.test.js:249
- **Test**: `shutdown > should reset state`
- **Error**: `reranker.model` is `'mock'` instead of `null` after shutdown
- **Classification**: Pre-existing test expectation mismatch
- **Root cause**: Test expects `this.model = null` but implementation uses `this.session`, not `this.model`

## Classification Summary

| Category | Count |
|----------|-------|
| Migration-caused regressions | 0 |
| Pre-existing CLI bugs | 2 |
| Pre-existing test mismatches | 2 |
| Environment-sensitive | 0 |

## Vitest Config Fixes Applied

- **Coverage include**: `['*.js']` → `['core/**/*.js', 'core/**/*.mjs']` (was missing all domain code)
- **Benchmark include**: `['__tests__/**/*.bench.js']` → `['scripts/benchmark*.js', 'training/benchmark*.js', 'eval/scripts/*bench*.js']` (matched actual locations)

## Verification Gates

Phase completion requires:
- [ ] `npm run build` passes
- [ ] Coverage instrumentation includes `core/` domains
- [ ] No new test regressions introduced
- [ ] Boundary checker runs without error
