#!/bin/bash

# Model Comparison Evaluation Script
# Runs the evaluation harness with different reranker configurations
#
# Configurations:
# 1. MiniLM-L6-v2 (local only) - no Voyage API
# 2. TinyBERT-L2-v2 (local only) - no Voyage API
# 3. MiniLM-L6-v2 + Voyage cascade
# 4. TinyBERT-L2-v2 + Voyage cascade

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVAL_DIR="$SCRIPT_DIR/evaluation"
RESULTS_DIR="$SCRIPT_DIR/benchmark-results"

mkdir -p "$RESULTS_DIR"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║     FULL EVALUATION: MiniLM-L6-v2 vs TinyBERT-L2-v2              ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Check for Voyage API key
if [ -n "$VOYAGEAI_API_KEY" ]; then
    echo "✓ Voyage API key found - will test cascade mode"
    HAS_VOYAGE=1
else
    echo "⚠ No VOYAGEAI_API_KEY - skipping cascade tests"
    HAS_VOYAGE=0
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "TEST 1: MiniLM-L6-v2 (local only)"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Disable Voyage for local-only test
VOYAGEAI_API_KEY_BACKUP="$VOYAGEAI_API_KEY"
JINA_API_KEY_BACKUP="$JINA_API_KEY"

unset VOYAGEAI_API_KEY
unset JINA_API_KEY
export FLASHRANK_MODEL="Xenova/ms-marco-MiniLM-L-6-v2"

cd "$EVAL_DIR"
node run-evaluation.js --concurrency=3 --output="$RESULTS_DIR/eval-minilm-local.json" 2>&1 | tee "$RESULTS_DIR/eval-minilm-local.log"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "TEST 2: TinyBERT-L2-v2 (local only)"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

export FLASHRANK_MODEL="Xenova/ms-marco-TinyBERT-L-2-v2"

node run-evaluation.js --concurrency=3 --output="$RESULTS_DIR/eval-tinybert-local.json" 2>&1 | tee "$RESULTS_DIR/eval-tinybert-local.log"

# Restore API keys for cascade tests
export VOYAGEAI_API_KEY="$VOYAGEAI_API_KEY_BACKUP"
export JINA_API_KEY="$JINA_API_KEY_BACKUP"

if [ "$HAS_VOYAGE" = "1" ]; then
    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "TEST 3: MiniLM-L6-v2 + Voyage cascade"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""

    export FLASHRANK_MODEL="Xenova/ms-marco-MiniLM-L-6-v2"

    node run-evaluation.js --concurrency=3 --output="$RESULTS_DIR/eval-minilm-voyage.json" 2>&1 | tee "$RESULTS_DIR/eval-minilm-voyage.log"

    echo ""
    echo "═══════════════════════════════════════════════════════════════════"
    echo "TEST 4: TinyBERT-L2-v2 + Voyage cascade"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""

    export FLASHRANK_MODEL="Xenova/ms-marco-TinyBERT-L-2-v2"

    node run-evaluation.js --concurrency=3 --output="$RESULTS_DIR/eval-tinybert-voyage.json" 2>&1 | tee "$RESULTS_DIR/eval-tinybert-voyage.log"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "RESULTS SUMMARY"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Extract key metrics from results
for result in "$RESULTS_DIR"/eval-*.json; do
    if [ -f "$result" ]; then
        name=$(basename "$result" .json)
        echo "--- $name ---"
        node -e "
const r = require('$result');
console.log('  Success@10:', (r.metrics?.successRate * 100 || r.successRate * 100 || 'N/A').toFixed(1) + '%');
console.log('  MRR@10:', (r.metrics?.mrr || r.mrr || 'N/A').toFixed(3));
console.log('  Avg Latency:', (r.metrics?.avgLatency || r.avgLatency || 'N/A').toFixed(1) + 'ms');
" 2>/dev/null || echo "  (Could not parse results)"
        echo ""
    fi
done

echo "Results saved in: $RESULTS_DIR"
