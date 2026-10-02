#!/usr/bin/env bash
# ab.sh — micro-smoke A/B on r3-hard DEV questions (smoke-ids.txt), run from the obs-loop worktree.
#   ab.sh cx <name> "<armB K=V,..>" <reps> ["<common K=V ...>"]   Codex+Sol, sweet vs sweetB INTERLEAVED per probe, one tag per rep
#   ab.sh cc <name> "<envA K=V ...>" "<envB K=V ...>" <reps>       Claude Code+Opus, A and B sequential, ABBA order across reps
# Detached; logs in ~/.ss-eval/obs-loop-logs/. Waits for any other Claude Code obs run before starting a cc job.
set -uo pipefail
WT="$(cd "$(dirname "$0")/../../../.." && pwd)"
HERE="$WT/core/prompt-optimization/data/obs-loop"
IDS=$(cat "$HERE/${SMOKE_IDS_FILE:-smoke-ids.txt}")
PROBES=core/prompt-optimization/data/final-tuning/r3/r3-hard-probes.json
L="$HOME/.ss-eval/obs-loop-logs"; mkdir -p "$L"
COMMON="SWEET_SEARCH_MAX_DAEMONS=8 SS_BENCH_STABLE_RULES_PATH=1 SS_JUDGE_DEEPSEEK_VIA_OPENROUTER=1 SS_BENCH_NO_USD=1"
MODE=$1; NAME=$2
run() { # <cell> <tag> <envstring> [extra args...]
  local cell=$1 tag=$2 envs=$3; shift 3
  echo "$(date '+%F %T') START $cell $tag $envs $*" >> "$L/queue-$NAME.log"
  ( cd "$WT" && env $COMMON CELL="$cell" $envs node scripts/retrieval-bench-282.mjs --conc 3 --arms sweet --ids "$IDS" --probes "$PROBES" --tag "$tag" "$@" > "$L/$tag.log" 2>&1 )
  echo "$(date '+%F %T') END $cell $tag exit=$?" >> "$L/queue-$NAME.log"
}
if [ "$MODE" = cx ]; then
  ARMB=$3; REPS=$4; EXTRA=${5:-}
  ( for r in $(seq 1 "$REPS"); do run codex-sol61-high "obs-$NAME-r$r" "$EXTRA" --interleave --armB-env "$ARMB"; done
    echo "$(date '+%F %T') QUEUE DONE" >> "$L/queue-$NAME.log" ) >/dev/null 2>&1 &
elif [ "$MODE" = cc ]; then
  ENVA=$3; ENVB=$4; REPS=$5
  ( while pgrep -f "CELL=cc-opus55-medium.*obs-" >/dev/null || pgrep -f "retrieval-bench-282.mjs.*--tag obs-.*-[AB]-r" >/dev/null; do sleep 20; done
    for r in $(seq 1 "$REPS"); do
      if [ $((r % 2)) -eq 1 ]; then run cc-opus55-medium "obs-$NAME-A-r$r" "$ENVA"; run cc-opus55-medium "obs-$NAME-B-r$r" "$ENVB";
      else run cc-opus55-medium "obs-$NAME-B-r$r" "$ENVB"; run cc-opus55-medium "obs-$NAME-A-r$r" "$ENVA"; fi
    done
    echo "$(date '+%F %T') QUEUE DONE" >> "$L/queue-$NAME.log" ) >/dev/null 2>&1 &
else echo "mode cx|cc"; exit 2; fi
disown
echo "queued $MODE $NAME → $L/queue-$NAME.log"
