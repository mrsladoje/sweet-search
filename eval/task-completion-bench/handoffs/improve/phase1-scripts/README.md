# Phase-1 gate scripts

Every measurement in [`PHASE-1-RESULTS.md`](../PHASE-1-RESULTS.md) comes from one of these.
All are **read-only** over the evidence box and cost `$0` — no model is invoked anywhere.

Run them by piping to the box, which is how they were run originally and which writes nothing
to the host except under `/tmp`:

```bash
ssh root@167.233.69.121 'node -' < <script>.mjs
# or, when the script takes arguments:
ssh root@167.233.69.121 'cat > /tmp/s.mjs && node /tmp/s.mjs <args>' < <script>.mjs
```

They import `harness/ideal-cost.mjs` from the box's own copy of the repo, so the pricing
arithmetic is the same code path the runner uses. They read `results/<run>/rows.json`, the raw
transcripts under `results/<run>/agent-state/`, and the base checkouts in `/root/.ss-eval/golden`.

## Order

| script | what it establishes |
|---|---|
| `01-sidechain-usage-classification.mjs` | the first-record-wins defect: which delegated requests are recoverable and which are absent |
| `02-block-split-content-loss.mjs` | how much assistant content the same defect discards (6.6× on main transcripts) |
| `03-imputation-calibration.mjs` | whether the context identity holds, and how well output tokens can be predicted |
| `04-sidechain-repair.mjs` | the repaired LOW/MID/HIGH inclusive column, with the 0.5% main-only reproduction gate |
| `05-corrected-headline.mjs` | the `screen-v3` headline on the repaired column, with the degenerate sensitivity |
| `gate2-c4-wholefile-replay.mjs` | C-4 optimistic token replay, swept over the line threshold |
| `gate3-c2-routing-loto.mjs` | C-2 leave-one-task-and-repo-out router, plus a 13,892-rule robustness family |
| `gate4-c3-context-reset.mjs` | C-3 context-reset simulation, swept over handoff size |
| `gate5-c9-edit-census.mjs` | post-C-1 failed-edit population, classified |
| `gate5-c9-addressability.mjs` | C-9 symbol addressability and the residual round-trip cost |
| `gate6-c5-dependency-audit.mjs` | external references in all 18 issues; the `pytask` evidence check |
| `gate789-preconditions.mjs` | C-6's base-tree premise and C-8's patch-pool diversity |
| `gate10-r1-localization-timing.mjs` | how many calls before the first-edit file appears |
| `gate10-r1-breakeven.mjs` | dossier carrying cost against removed early requests |
| `gate10-r1-top5.mjs` | top-5 localisation upper bound from each rollout's first retrieval call |

`04-sidechain-repair.mjs` writes `/tmp/rows-sidechain-repaired-<run>.json`, which
`05-corrected-headline.mjs` and `gate3-c2-routing-loto.mjs` then read. Run it first.

## What they do not do

They never read `patch`, `test_patch`, `FAIL_TO_PASS` or `PASS_TO_PASS` from the task file. Where
task metadata is needed — repo, base commit, language, problem statement — only those fields are
touched, and `gate3` says so in a comment at the read site. `gate789` inspects the `bingo` **base**
tree only.
