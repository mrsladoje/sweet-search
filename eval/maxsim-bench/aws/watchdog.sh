#!/bin/bash
# maxsim-watchdog (cron, every 5 minutes; installed by bootstrap.sh)
# If no benchmark or build process ran and no SSH session was open for IDLE_MIN minutes
# (default 60), upload run.log and shut the machine down (terminate behaviour). This bounds
# paid idle time in every run.sh mode, "hold" included.
set -u
IDLE_MIN=${IDLE_MIN:-60}
STAMP=/var/run/maxsim-idle-since
BUSY='bench.py|bench-node.mjs|run_matrix.py|concurrency.py|run.sh|bootstrap.sh|make_sweep.py|beir_prep.py|cargo|rustc|napi|npm|uv pip|contracts.py'
if pgrep -f "$BUSY" > /dev/null || [ -n "$(who | grep -E 'pts/')" ]; then
  rm -f "$STAMP"; exit 0
fi
[ -f "$STAMP" ] || date +%s > "$STAMP"
IDLE=$(( ($(date +%s) - $(cat "$STAMP")) / 60 ))
if [ "$IDLE" -ge "$IDLE_MIN" ]; then
  LOG=/opt/ss/eval/maxsim-bench/results/$MACHINE/run.log
  echo "$(date -u +%FT%TZ) watchdog: idle $IDLE min, shutdown" >> "$LOG"
  aws s3 cp --only-show-errors "$LOG" "s3://$BUCKET/results/$MACHINE/run.log" || true
  aws s3 cp --only-show-errors /var/log/maxsim-bootstrap.log "s3://$BUCKET/results/$MACHINE/bootstrap.log" || true
  shutdown -h now
fi
