#!/bin/sh
# Build the synthetic repository the args / paths generators probe (odd names, a symlinked
# directory, a dangling link). Put it under /private/tmp so the /tmp symlink gives it a second
# spelling. Usage:
#   sh fixtures-gen/make-synrepo.sh /private/tmp/<dir>/synrepo
#   node fixtures-gen/args.mjs  /private/tmp/<dir>/synrepo
#   node fixtures-gen/paths.mjs /private/tmp/<dir>/synrepo
#   node fixtures-gen/globs.mjs; node fixtures-gen/chain.mjs; node fixtures-gen/collate.mjs
# The fixtures record every file-system answer, so the Rust tests never need this directory.
set -e
R="$1"
[ -n "$R" ] || { echo "usage: $0 <dir>" >&2; exit 2; }
rm -rf "$R"
mkdir -p "$R/src/sub" "$R/tests" "$R/docs" "$R/src/tests" "$R/dir with space" "$R/é" "$R/lib/tests" "$R/lib/src" \
  "$R/vendor/x/src" "$R/.hidden"
for f in src/lib.rs src/main.rs src/sub/a.rs tests/t.rs docs/readme.md src/tests/x.rs "dir with space/f.txt" "é/ü.txt" \
  lib/tests/a.go lib/src/b.go lib/top.h vendor/x/src/c.c .hidden/z.h top.h; do
  echo x > "$R/$f"
done
ln -s src "$R/link"
ln -s nowhere "$R/dangling"
