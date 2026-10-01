#!/usr/bin/env bash
# cmp.sh dirA dirB : normalised diff of every file
rc=0
for f in "$1"/*; do b=$(basename "$f"); 
  if ! diff -q <(./norm.sh "$f") <(./norm.sh "$2/$b") >/dev/null; then echo "DIFF $b"; rc=1; fi
done; [ $rc = 0 ] && echo "IDENTICAL (normalised)"; exit $rc
