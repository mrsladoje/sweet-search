# restore-embed-vocab-query
Blocks reviewed: 50. Restored fully: 1 (17). Restored in part: 1 (38). Left removed: 48.
Also restored from full-diff review of the three cut files: vocab-miner.js (PageRank, in-degree hub detection, base score, hub bonus, leaf penalty comments), vocab-ranker.js (MULTIPLIERS doc, "only apply private penalty if no stronger signal").
Removed in embedding-remote.js full diff: banners and JSDoc only, nothing restored.

17 restored (flush threshold, avoids per-query I/O)
38 restored in part (description and PageRank weighting lines; @param left removed)
39 restored (PageRank importance scoring)
40 restored (hub bonus)
All other blocks (1-16, 18-37, 41-50): left removed (banner / restatement / reason kept nearby). 21: boost values still in code. 22: current text describes behavior. 50: reason kept in current header.
