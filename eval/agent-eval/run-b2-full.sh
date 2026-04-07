#!/usr/bin/env bash
# Run full Track B2 evaluation for a repo.
# Starts a warm server for the repo, runs all 3 systems, then reports.
#
# Usage: ./eval/agent-eval/run-b2-full.sh fastify [--max-questions=10]

set -e

REPO=${1:-fastify}
EXTRA_ARGS="${@:2}"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REPO_ROOT="$ROOT/eval/repos/$REPO"

if [ ! -d "$REPO_ROOT/.sweet-search" ]; then
  echo "Error: No index at $REPO_ROOT/.sweet-search"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Track B2: Full evaluation for $REPO"
echo "═══════════════════════════════════════════════════════════════"

# Generate questions if needed
if [ ! -f "$ROOT/eval/agent-eval/questions/$REPO.jsonl" ]; then
  echo "  Generating questions..."
  node "$ROOT/eval/agent-eval/run-agent-eval.js" --generate-questions --repo="$REPO"
fi

# Start warm server for the repo
echo "  Starting warm server for $REPO..."
export SWEET_SEARCH_PROJECT_ROOT="$REPO_ROOT"
cd "$REPO_ROOT"
node "$ROOT/core/search/search-server.js" &
SERVER_PID=$!
sleep 3  # Wait for server to initialize

# Verify server is up
if ! curl -s http://localhost:9876/health | grep -q '"status"'; then
  echo "  Waiting for server initialization..."
  sleep 10
fi

echo "  Server running (PID: $SERVER_PID)"

# Run all 3 systems
cd "$ROOT"
for SYSTEM in rg+read pattern+meta pattern+agent; do
  echo ""
  echo "  ─── Running $SYSTEM ───"
  node "$ROOT/eval/agent-eval/run-agent-eval.js" \
    --run --system="$SYSTEM" --repo="$REPO" --cli $EXTRA_ARGS || true
done

# Stop server
echo ""
echo "  Stopping warm server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# Report
echo ""
node "$ROOT/eval/agent-eval/run-agent-eval.js" --report --repo="$REPO"
