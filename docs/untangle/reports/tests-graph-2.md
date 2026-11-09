# tests-graph-2 report

1. Counts: 40 test files -> 40; 625 `it` blocks (vitest count, incl. generated) -> 625.
2. Removed: none. No test copies an implementation, no test lacks assertions, no disabled tests (no skip/todo/commented tests).
3. Rewritten: tests/graph/tags-queries-all-languages.test.js, "<lang> query parses without error against its grammar" (7 generated tests). Before: `if (!language) return;` passed silently when a grammar did not load (rule 3). Now: `expect(language, "<lang> grammar must load").toBeTruthy()`. All 7 grammars load here and are bundled, so this is not an environment gate.
4. Fixed flaky/env-dependent: none found. All files use temp dirs, no machine caches, no timing assertions.
5. Speed: no file is slower than 3 s when run alone. structural-context.test.js measured 3.8 s in the quiet full run; alone it ran 2.4 s and 1.75 s (tests 1.1-1.7 s, rest is import/transform). Time is real SQLite fixture build per test (22 tests, ~100-340 ms each), no waits; left as is, sharing the fixture would risk order dependence. receiver-type-resolution (2.2 s), trace-fan-and-qualified-hints (2.3 s), trace-type-sites (2.2 s): real extraction + graph build, no sleeps. Whole package: 5.8-7.1 s wall for 40 files.
6. Kept source-text tests: none exist. token-estimation-integration.test.js carries the READS_PRODUCT_SOURCE flag in error: its `readFileSync` reads fixture files the test writes to a temp dir, not product source.
7. Needs a product seam: none.
   Notes on kept mock tests: tags-scm-extraction.test.js (spies on the real tree-sitter provider) and token-estimation.test.js (injected readFileLines) also assert on produced entities / budget stats, so they check behavior; kept.
8. Leftover processes: none from my runs (one sweet-search PID 47204 was seen by pgrep, it had exited by the time I queried it; not started by these tests, which spawn no daemon).
Verification: `npx vitest run` on all 40 files passed twice (625/625); `node --check` ok on the edited file.
