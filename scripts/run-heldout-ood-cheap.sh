#!/bin/zsh
# Stage A — cheap/parallel cells on held-out + OOD (USD-only, no wall-time):
#   bare-API GLM-5.1(high) + GPT-5.5(low)  — no per-repo file → fully parallel
#   opencode GLM-5.1(high)                 — writes AGENTS.md, but held-out vs OOD repos are
#                                            disjoint (core vs transfer langs) → 2 procs parallel
# Captures the FULL metric set per cell (USD suite + accuracy + calls + naive & realized cost).
set -u
cd /Users/admin/Projects/sweet-search-private
export NO_REAP=1
R=core/prompt-optimization/data/results
HO=core/prompt-optimization/data/frozen/p7-heldout-probes.json
OOD=core/prompt-optimization/data/frozen/p7-langtransfer-probes.json
reapall(){ pkill -f 'core/cli\.js' 2>/dev/null; pkill -9 -f 'index-maintainer\.mjs' 2>/dev/null; }
pfx(){ awk -v p="$1" '{print "["p"]",$0; fflush()}'; }

echo "=== STAGE-A.1 bare-API GLM(high)+GPT(low) — held-out + OOD $(date) ==="
reapall
for pair in "heldout $HO" "ood $OOD"; do set -- ${=pair}; SETV=$1; P=$2
  SET=$SETV PROBES=$P REASONING=high MODEL=z-ai/glm-5.1 TAG=ba-glm BATCH_SIZE=60 node scripts/ba-batch.mjs 2>&1 | pfx "glm-ba-$SETV" | tee "$R/ba-glm-$SETV.log" &
  SET=$SETV PROBES=$P REASONING=low MODEL=openai/gpt-5.5 TAG=ba-gpt BATCH_SIZE=60 node scripts/ba-batch.mjs 2>&1 | pfx "gpt-ba-$SETV" | tee "$R/ba-gpt-$SETV.log" &
done
wait
echo "=== STAGE-A.1 done $(date) ==="

echo "=== STAGE-A.2 opencode GLM(high) — held-out + OOD $(date) ==="
reapall
for pair in "heldout $HO" "ood $OOD"; do set -- ${=pair}; SETV=$1; P=$2
  SET=$SETV PROBES=$P VARIANT=high MODEL=openrouter/z-ai/glm-5.1 SUFFIX=-glm BATCH_SIZE=60 node scripts/oc-batch.mjs 2>&1 | pfx "glm-oc-$SETV" | tee "$R/oc-glm-$SETV.log" &
done
wait
reapall
echo "=== STAGE-A DONE $(date) ==="
touch "$R/stageA.DONE"