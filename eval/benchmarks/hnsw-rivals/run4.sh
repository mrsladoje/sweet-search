#!/bin/bash
# v4 benchmark driver: every system on one set, one job at a time, ROUNDS timing rounds.
#   round r: our production cascade, then every rival config (order rotated each round), then our cascade
#   again; round 1 also sweeps our knobs (S1 / POOL / pure rescore / walk) for the speed-quality curve.
#   Indexes are built once (IDX_CACHE) and reloaded, so every round times the same index.
#   Writes <set>/runs/r<r>/*.jsonl, <set>/res-r<r>/, <set>/ours-*.json, <set>/env-r<r>.txt, <set>/load.log.
# usage: run4.sh <setDir> [rounds]
# env: RIV (dir with rivals, rivals-hnswlib), R (repo root), NODE, PY, OURS (ours.mjs), THREADS,
#      CACHE_ROOT (index cache root), STOP_US, SKIP_OURS_SWEEP=1, ONLY (regex over config names),
#      INNER=1: low-disk mode (x86 box at 1M): each config runs all its rounds back to back, then its cached
#      index is deleted; our cascade is re-timed before the first config, every 5 configs and at the end.
set -u
S=$1; ROUNDS=${2:-3}
RIV=${RIV:?}; R=${R:?}; NODE=${NODE:-node}; PY=${PY:-python3}; OURS=${OURS:-$R/eval/benchmarks/hnsw-rivals/ours.mjs}
export THREADS=${THREADS:-$(getconf _NPROCESSORS_ONLN)} STOP_US=${STOP_US:-15000}
export IDX_CACHE=${CACHE_ROOT:-$HOME/.ss-eval/hnsw-idxcache}/$(basename $S); mkdir -p $IDX_CACHE
N=$($PY -c "import json;print(len(json.load(open('$S/meta.json'))['ids']))")
NL=$($PY -c "import math;n=$N;print(2**round(math.log2(4*math.sqrt(n))))")
load() { if [ -r /proc/loadavg ]; then cut -d' ' -f1-3 /proc/loadavg; else sysctl -n vm.loadavg | tr -d '{}'; fi; }
log() { echo "$(date +%FT%T) load $(load) | $*" | tee -a $S/load.log; }
[ -f $S/gt.bin ] || $PY $(dirname $OURS)/prep.py $S

NPROBES=$($PY -c "print(';'.join(str(2**i) for i in range(0, 20) if 2**i <= $NL // 2))")
cross() { $PY -c "import sys;a=sys.argv[1].split(';');b=sys.argv[2].split(';');print(';'.join(x+','+y for x in a for y in b))" "$1" "$2"; }
EFS="efSearch=16;efSearch=32;efSearch=64;efSearch=128;efSearch=256;efSearch=512;efSearch=1024;efSearch=2048"
KF="k_factor_rf=2;k_factor_rf=5;k_factor_rf=10;k_factor_rf=20;k_factor_rf=50"
NP=$(echo $NPROBES | sed 's/\([0-9][0-9]*\)/nprobe=\1/g')
# name | binary | args...
CONFIGS=(
  "exact|rivals|faiss_exact 0 0"
  "faiss_flat_16|rivals|faiss_flat 16 40"
  "faiss_flat_32|rivals|faiss_flat 32 200"
  "faiss_flat_64|rivals|faiss_flat 64 800"
  "faiss_sq8|rivals|faiss_sq8_refine 64 800"
  "faiss_bin|rivals|faiss_bin_cascade 64 800"
  "faiss_binflat|rivals|faiss_binflat_cascade 0 0"
  "rabitq_flat|rivals|faiss:RaBitQ,RFlat|$KF"
  "rabitq_ivf|rivals|faiss:IVF${NL},RaBitQ,RFlat|$(cross "$NP" "k_factor_rf=10;k_factor_rf=20")"
  "rabitq_hnsw|rivals|faissl2:HNSW32_RaBitQ,RFlat|$(cross "$EFS" "k_factor_rf=10")"
  "ivf_flat|rivals|faiss:IVF${NL},Flat|$NP"
  "ivfpq_fs|rivals|faiss:IVF${NL},PQ192x4fs,RFlat|$(cross "$NP" "k_factor_rf=10;k_factor_rf=50")"
  "usearch_f16_16|rivals|usearch_f16 16 128"
  "usearch_f16_64|rivals|usearch_f16 64 800"
  "usearch_i8|rivals|usearch_i8 64 800"
  "usearch_i8_rescore|rivals|usearch_i8_rescore 64 800"
  "usearch_b1|rivals|usearch_b1_cascade 64 800"
  "hnswlib_16|rivals-hnswlib|hnswlib 16 200"
  "hnswlib_64|rivals-hnswlib|hnswlib 64 800"
)
ours() { log "ours $1 $2"; env $2 R=$R OUT=$1 $NODE $OURS $S 2>&1 | grep -v '^\[' | tail -1; }
runcfg() {  # runcfg <round> <config line>
  local r=$1 name bin args params; IFS='|' read -r name bin args params <<< "$2"
  [ -n "${ONLY:-}" ] && ! [[ $name =~ $ONLY ]] && return
  mkdir -p $S/runs/r$r; export RES=res-r$r; log "r$r $name"
  if [ -n "${params:-}" ]; then $RIV/$bin $S $S $args "$params" 0 > $S/runs/r$r/$name.jsonl 2> $S/runs/r$r/$name.err
  else $RIV/$bin $S $S $args > $S/runs/r$r/$name.jsonl 2> $S/runs/r$r/$name.err; fi
  local rc=$?; [ $rc = 0 ] || log "FAILED r$r $name exit $rc: $(tail -2 $S/runs/r$r/$name.err | tr '\n' ' ')"
  tail -1 $S/runs/r$r/$name.jsonl | cut -c1-160
}
envfile() { { uname -a; date; load; [ -r /proc/cpuinfo ] && grep -m1 "model name" /proc/cpuinfo || sysctl -n machdep.cpu.brand_string; git -C $R rev-parse HEAD 2>/dev/null || cat $R/.bench-sha 2>/dev/null; $NODE -v; echo "THREADS=$THREADS STOP_US=$STOP_US NL=$NL INNER=${INNER:-0}"; } > $S/env-r$1.txt; }
oursweep() {
  [ -n "${SKIP_OURS_SWEEP:-}" ] && return
  for s1 in 100 250 500 2000; do ours ours-s1-$s1.json "S1=$s1"; done
  for pool in 0.5 2; do ours ours-pool-$pool.json "POOL=$pool"; done
  ours ours-pure.json "SWEET_SEARCH_FULL_VECTOR_STAGE_WEIGHT=1"
  ours ours-pure-pool2.json "SWEET_SEARCH_FULL_VECTOR_STAGE_WEIGHT=1 POOL=2"
  [ $N -le 150000 ] && ours ours-walk.json "SS_FIX_HNSW_SCAN=0"
}
if [ -n "${INNER:-}" ]; then
  for r in $(seq 1 $ROUNDS); do envfile $r; done
  k=0; t=1; ours ours-prod-t1.json ""
  for c in "${CONFIGS[@]}"; do
    for r in $(seq 1 $ROUNDS); do runcfg $r "$c"; done
    rm -f $IDX_CACHE/*; k=$((k + 1))
    if [ $((k % 5)) = 0 ]; then t=$((t + 1)); ours ours-prod-t$t.json ""; fi
  done
  ours ours-prod-t$((t + 1)).json ""; oursweep; log "done $S"; exit 0
fi
for r in $(seq 1 $ROUNDS); do
  envfile $r
  ours ours-prod-r${r}a.json ""
  n=${#CONFIGS[@]}; off=$(( (r - 1) * 7 % n ))
  for i in $(seq 0 $((n - 1))); do runcfg $r "${CONFIGS[$(( (i + off) % n ))]}"; done
  ours ours-prod-r${r}b.json ""
  [ $r = 1 ] && oursweep
done
log "done $S"
