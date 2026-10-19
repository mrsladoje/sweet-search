#!/bin/bash
# One entry point: every table, number and figure of the paper from the released data and records.
#   bash reproduce.sh DATA RES [PY]
# DATA  sets, vectors, ground truth (the release's data archive)
# RES   the released records, one folder per stage: main/ (main-study held-out, one folder per machine), post/ (post-freeze,
#       hp-*), rep-dev/ (hd-*), rep-ho/ (hh-*), floor/ (hf-*), mech/ (the Mac mechanism run), posthoc/ (hs-*, hq-*)
# PY    a Python with requirements.lock installed (default: python3); figures need matplotlib
# Reruns no timing; the code ablation recomputes quality from the vectors (minutes to hours, CPU only).
set -euo pipefail
DATA=$1; RES=$2; PY=${3:-python3}
RESULTS=$RES/main; REPDEV=$RES/rep-dev; REPHO=$RES/rep-ho; POST=$RES/post
H=$(cd "$(dirname "$0")" && pwd); W=$(mktemp -d)
cd "$H"
# each freeze record is checked against the commit that wrote it (later commits add post hoc clocks and switches)
for f in FREEZE.json POSTFREEZE.json REPFREEZE.json MECHFREEZE.json POSTHOCFREEZE.json; do
  c=$(git log -1 --format=%h -- "$f"); T=$(mktemp -d); git -C ../../../.. archive "$c" | tar -x -C "$T"
  echo -n "$f @ $c: "; $PY -I freeze_check.py "$f" "$T" | tail -1; rm -rf "$T"
done
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
# post hoc analyses (descriptive)
$PY -I rep_selfmatch.py --data "$DATA" --dev "$REPDEV" --ho "$REPHO"
$PY -I recall_doc.py --data "$DATA" --main "$RESULTS" --json $W/results-paper.json --dev "$REPDEV" --ho "$REPHO"
$PY -I floor_analyze.py --data "$DATA" --results "$RES/floor"
$PY -I mech_analyze.py "$RES/mech"
$PY -I code_ablation.py --data "$DATA"
$PY -I strong_analyze.py --data "$DATA" --results "$RES/posthoc"
L=$W/as-hh; mkdir -p $L; for d in "$RES"/posthoc/hq-*; do ln -s "$d" $L/hh-${d##*/hq-}; done
$PY -I rep_analyze.py --data "$DATA" --results $L --out-json rep-preload-results.json --out-md REP-PRELOAD.md
$PY -I draft/mktex.py $W/results-paper.json --extra draft/extra.json --tails $W/tails.json --post $W/post.json \
    --rep rep-results.json --rep-describe rep-describe.json --code-ablation code-ablation.json --mech mech.json \
    --floor floor.json --recall-doc recall-doc.json --selfmatch rep-selfmatch.json --preload rep-preload-results.json --strong strong.json
$PY -I draft/figures.py $W/results-paper.json --pareto rep-pareto.json --rep-shortlists shortlists
(cd draft && tectonic -X compile main.tex)
echo "paper: $H/draft/main.pdf"
