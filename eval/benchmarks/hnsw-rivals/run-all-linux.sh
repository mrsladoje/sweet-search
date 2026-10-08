#!/bin/bash
# Linux port of run-all.sh. Sequential: every native rival config per set, one job at a time (rival searches are single-threaded;
# only the index build uses nproc threads). Same configs and order as run-all.sh.
# Our production cascade (ours2.mjs) is NOT run unless OURS=1 (it needs the Mac-layout repo paths + node on PATH).
# Usage: ./run-all-linux.sh [set ...]   (default: gcsn-ho d20k-ho dall-ho advtest). Run from /root/hnsw-x86/rivals; sets live in $SETS.
cd "$(dirname "$0")"
SETS=${SETS:-/root/hnsw-x86/sets}
RIV=$(pwd)
sets=("$@"); [ ${#sets[@]} -eq 0 ] && sets=(gcsn-ho d20k-ho dall-ho advtest)
cd $SETS
for s in "${sets[@]}"; do
  mkdir -p $s/runs
  echo "== $s $(date +%H:%M) load $(cut -d' ' -f1-3 /proc/loadavg)"
  if [ "$OURS" = 1 ]; then R=${R:-/root/hnsw-x86/repo}; node $R/eval/benchmarks/hnsw-rivals/ours2.mjs $s 2>&1 | grep -v '^\[' | tail -2; fi
  for c in "faiss_flat 16 40" "faiss_flat 32 200" "faiss_flat 64 800" "faiss_sq8_refine 64 800" "faiss_bin_cascade 64 800" \
           "usearch_f16 16 128" "usearch_f16 64 800" "usearch_i8 64 800" "usearch_i8_rescore 64 800" "usearch_b1_cascade 64 800"; do
    set -- $c; $RIV/rivals $s $s $1 $2 $3 > $s/runs/$1_M$2_efC$3.jsonl 2> $s/runs/$1_M$2_efC$3.err; echo "  $c done $(date +%H:%M)"
  done
  for c in "hnswlib 16 200" "hnswlib 64 800"; do
    set -- $c; $RIV/rivals-hnswlib $s $s $1 $2 $3 > $s/runs/$1_M$2_efC$3.jsonl 2> $s/runs/$1_M$2_efC$3.err; echo "  $c done $(date +%H:%M)"
  done
done
echo ALL DONE $(date +%H:%M)
