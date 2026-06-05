#!/bin/zsh
# Parallel, USD-only (no wall-time) harness-controlled runs:
#   Phase A: GLM-5.1 bare-API      (5 shards, disjoint id-subsets — bare-API has no repo file)
#   Phase B: GPT-5.5 bare-API      (5 shards — disambiguates whether codex's thrash was model/harness)
#   Phase C: GLM-5.1 opencode      (4 shards by LANGUAGE — opencode writes AGENTS.md → repo-disjoint)
# NO_REAP=1 so shards never pkill each other's ss-servers mid-call; reap once per phase here.
set -u
cd /Users/admin/Projects/sweet-search-private
V=core/prompt-optimization/data/frozen/p7-vault-probes-v60.json
R=core/prompt-optimization/data/results
export NO_REAP=1
reapall(){ pkill -f 'core/cli\.js' 2>/dev/null; pkill -9 -f 'index-maintainer\.mjs' 2>/dev/null; }
slice(){ node -e "const p=require('./$V');const a=(Array.isArray(p)?p:p.probes).map(x=>x.id);console.log(a.slice($1,$2).join(','))"; }
G1=$(slice 0 12); G2=$(slice 12 24); G3=$(slice 24 36); G4=$(slice 36 48); G5=$(slice 48 60)
# opencode language-disjoint groups (same repo grouping as run-vault-codex.sh → no AGENTS.md race)
L1="go-002,go-010,go-007,go-v60-01,go-v60-02,rust-008,rust-002,rust-006,rust-v60-01,c-v60-01,c-v60-02,c-v60-03,dart-v60-01,dart-v60-02,swift-v60-01,swift-v60-02"
L2="python-004,python-006,python-002,python-v60-01,python-v60-02,ts-010,ts-007,ts-006,typescript-v60-01,lua-v60-01,lua-v60-02,lua-v60-03,elixir-v60-01,elixir-v60-02,zig-v60-01,zig-v60-02"
L3="cpp-006,cpp-001,cpp-v60-01,cpp-v60-02,js-002,js-003,js-001,javascript-v60-01,csharp-002,csharp-009,csharp-v60-01,php-v60-01,php-v60-02,php-v60-03"
L4="java-008,java-007,java-v60-01,java-v60-02,kotlin-001,kotlin-004,kotlin-v60-01,kotlin-v60-02,ruby-003,ruby-006,ruby-v60-01,scala-v60-01,scala-v60-02,scala-v60-03"

echo "=== PHASE A: GLM-5.1 bare-API, reasoning=HIGH (5 shards) $(date) ==="
reapall
for i in 1 2 3 4 5; do g="G$i"; REASONING=high MODEL=z-ai/glm-5.1 TAG=ba-glm-s$i IDS="${(P)g}" BATCH_SIZE=12 node scripts/ba-batch.mjs 2>&1 | awk -v p="glm-s$i" '{print "["p"]",$0; fflush()}' | tee "$R/ba-glm-s$i.log" & done
wait
echo "=== PHASE A done $(date) ==="

echo "=== PHASE B: GPT-5.5 bare-API, reasoning=LOW (5 shards) $(date) ==="
reapall
for i in 1 2 3 4 5; do g="G$i"; REASONING=low MODEL=openai/gpt-5.5 TAG=ba-gpt-s$i IDS="${(P)g}" BATCH_SIZE=12 node scripts/ba-batch.mjs 2>&1 | awk -v p="gpt-s$i" '{print "["p"]",$0; fflush()}' | tee "$R/ba-gpt-s$i.log" & done
wait
echo "=== PHASE B done $(date) ==="

echo "=== PHASE C: GLM-5.1 opencode, variant=HIGH (4 repo-shards) $(date) ==="
reapall
n=1; for L in "$L1" "$L2" "$L3" "$L4"; do VARIANT=high MODEL=openrouter/z-ai/glm-5.1 SUFFIX=-glm-s$n IDS="$L" BATCH_SIZE=16 node scripts/oc-batch.mjs 2>&1 | awk -v p="oc-glm-s$n" '{print "["p"]",$0; fflush()}' | tee "$R/oc-glm-s$n.log" & n=$((n+1)); done
wait
reapall
echo "=== ALL HARNESS-PAIRS DONE $(date) ==="