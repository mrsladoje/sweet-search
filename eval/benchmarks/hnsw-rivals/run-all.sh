#!/bin/zsh
# Sequential: production cascade, then every native rival config, per set. One job at a time.
cd "$(dirname $0)"
R=/Users/admin/Projects/sweet-search-private
for s in gcsn-ho d20k-ho dall-ho advtest; do
  echo "== $s $(date +%H:%M) load $(sysctl -n vm.loadavg)"
  node $R/eval/benchmarks/hnsw-rivals/ours2.mjs $s 2>&1 | grep -v '^\[' | tail -2
  for c in "faiss_flat 16 40" "faiss_flat 32 200" "faiss_flat 64 800" "faiss_sq8_refine 64 800" "faiss_bin_cascade 64 800" \
           "usearch_f16 16 128" "usearch_f16 64 800" "usearch_i8 64 800" "usearch_i8_rescore 64 800" "usearch_b1_cascade 64 800"; do
    set -- ${=c}; ./rivals $s $s $1 $2 $3 > $s/runs/$1_M$2_efC$3.jsonl 2> $s/runs/$1_M$2_efC$3.err; echo "  $c done $(date +%H:%M)"
  done
  for c in "hnswlib 16 200" "hnswlib 64 800"; do
    set -- ${=c}; ./rivals-hnswlib $s $s $1 $2 $3 > $s/runs/$1_M$2_efC$3.jsonl 2> $s/runs/$1_M$2_efC$3.err; echo "  $c done $(date +%H:%M)"
  done
done
echo ALL DONE $(date +%H:%M)
