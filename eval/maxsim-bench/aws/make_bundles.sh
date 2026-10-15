#!/bin/bash
# make_bundles.sh [--upload]   (step S2, on the Mac)
#
# Builds in ~/.ss-eval/maxsim-cloud/upload/:
#   code/ss-HEAD-<commit>-<stamp>.tar.zst   git archive HEAD + the uncommitted benchmark files
#                                            (eval/maxsim-bench, git-ignored files excluded)
#   code/ss-f1ee878b.tar.zst                 the previous production path (legacy addon source)
#   code/bootstrap.sh
#   data/<set>.tar.zst                       agent-ho, gcsn-ho, agent-dev, gcsn-dev with their
#                                            sidecars and MANIFEST.sha256 (no reference caches)
#   data/sweep-{dev,ho}-sidecars.tar.zst     per cell: provenance.jsonl + MANIFEST.sha256 (the
#                                            sweeps themselves are rebuilt on each machine)
#   SHA256SUMS                               of every file above
# --upload: a timed 100 MB test upload first, then everything to s3://$BUCKET/{code,data}/,
# then each uploaded object is read back and its SHA-256 compared with SHA256SUMS.
set -euo pipefail
H=$(cd "$(dirname "$0")" && pwd); MB=$(cd "$H/.." && pwd); SRC=$(cd "$MB/../.." && pwd)
. "$H/env.local"
O=${REPLAY:-$HOME/.ss-eval/maxsim-replay}
U=$HOME/.ss-eval/maxsim-cloud/upload; mkdir -p "$U/code" "$U/data"
PY=$MB/venv/bin/python
COMMIT=$(git -C "$SRC" rev-parse --short=12 HEAD); STAMP=$(date +%Y%m%d%H%M)

# ---- code
B=ss-HEAD-$COMMIT-$STAMP
git -C "$SRC" archive --format=tar HEAD > "$U/$B.tar"
( cd "$SRC" && git ls-files -m -o --exclude-standard eval/maxsim-bench | grep -v -e __pycache__ -e '/target/' > "$U/$B.extra.txt" )
for bad in env.local PAPER_PLAN.md; do grep -q "$bad" "$U/$B.extra.txt" && { echo "refusing: $bad in the bundle"; exit 1; }; done
( cd "$SRC" && tar -rf "$U/$B.tar" -T "$U/$B.extra.txt" )
zstd -q -19 -T0 --rm -f "$U/$B.tar" -o "$U/code/$B.tar.zst"
mv "$U/$B.extra.txt" "$U/code/$B.extra.txt"
[ -f "$U/code/ss-f1ee878b.tar.zst" ] || { git -C "$SRC" archive --format=tar f1ee878b | zstd -q -19 -T0 -o "$U/code/ss-f1ee878b.tar.zst"; }
cp "$H/bootstrap.sh" "$U/code/bootstrap.sh"

# ---- data (manifests first; reference caches and logs stay out)
for S in agent-ho gcsn-ho agent-dev gcsn-dev; do
  $PY -I "$MB/set_manifest.py" "$O/$S" > /dev/null
  [ -f "$U/data/$S.tar.zst" ] && [ "$U/data/$S.tar.zst" -nt "$O/$S/MANIFEST.sha256" ] && continue
  tar -C "$O" --exclude 'refs-v2' --exclude 'refs.json' --exclude 'daemon-*.log' -cf - "$S" | zstd -q -10 --long=27 -T0 -o "$U/data/$S.tar.zst" -f
done
for S in sweep-dev sweep-ho; do
  $PY -I "$MB/set_manifest.py" "$O/$S"/* > /dev/null
  ( cd "$O/$S" && tar -cf - */MANIFEST.sha256 */sweep/provenance.jsonl ) | zstd -q -19 -o "$U/data/$S-sidecars.tar.zst" -f
done
( cd "$U" && find code data -type f ! -name '*.extra.txt' | sort | xargs shasum -a 256 > SHA256SUMS )
cat "$U/SHA256SUMS" | awk '{print $2}' | while read -r f; do printf '%8.1f MB  %s\n' "$(echo "$(stat -f %z "$U/$f") / 1000000" | bc -l)" "$f"; done
[ "${1:-}" = --upload ] || exit 0

# ---- upload: timed 100 MB test first
head -c 100000000 /dev/urandom > "$U/test-100MB.bin"
T0=$(date +%s); aws s3 cp --only-show-errors "$U/test-100MB.bin" "s3://$BUCKET/test/test-100MB.bin"; T1=$(date +%s)
echo "test upload: 100 MB in $((T1 - T0)) s"; aws s3 rm --only-show-errors "s3://$BUCKET/test/test-100MB.bin"; rm -f "$U/test-100MB.bin"
: > "$U/uploaded.txt"
while read -r SUM F; do
  if [ "$(aws s3api head-object --bucket "$BUCKET" --key "$F" --query 'Metadata.sha256' --output text 2>/dev/null)" = "$SUM" ]; then echo "present $F"; continue; fi
  aws s3 cp --only-show-errors --metadata "sha256=$SUM" "$U/$F" "s3://$BUCKET/$F"; echo "uploaded $F"; echo "$SUM $F" >> "$U/uploaded.txt"
done < "$U/SHA256SUMS"
aws s3 cp --only-show-errors "$U/SHA256SUMS" "s3://$BUCKET/SHA256SUMS"
# ---- read back and compare (the objects uploaded now; the others were read back when uploaded)
BAD=0
while read -r SUM F; do
  GOT=$(aws s3 cp --only-show-errors "s3://$BUCKET/$F" - | shasum -a 256 | cut -d' ' -f1)
  [ "$GOT" = "$SUM" ] && echo "sha256 ok $F" || { echo "SHA256 DIFFERS $F"; BAD=1; }
done < "$U/uploaded.txt"
exit $BAD
