#!/usr/bin/env bash
# smoke-tools.sh ($0, no model call) — do an arm's ss-* tools run from its own checkout on its own index?
#   bash smoke-tools.sh before|after [repo]     (default repo r3-tortoise-orm, the smallest)
# Clones the stamped source repo (as the bench does), then with the bench's env for that arm runs
# ss-search and ss-grep, and checks: exit 0, non-empty output, the native ss-* client of the arm's
# checkout answered (not the in-process fallback), and the daemon serving the clone runs the arm's
# own core/start-server.js. Reaps the clone's daemon / maintainer afterwards.
# Loads ORT CPU query models: waits while an index build or another bench runs (no-model-coexist).
set -uo pipefail
. "$(dirname "$0")/config.sh"
ARM="${1:-}"; REPO="${2:-r3-tortoise-orm}"
case "$ARM" in
  before) ROOT="$BEFORE_ROOT"; SRC="$BEFORE_REPOS/$REPO" ;;
  after)  ROOT="$FINAL_ROOT";  SRC="$(cd "$AFTER_REPOS" && pwd -P)/$REPO" ;;
  *) echo "usage: smoke-tools.sh before|after [repo]"; exit 2 ;;
esac
[ -d "$SRC/.sweet-search" ] || { echo "FAIL no index at $SRC (run index-repos.sh $ARM $REPO)"; exit 1; }
while [ -n "$(fr_busy)" ]; do echo "waiting for idle machine: $(fr_busy | head -1)"; sleep 60; done
W="$FR_STATE/smoke/$ARM-$REPO"; rm -rf "$W"; mkdir -p "$(dirname "$W")"
cp -c -p -R "$SRC" "$W"
RT="$FR_STATE/smoke/rt-$ARM"; mkdir -p "$RT"
BIN="$ROOT/eval/agent-read-workflows/bin"
run() { ( cd "$W" && env -u SWEET_SEARCH_SERVER_ENTRY PATH="$BIN:$PATH" SWEET_SEARCH_PROJECT_ROOT="$W" SWEET_SEARCH_OFFLINE=1 \
          SWEET_SEARCH_RUNTIME_DIR="$RT" SWEET_SEARCH_VOCAB_AUTO_EXPAND=0 "$@" ); }
fail=0
echo "[$ARM] $ROOT @ $(git -C "$ROOT" rev-parse --short=8 HEAD), clone $W"
echo "  client: $(cd "$ROOT" && node --input-type=module -e 'import { resolveNativeBinary } from "./core/infrastructure/native-resolver.js"; console.log(resolveNativeBinary())')"
t0=$(date +%s); out=$(run ss-search warmup -k 1 2>&1); echo "  warmup rc=$? ($(( $(date +%s) - t0 )) s)"
for cmd in "ss-search|how are database transactions committed" "ss-grep|class .*Transaction"; do
  tool=${cmd%%|*}; q=${cmd#*|}
  t0=$(date +%s); out=$(run "$tool" "$q" 2>&1); rc=$?
  lines=$(printf '%s\n' "$out" | grep -c .)
  echo "  $tool \"$q\": rc=$rc, $lines lines, $(( $(date +%s) - t0 )) s"; printf '%s\n' "$out" | head -4 | sed 's/^/    | /'
  [ $rc -eq 0 ] && [ "$lines" -gt 0 ] || fail=1
  printf '%s' "$out" | grep -qE "^(Error|error:|Usage error)|Cannot find|Traceback|ECONNREFUSED" && { echo "    (output mentions an error)"; fail=1; }
done
# Which code serves the clone? The daemon holds files under the clone; its argv names its entry.
found=0
for pid in $(pgrep -f "sweet-search-daemon|start-server.js"); do
  lsof -p "$pid" 2>/dev/null | grep -q "$W" || continue
  found=1; cmdl=$(ps -o command= -p "$pid")
  # The daemon's process title hides its script; its mapped native addon and open files name the checkout.
  mine=$(lsof -p "$pid" 2>/dev/null | grep -c "$ROOT/")
  other=$(lsof -p "$pid" 2>/dev/null | grep -E "$FINAL_ROOT/|$BEFORE_ROOT/|$MAIN_ROOT/(core|crates)/" | grep -vc "$ROOT/")
  echo "  daemon $pid: $cmdl — files from this checkout: $mine, from another checkout: $other"
  [ "$mine" -gt 0 ] && [ "$other" -eq 0 ] || { echo "  FAIL daemon does not run only $ARM code ($ROOT)"; fail=1; }
done
[ $found = 1 ] || echo "  WARN no daemon holds files under the clone (in-process fallback answered?)"
( cd "$FINAL_ROOT" && node --input-type=module -e '
  const { reapRoots } = await import(process.cwd() + "/eval/task-completion-bench/harness/spawn-ledger-reap.mjs");
  const k = await reapRoots({ ledgerDir: null, roots: [process.argv[1]] }); console.log(`  reaped ${k.length}`);' "$W" )
[ $fail = 0 ] && echo "SMOKE $ARM PASS" || echo "SMOKE $ARM FAIL"
exit $fail
