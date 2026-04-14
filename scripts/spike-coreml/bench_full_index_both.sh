#!/usr/bin/env bash
# Run scripts/benchmark-full-index.js with both backends, sequentially, in
# fresh node processes. Captures wall-clock for the candle baseline vs the
# coreml-bridge run. Logs to /tmp/bench_*.log so they survive the parent shell.
set -e

cd /Users/admin/Projects/sweet-search-private

echo "================================================================"
echo "  CANDLE BASELINE (current Metal BF16 path)"
echo "================================================================"
echo "Started: $(date -u +%FT%TZ)"
T0_CANDLE=$(date +%s)
unset SWEET_SEARCH_INFERENCE_BACKEND
node scripts/benchmark-full-index.js --label candle-baseline 2>&1 | tee /tmp/bench_candle.log
T1_CANDLE=$(date +%s)
echo
echo "  CANDLE total wall: $((T1_CANDLE - T0_CANDLE))s"
echo

# Brief cooldown
sleep 5

echo "================================================================"
echo "  COREML SPIKE BRIDGE"
echo "================================================================"
echo "Started: $(date -u +%FT%TZ)"
T0_CRML=$(date +%s)
SWEET_SEARCH_INFERENCE_BACKEND=coreml node scripts/benchmark-full-index.js --label coreml-spike 2>&1 | tee /tmp/bench_coreml.log
T1_CRML=$(date +%s)
echo
echo "  COREML total wall: $((T1_CRML - T0_CRML))s"
echo

echo "================================================================"
echo "  SUMMARY"
echo "================================================================"
echo "  candle baseline: $((T1_CANDLE - T0_CANDLE))s"
echo "  coreml spike   : $((T1_CRML - T0_CRML))s"
DIFF=$((T1_CANDLE - T0_CANDLE - (T1_CRML - T0_CRML)))
if [ $DIFF -gt 0 ]; then
  echo "  coreml saved   : ${DIFF}s ($(awk "BEGIN{printf \"%.1f\", $DIFF*100/(${T1_CANDLE}-${T0_CANDLE})}")%)"
else
  ABS=$((-DIFF))
  echo "  coreml SLOWER by: ${ABS}s"
fi
