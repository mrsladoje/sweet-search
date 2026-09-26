#!/usr/bin/env bash
# Batching-line micro-smoke on the owner's Mac — SWEET ARM ONLY. One run-pilot per variant,
# run one after another (never two pilots at once). Each pilot = 4 distinct tasks x 1 rep at
# CONCURRENCY=4 (reps of one task run serially in run-pilot and share a state dir, so four
# at once must be four tasks). The first variant is the current shipped form (baseline).
#
#   bash batch-smoke.sh codex        # Luna via OpenRouter, CODEX_HARNESS_TRIM=v3 + CODEX_TRIM_BATCH
#   bash batch-smoke.sh opencode     # Luna via OpenRouter, untrimmed + OC_HARNESS_TRIM=batch-*
#   bash batch-smoke.sh claudecode   # Opus 5.5 on the owner's subscription, CC_HARNESS_TRIM=product + CC_TRIM_BATCH
# Optional: VARIANTS="base two" to run a subset.
set -u
H=${1:?usage: batch-smoke.sh codex|opencode|claudecode}
REPO=/Users/admin/Projects/sweet-search-private
BENCH=$REPO/eval/task-completion-bench
cd "$BENCH" || exit 2

export DOCKER_HOST=unix:///Users/admin/.colima/default/docker.sock
export TMPDIR=$HOME/.ss-eval/tmp
export SR_EVAL_DIR=$HOME/swe-rebench-tools/SWE-rebench-V2
export SS_ISOLATION=0
export SWEET_SEARCH_NATIVE_INFERENCE=0 SWEET_SEARCH_COREML_CASCADE=0
export NO_IMAGE_GC=1
mkdir -p "$TMPDIR"

case $H in
  codex)
    [ -n "${OPENROUTER_API_KEY:-}" ] || { echo "no OPENROUTER_API_KEY"; exit 2; }
    export PATH=$HOME/.ss-eval/bin-codex-0.146.1:$PATH
    [ "$(codex --version | awk '{print $2}')" = "0.146.1" ] || { echo "codex is not 0.146.1"; exit 2; }
    MODEL=openai/gpt-5.6-luna; PROVIDER=openrouter
    ALL="base unchain dep two plan" ;;
  opencode)
    [ -n "${OPENROUTER_API_KEY:-}" ] || { echo "no OPENROUTER_API_KEY"; exit 2; }
    export PATH=$HOME/.ss-eval/bin-opencode-1.18.4:$PATH
    [ "$(opencode --version | tail -1)" = "1.18.4" ] || { echo "opencode is not 1.18.4"; exit 2; }
    MODEL=openai/gpt-5.6-luna; PROVIDER=openrouter
    ALL="base unchain dep two plan" ;;
  claudecode)
    [ -f "$HOME/.ss-eval/claude-sub.env" ] && { set -a; . "$HOME/.ss-eval/claude-sub.env"; set +a; }
    [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { echo "no CLAUDE_CODE_OAUTH_TOKEN"; exit 2; }
    export PATH=$HOME/.ss-eval/bin-claude-2.1.281:$PATH
    [ "$(claude --version | cut -d' ' -f1)" = "2.1.281" ] || { echo "claude is not 2.1.281"; exit 2; }
    MODEL=claude-opus-5-5; PROVIDER=anthropic
    ALL="base two plan amp" ;;
  *) echo "unknown harness $H"; exit 2 ;;
esac
VARIANTS=${VARIANTS:-$ALL}

if pgrep -f "harness/run-pilo[t].mjs" >/dev/null; then echo "another run-pilot is running — one at a time"; exit 2; fi
if pgrep -x sweet-search-daemon >/dev/null || pgrep -x sweet-search-maintainer >/dev/null; then
  echo "ss-* daemons are running; stop them first"; exit 2
fi

TASKS=${SMOKE_TASKS:-zmap__zlint-299,superlistapp__super_editor-2516,ember-cli__eslint-plugin-ember-551,joshuakgoldberg__bingo-271}
LEDGER=$BENCH/results/confirm10/ledger/ledger.jsonl
TASKS_FILE=$BENCH/results/confirm10/specs.json
STAMP=$(date +%Y%m%d-%H%M)
RUNS=()
N=0
for V in $VARIANTS; do
  N=$((N+1))
  case $H in
    codex)      SW=(CODEX_HARNESS_TRIM=v3 "CODEX_TRIM_BATCH=$([ "$V" = base ] || echo "$V")") ;;
    opencode)   SW=("OC_HARNESS_TRIM=$([ "$V" = base ] && echo 0 || echo "batch-$V")") ;;
    claudecode) SW=(CC_HARNESS_TRIM=product "CC_TRIM_BATCH=$([ "$V" = base ] || echo "$V")") ;;
  esac
  # Neutral run ids (the run id reaches paths the agent can see); rows carry harnessTrim.
  RUN=bsmoke-$H-$STAMP-L$N
  echo "$(date +%T) launching $RUN = $V (${SW[*]})"
  env "${SW[@]}" TASKS_FILE=$TASKS_FILE INSTANCES=$TASKS \
    ARMS=sweet REPS=1 CONCURRENCY=4 HARNESS=$H MODEL=$MODEL PROVIDER=$PROVIDER \
    REASONING=medium RUN_ID=$RUN ENV_LEDGER=$LEDGER \
    node harness/run-pilot.mjs > "results/$RUN.log" 2>&1
  echo "$(date +%T) $RUN exited rc=$?"
  RUNS+=("results/$RUN")
  if grep -q "account fatal" "results/$RUN.log"; then echo "stopping: account/usage problem"; break; fi
done
echo "runs: ${RUNS[*]}"
