#!/bin/zsh
# Stage B — Claude Code cells on held-out + OOD (USD-only, free on subscription).
# Sonnet/Opus × {med/low=10000, max/xhigh=31999} × {held-out, OOD} = 8 cells.
# SEQUENTIAL: CC cells share the global ~/.claude/CLAUDE.md (suppress/restore), so running one
# cc-batch at a time is race-free. It's free + overnight, so wall-time cost is irrelevant.
set -u
cd /Users/admin/Projects/sweet-search-private
unset ANTHROPIC_API_KEY   # subscription OAuth, not API key
R=core/prompt-optimization/data/results
HO=core/prompt-optimization/data/frozen/p7-heldout-probes.json
OOD=core/prompt-optimization/data/frozen/p7-langtransfer-probes.json
reap(){ pkill -f 'core/cli\.js' 2>/dev/null; pkill -9 -f 'index-maintainer\.mjs' 2>/dev/null; }
pfx(){ awk -v p="$1" '{print "["p"]",$0; fflush()}'; }
runcell(){ local SETV=$1 P=$2 sfx=$3 mdl=$4 thk=$5
  reap
  echo "=== CC cell: $SETV / $sfx ($mdl think=$thk) $(date) ==="
  SET=$SETV PROBES=$P MODEL=$mdl THINK=$thk SUFFIX=-$sfx BATCH_SIZE=60 node scripts/cc-batch.mjs 2>&1 | pfx "cc-$SETV-$sfx" | tee "$R/cc-$SETV-$sfx.log"
}
for pair in "heldout $HO" "ood $OOD"; do set -- ${=pair}; SETV=$1; P=$2
  runcell $SETV $P sonnet-med  claude-sonnet-4-6 10000
  runcell $SETV $P sonnet-max  claude-sonnet-4-6 31999
  runcell $SETV $P opus-low    claude-opus-4-8   10000
  runcell $SETV $P opus-xhigh  claude-opus-4-8   31999
done
reap
echo "=== STAGE-B CC DONE $(date) ==="
touch "$R/stageB.DONE"