#!/usr/bin/env bash
# forensic-chain.sh — wait for a quiet machine (no retrieval run / queue), stop OUR ss-* daemons, then:
# pull → stage → sweep → plan → index the r3-hard B repos (r3/repos-b.json; waits up to 3 h for it) →
# claudecode → codex → opencode legs. Indexing sits before the agent legs: the indexer (GPU) and ss-*
# daemons (ORT CPU) must never coexist; pull/stage/sweep load no search models.
set -uo pipefail
WT=/Users/admin/Projects/sweet-search-final-tuning; MAIN=/Users/admin/Projects/sweet-search-private
L="$HOME/.ss-eval/final-tuning-logs"; S="$WT/core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh"
RB="$WT/core/prompt-optimization/data/final-tuning/r3/repos-b.json"
stop_ours() { for pid in $(pgrep -f "sweet-search-daemon|sweet-search-maintainer"); do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  case "$cwd" in "$HOME/.ss-eval/r282-repos/"*|"$WT"*|"$HOME/.ss-eval/"*) kill "$pid" 2>/dev/null;; esac; done; }
(
  while pgrep -f "retrieval-bench-282.mjs|queue.sh" >/dev/null; do sleep 30; done; sleep 30
  stop_ours; sleep 10
  cd "$WT"
  for step in pull stage sweep plan; do
    echo "$(date '+%F %T') START $step" >> "$L/forensic-chain.log"
    bash "$S" "$step" > "$L/forensic-$step.log" 2>&1; rc=$?
    echo "$(date '+%F %T') END $step rc=$rc" >> "$L/forensic-chain.log"
  done
  # index r3-hard B repos (one at a time, standard flags) once they are cloned
  for i in $(seq 1 180); do [ -f "$RB" ] && break; sleep 60; done
  if [ -f "$RB" ]; then
    stop_ours; sleep 5
    for r in $(node -e "for (const x of require('$RB')) console.log(x.repo)"); do
      D="$MAIN/eval/repos/r3-$r"; echo "$(date '+%F %T') START index $r" >> "$L/forensic-chain.log"
      ( cd "$D" && SWEET_SEARCH_PROJECT_ROOT="$D" node "$MAIN/core/indexing/index-codebase-v21.js" --full --verbose --concurrency=1 --sqlite-fast > "$L/index-r3b-$r.log" 2>&1 )
      echo "$(date '+%F %T') END index $r rc=$? $(grep -m1 -o 'INDEXING COMPLETE.*' "$L/index-r3b-$r.log")" >> "$L/forensic-chain.log"
    done
    stop_ours
  else echo "$(date '+%F %T') repos-b.json never appeared — indexing skipped" >> "$L/forensic-chain.log"; fi
  for step in claudecode codex opencode; do
    echo "$(date '+%F %T') START $step" >> "$L/forensic-chain.log"
    bash "$S" "$step" > "$L/forensic-$step.log" 2>&1; rc=$?
    echo "$(date '+%F %T') END $step rc=$rc" >> "$L/forensic-chain.log"
  done
) > /dev/null 2>&1 &
disown
echo "forensic chain (with r3-hard B indexing) armed → $L/forensic-chain.log"
