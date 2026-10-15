#!/bin/bash
# final.sh <machine> <replay-root> [mode-chain]
# The benchmark on a machine you sit at (the M3 Max, the EPYC box): the same job groups as
# the cloud machines (plan_groups.py via aws/run.sh), without S3 and without shutdown.
# Default mode chain: heldout (needs FREEZE.json and shortlist-<machine>.json). For the S6
# dev validation: final.sh <machine> <replay-root> dev. LEGACY_ADDON = the f1ee878b addon.
set -u
H=$(cd "$(dirname "$0")" && pwd)
# One matrix at a time per machine (run_matrix.py also holds a lock per matrix).
LOCK=${TMPDIR:-/tmp}/maxsim-final.lock
mkdir "$LOCK" 2>/dev/null || { echo "another final.sh holds $LOCK"; exit 1; }
trap 'rmdir "$LOCK"' EXIT
MACHINE=$1 REPLAY=$2 BEIR=${BEIR:-$2/beir} SS_LOCAL=1 MAX_BUSY=${MAX_BUSY:-20} bash "$H/aws/run.sh" "${3:-heldout}"
