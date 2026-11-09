# tests lower-layers-2 report

1. Counts: 41 test files -> 41. Tests 919 -> 916 (3 removed, all in query-router-3class). Final run: 41 files, 916 passed, 2.2 s.

2. Removed
- tests/query/query-router-3class.test.js, "should not have STRUCTURAL in reject option thresholds": rule 3 (+2). Read `core/query-router-catboost.js`, a path that no longer exists (moved to core/query/); the try/catch swallowed the read error, so it could never fail. Behavior covered by "should never return structural mode" and the LABELS tests in the same file.
- same file, "should not contain STRUCTURAL_PATTERNS" and "should document structural as opt-in only": rule 3 (+2). Same dead path `core/query-router.js`, same swallowed error; the second asserted a comment word. Behavior covered by the same "never return structural mode" test.

3. Rewritten
- tests/query/query-router-3class.test.js: loaded the router in `beforeEach` inside try/catch and every test started with `if (!X) return`, so a broken import silently passed. Now a static import; tests fail loudly if the router is missing.
- tests/vector-store/binary-hnsw-int8-map-widths.test.js "maps the same rows...": `if (!hasMap()) return` became `it.skipIf(!hasMap())` with the condition in the name (optional native addon gate).

4. Fixed flaky / environment-dependent: none found.

5. Speed (quiet-run seconds from the list -> now, measured alone; other agents load the machine)
- binary-hnsw-deterministic-levels: 4.0 -> 0.75-0.83. The save/load round trip built 120 nodes with 120 save+load cycles (1.2 s); now 40 nodes (still checks the entry-point tie-break across a save/load cycle). The 20000-id range test did 60000 `expect` calls; now it tracks min/max/integer and asserts once (same check).
- binary-hnsw-native-parity 2.6, binary-hnsw-delta 1.4, full-vector-file 1.1, tree-sitter-doc-comments 0.9: left. Alone they run in 0.15-0.4 s per heavy test; time is native import and real index builds. Native parity guards research results: unchanged.
- Whole package: 41 files in 2.16 s.

6. Kept source-text tests: none remain. Only query-router-3class read product source (removed above). The other READS_PRODUCT_SOURCE flags (segment-mmap, li-alias-sidecar, delta, int8-map-widths, float-vector-store, full-vector-file) read files the tests themselves produced (index/segment/sidecar output), which is behavior, not product source: kept.

7. Needs a product seam: none.

Kept on purpose (not changed):
- Skips: late-interaction-segment-mmap (2), binary-hnsw-native-parity (4), binary-hnsw-parallel-build (1), full-vector-file (1) are all optional native addon gates: kept.
- Silent `if (!native) return` in binary-hnsw-index-file ("a load leaves out the code slab") and binary-hnsw-int8-map-widths K4 tests: no-addon guards inside a test that also checks non-native parts; kept.
- Parity tests (simd-distance, binary-hnsw-native-parity, query router, deterministic-levels hash value): unchanged in meaning.
- Not deeply audited line by line for rule 1: the large files (flashrank, file-kind-ranking, intent-router, vocab-*, ss-argparse). A scan for `.todo`, commented-out tests, empty catch and import-only assertions found nothing to remove; weak `toBeDefined` checks are paired with other assertions or I could not prove them useless, so kept.

8. Leftover processes: none checked as none started (tests here spawn no daemons).
