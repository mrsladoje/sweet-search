# Dev rerun — 2026-10-05 (tag `dev1005`)

Current main is cheaper than native on Claude Code (not significant) and on opencode (significant). It is
more expensive than native on Codex, but by less than on 2026-10-04. Score is equal to native in all
three cells.

## Setup

- Questions: the same 30 frozen DEV questions as the 2026-10-04 final run (`questions.json`, seed 42;
  12 easy, 18 hard). No held-out question.
- Code: main at c4cbf49f (104 commits after the 10-04 "after" code 6b50d7c5: plan-merge, chunker-final,
  graph rounds 11–13, ss-search seed pool, grep and find fixes).
- Index: all 11 r3 repos rebuilt from scratch on the RunPod RTX 5090 (candle CUDA, bf16 embed,
  `--full --sqlite-fast --concurrency=1 --verbose`, one repo at a time). File counts are equal to the
  10-04 Mac (CoreML) indexes for all 11 repos. The bench read private copies (`~/.ss-eval/dev1005-repos`).
- Arms: sweet (current product) and native (stock harness). The before arm was not run (`FR_NO_BEFORE=1`).
- Reps: 2 for sweet, 1 for native. 90 rollouts per harness, 270 in total, 0 failed rows.
- Cells: Claude Code 2.1.281 + Opus 5.5 medium; Codex 0.159.2 + GPT-6.1 Sol high; opencode 1.18.4 +
  GPT-6.1 Sol high. All on subscriptions; cost = tokens × list price.
- Intervals: 95% question-clustered bootstrap, stratified by tier. `*` = the interval excludes 0.
- Driver: `FR_NO_BEFORE=1 FR_TAG=dev1005 FR_STATE=~/.ss-eval/dev1005 AFTER_COPY=~/.ss-eval/dev1005-repos bash run.sh start`.
  Wall time 06:42–08:09.

## Sweet vs native (pooled, 30 questions)

| Harness | Billed cost | Cost without cache | Calls | Score | 10-04 billed cost |
|---|---|---|---|---|---|
| Claude Code + Opus 5.5 | −3.8% [−12.5, +4.4] | −12.1% [−24.6, +1.4] | **−28.9%*** | +0.9% [−3.5, +6.0] | −5.2% |
| Codex + Sol 6.1 | **+13.4%*** [+2.2, +25.0] | +25.1%* | +6.8% | −0.3% [−4.4, +4.4] | +24.6%* |
| opencode + Sol 6.1 | **−37.5%*** [−45.6, −27.9] | −6.9% | **−24.8%*** | −3.0% [−8.2, +1.7] | −30.1%* |

Easy and hard tiers, per-question swings: `DEV1005-ANALYZE.md`.

## New run vs the 10-04 run, same arm (`DEV1005-COMPARE.md`)

| Harness | Sweet billed cost | Native billed cost | Sweet score | Native score |
|---|---|---|---|---|
| Claude Code | −4.9% [−10.4, +0.6] | −6.3% [−12.9, +0.3] | +0.8% | −2.4% |
| Codex | −3.7% [−13.4, +6.7] (no cache −14.8%*) | +5.7% | +0.3% | −3.8% |
| opencode | +10.7%* | +23.9%* | −0.4% | +0.2% |

The native arm did not change between the runs, but its cost moved by −6% to +24%. This drift is the
noise floor of a run-to-run comparison. The sweet arm's own changes are inside that floor, except the
Codex cost without cache (−14.8%*). So the new code costs the same as the 10-04 code, at the same score.

## Notes

- Cache fairness: Codex and opencode give a best-effort warning on the first wave, as on 10-04
  (Codex sweet replaces the stock prompt and loses its cached prefix). "incomplete" on rep 2 is expected:
  rep 2 has one arm only.
- The Codex gap to native shrank from +24.6% to +13.4%. The 10-04 traces name the two causes (stock
  prompt cache, polls on slow first calls). This run did not read traces.
- Pod indexes were also swapped into `eval/repos/*` and the 18 P7 repos; the old indexes are in
  `~/.ss-eval/index-backup-20261005/`.
