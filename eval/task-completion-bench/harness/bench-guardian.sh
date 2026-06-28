#!/usr/bin/env bash
# bench-guardian — runs ALONGSIDE a full bench. Every INTERVAL:
#  (1) reap ORPHAN ss-* servers/maintainers whose per-run rundir is GONE (run finished,
#      server lingered). SAFE: a live run's rundir still exists, so it is never killed;
#      golden-scoped servers (root under /golden) are never killed either.
#  (2) disk guard: prune DANGLING images always when low (safe), and unused TAGGED
#      images (-af) ONLY when eval.py is NOT running — so we never nuke an image
#      mid-grade (which would cause an eval.py re-pull/thrash loop).
#  (3) heartbeat: RAM avail + disk free + ss-proc count + image count + eval.py state.
# Exits when run-pilot is gone. DRY=1 → log only, kill/prune nothing (for validation).
set -uo pipefail
LOG=/root/bench-guardian.log
INTERVAL="${INTERVAL:-120}"
DISK_THRESH_GB="${DISK_THRESH_GB:-15}"
RUNS_DIR=/root/.ss-eval/runs
DRY="${DRY:-0}"
log(){ echo "[guardian $(date +%H:%M:%S)] $*" >> "$LOG"; }
log "started (interval=${INTERVAL}s disk-thresh=${DISK_THRESH_GB}G dry=${DRY})"
guard_once(){
  local reaped=0 pid root
  for pid in $(pgrep -f "search-server|index-maintainer|cli.js --serve" 2>/dev/null); do
    root=$(tr "\0" "\n" < /proc/$pid/environ 2>/dev/null | sed -n "s/^SWEET_SEARCH_PROJECT_ROOT=//p" | head -1)
    if [ -n "$root" ] && [[ "$root" == "$RUNS_DIR"/* ]] && [ ! -d "$root" ]; then
      if [ "$DRY" = "1" ]; then log "WOULD reap orphan pid=$pid root=$root"; else kill -9 "$pid" 2>/dev/null && reaped=$((reaped+1)); fi
    fi
  done
  [ "$reaped" -gt 0 ] && log "reaped $reaped orphan ss procs"
  local freeg; freeg=$(df -BG --output=avail / | tail -1 | tr -dc "0-9")
  local grading="no"; pgrep -f "scripts/eval.py" >/dev/null 2>&1 && grading="yes"
  if [ "${freeg:-99}" -lt "$DISK_THRESH_GB" ]; then
    log "disk low (${freeg}G) -> prune dangling"
    [ "$DRY" = "1" ] || docker image prune -f >/dev/null 2>&1
    if [ "$grading" = "no" ]; then
      log "  eval.py idle -> prune -af (unused tagged)"
      [ "$DRY" = "1" ] || docker image prune -af >/dev/null 2>&1
    else
      log "  eval.py RUNNING -> SKIP -af (grading images protected)"
    fi
  fi
  log "RAM avail $(free -g | awk "/Mem:/{print \$7}")G | disk free ${freeg}G | ss-procs $(pgrep -fc "search-server|index-maintainer" || echo 0) | images $(docker images -q | wc -l) | grading=${grading}"
}
if [ "$DRY" = "1" ]; then guard_once; log "DRY single-pass done"; exit 0; fi
while pgrep -f run-pilot.mjs >/dev/null 2>&1; do guard_once; sleep "$INTERVAL"; done
log "run-pilot gone — guardian exiting"
