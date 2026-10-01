#!/usr/bin/env bash
# queue.sh <queue-name> "<cell> <tag> <split> [KEY=VAL…]" …  — runs the jobs ONE AFTER ANOTHER (same harness),
# detached. Each job = the runner in the foreground of this queue; log per tag + a queue log.
set -uo pipefail
WT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
Q="$1"; shift
L="$HOME/.ss-eval/final-tuning-logs"; mkdir -p "$L"
(
  # WAIT_FOR=<pgrep -f pattern>: start only after that process is gone (one Claude Code cell at a time).
  if [ -n "${WAIT_FOR:-}" ]; then while pgrep -f "$WAIT_FOR" >/dev/null; do sleep 10; done; fi
  for job in "$@"; do
    read -r CELL TAG SPLIT REST <<<"$job"
    # tokens ARMB=K=V[,K2=V2] → interleaved run (arm sweet vs sweetB with that env overlay)
    ENVS=""; EXTRA=()
    ARMSV=sweet; PROBEFILE=""
    for tok in $REST; do
      if [[ "$tok" == ARMB=* ]]; then EXTRA=(--interleave --armB-env "${tok#ARMB=}");
      elif [[ "$tok" == ARMS=* ]]; then ARMSV="${tok#ARMS=}";
      elif [[ "$tok" == IL=1 ]]; then EXTRA=(--interleave);
      elif [[ "$tok" == PROBES=* ]]; then PROBEFILE="${tok#PROBES=}";
      else ENVS="$ENVS $tok"; fi
    done
    IDS=$(node -e "
      const sp='$SPLIT', W='$WT/core/prompt-optimization/data/final-tuning';
      if (sp.startsWith('r3')) { const m=require(W+'/r3/MANIFEST.json').ids; const map={r3dev:[...m.devTrain,...m.devValidation], r3devtrain:m.devTrain, r3devval:m.devValidation, r3heldout:m.heldout, r3all:[...m.heldout,...m.devTrain,...m.devValidation]}; console.log(map[sp].join(',')); }
      else { const s=require(W+'/r282-split.json'); console.log((sp==='all'?[...s.train,...s.validation]:s[sp]).join(',')); }")
    echo "$(date '+%F %T') START $CELL $TAG $SPLIT $REST" >> "$L/queue-$Q.log"
    ( cd "$WT" && env SWEET_SEARCH_MAX_DAEMONS=8 SS_BENCH_STABLE_RULES_PATH=1 SS_JUDGE_DEEPSEEK_VIA_OPENROUTER=1 SS_BENCH_NO_USD=1 CELL="$CELL" $ENVS node scripts/retrieval-bench-282.mjs --conc 3 --arms "$ARMSV" --ids "$IDS" ${PROBEFILE:+--probes "$PROBEFILE"} --tag "$TAG" ${EXTRA[@]+"${EXTRA[@]}"} > "$L/$TAG.log" 2>&1 )
    echo "$(date '+%F %T') END $CELL $TAG exit=$?" >> "$L/queue-$Q.log"
  done
  echo "$(date '+%F %T') QUEUE DONE" >> "$L/queue-$Q.log"
) > /dev/null 2>&1 &
disown
echo "queue $Q started ($# jobs) → $L/queue-$Q.log"
