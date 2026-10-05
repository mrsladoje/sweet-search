#!/usr/bin/env bash
# ramp.sh — find the fastest bench concurrency before a long run, without touching the run's own rows.
#
#   bash ramp.sh <conc> [minutes]     one level: codex (native+sweet, interleaved) and Claude Code (sweet)
#                                     side by side at --conc <conc>, for <minutes> (default 12), then stop
#   node ramp-report.mjs              throughput, cache share and errors per level (aggregates only)
#
# Each level has its own tag (ho1005-ramp-c<conc>): its own clones, warm-up and first wave, so the levels
# do not share cache state. The rows are DISCARDED after the decision (never pooled with the run).
# Same fixed question subset at every level (RAMP_N, default 60, seed-42 shuffle of the question file).
# SWEET_SEARCH_MAX_DAEMONS = 2 × conc + 4: one daemon per active repo per cell, so the cap never evicts.
set -uo pipefail
. "$(dirname "$0")/config.sh"
CONC="${1:?usage: ramp.sh <conc> [minutes]}"; MIN="${2:-12}"
TAG="ho1005-ramp-c$CONC"
RSTATE="$FR_STATE/ramp"; mkdir -p "$RSTATE"
IDS=$(node -e '
  const q = require(process.argv[1]).probes.map(p => p.id).sort();
  let a = 42 >>> 0; const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  console.log(q.slice(0, Number(process.argv[2])).join(","));' "$QUESTIONS" "${RAMP_N:-60}")
ENV="$FR_COMMON_ENV SWEET_SEARCH_MAX_DAEMONS=$((2 * CONC + 4))"
log() { echo "$(date '+%F %T') [ramp c$CONC] $*" | tee -a "$RSTATE/ramp.log"; }
bench() { # <cell> <arms> [extra...]
  local cell=$1 arms=$2; shift 2
  ( cd "$FINAL_ROOT" && env $ENV CELL="$cell" node scripts/retrieval-bench-282.mjs --conc "$CONC" \
      --probes "$QUESTIONS" --ids "$IDS" --arms "$arms" --after-repos "$AFTER_COPY" \
      --index-stamps "$FR_STATE/index-stamps" --require-index-stamp --tag "$TAG" "$@" ) > "$RSTATE/$cell-c$CONC.log" 2>&1
}
sample() { # load + free memory every 30 s
  while :; do
    printf '%s load %s free_gb %s daemons %s\n' "$(date +%s)" "$(sysctl -n vm.loadavg | awk '{print $2}')" \
      "$(vm_stat | awk '/Pages free|Pages inactive|Pages speculative/ {gsub(/\./,"",$NF); s+=$NF} END {printf "%.1f", s*16384/1e9}')" \
      "$(pgrep -f sweet-search-daemon | wc -l | tr -d ' ')" >> "$RSTATE/sys-c$CONC.log"
    sleep 30
  done
}
log "start: $MIN min, ids $(echo "$IDS" | tr ',' '\n' | wc -l | tr -d ' '), daemons cap $((2 * CONC + 4))"
date +%s > "$RSTATE/start-c$CONC"
sample & SP=$!
bench codex-sol61-high native,sweet --interleave & P1=$!
bench cc-opus55-medium sweet & P2=$!
sleep $((MIN * 60))
date +%s > "$RSTATE/stop-c$CONC"
kill "$SP" 2>/dev/null
pkill -TERM -f "retrieval-bench-282.mjs.*--tag $TAG" 2>/dev/null   # the bench reaps its daemons on SIGTERM
wait "$P1" "$P2" 2>/dev/null
( cd "$FINAL_ROOT" && node --input-type=module -e '
  const { reapRoots } = await import(process.cwd() + "/eval/task-completion-bench/harness/spawn-ledger-reap.mjs");
  const roots = process.argv.slice(1);
  const k = await reapRoots({ ledgerDir: null, roots });
  if (k.length) console.log(`reaped ${k.length}`);' "$HOME/.ss-eval/r282-repos/codex-sol61-high-$TAG" "$HOME/.ss-eval/r282-repos/cc-opus55-medium-$TAG" ) 2>&1 | tee -a "$RSTATE/ramp.log"
log "stopped"
