#!/usr/bin/env bash
# HINT LADDER driver. Runs the four conditions strictly one after another — two run-pilot
# processes at once trip the git dubious-ownership bug, which is a separate rule from
# concurrency INSIDE a pilot (3 here, proven by a clean preflight at that setting).
#
# L0 carries the controls; the hint levels do not, because a control receives no hint and
# re-running it three more times only buys noise.
set -u
set -a; . /root/.openrouter.env; set +a
cd /root/sweet-search-private

LEDGER=/root/env-ledger/luna-rotate20-v3/ledger.jsonl
TARGETS=apple__swift-nio-http2-145,codeception__codeceptjs-367,dashbitco__nimble_options-43,joshuakgoldberg__bingo-274,dart-lang__http-1114
CONTROLS=oceanparcels__parcels-617,ontodev__robot-710,epiforecasts__scoringutils-229
STAMP=${STAMP:-20260818}

run () {                                  # run <level> <instances> <reps>
  local lvl=$1 inst=$2 reps=$3
  local id=hl-${lvl}-${STAMP}
  echo "=== $(date -u +%H:%M:%SZ)  launching $id  reps=$reps"
  ENV_LEDGER=$LEDGER \
  TASKS_FILE=/root/hint-ladder/tasks-${lvl}.json \
  INSTANCES=$inst ARMS=sweet REPS=$reps CONCURRENCY=3 \
  HARNESS=opencode MODEL=openai/gpt-5.6-luna PROVIDER=openrouter \
  RUN_ID=$id \
  node eval/task-completion-bench/harness/run-pilot.mjs \
    > /root/hint-ladder/${id}.log 2>&1
  echo "=== $(date -u +%H:%M:%SZ)  $id exit=$?"
}

run L0 "$TARGETS,$CONTROLS" 2
run L1 "$TARGETS"           3
run L3 "$TARGETS"           2
run L2 "$TARGETS"           2
echo "=== $(date -u +%H:%M:%SZ)  ladder complete"
