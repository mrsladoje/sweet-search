#!/usr/bin/env bash
# Codex incremental-indexing v2 validation — 4 tools × 2 repos (scala, go) on dev probes only.
# Per-tool runner output goes to JSONL; per-tool log file is captured next to this script.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG_DIR=".sweet-search/codex-validation/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"
echo "logs -> $LOG_DIR"

run() {
  local label=$1; shift
  echo "=== $label ==="
  echo "cmd: $*"
  local out="$LOG_DIR/$label.log"
  { time "$@"; } > "$out" 2>&1
  local rc=$?
  echo "rc=$rc  log=$out"
  tail -3 "$out" || true
  echo
}

# ss-search: full per-lang sweep (5 dev + 3 heldout probes per lang; we'll filter dev in aggregation)
run "ss-search-scala" node core/prompt-optimization/scripts/track-a-runner.mjs --lang=scala --no-log
run "ss-search-go"    node core/prompt-optimization/scripts/track-a-runner.mjs --lang=go    --no-log

# ss-find: R2|Q3 only (locked baseline cell per project_ssfind_phase6_v2 memory) — 1 combo × probes per lang
run "ss-find-scala"   node core/prompt-optimization/scripts/ss-find/track-a-runner-ss-find.mjs --lang=scala --r-cell=R2 --q-cell=Q3 --no-log
run "ss-find-go"      node core/prompt-optimization/scripts/ss-find/track-a-runner-ss-find.mjs --lang=go    --r-cell=R2 --q-cell=Q3 --no-log

# ss-semantic: full per-lang sweep
run "ss-semantic-scala" node core/prompt-optimization/scripts/ss-semantic/track-a-runner-ss-semantic.mjs --lang=scala --no-log
run "ss-semantic-go"    node core/prompt-optimization/scripts/ss-semantic/track-a-runner-ss-semantic.mjs --lang=go    --no-log

# ss-trace: split=dev (probes file already segregates by split); no --lang flag — filter in aggregation
run "ss-trace-dev"    node core/prompt-optimization/scripts/ss-trace/track-a-runner-ss-trace.mjs --split=dev

echo "all probe runs complete"
echo "logs in $LOG_DIR"
