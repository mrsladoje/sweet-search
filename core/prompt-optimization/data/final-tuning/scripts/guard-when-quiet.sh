#!/usr/bin/env bash
# guard-when-quiet.sh <GUARD_VAR_VALUE> — wait until no retrieval run / queue is alive, stop OUR ss-* daemons
# (cwd in the worktree or ~/.ss-eval/r282-repos), then launch the task guard (base vs var interleaved).
set -uo pipefail
VAL="${1:-2}"; L="$HOME/.ss-eval/final-tuning-logs"; WT=/Users/admin/Projects/sweet-search-final-tuning
(
  while pgrep -f "retrieval-bench-282.mjs|queue.sh" >/dev/null; do sleep 30; done; sleep 30
  for pid in $(pgrep -f "sweet-search-daemon|sweet-search-maintainer"); do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    case "$cwd" in "$HOME/.ss-eval/r282-repos/"*|"$WT"*) kill "$pid" 2>/dev/null && echo "$(date '+%F %T') stopped $pid ($cwd)" >> "$L/guard-v$VAL.log";; esac
  done
  sleep 10
  cd "$WT" && GUARD_VAR_VALUE="$VAL" GUARD_STAMP="$(date +%Y%m%d-%H%M)-v$VAL" bash core/prompt-optimization/data/final-tuning/scripts/task-guard.sh both >> "$L/guard-v$VAL.log" 2>&1
) > /dev/null 2>&1 &
disown
echo "guard v$VAL waits for a quiet machine → $L/guard-v$VAL.log"
