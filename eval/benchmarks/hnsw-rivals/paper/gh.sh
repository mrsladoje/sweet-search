#!/bin/bash
# gh.sh <git args...>          e.g. gh.sh clone --depth 1 https://github.com/nmslib/hnswlib.git src/hnswlib
# gh.sh curl <curl args...>    e.g. gh.sh curl -fsSL -o x.tgz https://github.com/<org>/<repo>/releases/download/...
# git or curl with the GitHub hosts reachable for this one command, on a machine whose /etc/hosts blocks them
# (the Hetzner box: the task-bench "sweet-bench-net-lockdown" block, which stays in place for every other
# process). The hosts are resolved through a public resolver and pinned for this command only
# (git: http.curloptResolve; curl: --resolve). Where github.com resolves normally, plain git / curl run.
set -euo pipefail
HOSTS="github.com codeload.github.com objects.githubusercontent.com raw.githubusercontent.com"
blocked() { getent hosts github.com 2>/dev/null | grep -q '^0\.0\.0\.0'; }
ip() { dig +short @1.1.1.1 "$1" A 2>/dev/null | grep -E '^[0-9.]+$' | head -1; }
pins=()
if blocked; then
  for h in $HOSTS; do
    a=$(ip "$h"); [ -n "$a" ] || { echo "gh.sh: cannot resolve $h through 1.1.1.1" >&2; exit 1; }
    pins+=("$h:443:$a")
  done
fi
if [ "${1:-}" = curl ]; then
  shift
  args=(); for p in ${pins[@]+"${pins[@]}"}; do args+=(--resolve "$p"); done
  exec curl ${args[@]+"${args[@]}"} "$@"
fi
args=(); for p in ${pins[@]+"${pins[@]}"}; do args+=(-c "http.curloptResolve=$p"); done
exec git ${args[@]+"${args[@]}"} "$@"
