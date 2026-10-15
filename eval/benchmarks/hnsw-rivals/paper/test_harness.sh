#!/bin/bash
# test_harness.sh <DATA> <REPO> [index-root]
# The failure tests of PAPER_PLAN.md section 5 item 13, each with its expected outcome. Light: our arm on
# gcsn dev, --limit 20, in a scratch results dir and a scratch copy of the harness.
#   1 interrupted output   a job killed mid-run, and a truncated record -> no record / stale, the job runs again
#   2 missing queries      timings deleted from a record -> check_complete fails, the job runs again
#   3 failing system       a job that exits non-zero -> run.py exits 1 and logs FAILED, the other jobs still run
#   4 changed identity     a changed binary (ours5.mjs) or option -> the old record moves to stale/, runs again
#   5 resume               run.py stopped after some jobs and started again -> finished jobs reused, none twice
#   6 held-out guard       dev mode refuses a held-out job; held-out mode refuses to start without FREEZE.json
# Exit 0 only if every case gives its expected outcome.
set -u
DATA=$1; REPO=$2; IDX=${3:-}
H0=$(cd "$(dirname "$0")" && pwd)
T=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/hnsw-harness.XXXX")" && pwd -P); H=$T/h; cp -R "$H0" "$H"; rm -rf "$H/__pycache__"
R=$T/results; PY=${PY:-python3}
PASS=0; FAIL=0
ok() { echo "PASS $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL $1"; FAIL=$((FAIL + 1)); }
plan() {  # plan <file> <step> <limit> <jobs...>  job = system:extra-json
  local f=$1 step=$2 lim=$3; shift 3
  $PY - "$f" "$step" "$lim" "$IDX" "$@" <<'EOF'
import json, sys
f, step, lim, idx = sys.argv[1:5]
jobs = []
for i, spec in enumerate(sys.argv[5:]):
    j = dict(set='gcsn', model='CodeRankEmbed', split='dev', comparison='B', system='ours_cascade', kv=10, round=i, kind='timing',
             options=dict(limit=int(lim)))
    j.update(json.loads(spec))
    if idx: j['index'] = idx
    jobs.append(j)
json.dump(dict(step=step, builds=[], jobs=jobs), open(f, 'w'))
EOF
}
run() { $PY -I "$H/run.py" --plan "$1" --data "$DATA" --results "$R" --machine t --repo "$REPO" "${@:2}"; }
nrec() { find "$R/t" -name '*.json' ! -name '*.key.json' ! -name 'jobs-expected*' ! -path '*/stale/*' | wc -l | tr -d ' '; }

# ---- 1 interrupted output
plan $T/p1.json s1 20 '{}' '{"round": 1}'
SS_TEST_SLEEP_MS=50 run $T/p1.json > $T/c1a.log 2>&1 &
RP=$!
for i in $(seq 1 600); do PID=$(pgrep -f "ours5.mjs.*--round 0" | head -1); [ -n "$PID" ] && break; sleep 0.05; done
pkill -9 -f "run.py --plan $T/p1.json" 2>/dev/null; kill -9 $RP 2>/dev/null; pkill -9 -f "$H/ours5.mjs" 2>/dev/null; sleep 0.5
N1=$(nrec)
run $T/p1.json > $T/c1b.log 2>&1; RC=$?
[ "$N1" -le 1 ] && [ $RC = 0 ] && [ "$(nrec)" = 2 ] && ok "1a killed run: no partial record kept, the rerun completes both jobs" || bad "1a killed run (records before $N1, rc $RC)"
F=$(find "$R/t" -name '*.json' ! -name '*.key.json' ! -name 'jobs-expected*' ! -path '*/stale/*' | head -1)
head -c 500 "$F" > $T/x && mv $T/x "$F"
run $T/p1.json > $T/c1c.log 2>&1
grep -q "stale $(basename $F) (unreadable" $T/c1c.log && grep -q "reuse" $T/c1c.log && [ "$(nrec)" = 2 ] && ok "1b truncated record: to stale/, run again, the other job reused" || bad "1b truncated record"

# ---- 2 missing queries
$PY -c "import json,sys; d=json.load(open(sys.argv[1])); d['timings_ns']=d['timings_ns'][:-3]; json.dump(d, open(sys.argv[1],'w'))" "$F"
if $PY -I "$H/check_complete.py" "$R/t/jobs-expected-s1.json" > $T/c2a.log 2>&1; then bad "2a check_complete passed with missing timings"; else ok "2a check_complete fails on missing timings"; fi
run $T/p1.json > $T/c2b.log 2>&1
grep -q "stale $(basename $F) (17 timings, expected 20)" $T/c2b.log && $PY -I "$H/check_complete.py" "$R/t/jobs-expected-s1.json" > /dev/null && ok "2b the job ran again" || bad "2b rerun after missing timings"

# ---- 3 failing system
plan $T/p3.json s3 20 '{"round": 5}' '{"round": 6, "kv": 3}' '{"round": 7}'
run $T/p3.json > $T/c3.log 2>&1; RC=$?
[ $RC = 1 ] && grep -q "FAILED: 1 of 3 jobs" $T/c3.log && [ "$(grep -c 'ours_cascade gcsn/CodeRankEmbed' $T/c3.log)" = 2 ] && ok "3 failing job: exit 1, FAILED logged, the other two ran" || bad "3 failing job (rc $RC)"

# ---- 4 changed identity
echo "// harness test" >> "$H/ours5.mjs"
run $T/p1.json > $T/c4a.log 2>&1
[ "$(grep -c 'job key differs' $T/c4a.log)" = 0 ] && [ "$(grep -c 'ours_cascade gcsn/CodeRankEmbed' $T/c4a.log)" = 2 ] && ok "4a changed ours5.mjs: new job hashes, both jobs run again" || bad "4a binary change"
plan $T/p4.json s1 21 '{}' '{"round": 1}'
run $T/p4.json > $T/c4b.log 2>&1
[ "$(grep -c 'ours_cascade gcsn/CodeRankEmbed' $T/c4b.log)" = 2 ] && ! grep -q reuse $T/c4b.log && ok "4b changed option (--limit): both jobs run again" || bad "4b option change"
J=$R/$($PY -c "import json,sys; print(json.load(open(sys.argv[1]))['jobs'][0]['file'])" "$R/t/jobs-expected-s1.json")
$PY -c "import json,sys; d=json.load(open(sys.argv[1])); d['key']['round']=99; json.dump(d, open(sys.argv[1],'w'))" "$J"
run $T/p4.json > $T/c4c.log 2>&1
grep -q "stale $(basename $J) (job key differs)" $T/c4c.log && ok "4c record with another key: to stale/, run again" || bad "4c key mismatch"

# ---- 5 resume
plan $T/p5.json s5 20 '{"round": 10}' '{"round": 11}' '{"round": 12}' '{"round": 13}'
SS_TEST_SLEEP_MS=30 run $T/p5.json > $T/c5a.log 2>&1 &
RP=$!
for i in $(seq 1 1200); do [ "$(grep -c 'ours_cascade gcsn/CodeRankEmbed' $T/c5a.log)" -ge 2 ] && break; sleep 0.05; done
pkill -9 -f "run.py --plan $T/p5.json" 2>/dev/null; kill -9 $RP 2>/dev/null; pkill -9 -f "$H/ours5.mjs" 2>/dev/null; sleep 0.5
DONE1=$($PY -c "import json,os,sys; d=json.load(open(sys.argv[1])); print(sum(os.path.exists(os.path.join(sys.argv[2], j['file'])) for j in d['jobs']))" "$R/t/jobs-expected-s5.json" "$R")
run $T/p5.json > $T/c5b.log 2>&1; RC=$?
RU=$(grep -c reuse $T/c5b.log); RN=$(grep -c 'ours_cascade gcsn/CodeRankEmbed' $T/c5b.log)
[ $RC = 0 ] && [ "$RU" = "$DONE1" ] && [ "$DONE1" -lt 4 ] && [ $((RU + RN)) = 4 ] && ok "5 resume: $RU finished jobs reused, $RN run, none twice" || bad "5 resume (rc $RC, done $DONE1, reused $RU, ran $RN)"

# ---- 6 held-out guard
plan $T/p6.json s6 0 '{"split": "ho", "options": {}}'
run $T/p6.json > $T/c6a.log 2>&1; RA=$?
run $T/p6.json --heldout > $T/c6b.log 2>&1; RB=$?
[ $RA != 0 ] && grep -q "refuses a job on split ho" $T/c6a.log && [ $RB != 0 ] && grep -q "held-out mode refused" $T/c6b.log && ok "6 held-out guard: dev mode and freeze-less held-out mode both refuse" || bad "6 held-out guard"

echo "test_harness: $PASS passed, $FAIL failed (scratch: $T)"
[ $FAIL = 0 ]
