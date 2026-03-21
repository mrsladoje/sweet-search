# Benchmarking Guide

How to run Sweet Search benchmarks with the eval harness.

## Quick Start

```bash
# Download benchmark data (one-time)
python eval/download_data.py

# Run all benchmarks with default (balanced) profile
node eval/run_all.js

# Run a single benchmark
node eval/run_benchmark.js --dataset=codesearchnet

# Fast profile (quickest, no ColBERT)
node eval/run_all.js --profile=fast

# Full-quality profile (ColBERT enabled)
node eval/run_all.js --profile=full
```

## Profiles

Three built-in profiles control speed/quality tradeoffs:

| Profile | ColBERT Build | ColBERT Query | SQLite Mode | Index Mode |
|---------|--------------|---------------|-------------|------------|
| `fast` | off | off | fast | single |
| `balanced` (default) | off | off | fast | single |
| `full` | on | on | fast | single |

All profiles use fast SQLite pragmas by default since eval indices are disposable.
Use `--sqlite-safe` to force durable SQLite mode if needed.

## CLI Flags

Both `run_all.js` and `run_benchmark.js` accept these flags:

| Flag | Description |
|------|-------------|
| `--profile=fast\|balanced\|full` | Select a preset profile (default: `balanced`) |
| `--build-colbert=true\|false` | Override ColBERT index build (overrides profile) |
| `--use-colbert=true\|false` | Override ColBERT at query time (overrides profile) |
| `--index-mode=single\|two-phase` | Indexing strategy (default: `single`) |
| `--sqlite-fast` | Explicitly enable fast SQLite pragmas |
| `--sqlite-safe` | Force durable SQLite mode (disables fast pragmas) |
| `--require-native-ann` | Fail fast if usearch is unavailable |
| `--skip-index` | Reuse existing index (skip re-indexing) |
| `--max-queries=N` | Limit queries per benchmark |

CLI flags override profile defaults via nullish coalescing, so you can do:

```bash
# balanced profile but with ColBERT queries enabled
node eval/run_all.js --profile=balanced --use-colbert=true
```

### run_all.js only

| Flag | Description |
|------|-------------|
| `--benchmarks=all\|name1,name2` | Select benchmarks to run |

### run_benchmark.js only

| Flag | Description |
|------|-------------|
| `--dataset=NAME` | Benchmark dataset to run |
| `--language=LANG` | Filter to a specific language |

## Indexing Modes

### Single-pass (default)

One indexer invocation handles graph extraction, vector embedding, HNSW build, and optional ColBERT in a single process. Avoids duplicate model cold starts.

### Two-phase (legacy)

Runs `--graph-only` then `--vectors-only` as separate child processes. Retained for compatibility via `--index-mode=two-phase`.

## Native ANN Check

Use `--require-native-ann` to fail immediately if the usearch native backend isn't available. This prevents accidentally benchmarking on the slow JS fallback, which would produce misleading timing results.

```bash
# Verify usearch is working before a long benchmark suite
node eval/run_all.js --require-native-ann --benchmarks=all
```

## SQLite Fast Mode

All profiles enable fast SQLite pragmas (`synchronous=OFF`, `journal_mode=MEMORY`, `cache_size=-64000`) by default. These are safe for disposable benchmark indices but **not for production use** -- data may be lost on crash.

To opt out:

```bash
node eval/run_all.js --sqlite-safe
```

The indexer also respects `SWEET_SEARCH_SQLITE_FAST_MODE=1` as an environment variable, but the eval harness explicitly controls this per-run to prevent parent-shell leakage.

## Output

Results are saved to `eval/results/`:

- Per-benchmark: `eval/results/<dataset>_results.json`
- Combined: `eval/results/combined_<timestamp>.json`

Results include profile metadata, index timings (total, graph phase, vectors phase), and per-language metrics (MRR@10, Recall@20, NDCG@10).

## Core Indexer Flags

The eval harness threads these flags to `core/index-codebase-v21.js`:

| Flag | Description |
|------|-------------|
| `--no-colbert` | Skip ColBERT index build |
| `--require-native-ann` | Fail if usearch unavailable |
| `--sqlite-fast` | Enable fast SQLite pragmas |
| `--graph-only` | Build code graph only (two-phase mode) |
| `--vectors-only` | Build vectors/HNSW only (two-phase mode) |

## GenCodeSearchNet Benchmark (Translation Validation)

This is the standard benchmark for measuring translation impact on search quality.
6000 queries across 6 languages (Python, JS, Go, Ruby, Java, PHP).
Translation fallback triggers automatically on non-English queries with poor results.

### Step 1: Download data (one-time)

```bash
python eval/download_data.py
```

### Step 2: Index the corpus (one-time, ~5-10 min)

```bash
node --max-old-space-size=7168 eval/run_benchmark.js \
  --dataset=gencodesearchnet \
  --profile=balanced \
  --sqlite-fast
```

This creates the index in `eval/corpus/gencodesearchnet/.sweet-search/`.

### Step 3: Run the benchmark (reuse index)

```bash
# Translation enabled (default) — tests the OPUS-MT local translation fallback
node --max-old-space-size=7168 eval/run_benchmark.js \
  --dataset=gencodesearchnet \
  --skip-index \
  --profile=balanced \
  --sqlite-fast \
  --concurrency=5

# Translation disabled — baseline for A/B comparison
SWEET_SEARCH_TRANSLATE=false \
node --max-old-space-size=7168 eval/run_benchmark.js \
  --dataset=gencodesearchnet \
  --skip-index \
  --profile=balanced \
  --sqlite-fast \
  --concurrency=5
```

### Step 4: Compare results

Results are saved to `eval/results/gencodesearchnet_<timestamp>.json`. Key metrics:

| Metric | What it measures |
|--------|-----------------|
| MRR@10 | Mean Reciprocal Rank — how high the correct result appears |
| Recall@5 | Fraction of queries where correct result is in top 5 |
| Recall@20 | Fraction of queries where correct result is in top 20 |
| Success@1 | Fraction of queries where top-1 result is correct |

Compare the two runs (translate=on vs translate=off) to measure translation impact.

### Expected timings

| Machine | Concurrency | Time (6000 queries) | Notes |
|---------|-------------|---------------------|-------|
| WSL2 10GB RAM | 5 | ~25-40 min | CPU-bound on ONNX mutex |
| M3 Max | 5 | ~8-15 min (est.) | Metal/ANE acceleration, unified memory |

### Current best (March 22, 2026 — after Lexical Fix Plan)

Profile: `full` (late interaction ON), M3 Max 128GB, concurrency 12.

```
MRR@10:      81.9%    Recall@5:  89.2%    Recall@20: 92.8%
Success@1:   76.3%    Latency p50: 1213ms
```

Per-language: Python 93.3%, Go 94.2%, Java 82.1%, JS 69.0%, PHP 78.7%, Ruby 74.1%

Changes from the Lexical Fix Plan (weighted BM25, name_alias FTS5 column,
identifier variant expansion, abbreviation expansion, path-aware boost,
prefix indexes, narrow identifier routing) improved every language vs the
Feb 2026 baseline (+2.7pp MRR@10 aggregate).

### Baseline (Feb 18, 2026 — before Lexical Fix Plan)

```
MRR@10:      79.2%    Recall@5:  86.1%    Recall@20: 90.2%
Success@1:   73.8%    Latency p50: 406ms
```

Per-language: Python 89.8%, Go 93.6%, Java 80.9%, JS 65.5%, PHP 75.9%, Ruby 72.4%

### Pre-OPUS-MT Baseline (March 12, 2026)

```
MRR@10:      80.8%    Recall@5:  87.8%    Recall@20: 91.8%
Success@1:   75.3%    Latency p50: 927ms
```

Per-language: Python 92.0%, Go 94.2%, Java 80.9%, JS 67.8%, PHP 75.9%, Ruby 73.7%

### Important flags

- `--max-old-space-size=7168` — prevents WSL OOM kills (10GB WSL limit).
  On M3 Max with 36/64GB, you can raise this to 16384 or omit entirely.
- `--concurrency=5` — number of parallel query workers.
  On M3 Max, try 8 or 10 (more cores, no WSL overhead).
- `SWEET_SEARCH_VOCAB_AUTO_EXPAND=0` — disables vocab cache writes during benchmark
  (reduces I/O noise, optional).
- `SWEET_SEARCH_TRANSLATE=false` — global kill switch for translation (for A/B testing).

### OPUS-MT Translation Benchmark (standalone)

Tests translation quality and routing directly, without the full search pipeline:

```bash
# Dry run — verify routing only (instant)
node evaluation/benchmark-opus-mt.js --dry-run

# Live run — loads real ONNX models, translates 17 queries across 5 slices
node --max-old-space-size=4096 evaluation/benchmark-opus-mt.js --concurrency=5
```

## Architecture

```
eval/run_all.js          ─── orchestrates multiple benchmarks
eval/run_benchmark.js    ─── runs a single benchmark end-to-end
eval/lib/indexer.js      ─── spawns core indexer, manages options
eval/lib/evaluator.js    ─── query execution + result evaluation
eval/lib/corpus.js       ─── dataset download + file materialization
eval/lib/metrics.js      ─── MRR, NDCG, Recall computation
```
