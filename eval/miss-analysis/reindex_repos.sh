#!/usr/bin/env bash
# Reindex eval/repos/{fastify,flask,ripgrep} with current production pipeline.
# Run sequentially so the indexer doesn't fight itself for ORT threads.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
INDEXER="$ROOT/core/indexing/index-codebase-v21.js"
LOG="$ROOT/eval/miss-analysis/_repos_reindex.log"

: > "$LOG"
echo "Indexer: $INDEXER" >> "$LOG"
echo "Started: $(date)" >> "$LOG"

for repo in fastify flask ripgrep; do
  echo "" >> "$LOG"
  echo "=== $repo ===" >> "$LOG"
  date >> "$LOG"
  pushd "$ROOT/eval/repos/$repo" > /dev/null
  SWEET_SEARCH_PROJECT_ROOT="$PWD" EMBEDDING_PROVIDER=local \
    node "$INDEXER" --full --sqlite-fast >> "$LOG" 2>&1
  popd > /dev/null
done

echo "" >> "$LOG"
echo "Finished: $(date)" >> "$LOG"
