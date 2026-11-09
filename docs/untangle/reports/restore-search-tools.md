# restore-search-tools
Reviewed 40 blocks (a 17, b 3, c1 11, c2 3, tools-mcp 6). Restored fully: 12. Restored in part: 1. Left removed: 27.
Verify: problems 0, node --check and eslint clean.

## search-a
1 left (phase list restates code)
2 left (banner-like, restates)
3 restored (Python multi-line rule)
4 restored (Rust multi-line rule)
5 left (covered in docblock)
6 left (restates filter)
7 restored, moved above packageForAgent (orphan JSDoc; k and ablation contract)
8 left (restates; DDD stated elsewhere)
9 left (reason still stated)
10 left (restates condition)
11 left (restates filter)
12 restored (re-sort reason)
13 left (shortened, reason kept)
14 left (old fix label)
15 left (reason kept in place)
16 restored in part (fixes 1-3 lines; banner and header omitted)
17 restored (float store replaces SQLite)
## search-b
1 restored (decision dates)
2 left (banner)
3 left (banner)
## search-c1
1 left (line-limit split note)
2 left (banner)
3 left (line-limit split note)
4 left (line-limit split note)
5 left (line-limit split note)
6 restored (race-safe reason, banner dropped)
7 left (banner)
8 left (history comparison)
9 restored (native vs ripgrep contract)
10 restored (same)
11 left (reason kept in place)
## search-c2
1 left (section label)
2 left (section label)
3 left (section label)
## tools-mcp
1 restored (argparse split reason)
2 restored (npm install fact)
3 left (reason kept in place)
4 left (banner)
5 left (banner)
6 restored (F-11 timeout reason)

## Extra jobs
- core/search/search-anchor.js: findChunkForEntity JSDoc moved from above bucketDocsByFile to above findChunkForEntity, unchanged.
- core/search/packaging/graph-neighbors.js: extractTypeCandidates JSDoc moved from above goUnexportedElsewhere to above extractTypeCandidates, unchanged.
- Not touched, for another reviewer: core/ranking/file-kind/query-analysis.js (mega-chunk/symbol-exact blocks above unrelated code) and core/ranking/late-interaction-index.js (CPU-encoder block above countDocumentTokensCpu).
- run-agent-tool.mjs: anchor comments untouched.
