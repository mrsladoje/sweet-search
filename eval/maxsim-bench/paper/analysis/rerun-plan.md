# Post-freeze rerun: BEIR on a second instance per cloud type (written before the run)

Written 2026-10-17, before any instance of this rerun started. Approved by the owner on
2026-10-17 (reruns under four hours).

## Why

The first review round noted that the BEIR sets ran on one instance per cloud type, while
the instance-to-instance spread was measured only on the agent and GCSN sets (up to 13.1 %).
Several BEIR ratios are close to 1 (Intel PyTorch bfloat16 0.85, AMD NumKong 1.06, M3 Max
NumKong 0.99, Graviton4 PyTorch bfloat16 1.18). This rerun asks one question: do the BEIR
ratios repeat on a second instance of the same type?

## What runs

- Frozen code: the held-out bundle of commit `ea84951f` (the one the original BEIR groups
  ran with), unchanged. The analysis code is post-freeze (`paper/analysis/`).
- Sets: the 8 BEIR sets with k = 25 and k = 100 (both datasets x both models): the sets of
  the primary quality tests (k = 100) and of the busy-gap BEIR groups (k = 25, 100).
- Groups: the original `ho-warm` group lines of these sets, copied verbatim from each
  type's shard `groups-heldout.jsonl` (same arms, R = 5 process repetitions x 2 rounds,
  `--keep-scores`). Only change: on AMD the two BLIS NumPy arms are removed, because the
  setup script installs BLIS only on a machine named exactly `amd`.
- Machines: two new on-demand instances per type (c8i.4xlarge, c8a.4xlarge, c8g.4xlarge),
  us-east-1, names `<type>-r2a` (k = 100 sets) and `<type>-r2b` (k = 25 sets). No preflight
  fixtures in this mode (they passed on every instance of these types before).

## What is reported (fixed now)

- Per type and set group (k = 100, k = 25): the same warm ratio table as the main results
  (each frozen configuration; the faster per library and input type), on the rerun
  instance, beside the original instance; the relative difference per ratio (median and
  maximum) and whether any ratio changes sides of 1.
- The kernel's scores: bit-identical to the original run on the same type (expected).
- No tuning, no change of any claim threshold after seeing the result. If a ratio changes
  sides of 1, the paper reports the case as not reproducible on a second instance.
- The result goes into the instance-to-instance spread section and the deviations appendix.
