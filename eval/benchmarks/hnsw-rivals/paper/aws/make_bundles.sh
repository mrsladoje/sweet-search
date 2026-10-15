#!/bin/bash
# make_bundles.sh [--sets a,b] [--models m1,m2] [--data DIR] [--stage DIR] [--code-only|--data-only] [--strict]   (step S2, on the Mac)
#
# Builds in the staging directory (default ~/.ss-eval/hnsw-cloud/upload/). Uploads NOTHING: it prints the
# `aws s3 cp` commands for the owner to approve.
#   code/ss-HEAD-<commit>-<stamp>.tar.zst   git archive of HEAD (the repo root), plus the working-tree files of
#                                            eval/benchmarks/hnsw-rivals/paper/ when they differ from HEAD
#                                            (never env.local, caches, build outputs)
#   code/ss-HEAD-<...>.paper-manifest.sha256 SHA-256 of every working-tree file added from paper/, the HEAD
#                                            commit, and the tracked files outside paper/ that differ from HEAD
#   code/bootstrap.sh                        the instance bootstrap
#   data/sets-<set>.tar.zst                  sets/<set>/ (set.json, vectors.jsonl, queries.jsonl, texts*)
#   data/emb-<model>-<set>.tar.zst           emb/<model>/<set>/{corpus.f32, queries.f32, model.json, gt/, export/}
#                                            (the index/ directory is built on the machine)
#   SHA256SUMS                               of every file above
# --strict: stop if tracked files outside paper/ differ from HEAD (the bundle would not contain them).
set -euo pipefail
export COPYFILE_DISABLE=1   # no AppleDouble entries in the archives
H=$(cd "$(dirname "$0")" && pwd); PAPER=$(cd "$H/.." && pwd); SRC=$(cd "$PAPER/../../../.." && pwd)
REL=${PAPER#$SRC/}
DATA=${DATA:-$HOME/.ss-eval/hnsw-paper}; STAGE=$HOME/.ss-eval/hnsw-cloud/upload
SETS=; MODELS=; CODE=1; DATAB=1; STRICT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sets) SETS=$2; shift;; --models) MODELS=$2; shift;; --data) DATA=$2; shift;; --stage) STAGE=$2; shift;;
    --code-only) DATAB=0;; --data-only) CODE=0;; --strict) STRICT=1;;
    *) sed -n '2,19p' "$0"; exit 2;;
  esac; shift
done
mkdir -p "$STAGE/code" "$STAGE/data"
sha() { shasum -a 256 "$@" 2>/dev/null || sha256sum "$@"; }
SETLIST=${SETS:-$(ls "$DATA/sets" | tr '\n' ',' | sed 's/,$//')}
MODELLIST=${MODELS:-$(ls "$DATA/emb" | tr '\n' ',' | sed 's/,$//')}

if [ $CODE = 1 ]; then
  COMMIT=$(git -C "$SRC" rev-parse --short=12 HEAD); STAMP=$(date +%Y%m%d%H%M)
  B=ss-HEAD-$COMMIT-$STAMP; MAN=$STAGE/code/$B.paper-manifest.sha256
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  git -C "$SRC" archive --format=tar HEAD > "$T/$B.tar"
  # working-tree files of paper/ that differ from HEAD (modified or untracked, not ignored)
  ( cd "$SRC" && git ls-files -m -o --exclude-standard -- "$REL" | grep -v -E '(^|/)(__pycache__|node_modules|target)/|env\.local$|\.(so|dylib|pyc|o|a)$' || true ) > "$T/extra.txt"
  if grep -q 'env.local' "$T/extra.txt"; then echo "refusing: env.local in the bundle"; exit 1; fi
  { echo "# bundle $B"; echo "# HEAD $(git -C "$SRC" rev-parse HEAD)"
    if [ -s "$T/extra.txt" ]; then echo "# working-tree files of $REL added to HEAD:"; ( cd "$SRC" && xargs shasum -a 256 < "$T/extra.txt" ); else echo "# no uncommitted files in $REL"; fi
    echo "# tracked files outside $REL that differ from HEAD (NOT in the bundle):"
    ( cd "$SRC" && git diff --name-only HEAD | grep -v "^$REL/" | sed 's/^/#   /' ) || true; } > "$MAN"
  DIFF=$(grep -c '^#   ' "$MAN" || true)
  if [ "$DIFF" -gt 0 ]; then
    echo "WARNING: $DIFF tracked files outside $REL differ from HEAD and are not in the bundle (listed in the manifest)."
    [ $STRICT = 1 ] && { echo "--strict: stopping"; exit 1; }
  fi
  if [ -s "$T/extra.txt" ]; then ( cd "$SRC" && tar --no-xattrs -rf "$T/$B.tar" -T "$T/extra.txt" ); fi   # later entries replace HEAD's on extraction
  zstd -q -19 -T0 -f "$T/$B.tar" -o "$STAGE/code/$B.tar.zst"
  cp "$H/bootstrap.sh" "$STAGE/code/bootstrap.sh"
  echo "code bundle $B: $(wc -l < "$T/extra.txt" | tr -d ' ') working-tree files added from $REL"
fi

if [ $DATAB = 1 ]; then
  for S in $(echo "$SETLIST" | tr ',' ' '); do
    [ -d "$DATA/sets/$S" ] || { echo "no set $S in $DATA/sets"; exit 1; }
    tar --no-xattrs --exclude texts.jsonl -C "$DATA" -cf - "sets/$S" | zstd -q -10 --long=27 -T0 -f -o "$STAGE/data/sets-$S.tar.zst"
    for M in $(echo "$MODELLIST" | tr ',' ' '); do
      E=$DATA/emb/$M/$S
      [ -d "$E" ] || { echo "skip: no embeddings of $M for $S"; continue; }
      FILES=(); for f in corpus.f32 queries.f32 model.json gt export; do
        [ -e "$E/$f" ] && FILES+=("emb/$M/$S/$f") || echo "note: $M/$S has no $f"
      done
      [ -e "$E/corpus.f32" ] || { echo "skip: $M/$S has no corpus.f32"; continue; }
      # -h: store the vectors, not a symbolic link to them
      tar --no-xattrs -h -C "$DATA" -cf - "${FILES[@]}" | zstd -q -10 --long=27 -T0 -f -o "$STAGE/data/emb-$M-$S.tar.zst"
    done
  done
fi

( cd "$STAGE" && find code data -type f ! -name '*.paper-manifest.sha256' | sort | xargs shasum -a 256 > SHA256SUMS )
while read -r _ f; do printf '%9.1f MB  %s\n' "$(echo "$(stat -f %z "$STAGE/$f" 2>/dev/null || stat -c %s "$STAGE/$f") / 1000000" | bc -l)" "$f"; done < "$STAGE/SHA256SUMS"
echo
echo "Nothing was uploaded. After the owner's approval, run (BUCKET is in aws/env.local):"
echo '  . '"$H"'/env.local'
while read -r SUM f; do
  K=$f; case "$f" in code/*) K=${f#code/}; DST="s3://\$BUCKET/hnsw/code/$K";; data/*) DST="s3://\$BUCKET/hnsw/data/${f#data/}";; esac
  echo "  aws s3 cp --only-show-errors --metadata sha256=$SUM $STAGE/$f $DST"
done < "$STAGE/SHA256SUMS"
for f in "$STAGE"/code/*.paper-manifest.sha256; do [ -f "$f" ] && echo "  aws s3 cp --only-show-errors $f s3://\$BUCKET/hnsw/code/$(basename "$f")"; done
echo "  aws s3 cp --only-show-errors $STAGE/SHA256SUMS s3://\$BUCKET/hnsw/SHA256SUMS"
echo "Read-back check: aws s3 cp s3://\$BUCKET/hnsw/<key> - | shasum -a 256   (compare with SHA256SUMS)"
