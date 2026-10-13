#!/bin/bash
# final.sh <tag-prefix> <replay-root>
# The held-out benchmark matrix (one platform). Every arm runs in its own process,
# two rounds (forward, then reversed order), each run gated on an idle CPU.
#   <tag>-warm   back-to-back calls, all held-out sets (agent, gcsn, size sweep)
#   <tag>-tiers  the WASM and plain-JS fallback tiers, every 4th replay call
#   <tag>-cold   5 ms of busy main thread before every call (pools parked), replay sets
# Rival configurations: the two fastest per library on the dev shortlist, plus each
# library's fastest single-thread one; analyze_final.py reports each library at its
# fastest configuration per workload. LEGACY_ADDON = the pre-change production addon.
set -u
T=$1; O=$2
# One matrix at a time per machine: two concurrent drivers would time each other.
LOCK=${TMPDIR:-/tmp}/maxsim-final.lock
mkdir "$LOCK" 2>/dev/null || { echo "another final.sh holds $LOCK"; exit 1; }
trap 'rmdir "$LOCK"' EXIT
H=$(cd "$(dirname "$0")" && pwd); cd $H
PY=$H/venv/bin/python
REPLAY="--set $O/agent-ho --set $O/gcsn-ho"
SWEEP=$(for c in $(ls $O/sweep-ho); do echo --set $O/sweep-ho/$c; done)
BUSY=${MAX_BUSY:-5}
arms() { for a in "$@"; do echo --arm $a; done; }
WARM=$(arms ours node:production node:legacy numpy_packed numpy_packed_t torch_pad_bmm torch_colbert_packed maxsim_cpu_variable maxsim_cpu_3d numkong_f16 numkong_f32 numpy_packed_int4 maxsim_cpu_variable_int4 ours@1 numpy_packed@1 torch_pad_bmm@1 maxsim_cpu_variable@1 numkong_f16@1 ${EXTRA_ARMS:-})
$PY -I run_matrix.py --tag $T-warm $REPLAY $SWEEP $WARM --rounds 2 --reps 5 --max-busy $BUSY
$PY -I run_matrix.py --tag $T-tiers $REPLAY $(arms node:production node:wasm node:js) --rounds 2 --reps 3 --stride 4 --max-busy $BUSY
COLD=$(arms ours node:production node:prewarm node:legacy numpy_packed torch_pad_bmm maxsim_cpu_variable numkong_f16 ${EXTRA_COLD:-})
$PY -I run_matrix.py --tag $T-cold $REPLAY $COLD --rounds 2 --reps 3 --gap-ms 5 --max-busy $BUSY
echo "FINAL DONE $(date +%T)"
