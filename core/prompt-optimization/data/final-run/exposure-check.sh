#!/usr/bin/env bash
# exposure-check.sh ($0, no model call) — PLAN.md §7 gate before any paid rollout.
# For every cell: the bench's --print-exposure texts for arm `sweet` (after) and arm `before` must equal
# the reference texts that exposure-ref.mjs builds from the final checkout and from the before checkout
# (each with that commit's own bench logic, rules from the commit's git object). Also checks that each
# arm's ss-* bin dir and gutter come from its own checkout, and that the two arms do differ.
#   bash exposure-check.sh [outdir]      exit 0 = PASS
set -uo pipefail
. "$(dirname "$0")/config.sh"
OUT="${1:-$FR_STATE/exposure-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
fail=0
before_head=$(git -C "$BEFORE_ROOT" rev-parse HEAD)
want=$(git -C "$BEFORE_ROOT" rev-parse "$BEFORE_COMMIT^{commit}")
[ "$before_head" = "$want" ] || { echo "FAIL before worktree is at $before_head, expected $BEFORE_COMMIT"; fail=1; }
[ -z "$(git -C "$BEFORE_ROOT" status --porcelain --untracked-files=no)" ] || { echo "FAIL before worktree has tracked changes"; fail=1; }
for cell in $FR_CELLS; do
  ( cd "$FINAL_ROOT" && CELL=$cell node scripts/retrieval-bench-282.mjs --arms sweet,before --before-root "$BEFORE_ROOT" --print-exposure "$OUT/bench-$cell" ) > "$OUT/bench-$cell.txt" 2>&1 || { echo "FAIL $cell: bench --print-exposure"; tail -3 "$OUT/bench-$cell.txt"; fail=1; continue; }
  node "$FR_HERE/exposure-ref.mjs" "$BEFORE_ROOT" "$cell" "$OUT/ref-before-$cell" > "$OUT/ref-before-$cell.txt" 2>&1 || { echo "FAIL $cell: ref before"; tail -3 "$OUT/ref-before-$cell.txt"; fail=1; continue; }
  node "$FR_HERE/exposure-ref.mjs" "$FINAL_ROOT" "$cell" "$OUT/ref-after-$cell" > "$OUT/ref-after-$cell.txt" 2>&1 || { echo "FAIL $cell: ref after"; tail -3 "$OUT/ref-after-$cell.txt"; fail=1; continue; }
  for pair in "before:ref-before-$cell:$BEFORE_ROOT" "sweet:ref-after-$cell:$FINAL_ROOT"; do
    arm=${pair%%:*}; rest=${pair#*:}; ref=${rest%%:*}; root=${rest#*:}
    if diff -r -x '_*.json' "$OUT/bench-$cell/$arm" "$OUT/$ref" > "$OUT/diff-$cell-$arm.txt"; then
      echo "PASS $cell $arm: texts equal $(basename "$root") @ $(git -C "$root" rev-parse --short=8 HEAD)"
    else echo "FAIL $cell $arm: texts differ from $ref (see $OUT/diff-$cell-$arm.txt)"; fail=1; fi
    node -e '
      const [p, r, root] = process.argv.slice(1).map((f, i) => i < 2 ? require(f) : f);
      const errs = [];
      if (!p.ssBin.startsWith(root + "/")) errs.push(`ss-bin ${p.ssBin} is not under ${root}`);
      if (p.gutter !== r.gutter) errs.push(`gutter ${p.gutter} != product default ${r.gutter}`);
      if (p.commit !== r.commit) errs.push(`commit ${p.commit} != ${r.commit}`);
      if (errs.length) { console.log("FAIL " + errs.join("; ")); process.exit(1); }
      console.log(`     ss-bin ${p.ssBin}  gutter ${p.gutter}`);
    ' "$OUT/bench-$cell/$arm/_product.json" "$OUT/$ref/_ref.json" "$root" || fail=1
  done
  if diff -rq -x '_*.json' "$OUT/bench-$cell/sweet" "$OUT/bench-$cell/before" > "$OUT/arms-differ-$cell.txt"; then
    echo "WARN $cell: before and after texts are identical (the arms differ only in tools/index)"
  else echo "     $cell before vs after differ in: $(awk '{print $2}' "$OUT/arms-differ-$cell.txt" | xargs -n1 basename | sort -u | tr '\n' ' ')"; fi
done
[ $fail -eq 0 ] && echo "EXPOSURE CHECK PASS ($OUT)" || echo "EXPOSURE CHECK FAIL ($OUT)"
exit $fail
