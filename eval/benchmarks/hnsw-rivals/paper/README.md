# HNSW rivals paper — harness, frozen points, analysis

The benchmark behind the paper draft in `draft/` (plan: `../PAPER_PLAN.md`; formats: `DESIGN.md`).
Frozen at commit `f57533b0` (tag `hnsw-rivals-freeze-2026-10-17-v2`); `FREEZE.json` holds the SHA-256 of
every frozen file. Held-out results come only from binaries built from that commit.

## What is where

| Path | Content |
|---|---|
| `sets.py`, `embed.py`, `gt.py` | the seven sets, the embeddings (three models), the exact ground truth |
| `quality.py`, `stats.py` | evaluation unit (MRR@10, nDCG@10), cluster bootstrap, selection, non-inferiority, Holm |
| `rivals5.cpp`, `adapters/` | rival harness (FAISS, USearch, hnswlib, DiskANN, SVS in C++; ScaNN in Python) |
| `ours5.mjs` | our cascade, comparison (A) and (B) |
| `grid.py`, `plan.py`, `jobs.py`, `run.py` | declared grids, job plans, job identity, the runner |
| `dev_select.py` | dev selection → `shortlists/shortlist-<cpu>.json` (frozen operating points, R, primary pairs) |
| `plans/h-<cpu>/` | held-out plans (frozen); `make_repair.py` makes plans of missing jobs only |
| `aws/` | launch, bootstrap and run scripts for the cloud machines (account values in a git-ignored `env.local`) |
| `analyze.py` | held-out results → `RESULTS-paper.md` and a JSON of every reported value (written after the freeze) |
| `merge_results.py` | merges per-CPU runs of `analyze.py --types` (Holm again over all primary comparisons) |
| `mem_patch.py` | memory column from the result headers (for JSON written before the memory-field fix) |
| `draft/` | the paper: `main.tex`, `sections/`, `mktex.py` (numbers and tables), `figures.py`, `refs.bib` |

## Rebuild every table and figure

Needs the released data (`DATA`: sets, vectors, ground truth) and results (`RESULTS`: one folder per machine).

```
python -I freeze_check.py FREEZE.json ../../../..                       # frozen files unchanged (REPO root)
for t in intel amd arm box mac; do
  python -I analyze.py --data DATA --results RESULTS --shortlists shortlists --builds BUILDS \
         --types $t --out parts/R-$t.md --json parts/J-$t.json &
done; wait
python -I merge_results.py --parts parts --out RESULTS-paper.md --json results-paper.json
python -I mem_patch.py --results RESULTS --json results-paper.json
python -I draft/mktex.py results-paper.json --extra draft/extra.json  # draft/numbers.tex, draft/tables/
python -I draft/figures.py results-paper.json                         # draft/figures/ (needs matplotlib)
cd draft && tectonic main.tex
```

`analyze.py --need-lists FILE` lists the retained-list files the analysis reads (the lowest round of every
point), so a reader can fetch those instead of every result.

## Add a system

1. An adapter with the common interface (`adapters/common.h`: build, load, search → vector ids and scores).
2. Its family, build grid and search grid in `grid.py` (and `plan.py` for its effort key).
3. Build, run the dev plans, `dev_select.py`; the analysis needs no change.

## Data discipline

Dev queries only before the freeze; held-out results are reported as aggregates only. See `PAPER_PLAN.md` §2.
