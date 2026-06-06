#!/bin/zsh
# Stage C — codex GPT-5.5 (low+high) on held-out + OOD (USD-only).
# Codex writes AGENTS.md per-repo, so concurrency must be DISJOINT-repo. Strategy:
#   - shard each set by LANGUAGE (whole language → one shard → disjoint repos) → 4 shards parallel
#   - WITHIN a shard, run low/high × mpp/native SEQUENTIALLY (same repos → no AGENTS.md race)
#   - sets run sequentially (held-out then OOD) to bound concurrency at 4 shards.
set -u
cd /Users/admin/Projects/sweet-search-private
export NO_REAP=1
R=core/prompt-optimization/data/results
HO=core/prompt-optimization/data/frozen/p7-heldout-probes.json
OOD=core/prompt-optimization/data/frozen/p7-langtransfer-probes.json
reapall(){ pkill -f 'core/cli\.js' 2>/dev/null; pkill -9 -f 'index-maintainer\.mjs' 2>/dev/null; }
pfx(){ awk -v p="$1" '{print "["p"]",$0; fflush()}'; }
# ids for shard K of N: assign whole languages round-robin → disjoint repos per shard
shardids(){ node -e "const p=require('./'+process.argv[1]);const a=Array.isArray(p)?p:(p.probes||[]);const N=+process.argv[2],K=+process.argv[3];const byL={};for(const x of a)(byL[x.language]=byL[x.language]||[]).push(x.id);const L=Object.keys(byL).sort();const o=[];L.forEach((l,i)=>{if(i%N===K)o.push(...byL[l])});console.log(o.join(','))" "$1" "$2" "$3"; }

run_set(){ local SETV=$1 P=$2
  echo "=== STAGE-C codex $SETV (4 lang-shards ∥; low/high×mpp/native serial within shard) $(date) ==="
  reapall
  for s in 0 1 2 3; do
    local IDV=$(shardids "$P" 4 $s)
    [ -z "$IDV" ] && continue
    ( for RE in low high; do for MO in mpp native; do
        PROBES=$P PROVIDER=openrouter HARNESS=codex MODEL=gpt-5.5 REASON=$RE MODE=$MO REPS=1 IDS="$IDV" RUN=cdx-$SETV-$RE-$MO-s$s node scripts/inharness-sniff.mjs 2>&1 | pfx "cdx-$SETV-$RE-$MO-s$s" | tee "$R/cdx-$SETV-$RE-$MO-s$s.log"
      done; done ) &
  done
  wait
}
run_set heldout $HO
run_set ood $OOD
reapall
echo "=== STAGE-C CODEX DONE $(date) ==="
touch "$R/stageC.DONE"