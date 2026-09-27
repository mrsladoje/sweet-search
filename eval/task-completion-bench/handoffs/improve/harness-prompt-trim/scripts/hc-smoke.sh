#!/usr/bin/env bash
# Hill-climb copy of batch-smoke.sh (concurrency = number of tasks). Batching-line micro-smoke on the owner's Mac — SWEET ARM ONLY. One run-pilot per variant,
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

# The ledger sweep deletes task images; reload any that are missing from the kept tars.
for t in "$HOME"/.ss-eval/image-tars/*.tar; do
  img=$(basename "$t" .tar | sed -E 's#^docker.io_swerebenchv2_#swerebenchv2/#; s#_([^_]+)$#:\1#')
  docker image inspect "$img" >/dev/null 2>&1 || docker load -i "$t" | tail -1
done
# Round 2+ runs with the both-arm validity fixes on (BENCH_INCLUDE_UNTRACKED,
# RT_ATTACH_REQUIRE_SAME_DIFF); they pass through from the caller's env. Never pool across them.
echo "fix switches: BENCH_INCLUDE_UNTRACKED=${BENCH_INCLUDE_UNTRACKED:-0} RT_ATTACH_REQUIRE_SAME_DIFF=${RT_ATTACH_REQUIRE_SAME_DIFF:-0} ledger=${SMOKE_LEDGER:-confirm10}"

TASKS=${SMOKE_TASKS:-zmap__zlint-299,superlistapp__super_editor-2516,ember-cli__eslint-plugin-ember-551,joshuakgoldberg__bingo-271}
LEDGER=${SMOKE_LEDGER:-$BENCH/results/confirm10/ledger/ledger.jsonl}
TASKS_FILE=$BENCH/results/confirm10/specs.json
# One rollout per task, all tasks at once (distinct tasks only — reps of one task share state).
CONC=${SMOKE_CONC:-$(echo "$TASKS" | tr ',' '\n' | grep -c .)}
STAMP=$(date +%Y%m%d-%H%M)
RUNS=()
N=0
for V in $VARIANTS; do
  N=$((N+1))
  case $H in
    # Codex: base = v3 (phase 1); untrimmed = trim off; <trim>/<batch> = trim + batch variant
    # (e.g. conflict/yt2); conflict or v3 alone = that trim; any other name = v3 + that batch variant.
    codex)
      case $V in
        base)          SW=(CODEX_HARNESS_TRIM=v3 CODEX_TRIM_BATCH=) ;;
        untrimmed)     SW=(CODEX_HARNESS_TRIM=0 CODEX_TRIM_BATCH=) ;;
        */*)           SW=("CODEX_HARNESS_TRIM=${V%%/*}" "CODEX_TRIM_BATCH=${V#*/}") ;;
        conflict|v3)   SW=("CODEX_HARNESS_TRIM=$V" CODEX_TRIM_BATCH=) ;;
        *)             SW=(CODEX_HARNESS_TRIM=v3 "CODEX_TRIM_BATCH=$V") ;;
      esac ;;
    # opencode: base/untrimmed = trim off; names with 'conflict' or '+' pass through
    # (conflict, conflict-noglob, conflict+todo2, untrimmed+todo2); others = batch-<name>.
    opencode)
      case $V in
        base|untrimmed) SW=(OC_HARNESS_TRIM=0) ;;
        *conflict*|*+*) SW=("OC_HARNESS_TRIM=$V") ;;
        *)              SW=("OC_HARNESS_TRIM=batch-$V") ;;
      esac ;;
    # Claude Code: base = product (what init installs); untrimmed = stock harness; other names =
    # product + that CC_TRIM_BATCH variant.
    claudecode)
      case $V in
        base)      SW=(CC_HARNESS_TRIM=product CC_TRIM_BATCH=) ;;
        untrimmed) SW=(CC_HARNESS_TRIM=0 CC_TRIM_BATCH=) ;;
        *)         SW=(CC_HARNESS_TRIM=product "CC_TRIM_BATCH=$V") ;;
      esac ;;
  esac
  # Neutral run ids (the run id reaches paths the agent can see); rows carry harnessTrim.
  RUN=hc-$H-$STAMP-L$N
  echo "$(date +%T) launching $RUN = $V (${SW[*]})"
  env "${SW[@]}" TASKS_FILE=$TASKS_FILE INSTANCES=$TASKS \
    ARMS=sweet REPS=1 CONCURRENCY=$CONC HARNESS=$H MODEL=$MODEL PROVIDER=$PROVIDER \
    REASONING=medium RUN_ID=$RUN ENV_LEDGER=$LEDGER \
    node harness/run-pilot.mjs > "results/$RUN.log" 2>&1
  echo "$(date +%T) $RUN exited rc=$?"
  RUNS+=("results/$RUN")
  if grep -q "account fatal" "results/$RUN.log"; then echo "stopping: account/usage problem"; break; fi
done
echo "runs: ${RUNS[*]}"
