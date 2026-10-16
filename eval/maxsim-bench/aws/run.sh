#!/bin/bash
# run.sh <mode>[,<mode>...]
#
# Runs the job groups of each mode (plan_groups.py) in the given order. Modes: smoke, dev,
# heldout, replica, progression, hold. On a cloud machine the machine shuts down ONCE,
# after the last mode, unless the chain holds "hold".
#
# For every mode: download s3://$BUCKET/results/$MACHINE/ first (resume; run_matrix.py
# re-checks every job key), run each group, upload after each group, then
# check_complete.py, then summarize.py, then upload the summary, machine.txt and run.log.
# A group that was finished in an earlier start (run-state.jsonl) is skipped. A failed
# group is recorded; the other groups still run; the script ends with FAILED and exit 1.
# It prints "done" only when every group of every mode passed.
#
# Environment: MACHINE (name, required), REPLAY (replay root), BEIR (BEIR set root),
# RESULTS (results root), SS_LOCAL=1 (Mac / EPYC: no S3, no shutdown).
# Cloud values (BUCKET, ...) come from aws/env.local next to this script (git-ignored).
set -u
H=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$H/aws/env.local" ] && . "$H/aws/env.local"
: "${MACHINE:?set MACHINE}"
REPLAY=${REPLAY:-/opt/replay}
BEIR=${BEIR:-$REPLAY/beir}
RESULTS=${RESULTS:-$H/results}
LOCAL=${SS_LOCAL:-0}
PY=$H/venv/bin/python
OUT=$RESULTS/$MACHINE
STATE=$OUT/run-state.jsonl
mkdir -p "$OUT"
LOG=$OUT/run.log
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
s3() { [ "$LOCAL" = 1 ] && return 0; aws s3 "$@" --only-show-errors; }
up() { [ "$LOCAL" = 1 ] || s3 sync "$OUT/" "s3://$BUCKET/results/$MACHINE/" --exclude 'stale/*'; }

MODES=$(echo "$1" | tr ',' ' ')
HOLD=0; case ",$1," in *,hold,*) HOLD=1;; esac
FAILED=()

finish() {
  up
  if [ ${#FAILED[@]} -gt 0 ]; then say "FAILED: ${FAILED[*]}"; RC=1; else say "done: $1"; RC=0; fi
  up
  if [ "$LOCAL" != 1 ] && [ "$HOLD" = 0 ]; then say "shutdown"; sudo shutdown -h now; fi
  exit $RC
}

# Download first: the resume copy from S3 replaces run.log, and the start line must survive it.
[ "$LOCAL" = 1 ] || s3 sync "s3://$BUCKET/results/$MACHINE/" "$OUT/"
say "start modes=$1 machine=$MACHINE replay=$REPLAY local=$LOCAL"

for MODE in $MODES; do
  [ "$MODE" = hold ] && continue
  EXTRA=()
  if [ "$MODE" = heldout ] || [ "$MODE" = replica ]; then
    FZ=$H/FREEZE.json
    if ! $PY -I "$H/freeze_check.py" "$FZ" >> "$LOG" 2>&1; then
      say "mode $MODE refused: FREEZE.json missing or the code does not match it"; FAILED+=("$MODE:freeze"); continue
    fi
    MTYPE=$(echo "$MACHINE" | sed -E 's/^(intel|amd|arm)-([0-9]+|replica)$/\1/')   # S8 shard machines intel-1..n and replicas intel-replica use the type's shortlist
    EXTRA=(--freeze "$FZ" --shortlist "$H/shortlist-$MTYPE.json" --beir "$BEIR")
  fi
  if [ "$MODE" = progression ]; then
    say "mode progression: W10 is optional; run progression.sh by hand if it is in FREEZE.json"; continue
  fi
  # S5.1 / S8: on this CPU first, the contract fixtures for every arm and the input check
  # (gates: a failure stops all work on this machine), and the rivals_rs report (recorded).
  if [ "$MODE" = dev ] || [ "$MODE" = heldout ] || [ "$MODE" = replica ]; then
    FX=$OUT/preflight-$MODE; mkdir -p "$FX"
    if ! $PY -I "$H/fixtures_contracts.py" --keep "$FX/fixtures" > "$FX/fixtures.log" 2>&1; then
      say "mode $MODE: contract fixtures FAILED (see preflight-$MODE/fixtures.log); nothing else runs here"; FAILED+=("$MODE:fixtures"); finish "$1"
    fi
    if [ -d "$REPLAY/agent-dev" ] && ! $PY -I "$H/check_inputs.py" "$REPLAY/agent-dev" > "$FX/check_inputs.log" 2>&1; then
      say "mode $MODE: check_inputs FAILED (see preflight-$MODE/check_inputs.log); nothing else runs here"; FAILED+=("$MODE:inputs"); finish "$1"
    fi
    $PY -I "$H/check_rivals_rs.py" > "$FX/check_rivals_rs.log" 2>&1 || say "mode $MODE: check_rivals_rs.py exited non-zero (recorded)"
    rm -rf "$FX/fixtures"/*/   # the fixture replay sets; fixtures-result.json stays
    say "mode $MODE: fixtures and input check passed"
    up
  fi
  MTAG=$(echo "$MODE" | tr '/:' '__')
  GROUPS_FILE=$OUT/groups-$MTAG.jsonl
  if ! $PY -I "$H/plan_groups.py" "$MODE" --machine "$MACHINE" --replay "$REPLAY" ${EXTRA[@]+"${EXTRA[@]}"} > "$GROUPS_FILE" 2>> "$LOG"; then
    say "mode $MODE: plan_groups.py failed"; FAILED+=("$MODE:plan"); continue
  fi
  $PY -I -c "import json,sys; m=sorted({x for l in open(sys.argv[1]) for x in json.loads(l).get('missing', [])}); print('\n'.join(m), end='\n' if m else '')" "$GROUPS_FILE" > "$OUT/missing-arms-$MTAG.txt"
  [ -s "$OUT/missing-arms-$MTAG.txt" ] && say "mode $MODE: arms not available here: $(tr '\n' ' ' < "$OUT/missing-arms-$MTAG.txt")"
  TAGS=()
  while IFS= read -r G; do
    ID=$($PY -I -c "import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:16])" "$G")
    NAME=$($PY -I -c "import json,sys; print(json.loads(sys.argv[1])['name'])" "$G")
    TAGS+=("$NAME")
    # A group marked ok is skipped only while its result files still validate (a file
    # damaged in S3 or on disk sends the group back to run_matrix.py, which reuses every
    # valid file and runs only the bad jobs again).
    if [ -f "$STATE" ] && grep -q "\"$ID\": \"ok\"" "$STATE"; then
      if [ -d "$OUT/$NAME" ] && $PY -I "$H/check_complete.py" "$OUT/$NAME" >> "$LOG" 2>&1; then say "skip $NAME ($ID, done in an earlier start)"; continue; fi
      say "group $NAME ($ID): marked done, but its results do not validate; run again"
    fi
    KIND=$($PY -I -c "import json,sys; print(json.loads(sys.argv[1])['kind'])" "$G")
    SETUP=$($PY -I -c "import json,sys; print(json.loads(sys.argv[1]).get('setup', ''))" "$G")
    if [ "$SETUP" = aa-copy ]; then
      export SS_CAPI_DIR=$OUT/capi-aa; mkdir -p "$SS_CAPI_DIR"
      LIB=$(ls "$H"/capi/target/release/libss_maxsim_capi.{dylib,so} 2>/dev/null | head -1)
      cp "$LIB" "$SS_CAPI_DIR/aa.${LIB##*.}"
    fi
    say "group $NAME ($ID) start"
    if [ "$KIND" = matrix ]; then
      ARGS=(); while IFS= read -r X; do ARGS+=("$X"); done < <($PY -I -c "import json,sys; print('\n'.join(json.loads(sys.argv[1])['args']))" "$G")
      $PY -I "$H/run_matrix.py" --machine "$MACHINE" --results "$RESULTS" --max-busy "${MAX_BUSY:-0}" "${ARGS[@]}" >> "$LOG" 2>&1
      RCG=$?
    else
      $PY -I "$H/concurrency.py" --group-json "$G" --machine "$MACHINE" --results "$RESULTS" >> "$LOG" 2>&1
      RCG=$?
    fi
    if [ $RCG = 0 ]; then echo "{\"$ID\": \"ok\", \"name\": \"$NAME\"}" >> "$STATE"; say "group $NAME ok"
    else echo "{\"$ID\": \"failed\", \"name\": \"$NAME\"}" >> "$STATE"; say "group $NAME FAILED (exit $RCG)"; FAILED+=("$NAME"); fi
    up
  done < "$GROUPS_FILE"
  CHECK_DIRS=(); for T in $(printf '%s\n' ${TAGS[@]+"${TAGS[@]}"} | sort -u); do [ -d "$OUT/$T" ] && CHECK_DIRS+=("$OUT/$T"); done
  if [ ${#CHECK_DIRS[@]} -gt 0 ] && $PY -I "$H/check_complete.py" "${CHECK_DIRS[@]}" >> "$LOG" 2>&1; then
    say "mode $MODE: check_complete passed"
    case "$MODE" in file:*) ;; *)
      $PY -I "$H/summarize.py" "$OUT" --mode "$MODE" --md "$OUT/summary-$MODE.md" >> "$LOG" 2>&1 || { say "mode $MODE: summarize failed"; FAILED+=("$MODE:summarize"); };;
    esac
  else
    say "mode $MODE: check_complete FAILED"; FAILED+=("$MODE:check_complete")
  fi
  [ -f /opt/ss/machine.txt ] && cp /opt/ss/machine.txt "$OUT/machine.txt"
  up
done
finish "$1"
