#!/usr/bin/env bash
# Build the 108 missing SWE-rebench-V2 goldens on the Mac's Metal GPU (~10x faster
# than the Hetzner CPU box, and it can actually finish the giant C/C++ repos), then
# ship them to the box. Idempotent: re-running only builds whatever is still missing.
# Run plugged in:  caffeinate -ims bash eval/task-completion-bench/metal-fill.sh
set -uo pipefail
REPO=/Users/admin/Projects/sweet-search-private
cd "$REPO/eval/task-completion-bench" || exit 1
BOX=root@167.233.69.121

TF=select/.cache/tasks_full_multilingual.json
[ -s "$TF" ] || { echo "FATAL: missing $TF (scp from box)"; exit 1; }
[ -s /tmp/missing-ids.txt ] || { echo "FATAL: missing /tmp/missing-ids.txt"; exit 1; }
MISS=$(cat /tmp/missing-ids.txt)
N=$(echo "$MISS" | tr ',' '\n' | grep -c .)

echo "[metal-fill] $(date)  reaping ss-* daemons (avoid CPU-ORT vs Metal coexistence)"
node env/reap-daemons.mjs 2>/dev/null || true

echo "[metal-fill] building $N missing goldens on Metal (CONCURRENCY=1, 40min cap)"
export TASKS_FILE="$TF" WARM_ONLY=1 GOLDEN_ONLY=1 GOLDEN_TIMEOUT_MS=2400000
INSTANCES="$MISS" CONCURRENCY=1 RUN_ID=metal-fill \
  node harness/run-pilot.mjs 2>&1 | tee /tmp/metal-fill.log

BUILT=$(for d in "$HOME"/.ss-eval/golden/*/; do [ -f "$d/.sweet-search/codebase.db" ] && [ -d "$d/.git" ] && echo x; done 2>/dev/null | wc -l | tr -d ' ')
echo "[metal-fill] $(date)  built; complete goldens on Mac: $BUILT"

echo "[metal-fill] shipping goldens -> box"
rsync -az "$HOME"/.ss-eval/golden/ "$BOX":/root/.ss-eval/golden/
echo "[metal-fill] DONE. box goldens now: $(ssh -o BatchMode=yes "$BOX" 'ls /root/.ss-eval/golden | wc -l')"
