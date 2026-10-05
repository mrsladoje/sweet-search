# Final comparison — PLAN.md section 7 (2026-10-04)

The final code is cheaper than the old code on all three harnesses, at equal score. It is cheaper
than native on Claude Code and opencode. It is more expensive than native on Codex, because of two
harness effects that the traces identify (prompt cache, slow first calls), not because of ss-* output.

## Setup

- Questions: 30 DEV questions, frozen before the run (seed 42; `questions.json`): 12 easy (r3 DEV),
  18 hard (r3-hard DEV), none of the 11 micro-smoke questions. No held-out question.
- Arms: **before** = d013b492 (before the OBSERVATIONS loop) with an index built by that code;
  **after** = final code (`final-prep`, 6b50d7c5 for the run) with the PLAN 6.1 index; **native** = no
  sweet-search. Same bench, judges and cost code for every arm.
- Reps: 2 for before and after, 1 for native. 150 rollouts per harness, 0 failed rows.
- Intervals: 95% bootstrap over questions. `*` = the interval excludes 0.
- opencode rows include subagent spend (fixed in f8071f6b; before the fix, 3 native rows missed $0.27).
- Index check (PLAN 6.2): GCSN dev MRR@10 87.01% (baseline 86.48%); no language below baseline.

## Results (pooled, 30 questions)

| Harness | Contrast | Billed cost | Cost without cache | Calls | Score |
|---|---|---|---|---|---|
| Claude Code + Opus 5.5 | after − before | **−8.4%*** [−13.8, −1.9] | −14.4%* | −16.4%* | +1.6% [−2.1, +6.0] |
| | after − native | −5.2% [−12.0, +1.9] | −12.3%* | −27.3%* | −2.3% [−6.3, +1.7] |
| Codex + Sol 6.1 | after − before | −4.5% [−13.6, +4.8] | −8.1% | −10.1%* | −0.6% [−7.4, +6.0] |
| | after − native | **+24.6%*** [+9.8, +41.4] | +49.9%* | +2.3% | −4.3% [−9.8, +0.7] |
| opencode + Sol 6.1 | after − before | −9.0% [−17.3, +0.3] | −12.4%* | −3.6% | +2.8% [−1.7, +8.6] |
| | after − native | **−30.1%*** [−42.9, −14.4] | +1.9% | −16.7%* | −2.4% [−5.8, +0.8] |

Easy and hard tiers, per-question swings: `ANALYSIS.md`.

## What the traces show (every call of the biggest swings read)

- **No score loss is a regression of the after code** (TRACES-cc.md, TRACES-codex.md, TRACES-oc.md).
  Losses are the model stopping one hop early in some reps, or judge variance on answers of equal
  substance (the same arm varies by more between reps than the gap between arms).
- **Where after saves:** full hit lines in ss-grep replace reads (sequel-08, okhttp-12, composer-11);
  `-g '!<glob>'` replaces native pipes; the new chunker and exact ranges show the code, not only its
  doc comment (dgraph-29).
- **Codex is more expensive than native for two harness reasons** (TRACES-codex.md):
  1. Prompt cache (about 120% of the gap before offsets): the sweet arms replace the stock Codex base
     prompt, so they lose the cached stock prefix. Native gets 12,288 cached tokens on every first
     request; sweet gets 7,168–14,208.
  2. Polls: an ss-* call longer than Codex's 10 s yield returns empty and the model polls
     (+1.4 requests per question). The slow calls are cold or evicted daemons.
  ss-* output itself is 33% smaller than native rg/sed output. A replay with both effects removed
  gives after − native ≈ −6%.
- **Wall time** (Claude Code +18% vs before) comes only from first calls to cold daemons in the
  bench (the warmed daemons are evicted by the per-arm daemon cap); later calls are faster.

## Defects found and fixed in this work

| Defect | Fix |
|---|---|
| ss-search header claimed lines the body did not print, no omission marker | 507fa513 (`# not shown: lines A-B — ss-read …`) |
| opencode subagent spend missing from bench rows | f8071f6b |
| Daemon V8 heap cap 4 GB → OOM on large indexes; one shared registry for all bench cells | plan-defects (heap = 1/4 of the memory limit; per-cell registry; 90 s wait with a retry line) |
| JS/TS optional calls `fn?.()` gave no call edge | plan-defects |
| Index stamps broken by another session's daemons on the shared eval/repos | after arm reads private copies (`--after-repos`) |

## Next levers (not in PLAN.md; for the owner to decide)

1. **Codex: keep the stock base prompt byte-identical** and move the trim lines into
   `developer_instructions`. Expected −10 to −16 points of the Codex gap. Cheap check first: the
   cached tokens of first requests (a few cents).
2. **Keep ss-* calls under 10 s on the first call** (daemon warm-up/eviction, cold start). Expected
   −8 to −16 points on Codex; also removes the wall-time penalty everywhere.
3. Both together: Codex after − native ≈ −6% at equal score (replay estimate).
4. Bench: run native with 2 reps too; the single native rep limits the after − native intervals.

## Open caveats

- Native has 1 rep; after and before have 2.
- GCSN 87.01% ran on the GPU index path; the 86.48% baseline used the CPU INT8 path. CPU INT8
  batch embeddings are not deterministic (OBSERVATIONS.md), so per-language noise is about ±1 pt.
- All numbers are DEV. They are not held-out numbers and must not be published as such.
