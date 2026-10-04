#!/usr/bin/env bash
# index-r3.sh — index the r3 repos ONE AT A TIME with the standard flags, from the MAIN checkout's
# indexer (= 2.8.2, the same engine as the r282 indexes). Waits until no retrieval bench runs (the
# indexer swaps ORT CPU ↔ GPU models; never coexist). Reaps leaked maintainers between repos.
set -uo pipefail
MAIN=/Users/admin/Projects/sweet-search-private
L="$HOME/.ss-eval/final-tuning-logs"; mkdir -p "$L"
REPOS=(${R3_REPOS:-jj dgraph tortoise-orm typedoc zipkin ocelot})
(
  while pgrep -f "retrieval-bench-282.mjs|queue.sh" >/dev/null; do sleep 20; done; sleep 30
  # stop the ss-* daemons / maintainers OUR bench runs started (cwd under ~/.ss-eval/r282-repos) so
  # no ORT CPU model is resident while the indexer loads GPU models (memory: no-model-coexist).
  for pid in $(pgrep -f "sweet-search-daemon|sweet-search-maintainer"); do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    case "$cwd" in "$HOME/.ss-eval/r282-repos/"*|/Users/admin/Projects/sweet-search-final-tuning*) kill "$pid" 2>/dev/null && echo "$(date '+%F %T') stopped $pid ($cwd)" >> "$L/index-r3.log";; esac
  done
  sleep 5
  for r in "${REPOS[@]}"; do
    D="$MAIN/eval/repos/r3-$r"
    echo "$(date '+%F %T') START $r ($D)" >> "$L/index-r3.log"
    ( cd "$D" && SWEET_SEARCH_PROJECT_ROOT="$D" node "$MAIN/core/indexing/index-codebase-v21.js" --full --verbose --concurrency=1 --sqlite-fast > "$L/index-r3-$r.log" 2>&1 )
    rc=$?
    echo "$(date '+%F %T') END $r exit=$rc $(grep -m1 -o 'INDEXING COMPLETE.*' "$L/index-r3-$r.log")" >> "$L/index-r3.log"
    # Frozen benchmark index: no maintainer may ever change it (launchers start none for a paused index).
    node "$MAIN/core/cli.js" reconcile pause --project-root "$D" --reason "frozen benchmark index" >> "$L/index-r3.log" 2>&1
    pkill -f "sweet-search-maintainer.*r3-$r" 2>/dev/null
  done
  echo "$(date '+%F %T') ALL DONE" >> "$L/index-r3.log"
) > /dev/null 2>&1 &
disown
echo "index-r3 queued (${REPOS[*]}) → $L/index-r3.log"
