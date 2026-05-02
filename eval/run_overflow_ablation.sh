#!/usr/bin/env bash
# Driver for the chunk-overflow / budget-alignment ablation.
#
# Three arms, each a full reindex + benchmark on GenCodeSearchNet
# (or any dataset under eval/data/<DATASET>):
#
#   current       baseline — production behavior (cap=2000, overhead=0)
#   raised_cap    SWEET_SEARCH_EMBED_TEXT_CAP=2200, overhead=0
#                 → expands the embedding-text slice ceiling so the
#                   ~50–100 char header overhead doesn't push near-cap
#                   chunks past 2000. Preserves cAST chunk boundaries
#                   (chunk count unchanged).
#   header_aware  cap=2000, SWEET_SEARCH_CHUNK_HEADER_OVERHEAD=80
#                 → subtracts header overhead from the chunker's max
#                   size so AST text + headers fit in 2000 by design.
#                   Slightly more chunks, smaller chunks at boundaries.
#
# Motivation: eval/results/chunk-overflow-audit.md found 80.5% of
# overflowing chunks are header-pushed, with 87.5% ≤100 chars over.
# Prefer raised_cap if it is flat-or-better on MRR/Recall — it preserves
# cAST chunk boundaries and is a 1-line change.
#
# Defaults assume eval/data/gencodesearchnet, but the dataset is
# overridable. The eval corpus must already be prepared at
# eval/corpus/<DATASET> (run_benchmark.js does this on first run).
#
# Usage:
#   ./eval/run_overflow_ablation.sh
#   SWEET_DATASET='gencodesearchnet' SWEET_OUT_DIR=/tmp/overflow-ab \
#     ./eval/run_overflow_ablation.sh
#   SWEET_VARIANTS='current raised_cap' ./eval/run_overflow_ablation.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATASET="${SWEET_DATASET:-gencodesearchnet}"
CORPUS="$ROOT/eval/corpus/$DATASET"
OUT="${SWEET_OUT_DIR:-/tmp/overflow-ablation}"
mkdir -p "$OUT"

if [[ ! -d "$CORPUS" ]]; then
  echo "Corpus not found at $CORPUS" >&2
  echo "Run 'node eval/run_benchmark.js --dataset=$DATASET' once first to prepare the corpus." >&2
  exit 2
fi

DEFAULT_VARIANTS="current raised_cap header_aware"
read -r -a VARIANTS <<< "${SWEET_VARIANTS:-$DEFAULT_VARIANTS}"

# Per-arm env declarations (stays empty for `current` so behavior is
# byte-identical to shipped).
arm_env() {
  case "$1" in
    current)      echo "" ;;
    raised_cap)   echo "SWEET_SEARCH_EMBED_TEXT_CAP=2200" ;;
    header_aware) echo "SWEET_SEARCH_CHUNK_HEADER_OVERHEAD=80" ;;
    *) echo "Unknown variant: $1" >&2; exit 3 ;;
  esac
}

for V in "${VARIANTS[@]}"; do
  echo "=========================================="
  echo "   Arm: $V    ($(arm_env "$V" || echo 'baseline'))"
  echo "=========================================="

  ARM_ENV="$(arm_env "$V")"

  # 1. Wipe + reindex (full reindex required — chunking output differs by arm).
  rm -rf "$CORPUS/.sweet-search"
  START=$(date +%s)
  (
    cd "$CORPUS" && \
    env $ARM_ENV \
        SWEET_SEARCH_PROJECT_ROOT="$CORPUS" \
        EMBEDDING_PROVIDER=local \
        SWEET_SEARCH_SQLITE_FAST_MODE=1 \
        node "$ROOT/core/indexing/index-codebase-v21.js" --full \
    > "$OUT/$V.reindex.log" 2>&1
  )
  REINDEX_S=$(($(date +%s) - START))
  echo "  reindex wall: ${REINDEX_S}s"

  # 2. Benchmark with --skip-index (the index we just built is still on disk).
  #    Use balanced profile so LI is built/used per existing infra. K=100 to
  #    support Recall@50/@100. Concurrency=12 matches the M3 Max benchmark
  #    flags the user always uses.
  env $ARM_ENV \
    node "$ROOT/eval/run_benchmark.js" \
      --dataset="$DATASET" \
      --skip-index \
      --concurrency=12 \
      --profile=balanced \
      --k=100 \
    > "$OUT/$V.bench.log" 2>&1

  # 3. Snapshot the latest result.json for this dataset.
  LATEST=$(ls -t "$ROOT/eval/results/${DATASET}_"*.json 2>/dev/null | head -1 || true)
  if [[ -z "$LATEST" ]]; then
    echo "  no result JSON found for dataset=$DATASET" >&2
    continue
  fi
  cp "$LATEST" "$OUT/$V.result.json"
  echo "  result: $OUT/$V.result.json"

  python3 - "$OUT/$V.result.json" "$V" "$REINDEX_S" <<'PY'
import json, sys
fp, arm, reindex_s = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(fp))
agg = d.get('aggregate', d.get('metrics', {}))
pl = d.get('perLanguage', {})
def f(x): return f'{(x or 0)*100:.2f}'
print(f"  TOTAL  MRR@10={f(agg.get('mrr_at_10'))}  R@10={f(agg.get('recall_at_10'))}  R@50={f(agg.get('recall_at_50'))}  R@100={f(agg.get('recall_at_100'))}  miss10={f(agg.get('gold_missing_top10_rate'))}  reindex={reindex_s}s")
for lang in sorted(pl.keys()):
    lm = pl[lang]
    print(f"    {lang:11s} MRR@10={f(lm.get('mrr_at_10'))}  R@10={f(lm.get('recall_at_10'))}  R@50={f(lm.get('recall_at_50'))}  R@100={f(lm.get('recall_at_100'))}")
PY
  echo
done

echo "=========================================="
echo "   Ablation complete. Logs at $OUT/"
echo "=========================================="
echo ""
echo "Decision rule:"
echo "  raised_cap >= current MRR@10 (within noise)  → ship raised_cap (preserves cAST boundaries, 1-line change)"
echo "  raised_cap < current AND header_aware >= current → ship header_aware"
echo "  both regress → keep current; investigate whether bi-encoder token-truncation is masking the change"
echo ""
echo "Reminder: bi-encoder is token-bound at 512; raised_cap mostly helps LI input."
echo "See eval/results/tokenizer-limit-probe.json for the chars/token analysis."
