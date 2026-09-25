#!/usr/bin/env bash
# Night A/B queue: runs smoke cells ONE AT A TIME (one run-pilot per machine) from a queue file,
# so cells can be appended while it runs. Queue line format (| separated):
#   <cell-id>|<env assignments, space separated, may be empty>|<harness>|<trim value>
# e.g.  oc-maxtodo-screen|LEGS=trim|opencode|max-todo
# Status goes to <queue>.status (one "<cell-id> <state> <time>" per line). Touch <queue>.stop to
# stop after the current cell.
set -u
Q=${1:?usage: night-queue.sh <queue-file>}
ST=$Q.status
REPO=/Users/admin/Projects/sweet-search-private
SMOKE=$REPO/eval/task-completion-bench/handoffs/improve/harness-prompt-trim/scripts/mac-smoke.sh
touch "$ST"
while [ ! -f "$Q.stop" ]; do
  NEXT=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue; case "$line" in \#*) continue ;; esac
    id=${line%%|*}
    grep -q "^$id " "$ST" || { NEXT=$line; break; }
  done < "$Q"
  if [ -z "$NEXT" ]; then sleep 60; continue; fi
  # Never overlap another smoke (e.g. a chain started outside the queue).
  while pgrep -f "harness/run-pilo[t].mjs" >/dev/null || pgrep -f "mac-smok[e].sh" >/dev/null; do sleep 60; done
  IFS='|' read -r id envs h on <<< "$NEXT"
  echo "$id running $(date +%FT%T)" >> "$ST"
  ( cd "$REPO" && env $envs caffeinate -ims bash "$SMOKE" "$h" "$on" ) > "$REPO/eval/task-completion-bench/results/night-$id.log" 2>&1
  echo "$id done rc=$? $(date +%FT%T)" >> "$ST"
done
echo "queue stopped $(date +%FT%T)" >> "$ST"
