# build-parity report

## 1. Done
- T1: `graphEntityLogicalId` hashed the same text (`${path}:${type}:${name}`, sha256, 16 hex) as `logicalEntityId`. Deleted it; both uses call `logicalEntityId`. Removed the unused `createHash` import. (production-reconciler.mjs)
- T2: reconciler `pickLiInput` and indexer-ann `pickLiInput` were identical. New module core/indexing/chunk-embed-text.js owns `pickLiInput`; indexer-ann.js re-exports it (export kept), indexer-build.js re-exports it, reconciler imports it from indexer-build.js (an import edge it already had; no new edge into core/indexing). encoder-input.mjs NOT unified (see questions).
- T4: chunk id: reconciler and `chunkFiles` formats are identical. `chunkIdOf(file, chunk, index)` in chunk-embed-text.js; used by indexer-build.js `chunkFiles` and the reconciler. Dense fallback embedding text and `embedTextOf` were identical in indexer-build.js and streaming-vectors.js: one `embedTextOf`. `chunkFilePath` (+ `firstSafeRelativePath`) was copied identically in indexer-build.js, indexer-ann.js and streaming-vectors.js: one copy now in chunk-embed-text.js.
- T5: `liWriterSettings(index)` exported from infrastructure/li-segment-merge.mjs; used by li-segment-merge.mjs, maintenance-handlers.mjs, production-li-delta.mjs (the 3 copied 9-field sets were identical: tokenDim, maxTokens, useInt8, quantBits, modelId, poolFactor, whtSeed, whtOrdering, matryoshkaDim).
- T7: `embedTextCap()` in chunk-embed-text.js replaces the parsers in indexer-build.js and streaming-vectors.js (identical: parseInt, finite, >=500, else 2000).
Files: core/indexing/{chunk-embed-text.js (new), indexer-ann.js, indexer-build.js, streaming-vectors.js}; core/incremental-indexing/application/{production-reconciler,production-li-delta,maintenance-handlers}.mjs; core/incremental-indexing/infrastructure/li-segment-merge.mjs.

## 2. Not done and why
- T3 `enrichChunksFromGraph`: NOT unified, results differ (below).
- T6 deny-dir list: NOT unified, lists differ (below).
- T7: the other two parsers are outside my file set: core/indexing/ast-chunker.js:47 (`getEmbedTextCap`, default `MAX_CHUNK_SIZE` = 2000) and core/indexing/chunking/chunk-builder.js:16. Both are identical in meaning to `embedTextCap()` and can import it.
- T5 indexer-ann.js ~347: builds the writer from config (`LATE_INTERACTION_CONFIG`, env quant/WHT), not from a LateInteractionIndex: fields tokenDim, maxTokens: 512, useInt8, quantBits, whtSeed, whtOrdering, modelId + indexPath/loadExisting/buildEvict/segmentSize; no poolFactor or matryoshkaDim in the ctor. Different source and field set: left alone. Also production-li-delta.mjs `manifestFromIndex` has its own field list with defaults (`matryoshkaDim || 0`, `quantBits || (useInt8 ? 8 : 32)`, `poolFactor || 1`, `whtSeed || 0`, `whtOrdering || 'natural'`): a manifest, not a ctor; left alone.

## 3. Behavior questions
### T2 encoder-input.mjs `pickLiInputText` (hash) vs `pickLiInput` (encode)
Language set: identical in content (`LI_TEXT_LANGS` = python, java, php, csharp, c#, kotlin, scala = python + JAVA_FAMILY).
Fallback order differs (domain/encoder-input.mjs:84-107 vs chunk-embed-text.js):
- encode, Java/python route: `li_text || embedding_text || text || content` ; hash: `liText || (embedding_text || text || content)` = same order.
- encode, default route: `li_greedy_text || embedding_text || li_text || text || content` ; hash: `liGreedy || (embedding_text || text || content) || liText`. Differs when li_greedy_text and embedding_text are empty and both li_text and text/content exist: encode reads li_text, hash covers text/content.
- null chunk: encode throws (`chunk.li_greedy_text` on null); hash returns ''.
`liInputHash` is used by both builds (indexer-build.js imports `chunkInputHashes`), so the hash may say "unchanged" for text the encoder would read differently. In practice embedding_text is nearly always non-empty, so the branch is rare. Making the hash call `pickLiInput` would change `li_input_hash` only for that rare shape; lead decides.
### T3 `enrichChunksFromGraph`
- indexer-build.js:47: opens DB_PATHS.codeGraph read-only; file path from `chunkFilePath(chunk)` (5 safe candidates); entity SQL `SELECT type,name,start_line,end_line FROM entities WHERE file_path = ? ORDER BY start_line ASC` (no epoch filter); file node id = `fileNodeId(filePath)` (backslash -> '/', basename); import SQL has no `epoch_retired` filter; per-file caches; returns count; errors propagate to the caller's try/catch (logged).
- production-reconciler.mjs:~226: tick connection `tickCtx.graphRoDb`; file path = `chunk.file || chunk.metadata?.relative_path`; entity SQL adds `AND epoch_retired IS NULL`; file node id: looks up the entity of type `file` for its name (fallback `path.basename(file)`), computes `logicalEntityId(file,'file',name)`, then maps logical -> physical id via `SELECT id FROM entities WHERE file_path=? AND logical_entity_id=? AND epoch_retired IS NULL ORDER BY epoch_written DESC LIMIT 1` (fallback logical id); import SQL adds `AND epoch_retired IS NULL`; no cache; errors swallowed (returns chunks unchanged); returns chunks.
Same scope-chain filter and `ASTChunker.enrichEmbeddingText` call. Epoch columns / id mapping make the SQL unavoidably different; path source and backslash normalisation also differ (a chunk with only `metadata.path` is enriched in the full build but skipped in the reconciler).
### T4 fallback embedding text and cap (reconciler production-reconciler.mjs ~1226 vs indexer-build `embedTextOf`)
- reconciler: `chunk.embedding_text || \`${rel}\n${chunk.text || chunk.content || ''}\``
- full build: `chunk.embedding_text.slice(cap)` else `\`${chunkFilePath(chunk)} ${chunk.metadata?.symbol || ''}\n${(text||content||'').slice(0, 1500)}\``
Differences: (a) reconciler does not cut `embedding_text` to the 2000 cap; (b) fallback separator is `\n` only (no space, no symbol); (c) no 1500-char cut. Real parity gap when `embedding_text` is empty (rare) or exceeds the cap after enrichment. Left as is.
### T6 deny-dir lists
- path-filter.mjs:41 `DEFAULT_DENY_DIRS_HARD` (15): node_modules, .git, .sweet-search, .next, .nuxt, vendor, __pycache__, .venv, venv, .cache, .turbo, coverage, .parcel-cache, .svelte-kit, .vercel.
- core/indexing/maintainer-watcher.mjs:64 `DEFAULT_DENY_DIRS` (13): same list WITHOUT `vendor` and `coverage`, on purpose (comment: grep corpus holds their git-visible files). Not identical; an exported constant would need the two exceptions stated. Left alone.
(A third list, `NO_GIT_SKIP_DIRS` in grep-corpus.js:39, differs again; not in my set.)

## T8 INSERT comparison (no code changed)
entities: full `insertGraph` (graph-extractor.js:3551): `INSERT OR REPLACE INTO entities (id, file_path, type, name, signature, signature_hash, doc_comment, start_line, end_line, package, parent_class, search_text, name_alias, parent_id, hierarchy_level)`, 15 values. Reconciler `insertEntity`: `INSERT INTO entities` (no OR REPLACE) with the same 15 columns plus `logical_entity_id` (= e.id), `epoch_written` (= epoch), `epoch_retired` NULL, `stale_since` NULL. Value derivations identical for the shared 15: `signature||null`, `signature_hash||null`, `doc_comment||null`, `start_line||null`, `end_line||null`, `package||null`, `parent_class||null`; search_text = [name,signature,doc_comment].filter(Boolean).join(' ').toLowerCase().slice(0,1000) in both; `name_alias = normalizeIdentifier(name) || null`; `hierarchy_level = entityHierarchyLevel(type)`; parent_id = `parentIds.get(e.id) ?? null` vs caller-supplied `parentId || null` (same value if the caller maps entityParentIds). Differences: id is the logical id in the full build, a physical id (`id` arg) in the reconciler; conflict clause differs (OR REPLACE vs plain INSERT, which throws on duplicate); extra epoch columns.
relationships: full: `INSERT INTO relationships (source_id, target_id, target_name, type, weight, context_line, full_import_path, is_static, is_wildcard)`, values `source_id||null, target_id||null, target_name, type, weight||1.0, context_line||null, full_import_path||null, is_static?1:0, is_wildcard?1:0`; skips empty target_name; errors swallowed (UNIQUE expected). Reconciler `insertRelationships`: same columns + `logical_relationship_id` (`${source}:${type}:${target_name}:${context_line||''}`), `epoch_written`, `epoch_retired` NULL; `weight||1` (same number); source = `liveIdFor.get(r.source_id) || r.source_id || null` (id remap, not in full build); skips empty target_name; errors swallowed. Same 9 shared values; the 3 extra columns and the source remap are incremental-only.
FTS: full build does not insert per row: `rebuildGraphFts` runs `INSERT INTO <t>(<t>) VALUES('rebuild')` then `'optimize'` for entities_fts (name, name_alias, signature, doc_comment), entities_code_fts (name, name_alias, signature), entities_trigram (name, signature); all external-content on `entities`. Reconciler inserts per row `entities_fts(rowid,name,name_alias,signature,doc_comment)`, `entities_code_fts(rowid,name,name_alias,signature)`, `entities_trigram(rowid,name,signature)` with the same column values. Column sets match; mechanism differs (rebuild vs incremental row insert; per-row errors swallowed).
Verdict: not identical (conflict clause, epoch/logical columns, id remap, FTS mechanism); shared columns and value expressions are identical.

## 4. Needs follow-up (outside my file set)
- ast-chunker.js:47 and chunking/chunk-builder.js:16 can call `embedTextCap()` (chunk-embed-text.js imports ast-chunker.js, so ast-chunker.js importing it back would be a cycle: move `embedTextCap` + `JAVA_FAMILY` out, or let chunk-builder.js import it and leave ast-chunker.js).
- encoder-input.mjs pickLiInputText: decision above.
- Also copied (not in task list): `firstSafeRelativePath` in encoder-input.mjs:172, dedup/exemplar-selector.js:33, indexing-file-policy.js:30.

## 5. Verification
- `node --check` and `npx eslint` on all 8 edited files + new module: clean.
- `npx vitest run tests/indexing`: Test Files 147 passed (147), Tests 2120 passed (2120).
- `npx vitest run tests/ranking tests/graph`: Test Files 89 passed (89), Tests 1579 passed (1579).
