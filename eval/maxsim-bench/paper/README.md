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
`budget.py`, `rival_scores_check.py`. Edit those constants for another layout. The BEIR
build script (`beir_prep.py`) records the model revisions in its manifest but does not pass
them to the download; pin them by hand when you rebuild.

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
