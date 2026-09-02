# scripts-wrongfix-facts

Evidence scripts for `../wrongfix-facts.md` (Slate C forensics, 2026-09-02).

- `extract-cells.mjs` — run ON THE BOX (`/tmp/wf-slatec/wrongfix-facts/`). Reads the three fresh-pool TAB runs
  plus the opencode repair pass, exports issue text (problem_statement only), gold-free counts, and every
  recorded agent patch per harness x arm x rep to `cells.json`. Never exports gold patch, test patch or test names.
- `census-wrongfix.mjs` — run locally on `data/cells.json`. Classifies each agent patch into the wrong-fix
  classes used in the report (surface patterns over the agent's own patch text). Output: `data/census-output.txt`.
- `data/cells.json` — the extraction (194 cells; the 15 `fp-opencode-tab` sweet rows for the 5 repaired tasks
  are superseded by `rp-oc-tab-20260827` and are dropped by the census).
- `data/cell-digest.tsv` — one row per canonical cell (180 rows) with outcome, f2p, calls, hunks, files, rollout file.

Box scratch used: `/tmp/wf-slatec/wrongfix-facts/` (read-only access to `results/` and `/root/.ss-eval/golden/`).
