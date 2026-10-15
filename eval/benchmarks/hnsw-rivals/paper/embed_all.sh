#!/usr/bin/env bash
# Re-embed every set with all three models in fp32 through embed.py (owner decision 2026-10-15: one pipeline for all models;
# the stored product vectors are not used for the paper).
#
#   embed_all.sh <DATA> <device> [--sets a,b] [--models a,b]
#   e.g.  embed_all.sh /workspace/hnsw-data cuda
#
# !! DATA must be a SEPARATE root, e.g. /workspace/hnsw-data on the pod. On the Mac and the box, ~/.ss-eval/hnsw-paper/emb/CodeRankEmbed/<set>/
# !! holds symlinks to the old product vectors (and an `index` link). This script writes DATA/emb/<model>/<set>/ and refuses to run if
# !! such a directory is a symlink or holds one, so nothing old is overwritten. Never point DATA at the old root.
#
# DATA layout (copy the texts bundle first, see TEXTS_BUNDLE.txt):
#   DATA/sets/<set>/{texts.jsonl,queries.jsonl,set.json,vectors.jsonl}      inputs
#   DATA/embed-ref/<model>/<set>/{corpus.f32,queries.f32,ref.json}          Mac CPU references (REF=... overrides)
#   DATA/emb/<model>/<set>/{corpus.f32,queries.f32,model.json}              output
#   DATA/logs/embed_all.<time>.log, DATA/logs/rates.tsv                     log, docs/s + queries/s per (set, model)
#   DATA/emb/SHA256SUMS.txt                                                 SHA-256 of every corpus.f32 / queries.f32 written at the end
#
# Steps: (1) the check gate once per model (embed.py --check; stops the run if min cosine < 0.9999; the gate set is the smallest
# selected set); (2) embed.py for every set x model, largest set first; (3) the SHA-256 list. Resumable: run the same command again;
# complete outputs are skipped (model.json with the same texts hash) and a partial one continues from its .part file.
# Env: PY (python, default `python`), BATCH (default 64 on cuda, 16 otherwise), REF.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
[ $# -ge 2 ] || { sed -n 2,6p "$0"; exit 2; }
DATA="$1"; DEVICE="$2"; shift 2
ALL_SETS="csn1m quora dall fiqa advtest d20k gcsn"           # largest first (vectors: 1.0M, 523k, 140k, 58k, 22k, 20k, 6.9k)
ALL_MODELS="CodeRankEmbed jina-v2-base-code bge-base-en-v1.5"
SETS="$ALL_SETS"; MODELS="$ALL_MODELS"
while [ $# -gt 0 ]; do
  case "$1" in
    --sets) SETS="$(echo "$2" | tr ',' ' ')"; shift 2;;
    --models) MODELS="$(echo "$2" | tr ',' ' ')"; shift 2;;
    *) echo "unknown argument $1"; exit 2;;
  esac
done
# keep the largest-first order whatever order --sets gave
ORDERED=""; for s in $ALL_SETS; do for t in $SETS; do [ "$s" = "$t" ] && ORDERED="$ORDERED $s"; done; done; SETS="${ORDERED# }"
[ -n "$SETS" ] || { echo "no valid set selected (known: $ALL_SETS)"; exit 2; }
PY="${PY:-python}"
BATCH="${BATCH:-$([ "$DEVICE" = cuda ] && echo 64 || echo 16)}"
REF="${REF:-$DATA/embed-ref}"
LOGDIR="$DATA/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/embed_all.$(date +%Y%m%dT%H%M%S).log"
RATES="$LOGDIR/rates.tsv"
exec > >(tee -a "$LOG") 2>&1
echo "embed_all: DATA=$DATA device=$DEVICE batch=$BATCH sets=[$SETS] models=[$MODELS] log=$LOG"

# never write through a symlink of the old layout
for m in $MODELS; do
  for s in $SETS; do
    d="$DATA/emb/$m/$s"
    if [ -L "$d" ] || { [ -d "$d" ] && [ -n "$(find "$d" -maxdepth 2 -type l -print -quit)" ]; }; then
      echo "REFUSED: $d is or holds a symlink (old product-vector layout). Use a separate DATA root."; exit 3
    fi
  done
done
for s in $SETS; do
  for f in texts.jsonl queries.jsonl; do [ -f "$DATA/sets/$s/$f" ] || { echo "missing $DATA/sets/$s/$f"; exit 3; }; done
done

# (1) check gate, once per model, on the smallest selected set
GATE_SET="$(echo $SETS | awk '{print $NF}')"
for m in $MODELS; do
  echo "== gate $m on $GATE_SET"
  "$PY" "$HERE/embed.py" --model "$m" --set "$GATE_SET" --data "$DATA" --device "$DEVICE" --batch "$BATCH" --check "$REF/$m/$GATE_SET" \
    || { echo "GATE FAILED for $m: stop. Do not embed."; exit 4; }
done

# (2) embed
[ -f "$RATES" ] || printf 'time\tset\tmodel\tdocs\tqueries\tdocs_per_s\tqueries_per_s\tsession_seconds\tstatus\n' > "$RATES"
for s in $SETS; do
  for m in $MODELS; do
    echo "== embed $s / $m"
    t0=$(date +%s)
    "$PY" "$HERE/embed.py" --model "$m" --set "$s" --data "$DATA" --device "$DEVICE" --batch "$BATCH"
    t1=$(date +%s)
    "$PY" - "$DATA/emb/$m/$s/model.json" "$s" "$m" "$((t1 - t0))" >> "$RATES" <<'PYEOF'
import json, sys, time
mj, s, m, wall = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3], int(sys.argv[4])
r = mj.get('rates_this_session') or {}
status = 'skipped (already complete)' if wall < 5 else 'done'
print('\t'.join(str(x) for x in (time.strftime('%Y-%m-%dT%H:%M:%S'), s, m, mj['truncation']['documents'], mj['truncation']['queries'],
                                r.get('docs_per_s') if wall >= 5 else '', r.get('queries_per_s') if wall >= 5 else '', wall, status)))
PYEOF
    tail -1 "$RATES"
  done
done

# (3) SHA-256 of every corpus.f32 / queries.f32 (all sets and models present under DATA/emb, not only the selected ones)
SUMS="$DATA/emb/SHA256SUMS.txt"
( cd "$DATA/emb" && find . \( -name corpus.f32 -o -name queries.f32 \) -not -path './*.limit*' -print | sort | while read -r f; do
    if command -v sha256sum >/dev/null; then sha256sum "$f"; else shasum -a 256 "$f"; fi; done ) > "$SUMS"
echo "== done. $(wc -l < "$SUMS") files in $SUMS"; cat "$SUMS"
