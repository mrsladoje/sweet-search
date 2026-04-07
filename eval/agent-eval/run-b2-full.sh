#!/usr/bin/env bash
# Run full Track B2 evaluation for a repo.
# Starts a warm server for the repo, runs all 3 systems, judges, then reports.
#
# Usage: ./eval/agent-eval/run-b2-full.sh fastify [--max-questions=10]

set -e

REPO=${1:-fastify}
EXTRA_ARGS="${@:2}"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REPO_ROOT="$ROOT/eval/repos/$REPO"
PORT=9877  # Use non-default port to avoid conflict with main project server

if [ ! -d "$REPO_ROOT/.sweet-search" ]; then
  echo "Error: No index at $REPO_ROOT/.sweet-search"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Track B2: Full evaluation for $REPO"
echo "  Port: $PORT"
echo "═══════════════════════════════════════════════════════════════"

# Stop any existing server on this port
curl -s "http://localhost:$PORT/stop" >/dev/null 2>&1 || true
sleep 1

# Generate questions if needed
if [ ! -f "$ROOT/eval/agent-eval/questions/$REPO.jsonl" ]; then
  echo "  Generating questions..."
  node "$ROOT/eval/agent-eval/run-agent-eval.js" --generate-questions --repo="$REPO"
fi

# Start warm server for the repo on the eval port
echo "  Starting warm server for $REPO on port $PORT..."
SWEET_SEARCH_PROJECT_ROOT="$REPO_ROOT" \
SEARCH_SERVER_PORT="$PORT" \
  node "$ROOT/core/search/search-server.js" &
SERVER_PID=$!

# Wait for server readiness (poll health endpoint)
echo -n "  Waiting for server"
for i in $(seq 1 60); do
  if curl -s "http://localhost:$PORT/health" 2>/dev/null | grep -q '"ready"'; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 2
done

# Verify
if ! curl -s "http://localhost:$PORT/health" | grep -q '"ready"'; then
  echo " FAILED — server did not start"
  kill $SERVER_PID 2>/dev/null || true
  exit 1
fi

# Quick smoke test: verify search returns results
echo "  Smoke test..."
SMOKE=$(curl -s "http://localhost:$PORT/search?q=test&k=1" 2>/dev/null)
if echo "$SMOKE" | grep -q '"results"'; then
  echo "  ✓ Search is working"
else
  echo "  ✗ Search returned no results — check index"
fi

# Run all 3 systems
export SEARCH_HELPER_PORT=$PORT
cd "$ROOT"
for SYSTEM in rg+read pattern+meta pattern+agent; do
  echo ""
  echo "  ─── Running $SYSTEM ───"
  node "$ROOT/eval/agent-eval/run-agent-eval.js" \
    --run --system="$SYSTEM" --repo="$REPO" --cli $EXTRA_ARGS || true
done

# Judge
echo ""
echo "  ─── Judging ───"
node "$ROOT/eval/agent-eval/run-agent-eval.js" --judge --repo="$REPO" || true

# Stop server
echo ""
echo "  Stopping warm server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# Report
echo ""
node "$ROOT/eval/agent-eval/run-agent-eval.js" --report --repo="$REPO"
