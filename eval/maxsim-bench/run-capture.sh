#!/bin/bash
# Usage: run_capture.sh <outroot> repo...   (real daemon + client, both hooked)
out=$1; shift
H=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$H/../.." && pwd)
mkdir -p $out
for r in "$@"; do
  root=$SRC/eval/repos/r3-$r
  HOOK=(env SS_MAXSIM_DUMP=$out/$r NODE_OPTIONS="--import $H/hook.mjs" SWEET_SEARCH_PROJECT_ROOT=$root)
  (cd $root && "${HOOK[@]}" node $SRC/core/cli.js --serve > $out/daemon-$r.log 2>&1 &)
  for i in $(seq 1 180); do
    h=$(cd $root && SWEET_SEARCH_PROJECT_ROOT=$root node -e "import('$SRC/core/search/search-server.js').then(async m=>{const s=await m.getServerHealth().catch(()=>null);console.log(s?.status||'none')})" 2>/dev/null)
    [ "$h" = "ready" ] && break; sleep 1
  done
  echo "daemon $r: $h after ${i}s"
  (cd $root && "${HOOK[@]}" node $H/capture-agent.mjs $r $out 2>&1 | grep -E '^\{|FAIL')
  pkill -x sweet-search-daemon; pkill -x sweet-search-maintainer; sleep 3
done
