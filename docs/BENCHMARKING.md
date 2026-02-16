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

## Architecture

```
eval/run_all.js          ─── orchestrates multiple benchmarks
eval/run_benchmark.js    ─── runs a single benchmark end-to-end
eval/lib/indexer.js      ─── spawns core indexer, manages options
eval/lib/evaluator.js    ─── query execution + result evaluation
eval/lib/corpus.js       ─── dataset download + file materialization
eval/lib/metrics.js      ─── MRR, NDCG, Recall computation
```
