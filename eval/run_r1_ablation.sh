#!/usr/bin/env bash
# Driver for the R1-only embedding-text variant ablation.
#
# Reindexes the configured corpus once per SWEET_SEARCH_EMBED_TEXT_VARIANT,
# benchmarks each, and dumps logs + JSON results.
#
# Defaults assume the gencodesearchnet eval corpus shipped at
# eval/corpus/<dataset>, but both can be overridden via env vars:
#
#   SWEET_DATASET    dataset name under eval/data/ + eval/corpus/
#                    (default: gencodesearchnet)
#   SWEET_OUT_DIR    output directory for *.reindex.log / *.bench.log /
#                    *.result.json (default: /tmp/r1-ablation)
#   SWEET_VARIANTS   space-separated list of variants to run
#                    (default: current no_path normalized_path no_language
#                              parent_only enriched code_breadcrumb)
#
# Usage:
#   ./eval/run_r1_ablation.sh                     # all 7 variants
#   SWEET_VARIANTS='current parent_only' ./eval/run_r1_ablation.sh

set -euo pipefail

# Resolve repo root from the script location (no hardcoded paths).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATASET="${SWEET_DATASET:-gencodesearchnet}"
CORPUS="$ROOT/eval/corpus/$DATASET"
OUT="${SWEET_OUT_DIR:-/tmp/r1-ablation}"
mkdir -p "$OUT"

if [[ ! -d "$CORPUS" ]]; then
  echo "Corpus not found at $CORPUS" >&2
  echo "Set SWEET_DATASET to a directory under eval/corpus/." >&2
  exit 2
fi

DEFAULT_VARIANTS="current no_path normalized_path no_language parent_only enriched code_breadcrumb"
read -r -a VARIANTS <<< "${SWEET_VARIANTS:-$DEFAULT_VARIANTS}"

for V in "${VARIANTS[@]}"; do
  echo "=========================================="
  echo "   Variant: $V"
  echo "=========================================="

  # 1. Wipe + reindex (no LI build for R1-only ablation)
  rm -rf "$CORPUS/.sweet-search"
  START=$(date +%s)
  (cd "$CORPUS" && \
    SWEET_SEARCH_EMBED_TEXT_VARIANT="$V" \
    SWEET_SEARCH_PROJECT_ROOT="$CORPUS" \
    EMBEDDING_PROVIDER=local \
    SWEET_SEARCH_SQLITE_FAST_MODE=1 \
    node "$ROOT/core/indexing/index-codebase-v21.js" --full --no-late-interaction \
    > "$OUT/$V.reindex.log" 2>&1)
  REINDEX_S=$(($(date +%s) - START))
  echo "  reindex wall: ${REINDEX_S}s"

  # 2. R1-only benchmark (k=100 to support Recall@50/@100)
  SWEET_SEARCH_EMBED_TEXT_VARIANT="$V" \
    node "$ROOT/eval/run_benchmark.js" \
    --dataset="$DATASET" \
    --skip-index \
    --concurrency=12 \
    --profile=balanced \
    --k=100 \
    > "$OUT/$V.bench.log" 2>&1

  # 3. Capture the JSON results file (most recent for this dataset)
  LATEST=$(ls -t "$ROOT/eval/results/${DATASET}_"*.json 2>/dev/null | head -1 || true)
  if [[ -z "$LATEST" ]]; then
    echo "  no result JSON found for dataset=$DATASET" >&2
    continue
  fi
  cp "$LATEST" "$OUT/$V.result.json"
  echo "  result: $OUT/$V.result.json"

  # Summary line — reads the result.json `aggregate` and `perLanguage` fields.
  python3 - "$OUT/$V.result.json" "$V" "$REINDEX_S" <<'PY'
import json, sys
fp, variant, reindex_s = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(fp))
agg = d.get('aggregate', d.get('metrics', {}))  # accept either field name
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
