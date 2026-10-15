#!/usr/bin/env bash
# Reference vectors for the GPU check gate (embed.py --check): first 50 documents + 50 queries of every set, every model,
# embedded on the Mac CPU in fp32. Output: REFROOT/<model>/<set>/{corpus.f32,queries.f32,ref.json}.
#   make_refs.sh [DATA=~/.ss-eval/hnsw-paper] [REFROOT=DATA/embed-ref]
# Waits for the 1-minute load average < 5 before each model.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="${1:-$HOME/.ss-eval/hnsw-paper}"
REF="${2:-$DATA/embed-ref}"
PY="${PY:-$DATA/venv-embed/bin/python}"
SETS="csn1m quora dall fiqa advtest d20k gcsn"
for MODEL in CodeRankEmbed jina-v2-base-code bge-base-en-v1.5; do
  while :; do
    L=$(sysctl -n vm.loadavg | awk '{print $2}')
    awk -v l="$L" 'BEGIN{exit !(l<5)}' && break
    echo "load $L >= 5, waiting 30 s"; sleep 30
  done
  for S in $SETS; do
    "$PY" "$HERE/embed.py" --model "$MODEL" --set "$S" --data "$DATA" --device cpu --batch 8 --make-ref "$REF/$MODEL/$S"
  done
done
