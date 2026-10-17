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

# Post-freeze rerun: parallel callers with a fixed harness (written before the run)

Written 2026-10-17 ~17:20 UTC, before any run of it. Approved by the owner on 2026-10-17.

## Why

The three reviews of the first draft found four defects in the frozen parallel-caller
harness (`concurrency.py`): callers of the per-process executor started up to 50 ms
before the recorded start; a fixed thread count in an arm overrode the per-process budget
(oversubscription); the BLIS environment was ignored; every configuration ran once for
20 to 500 ms, and the two executors warmed up differently.

## What runs

- Harness: `rerun/concurrency2.py`, a copy of the frozen harness with exactly these four
  fixes (its header lists them): a common busy-waited start with recorded real start
  times; in the per-process executor a fixed thread count is capped at max(1, cores // N);
  arms with an environment part (BLIS) are left out; every closed-loop caller replays its
  share until at least 3 s have passed, every open-loop trace has at least 3 s of
  arrivals, every configuration runs 3 times, and both executors warm up every call.
- Everything else unchanged: the frozen `ho-conc-agent-ho` / `ho-conc-gcsn-ho` group
  lines of each machine (same arms, sets, callers 1/4/16, both executors, the frozen
  absolute open-loop rates, seed 42), the frozen kernel and adapters (`bench.py`).
- Machines: the cloud instances of the BEIR rerun after their BEIR groups (agent-ho on
  `<type>-r2a`, gcsn-ho on `<type>-r2b`); the M3 Max and the EPYC box after the HNSW
  session's timing window, one machine at a time per set.

## What is reported (fixed now)

- Closed loop per CPU, set, executor and caller count: median throughput over the 3 runs
  and its range; sweet / best exact rival and sweet / best NumKong configuration.
- Open loop: per-request p50 / p99 (median over runs) and the achieved rate; an arm that
  achieves less than 95 % of the offered rate is marked as overloaded.
- These results replace the frozen single-run parallel-caller results in the main text;
  the frozen results move to an appendix with their correction. No other number changes.
- No tuning and no threshold change after seeing the results.

# Post-freeze measurement: fixed cost per call (written before the run)

Written 2026-10-17 ~20:00 UTC, before any run of it. Asked for by an external review of the
draft ("time every arm on a minimal call to get each binding's fixed-cost floor"); approved by
the owner on 2026-10-17 together with the other review fixes.

## What runs

- Script: `rerun/floor.py`, frozen kernel and adapters (`bench.py` build functions), no
  change to them. Development data only (`agent-dev`); the token values do not matter.
- Arms: per CPU, `ours`, `ours@1` and every frozen agent-family configuration of the
  shortlist (primary, `also`, one-thread), without environment arms (BLIS, MKL).
- Two shapes: the floor call (one query token, one candidate of one token, cut from the
  first development call) and the median development call (median of query tokens x
  candidate tokens).
- Per arm, 3 fresh processes in rotated arm order; per process 200 untimed warm-up calls,
  then 5 rounds (1,000 floor calls or 200 median calls); the per-round median is kept.
- Machines: the six cloud rerun instances after their parallel-caller rerun; the M3 Max and
  the EPYC box after the HNSW session's timing window.

## What is reported (fixed now)

- Per CPU and arm: floor time (median over processes, and the range), median-call time, and
  the share floor / median-call time.
- Used only to describe how much of a typical call is fixed cost per library. No claim
  threshold, no tuning.

# Post-freeze checks from the external reviews (written before the runs)

Written 2026-10-17 ~20:30 UTC, before any run of them. Approved by the owner on 2026-10-17
together with the other review fixes.

## Float32 storage, measured directly (`rerun/f32direct.py`)

- Why: the paper's float32-storage line combined the quality of contract F with the time of
  the fastest float32 rival on the int4-decoded vectors. A review asked for a direct
  measurement.
- What runs: on the M3 Max only, the four k = 100 BEIR sets; arms `numpy_packed`,
  `numpy_packed@12` and `torch_pad_flat` (the rivals that the line used on that CPU). Each arm
  scores the original float32 token vectors and the int4-decoded vectors, per call in
  alternating order, 3 rounds x (1 warm-up + 5 timed repetitions).
- Reported: per cell and arm, nDCG@10 from the arm's own scores and per-request p50 / p95 for
  both variants, and the p95 ratio original / decoded. If the ratio is within the noise band of
  the M3 Max, the constructed line stands and the paper says so; if not, the paper reports the
  measured line. Aggregates only.

## ColBERTv2 document length (`rerun/colbert300.py`)

- Why: float32 ColBERTv2 reranking scored below the BM25 order on SciFact. ColBERTv2's
  default document length (180 tokens) cut about 9 in 10 BEIR documents.
- What runs: on the M3 Max, ColBERTv2 (same revision) encodes the BM25 top-100 documents and
  the queries of both datasets again at 180 tokens (control) and 300 tokens; nDCG@10 of
  contract F for each.
- Reported: the four values. The 180-token control must match the paper's F value; if it does
  not, the paper says so. No test of the paper changes: the tests compare storage formats on
  the same vectors.
