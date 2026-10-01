#!/usr/bin/env bash
# Task-bench resolution guard for SS_VARIANT_CC_RULES_IN_PROMPT (final-tuning V1), on the owner's Mac.
# Claude Code 2.1.281 + Opus 5.5 medium (subscription token), SWEET ARM ONLY, the DEV tasks of rotation A
# (4) + rotation B (6) from the 2026-09 harness hill-climb, REPS reps per arm.
#   base = shipped 2.8.2 sweet (switch unset)      var = SS_VARIANT_CC_RULES_IN_PROMPT=${GUARD_VAR_VALUE:-1} (2 = V1b)
# Both arms run THIS worktree's code (same runner, same ss-* bin); only the switch differs.
#
#   bash task-guard.sh preflight   # $0: checks + run-pilot PREFLIGHT_ONLY for both arms. No model call.
#   bash task-guard.sh both        # RECOMMENDED: base and var legs interleaved (order flips each rep)
#   bash task-guard.sh base        # baseline legs only
#   bash task-guard.sh var         # variant legs only
# Env: GUARD_DRY=1 (print each leg command, run nothing), GUARD_REPS (default 2), GUARD_STAMP (re-use to resume: finished legs are skipped),
#      GUARD_LEDGER, GUARD_SPECS (defaults below). Status: results/tg-<stamp>.manifest (+ .status).
# Never launch while another run-pilot, the final-tuning retrieval queue or any ss-* daemon is alive.
set -u
MODE=${1:?usage: task-guard.sh preflight|both|base|var}
ROOT=$(cd "$(dirname "$0")/../../../../.." && pwd)
BENCH=$ROOT/eval/task-completion-bench
MAIN_BENCH=/Users/admin/Projects/sweet-search-private/eval/task-completion-bench
cd "$BENCH" || exit 2

REPS=${GUARD_REPS:-2}
LEDGER=${GUARD_LEDGER:-$MAIN_BENCH/results/bsmoke-ledger-fix5/ledger.jsonl}
SPECS=${GUARD_SPECS:-$MAIN_BENCH/results/confirm10/specs.json}
IDS_A=zmap__zlint-299,superlistapp__super_editor-2516,ember-cli__eslint-plugin-ember-551,joshuakgoldberg__bingo-271
IDS_B=smooth-code__svgr-10,maxgraph__maxgraph-365,rokucommunity__brighterscript-1050,dbader__node-datadog-metrics-73,fastify__fastify-cors-285,mwouts__jupytext-360
STAMP=${GUARD_STAMP:-$(date +%Y%m%d-%H%M)}
MANIFEST=results/tg-$STAMP.manifest
STATUS=results/tg-$STAMP.status
mkdir -p results

export DOCKER_HOST=unix:///Users/admin/.colima/default/docker.sock
export TMPDIR=$HOME/.ss-eval/tmp
export SR_EVAL_DIR=$HOME/swe-rebench-tools/SWE-rebench-V2
export SS_ISOLATION=0
export SWEET_SEARCH_NATIVE_INFERENCE=0 SWEET_SEARCH_COREML_CASCADE=0   # ORT INT8 queries, same as the goldens
export NO_IMAGE_GC=1
mkdir -p "$TMPDIR"
[ -f "$HOME/.ss-eval/claude-sub.env" ] && { set -a; . "$HOME/.ss-eval/claude-sub.env"; set +a; }
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { echo "no CLAUDE_CODE_OAUTH_TOKEN (~/.ss-eval/claude-sub.env)"; exit 2; }
export PATH=$HOME/.ss-eval/bin-claude-2.1.281:$PATH
[ "$(claude --version | cut -d' ' -f1)" = "2.1.281" ] || { echo "claude is not 2.1.281"; exit 2; }
MODEL=claude-opus-5-5; PROVIDER=anthropic; REASONING=medium

# ---- guards ----
[ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = final-tuning ] || { echo "not on branch final-tuning ($ROOT)"; exit 2; }
[ -x "$BENCH/.venv-grade/bin/python" ] || { echo "missing $BENCH/.venv-grade (symlink dir to the main checkout's venv)"; exit 2; }
docker info >/dev/null 2>&1 || { echo "docker/colima not reachable at $DOCKER_HOST (start colima yourself; this script does not)"; exit 2; }
if [ "$MODE" != preflight ] && [ "${GUARD_DRY:-0}" != 1 ]; then
  if pgrep -f "harness/run-pilo[t].mjs" >/dev/null; then echo "another run-pilot is running - one at a time"; exit 2; fi
  if pgrep -f "retrieval-bench-28[2]|final-tuning/scripts/queue[.]sh" >/dev/null; then echo "the final-tuning retrieval queue is running (ss-* daemons, Metal/ORT): wait for it"; exit 2; fi
  if pgrep -x sweet-search-daemon >/dev/null || pgrep -x sweet-search-maintainer >/dev/null; then
    echo "ss-* daemons are alive (CPU ORT and the GPU path must not coexist). Blocking process(es):"
    for n in sweet-search-daemon sweet-search-maintainer; do for p in $(pgrep -x $n); do
      echo "  $n pid=$p ppid=$(ps -o ppid= -p "$p" | tr -d ' ') cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"; done; done
    exit 2
  fi
fi
# Reload any task image the last ledger sweep removed, from the kept tars.
[ "${GUARD_DRY:-0}" = 1 ] || for t in "$HOME"/.ss-eval/image-tars/*.tar; do
  img=$(basename "$t" .tar | sed -E 's#^docker.io_swerebenchv2_#swerebenchv2/#; s#_([^_]+)$#:\1#')
  docker image inspect "$img" >/dev/null 2>&1 || docker load -i "$t" | tail -1
done

# Same fix switches as every hill-climb cell since fix5; unset every other Claude Code switch so the
# legs are the shipped product (CC_HARNESS_TRIM=product + read6fs, rules file placement).
COMMON=(BENCH_INCLUDE_UNTRACKED=1 RT_ATTACH_REQUIRE_SAME_DIFF=1 TASKS_FILE=$SPECS ARMS=sweet HARNESS=claudecode
  MODEL=$MODEL PROVIDER=$PROVIDER REASONING=$REASONING ENV_LEDGER=$LEDGER REPS=1)
UNSET=(-u SS_VARIANT_CC_RULES_IN_PROMPT -u CC_HARNESS_TRIM -u CC_TRIM_BATCH -u SWEET_RULES_PLACEMENT -u CC_PRODUCT_STEER
  -u CC_PRODUCT_TOKREM -u CC_PRODUCT_SKILLDESC -u CC_PRODUCT_HOOKPLUG -u MPP -u MAX_TOOL_CALLS -u SS_BENCH_NO_USD)

ids_of() { case $1 in A) echo "$IDS_A" ;; B) echo "$IDS_B" ;; esac; }
conc_of() { ids_of "$1" | tr ',' '\n' | grep -c .; }   # distinct tasks all at once, as every hill-climb cell

if [ "$MODE" = preflight ]; then
  for arm in base var; do
    SW=(); [ $arm = var ] && SW=(SS_VARIANT_CC_RULES_IN_PROMPT=${GUARD_VAR_VALUE:-1})
    for cell in A B; do
      echo "== preflight $arm cell $cell"
      env "${UNSET[@]}" "${COMMON[@]}" ${SW[@]+"${SW[@]}"} INSTANCES=$(ids_of $cell) PREFLIGHT_ONLY=1 node harness/run-pilot.mjs 2>&1 | grep -E "env-ledger|PRE-FLIGHT|stale|missing|golden" | head -8
    done
  done
  exit 0
fi

# leg <arm> <cell> <rep> <index>: one run-pilot, CONCURRENCY = tasks in the cell, REPS=1 (reps of one task
# share a state dir, so rep 2 is a second pilot). The run id is neutral (the agent can see it in paths).
leg() {
  local arm=$1 cell=$2 rep=$3 idx=$4 run="tg-$STAMP-L$4"
  if grep -q "^$run .* done" "$STATUS" 2>/dev/null; then echo "skip $run (done)"; return 0; fi
  SW=(); [ "$arm" = var ] && SW=(SS_VARIANT_CC_RULES_IN_PROMPT=${GUARD_VAR_VALUE:-1})
  if [ "${GUARD_DRY:-0}" = 1 ]; then
    printf 'DRY %s %s cell %s rep %s: env' "$run" "$arm" "$cell" "$rep"
    printf ' %q' "${UNSET[@]}" "${COMMON[@]}" ${SW[@]+"${SW[@]}"} "INSTANCES=$(ids_of "$cell")" "CONCURRENCY=$(conc_of "$cell")" "RUN_ID=$run"
    echo ' node harness/run-pilot.mjs'; return 0
  fi
  echo "$run $arm $cell $rep" >> "$MANIFEST"
  echo "$(date +%T) launching $run = $arm cell $cell rep $rep"
  env "${UNSET[@]}" "${COMMON[@]}" ${SW[@]+"${SW[@]}"} INSTANCES=$(ids_of "$cell") CONCURRENCY=$(conc_of "$cell") RUN_ID=$run \
    node harness/run-pilot.mjs > "results/$run.log" 2>&1
  local rc=$?
  echo "$run $arm $cell $rep done rc=$rc $(date +%T)" >> "$STATUS"
  echo "$(date +%T) $run exited rc=$rc"
  if grep -q "account fatal" "results/$run.log"; then grep -m1 -o "account fatal.*" "results/$run.log"; echo "stopping: account/usage problem"; return 9; fi
  return 0
}

idx=0
for rep in $(seq 1 "$REPS"); do
  # Interleave: odd reps run base first in each cell, even reps run var first (drift falls on both arms).
  if [ $((rep % 2)) = 1 ]; then first=base; second=var; else first=var; second=base; fi
  for cell in A B; do
    for arm in $first $second; do
      idx=$((idx+1))   # position in the FULL schedule, so base-only and var-only runs with one GUARD_STAMP never collide
      case $MODE in both) ;; base|var) [ "$arm" = "$MODE" ] || continue ;; *) echo "unknown mode $MODE"; exit 2 ;; esac
      leg "$arm" "$cell" "$rep" "$idx" || exit $?
    done
  done
done
[ "${GUARD_DRY:-0}" = 1 ] && exit 0
echo "manifest: $BENCH/$MANIFEST"
python3 "$ROOT/core/prompt-optimization/data/final-tuning/scripts/task-guard-compare.py" "$MANIFEST"
