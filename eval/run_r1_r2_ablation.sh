#!/usr/bin/env bash
# Driver for full-profile (R1+LI) embedding-text variant ablation.
#
# Differs from run_r1_ablation.sh in two ways:
#   1. Reindex builds late-interaction artifacts (drops --no-late-interaction)
#   2. Benchmark uses --profile=full (LI applied at query time)
#
# Use this when you need the production-comparable number, not the
# isolated R1-only ceiling. With LI byte-stable across all variants
# (li_greedy_text + buildLiText hold the shipped form), R2 is held
# constant and only R1's contribution to the fused score moves.
#
# Env overrides match run_r1_ablation.sh:
#   SWEET_DATASET    dataset under eval/corpus/ (default: gencodesearchnet)
#   SWEET_OUT_DIR    output directory (default: /tmp/r1-r2-ablation)
#   SWEET_VARIANTS   space-separated variant list

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATASET="${SWEET_DATASET:-gencodesearchnet}"
CORPUS="$ROOT/eval/corpus/$DATASET"
OUT="${SWEET_OUT_DIR:-/tmp/r1-r2-ablation}"
mkdir -p "$OUT"

if [[ ! -d "$CORPUS" ]]; then
  echo "Corpus not found at $CORPUS" >&2
  exit 2
fi

DEFAULT_VARIANTS="current signature signature_rbphp"
read -r -a VARIANTS <<< "${SWEET_VARIANTS:-$DEFAULT_VARIANTS}"

for V in "${VARIANTS[@]}"; do
  echo "=========================================="
  echo "   Variant: $V (full profile, R1+LI)"
  echo "=========================================="

  rm -rf "$CORPUS/.sweet-search"
  START=$(date +%s)
  (cd "$CORPUS" && \
    SWEET_SEARCH_EMBED_TEXT_VARIANT="$V" \
    SWEET_SEARCH_PROJECT_ROOT="$CORPUS" \
    EMBEDDING_PROVIDER=local \
    SWEET_SEARCH_SQLITE_FAST_MODE=1 \
    node "$ROOT/core/indexing/index-codebase-v21.js" --full \
    > "$OUT/$V.reindex.log" 2>&1)
  REINDEX_S=$(($(date +%s) - START))
  echo "  reindex+LI wall: ${REINDEX_S}s"

  SWEET_SEARCH_EMBED_TEXT_VARIANT="$V" \
    node "$ROOT/eval/run_benchmark.js" \
    --dataset="$DATASET" \
    --skip-index \
    --concurrency=12 \
    --profile=full \
    --k=100 \
    > "$OUT/$V.bench.log" 2>&1

  LATEST=$(ls -t "$ROOT/eval/results/${DATASET}_"*.json 2>/dev/null | head -1 || true)
  if [[ -z "$LATEST" ]]; then
    echo "  no result JSON found for dataset=$DATASET" >&2
    continue
  fi
  cp "$LATEST" "$OUT/$V.result.json"
  echo "  result: $OUT/$V.result.json"

  python3 - "$OUT/$V.result.json" "$V" "$REINDEX_S" <<'PY'
import json, sys
fp, variant, reindex_s = sys.argv[1], sys.argv[2], sys.argv[3]
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
