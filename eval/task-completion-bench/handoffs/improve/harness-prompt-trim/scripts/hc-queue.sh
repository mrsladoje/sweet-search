#!/usr/bin/env bash
# Hill-climb queue: runs batch-smoke.sh cells ONE AT A TIME from a queue file that may grow
# while it runs. Line format (| separated, # = comment):
#   <cell-id>|<harness>|<variants, space separated>|<tasks, comma separated or empty = default 4>
# Every cell runs with both validity fixes on and the fixed ledger. Status: <queue>.status.
# Touch <queue>.stop to stop after the current cell.
set -u
Q=${1:?usage: hc-queue.sh <queue-file>}
ST=$Q.status
BENCH=/Users/admin/Projects/sweet-search-private/eval/task-completion-bench
SMOKE=$BENCH/handoffs/improve/harness-prompt-trim/scripts/hc-smoke.sh
touch "$ST"
export BENCH_INCLUDE_UNTRACKED=1 RT_ATTACH_REQUIRE_SAME_DIFF=1 SMOKE_LEDGER=$BENCH/results/bsmoke-ledger-fix2/ledger.jsonl
busy() {
  pgrep -f "harness/run-pilo[t].mjs" >/dev/null || pgrep -f "batch-smok[e].sh|hc-smok[e].sh" >/dev/null \
    || pgrep -f "scratchpad/round[0-9][a-z]*\.s[h]" >/dev/null || pgrep -f "env-ledger-swee[p].mjs" >/dev/null
}
while [ ! -f "$Q.stop" ]; do
  NEXT=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue; case "$line" in \#*) continue ;; esac
    id=${line%%|*}
    grep -q "^$id " "$ST" || { NEXT=$line; break; }
  done < "$Q"
  if [ -z "$NEXT" ] || busy; then sleep 30; continue; fi
  IFS='|' read -r id h variants tasks <<< "$NEXT"
  echo "$id running $(date +%FT%T)" >> "$ST"
  ( cd "$BENCH" && env VARIANTS="$variants" ${tasks:+SMOKE_TASKS=$tasks} bash "$SMOKE" "$h" ) > "$BENCH/results/hc-$id.log" 2>&1
  echo "$id done rc=$? $(date +%FT%T) runs=$(grep -o 'runs: .*' "$BENCH/results/hc-$id.log" | tail -1 | cut -c7-)" >> "$ST"
done
echo "queue stopped $(date +%FT%T)" >> "$ST"
