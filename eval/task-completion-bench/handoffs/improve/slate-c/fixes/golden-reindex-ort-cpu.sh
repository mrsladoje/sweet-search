#!/bin/bash
# Rebuild the 7 smoke goldens' indexes locally, ORT INT8 CPU forced for backend parity
# with the 13 box-built goldens the smoke reuses. Serial: one repo at a time (indexer discipline).
set -u
REPO=/Users/admin/Projects/sweet-search-private
SP="$(dirname "$0")"
GOLDEN="$HOME/.ss-eval/golden"
# smallest first, so a broken path shows up in minutes not hours
ORDER=(
  "jensneuse__graphql-go-tools@f8c0c76c325e332b01db202c1b03b1d1275fda5b"
  "JoshuaKGoldberg__bingo@688cf8d3c39389125fcc13b2c8d8e5008d52c151"
  "squashql__squashql@5e866a8e82fa8b04603bc536c3bad67ae8c2a40d"
  "firebase__firebase-tools@a37e0a97d78d3c9439ab6af5ba0222d5bf944a84"
  "maxGraph__maxGraph@7d1644bb72e98e087d4f2b9210ceb6cd62129f36"
  "gleam-lang__gleam@65c2efb56bac46ebc56f6ba383ad9c34e4b0bd38"
  "projectlombok__lombok@8bea25107de8177596546574c02ed204366e1281"
)
echo "START $(date -u +%FT%TZ)"
for k in "${ORDER[@]}"; do
  g="$GOLDEN/$k"
  t0=$(date +%s)
  echo "=== INDEX $k  $(date -u +%FT%TZ)"
  rm -rf "$g/.sweet-search"
  SWEET_SEARCH_PROJECT_ROOT="$g" \
  SWEET_SEARCH_RECONCILE_V2=0 \
  SWEET_SEARCH_WATCH=0 \
  SWEET_SEARCH_NATIVE_INFERENCE=0 \
  SWEET_SEARCH_COREML_CASCADE=0 \
    node "$REPO/core/indexing/index-codebase-v21.js" --full --sqlite-fast --concurrency=1 --verbose \
    > "$SP/idxlog/$k.log" 2>&1
  rc=$?
  t1=$(date +%s)
  if [ $rc -ne 0 ] || [ ! -f "$g/.sweet-search/codebase.db" ]; then
    echo "!!! FAILED $k rc=$rc after $(( (t1-t0)/60 ))m — see idxlog/$k.log"
  else
    echo "    OK $k in $(( (t1-t0)/60 ))m$(( (t1-t0)%60 ))s  db=$(du -sh "$g/.sweet-search" | cut -f1)"
  fi
done
echo "DONE $(date -u +%FT%TZ)"
