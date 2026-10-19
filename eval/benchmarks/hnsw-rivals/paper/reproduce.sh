#!/bin/bash
# One entry point: every table, number and figure of the paper from the released data and records.
#   bash reproduce.sh DATA RESULTS REPDEV REPHO POST [PY]
# DATA    sets, vectors, ground truth (the release's data archive)
# RESULTS main-study held-out records, one folder per machine
# REPDEV  replication dev records (hd-*); REPHO replication held-out records (hh-*)
# POST    post-freeze records (hp-*)
# PY      a Python with requirements.lock installed (default: python3); figures need matplotlib
set -euo pipefail
DATA=$1; RESULTS=$2; REPDEV=$3; REPHO=$4; POST=$5; PY=${6:-python3}
H=$(cd "$(dirname "$0")" && pwd); W=$(mktemp -d)
cd "$H"
$PY -I freeze_check.py FREEZE.json ../../../.. | tail -1          # main-study frozen files (expect 1 known change, Appendix)
$PY -I freeze_check.py REPFREEZE.json ../../../.. | tail -1       # replication frozen files
for t in intel amd arm box mac; do
  $PY -I analyze.py --data "$DATA" --results "$RESULTS" --shortlists shortlists --builds "$DATA/builds/shared" --types $t --out $W/R-$t.md --json $W/J-$t.json &
done; wait
$PY -I merge_results.py --parts $W --out RESULTS-paper.md --json $W/results-paper.json
$PY -I mem_patch.py --results "$RESULTS" --json $W/results-paper.json
$PY -I tails_recall.py --data "$DATA" --results "$RESULTS" --json $W/results-paper.json --out $W/tails.json
$PY -I post_analyze.py --data "$DATA" --results "$POST" --out-json $W/post.json --out-md POST-RESULTS.md
$PY -I rep_analyze.py --data "$DATA" --results "$REPHO"                       # the pre-registered tests
$PY -I rep_describe.py --data "$DATA" --results "$REPHO"                      # descriptive additions
$PY -I rep_pareto.py --data "$DATA" --results "$REPDEV"                       # dev curves for the figure
$PY -I draft/mktex.py $W/results-paper.json --extra draft/extra.json --tails $W/tails.json --post $W/post.json \
    --rep rep-results.json --rep-describe rep-describe.json
$PY -I draft/figures.py $W/results-paper.json --pareto rep-pareto.json --rep-shortlists shortlists
(cd draft && tectonic -X compile main.tex)
echo "paper: $H/draft/main.pdf"
