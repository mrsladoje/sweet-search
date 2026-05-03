#!/usr/bin/env bash
# Run graph-2hop tracer once per repo to avoid embedding model
# state corruption that surfaces when we re-init across repos.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
TRACER="$ROOT/eval/miss-analysis/trace_graph2hop_misses.js"
LOG="$ROOT/eval/miss-analysis/_graph_post.log"
: > "$LOG"

# Disable cascade unless caller already exported it. Default-on for this run
# because we explicitly re-indexed and want to test it.
export SWEET_SEARCH_CASCADE_ENABLED=${SWEET_SEARCH_CASCADE_ENABLED:-true}

PARTS=()
for repo in fastify flask ripgrep; do
  echo "" >> "$LOG"
  echo "=== $repo ===" >> "$LOG"
  date >> "$LOG"
  PART_OUT="$ROOT/eval/miss-analysis/_graph_${repo}.jsonl"
  PART_RAW="$ROOT/eval/miss-analysis/_graph_${repo}.json"
  node "$TRACER" $TRACER_FLAGS --repos="$repo" \
       --out="$PART_OUT" --raw="$PART_RAW" >> "$LOG" 2>&1
  PARTS+=("$PART_RAW")
done

# Merge per-repo outputs into the canonical artifact paths.
node -e '
const fs = require("fs");
const parts = process.argv.slice(1);
const all = [];
const meta = { generatedAt: new Date().toISOString(), parts: [] };
let bucketCounts = {};
let repoBucketCounts = {};
let total = 0, rescue = 0, harm = 0;
for (const p of parts) {
  const d = JSON.parse(fs.readFileSync(p, "utf-8"));
  meta.parts.push({ path: p, count: d.records.length });
  for (const r of d.records) {
    all.push(r);
    if (r.error_none || r.error_expand) continue;
    bucketCounts[r.bucket] = (bucketCounts[r.bucket] || 0) + 1;
    repoBucketCounts[r.repo] = repoBucketCounts[r.repo] || {};
    repoBucketCounts[r.repo][r.bucket] = (repoBucketCounts[r.repo][r.bucket] || 0) + 1;
    total++;
    if (r.rescue) rescue++;
    if (r.harm) harm++;
  }
}
meta.options = parts.length ? JSON.parse(fs.readFileSync(parts[0], "utf-8")).meta?.options : null;
meta.total = total;
meta.bucketCounts = bucketCounts;
meta.repoBucketCounts = repoBucketCounts;
meta.rescue = rescue;
meta.harm = harm;
const outRaw = process.env.MERGE_RAW;
const outJsonl = process.env.MERGE_JSONL;
fs.writeFileSync(outRaw, JSON.stringify({ meta, records: all }, null, 2));
fs.writeFileSync(outJsonl, all.map(r => JSON.stringify(r)).join("\n") + "\n");
console.log(`merged ${all.length} records (rescue=${rescue}, harm=${harm}) → ${outRaw}`);
for (const [b, n] of Object.entries(bucketCounts).sort((a,b) => b[1]-a[1])) console.log(`  ${b.padEnd(50)} ${n}`);
' "${PARTS[@]}"

echo "" >> "$LOG"
echo "Finished: $(date)" >> "$LOG"
