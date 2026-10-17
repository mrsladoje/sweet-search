#!/bin/bash
# run.sh <mode>[,<mode>...]
#
# Runs the plan files of each mode, in the given order. Modes:
#   build            S4: every build of the plan files, admitted by a memory budget (build_sched.py)
#   build-isolated   S4: the same, one build at a time; these are the build-cost runs
#   smoke            S3a / S4: plans with --limit 50 on dev sets, then test_harness.sh
#   dev              S5b: dev plans; refuses any held-out job
#   aa               S5b / S6: A/A plans (two arms of one build, 5 rounds) for the choice of R; dev split
#   heldout          S8: held-out plans; refuses to start without FREEZE.json and a matching code hash
#   hold             do not shut down at the end (the idle watchdog still ends an idle machine)
# The machine shuts down ONCE, after the last mode, unless the chain holds "hold".
#
# Plan files (the format of run.py): $PLAN_ROOT/<mode>/*.json, else $PLAN_DIR/*.json, else plans/<machine>/<mode>/*.json, else
# plans/<mode>/*.json (next to this script's parent), else plan.py --mode M --machine X --data D --out DIR
# [--limit 50 for smoke] [--families $RESULTS/<machine>/families.txt] [--shortlist $SHORTLIST for heldout].
# The mode "build" reads the plans of the directory "build". plan.py needs k_v in sets/<set>/set.json
# ({"k_v": {"<model>": n}}, from kv.py on dev) for the modes smoke, dev and aa.
#
# Builds are made once and copied everywhere (owner, 2026-10-15). They live in the shared store
# $DATA/builds/shared/<set>/<model>/<family>/<hash>, which syncs with s3://$BUCKET/hnsw/builds/shared/. Our own
# indexes ($DATA/emb/<model>/<set>/index) sync with s3://$BUCKET/hnsw/emb/. A build machine uploads what it
# builds; a timing machine downloads before it times and never builds (modes dev, aa, heldout only check).
# SHARD=i/n: several build machines build in parallel; a shard holds whole (set, model) groups (build_sched.py).
# QUEUE=name + LAZY_BUILDS=1: timing machines of one CPU type share a mode's plans through S3 claims and fetch only
# the builds of the plan they run (see claim, fetch_builds).
# Smoke builds its own small builds only when SMOKE_BUILD=1 or when the chain also holds a build mode.
#
# For every mode: download s3://$BUCKET/hnsw/results/<machine>/ (and the builds) first (resume; run.py
# re-checks every job key), run each plan, upload after each plan, run check_complete.py on the jobs lists,
# upload run.log and machine.txt. A failed plan is recorded and the others still run. The script prints
# "done" only when every plan of every mode passed; otherwise "FAILED: ..." and exit 1.
# Before a timing plan: CPU governor performance, THP madvise (both recorded), run.py pinned to one core.
#
# Environment: MACHINE (required), SHARD (i/n, default 0/1), SHORTLIST, SMOKE_BUILD, DATA, ROOT, RESULTS, REPO (default: the repo root above this script), PLAN_ROOT, PLAN_DIR, SS_LOCAL=1 (no S3, no shutdown, no change
# of governor / THP; SS_TUNE=1 turns the change back on), SS_PIN=0|1 (default 1 in the cloud, 0 local).
# Cloud values (BUCKET, ...) come from env.local next to this script (git-ignored).
set -u
AWSD=$(cd "$(dirname "$0")" && pwd); H=$(cd "$AWSD/.." && pwd); REPO=${REPO:-$(cd "$H/../../../.." && pwd)}
[ -f "$AWSD/env.local" ] && . "$AWSD/env.local"
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
: "${MACHINE:?set MACHINE}"
LOCAL=${SS_LOCAL:-0}
DATA=${DATA:-/opt/hnsw-data}; ROOT=${ROOT:-/opt/hnsw-root}; RESULTS=${RESULTS:-/opt/hnsw-results}
PY=${PY:-python3}
SCANN_PY=$ROOT/venv-scann/bin/python; [ -x "$SCANN_PY" ] || SCANN_PY=$PY
BUILD=$ROOT/build   # rivals5, rivals5-ext (x86 only), librescore5.so
RIVALS=$BUILD/rivals5; EXTB=$BUILD/rivals5-ext
SHARD=${SHARD:-0/1}
case "${PLAN_ROOT:-}" in ""|/*) ;; *) PLAN_ROOT=$H/$PLAN_ROOT;; esac   # relative to the paper directory
SHORTLIST=${SHORTLIST:-$H/shortlist.json}
OUT=$RESULTS/$MACHINE
PIN=${SS_PIN:-$([ "$LOCAL" = 1 ] && echo 0 || echo 1)}
TUNE=${SS_TUNE:-$([ "$LOCAL" = 1 ] && echo 0 || echo 1)}
mkdir -p "$OUT"
LOG=$OUT/run.log
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
s3() { [ "$LOCAL" = 1 ] && return 0; aws s3 "$@" --only-show-errors; }
S3R="s3://${BUCKET:-}/hnsw/results/$MACHINE"; S3B="s3://${BUCKET:-}/hnsw/builds/shared"; S3E="s3://${BUCKET:-}/hnsw/emb"
down() {
  s3 sync "$S3R/" "$OUT/" --exclude 'machine.txt' --exclude 'families.txt'
  [ "$LOCAL" = 1 ] || mkdir -p "$DATA/builds/shared"
  [ "${LAZY_BUILDS:-0}" = 1 ] && return 0   # timing machine with a queue: builds come per plan (fetch_builds)
  s3 sync "$S3B/" "$DATA/builds/shared/" --exclude '*.stale-*/*'
  s3 sync "$S3E/" "$DATA/emb/" --exclude '*' --include '*/*/index*/*'
}
# QUEUE=<name>: several machines of one CPU type share the plan files of a mode; a plan runs on the machine that
# first creates s3://$BUCKET/hnsw/queue/<name>/<plan>.claim (conditional put), largest plans first.
claim() {  # claim <plan> -> 0 if this machine owns it
  [ -z "${QUEUE:-}" ] && return 0
  [ "$LOCAL" = 1 ] && return 0
  local k="hnsw/queue/$QUEUE/$MODE/$(basename "$1" .json).claim"
  echo "$MACHINE $(date -u +%FT%TZ)" > "$OUT/.claim"
  aws s3api put-object --bucket "$BUCKET" --key "$k" --body "$OUT/.claim" --if-none-match '*' >/dev/null 2>&1 && return 0
  # a claim this machine made before a restart is still its own (the plan resumes here)
  [ "$(aws s3 cp --only-show-errors "s3://$BUCKET/$k" - 2>/dev/null | awk '{print $1}')" = "$MACHINE" ]
}
fetch_builds() {  # fetch_builds <plan>: only the builds and our index of the plan's (set, model)
  [ "${LAZY_BUILDS:-0}" = 1 ] || return 0
  local P_ARG=$1 sm; sm=$($PY -I -c 'import json,sys; d=json.load(open(sys.argv[1])); x=(d.get("jobs") or d.get("builds"))[0]; print(x["set"], x["model"])' "$1")
  set -- $sm
  # only the build dirs the plan's jobs use (a whole 1M (set, model) store is ~117 GB)
  local rel
  for rel in $($PY -I -c '
import json, os, sys
sys.path.insert(0, sys.argv[2]); import jobs
d = json.load(open(sys.argv[1])); data = sys.argv[3]; seen = set()
for j in (d.get("jobs") or []) + (d.get("builds") or []):
    if j.get("system", j.get("family", "")).startswith("ours") or "build_params" not in j:
        continue
    b = dict(set=j["set"], model=j["model"], family=j["family"], build_params=j["build_params"], build_seed=j.get("build_seed", 42))
    r = os.path.relpath(jobs.build_dir(data, b), os.path.join(data, "builds", "shared"))
    if r not in seen:
        seen.add(r); print(r)' "$P_ARG" "$H" "$DATA"); do
    s3 sync "$S3B/$rel/" "$DATA/builds/shared/$rel/" --exclude '*.stale-*/*'
  done
  s3 sync "$S3E/$2/$1/" "$DATA/emb/$2/$1/" --exclude '*' --include 'index*/*' --include 'export/*'
}
drop_builds() {  # drop_builds <plan>: free the disk after the plan (LAZY_BUILDS)
  [ "${LAZY_BUILDS:-0}" = 1 ] || return 0
  local sm; sm=$($PY -I -c 'import json,sys; d=json.load(open(sys.argv[1])); x=(d.get("jobs") or d.get("builds"))[0]; print(x["set"], x["model"])' "$1")
  set -- $sm
  rm -rf "$DATA/builds/shared/$1/$2"
}
up() {
  # the build record of this machine: library commits, SIMD levels, binary hashes (PAPER_PLAN 5.5)
  for f in "$BUILD/build-info.json" "$ROOT/build-new/build-info-new.json" "$ROOT/stages.txt"; do [ -f "$f" ] && cp "$f" "$OUT/"; done
  s3 sync "$OUT/" "$S3R/" --exclude 'stale/*'
  [ -d "$DATA/builds/shared" ] && s3 sync "$DATA/builds/shared/" "$S3B/" --exclude '*.stale-*/*'
  # our indexes and their exports (codes, int8 rows, f16 vectors), which timing machines read
  [ -d "$DATA/emb" ] && s3 sync "$DATA/emb/" "$S3E/" --exclude '*' --include '*/*/index*/*' --include '*/*/export/*'
}

MODES=$(echo "$1" | tr ',' ' ')
HOLD=0; case ",$1," in *,hold,*) HOLD=1;; esac
FAILED=()

finish() {
  up
  if [ ${#FAILED[@]} -gt 0 ]; then say "FAILED: ${FAILED[*]}"; RC=1; else say "done: $1"; RC=0; fi
  up
  if [ "$LOCAL" != 1 ] && [ "$HOLD" = 0 ]; then say "shutdown"; ${SUDO-sudo} shutdown -h now; fi
  exit $RC
}
[ "$(id -u)" = 0 ] && SUDO=

# ---- timing environment (once): governor, THP, the pinned core
CPU_LIST=
prepare_timing() {
  [ -n "${TIMING_READY:-}" ] && return; TIMING_READY=1
  local T=$OUT/timing-env.txt
  { echo "date=$(date -u +%FT%TZ) tune=$TUNE pin=$PIN"
    echo "governor_before=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo none)"
    echo "thp_before=$(cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo none)"; } > "$T"
  if [ "$TUNE" = 1 ]; then
    for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do [ -w "$g" ] && echo performance > "$g"; done
    [ -w /sys/kernel/mm/transparent_hugepage/enabled ] && echo madvise > /sys/kernel/mm/transparent_hugepage/enabled
  fi
  { echo "governor_after=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo none)"
    echo "thp_after=$(cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo none)"; } >> "$T"
  if [ "$PIN" = 1 ] && command -v taskset >/dev/null; then
    # the last physical core (core 0 takes the interrupts); with SMT its sibling threads must stay idle
    local pick; pick=$($PY -I - <<'PYEOF'
import subprocess, time
rows = [l.split(',') for l in subprocess.run(['lscpu', '-p=CPU,CORE,SOCKET'], capture_output=True, text=True).stdout.splitlines() if l and l[0] != '#']
cores = {}
for c, k, s in rows:
    cores.setdefault((int(s), int(k)), []).append(int(c))
key = sorted(cores)[-1]
cpus = sorted(cores[key]); cpu, sib = cpus[0], cpus[1:]
def busy():
    d = {}
    for l in open('/proc/stat'):
        if l.startswith('cpu') and l[3].isdigit():
            f = l.split(); v = list(map(int, f[1:9])); d[int(f[0][3:])] = (sum(v), v[3] + v[4])
    return d
a = busy(); time.sleep(1); b = busy()
idle = {s: round(100 * (b[s][1] - a[s][1]) / max(1, b[s][0] - a[s][0]), 1) for s in sib}
print(cpu, ','.join(map(str, sib)) or '-', ';'.join(f'{k}:{v}' for k, v in idle.items()) or '-', len(cores), len(rows))
PYEOF
)
    local sibs idle ncores ncpus
    read -r CPU_LIST sibs idle ncores ncpus <<< "$pick"
    echo "pinned_cpu=$CPU_LIST sibling_threads=$sibs sibling_idle_percent=$idle physical_cores=$ncores logical_cpus=$ncpus" >> "$T"
    say "timing runs pinned to cpu $CPU_LIST (sibling threads: $sibs, idle % $idle)"
  else
    echo "pinned_cpu=none" >> "$T"
  fi
  say "timing environment: $(tr '\n' ' ' < "$T")"
}

# ---- plan files of a mode
plan_files() {  # plan_files <mode> -> one path per line (non-zero if none)
  local m=$1 d f
  for d in "${PLAN_ROOT:+$PLAN_ROOT/$m}" "${PLAN_DIR:-}" "$H/plans/$MACHINE/$m" "$H/plans/$m"; do
    [ -n "$d" ] && [ -d "$d" ] && ls "$d"/*.json >/dev/null 2>&1 && { ls "$d"/*.json; return 0; }
  done
  if [ -f "$H/plan.py" ]; then
    local x=()
    [ "$m" = smoke ] && x+=(--limit 50)
    [ -f "$OUT/families.txt" ] && x+=(--families "$OUT/families.txt")
    [ "$m" = heldout ] && x+=(--shortlist "$SHORTLIST")
    rm -rf "$OUT/plans/$m"; mkdir -p "$OUT/plans/$m"
    $PY -I "$H/plan.py" --mode "$m" --machine "$MACHINE" --data "$DATA" --out "$OUT/plans/$m" ${x[@]+"${x[@]}"} >> "$LOG" 2>&1 || return 1
    ls "$OUT/plans/$m"/*.json 2>/dev/null && return 0
  fi
  return 1
}
plan_field() { $PY -I -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$1" "$2"; }
plan_splits() { $PY -I -c "import json,sys; print(' '.join(sorted({j['split'] for j in json.load(open(sys.argv[1]))['jobs']})))" "$1"; }

sched() {  # sched <plan>...   (SCHED_ARGS holds --isolated or --check)
  local x=() p
  while [ $# -gt 0 ]; do p=$1; shift; x+=(--plan "$p"); done
  local ext=(); [ -x "$EXTB" ] && ext=(--rivals-ext "$EXTB")
  $PY -I "$AWSD/build_sched.py" "${x[@]}" --data "$DATA" --machine "$MACHINE" --repo "$REPO" --rivals "$RIVALS" ${ext[@]+"${ext[@]}"} \
      --python "$SCANN_PY" --results "$RESULTS" --shard "$SHARD" ${SCHED_ARGS[@]+"${SCHED_ARGS[@]}"}
}

run_plan() {  # run_plan <plan> [--heldout --freeze F]
  local p=$1; shift
  local ext=(); [ -x "$EXTB" ] && ext=(--rivals-ext "$EXTB")
  local pin=(); [ -n "$CPU_LIST" ] && pin=(taskset -c "$CPU_LIST")
  ${pin[@]+"${pin[@]}"} $PY -I "$H/run.py" --plan "$p" --data "$DATA" --results "$RESULTS" --machine "$MACHINE" --repo "$REPO" \
      --rivals "$RIVALS" ${ext[@]+"${ext[@]}"} --python "$SCANN_PY" "$@" >> "$LOG" 2>&1
}

say "start modes=$1 machine=$MACHINE data=$DATA local=$LOCAL"
for MODE in $MODES; do
  [ "$MODE" = hold ] && continue
  say "== mode $MODE"
  case "$MODE" in build|build-isolated|smoke|dev|aa|heldout) ;; *) say "unknown mode $MODE"; FAILED+=("$MODE:unknown"); continue;; esac
  down
  PDIR=$MODE; [ "$MODE" = build-isolated ] && PDIR=build
  PLANS=(); while IFS= read -r f; do PLANS+=("$f"); done < <(plan_files "$PDIR")
  if [ ${#PLANS[@]} -eq 0 ]; then say "mode $MODE: no plan files (plans/$PDIR/*.json or plan.py)"; FAILED+=("$MODE:no-plan"); continue; fi

  case "$MODE" in
  build|build-isolated)
    SCHED_ARGS=(); [ "$MODE" = build-isolated ] && SCHED_ARGS=(--isolated)
    # upload every 30 minutes while building, so a stopped machine loses only the builds in progress
    ( while sleep 1800; do up >> "$LOG" 2>&1; done ) & UPLOADER=$!
    if sched "${PLANS[@]}" >> "$LOG" 2>&1; then say "mode $MODE: all builds present"; else say "mode $MODE: build FAILED"; FAILED+=("$MODE:build"); fi
    kill $UPLOADER 2>/dev/null; wait $UPLOADER 2>/dev/null
    up; continue;;
  esac

  # smoke, dev, heldout: guards first, then the timing plans
  EXTRA=(); WANT=dev
  if [ "$MODE" = heldout ]; then
    WANT=ho; FZ=$H/FREEZE.json
    if [ ! -f "$FZ" ] || ! $PY -I "$H/freeze_check.py" "$FZ" "$REPO" >> "$LOG" 2>&1; then
      say "mode heldout refused: FREEZE.json missing or the code does not match it"; FAILED+=("heldout:freeze"); continue
    fi
    EXTRA=(--heldout --freeze "$FZ")
  fi
  BAD=0
  for p in "${PLANS[@]}"; do
    S=$(plan_splits "$p")
    case " $S " in *" $([ $WANT = ho ] && echo dev || echo ho) "*) say "mode $MODE refuses $p: it holds jobs of the other split ($S)"; BAD=1;; esac
  done
  if [ $BAD = 1 ]; then FAILED+=("$MODE:split-guard"); continue; fi
  SCHED_ARGS=()
  SMOKE_OWN=${SMOKE_BUILD:-0}; case ",$1," in *,build,*|*,build-isolated,*) SMOKE_OWN=1;; esac
  if [ "$MODE" = smoke ] && [ "$SMOKE_OWN" = 1 ]; then   # smoke builds its small builds (a build machine only), then times
    if ! sched "${PLANS[@]}" >> "$LOG" 2>&1; then say "mode smoke: build FAILED"; FAILED+=("smoke:build"); continue; fi
  elif [ "${LAZY_BUILDS:-0}" != 1 ]; then   # a timing run builds nothing: the shared builds come from S3
    SCHED_ARGS=(--check)
    if ! sched "${PLANS[@]}" >> "$LOG" 2>&1; then say "mode $MODE: builds missing (see MISSING lines above); run mode build first"; FAILED+=("$MODE:builds-missing"); continue; fi
  fi
  if [ -n "${QUEUE:-}" ]; then  # largest (set, model) first: n of the set
    mapfile -t PLANS < <($PY -I -c '
import json, sys
sys.path.insert(0, sys.argv[1]); from grid import SETS
ps = sys.argv[2:]
def n(p):
    d = json.load(open(p)); x = (d.get("jobs") or d.get("builds"))[0]; return SETS[x["set"]][0]
print("\n".join(sorted(ps, key=lambda p: (-n(p), p))))' "$H" "${PLANS[@]}")
  fi
  prepare_timing
  EXPECTED=()
  # Each pass runs every plan whose builds are complete (LAZY_BUILDS: fetched, then checked before the claim);
  # a plan whose builds are not all in S3 yet is left unclaimed and tried again 10 minutes later.
  TODO=("${PLANS[@]}")
  while [ ${#TODO[@]} -gt 0 ]; do
    LATER=()
    for p in "${TODO[@]}"; do
      STEP=$(plan_field "$p" step)
      fetch_builds "$p"
      SCHED_ARGS=(--check)
      if [ "${LAZY_BUILDS:-0}" = 1 ] && ! sched "$p" >> "$LOG" 2>&1; then
        say "plan $STEP: builds not all in S3 yet, later"; LATER+=("$p"); drop_builds "$p"; continue
      fi
      if ! claim "$p"; then say "plan $STEP claimed by another machine (queue $QUEUE): skip"; drop_builds "$p"; continue; fi
      say "plan $STEP ($p) start"
      EXPECTED+=("$OUT/jobs-expected-$STEP.json")
      if run_plan "$p" ${EXTRA[@]+"${EXTRA[@]}"}; then say "plan $STEP ok"; else say "plan $STEP FAILED"; FAILED+=("$MODE:$STEP"); fi
      up
      drop_builds "$p"
    done
    TODO=(${LATER[@]+"${LATER[@]}"})
    [ ${#TODO[@]} -gt 0 ] && { say "${#TODO[@]} plans wait for builds"; sleep 600; }
  done
  if [ -n "${QUEUE:-}" ] && [ ${#EXPECTED[@]} -eq 0 ]; then say "mode $MODE: every plan ran on other machines of queue $QUEUE"; up; continue; fi
  MISSING_E=0; for e in "${EXPECTED[@]}"; do [ -f "$e" ] || { say "no jobs list $e"; MISSING_E=1; }; done
  if [ $MISSING_E = 0 ] && $PY -I "$H/check_complete.py" "${EXPECTED[@]}" >> "$LOG" 2>&1; then say "mode $MODE: check_complete passed"
  else say "mode $MODE: check_complete FAILED"; FAILED+=("$MODE:check_complete"); fi
  if [ "$MODE" = smoke ]; then
    say "smoke: test_harness.sh"
    if PY=$PY bash "$H/test_harness.sh" "$DATA" "$REPO" >> "$LOG" 2>&1; then say "smoke: test_harness passed"; else say "smoke: test_harness FAILED"; FAILED+=("smoke:test_harness"); fi
  fi
  up
done
finish "$1"
