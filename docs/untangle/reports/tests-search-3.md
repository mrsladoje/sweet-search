# tests-search-3 report

1. Counts: 26 test files -> 26. `it` blocks 529 -> 527 (vitest: 533 -> 531 incl. 2 skipped). Two full runs pass (531 passed, 2 skipped).
2. Removed (rule 3, both only check that an import has exports; other tests import the same modules):
   - tests/search/review-fixes.test.js "vocab-warmer module loads successfully" (covered by tests/vocabulary/vocab-warmer.test.js).
   - tests/search/review-fixes.test.js "community-detector module exports detectCommunities" (covered by tests/graph/community-detector.test.js).
3. Rewritten: tests/search/search-pattern.test.js bareGrep "returns empty grep results when no files match": it grepped the whole repository root (process.cwd(), 1.6 s); it now greps a one-file temp directory and removes it.
4. Flaky / environment: none found. Note: two patternSearch tests ("degrades to unranked results...", "returns at most k results...") use the real repository index, real ripgrep and the real lateon-code query encoder (~1.2 s load). A temp project root made them return 0 results, because patternSearch reads the repository's sparse-gram index. I reverted that attempt. They depend on this machine having the model.
5. Speed: search-pattern.test.js 10.5 s (suite measure) -> 4.15 s alone before, 2.97 s after (the 1.6 s repo grep is gone). The remaining ~1.2 s is the real encoder load. All other files are under 1 s. tests/search/query-encoder.test.js is not in this package's list, so I did not touch it.
6. Kept source-text tests: none in this package.
   Skips kept: read-semantic-daemon-parity socket round trip (opt-in env flag plus local m2crb index); search-pattern-native-grep (native grep addon absent); ripgrep-resilience and search-pattern `skipIf(!rgAvailable)` (ripgrep absent). All are optional-dependency gates.
   Other tests left: weak `toBeDefined()` uses in search-postprocess*, search-fusion, search-boost sit next to real value assertions in the same test.
7. Needs a product seam: search-pattern.test.js patternSearch tests above would need patternSearch to take its sparse-gram index from the searcher (not the repository) to run on a fixture and a stubbed encoder.
8. Leftover processes: none from my runs. One short-lived sweet-search-daemon (PID 64053, cwd .../T/ss-daemon-life-plS3Sx) belongs to another agent's test.
