# Paper: MaxSim Is Not One Function (LIRK-Bench)

LaTeX source of the paper and the post-freeze analysis code that builds every table,
figure and number in it. Nothing in this folder is frozen (`freeze_check.py` checks only
the files directly in `eval/maxsim-bench/`).

## Layout

| path | what |
|---|---|
| `main.tex`, `sections/*.tex` | the paper |
| `numbers.tex` | every number in the prose, as `\defnum{key}{value}`; generated |
| `tables/*.tex` | table bodies; generated |
| `figures/*.pdf` | figures; generated |
| `refs.bib`, `refs-own.bib` | references (checked against primary sources) |
| `analysis/*.py` | post-freeze analysis code |
| `analysis/tables/*.json`, `*.md` | aggregate results (no per-call held-out rows) |
| `analysis/RESULTS-paper.md` | every number with its key, source file and command |
| `analysis/logs/` | completeness checks |

## Rebuild

Inputs: the held-out result trees (the data release; cloud shards under `S8=<release>/s8`,
local machines under `LOCAL=<release>/local`), the BEIR prep folder (raw vectors, BM25
lists, qrels and the 20 replay sets) and the replay sets with their `refs-v2` caches. The
scripts read these paths from constants at the top of each script (`~/.ss-eval/...` by
default): `analysis/load.py`, `conc.py`, `memory.py`, `nan_scan.py`, `quality_extra.py`,
`budget.py`, `rival_scores_check.py`; the post-freeze scripts `checks_collect.py`, `floor_collect.py`,
`conc2.py` and `post_checks.py` read the release folders `rerun/` (`rerun/checks2/` and
`rerun/m3max-recheck/` hold the checks of 2026-10-18). Edit those constants for another layout.
`analysis/scrub.py` built the release folder from the raw results. The BEIR
build script (`beir_prep.py`, frozen) records the model revisions in its manifest but does not pass
them to the download; `rerun/beir_prep_pinned.py --manifest <release>/MANIFEST.json <beir_prep.py arguments>`
pins them and runs the frozen script unchanged.

From `eval/maxsim-bench`:

```bash
venv/bin/python -I freeze_check.py FREEZE.json                      # frozen files unchanged
# completeness
venv/bin/python -I check_complete.py --shards FREEZE.json --type intel $S8   # amd, arm too
venv/bin/python -I paper/analysis/local_complete.py $LOCAL/m3max             # epyc too
# quality (one platform per call; a folder that links only that platform's BEIR groups)
venv/bin/python -I quality.py FREEZE.json --prep $PREP --results $BEIR_IN/<platform> \
    --out $QOUT/<platform> --kernel ours
# aggregates
venv/bin/python -I paper/analysis/load.py intel amd arm m3max epyc intel-replica amd-replica arm-replica
venv/bin/python -I paper/analysis/tables.py
venv/bin/python -I paper/analysis/conc.py
venv/bin/python -I paper/analysis/memory.py
venv/bin/python -I paper/analysis/contract_effects.py
venv/bin/python -I paper/analysis/quality_collect.py
venv/bin/python -I paper/analysis/quality_extra.py
venv/bin/python -I paper/analysis/budget.py
venv/bin/python -I paper/analysis/workload.py
venv/bin/python -I paper/analysis/machines.py
venv/bin/python -I paper/analysis/nan_scan.py            # NaN scores per arm (NumKong on Intel)
venv/bin/python -I paper/analysis/rival_scores_check.py  # rival scores identical across runs?
venv/bin/python -I paper/analysis/numkong_check.py      # synthetic NumKong check (no benchmark data)
venv/bin/python -I paper/analysis/beir_lengths.py       # share of BEIR documents cut at 180 tokens
venv/bin/python -I paper/analysis/load.py intel-r2 amd-r2 arm-r2 && venv/bin/python -I paper/analysis/rerun_beir.py   # BEIR rerun
venv/bin/python -I paper/analysis/floor_collect.py      # fixed cost per call
venv/bin/python -I paper/analysis/numkong_gap.py        # synthetic NumKong sweep over score spread (figure nkgap)
venv/bin/python -I paper/analysis/checks_collect.py     # float32-storage check, ColBERTv2 at 300 tokens (F)
venv/bin/python -I paper/analysis/post_checks.py        # int4 at 300 tokens, parallel-call scores, pipeline shares, M3 Max recheck
venv/bin/python -I paper/analysis/conc2.py              # parallel-caller rerun (pools the M3 Max recheck passes)
# LaTeX numbers and tables, then figures (matplotlib in a separate venv)
venv/bin/python -I paper/analysis/mktex.py
<plot-venv>/bin/python -I paper/analysis/figures.py
# PDF (arXiv: pdflatex; locally tectonic or latexmk)
cd paper && latexmk -pdf main.tex        # or: tectonic -X compile main.tex
```

## Two fixes to frozen scripts, applied in the analysis only

- `quality.py` keys an implementation by the `arm` field inside a result file, which drops
  the thread budget and the BLIS variant. Its primary tests are unaffected (every kernel
  result file of a set is bit-identical); its latency points are not used. `budget.py`
  recomputes quality per latency budget per result file.
- `concurrency.py`: closed-loop runs of the per-process executor start up to 50 ms before
  the recorded start time. `conc.py` corrects the throughput (lower bound reported); the
  latencies need no correction.

## Held-out discipline

The analysis code reads held-out results only to compute aggregates. The caches of
`load.py` (per-call arrays) live outside the repository and are never printed.
