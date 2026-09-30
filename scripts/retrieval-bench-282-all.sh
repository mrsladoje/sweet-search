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
  CELL="$c" node scripts/retrieval-bench-282.mjs --conc 3 2>&1 | tee -a "$LOG_DIR/$c.log"
done
echo "=== $(date '+%F %T') all done ==="
