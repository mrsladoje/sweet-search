#!/bin/bash
# watchdog.sh (cron, every 5 minutes; installed by bootstrap.sh): if no benchmark or build process ran and
# no SSH session was open for IDLE_MIN minutes (default 60), upload run.log and shut the machine down
# (terminate behaviour). It bounds paid idle time in every run.sh mode, "hold" included.
set -u
IDLE_MIN=${IDLE_MIN:-60}
STAMP=/var/run/hnsw-idle-since
BUSY='run\.py|rivals5|py5\.py|ours5\.mjs|build_ours\.mjs|build_sched\.py|run\.sh|bootstrap\.sh|test_harness|cargo|rustc|napi|npm|uv pip|cmake|make -j|cc1plus|embed\.py'
if pgrep -f "$BUSY" > /dev/null || who | grep -q -E 'pts/'; then rm -f "$STAMP"; exit 0; fi
[ -f "$STAMP" ] || date +%s > "$STAMP"
IDLE=$(( ($(date +%s) - $(cat "$STAMP")) / 60 ))
if [ "$IDLE" -ge "$IDLE_MIN" ]; then
  OUT=${RESULTS:-/opt/hnsw-results}/$MACHINE
  mkdir -p "$OUT"
  echo "$(date -u +%FT%TZ) watchdog: idle $IDLE min, shutdown" >> "$OUT/run.log"
  aws s3 cp --only-show-errors "$OUT/run.log" "s3://$BUCKET/hnsw/results/$MACHINE/run.log" || true
  aws s3 cp --only-show-errors /var/log/hnsw-bootstrap.log "s3://$BUCKET/hnsw/results/$MACHINE/bootstrap.log" || true
  shutdown -h now
fi
