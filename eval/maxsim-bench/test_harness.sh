#!/bin/bash
# test_harness.sh [replay-root]
#
# The failure tests of PAPER_PLAN.md section 5 item 9, each with its expected outcome.
# Light: --limit 5-20 calls of agent-dev / gcsn-dev, 2-3 arms, in a scratch results dir.
#   1 interrupted output     an arm killed mid-run, and a truncated result file -> rejected, run again
#   2 missing calls          calls deleted from a complete file -> check_complete fails, the job runs again
#   3 failed implementation  an arm that exits non-zero -> run_matrix exits 1; run.sh records FAILED, no "done"
#   4 changed job identity   another binary hash, another option, a changed set file -> stale/, run again
#   5 same tag, two groups   both set groups produce results (the v1 skip bug)
#   6 resume                 run.sh stopped between groups and started again -> no job runs twice
#   7 damaged file           a result file of a finished group damaged -> the group runs again, only that job reruns
#   8 W11 RAM pass           --mem jobs validate (kind mem); a damaged one is rejected and runs again
# Exit 0 only if every case gives its expected outcome.
set -u
H=$(cd "$(dirname "$0")" && pwd)
O=${1:-$HOME/.ss-eval/maxsim-replay}
PY=$H/venv/bin/python
T=$(mktemp -d "${TMPDIR:-/tmp}/maxsim-harness.XXXX")
R=$T/results
PASS=0; FAIL=0
ok() { echo "PASS $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL $1"; FAIL=$((FAIL + 1)); }
rm_() { $PY -I "$H/run_matrix.py" --machine t --results "$R" "$@"; }
LIB=$(ls "$H"/capi/target/release/libss_maxsim_capi.{dylib,so} 2>/dev/null | head -1)
EXT=${LIB##*.}
DEV=$O/agent-dev
G=$R/t/c1/agent-dev

# ---- 1 interrupted output
SS_TEST_SLEEP_MS=200 rm_ --tag c1 --set "$DEV" --arm ours --arm numpy_packed --limit 20 --reps 2 --rounds 1 > "$T/c1a.log" 2>&1 &
RM=$!
PID=; for i in $(seq 1 600); do PID=$(pgrep -f "bench.py --arm ours" | head -1); [ -n "$PID" ] && break; sleep 0.1; done
[ -n "$PID" ] || echo "1a: no arm process appeared within 60 s"
sleep 1; kill -9 "$PID" 2>/dev/null; wait $RM; RC=$?
[ $RC = 1 ] && grep -q FAILED "$T/c1a.log" && [ ! -f "$G/ours.r0.p0.json" ] && ok "1a killed arm: run_matrix exit 1, no result file" || bad "1a killed arm (rc=$RC)"
rm_ --tag c1 --set "$DEV" --arm ours --arm numpy_packed --limit 20 --reps 2 --rounds 1 > "$T/c1b.log" 2>&1
head -c 3000 "$G/numpy_packed.r0.p0.json" > "$G/x" && mv "$G/x" "$G/numpy_packed.r0.p0.json"
rm_ --tag c1 --set "$DEV" --arm ours --arm numpy_packed --limit 20 --reps 2 --rounds 1 > "$T/c1c.log" 2>&1
grep -q "stale numpy_packed.r0.p0.json (unreadable" "$T/c1c.log" && grep -q "reuse ours.r0.p0.json" "$T/c1c.log" && $PY -I "$H/check_complete.py" "$R/t/c1" > /dev/null \
  && ok "1b truncated file: moved to stale/, run again, the other job reused" || bad "1b truncated file"

# ---- 2 missing calls
F=$G/ours.r0.p0.json
$PY -I -c "import json,sys; d=json.load(open(sys.argv[1])); d['calls']=d['calls'][:-3]; json.dump(d, open(sys.argv[1],'w'))" "$F"
if $PY -I "$H/check_complete.py" "$R/t/c1" > "$T/c2a.log" 2>&1; then bad "2a check_complete passed with missing calls"; else ok "2a check_complete fails on missing calls"; fi
rm_ --tag c1 --set "$DEV" --arm ours --arm numpy_packed --limit 20 --reps 2 --rounds 1 > "$T/c2b.log" 2>&1
grep -q "stale ours.r0.p0.json (17 calls, expected 20)" "$T/c2b.log" && $PY -I "$H/check_complete.py" "$R/t/c1" > /dev/null && ok "2b the job ran again" || bad "2b rerun after missing calls"

# ---- 3 failed implementation
export SS_CAPI_DIR=$T/capi; mkdir -p "$SS_CAPI_DIR"
rm_ --tag c3 --set "$DEV" --arm ours --arm ours~nosuchbuild --limit 5 --reps 2 --rounds 1 > "$T/c3a.log" 2>&1; RC=$?
[ $RC = 1 ] && grep -q "FAILED: 1 of 2 jobs" "$T/c3a.log" && ! grep -q "matrix complete" "$T/c3a.log" && ok "3a run_matrix exits 1 and prints FAILED" || bad "3a (rc=$RC)"
echo "{\"name\": \"c3\", \"kind\": \"matrix\", \"args\": [\"--tag\", \"c3run\", \"--set\", \"$DEV\", \"--arm\", \"ours\", \"--arm\", \"ours~nosuchbuild\", \"--limit\", \"5\", \"--reps\", \"2\", \"--rounds\", \"1\"]}" > "$T/g3.jsonl"
MACHINE=t RESULTS=$R SS_LOCAL=1 bash "$H/aws/run.sh" "file:$T/g3.jsonl" > "$T/c3b.log" 2>&1; RC=$?
[ $RC = 1 ] && grep -q "group c3 FAILED" "$R/t/run.log" && grep -q "FAILED: c3" "$R/t/run.log" && ! grep -q " done: " "$R/t/run.log" \
  && ok "3b run.sh records the group as FAILED, exit 1, no done" || bad "3b run.sh (rc=$RC)"

# ---- 4 changed job identity
cp "$LIB" "$SS_CAPI_DIR/v.$EXT"
rm_ --tag c4 --set "$DEV" --arm ours~v --arm numpy_packed --limit 5 --reps 2 --rounds 1 > "$T/c4a.log" 2>&1
printf '\0' >> "$SS_CAPI_DIR/v.$EXT"   # another binary hash (the library still loads)
rm_ --tag c4 --set "$DEV" --arm ours~v --arm numpy_packed --limit 5 --reps 2 --rounds 1 > "$T/c4b.log" 2>&1
grep -q "stale ours~v.r0.p0.json (job key differs)" "$T/c4b.log" && grep -q "reuse numpy_packed.r0.p0.json" "$T/c4b.log" && ok "4a binary changed: that job only, to stale/" || bad "4a binary change"
rm_ --tag c4 --set "$DEV" --arm ours~v --arm numpy_packed --limit 5 --reps 3 --rounds 1 > "$T/c4c.log" 2>&1
[ "$(grep -c 'job key differs' "$T/c4c.log")" = 2 ] && ok "4b option changed (--reps): every job to stale/" || bad "4b option change"
S=$T/set/agent-mini; mkdir -p "$S"; cp -R "$DEV/okhttp" "$S/"; rm -rf "$S/okhttp/refs.json"
rm_ --tag c4 --set "$S" --arm ours --limit 5 --reps 2 --rounds 1 > "$T/c4d.log" 2>&1
B=$(ls "$S"/okhttp/*.bin | head -1); $PY -I -c "import sys; b=bytearray(open(sys.argv[1],'rb').read()); b[0]^=1; open(sys.argv[1],'wb').write(b)" "$B"
rm_ --tag c4 --set "$S" --arm ours --limit 5 --reps 2 --rounds 1 > "$T/c4e.log" 2>&1
grep -q "refs-v2 built" "$T/c4e.log" && grep -q "stale ours.r0.p0.json (job key differs)" "$T/c4e.log" && ok "4c set file changed: new references, job to stale/" || bad "4c set change"

# ---- 5 same tag, two set groups
rm_ --tag c5 --set "$DEV" --arm ours --limit 5 --reps 2 --rounds 1 > "$T/c5a.log" 2>&1
rm_ --tag c5 --set "$O/gcsn-dev" --arm ours --limit 5 --reps 2 --rounds 1 > "$T/c5b.log" 2>&1
[ -f "$R/t/c5/agent-dev/ours.r0.p0.json" ] && [ -f "$R/t/c5/gcsn-dev/ours.r0.p0.json" ] && ! grep -q reuse "$T/c5b.log" && $PY -I "$H/check_complete.py" "$R/t/c5" > /dev/null \
  && ok "5 same tag, two set groups: both have results" || bad "5 two groups"

# ---- 6 resume
for n in 1 2; do echo "{\"name\": \"c6\", \"kind\": \"matrix\", \"args\": [\"--tag\", \"c6\", \"--group\", \"g$n\", \"--set\", \"$DEV\", \"--arm\", \"ours\", \"--limit\", \"10\", \"--reps\", \"2\", \"--rounds\", \"1\"]}"; done > "$T/g6.jsonl"
sed -i.bak 's/"g2", "--set"/"g2", "--stride", "2", "--set"/' "$T/g6.jsonl"
MACHINE=t6 RESULTS=$R SS_LOCAL=1 SS_TEST_SLEEP_MS=300 bash "$H/aws/run.sh" "file:$T/g6.jsonl" > "$T/c6a.log" 2>&1 &
RS=$!
for i in $(seq 1 300); do grep -q '"ok"' "$R/t6/run-state.jsonl" 2>/dev/null && break; sleep 0.1; done
pkill -9 -P $RS 2>/dev/null; kill -9 $RS 2>/dev/null; pkill -9 -f "run_matrix.py --machine t6" 2>/dev/null; pkill -9 -f "bench.py --arm ours" 2>/dev/null; sleep 0.5
N1=$(grep -c "r0 p0 ours:" "$R/t6/c6/g1/matrix.log")
MACHINE=t6 RESULTS=$R SS_LOCAL=1 bash "$H/aws/run.sh" "file:$T/g6.jsonl" > "$T/c6b.log" 2>&1; RC=$?
N1b=$(grep -c "r0 p0 ours:" "$R/t6/c6/g1/matrix.log")
[ $RC = 0 ] && [ "$N1" = 1 ] && [ "$N1b" = 1 ] && grep -q "skip c6" "$R/t6/run.log" && grep -q " done: " "$R/t6/run.log" \
  && ok "6 resume: the finished group is skipped, nothing runs twice, done" || bad "6 resume (rc=$RC, g1 runs $N1 -> $N1b)"

# ---- 7 damaged file in a finished group (the S3 copy is damaged; run.sh downloads it)
F7=$R/t6/c6/g1/ours.r0.p0.json
head -c 2000 "$F7" > "$F7.x" && mv "$F7.x" "$F7"
MACHINE=t6 RESULTS=$R SS_LOCAL=1 bash "$H/aws/run.sh" "file:$T/g6.jsonl" > "$T/c7.log" 2>&1; RC=$?
[ $RC = 0 ] && grep -q "marked done, but its results do not validate" "$R/t6/run.log" && grep -q "stale ours.r0.p0.json (unreadable" "$R/t6/c6/g1/matrix.log" \
  && [ "$(grep -c 'r0 p0 ours:' "$R/t6/c6/g1/matrix.log")" = 2 ] && [ "$(grep -c 'r0 p0 ours:' "$R/t6/c6/g2/matrix.log")" = 1 ] \
  && ok "7 damaged file in a finished group: rejected, only that job runs again" || bad "7 damaged file (rc=$RC)"

# ---- 8 W11 RAM pass (run_matrix --mem): a damaged result is rejected and runs again
rm_ --tag c8 --set "$DEV" --arm ours --arm node:production --mem --limit 5 > "$T/c8a.log" 2>&1; RC=$?
F8=$R/t/c8/agent-dev/ours.r0.p0.json
head -c 500 "$F8" > "$F8.x" && mv "$F8.x" "$F8"
if $PY -I "$H/check_complete.py" "$R/t/c8" > /dev/null 2>&1; then C8=pass; else C8=fail; fi
rm_ --tag c8 --set "$DEV" --arm ours --arm node:production --mem --limit 5 > "$T/c8b.log" 2>&1
[ $RC = 0 ] && [ $C8 = fail ] && grep -q "stale ours.r0.p0.json (unreadable" "$T/c8b.log" && grep -q "reuse node-production.r0.p0.json" "$T/c8b.log" \
  && $PY -I "$H/check_complete.py" "$R/t/c8" > /dev/null && ok "8 W11 mem jobs: validated, a damaged one runs again" || bad "8 W11 mem (rc=$RC, check on damaged=$C8)"

echo "test_harness: $PASS passed, $FAIL failed (scratch: $T)"
[ $FAIL = 0 ]
