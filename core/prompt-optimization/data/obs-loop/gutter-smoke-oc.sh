#!/usr/bin/env bash
# gutter-smoke-oc.sh — PLAN.md item 3.2: task-bench micro-smoke on the owner's Mac: ss-read gutter COLON `N: ` (A, shipped opencode form)
# vs NONE (B), opencode 1.18.4 + openai/gpt-6.1-sol via OpenRouter (METERED; the task-bench opencode runner has no subscription route),
# SWEET ARM ONLY, product harness (OC_HARNESS_TRIM unset = conflict3+todo3eff3k). Copy of obs-loop/gutter-smoke.sh (Claude Code + Opus).
# NOTE: run-pilot's opencode runner passes no --variant, so reasoning is opencode's default for the model, not `high`; REASONING=medium is
# only the row stamp (same as the hill-climb rows). Run from the plan-diet worktree, so both arms use this worktree's code.
#
#   bash gutter-smoke-oc.sh preflight     # $0: run-pilot PREFLIGHT_ONLY=1 for both arms' env (ledger + golden + model cache + admission)
#   bash gutter-smoke-oc.sh sweep         # $0: gold-only env-ledger sweep of the 3 tasks under the CURRENT worktree code (quiet machine)
#   bash gutter-smoke-oc.sh launch        # OpenRouter (metered): 4 pilots (ABBA), 3 tasks x 1 rollout each = 12 rollouts. Detached.
#   bash gutter-smoke-oc.sh analyze       # per-rollout metrics for both arms (analyze-gutter-oc.mjs)
# Env: GS_DRY=1 (print the pilot commands, run nothing), GS_STAMP (re-use to resume; finished legs are skipped), GS_REPS=2,
#      GS_LEDGER (default: this smoke's own sweep if present, else the 2026-09-29 fix5 ledger in the main checkout),
#      GS_WAIT_DAEMONS=1 (also wait until NO sweet-search-daemon/maintainer is alive; default only warns).
# Order: rep 1 = A,B; rep 2 = B,A (ABBA), so drift falls on both arms. One run-pilot at a time, CONCURRENCY=1, REPS=1 per pilot.
# Before each pilot it waits while: another run-pilot or env-ledger sweep runs; any process matches run-pilot's machine-wide end-of-pool reap pattern
# (search-server.js | cli.js --serve | index-maintainer.mjs), because that reap would kill it.
# Logs: ~/.ss-eval/obs-loop-logs/gutter-oc-<stamp>.log (+ one log per pilot). Run ids are neutral (gso-<stamp>-L<n>); arm map in the manifest.
set -u
MODE=${1:?usage: gutter-smoke-oc.sh preflight|sweep|launch|analyze}
WT="$(cd "$(dirname "$0")/../../../.." && pwd)"
HERE="$WT/core/prompt-optimization/data/obs-loop"
BENCH=$WT/eval/task-completion-bench
MAIN_BENCH=/Users/admin/Projects/sweet-search-private/eval/task-completion-bench
cd "$BENCH" || exit 2
DRY=${GS_DRY:-0}; REPS=${GS_REPS:-2}
STAMP=${GS_STAMP:-$(date +%Y%m%d-%H%M)}
L="$HOME/.ss-eval/obs-loop-logs"; mkdir -p "$L" results
LOG=$L/gutter-oc-$STAMP.log
MANIFEST=$BENCH/results/gso-$STAMP.manifest; STATUS=$BENCH/results/gso-$STAMP.status
SPECS=$BENCH/results/gso-specs.json
SWEEP_DIR=$BENCH/results/gso-ledger
LEDGER=${GS_LEDGER:-}
if [ -z "$LEDGER" ]; then
  if [ -s "$SWEEP_DIR/ledger.jsonl" ]; then LEDGER=$SWEEP_DIR/ledger.jsonl; else LEDGER=$MAIN_BENCH/results/bsmoke-ledger-fix5/ledger.jsonl; fi
fi

# Tasks (DEV-RET, all in CONFIRM10; none in HO2). Chosen 2026-10-02 from the Opus 5.5 sweet hill-climb history (71-83 rollouts each):
#   mwouts__jupytext-360               python, 4 gold files; most ss-read (4.8/rollout) and Edit (1.4/rollout) of all candidates; 0% solved
#   rokucommunity__brighterscript-1050 ts, 4 gold files; ss-read 4.5/rollout, Edit 0.6/rollout; 0% solved
#   joshuakgoldberg__bingo-271         ts, 10 gold files, ALL TAB-indented (the 2026-08-28 TAB-gutter Edit failure shape); ss-read 1.3/rollout; 0% solved
# No candidate is both mid-solve and ss-read heavy (svgr-10 solves 46% but averages 0.1 ss-read), so this smoke reads behaviour, not solves.
TASKS=(mwouts__jupytext-360 rokucommunity__brighterscript-1050 joshuakgoldberg__bingo-271)
CSV=$(IFS=,; echo "${TASKS[*]}")

export DOCKER_HOST=unix:///Users/admin/.colima/default/docker.sock
export TMPDIR=$HOME/.ss-eval/tmp
export SR_EVAL_DIR=$HOME/swe-rebench-tools/SWE-rebench-V2
export SS_ISOLATION=0
export SWEET_SEARCH_NATIVE_INFERENCE=0 SWEET_SEARCH_COREML_CASCADE=0   # ORT INT8 queries, same as the goldens
export NO_IMAGE_GC=1
export PATH=$HOME/.ss-eval/bin-opencode-1.18.4:$PATH   # pinned CLI (PINNED_OPENCODE_VERSION; the runner preflight checks it)
mkdir -p "$TMPDIR"

say() { printf '%s\n' "$*" | tee -a "$LOG"; }
die() { say "$*"; exit 2; }

base_guards() {
  [ "$(git -C "$WT" rev-parse --abbrev-ref HEAD)" = plan-diet ] || die "not on branch plan-diet ($WT)"
  [ -x "$BENCH/.venv-grade/bin/python" ] || die "missing $BENCH/.venv-grade (symlink dir to the main checkout's venv)"
  docker info >/dev/null 2>&1 || die "docker/colima not reachable at $DOCKER_HOST (start colima yourself)"
}

build_specs() {   # the 3 task records from the two DEV caches only (never any heldout2 file)
  GS_IDS=$CSV GS_OUT=$SPECS GS_MAIN=$MAIN_BENCH python3 - <<'EOF' || die "cannot build specs"
import json, os
m = os.environ['GS_MAIN']; want = os.environ['GS_IDS'].split(','); specs = {}
for f in ('select/.cache/tasks_full_multilingual.json', 'select/.cache/tasks_full_heldout.json'):  # dev-200 and DEV-RET
    for s in json.load(open(os.path.join(m, f))): specs[s['instance_id']] = s
miss = [i for i in want if i not in specs]
if miss: raise SystemExit('ids not in the dev pools: %s' % miss)
json.dump([specs[i] for i in want], open(os.environ['GS_OUT'], 'w'))
EOF
}

# The images must be in the VM (Colima cannot reach the Docker CDN): load from the kept tar if one is missing.
ensure_images() {
  local img t
  for img in swerebenchv2/mwouts-jupytext:360-a29e91d swerebenchv2/rokucommunity-brighterscript:1050-338b8eb swerebenchv2/joshuakgoldberg-bingo:271-688cf8d; do
    docker image inspect "$img" >/dev/null 2>&1 && continue
    t=$HOME/.ss-eval/image-tars/docker.io_$(echo "$img" | tr '/:' '__').tar
    [ -f "$t" ] || die "image $img is not loaded and $t is missing (host-pull it first)"
    say "  docker load $(basename "$t")"; [ "$DRY" = 1 ] || docker load -i "$t" | tail -1
  done
}

busy_reason() {   # prints why a pilot must not start now; empty = clear
  pgrep -f "harness/run-pilo[t].mjs" >/dev/null && { echo "another run-pilot is running"; return; }
  pgrep -f "env-ledger-swee[p]" >/dev/null && { echo "an env-ledger sweep is running"; return; }
  if ps axo command= | grep -E "search-server\.js|cli\.js\s+--serve|index-maintainer\.mjs" | grep -qv grep; then
    echo "a process matches run-pilot's machine-wide end-of-pool reap pattern (it would be killed)"; return; fi
  if [ "${GS_WAIT_DAEMONS:-0}" = 1 ] && { pgrep -x sweet-search-daemon >/dev/null || pgrep -x sweet-search-maintainer >/dev/null; }; then
    echo "ss-* daemons are alive (GS_WAIT_DAEMONS=1)"; return; fi
}
wait_clear() {
  local r first=1
  while r=$(busy_reason); [ -n "$r" ]; do
    [ $first = 1 ] && say "$(date '+%F %T') waiting: $r"; first=0; sleep 30
  done
  [ $first = 1 ] || say "$(date '+%F %T') clear"
  if pgrep -x sweet-search-daemon >/dev/null || pgrep -x sweet-search-maintainer >/dev/null; then
    say "  note: other ss-* daemon/maintainer processes are alive (not ours; not touched):"
    local nm p   # never `n`: drive()'s leg counter is `n`, and bash scoping is dynamic (clobbered it on 2026-10-02)
    for nm in sweet-search-daemon sweet-search-maintainer; do for p in $(pgrep -x $nm); do
      say "    $nm pid=$p cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"; done; done
  fi
}

# Every switch that could make the arms differ in anything but the gutter is removed; the product harness is set explicitly.
SVAR=(); for v in $(env | sed -n 's/^\(SS_VARIANT_[A-Za-z0-9_]*\)=.*/\1/p'); do SVAR+=(-u "$v"); done
UNSET=("${SVAR[@]+"${SVAR[@]}"}" -u SS_READ_GUTTER -u OC_HARNESS_TRIM -u CC_HARNESS_TRIM -u SS_AGENT_BASH_TIMEOUT_MS
   -u SWEET_RULES_PLACEMENT -u MPP -u MAX_TOOL_CALLS -u SS_HARD_TURN_CAP -u SS_BENCH_NO_USD -u SS_SKIP_ENV_LEDGER
  -u SS_SKIP_GOLDEN_CHECK -u SS_ALLOW_BLOCKED_TASKS -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u OPENAI_API_KEY)   # OPENROUTER_API_KEY is kept: it is the route
COMMON=(BENCH_INCLUDE_UNTRACKED=1 RT_ATTACH_REQUIRE_SAME_DIFF=1 TASKS_FILE=$SPECS ARMS=sweet HARNESS=opencode MODEL=openai/gpt-6.1-sol
  PROVIDER=openrouter REASONING=medium ENV_LEDGER=$LEDGER REPS=1 CONCURRENCY=1 INSTANCES=$CSV)
ARM_A=(SS_READ_GUTTER=colon)  # shipped opencode form
ARM_B=(SS_READ_GUTTER=none)   # variant: no gutter

case $MODE in
  preflight)
    base_guards; build_specs; ensure_images
    say "ledger: $LEDGER"
    rc=0
    for arm in A B; do
      envs=("${ARM_A[@]}"); [ $arm = B ] && envs=("${ARM_B[@]}")
      say "== preflight arm $arm (${envs[*]})"
      env "${UNSET[@]}" "${COMMON[@]}" "${envs[@]}" PREFLIGHT_ONLY=1 RUN_ID=gso-preflight-$arm node harness/run-pilot.mjs 2>&1 | tee -a "$LOG" | grep -E "pre-flight|ledger|stale|missing|gold|admission|FAIL|error" | head -30
      [ "${PIPESTATUS[0]}" = 0 ] || rc=1
    done
    say "preflight rc=$rc"; exit $rc ;;
  sweep)
    base_guards; build_specs; ensure_images
    # Gold grading is docker only (no model, no ss-* daemon, no reap), so only another pilot or sweep blocks it.
    # GS_SWEEP_WAIT=1 also waits for a quiet machine: no retrieval-bench-282 at all and 1-min load < GS_MAX_LOAD (default 16).
    # Reason (2026-10-02): under load ~228 bingo-271's P2P test `prepareOptions … uses an option value from produce` hit
    # vitest's 5 s timeout and the gold grade came back env-broken; it passed on 2026-09-29 on a quiet machine.
    pgrep -f "harness/run-pilo[t].mjs" >/dev/null && die "another run-pilot is running"
    pgrep -f "env-ledger-swee[p]" >/dev/null && die "an env-ledger sweep is running"
    if [ "${GS_SWEEP_WAIT:-0}" = 1 ]; then
      while pgrep -f "retrieval-bench-28[2].mjs" >/dev/null || [ "$(sysctl -n vm.loadavg | awk '{print int($2)}')" -ge "${GS_MAX_LOAD:-16}" ]; do sleep 30; done
      say "$(date '+%F %T') quiet (load $(sysctl -n vm.loadavg))"
    fi
    mkdir -p "$SWEEP_DIR"; printf '%s\n' ${GS_SWEEP_IDS:-${TASKS[@]}} | tr ',' '\n' > "$TMPDIR/gso-sweep.ids"
    # env-ledger-sweep skips any id that already has a verdict here, so drop those first to force a re-grade.
    if [ "$DRY" != 1 ] && [ -f "$SWEEP_DIR/ledger.jsonl" ]; then
      grep -v -F -f <(sed 's/.*/"instance_id":"&"/' "$TMPDIR/gso-sweep.ids") "$SWEEP_DIR/ledger.jsonl" > "$SWEEP_DIR/ledger.tmp"; mv "$SWEEP_DIR/ledger.tmp" "$SWEEP_DIR/ledger.jsonl"
    fi
    say "$(date '+%F %T') sweep -> $SWEEP_DIR (gold grading only, no model)"
    if [ "$DRY" = 1 ]; then echo "DRY: node harness/env-ledger-sweep.mjs --tasks $SPECS --ids $TMPDIR/gso-sweep.ids --out $SWEEP_DIR --batch 1 --max-workers 1"; exit 0; fi
    node harness/env-ledger-sweep.mjs --tasks "$SPECS" --ids "$TMPDIR/gso-sweep.ids" --out "$SWEEP_DIR" --batch 1 --max-workers 1 2>&1 | tee -a "$LOG"
    say "$(date '+%F %T') sweep done: $SWEEP_DIR/ledger.jsonl (re-run 'preflight' next)"; exit 0 ;;
  analyze) exec node "$HERE/analyze-gutter-oc.mjs" "$MANIFEST" ;;
  launch) ;;
  *) die "unknown mode $MODE" ;;
esac

# ---------------------------------------------------------------- launch
base_guards; build_specs
[ -n "${OPENROUTER_API_KEY:-}" ] || die "no OPENROUTER_API_KEY in the environment"
[ "$("$HOME/.ss-eval/bin-opencode-1.18.4/opencode" --version)" = "1.18.4" ] || die "pinned opencode is not 1.18.4"

LEGS=(); for r in $(seq 1 "$REPS"); do if [ $((r % 2)) = 1 ]; then LEGS+=("A:$r" "B:$r"); else LEGS+=("B:$r" "A:$r"); fi; done
say "gutter smoke stamp=$STAMP tasks=$CSV reps=$REPS legs=${LEGS[*]} ledger=$LEDGER"
say "expected: about 6-10 min per pilot (3 rollouts of ~10 calls + image start + grading), 4 pilots = 30-50 min. OpenRouter METERED; estimate about \$1-2 (luna hill-climb mean \$0.0175 on these tasks; Sol list price is higher)."

drive() {
  local n=0 leg arm rep run envs rc
  for leg in "${LEGS[@]}"; do
    arm=${leg%%:*}; rep=${leg##*:}; n=$((n+1)); run=gso-$STAMP-L$n
    if grep -q "^$run done" "$STATUS" 2>/dev/null; then say "skip $run (done)"; continue; fi
    envs=("${ARM_A[@]}"); [ "$arm" = B ] && envs=("${ARM_B[@]}")
    if [ "$DRY" = 1 ]; then printf 'DRY: %s (arm %s rep %s): env' "$run" "$arm" "$rep"; printf ' %q' "${UNSET[@]}" "${COMMON[@]}" "${envs[@]}" "RUN_ID=$run"; echo ' node harness/run-pilot.mjs'; continue; fi
    wait_clear; ensure_images
    grep -q "^$run " "$MANIFEST" 2>/dev/null || echo "$run arm=$arm rep=$rep ${envs[*]}" >> "$MANIFEST"
    say "$(date '+%F %T') launching $run"
    env "${UNSET[@]}" "${COMMON[@]}" "${envs[@]}" RUN_ID=$run node harness/run-pilot.mjs > "$L/$run.log" 2>&1
    rc=$?
    echo "$run done rc=$rc $(date +%T)" >> "$STATUS"
    say "$(date '+%F %T') $run exited rc=$rc"
    if grep -q -i -E "usage limit|rate limit reached|account fatal|insufficient credits|Payment Required" "$L/$run.log"; then
      say "stopping: account/usage problem (re-run with GS_STAMP=$STAMP to resume)"; return 9; fi
  done
  [ "$DRY" = 1 ] && return 0
  say "$(date '+%F %T') ALL LEGS DONE"
  node "$HERE/analyze-gutter-oc.mjs" "$MANIFEST" 2>&1 | tee -a "$LOG"
}
if [ "$DRY" = 1 ] || [ "${GS_FOREGROUND:-0}" = 1 ]; then drive; exit $?; fi   # GS_FOREGROUND=1: run under a supervisor (a detached driver died after L1 on 2026-10-02)
( drive ) >/dev/null 2>&1 &
disown
echo "launched (detached) stamp=$STAMP  log: $LOG  manifest: $MANIFEST"
