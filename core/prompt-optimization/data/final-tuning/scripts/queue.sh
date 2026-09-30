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
    IDS=$(node -e "const s=require('$WT/core/prompt-optimization/data/final-tuning/r282-split.json'); console.log(('$SPLIT'==='all'?[...s.train,...s.validation]:s['$SPLIT']).join(','))")
    echo "$(date '+%F %T') START $CELL $TAG $SPLIT $REST" >> "$L/queue-$Q.log"
    ( cd "$WT" && env SWEET_SEARCH_MAX_DAEMONS=8 SS_BENCH_STABLE_RULES_PATH=1 SS_JUDGE_DEEPSEEK_VIA_OPENROUTER=1 CELL="$CELL" $REST node scripts/retrieval-bench-282.mjs --conc 3 --arms sweet --ids "$IDS" --tag "$TAG" > "$L/$TAG.log" 2>&1 )
    echo "$(date '+%F %T') END $CELL $TAG exit=$?" >> "$L/queue-$Q.log"
  done
  echo "$(date '+%F %T') QUEUE DONE" >> "$L/queue-$Q.log"
) > /dev/null 2>&1 &
disown
echo "queue $Q started ($# jobs) → $L/queue-$Q.log"
