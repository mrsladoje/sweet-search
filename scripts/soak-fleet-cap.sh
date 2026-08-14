#!/bin/zsh
# Cross-process fleet-cap soak.
#
# The RSS coordinator is peer-to-peer: every registered daemon runs its own
# timer, reads the shared registry, and SIGTERMs the longest-idle peer when the
# fleet is over budget. That cannot be tested in one process.
#
# Four members register. ONE of them refreshes its activity stamp, the way a
# maintainer doing indexing work now does; the other three never do. The budget
# is forced far below the fleet's real size so eviction fires on every tick.
#
# What must hold:
#   1. the working member is NEVER signalled -- that is the whole point of the
#      touch() fix, and its absence is what made eviction hunt the main repo;
#   2. idle members are shed oldest-idle first;
#   3. eviction stops once the fleet is back under budget (no endless signalling
#      of processes that are already gone);
#   4. the registry does not accumulate dead entries.
#
# The registry deliberately does NOT live in /tmp: registryTrustworthy refuses a
# world-writable directory, so a registry placed there is silently never written
# and every assertion below would pass for the wrong reason.
#
# Usage: soak-fleet-cap.sh <seconds>

set -u
SECONDS_TO_RUN=${1:-180}
REPO=/Users/admin/Projects/sweet-search-private
WORKDIR=$(mktemp -d)
REG=$WORKDIR/rss-daemons.json
MARKER=$WORKDIR/marker.log
: > $MARKER

# 0.0001 of 128 GiB is ~13 MB. Four node processes are ~40 MB each, so the fleet
# is over budget from the first tick and stays there until three are shed.
export SWEET_SEARCH_RSS_REGISTRY=$REG
export SWEET_SEARCH_RSS_BUDGET_FRACTION=0.0001
export REPO_DIR=$REPO

echo "workdir  : $WORKDIR"
echo "budget   : $(node -e "import('$REPO/core/indexing/rss-budget.mjs').then(m=>console.log((m.budgetBytes(process.env)/1048576).toFixed(1)+' MB'))" 2>/dev/null | tail -1)"

# The WORKER STARTS FIRST, on purpose, and this ordering is the entire test.
#
# It models the real situation: the maintainer for the repository you have had
# open all day is the OLDEST one running. Because maintainers never refreshed
# their stamp, "longest idle" collapsed into "started first", so that maintainer
# was always the first victim.
#
# Started first, the worker is the oldest member here too. If refreshing did
# nothing it would be shed immediately. Only the refresh can save it.
#
# (An earlier version of this script started the worker LAST. That made it the
# freshest member under BOTH the old and new behaviour, so it survived either
# way and the soak proved nothing at all.)
node $REPO/tests/fixtures/fleet-member.mjs WORKER $MARKER 5000 &
sleep 2
node $REPO/tests/fixtures/fleet-member.mjs idle-a $MARKER 0 &
sleep 2
node $REPO/tests/fixtures/fleet-member.mjs idle-b $MARKER 0 &
sleep 2
node $REPO/tests/fixtures/fleet-member.mjs idle-c $MARKER 0 &
sleep 3

alive() { ps -eo pid=,args= | awk -v l="$1" '$2 ~ /node$/ && /fleet-member/ && $0 ~ l {print $1}' | wc -l | tr -d ' '; }

END=$(( $(date +%s) + SECONDS_TO_RUN ))
while [ $(date +%s) -lt $END ]; do
  entries=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('$REG','utf8')).daemons||{};console.log(Object.keys(d).length)}catch(e){console.log('?')}")
  echo "$(date +%H:%M:%S) registry=$entries  a=$(alive idle-a) b=$(alive idle-b) c=$(alive idle-c) WORKER=$(alive WORKER)"
  sleep 15
done

echo ""
echo "=== marker log ==="
sort -k4 -n $MARKER | awk '{print $1, $2}' | uniq -c | sed 's/^/  /'
echo ""
echo "=== VERDICT ==="
if grep -q "^WORKER sigterm" $MARKER; then
  echo "FAIL: the working member was signalled -- eviction is hunting the active repo"
  VERDICT=1
else
  echo "PASS: the working member was never signalled"
  VERDICT=0
fi
SHED=$(grep -c " sigterm " $MARKER || true)
echo "idle members shed: $SHED of 3"
echo "registry entries at end: $(node -e "try{const d=JSON.parse(require('fs').readFileSync('$REG','utf8')).daemons||{};console.log(Object.keys(d).length)}catch(e){console.log('?')}")"
echo "worker still alive: $(alive WORKER)"

for p in $(ps -eo pid=,args= | awk '$2 ~ /node$/ && /fleet-member/ {print $1}'); do kill -9 $p 2>/dev/null; done
rm -rf $WORKDIR
exit $VERDICT
