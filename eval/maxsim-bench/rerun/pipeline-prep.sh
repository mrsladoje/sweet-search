#!/bin/bash
# Usage: rerun/pipeline-prep.sh <engine tree> <out dir>    (macOS, APFS)
#
# Prepares the bench repositories for rerun/pipeline.mjs. The indexes in eval/repos/r3-* are in the
# binary-HNSW format from before commit de66e593 (JSON sidecars); the frozen engine reads only the
# format-3 index file, so its ss-search falls back to a vector scan that fails. For each repository
# this script makes an APFS clone (copy-on-write: the originals are never written) and rewrites its
# binary-HNSW index in format 3 with eval/benchmarks/hnsw-rivals/convert-v3.mjs, which keeps the
# same graph, codes and int8 rows (no re-embedding). The converter hard-links codebase.db from the
# original; those links are replaced by clones, so no file is shared with the original repository.
# The full-vector file of the new format is not built (that needs a full rebuild), so the engine's
# final full-vector rescore of the HNSW candidates is off in these copies.
set -euo pipefail
ENGINE=$1; OUT=$2
SRC=$(cd "$(dirname "$0")/../../.." && pwd)
OLD=$OUT/.engine-pre-format3
mkdir -p "$OUT" "$OLD"
if [ ! -d "$OLD/core" ]; then
  (cd "$SRC" && git archive de66e593^ core package.json | tar -x -C "$OLD")
  ln -sfn "$SRC/node_modules" "$OLD/node_modules"
fi
for r in composer dgraph drogon grdb jj ocelot okhttp sequel tortoise-orm typedoc zipkin; do
  orig=$SRC/eval/repos/r3-$r; dst=$OUT/r3-$r
  rm -rf "$dst"; cp -cR "$orig" "$dst"
  rm -f "$dst/.sweet-search/codebase-binary-hnsw.idx"
  (cd "$orig" && SWEET_SEARCH_PROJECT_ROOT=$orig node "$SRC/eval/benchmarks/hnsw-rivals/convert-v3.mjs" "$OLD" "$ENGINE" "$orig" "$dst" 2>/dev/null | tail -1)
  for f in codebase.db codebase-binary-hnsw.fullvec.bin codebase-binary-hnsw.fullvec.map codebase-binary-hnsw.idx.stale.bin; do
    p=$dst/.sweet-search/$f
    if [ -e "$p" ] && [ "$(stat -f %l "$p")" -gt 1 ]; then rm "$p"; cp -c "$orig/.sweet-search/$f" "$p"; fi
  done
done
echo "prepared $OUT"
