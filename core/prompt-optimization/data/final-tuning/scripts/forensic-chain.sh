#!/usr/bin/env bash
# forensic-chain.sh — wait for a quiet machine (no retrieval run / queue), stop OUR ss-* daemons, then run the
# forensic task batch: pull → stage → sweep → plan → claudecode → codex → opencode (one leg at a time).
set -uo pipefail
WT=/Users/admin/Projects/sweet-search-final-tuning; L="$HOME/.ss-eval/final-tuning-logs"; S="$WT/core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh"
(
  while pgrep -f "retrieval-bench-282.mjs|queue.sh" >/dev/null; do sleep 30; done; sleep 30
  for pid in $(pgrep -f "sweet-search-daemon|sweet-search-maintainer"); do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    case "$cwd" in "$HOME/.ss-eval/r282-repos/"*|"$WT"*) kill "$pid" 2>/dev/null;; esac
  done
  until [ "$(pgrep -f 'sweet-search-daemon|sweet-search-maintainer' | wc -l | tr -d ' ')" = "0" ]; do sleep 5; done
  cd "$WT"
  for step in pull stage sweep plan claudecode codex opencode; do
    echo "$(date '+%F %T') START $step" >> "$L/forensic-chain.log"
    bash "$S" "$step" > "$L/forensic-$step.log" 2>&1
    rc=$?; echo "$(date '+%F %T') END $step rc=$rc" >> "$L/forensic-chain.log"
    if [ "$step" = plan ] && [ $rc -ne 0 ]; then echo "plan failed — stop" >> "$L/forensic-chain.log"; exit 1; fi
  done
) > /dev/null 2>&1 &
disown
echo "forensic chain armed → $L/forensic-chain.log"
