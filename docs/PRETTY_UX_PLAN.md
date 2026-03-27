# Pretty UX Plan

**Date:** 2026-03-27
**Status:** DRAFT -- Needs further research before execution
**Scope:** Interactive terminal wizards for Sweet Search configuration and indexing

---

## Pre-Implementation Research Required

This plan is a **draft proposal**. Before implementing, the following needs further
research and discussion:

- **Command scope**: Each wizard's flag/option list was derived from current CLI args
  and config.js. The actual set of questions to include in each wizard needs validation
  -- some flags may be too low-level for an interactive wizard, others may be missing.
  Review each phase's questionnaire flow against real user workflows before building.

- **UX flow testing**: The wizard step ordering, default values, and conditional
  branching (e.g., skip ColBERT question when graph-only) should be prototyped and
  tested before committing to the full implementation. A single wizard (e.g., config)
  should be built first as a proof-of-concept.

- **Library confirmation**: `@clack/prompts` v1.1.0 was identified via web research
  as the best fit for March 2026. Verify it works well inside Claude Code's terminal
  environment (TTY handling, color support, Ctrl+C behavior) before adopting.

- **Which commands actually need wizards**: The 5 commands listed below are candidates.
  Some may be better left as simple CLI flags. Discuss priority and cut scope if needed.

- **Backward compatibility**: Interactive mode should never be the *only* way to run
  a command. Every wizard must preserve the existing non-interactive CLI flag interface.

---

## Search Output Styling (Discussion Needed)

The current `ss "query"` output is functional but plain. As part of this UX overhaul,
we should discuss improving the search result presentation:

- **Query echo**: Style the query itself when printed back (bold, colored, framed) so
  it's visually distinct from results. Consider a branded header line.
- **Result formatting**: Colored file paths, syntax-highlighted code snippets, score
  badges, search mode indicator (lexical/semantic/hybrid).
- **Branding**: The "Sweet Search" name should appear consistently and attractively.
  Explore a compact ASCII logo or styled intro line for CLI output.
- **Timing line**: The `(42 results in 6ms)` line could be styled with dimmed color
  and a cleaner layout.
- **Progressive disclosure**: Summary mode vs detailed mode, expandable results.

This is a separate workstream from the wizards but should be designed together for a
cohesive look-and-feel. Needs its own discussion before implementation.

---

## Overview

Replace manual flag-juggling and AskUserQuestion-based skill flows with pretty,
interactive terminal wizards powered by `@clack/prompts` (v1.1.0, 432 KB, native
TypeScript, used by SvelteKit/Astro/Wrangler).

Five interactive commands:
1. `sweet-search config` -- unified config wizard (embeddings, reranking, translation, late interaction, cascade, HNSW, API keys)
2. `sweet-search index --interactive` -- guided indexer with questionnaire for every flag
3. `sweet-search warmup` -- interactive vocabulary prewarm (depth, modes, Leiden clustering, PageRank)
4. `sweet-search hcgs` -- interactive HCGS summary generation (provider chain, hierarchy levels, concurrency)
5. `sweet-search doctor` -- interactive diagnostics dashboard (DB health, model status, benchmark comparison)

---

## Phase 1: Foundation (`scripts/ui-helpers.js`)

### File: `scripts/ui-helpers.js` (~150 lines)

Shared utilities for both wizards. Avoids duplicating .env logic and state inspection.

**Responsibilities:**

1. **`.env` read/write with merge semantics** -- Parse existing `.env` (matching priority
   in `core/config.js` lines 57-76: local `.env` > project root `.env`), merge new values,
   atomic write with `chmod 0o600`. Never clobber existing keys unless explicitly overridden.

2. **API key masking** -- `maskKey(key)` returns `"****" + key.slice(-4)` or `"(not set)"`
   if empty. Used everywhere keys are displayed.

3. **Index state inspector** -- `getIndexState()` returns a structured object by:
   - Reading `.sweet-search/config.json` for init profile, platform, model status
   - Checking `existsSync()` on each `DB_PATHS.*` artifact (code-graph.db, codebase.db,
     codebase-hnsw.idx, codebase-binary-hnsw.idx, codebase-late-interaction.db)
   - Reading file sizes for display
   - Checking merkle-state.json for incremental readiness
   - Returns: `{ profile, artifacts, sizes, hasMerkle, hasIndex, hasGraph, hasHnsw, hasColbert }`

4. **Current config reader** -- `getCurrentConfig()` dynamically imports `core/config.js`
   and extracts active provider names, enabled flags, and key availability for display
   (never exposing full key values).

5. **Cancellation handler** -- `handleCancel(value, message?)` wraps `p.isCancel()`,
   calls `p.cancel()`, and exits cleanly.

6. **Env var catalog** -- `ENV_VARS` constant mapping logical names to env keys, defaults,
   and validation patterns:
   ```js
   export const ENV_VARS = {
     VOYAGEAI_API_KEY:   { validate: v => v.startsWith('pa-'), hint: 'Starts with pa-' },
     GROQ_API_KEY:       { validate: v => v.startsWith('gsk_'), hint: 'Starts with gsk_' },
     CEREBRAS_API_KEY:   { validate: v => /^[a-f0-9-]{36}$/.test(v), hint: 'UUID format' },
     OPENROUTER_API_KEY: { validate: v => v.startsWith('sk-or-'), hint: 'Starts with sk-or-' },
     // ... all provider keys
   };
   ```

---

## Phase 2: Interactive Config Wizard (`scripts/config-wizard.js`)

### File: `scripts/config-wizard.js` (~480 lines)

Unified config wizard. Section-select pattern: user picks which sections to configure,
then walks through each.

**Entry points:**
- `npm run config`
- `sweet-search config`
- `sweet-search config --section rerank` (jump to one section)

### Top-level flow

```
p.intro("Sweet Search -- Configuration Wizard")
p.note(currentStateTable)

sections = p.multiselect({
  message: "Which sections do you want to configure?",
  options: [
    { value: 'apiKeys',         label: 'API Key Management',      hint: '3 keys set' },
    { value: 'embedding',       label: 'Embedding Provider',      hint: 'Current: Local' },
    { value: 'reranking',       label: 'Reranking',               hint: 'Current: ModernBERT INT8' },
    { value: 'translation',     label: 'Translation',             hint: 'Current: Auto' },
    { value: 'lateInteraction', label: 'Late Interaction (ColBERT)', hint: 'Current: lateon-code' },
    { value: 'cascade',         label: 'Cascade Scoring',         hint: 'Current: Shadow' },
    { value: 'hnsw',            label: 'HNSW Tuning (advanced)',  hint: 'M=16' },
  ],
})

// Walk through each selected section...
// Collect all changes...

p.note(changesTable)
confirmed = p.confirm("Apply these changes?")
if confirmed: writeEnvFile(changes)
p.outro("Done! Run /index-codebase to re-index.")
```

### Section: API Key Management

```
p.note(keyStatusTable)     // masked current keys
toEdit = p.multiselect("Which keys to add/update?", [
  { value: 'voyage',    label: 'Voyage AI',   hint: 'embeddings + reranking' },
  { value: 'mistral',   label: 'Mistral AI',  hint: 'embeddings' },
  { value: 'jina',      label: 'Jina AI',     hint: 'embeddings + reranking' },
  { value: 'groq',      label: 'Groq',        hint: 'translation' },
  { value: 'cerebras',  label: 'Cerebras',    hint: 'translation + LLM' },
  { value: 'openrouter', label: 'OpenRouter', hint: 'translation (free)' },
])

For each key:
  p.select: "Store in .env (recommended)" | "Manual export" | "Skip"
  If store: p.text -> validate prefix -> write to env map
```

### Section: Embedding Provider

```
p.select: Voyage Code 3 | Mistral Codestral | Jina v3 | Local CodeRankEmbed | Auto
  If API provider selected & key missing: prompt for key
Writes: EMBEDDING_PROVIDER=<value> (or removes for auto)
```

### Section: Reranking

```
p.select: Local ModernBERT INT8 (recommended) | API (Voyage/Jina) | Auto | FlashRank-only
  If API:
    p.select: Voyage rerank-2.5 | Jina reranker-v3
    Check/prompt for API key
Writes: USE_LOCAL_RERANKER=true/false
```

### Section: Translation

```
p.select: Auto | Cloud | Local-only | Disabled
  If Cloud/Auto:
    p.select: Groq llama-3.1-8b-instant (BEST VALUE) | Groq llama-3.3-70b | Cerebras | Custom
    Check/prompt for API key
    If Custom: p.text for TRANSLATION_API_URL, TRANSLATION_MODEL
Writes: TRANSLATION_PROVIDER, TRANSLATION_OFFLINE, SWEET_SEARCH_TRANSLATE
```

### Section: Late Interaction

```
p.select: LateOn-Code Full (149M, recommended) | LateOn-Code Edge (17M) | Disabled
Writes: SWEET_SEARCH_LATE_INTERACTION_MODEL=<value>
```

### Section: Cascade Scoring

```
p.select: Shadow (default) | Active | Disabled
  If active/shadow: optional p.text for gate threshold, CE top-K
Writes: SWEET_SEARCH_CASCADE_ENABLED, SWEET_SEARCH_CASCADE_SHADOW,
        SWEET_SEARCH_CASCADE_GATE_THRESHOLD, SWEET_SEARCH_CASCADE_CE_TOP_K
```

### Section: HNSW Tuning (advanced)

```
p.select: Default (M=16, ef=200/100) | High Recall (M=32, ef=400/200) |
          Fast (M=12, ef=100/50) | Custom
  If custom: p.select for M, efConstruction, efSearch
Writes: SWEET_SEARCH_HNSW_M, SWEET_SEARCH_HNSW_EF_CONSTRUCTION, SWEET_SEARCH_HNSW_EF_SEARCH
```

> **Note:** HNSW params are currently hardcoded in `core/config.js`. Need to add 3 lines of
> env var override support (same pattern as every other config). See Phase 7.

### Confirmation & Summary

```
p.note(changesTable)           // all pending changes
confirmed = p.confirm("Apply these changes?")
if confirmed:
  saveEnv(mergedVars)          // atomic write, chmod 600
  p.log.success("Saved to .env")
  // Validate via child process (ESM module cache prevents re-import)
  fork('node -e "import(./core/config.js).then(c => ...)"')
  p.note(summaryTable)         // before/after comparison
p.outro("Done!")
```

---

## Phase 3: Interactive Index Wizard (`scripts/index-wizard.js`)

### File: `scripts/index-wizard.js` (~350 lines)

Guided indexer wizard. Collects flags interactively, then delegates to
`core/index-codebase-v21.js` via `spawnSync()`.

**Entry points:**
- `npm run index:interactive`
- `sweet-search index --interactive` / `sweet-search index -i`

### Flow

```
p.intro("Sweet Search -- Codebase Indexer")

// Step 1: Show current index state
state = getIndexState()
p.note(stateTable)             // artifact sizes, last indexed, file counts

// Step 2: Index scope
scope = p.select("What do you want to index?", [
  { value: 'incremental', label: 'Incremental (default)',  hint: 'only changed files' },
  { value: 'full',        label: 'Full Reindex',           hint: 'rebuild everything' },
  { value: 'graph-only',  label: 'Code Graph Only',        hint: 'lexical entities + relationships' },
  { value: 'vectors-only', label: 'Vectors + HNSW Only',   hint: 'semantic search' },
])

// Step 3: Late interaction (skip if graph-only)
if scope !== 'graph-only':
  colbert = p.select("Late interaction (ColBERT)?", [
    { value: 'default', label: 'Build with current model',  hint: 'MaxSim reranking' },
    { value: 'skip',    label: 'Skip (faster)',              hint: '--no-colbert' },
    { value: 'edge',    label: 'Use edge model (17M)',       hint: 'smaller, lower quality' },
  ])

// Step 4: HNSW strategy (skip if graph-only)
if scope !== 'graph-only':
  hnsw = p.select("HNSW vector index?", [
    { value: 'auto',           label: 'Auto (default)',    hint: 'native if available, JS fallback' },
    { value: 'require-native', label: 'Require native',    hint: 'fail if usearch unavailable' },
  ])

// Step 5: Advanced options (collapsed)
showAdvanced = p.confirm("Configure advanced options?", initialValue: false)
if showAdvanced:
  p.group({
    sqliteFast: () => p.confirm("Fast SQLite pragmas? (benchmarking only)", false),
    dryRun:     () => p.confirm("Dry run? (preview without indexing)", false),
    stats:      () => p.confirm("Show statistics after indexing?", true),
  })

// Step 6: Confirm
args = buildArgsFromChoices(...)
p.note("node core/index-codebase-v21.js " + args.join(' '), "Command")
confirmed = p.confirm("Run indexer now?")

if confirmed:
  spawnSync('node', [INDEXER, ...args], { stdio: 'inherit' })
  p.outro("Indexing complete! Run ss 'query' to search.")
else:
  p.log.info("Run manually: node core/index-codebase-v21.js " + args.join(' '))
  p.outro("Done.")
```

---

## Phase 4: Interactive Warmup Wizard (`scripts/warmup-wizard.js`)

### File: `scripts/warmup-wizard.js` (~400 lines)

Interactive vocabulary prewarm with Leiden community detection and PageRank ranking.
Wraps `core/vocab-warmer.js` + `core/community-detector.js` + `core/repo-map.js`.

**Entry points:**
- `npm run warmup:interactive`
- `sweet-search warmup` (interactive by default, `--quick` to skip wizard)

### Flow

```
p.intro("Sweet Search -- Vocabulary Warmup")

// Step 1: Show current vocabulary state
p.note(vocabStateTable)        // cache size, hit rates, last warmed, community count

// Step 2: Warmup mode
mode = p.select("Warmup strategy?", [
  { value: 'incremental', label: 'Incremental (default)',  hint: 'only new/changed terms' },
  { value: 'full',        label: 'Full rebuild',           hint: 'mine everything from scratch' },
  { value: 'stats',       label: 'Show statistics only',   hint: 'no warming, just report' },
  { value: 'dry-run',     label: 'Dry run',                hint: 'preview what would be mined' },
])

// Step 3: Mining depth
if mode !== 'stats':
  depth = p.select("Mining depth?", [
    { value: 'light',  label: 'Light',   hint: 'entity names only' },
    { value: 'medium', label: 'Medium (default)', hint: 'entities + NL phrases' },
    { value: 'deep',   label: 'Deep',    hint: 'entities + NL + question variants' },
  ])

// Step 4: Search modes to warm
if mode !== 'stats':
  modes = p.multiselect("Which search modes to warm?", [
    { value: 'lexical',  label: 'Lexical',  hint: 'FTS5 MATCH queries' },
    { value: 'semantic', label: 'Semantic', hint: 'pre-compute embeddings' },
    { value: 'hybrid',   label: 'Hybrid',  hint: 'full pipeline exercise' },
  ], initialValues: ['lexical', 'semantic', 'hybrid'])

// Step 5: Community detection options
if mode !== 'stats':
  communities = p.confirm("Run Leiden community detection?", initialValue: true)
  // Leiden discovers logical code communities in the import graph
  // Communities are used to generate representative queries per cluster

if communities:
  communityOpts = p.group({
    pageRank: () => p.confirm("Use PageRank to rank hub entities?", true),
    topTerms: () => p.select("Terms to warm per community?", [
      { value: '50',  label: '50 (fast)' },
      { value: '200', label: '200 (balanced, default)' },
      { value: '500', label: '500 (thorough)' },
    ], initialValue: '200'),
  })

// Step 6: Total term budget
topN = p.select("Total term budget?", [
  { value: '500',  label: '500 (fast, ~30s)',    hint: 'core identifiers only' },
  { value: '1000', label: '1000 (default, ~1m)', hint: 'good coverage' },
  { value: '3000', label: '3000 (thorough, ~3m)', hint: 'full vocabulary' },
])

// Step 7: Confirm & run
p.note(flagSummary, "Command")
confirmed = p.confirm("Start warmup?")
if confirmed:
  // Run with p.spinner for progress
  s = p.spinner()
  s.start("Mining vocabulary...")
  result = await runFullWarmup(opts)
  s.stop("Warmup complete")

  // Show results
  p.note(resultTable)          // terms mined, communities, warmup time, per-mode stats
  p.outro("Vocabulary warmed! Queries will be sub-millisecond.")
```

### What the warmup does under the hood

1. **Mine** -- `core/vocab-warmer.js` extracts identifiers from code-graph.db
2. **Leiden** -- `core/community-detector.js` runs Leiden clustering on the import graph
   to find logical code communities (e.g., "auth module", "payment service")
3. **PageRank** -- `core/repo-map.js` runs PageRank on the entity graph to find hub
   entities (most-connected, highest importance)
4. **Rank** -- BM25 + PageRank scores combined with heuristic multipliers
5. **Warm** -- Pre-compute embeddings for top N terms, exercise each search mode
6. **Persist** -- Save to `.sweet-search/query-vocabulary.json` for instant cache hits

---

## Phase 5: Interactive HCGS Wizard (`scripts/hcgs-wizard.js`)

### File: `scripts/hcgs-wizard.js` (~300 lines)

Interactive Hierarchical Code Graph Summary generation. Wraps `core/hcgs-generator.js`.

**Entry points:**
- `npm run hcgs:interactive`
- `sweet-search hcgs` (interactive by default, `--quick` to skip wizard)

### Flow

```
p.intro("Sweet Search -- Code Graph Summaries (HCGS)")
p.log.info("Based on Code-Craft paper: 82% improvement in retrieval precision")

// Step 1: Show current HCGS state
p.note(hcgsStateTable)         // entities needing summaries, existing count, provider, storage

// Step 2: Action
action = p.select("What to do?", [
  { value: 'generate',  label: 'Generate summaries', hint: 'bottom-up hierarchy' },
  { value: 'stats',     label: 'Show statistics',    hint: 'coverage by entity type' },
  { value: 'condensed', label: 'Generate condensed repo map', hint: 'PageRank-ranked, token-budget' },
])

// Step 3: Provider selection (if generate)
if action === 'generate':
  provider = p.select("Summary generation provider?", [
    { value: 'auto',          label: 'Auto (fallback chain)',         hint: 'Cerebras -> Ollama -> Transformers.js -> Static' },
    { value: 'cerebras',      label: 'Cerebras GLM-4.6',              hint: 'fast, 1000 tok/s, needs API key' },
    { value: 'ollama',        label: 'Ollama (local LLM)',            hint: 'free, needs ollama running' },
    { value: 'transformers',  label: 'Transformers.js (local)',       hint: 'free, slowest, no external deps' },
    { value: 'static',        label: 'Static (heuristic)',            hint: 'instant, no LLM, lowest quality' },
  ])

// Step 4: Hierarchy levels
levels = p.multiselect("Which hierarchy levels?", [
  { value: 'method',    label: 'Methods',     hint: '1-2 sentence descriptions' },
  { value: 'function',  label: 'Functions' },
  { value: 'field',     label: 'Fields',      hint: 'brief purpose' },
  { value: 'class',     label: 'Classes',     hint: 'purpose + responsibilities' },
  { value: 'interface', label: 'Interfaces',  hint: 'contract description' },
  { value: 'enum',      label: 'Enums' },
  { value: 'file',      label: 'Files',       hint: 'architectural overview' },
  { value: 'package',   label: 'Packages',    hint: 'top-level summaries' },
], initialValues: ['method', 'function', 'class', 'interface', 'file', 'package'])

// Step 5: Concurrency
concurrency = p.select("Parallel generation concurrency?", [
  { value: '2',  label: '2 (safe)', hint: 'low resource usage' },
  { value: '5',  label: '5 (default)' },
  { value: '10', label: '10 (fast)', hint: 'needs good CPU/API rate limit' },
])

// Step 6: Condensed repo map (if selected)
if action === 'condensed':
  tokenBudget = p.select("Token budget for repo map?", [
    { value: '512',  label: '512 tokens',   hint: 'compact, top entities only' },
    { value: '1024', label: '1024 (default)', hint: 'good overview' },
    { value: '2048', label: '2048 tokens',  hint: 'detailed, more symbols' },
    { value: '4096', label: '4096 tokens',  hint: 'comprehensive' },
  ])
  // Uses core/repo-map.js: PageRank -> rank entities -> binary search to fit budget

// Step 7: Confirm & run
p.note(summary, "Command")
confirmed = p.confirm("Start generation?")
if confirmed:
  s = p.spinner()
  s.start("Generating summaries...")
  // ... run hcgs-generator ...
  s.stop("Generation complete")
  p.note(resultTable)          // entities summarized, time, provider used
  p.outro("Summaries ready!")
```

---

## Phase 6: Interactive Doctor/Diagnostics (`scripts/doctor-wizard.js`)

### File: `scripts/doctor-wizard.js` (~350 lines)

Health check dashboard combining DB inspection, model verification, and benchmarks.
Wraps `scripts/check-db.js`, `scripts/verify-runtime.js`, and benchmark tooling.

**Entry points:**
- `npm run doctor`
- `sweet-search doctor`

### Flow

```
p.intro("Sweet Search -- Doctor")

// Step 1: Quick health check (always runs)
s = p.spinner()
s.start("Running health checks...")
checks = await runHealthChecks()  // DB exists, models cached, native binary, WASM router
s.stop("Health check complete")

p.note(healthTable)            // green/yellow/red status for each component:
  // Code Graph DB:          OK (2.3 MB, 4521 entities)
  // Vector DB:              OK (32.1 MB, 4521 chunks)
  // HNSW Index:             OK (native usearch, 4521 vectors)
  // Binary HNSW:            OK (128 bytes/vector, 4521 vectors)
  // Late Interaction:       OK (lateon-code, 72K tokens)
  // Embedding Model:        OK (CodeRankEmbed INT8, cached)
  // FlashRank Model:        OK (TinyBERT, cached)
  // Reranker Model:         OK (ModernBERT INT8, cached)
  // WASM Router:            OK (CatBoost, 48 KB)
  // Native Binary:          OK (darwin-arm64)
  // Vocabulary Cache:       OK (1523 terms, 87% hit rate)
  // Merkle State:           OK (last indexed: 2 hours ago)

// Step 2: Deeper diagnostics (optional)
action = p.select("What next?", [
  { value: 'done',       label: 'Done',                hint: 'health check is sufficient' },
  { value: 'db-inspect', label: 'Inspect databases',   hint: 'tables, row counts, schema' },
  { value: 'benchmark',  label: 'Run quick benchmark', hint: 'latency + recall spot check' },
  { value: 'models',     label: 'Model status',        hint: 'cache sizes, download status' },
  { value: 'fix',        label: 'Auto-fix issues',     hint: 're-download missing models, rebuild' },
])

// Step 3: DB inspect
if action === 'db-inspect':
  db = p.select("Which database?", [
    { value: 'code-graph', label: 'Code Graph (code-graph.db)',      hint: 'entities, relationships, FTS5' },
    { value: 'codebase',   label: 'Vector Store (codebase.db)',      hint: 'embeddings, chunks' },
    { value: 'colbert',    label: 'Late Interaction (codebase-late-interaction.db)', hint: 'ColBERT tokens' },
  ])
  // Run check-db.js logic, display results in p.note()

// Step 4: Quick benchmark
if action === 'benchmark':
  p.note("Running 10 search queries across all modes...")
  s = p.spinner()
  s.start("Benchmarking...")
  results = await quickBenchmark()
  s.stop("Benchmark complete")
  p.note(benchmarkTable)       // p50/p95 per mode, recall estimate

// Step 5: Auto-fix
if action === 'fix':
  // Re-run init with --force for missing models
  // Rebuild HNSW if metadata mismatch
  // Regenerate merkle state if corrupted

p.outro("All checks complete!")
```

---

## Full Command Inventory

All commands that could eventually get interactive treatment. Phases 1-6 cover the
starred items. The rest are candidates for future phases.

| Command | Current | Interactive? | Notes |
|---------|---------|-------------|-------|
| **`sweet-search config`** | `.env` + manual edits | **Phase 2** | Unified wizard for all settings |
| **`sweet-search index -i`** | 8 CLI flags | **Phase 3** | Questionnaire per flag |
| **`sweet-search warmup`** | `--depth --modes --top` | **Phase 4** | Leiden + PageRank + mode selection |
| **`sweet-search hcgs`** | `generate` / `stats` | **Phase 5** | Provider chain, hierarchy, concurrency |
| **`sweet-search doctor`** | `check-db.js` + `verify-runtime.js` | **Phase 6** | Health dashboard, DB inspect, benchmark |
| `sweet-search init` | `--profile --force --verify-deep` | Future | Already structured, add wizard layer |
| `sweet-search eval` | 12 npm scripts, many flags | Future | Profile selection, regression check, baseline |
| `sweet-search benchmark` | `--full-index --search --ci` | Future | Suite selection, baseline comparison |
| `sweet-search train` | feature extraction + model training | Future | Feature set, model type, validation |

### Features surfaced via warmup wizard

| Feature | Implementation | What it does |
|---------|---------------|--------------|
| **Leiden clustering** | `core/community-detector.js` + `core/leiden-algorithm.js` | Discovers logical code communities in the import graph (Traag et al. 2019) |
| **PageRank** | `core/repo-map.js` | Ranks entities by graph importance (most-connected hubs) |
| **Condensed repo map** | `core/repo-map.js` | Token-budget-constrained map: file -> ranked symbols (Aider-inspired) |
| **BM25 term ranking** | `core/vocab-warmer.js` | Scores terms by corpus relevance |
| **Community-aware queries** | `core/vocab-warmer.js` | Generates representative queries per Leiden cluster |

### Features surfaced via HCGS wizard

| Feature | Implementation | What it does |
|---------|---------------|--------------|
| **Bottom-up summaries** | `core/hcgs-generator.js` | Method -> Class -> File -> Package summary hierarchy |
| **Provider fallback chain** | `core/llm-provider.js` | Cerebras -> Ollama -> Transformers.js -> Static |
| **Summary embeddings** | `core/embedding-service.js` | Binary embeddings for future hybrid search over summaries |
| **Condensed repo map** | `core/repo-map.js` | PageRank + binary search to fit token budget |

---

## Phase 7: CLI Dispatcher Update (`bin/sweet-search.js`)

### File: `bin/sweet-search.js` (modify existing, ~60 lines total)

Add routing for all interactive commands:

```js
const args = process.argv.slice(2);

if (args[0] === 'init') {
  const { runInit } = await import('../scripts/init.js');
  await runInit(args.slice(1));
} else if (args[0] === 'config') {
  await import('../scripts/config-wizard.js');
} else if (args[0] === 'index' && (args.includes('-i') || args.includes('--interactive'))) {
  await import('../scripts/index-wizard.js');
} else if (args[0] === 'warmup') {
  await import('../scripts/warmup-wizard.js');
} else if (args[0] === 'hcgs') {
  await import('../scripts/hcgs-wizard.js');
} else if (args[0] === 'doctor') {
  await import('../scripts/doctor-wizard.js');
} else {
  // existing native/JS fallback dispatch
}
```

---

## Phase 8: Package Metadata Updates (`package.json`)

**Dependencies (runtime, not dev):**
```json
"dependencies": {
  "@clack/prompts": "^1.1.0"
}
```

**Scripts:**
```json
"config": "node scripts/config-wizard.js",
"index:interactive": "node scripts/index-wizard.js",
"warmup:interactive": "node scripts/warmup-wizard.js",
"hcgs:interactive": "node scripts/hcgs-wizard.js",
"doctor": "node scripts/doctor-wizard.js"
```

**Files (npm publish whitelist):**
```json
"scripts/config-wizard.js",
"scripts/index-wizard.js",
"scripts/warmup-wizard.js",
"scripts/hcgs-wizard.js",
"scripts/doctor-wizard.js",
"scripts/ui-helpers.js"
```

---

## Phase 9: Skill Documentation Updates

### `.claude/commands/index-codebase.md`

Add section:
```markdown
## Interactive Mode

sweet-search index --interactive   # or: npm run index:interactive

Guided wizard with questionnaires for each flag.
```

### `.claude/commands/sweet-config-rerank.md` & `sweet-config-translate.md`

Add note referencing the unified wizard:
```markdown
## Unified Config Wizard

sweet-search config                # or: npm run config
sweet-search config --section rerank   # jump to reranking section
```

---

## Phase 10: Config.js Env Overrides (minimal, optional)

To support HNSW tuning from the wizard, add env var overrides to `core/config.js`
(3 lines, same pattern used everywhere else):

```js
// In HNSW_CONFIG:
M: parseInt(process.env.SWEET_SEARCH_HNSW_M) || 16,
efConstruction: parseInt(process.env.SWEET_SEARCH_HNSW_EF_CONSTRUCTION) || 200,
efSearch: parseInt(process.env.SWEET_SEARCH_HNSW_EF_SEARCH) || 100,
```

Skip this phase if `core/config.js` should remain untouched.

---

## Implementation Sequence

| Step | Phase | Files | Depends On | Effort |
|------|-------|-------|------------|--------|
| 1 | -- | `npm install @clack/prompts` | -- | 1 min |
| 2 | 1 | `scripts/ui-helpers.js` | Step 1 | ~1.5 hr |
| 3 | 2 | `scripts/config-wizard.js` | Step 2 | ~3.5 hr |
| 4 | 3 | `scripts/index-wizard.js` | Step 2 | ~2.5 hr |
| 5 | 4 | `scripts/warmup-wizard.js` | Step 2 | ~2.5 hr |
| 6 | 5 | `scripts/hcgs-wizard.js` | Step 2 | ~2 hr |
| 7 | 6 | `scripts/doctor-wizard.js` | Step 2 | ~2.5 hr |
| 8 | 7 | `bin/sweet-search.js` | Steps 3-7 | 15 min |
| 9 | 8 | `package.json` | Steps 1-7 | 10 min |
| 10 | 9 | `.claude/commands/*.md` | Steps 3-7 | 30 min |
| 11 | 10 | `core/config.js` (3 lines) | -- | 5 min |
| 12 | -- | Manual testing & polish | All | ~3 hr |

---

## New Files

| File | Lines | Purpose |
|------|-------|---------|
| `scripts/ui-helpers.js` | ~150 | Shared .env helpers, state inspector, key masking |
| `scripts/config-wizard.js` | ~480 | Unified interactive config wizard |
| `scripts/index-wizard.js` | ~350 | Interactive indexer wizard |
| `scripts/warmup-wizard.js` | ~400 | Interactive vocab warmup with Leiden/PageRank |
| `scripts/hcgs-wizard.js` | ~300 | Interactive HCGS summary generation |
| `scripts/doctor-wizard.js` | ~350 | Health dashboard + DB inspect + benchmark |

## Modified Files

| File | Change |
|------|--------|
| `bin/sweet-search.js` | Add `config`, `index -i`, `warmup`, `hcgs`, `doctor` routes (+15 lines) |
| `package.json` | Add dependency, 5 scripts, 6 files entries |
| `core/config.js` | Add 3 env var overrides for HNSW (optional) |
| `.claude/commands/index-codebase.md` | Document interactive mode |
| `.claude/commands/sweet-config-rerank.md` | Reference unified wizard |
| `.claude/commands/sweet-config-translate.md` | Reference unified wizard |
| `.claude/commands/sweet-prewarm-vocab.md` | Reference warmup wizard |

---

## Potential Challenges

1. **HNSW tuning not env-overridable** -- Hardcoded in config.js. Phase 7 adds 3 lines.
   Skip if config.js is strictly read-only.

2. **ESM module cache** -- After writing `.env`, `core/config.js` cannot be re-imported
   in the same process. Validation must use a child process fork.

3. **TTY detection** -- When invoked as a Claude Code skill, stdin may not be a TTY.
   Detect `!process.stdin.isTTY` and fall back gracefully with an error message
   directing the user to run the command directly in their terminal.

4. **API key input visibility** -- `@clack/prompts` `text()` does not mask input.
   Check if v1.1.0 has a `password()` prompt. If not, accept the key and immediately
   mask in all subsequent output.

---

## Security

- API keys: NEVER printed in full, `maskKey()` everywhere
- `.env` written with `chmod 0o600`
- `.env` confirmed in `.gitignore`
- No keys in logs, stdout, or any file other than `.env`
- "Manual export" option prints template with `'your-key-here'` placeholder, no actual key
- Keys held in memory only during wizard session
