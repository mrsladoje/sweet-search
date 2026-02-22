#!/bin/bash
# Session Preheat - thin wrapper
#
# Responsibilities:
# 1) session lock + stale slug cleanup
# 2) start warm server when needed
# 3) delegate warmup logic to core/session-warmup.js
# 4) start index maintainer daemon

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SEARCH_DIR="${SWEET_SEARCH_DIR:-$PROJECT_ROOT}"
if [ ! -f "$SEARCH_DIR/core/sweet-search.js" ]; then
  SEARCH_DIR="$PROJECT_ROOT"
fi

LOG_FILE="/tmp/sweet-search-preheat.log"
LOCK_FILE="/tmp/sweet-search-preheat.lock"
LOCK_TTL_SEC=86400

SESSION_SLUG_PREFIX="/tmp/claude-session-slug"
SESSION_SLUG_TTL_SEC=14400

is_server_healthy() {
  curl -s --max-time 1 "http://localhost:9876/health" >/dev/null 2>&1
}

cleanup_stale_session_slugs() {
  local now
  now=$(date +%s)

  if [ -f "$SESSION_SLUG_PREFIX" ]; then
    local age
    age=$((now - $(stat -c %Y "$SESSION_SLUG_PREFIX" 2>/dev/null || echo 0)))
    if [ "$age" -gt "$SESSION_SLUG_TTL_SEC" ]; then
      rm -f "$SESSION_SLUG_PREFIX"
    fi
  fi

  for slug_file in "${SESSION_SLUG_PREFIX}".*; do
    [ -f "$slug_file" ] || continue
    local age
    age=$((now - $(stat -c %Y "$slug_file" 2>/dev/null || echo 0)))
    if [ "$age" -gt "$SESSION_SLUG_TTL_SEC" ]; then
      rm -f "$slug_file"
    fi
  done
}

start_server_if_needed() {
  if is_server_healthy; then
    echo "[$(date '+%H:%M:%S')] Warm server already running" >> "$LOG_FILE"
    return 0
  fi

  echo "[$(date '+%H:%M:%S')] Starting warm server..." >> "$LOG_FILE"
  node "$SEARCH_DIR/core/sweet-search.js" --serve >/dev/null 2>&1 &
}

warm_unix_socket_if_present() {
  local socket="/tmp/sweet-search.sock"
  [ -S "$socket" ] || socket="/tmp/search.sock"

  for i in {1..30}; do
    if [ -S "$socket" ]; then
      curl -s --unix-socket "$socket" "http://l/health" >/dev/null 2>&1 || true
      echo "[$(date '+%H:%M:%S')] Unix socket ready (${i}00ms)" >> "$LOG_FILE"
      return 0
    fi
    sleep 0.1
  done

  return 0
}

start_index_maintainer() {
  local maintainer="$PROJECT_ROOT/.claude/hooks/index-maintainer.mjs"
  local lock_file="/tmp/claude-index-maintainer.lock"

  if [ ! -f "$maintainer" ]; then
    echo "[$(date '+%H:%M:%S')] Index maintainer not found" >> "$LOG_FILE"
    return 0
  fi

  if [ -f "$lock_file" ]; then
    local lock_pid
    lock_pid=$(head -n1 "$lock_file" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      echo "[$(date '+%H:%M:%S')] Index maintainer already running (PID: $lock_pid)" >> "$LOG_FILE"
      return 0
    fi
  fi

  echo "[$(date '+%H:%M:%S')] Starting index maintainer daemon..." >> "$LOG_FILE"
  node "$maintainer" >> "$LOG_FILE" 2>&1 &
  echo $! > /tmp/index-maintainer.pid
  echo "[$(date '+%H:%M:%S')] Index maintainer started (PID: $!)" >> "$LOG_FILE"
}

run_preheat_worker() {
  cd "$PROJECT_ROOT" || exit 1

  echo "[$(date '+%H:%M:%S')] Session preheat starting..." > "$LOG_FILE"
  start_server_if_needed

  # Smart warmup: overlaps server readiness polling with lightweight cache touches.
  node "$SEARCH_DIR/core/session-warmup.js" >> "$LOG_FILE" 2>&1 || true
  warm_unix_socket_if_present
  start_index_maintainer

  echo "[$(date '+%H:%M:%S')] Session preheat complete" >> "$LOG_FILE"
}

if [ "${1:-}" = "--worker" ]; then
  run_preheat_worker
  exit 0
fi

cleanup_stale_session_slugs

if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(($(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0)))
  if [ "$LOCK_AGE" -lt "$LOCK_TTL_SEC" ] && is_server_healthy; then
    exit 0
  fi
fi

touch "$LOCK_FILE"

nohup "$SCRIPT_DIR/session-preheat.sh" --worker >/dev/null 2>&1 &

exit 0
