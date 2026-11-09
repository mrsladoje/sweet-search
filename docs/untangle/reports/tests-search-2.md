# tests-search-2 report

1. Counts: 28 test files, 577 tests (it blocks) before -> after. Nothing removed. Both runs: 28 files, 577 passed.
2. Removed: none.
3. Rewritten: none.
4. Fixed flaky / environment-dependent: tests/search/query-encoder.test.js, two model tests. Both ended with `catch { return; }`, which passed silently when models were absent. They now call ctx.skip() with the cause stated in a comment (models not installed on this machine).
5. Speed:
   - query-encoder.test.js: 17.7 s -> 13.2 s (full run measured alone; the 55 s in the list was under load). Both tests loaded the in-process reference models; the reference vectors are now computed once per file (inProcessBaseline). The rest is real model loads in the child process, kept on purpose (child spawn, idle exit after 1.5 s, restart).
   - prefilter-literal-heuristic.test.js: 6.8 s -> 2.9 s in the same run as grep-unindexed-fallback (both alone-fast; earlier numbers were load). Seeded property test takes 0.9 s. Left as is.
   - grep-unindexed-fallback.test.js: 4.5 s -> ~1.8 s (about 100 ms per test, real git temp repos). Left as is.
   - daemon-lifecycle.integration.test.js is not in my list (assigned to indexing-2 / search-1); not touched.
6. Kept source-text tests: none. No file in this package reads product source as text. legacy-mode-dormant-paths.test.js spies fs.readFileSync at runtime (behavior: counts manifest probes), kept.
7. Needs a product seam: none.
8. Skips / disabled: grep-path-globs (skipIf no rg), grep-symlink-alias (runIf native sparse-gram), prefilter-literal-heuristic (runIf rg / native grep): all real optional-dependency gates, kept. No it.skip or todo.
   Reviewed for rules 1/3: the toBeDefined hits are followed by value assertions or guard a .find() result; ss-grep output-byte tests (grep-output-shaping, grep-line-classes etc.) kept because of the Rust lane contract.
9. Leftover processes: none (pgrep for maintainer/daemon/encoder empty).
