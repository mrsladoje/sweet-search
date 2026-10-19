#!/bin/bash
# Laptop example: gcsn (6,918 vectors, 3,600 dev queries) with CodeRankEmbed; builds our index and FAISS binary flat,
# then times on DEV queries, 3 rounds: our cascade at its frozen point (S1 = 50) and at the shipped default
# (S1 = 400), FAISS binary flat with float refine (its frozen point) and exact float32 search; prints latency and
# retained share of exact MRR@10. Held-out queries are not touched.
#   bash laptop_example.sh DATA ROOT [WORK]
# DATA  the release data (needs sets/gcsn and emb/CodeRankEmbed/gcsn); ROOT  where build-paper.sh and
# build-rivals5.sh put the rival binaries (ROOT/build/rivals5); the addon must be built (npx napi build --release).
set -euo pipefail
DATA=$1; ROOT=$2; W=${3:-$(mktemp -d)}; PY=${PY:-python3}
H=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$H/../../../.." && pwd)
t0=$(date +%s)
mkdir -p "$W/data/sets" "$W/data/emb/CodeRankEmbed/gcsn"
cp -R "$DATA/sets/gcsn" "$W/data/sets/"
for f in corpus.f32 queries.f32 model.json gt; do cp -R "$DATA/emb/CodeRankEmbed/gcsn/$f" "$W/data/emb/CodeRankEmbed/gcsn/"; done
cd "$H"
SS_LOCAL=1 MACHINE=laptop DATA="$W/data" ROOT="$ROOT" RESULTS="$W/results" REPO="$REPO" PY="$PY" PLAN_ROOT=plans/laptop bash aws/run.sh build,dev
$PY -I laptop_summary.py "$W/data" "$W/results/laptop"
echo "laptop example: $(( $(date +%s) - t0 )) s wall time (work dir $W)"
