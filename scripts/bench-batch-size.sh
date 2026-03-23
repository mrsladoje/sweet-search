#!/usr/bin/env bash
# Benchmark indexing speed across different batch sizes.
# Uses GenCodeSearchNet JS corpus (889 files).
#
# Usage: bash scripts/bench-batch-size.sh [batch_sizes...]
#   Default batch sizes: 1 2 4 8 16 32
#   Example: bash scripts/bench-batch-size.sh 1 4 16 64

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CORPUS="$PROJECT_DIR/eval/corpus/gencodesearchnet/javascript/Semantic-Org_Semantic-UI-React"
INDEXER="$PROJECT_DIR/core/index-codebase-v21.js"
RESULTS_FILE="$PROJECT_DIR/scripts/batch-bench-results.txt"

# Batch sizes to test (override via args)
if [ $# -gt 0 ]; then
  BATCH_SIZES=("$@")
else
  BATCH_SIZES=(1 2 4 8 16 32)
fi

FILE_COUNT=$(find "$CORPUS" -type f -not -path '*/.sweet-search/*' -not -path '*/.bench-*' | wc -l | tr -d ' ')

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Batch Size Indexing Benchmark                      ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Corpus: gencodesearchnet/javascript ($FILE_COUNT files)"
echo "║  Batch sizes: ${BATCH_SIZES[*]}"
echo "║  Indexer: --vectors-only --full (embed + HNSW only) ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Header for results
printf "%-12s %-14s %-10s\n" "BatchSize" "Total(s)" "docs/s"
printf "%-12s %-14s %-10s\n" "----------" "------------" "--------"

# Also write to file
{
  echo "# Batch Size Benchmark — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# Corpus: gencodesearchnet/javascript ($FILE_COUNT files)"
  echo "# Machine: $(uname -m), $(sysctl -n hw.ncpu 2>/dev/null || nproc) cores"
  echo "# Mode: --vectors-only --full (skips code graph, tests pure embed+HNSW)"
  echo ""
  printf "%-12s %-14s %-10s\n" "BatchSize" "Total(s)" "docs/s"
  printf "%-12s %-14s %-10s\n" "----------" "------------" "--------"
} > "$RESULTS_FILE"

# Use a data dir name that won't collide with real data
DATA_DIR_NAME=".bench-batch-tmp"

for BS in "${BATCH_SIZES[@]}"; do
  # Clean any previous run's data
  rm -rf "$CORPUS/$DATA_DIR_NAME"

  # Run the indexer, capture JSON output from last line
  START_S=$(date +%s)
  OUTPUT=$(
    SWEET_SEARCH_PROJECT_ROOT="$CORPUS" \
    SWEET_SEARCH_DATA_DIR="$DATA_DIR_NAME" \
    SWEET_SEARCH_INDEXER_BATCH_SIZE="$BS" \
    SWEET_SEARCH_PROVIDER=local \
    node "$INDEXER" --vectors-only --full --quiet 2>&1
  ) || true
  END_S=$(date +%s)

  # Try to extract durationSeconds from JSON output (last line)
  DURATION=$(echo "$OUTPUT" | tail -1 | grep -oE '"durationSeconds":[0-9]+(\.[0-9]+)?' | grep -oE '[0-9]+(\.[0-9]+)?' || echo "")

  # Fall back to wall-clock if JSON extraction fails
  if [ -z "$DURATION" ]; then
    DURATION=$((END_S - START_S))
  fi

  # Calculate docs/s
  DOCS_PER_SEC=$(echo "scale=1; $FILE_COUNT / $DURATION" | bc 2>/dev/null || echo "?")

  printf "%-12s %-14s %-10s\n" "$BS" "$DURATION" "$DOCS_PER_SEC"
  printf "%-12s %-14s %-10s\n" "$BS" "$DURATION" "$DOCS_PER_SEC" >> "$RESULTS_FILE"

  # Cleanup this run's data
  rm -rf "$CORPUS/$DATA_DIR_NAME"
done

echo ""
echo "Results saved to: $RESULTS_FILE"
