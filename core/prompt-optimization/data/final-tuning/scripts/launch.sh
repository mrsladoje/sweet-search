#!/usr/bin/env bash
# launch.sh <cell> <tag> <train|validation|all> [KEY=VAL ...]  — detached sweet-arm run from the worktree.
# Extra KEY=VAL pairs become env for the runner (e.g. SS_VARIANT_RANKSHAPE=1).
set -euo pipefail
WT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
CELL="$1"; TAG="$2"; SPLIT="$3"; shift 3
IDS=$(node -e "const s=require('$WT/core/prompt-optimization/data/final-tuning/r282-split.json'); console.log(('$SPLIT'==='all'?[...s.train,...s.validation]:s['$SPLIT']).join(','))")
L="$HOME/.ss-eval/final-tuning-logs"; mkdir -p "$L"
cd "$WT"
env SWEET_SEARCH_MAX_DAEMONS=8 CELL="$CELL" "$@" nohup node scripts/retrieval-bench-282.mjs --conc 3 --arms sweet --ids "$IDS" --tag "$TAG" > "$L/$TAG.log" 2>&1 &
disown
echo "launched $CELL $TAG ($SPLIT) pid $! → $L/$TAG.log"
