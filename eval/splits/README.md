# Benchmark Splits — Dev / Held-Out

This directory holds the canonical dev/held-out splits for every benchmark
sweet-search optimises against. Splits are the **methodology scaffolding**
required by the rule documented in [`CLAUDE.md`](../../CLAUDE.md) and
[`AGENTS.md`](../../AGENTS.md):

> Every benchmark used during optimisation MUST be split. Dev (60%): iterate
> freely, inspect per-query results. Held-out (40%): NEVER inspect per-query
> during dev; only aggregate metrics, only at milestones.

Splits live in JSON files keyed on the **stable query/probe ID**. Runners
read the file and filter — they don't need to know how the split was made.

## Layout

```
eval/splits/
├── README.md                    # this file
├── gencodesearchnet/
│   ├── dev.json                 # { "ids": ["GC00000", ...] }
│   ├── heldout.json
│   └── manifest.json            # seed, stratification, counts
├── multirepo/
│   ├── dev.json
│   ├── heldout.json
│   └── manifest.json
└── retrieval-probes/
    ├── dev.json
    ├── heldout.json
    └── manifest.json
```

## Methodology

| Bench               | N    | Stratify by | Ratio | Dev / Held-out |
|---------------------|------|-------------|-------|----------------|
| `gencodesearchnet`  | 6000 | language    | 60/40 | 3600 / 2400    |
| `multirepo`         | 479  | repo        | 60/40 | 287  / 192     |
| `retrieval-probes`  | 20   | repo        | 70/30 | 13   / 7       |

- **Stratified random sampling** with a fixed seed (`seed = 42`).
- Each stratum gets its own sub-seed (derived from the global seed XOR'd with
  a stable hash of the stratum name) so adding a new stratum doesn't reshuffle
  existing strata.
- Output IDs are sorted within each split file so diffs are reviewable.
- Splits are **idempotent**: running the generator twice produces byte-identical
  output.

The retrieval-probes use 70/30 (not 60/40) because the corpus is small enough
that 60/40 produces only 12 dev probes — too few for an iteration regression
set. With 13 dev / 7 held-out, the dev set is still big enough to catch
regressions and the held-out is still ~35% of the corpus.

`gencodesearchnet` and `multirepo` use the canonical 60/40.

## Usage from runners

All three benchmark runners accept `--split=dev|heldout|all`:

```bash
# Iteration — fast feedback, dev only
node eval/run_benchmark.js --dataset=gencodesearchnet --split=dev
node eval/scripts/multirepo-bench.js --split=dev
node eval/retrieval-probes/run-probes.mjs --split=dev

# Milestone validation — held-out only
node eval/run_benchmark.js --dataset=gencodesearchnet --split=heldout
node eval/scripts/multirepo-bench.js --split=heldout
node eval/retrieval-probes/run-probes.mjs --split=heldout

# Full bench — only when publishing or comparing tools (default)
node eval/run_benchmark.js --dataset=gencodesearchnet            # = --split=all
```

A non-blocking warning prints when `--split=all` is used as a reminder that
full-set runs are for milestones only.

## Regenerating

```bash
# Regenerate all splits (idempotent — same output as last commit if source data unchanged)
node eval/scripts/generate-splits.js

# Regenerate only one bench
node eval/scripts/generate-splits.js --bench=gencodesearchnet

# CI sanity check — verify on-disk splits match what the generator would produce
node eval/scripts/generate-splits.js --check
```

If `--check` fails, either:

- The source data changed (queries added/removed). Regenerate and commit.
- The split files have been hand-edited. **Don't do this.** Regenerate.

## When to regenerate

Regenerate when:

1. The underlying query set changes (new queries, removed queries, new repos).
2. The split ratios in `eval/scripts/generate-splits.js` change (rare;
   requires team alignment).

**Do not** regenerate as a way to "shake up" the split because dev results
look bad — that defeats the purpose of having a held-out set in the first
place.

## What goes where (rule of thumb)

| Activity                                          | Run on        |
|---------------------------------------------------|---------------|
| Per-change loop (you, an agent, CI on a PR)       | `dev`         |
| Pre-commit smoke test                             | `dev`         |
| Milestone evaluation, paper numbers, release      | `heldout` + `dev` (compare; if held-out diverges from dev, the change overfit) |
| Coarse comparison vs another tool (full-bench)    | `all`         |

If a held-out regression appears that didn't show on dev: the dev set is too
narrow OR the change overfits. **Do NOT tune to fix the held-out failure.**
Step back, identify the missing principle, and re-iterate on dev only.
