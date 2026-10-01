#!/usr/bin/env bash
# Run the five r282 retrieval cells one after another (3 rollouts in parallel inside a cell).
# Resumable: a re-run skips rollouts that already finished. Stops at the first cell that fails
# (for example a subscription usage limit), so the next cells never run on a broken account.
#   bash scripts/retrieval-bench-282-all.sh            # all cells
#   bash scripts/retrieval-bench-282-all.sh oc-dsflash41 codex-sol61-high   # chosen cells
set -euo pipefail
cd "$(dirname "$0")/.."
CELLS=("$@")
[ ${#CELLS[@]} -eq 0 ] && CELLS=(oc-dsflash41 oc-sol61-high codex-sol61-high cc-sonnet55-high cc-opus55-medium)
LOG_DIR=core/prompt-optimization/data/results/r282-logs
mkdir -p "$LOG_DIR"
for c in "${CELLS[@]}"; do
  echo "=== $(date '+%F %T') $c ==="
  rc=0
  CELL="$c" node scripts/retrieval-bench-282.mjs --conc 3 2>&1 | tee -a "$LOG_DIR/$c.log" || rc=$?
  if [ "$rc" -eq 3 ]; then
    # Only a Claude Code cell exits 3 (deterministic cache): its arms started with different cache
    # state, so the warm-up did not work and the next Claude cell would repeat it. Codex and opencode
    # cells record a mismatch as a warning in summary.json and exit 0.
    echo "=== $(date '+%F %T') $c: CACHE FAIRNESS VIOLATION (see results/r282-$c/summary.json); stopping ===" >&2
  fi
  [ "$rc" -eq 0 ] || exit "$rc"
done
echo "=== $(date '+%F %T') all done ==="
