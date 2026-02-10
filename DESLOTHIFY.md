# DESLOTHIFY Plan

> Remove all Sloth-specific references from Sweet Search and rebrand internal naming (search-100x, smart-search) to make it a standalone, generic semantic search tool for any codebase.

**Decision date:** 2026-02-10
**Scope:** All source code, docs, and scripts. Tests + evaluation harnesses are EXCLUDED from Sloth-specific changes (they stay tied to Sloth for development). However, imports/class references MUST be updated everywhere when files are renamed.
**Merged status:** This file incorporates `DESLOTHIFY_ENHANCE.md` and is now the single execution plan.
**Execution rule:** If any instructions conflict, Section 10 (`Merged Enhancement Notes`) is authoritative.

## 0. Final Decisions (Locked)

These decisions are finalized for execution in this document.

1. **Canonical data env var:** `SWEET_SEARCH_DATA_DIR`  
   - Temporary alias support: `AGENTDB_PATH` (deprecation warning, one release window).
2. **Internal data directory constant:** `DATA_DIR` (preferred over legacy `AGENTDB_DIR` naming).
3. **Data directory migration mode:** **Hybrid**  
   - Interactive runs: prompt before migrating `.agentdb/` -> `.sweet-search/`.  
   - Non-interactive runs: warn-only unless explicit migration flag is provided.
4. **`index-codebase-v21.js` rename:** **Deferred** in this migration (stability-first).
5. **Socket path rename:** **In scope** (`/tmp/search.sock` -> `/tmp/sweet-search.sock`) with temporary compatibility fallback.
6. **Build verification policy:** add a concrete `build` script in `package.json`, then require `npm run build` in verification.
7. **`.sweet-search.config.json` contract:** include `include`, `exclude`, optional `projectRoot`, with explicit precedence rules.
8. **Absolute path policy:** only approved fixture/test paths may remain absolute; all portability-risk absolute paths must be replaced.

---

## 1. Core Source Code Changes — Sloth Removal (Functional)

These are the most critical changes - hardcoded Sloth logic that prevents Sweet Search from working generically.

### 1.1 `ast-chunker.js` — Path stripping + project tag detection

**Lines 153, 173-178**

- **Line 153:** `filePath.replace(/^.*\/sloth\//, '')` — Hardcoded path stripping assumes `/sloth/` in path
  - **Fix:** Use the project root (already available or derivable from config) to compute relative paths: `path.relative(projectRoot, filePath)`

- **Lines 173-178:** `inferProjectTag()` returns hardcoded `'sloth-central'`, `'sloth-local'`, etc.
  - **Fix:** Replace with generic auto-detection:
    1. Detect monorepo boundaries from marker files (`package.json`, `pom.xml`, `build.gradle`, `go.mod`, `Cargo.toml`, `.project`, etc.)
    2. Use the nearest boundary's directory name as the project tag (lowercased, kebab-cased)
    3. Fall back to the top-level directory name from the project root
    4. Example: `Sloth-Central/src/Main.java` → tag `sloth-central` (auto-derived from directory name, not hardcoded)
    5. Example: `my-app/backend/src/Main.java` → tag `backend` (from nearest marker)
  - **Must still work perfectly on Sloth** — `Sloth-Central/` has `pom.xml`, `Sloth-Local/` has `pom.xml`, `Sloth Vita/biologger/` has `build.gradle` — all will be auto-detected

### 1.2 `core/config.js` — Hardcoded file patterns + comments

**Lines 44, 46, 969-982**

- **Line 44:** Comment `// Priority 1: Local .env (in search-100x directory)`
  - **Fix:** Change to `// Priority 1: Local .env (in sweet-search directory)`

- **Line 46:** Comment `// Priority 2: Project root .env (in sloth directory)`
  - **Fix:** Change to `// Priority 2: Project root .env`

- **Lines 968-982:** `FILE_PATTERNS.include` has hardcoded Sloth directory globs
  - **Fix:** Replace with comprehensive generic defaults covering all common source languages:
    ```javascript
    include: [
      // Source code (all major languages)
      '**/*.{js,jsx,ts,tsx,mjs,cjs}',    // JavaScript/TypeScript
      '**/*.{java,kt,kts,scala,groovy}',  // JVM
      '**/*.{py,pyi}',                     // Python
      '**/*.{go}',                         // Go
      '**/*.{rs}',                         // Rust
      '**/*.{c,cpp,cc,cxx,h,hpp,hxx}',    // C/C++
      '**/*.{cs,fs,vb}',                   // .NET
      '**/*.{rb,erb}',                     // Ruby
      '**/*.{php}',                        // PHP
      '**/*.{swift,m,mm}',                 // Apple
      '**/*.{lua,zig,nim,elixir,ex,exs}', // Other
      '**/*.{sh,bash,zsh,fish,ps1}',      // Shell
      '**/*.{sql}',                        // SQL
      '**/*.{proto}',                      // Protobuf
      '**/*.{graphql,gql}',               // GraphQL
      // Config & docs
      '**/*.{json,yaml,yml,toml,xml}',    // Config
      '**/*.{md,mdx,rst,txt}',            // Documentation
      '**/*.{html,css,scss,less,svg}',    // Web
      // Project markers
      '**/CLAUDE.md',
      '**/README.md',
    ],
    ```
  - **Note:** Exclude patterns already cover `node_modules`, `target`, `build`, `dist`, `.git` etc. — those stay as-is.
  - Support `.sweet-search.config.json` for per-project overrides of include/exclude patterns.

### 1.3 `core/relationship-resolver.js` — Sloth project detection

**Lines 22-40, 237, 309, 313**

- **Lines 22-40:** `detectProject()` function with hardcoded Sloth directory checks
  - **Fix:** Rewrite to auto-detect project boundaries using the same marker-file approach as 1.1:
    1. Walk up from the file path to find the nearest project boundary marker
    2. Use that directory's name as the project identifier
    3. Return `'unknown'` only if no boundary found
  - **Must still work perfectly on Sloth** (it will — `Sloth-Central/` has `pom.xml`, etc.)

- **Line 237:** Comment `// Same project (prefer matches within the same Sloth component)`
  - **Fix:** Change to `// Same project (prefer matches within the same project component)`

- **Lines 309, 313:** Comments with `com.codolis.sloth.vita.services.AuthService` examples
  - **Fix:** Change to generic examples like `com.example.app.services.AuthService`

### 1.4 `core/graph-extractor.js` — Path stripping + comments

**Lines 149-152, 593**

- **Lines 149-150:** Comments with `com.codolis.sloth.services.AuthService` examples
  - **Fix:** Change to `com.example.services.AuthService`

- **Lines 151-152:** Comments with `com.codolis.utils.Constants` examples (no "sloth" but Codolis-specific)
  - **Fix:** Change to `com.example.utils.Constants`

- **Line 593:** `filePath.replace(/^.*[/\\]sloth[/\\]/, '')` — Same hardcoded stripping
  - **Fix:** Use `path.relative(projectRoot, filePath)` like in 1.1

### 1.5 `core/mmr.js` — Comment only

**Line 131**

- Comment: `"com/codolis/sloth/service/AuthService.java" → "com.codolis.sloth.service"`
  - **Fix:** Change to `"com/example/service/AuthService.java" → "com.example.service"`

### 1.6 `merkle-tracker.js` — Default state path

**Line 16**

- Default: `.agentdb/merkle/sloth-codebase.json`
  - **Fix:** Change to `.sweet-search/merkle/codebase-state.json` (combines Sloth removal + directory rename)

### 1.7 `translation/transliterator.js` — Comments only

**Lines 7, 193**

- Line 7: `"Serbian Cyrillic → Latin (priority for Sloth project)"`
  - **Fix:** `"Serbian Cyrillic → Latin (priority for Serbian codebases)"`
- Line 193: `"Combined map with Serbian taking priority (for Sloth project)"`
  - **Fix:** `"Combined map with Serbian taking priority (default)"`

---

## 2. Product Rename: `smart-search` / `search-100x` → `sweet-search`

The old internal names `smart-search` and `search-100x` are baked into the codebase from when Sweet Search lived inside the Sloth repo as `.claude/helpers/search-100x/`. These must be renamed to `sweet-search` for a clean standalone product.

**Excluded from this rename (kept as-is):**
- `docs/SEARCH_100x.md` — Historical design plan document
- `docs/SEARCH_200X.md` — Historical design plan document
- `RANKING_FIX_PLAN.md` — Architectural decision records

### 2.1 File Renames

| Old Path | New Path |
|----------|----------|
| `core/smart-search-v21.js` | `core/sweet-search.js` |
| `.claude/docs/SMART_SEARCH_INDEXING.md` | `.claude/docs/SWEET_SEARCH_INDEXING.md` |
| `.claude/docs/SMART_SEARCH_PERFORMANCE_ARCHITECTURE.md` | `.claude/docs/SWEET_SEARCH_PERFORMANCE_ARCHITECTURE.md` |
| `.claude/docs/search/SMART_SEARCH_PERFORMANCE_ARCHITECTURE.md` | `.claude/docs/search/SWEET_SEARCH_PERFORMANCE_ARCHITECTURE.md` |

### 2.2 Class/Variable/Constant Renames in `core/sweet-search.js` (formerly `smart-search-v21.js`)

| Old | New | Lines |
|-----|-----|-------|
| `class SmartSearch` | `class SweetSearch` | 53 |
| `SmartSearch.BOOST_POLICY` | `SweetSearch.BOOST_POLICY` | 1338 |
| `[SmartSearch]` log prefix | `[SweetSearch]` | 1840 |
| `SmartSearch instance (singleton)` | `SweetSearch instance (singleton)` | 2152 |
| `new SmartSearch(options)` | `new SweetSearch(options)` | 2165, 2191, 2840, 2859 |
| `SMART_SEARCH_COLOR_MODE` env var | `SWEET_SEARCH_COLOR_MODE` | 2561 |
| `SMART_SEARCH_HEADER_STYLE` env var | `SWEET_SEARCH_HEADER_STYLE` | 2584 |
| `/tmp/smart-search-server.pid` | `/tmp/sweet-search-server.pid` | 2186 |
| `smart-search-v21.js <query>` help text | `sweet-search <query>` | 2705-2733 |
| `export default SmartSearch` | `export default SweetSearch` | 2910 |

### 2.3 Import Path Updates (all files importing `smart-search-v21.js`)

Every file that imports from `core/smart-search-v21.js` must update to `core/sweet-search.js`:

| File | Line(s) | Change |
|------|---------|--------|
| `package.json` | 6 | `"main": "core/smart-search-v21.js"` → `"core/sweet-search.js"` |
| `mcp/server.js` | 62 | Import path update |
| `ss.sh` | 19 | `core/smart-search-v21.js` → `core/sweet-search.js` |
| `ss-fast/ss-fast.c` | 285 | Error message: `"Start server: node smart-search-v21.js --serve"` → `"sweet-search.js"` |
| `ss-fast/ss-fast.c` | 4 | Comment: `"C client for smart-search server"` → `"sweet-search server"` |
| `.claude/helpers/session-preheat.sh` | 36 | Path check: `smart-search-v21.js` → `sweet-search.js` |
| `__tests__/phase1-fixes.test.js` | 4,16,18,20,22,26,28,31 | Import path + `SmartSearch` → `SweetSearch` references |
| `evaluation/run-translation-benchmarks.js` | 791-792,805 | Import + class name |
| `evaluation/run-evaluation.js` | 25,62,445-446 | Import + class name + error message |
| `evaluation/benchmark-translation.js` | 9 | Import + class name |
| `evaluation/lib/cost-tracker.js` | 114,163,178 | JSDoc comments: `SmartSearch` → `SweetSearch` |
| `evaluation/lib/result-matcher.js` | 313,520 | Comments: `SmartSearch` → `SweetSearch` |
| `scripts/diagnose-early-exit.js` | 6,9 | Import + class name |
| `scripts/diagnose-score-distribution.js` | 6,9 | Import + class name |
| `scripts/benchmark.js` | 21,287,398,400,403,677,774 | Import + class name + function names `benchmarkSmartSearch` → `benchmarkSweetSearch` |
| `training/distill.js` | 365 | Comment: `"To use the model in smart-search"` → `"sweet-search"` |

### 2.4 `search-100x` → `sweet-search` Renames

References to the old internal codename `search-100x` (from when this was `.claude/helpers/search-100x/` inside Sloth):

**In code:**

| File | Line(s) | Change |
|------|---------|--------|
| `core/constants.js` | 2-3 | Comments: `"search-100x"` → `"sweet-search"`, `"smart-search-v21.js"` → `"sweet-search.js"` |
| `core/binary-hnsw-index.js` | 16 | Comment: `"smart-search-v21.js"` → `"sweet-search.js"` |
| `core/artifact-builder.js` | 16,371 | Comments: `"smart-search"` / `"smart-search-v21.js"` → `"sweet-search"` / `"sweet-search.js"` |
| `.claude/hooks/index-maintainer.mjs` | 179-180,220-221 | Strategy labels: `"search-100x node_modules"` → `"sweet-search node_modules"` |
| `.claude/helpers/session-preheat.sh` | 37,39,40 | Fallback path: `.claude/helpers/search-100x` → current root; Log/lock: `/tmp/search-100x-preheat.*` → `/tmp/sweet-search-preheat.*` |
| `evaluation/run-translation-benchmarks.js` | 38 | Comment: `"Load .env from search-100x directory"` → `"sweet-search directory"` |
| `bun.lock` | 6 | Package name reference `"search-100x"` — will auto-update when lock regenerated |

**In documentation (old `.claude/helpers/search-100x/` paths → current relative paths):**

These docs reference the old location. All `.claude/helpers/search-100x/` paths must be updated to the current relative paths (e.g., `./core/`, `./`, etc.):

| Doc File | Approx References | Notes |
|----------|-------------------|-------|
| `.claude/docs/search/README.md` | ~5 | Index of all search docs + source file paths |
| `.claude/docs/search/STRUCTURAL_SEARCH.md` | ~5 | Path refs + `com.codolis.AuthService` example |
| `.claude/docs/search/HYBRID_SEARCH.md` | ~8 | Source file paths + CLI usage examples |
| `.claude/docs/search/SEMANTIC_SEARCH.md` | ~6 | Source file paths |
| `.claude/docs/search/LEXICAL_SEARCH.md` | ~2 | Source file paths |
| `.claude/docs/search/RERANKING.md` | ~5 | Source file paths + CLI usage |
| `.claude/docs/search/CACHE_STRATEGY.md` | ~2 | Source file paths |
| `.claude/docs/search/C_BINARY_ARCHITECTURE.md` | ~8 | Source file paths + architecture table |
| `.claude/docs/search/QUERY_ROUTER.md` | ~3 | Cross-references |
| `.claude/docs/search/TESTING_HARNESS.md` | ~6 | File paths + CI/CD examples |
| `.claude/docs/search/INDEXING_FIXES_CHANGELOG.md` | ~3 | grep commands with old paths |
| `.claude/docs/search/INDEXING_TESTING_PLAN.md` | ~15+ | Many path refs in test code examples |
| `.claude/docs/SWEET_SEARCH_INDEXING.md` (renamed) | ~15+ | Tons of CLI paths — all need updating |
| `.claude/docs/SWEET_SEARCH_PERFORMANCE_ARCHITECTURE.md` (renamed) | ~3 | Source file paths |
| `.claude/docs/search/SWEET_SEARCH_PERFORMANCE_ARCHITECTURE.md` (renamed) | ~3 | Source file paths |
| `.claude/docs/CURRENT_MCP_AND_HOOKS.md` | ~2 | Source file paths |
| `QUERY-ROUTING.md` | ~1 | Directory tree |
| `STRUCTURAL-QUERIES.md` | ~3 | File path references |
| `docs/TRANSLATION.md` | — | Update old path refs and `.agentdb` examples to `.sweet-search` |
| `docs/search/MCP_INTEGRATION.md` | — | Update any `core/smart-search-v21.js` and stale naming refs |
| `HYBRID_SEARCH.md` | — | Update `SmartSearch` examples and stale internal names |
| `.claude/commands/index-codebase.md` | — | Update smart-search refs and `.agentdb/*` table paths to current names |

### 2.5 `codolis` → `example` in Comments/Docs

Replace remaining `com.codolis.*` references (without "sloth") with generic examples:

| File | Line(s) | Change |
|------|---------|--------|
| `core/graph-extractor.js` | 151-152 | `com.codolis.utils.Constants` → `com.example.utils.Constants` |
| `.claude/docs/search/STRUCTURAL_SEARCH.md` | 286 | `com.codolis.AuthService` → `com.example.AuthService` |

---

## 3. Data Directory Rename: `.agentdb` → `.sweet-search`

The `.agentdb` directory name is a holdover from AgentDB, the memory system used in claude-flow. Sweet Search needs its own identity. Rename to `.sweet-search`.

**Scope:** 42 files reference `.agentdb`. ALL must be updated including tests/evaluation (this is a structural rename, not a Sloth content change — broken paths = broken functionality).

### 3.1 Central Path Definitions (`core/config.js`)

The `DB_PATHS` object (lines 74-104) defines all data file locations. This is the **single source of truth** — all 10+ paths use `.agentdb/`:

```
.agentdb/codebase.db             → .sweet-search/codebase.db
.agentdb/code-graph.db           → .sweet-search/code-graph.db
.agentdb/codebase-hnsw.idx       → .sweet-search/codebase-hnsw.idx
.agentdb/codebase-binary-hnsw.idx → .sweet-search/codebase-binary-hnsw.idx
.agentdb/codebase-int8.db        → .sweet-search/codebase-int8.db
.agentdb/codebase-colbert.db     → .sweet-search/codebase-colbert.db
.agentdb/merkle-state.json       → .sweet-search/merkle-state.json
.agentdb/query-vocabulary.json   → .sweet-search/query-vocabulary.json
.agentdb/code-summaries.json     → .sweet-search/code-summaries.json
.agentdb/translation-cache.json  → .sweet-search/translation-cache.json
```

- **Line 565:** Comment `"uses .agentdb/ for consistency"` → `"uses .sweet-search/ for consistency"`

### 3.2 Vocabulary Utils (`core/vocabulary-utils.js`)

Lines 80-84: 5 paths, all `.agentdb/` → `.sweet-search/`:
- `query-vocabulary.json`, `vocabulary.bin`, `vocabulary.meta.json`, `query-vocabulary-stats.json`, `code-graph.db`

### 3.3 Other Core Source Files

| File | Line(s) | Change |
|------|---------|--------|
| `core/artifact-builder.js` | 12,52,745-746 | Default paths + CLI help text: `.agentdb/` → `.sweet-search/` |
| `core/hnsw-index.js` | 467 | CLI default path in help text |
| `core/colbert-index.js` | 28 | Default index path |
| `core/incremental-tracker.js` | 20 | Comment: storage location |
| `core/index-codebase-v21.js` | 1711-1714 | Help text showing output file locations |
| `merkle-tracker.js` | 16 | Default state path (already planned in 1.6 — update `.agentdb/merkle/` → `.sweet-search/merkle/`) |
| `mcp/server.js` | 273 | ColBERT existence check path |

### 3.4 Hooks & Helpers

| File | Line(s) | Change |
|------|---------|--------|
| `.claude/hooks/index-maintainer.mjs` | 147 | `AGENTDB_DIR` constant → `DATA_DIR` |
| `.claude/hooks/index-maintainer.mjs` | 274 | Exclude pattern: `'**/.agentdb/**'` → `'**/.sweet-search/**'` |
| `.claude/hooks/index-maintainer.mjs` | 494,1498 | Comments about `.agentdb` directory |
| `.claude/helpers/session-preheat.sh` | 163-165,244 | Vocabulary + ColBERT paths |
| `.claude/helpers/statusline.cjs` | 142,625 | `memory.db` path + directory path |
| `.claude/helpers/hook-handler.cjs` | 26 | `memory.db` path |

### 3.5 Environment Variable

- `AGENTDB_PATH` env var → `SWEET_SEARCH_DATA_DIR` (canonical)
- Keep temporary alias support for `AGENTDB_PATH` with deprecation warning (one release window)
- Update everywhere including tests
- Used in: `.claude/docs/search/INDEXING_TESTING_PLAN.md` test examples, potentially in runtime code

### 3.6 Config & Meta Files

| File | Change |
|------|--------|
| `.gitignore` | Line 12: `.agentdb/` → `.sweet-search/` |
| `vitest.config.js` | Line 19: benchmark output path |
| `.claude/commands/index-codebase.md` | Lines 60,132-137: File table + merkle state path |
| `CLAUDE.md` | If any `.agentdb` references exist (check `.agentic-qe/` separately — that's a different system) |

### 3.7 Tests & Evaluation (update for consistency)

| File | Change |
|------|--------|
| `__tests__/flag-semantics.test.js` | `.agentdb` path references |
| `__tests__/indexing.bench.js` | `.agentdb` benchmark output path |
| `__tests__/index-maintainer.integration.test.js` | `.agentdb` directory references |
| `evaluation/run-translation-benchmarks.js` | `.agentdb` path references |
| `evaluation/benchmark-all-models.js` | `.agentdb` path references |
| `evaluation/benchmark-translation-providers.js` | `.agentdb` path references |
| `scripts/benchmark-constrained.sh` | `.agentdb` path references |
| `scripts/diagnose-int8.js` | `.agentdb` path reference (already planned as configurable in 4.5) |
| `scripts/benchmark-harness.js` | `.agentdb` path references |
| `check-db.js` | `.agentdb` path references |

### 3.8 Documentation (bulk update)

All `.claude/docs/` files referencing `.agentdb/` paths — update to `.sweet-search/`:

| Doc File | Approx References |
|----------|-------------------|
| `.claude/docs/search/CACHE_STRATEGY.md` | ~12 (full DB_PATHS mirror) |
| `.claude/docs/search/INDEX_MAINTAINER.md` | ~10 (lock files, queue, merkle) |
| `.claude/docs/search/INDEXING_TESTING_PLAN.md` | ~25+ (test paths, env vars, queue paths) |
| `.claude/docs/search/INDEXING_FIXES_CHANGELOG.md` | ~5 (lock file migration history) |
| `.claude/docs/search/SEMANTIC_SEARCH.md` | ~1 |
| `.claude/docs/search/LEXICAL_SEARCH.md` | ~1 |
| `.claude/docs/search/RALPH_WIGGUM_TESTING_INTEGRATION.md` | ~1 |
| `.claude/docs/SWEET_SEARCH_INDEXING.md` (renamed) | ~8 |
| `.claude/docs/SWEET_SEARCH_PERFORMANCE_ARCHITECTURE.md` (renamed) | ~3 |
| `.claude/docs/search/SWEET_SEARCH_PERFORMANCE_ARCHITECTURE.md` (renamed) | ~3 |
| `.claude/docs/CURRENT_MCP_AND_HOOKS.md` | ~2 |
| `docs/SEARCH_100x.md` | ~1 (directory tree diagram) |

### 3.9 Migration Strategy (Locked)

When users have an existing `.agentdb/` directory from a previous version:
- Interactive runs: prompt before migrating `.agentdb/` → `.sweet-search/`
- Non-interactive runs: warn-only by default unless explicit migration flag is provided
- Always log clear rollback/recovery guidance if migration fails

---

## 4. Scripts

### 4.1 `scripts/prewarm-vocab.js` — Full rewrite as auto-discovery skill

**Current:** Hardcoded 100 Sloth-specific terms (EmployeeService, BioLogger, etc.)

**Plan:**
1. Create a `/sweet-prewarm-vocab` Claude Code skill that:
   - Scans the existing codebase index (FTS5 DB) for the most frequent symbols/terms
   - Extracts class names, method names, package names from the code graph DB
   - Optionally includes terms from CLAUDE.md / README.md
   - Writes the discovered terms to `.sweet-search/vocab-terms.json`
2. Rewrite `scripts/prewarm-vocab.js` to:
   - Accept a terms file as input: `node prewarm-vocab.js [terms-file]`
   - Default to `.sweet-search/vocab-terms.json` if it exists
   - Fall back to a minimal generic term list (common programming terms) if no file
3. The skill generates the terms file, the script prewarms them — clean separation

### 4.2 `scripts/test-router-phase1.js` — Keep as-is

**Lines 55-56:** `sloth_api.conf`, `com.codolis.sloth.vita` are test data for the router.
**Decision:** Keep — this is test/evaluation tooling tied to Sloth development.

### 4.3 `scripts/benchmark-rerank.js` — Keep as-is

**Line 29:** Comment about "Sloth codebase".
**Decision:** Keep — benchmark scripts stay tied to Sloth.

### 4.4 `scripts/benchmark-harness.js` — Keep as-is

**Line 367:** References `'Sloth Web'` directory for finding Java files.
**Decision:** Keep — benchmark scripts stay tied to Sloth.

### 4.5 `scripts/diagnose-int8.js` — Make path configurable

**Line 38:** Hardcoded `projects/sloth/.agentdb/codebase-binary-hnsw.idx`

**Fix:**
- Accept index path as CLI argument: `node diagnose-int8.js [path-to-index]`
- Default to `.sweet-search/codebase-binary-hnsw.idx` (local project)
- Keep the rest of the diagnostic logic unchanged

---

## 5. Documentation Changes (Sloth-specific)

### 5.1 DELETE: `MIGRATION_FROM_SLOTH.md` (root)

Internal migration log. Served its purpose during extraction. Delete entirely.

### 5.2 DELETE: `.claude/docs/DATABASE-SCHEMAS.md`

100% Sloth application documentation (MySQL schemas, Docker commands). Zero relevance to Sweet Search.

### 5.3 UPDATE: `.claude/docs/CURRENT_MCP_AND_HOOKS.md`

Remove the "Proto-Sync Hook" section (lines 63-69) that references Sloth proto paths. Keep everything else.

### 5.4 UPDATE: `.claude/docs/search/HYBRID_SEARCH.md`

**Line 74:** Change `"on the Sloth codebase"` → `"on tested codebases"`

### 5.5 UPDATE: `.claude/docs/RERANKING_DOCUMENTATION_AUDIT.md`

**Line 296:** Change `/home/panonit/projects/sloth/.claude/helpers/search-100x/` → relative path `./` (current Sweet Search root)

### 5.6 UPDATE: `.claude/docs/SMART_SEARCH_PERFORMANCE_ARCHITECTURE.md` (before rename)

**Lines 741-747:** Replace the `SLOTH_TERMS` code snippet with a generic `PROJECT_TERMS` example:
```javascript
const PROJECT_TERMS = [
  'AuthService', 'UserController', 'LoginService',
  'how does authentication work', 'user management',
  // ... auto-discovered from codebase index
];
await expandVocabulary(PROJECT_TERMS);
```

### 5.7 KEEP: `.claude/docs/search/INDEXING_TESTING_PLAN.md`

3 Sloth references are testing notes. Keep as-is per decision.

### 5.8 KEEP: `.claude/docs/search/RALPH_WIGGUM_TESTING_INTEGRATION.md`

1 Sloth reference is a testing note. Keep as-is per decision.

### 5.9 UPDATE: `docs/SEARCH_100x.md`

- **Lines 562, 643:** Change `"/dev/shm/sloth-embedder"` → `"/dev/shm/sweet-search-embedder"` (code examples)
- **Line 1043:** Change `sloth-vectors.db` → `vectors.db` in directory tree diagram
- Verified: no functional code uses these paths (doc-only references)
- **Note:** This is a historical design plan — keep the SEARCH_100x title/name unchanged per decision

### 5.10 KEEP: `RANKING_FIX_PLAN.md`

Architectural decision records. Sloth context is historically meaningful for understanding WHY strategies were dropped. Keep as-is.

### 5.11 KEEP: `docs/SEARCH_200X.md`

Historical design plan document. Keep as-is per decision.

---

## 6. Files to Delete

| File | Reason |
|------|--------|
| `MIGRATION_FROM_SLOTH.md` | Internal migration log, served its purpose |
| `.claude/docs/DATABASE-SCHEMAS.md` | 100% Sloth app docs, zero relevance |
| `test-resolution.mjs` | One-off debug script in root, stale hardcoded sloth path |

---

## 7. Excluded from Sloth Changes (tests + evaluation + ADRs)

These files have Sloth references but are intentionally kept as-is:

| File | Sloth References | Reason to Keep |
|------|-----------------|----------------|
| `__tests__/wsl-unc-path.test.js` | Path test data with Sloth paths | Test fixtures |
| `__tests__/index-maintainer.test.js` | Windows path test data | Test fixtures |
| `evaluation/query-sets/english-novel-mixed.json` | SlothiaToast.jsx reference | Evaluation ground truth |
| `evaluation/query-sets/schema.json` | `$id` URL with sloth.codolis.com | Schema namespace |
| `evaluation/lib/cost-tracker.js` | Comment about Sloth codebase | Dev tooling |
| `evaluation/results/FAILING_QUERIES.md` | SlothGame.jsx in results | Evaluation results |
| `training/generators/generate-comprehensive.js` | com.codolis.sloth.vita | Training data |
| `scripts/test-router-phase1.js` | sloth_api.conf test data | Test data |
| `scripts/benchmark-rerank.js` | Comment about Sloth codebase | Benchmark tooling |
| `scripts/benchmark-harness.js` | 'Sloth Web' directory reference | Benchmark tooling |
| `.claude/docs/search/INDEXING_TESTING_PLAN.md` | 3 Sloth testing notes | Test planning |
| `.claude/docs/search/RALPH_WIGGUM_TESTING_INTEGRATION.md` | 1 Sloth reference | Test planning |
| `RANKING_FIX_PLAN.md` | 6 architectural decision refs | Historical ADRs |
| `docs/SEARCH_100x.md` | Title/name only (content updated) | Historical design plan |
| `docs/SEARCH_200X.md` | smart-search references | Historical design plan |

**Note:** While Sloth *references* are kept in test/eval files, import paths and class names (`SmartSearch` → `SweetSearch`) MUST be updated in these files when the core file is renamed — otherwise imports would break.

---

## 8. Execution Order

### Phase 1 — Deletes (safe, no dependencies)
- Delete `MIGRATION_FROM_SLOTH.md`, `.claude/docs/DATABASE-SCHEMAS.md`, `test-resolution.mjs`

### Phase 2 — Core file rename: `smart-search-v21.js` → `sweet-search.js` (highest risk, do first)
- `git mv core/smart-search-v21.js core/sweet-search.js`
- Rename class `SmartSearch` → `SweetSearch` throughout the file
- Update all env vars: `SMART_SEARCH_*` → `SWEET_SEARCH_*`
- Update PID file path: `/tmp/smart-search-server.pid` → `/tmp/sweet-search-server.pid`
- Rename socket path `/tmp/search.sock` → `/tmp/sweet-search.sock` (with temporary compatibility fallback)
- Update help text / usage examples in the file
- Update `package.json` main field and scripts (`search`, and other direct entrypoint scripts)
- Add concrete `build` script in `package.json` (required for verification gate)
- Update ALL import paths in every file that imports from it (Section 2.3 table)
- **Run tests immediately** to catch any missed imports

### Phase 3 — Data directory rename: `.agentdb` → `.sweet-search` (high impact, many files)
- Update `core/config.js` `DB_PATHS` — the single source of truth (10+ paths)
- Update `core/vocabulary-utils.js` (5 paths)
- Update all other core files: `artifact-builder.js`, `hnsw-index.js`, `colbert-index.js`, `incremental-tracker.js`, `index-codebase-v21.js`, `merkle-tracker.js`, `mcp/server.js`
- Rename `AGENTDB_DIR` constant → `DATA_DIR` in `index-maintainer.mjs`
- Rename `AGENTDB_PATH` env var → `SWEET_SEARCH_DATA_DIR` everywhere (including tests), keep temporary alias
- Update exclude patterns: `'**/.agentdb/**'` → `'**/.sweet-search/**'`
- Update `.gitignore`: `.agentdb/` → `.sweet-search/`
- Update hooks/helpers: `session-preheat.sh`, `statusline.cjs`, `hook-handler.cjs`
- Update all tests/evaluation/scripts with `.agentdb` paths
- Update all documentation with `.agentdb` references (~12 doc files)
- Update `.claude/commands/index-codebase.md` file table
- Add migration flow: interactive prompt migration, non-interactive warn-only by default, explicit-flag migration path
- **Run tests immediately** to catch any missed paths

### Phase 4 — Doc file renames
- `git mv` the 3 `SMART_SEARCH_*.md` files to `SWEET_SEARCH_*.md`
- Update all internal cross-references between docs

### Phase 5 — `search-100x` path updates in docs
- Bulk update all `.claude/helpers/search-100x/` paths to current relative paths across ~20 doc files (Section 2.4 table)
- Update code comments/labels in `index-maintainer.mjs`, `session-preheat.sh`, `constants.js`, etc.
- Update log/lock file names in `session-preheat.sh`

### Phase 6 — Sloth comment/doc updates (low risk, no functional changes)
- Update comments in `transliterator.js`, `mmr.js`, `graph-extractor.js`, `relationship-resolver.js`, `config.js`
- Update `codolis` → `example` in comments (graph-extractor.js, STRUCTURAL_SEARCH.md)
- Update docs: `HYBRID_SEARCH.md`, `RERANKING_DOCUMENTATION_AUDIT.md`, `CURRENT_MCP_AND_HOOKS.md`, `SEARCH_100x.md`, performance architecture doc

### Phase 7 — Path stripping generalization (medium risk)
- Fix `ast-chunker.js:153` and `graph-extractor.js:593` to use `path.relative()`
- Fix `merkle-tracker.js:16` default state path
- Fix `scripts/diagnose-int8.js` to accept CLI arg

### Phase 8 — Project detection generalization (high impact)
- Create shared utility: `core/project-detector.js`
  - Marker file detection algorithm
  - Caching for performance (don't re-scan same directories)
  - Export `detectProjectBoundary(filePath, projectRoot)` → `{ name, path }`
- Rewrite `ast-chunker.js:inferProjectTag()` to use `project-detector.js`
- Rewrite `relationship-resolver.js:detectProject()` to use `project-detector.js`
- **Test on Sloth codebase** to verify it produces equivalent results

### Phase 9 — File patterns generalization (high impact)
- Replace `core/config.js:FILE_PATTERNS.include` with generic language defaults
- Add `.sweet-search.config.json` support for per-project overrides

### Phase 10 — Prewarm vocab skill (new feature)
- Create `/sweet-prewarm-vocab` skill with auto-discovery from codebase index
- Rewrite `scripts/prewarm-vocab.js` to accept terms file input
- Create `.sweet-search/vocab-terms.json` generation pipeline

### Phase 11 — Verification
- Run full test suite: `npm test -- --run`
- Run evaluation harness against Sloth codebase (separate repo)
- Verify no remaining issues:
  ```bash
  # Content debranding pass (exclude approved historical/test fixtures where needed)
  grep -riE 'sloth|SLOTH_|sloth-|sloth/|Sloth Web|Sloth-Local|Sloth-Central' \
    --include='*.js' --include='*.mjs' --include='*.md' --include='*.json' \
    --exclude-dir=node_modules --exclude=DESLOTHIFY.md --exclude=RANKING_FIX_PLAN.md

  # Structural integrity pass (include tests/evaluation to catch broken imports/paths)
  grep -riE 'smart-search|SmartSearch|SMART_SEARCH|smart-search-v21' \
    --include='*.js' --include='*.mjs' --include='*.sh' --include='*.c' --include='*.md' \
    --exclude-dir=node_modules --exclude=SEARCH_100x.md --exclude=SEARCH_200X.md --exclude=RANKING_FIX_PLAN.md

  grep -riE 'search-100x|SEARCH 100x|Search 100x' \
    --include='*.js' --include='*.mjs' --include='*.sh' --include='*.md' --include='*.c' \
    --exclude-dir=node_modules --exclude=SEARCH_100x.md --exclude=SEARCH_200X.md --exclude=RANKING_FIX_PLAN.md

  grep -riE '\\.agentdb/|AGENTDB_PATH|AGENTDB_DIR' \
    --include='*.js' --include='*.mjs' --include='*.sh' --include='*.md' --include='*.cjs' --include='*.c' \
    --exclude-dir=node_modules --exclude=DESLOTHIFY.md

  grep -riE 'codolis' --include='*.js' --include='*.md' --exclude-dir=node_modules

  # Portability audit
  grep -riE '/home/|/mnt/c/|[A-Za-z]:\\\\' \
    --include='*.js' --include='*.mjs' --include='*.md' --include='*.json' --include='*.sh' --include='*.c' \
    --exclude-dir=node_modules
  ```
- Build check: `npm run build`
- Smoke test: index a non-Sloth codebase and run queries

---

## 9. Summary Statistics

| Category | Count |
|----------|-------|
| Files to delete | 3 |
| Files to rename | 4 |
| Core source files to modify (Sloth logic) | 7 |
| Files needing import path updates (rename) | 17 |
| Files needing `.agentdb` → `.sweet-search` update | 42 |
| Documentation files to update | ~25 |
| Code files with comment-only changes | ~10 |
| New files to create | 2 (`core/project-detector.js`, `/sweet-prewarm-vocab` skill) |
| Excluded files (intentionally kept) | 15 |
| **Total files touched** | **~80+** |

---

## 10. Merged Enhancement Notes (Authoritative)

The following content from `DESLOTHIFY_ENHANCE.md` is now inlined into this plan.
Use this section as the source of truth for additional corrections, migration policy, verification gates, and execution safeguards.

### Inlined: DESLOTHIFY Enhancement Notes (Consolidated)

> Master addendum to `DESLOTHIFY.md`, merging relevant fixes and optimizations from all model reviews.

**Date:** 2026-02-10  
**Purpose:** Capture every relevant improvement (high to low priority) so execution can happen with minimal surprises.

---

### 10.1 Must-Fix Plan Corrections (Before Any Code Changes)

#### 1.1 Plan structure and consistency

- Fix duplicate/inconsistent section numbering in `DESLOTHIFY.md` (currently two section-4 blocks and misnumbered script subsections).
- Resolve all placeholder items like "check for..." into explicit actions and target files.
- Reconcile summary counts after final scope is frozen (files renamed/deleted/updated).

#### 1.2 `.agentdb` -> `.sweet-search` consistency holes

The plan still contains stale `.agentdb` references in some sections:

- Prewarm terms output path (should be `.sweet-search/vocab-terms.json`).
- `diagnose-int8` default index path (should be `.sweet-search/codebase-binary-hnsw.idx`).

Action:
- Normalize all post-migration runtime paths to `.sweet-search/*`.
- Keep `.agentdb` only in migration/compatibility notes.

#### 1.3 Missing updates in active docs/commands

Add explicit update scope for:

- `docs/search/MCP_INTEGRATION.md` (still points to `core/smart-search-v21.js`)
- `HYBRID_SEARCH.md` (`SmartSearch` examples)
- `docs/TRANSLATION.md` (`.agentdb/translation-cache.json`)
- `.claude/commands/index-codebase.md` (`smart-search-v21.js` and `.agentdb/*` file tables)

#### 1.4 Keep historical exceptions explicit and minimal

Allowed legacy references should remain only where approved:

- `docs/SEARCH_100x.md`
- `docs/SEARCH_200X.md`
- `RANKING_FIX_PLAN.md`

Everything else should be normalized.

#### 1.5 Absolute path hygiene audit (missing explicit scope)

Add a dedicated pass for machine-specific absolute paths and local dev artifacts:

- Detect hardcoded absolute paths such as `/home/...`, `/mnt/c/...`, and `C:\...`.
- Classify each as:
  - intentional fixture/test data (allowlist), or
  - portability risk (replace with relative/project-root based pathing).
- Include release-surface and tooling files in this audit (package metadata, MCP config, scripts, docs).

---

### 10.2 Rename Coverage Additions

#### 2.1 `smart-search` / `SmartSearch` / `SMART_SEARCH_*`

- Update `package.json` beyond `main`:
  - scripts and any CLI entrypoints that still call `core/smart-search-v21.js`
- Ensure all runtime/help strings are updated (not only imports/class names).
- Include shell/C wrappers:
  - `ss.sh`
  - `ss-fast/ss-fast.c`

#### 2.2 `search-100x` and `SEARCH 100x` variants

Include both hyphen and space forms in runtime code/logs/comments:

- `search-100x`
- `SEARCH 100x`
- `Search 100x`

Known runtime candidates include:

- `core/config.js`
- `core/index-codebase-v21.js`
- `core/incremental-tracker.js`
- `.claude/helpers/session-preheat.sh`

#### 2.3 Socket path rename (in scope)

Include:

- `/tmp/search.sock` -> `/tmp/sweet-search.sock`

Audit all references in:

- core server implementation
- `ss.sh`
- `ss-fast/ss-fast.c`
- eval scripts and docs that mention socket path

#### 2.4 Decision: `index-codebase-v21.js` filename

For this migration, keep `core/index-codebase-v21.js` unchanged (stability-first).

- Rationale: avoids broad additional blast radius while core debranding/data-dir migration is in flight.
- Follow-up (separate migration): rename to `core/index-codebase.js` after stabilization.

---

### 10.3 `.agentdb` -> `.sweet-search` Full Coverage

#### 3.1 Config + constants + exports

- Update central `DB_PATHS` in `core/config.js` (single source of truth).
- Update any fallback hardcoded paths not derived from `DB_PATHS` (e.g. ColBERT fallback checks).
- In `.claude/hooks/index-maintainer.mjs`:
  - `AGENTDB_DIR` rename (`DATA_DIR`)
  - update `CONFIG` export shape
  - update all consumers/tests using `CONFIG.AGENTDB_DIR`

#### 3.2 Exclude patterns and self-index protection

Ensure `.sweet-search/` replaces `.agentdb/` in all exclude globs and scanners, so the tool does not index its own artifacts.

#### 3.3 Two merkle paths must both be handled

There are two distinct states to migrate:

- `DB_PATHS.merkle`: `.agentdb/merkle-state.json`
- `merkle-tracker` state: `.agentdb/merkle/sloth-codebase.json` -> `.sweet-search/merkle/codebase-state.json`

Add explicit migration mapping for both, to avoid accidental full reindex due to missed state files.

#### 3.4 Statusline/hook handler ownership check (important)

`.claude/helpers/statusline.cjs` and `.claude/helpers/hook-handler.cjs` include `memory.db`/AgentDB-related probes used by broader tooling.

Action:
- Determine which paths are Sweet Search runtime data vs external Claude Flow/AQE ecosystem paths.
- Rename only Sweet Search-owned paths; avoid breaking unrelated systems.

#### 3.5 Root tooling cleanup

- `check-db.js` in repo root: move to `scripts/` (unless explicitly retained as diagnostic utility with documented rationale).

#### 3.6 Environment variable naming contract (locked)

- Canonical: `SWEET_SEARCH_DATA_DIR`
- Temporary alias: `AGENTDB_PATH` (compatibility window with deprecation warning)

#### 3.7 `.sweet-search.config.json` contract (define before implementation)

Do not leave this implicit. Define a minimal schema up front so implementation is consistent:

- Required/optional keys (minimum):
  - `include: string[]`
  - `exclude: string[]`
  - `projectRoot?: string`
  - optional tuning flags as needed (`indexDocs`, file size caps, etc.)
- Decide validation behavior:
  - reject unknown keys, or
  - allow passthrough with warnings.
- Document precedence rules between defaults, env, and config file.

---

### 10.4 Migration and Backward Compatibility

#### 4.1 Choose migration behavior now

Do not defer this to implementation. Pick one:

- **Warn-only**: keep user control, more manual work
- **Auto-migrate**: better UX, higher safety requirements
- **Hybrid** (recommended): detect legacy `.agentdb`, perform safe one-time migration with clear logs and fallback handling

#### 4.2 Compatibility window (recommended for one release)

- Keep thin shim `core/smart-search-v21.js` re-exporting `core/sweet-search.js`
- Accept old env vars with warning:
  - `SMART_SEARCH_*` -> `SWEET_SEARCH_*`
  - `AGENTDB_PATH` -> `SWEET_SEARCH_DATA_DIR`
- If `.sweet-search/` absent and `.agentdb/` present:
  - read legacy path or migrate immediately (per chosen strategy)

#### 4.3 Symlink compatibility (optional)

Optional transitional strategy:

- Create `.agentdb -> .sweet-search` symlink after migration for older scripts.

Use carefully (cross-platform and tooling caveats apply).

#### 4.4 Release/migration note

Document both breaking changes clearly for CI/users:

- `.agentdb` -> `.sweet-search`
- env var rename(s)

#### 4.5 Migration guardrails (prompt/opt-in safety)

If auto-migrate is enabled, add explicit safety controls:

- Interactive mode: show first-run prompt/confirmation before directory move.
- Non-interactive mode (CI/automation): default to safe warning-only unless explicit migration flag is provided.
- Emit clear rollback guidance if migration fails mid-operation.

---

### 10.5 Build/Packaging/Distribution Gaps

#### 5.1 `npm run build` resolution

`DESLOTHIFY.md` requires `npm run build`.

Action:
- Add a concrete `build` script in `package.json` as part of this migration.
- Ensure CI and local verification both execute `npm run build`.

#### 5.2 `ss` binary generation

`package.json` bin includes `ss`, but repository currently uses `ss.sh` and C sources.

Action:
- Make build step explicit for `ss-fast` compilation (if shipping binary).
- Ensure instructions and CI align with actual artifact expectations.

#### 5.3 Lockfile regeneration

Do not rely on "auto-update eventually" for `bun.lock`/lockfile entries after rename.

Action:
- add explicit lockfile refresh step post-rename.

#### 5.4 Package identity audit

Before release, verify:

- `name`, `bin`, `files`, scripts, entrypoints
- no stale internal names in publish surface.

---

### 10.6 Verification Upgrade (Content vs Structural)

#### 6.1 Separate two verification passes

1) **Content debranding pass** (can exclude approved historical/test fixtures)  
2) **Structural integrity pass** (must include tests/evaluation for import/path breakage)

#### 6.2 Pattern set should include variants

Use comprehensive patterns:

- `smart-search|SmartSearch|SMART_SEARCH|smart-search-v21`
- `search-100x|SEARCH 100x|Search 100x`
- `\.agentdb/|AGENTDB_PATH|AGENTDB_DIR`
- `codolis`
- `sloth|SLOTH_|sloth-|sloth/|Sloth Web|Sloth-Local|Sloth-Central`

#### 6.3 Include command/hook surfaces in audits

Always include:

- `.claude/commands/**`
- `.claude/hooks/**`
- `.claude/helpers/**`

These frequently retain stale names after core code is cleaned.

#### 6.4 Add targeted checks

- Any remaining `/tmp/search.sock` and `/tmp/search-100x*` artifacts
- Remaining `CONFIG.AGENTDB_*` usage
- Remaining `AGENTDB_PATH` references (unless intentionally aliased)
- Remaining stale entries in docs/commands tables
- Remaining machine-specific absolute paths (`/home/`, `/mnt/c/`, `C:\`) outside approved fixtures

---

### 10.7 Execution Strategy Improvements

#### 7.1 Resolve "split vs atomic" tension with a hybrid approach

Two opposing suggestions are both valid:

- Split huge phases for easier debugging
- Keep high-risk renames close to avoid long broken intermediate states

Recommended hybrid:

- One execution session/branch for breaking changes
- Internally split into sub-phases with immediate checks after each sub-phase
- Avoid merging partial broken states

#### 7.2 Sub-phase checkpoints for high-risk work

After each major rename block:

1. run tests (`npm test -- --run`)
2. run build command(s) that actually exist
3. run pattern audits
4. smoke query paths (lexical, semantic, hybrid)

#### 7.3 Rollback plan

- Use one commit per major phase/sub-phase.
- If a phase regresses behavior, revert only that phase.

#### 7.4 Ordering constraints that should be explicit

Add explicit sequence constraints to reduce drift and ambiguous failures:

- Perform `.agentdb` -> `.sweet-search` core path migration before implementing prewarm-vocab output path changes, so a third location is not introduced accidentally.
- After `SmartSearch`/entrypoint rename, run a quick import-resolution sanity pass before bulk doc/path rewrites.
- For `SMART_SEARCH_PERFORMANCE_ARCHITECTURE` docs: apply content updates before or in the same change set as filename rename, to avoid stale transitional references.

---

### 10.8 Performance/Architecture Optimizations (Low Priority but Valuable)

#### 8.1 Project detector caching

In new `project-detector` utility, cache directory-boundary lookups (`Map`) to avoid repeated filesystem walks during indexing.

#### 8.2 File pattern broadening guardrails

When making include patterns generic:

- maintain strong excludes for generated/vendor/large artifacts
- consider docs indexing as opt-in or lower weight

This prevents index bloat and slowdowns on large repos.

#### 8.3 Single source of truth for data-dir naming

Avoid repeating `.sweet-search` literals across modules.

Recommendation:
- centralize data-dir constant in one module and consume it everywhere (core + hooks).

#### 8.4 XDG support (optional nice-to-have)

Optional Linux improvement:

- support `XDG_DATA_HOME` / `XDG_CACHE_HOME` for data placement
- keep `.sweet-search/` as default local-project mode.

#### 8.5 MCP tool name collision check (optional)

Current MCP tool name `search` is likely fine, but in multi-server environments it may be generic.

Optional:
- evaluate namespacing strategy if conflicts are observed.

#### 8.6 Shell alias/user environment reminder

If users have shell aliases/scripts pinned to old names/paths, include migration guidance in release notes.

---

### 10.9 Resolved Decision Record

- [x] Canonical data env var name: `SWEET_SEARCH_DATA_DIR`.
- [x] Constant naming: `DATA_DIR`.
- [x] `.agentdb` migration mode: hybrid (interactive prompt, non-interactive warn-only unless explicit flag).
- [x] `index-codebase-v21.js` rename: deferred in this migration.
- [x] Socket path rename `/tmp/search.sock` -> `/tmp/sweet-search.sock` with temporary compatibility fallback.
- [x] Ownership decision for `statusline.cjs`/`hook-handler.cjs` memory paths: rename only Sweet Search-owned paths.
- [x] Disposition of root `check-db.js`: move to `scripts/` unless explicitly retained as diagnostic utility.
- [x] Handling of `training/evaluate-catboost-router.js` legacy refs: keep only if training-only historical context; otherwise normalize.
- [x] `.sweet-search.config.json` schema and validation policy: required keys and precedence defined in Section 3.7.
- [x] Absolute path policy: allowlist fixture/test-only; replace portability-risk absolute paths.
- [x] Migration prompt/opt-in requirement: enforced by Section 4.5.

---

### 10.10 Consolidated Pre-Execution Checklist

- [x] Fix numbering/structure drift in `DESLOTHIFY.md`.
- [x] Remove stale `.agentdb` references in plan sections (except migration notes).
- [x] Add missing files to planned scope:
  - [x] `docs/search/MCP_INTEGRATION.md`
  - [x] `HYBRID_SEARCH.md`
  - [x] `docs/TRANSLATION.md`
  - [x] `.claude/commands/index-codebase.md`
- [ ] Update `package.json` scripts and entrypoints comprehensively.
- [ ] Include `SEARCH 100x` (space variant) replacements in runtime scope.
- [ ] Include command/hook/helper surfaces in rename scope.
- [ ] Add explicit lockfile regeneration step.
- [ ] Make build verification executable (add `build` script and enforce `npm run build`).
- [ ] Add migration/release note tasks.
- [ ] Add structural verification pass that includes tests/evaluation.
- [ ] Define rollback strategy (phase-level commits).
- [x] Add absolute-path audit task with allowlist policy.
- [x] Document `.sweet-search.config.json` schema and precedence rules.
- [x] Add explicit ordering constraints (data-dir before prewarm; import sanity before bulk docs).

---

### 10.11 Minimal Phase Gate (Updated)

After each high-risk sub-phase:

1. `npm test -- --run`
2. `npm run build`
3. Pattern audit (content + structural):
   - `smart-search|SmartSearch|SMART_SEARCH|smart-search-v21`
   - `search-100x|SEARCH 100x|Search 100x`
   - `\.agentdb/|AGENTDB_PATH|AGENTDB_DIR`
   - `codolis`
   - `sloth|SLOTH_|sloth-|sloth/|Sloth Web|Sloth-Local|Sloth-Central`
4. Smoke test:
   - index a non-Sloth codebase
   - run lexical + semantic + hybrid queries
5. If regressions appear, revert only the phase commit and retry.
