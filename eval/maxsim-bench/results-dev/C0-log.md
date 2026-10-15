# C0 log — kernel tuning on dev data (PAPER_PLAN.md S5.5–S5.7)

Every candidate, kept or dropped, with its numbers. Dev sets only (`agent-dev`, `gcsn-dev`,
`sweep-dev`). Rules: keep a change only if the geometric-mean warm speedup on the target
machine is ≥ 3 % **and** above the noise band `n` in both rounds (round 0 forward, round 1
reversed); no machine that runs the same code path may be slower by more than `n`; the
accuracy gate must pass (a change that keeps the order of arithmetic is bit-identical:
`parity.mjs`, 0 diffs). Unclear after two rounds → drop.

Base kernel: `66e4f08d` (source unchanged to HEAD `6d45642b`).
Tools: `c0_ab.py` (speedup per set and round = geometric mean over calls of base / candidate
per-call median of 5 timed repetitions; identical-score count), `parity.mjs` (production
addon, every f64 with `Object.is`, edge-case fixtures + every dev call), one process per arm,
`--max-busy 10`.

## Machines

| name | type | CPU | cores × threads | vector units |
|---|---|---|---|---|
| `prep` | c8i.4xlarge | Intel Xeon 6975P-C (Granite Rapids) | 8 × 2 | AVX-512 F/VL/BW/DQ, AMX |
| `prep-amd` | c8a.4xlarge | AMD EPYC 9R45 (Zen 5) | 16 × 1 | AVX-512 F/VL/BW/DQ |

## Noise (A/A, `prep`, 2026-10-15)

`ours~base` vs a byte copy, 5 process repetitions × 2 rounds.

| set | cv of the set geometric mean | band n = max(1 %, 2 cv) |
|---|--:|--:|
| agent-dev | 0.78 % | 1.55 % |
| gcsn-dev | 1.10 % | 2.19 % |

## Candidate 1 — AVX-512 path for the 4 × 2 block (x86_64)

**Mechanism.** On AVX-512 CPUs the kernel ran its 8-lane AVX2 block. The FMA chains of
`dot_avx2_fma` (four 8-lane chains per pair) fit two per 16-lane register: lanes 0–7 and
8–15 of a 16-float load at `32m` are exactly the floats of chains 0 and 1. So the block
issues half the FMA and load instructions for the same arithmetic. The fold keeps the
grouping of every addition, so scores stay bit-identical. Dispatch: runtime `avx512f`
(+ AVX2 + FMA); the AVX2 and NEON paths are unchanged (arm64 disassembly identical).

**Accuracy gate (`prep`).** `parity.mjs base.node c1.node`: PARITY OK, 0 diffs on the
fixtures and every call of agent-dev, gcsn-dev and all 24 sweep-dev cells. `c0_ab.py`:
identical scores on 8,474 / 8,474 agent+gcsn call comparisons and 414 / 414 sweep.

**A/B on `prep` (Granite Rapids), speedup base / c1:**

| set | round 0 | round 1 | verdict |
|---|--:|--:|---|
| agent-dev (655 calls) | 1.085 | 1.104 | ≥ 3 % and > n (1.55 %) in both |
| gcsn-dev (3,582 calls) | 1.085 | 1.083 | ≥ 3 % and > n (2.19 %) in both |
| sweep-dev (207 calls, pooled) | 1.047 | 1.037 | faster; large cells 1.06–1.33 |

One sweep cell, `q32-d16-len512` (12 calls), was 0.754 / 0.749. Its repetitions are
bimodal (about 150 µs, or 350 µs – 4 ms from scheduling delays) for both builds, and the
per-call median falls in either mode; the fast mode is the same for both builds. Noise, not
a regression (the same cell flips between rounds in other comparisons).

**Zen 5 (`prep-amd`, the same code path).** A/A band n = 1.99 % (agent-dev, cv 0.99 %),
1.83 % (gcsn-dev, cv 0.91 %). `parity.mjs base.node c1.node`: PARITY OK (bit-identical).
Speedup base / c1:

| set | round 0 | round 1 |
|---|--:|--:|
| agent-dev | 1.113 | 1.124 |
| gcsn-dev | 1.101 | 1.091 |
| sweep-dev (pooled) | 1.158 | 1.217 (cells 0.85–1.47; 23 of 24 cells faster in both rounds) |

**Status: kept** (≥ 3 % and above the band in both rounds on both AVX-512 machines;
bit-identical on both). Machines without AVX-512 (EPYC Milan box, M3 Max, Graviton4) do not
run this code (runtime dispatch; arm64 code identical), so S6b has no change to check.

## Candidate 2 — call-size thread rule (x86_64, SMT machines)

**Mechanism.** On an SMT CPU, small calls are dominated by the pool's hand-off and by
sibling threads that share a core. With candidate 1, 8 threads (one per physical core)
against 16, per call by work (query tokens × doc tokens), `prep`:

| work | calls | t8 / t16 time |
|---|--:|--:|
| 2^11 – 2^13 | 194 | 0.80 – 0.85 |
| 2^14 – 2^17 | 4,124 | 0.92 – 0.94 |
| 2^18 – 2^19 | 70 | 1.085, 0.934 (mixed) |
| 2^20 – 2^24 | 33 | 1.05 – 1.19 |
| 2^25 – 2^27 | 9 | 0.97 – 1.03 |

(set level: agent-dev t8 faster by 8.8 % / 7.9 %, gcsn-dev 12.1 % / 4.3 %.)

**Change.** Pool size unchanged (all logical CPUs). A call below `SMALL_CALL_WORK = 2^18`
uses one thread per physical core: the other workers (the "extra group") do not join; they
park on their own condition variable, so a small call never wakes them and they do not spin
beside working threads. Larger calls wake and use all. Physical cores from Linux sysfs
(`core_cpus_list`); the rule is off without SMT, with a CPU mask or quota, or with
`SS_MAXSIM_THREADS`. All new code is `cfg(target_arch = "x86_64")`; the arm64 disassembly
is identical to the base kernel.

**Accuracy gate.** `parity.mjs base.node c2.node`: PARITY OK (bit-identical), all dev sets.

**A/B on `prep`, speedup c1 / c2 (threshold 2^18):**

| set | round 0 | round 1 | verdict |
|---|--:|--:|---|
| agent-dev | 1.024 | 1.016 | below 3 % in both rounds |
| gcsn-dev | 1.066 | 1.055 | passes |
| sweep-dev (pooled) | 0.910 | 1.056 | mixed; several cells slower in both rounds (q8-d16-len512 0.74 / 0.81, q32-d256-len512 0.88 / 0.88, q32-d4096 0.91–0.96) |

**Verdict: dropped** (agent-dev below 3 %). Check of the gap to the plain 8-thread pool:
c2 vs `c1@8` on agent-dev 0.975 / 0.948 (c2 slower), gcsn-dev 0.991 / 1.033; a repeat of
`c1` vs `c1@8` gave agent-dev 1.071 / 1.033 and gcsn-dev 1.127 / 1.042 (the 8-thread gain
itself varies from run to run). Likely cause: a call just above the threshold must wake the
parked extra group, and that wake-up is a large share of a short call; the threshold came
from runs where all 16 threads were awake.

## Candidate 2b — the thread rule with `SMALL_CALL_WORK = 2^20`

One revised attempt, with the crossover of the AVX2 data. Fresh A/B, speedup c1 / c2b:

| set | round 0 | round 1 | verdict |
|---|--:|--:|---|
| agent-dev | 0.987 | 1.080 | unclear (one round slower) |
| gcsn-dev | 1.086 | 1.033 | passes |
| sweep-dev (pooled) | 1.124 | 0.921 | unclear |

Parity OK (bit-identical). **Verdict: dropped** (unclear after two rounds; no extra rounds).
The thread rule is out. Small calls on this SMT machine vary too much between runs for a
rule of this size to pass the C0 rules.

## Summary (Granite Rapids)

| candidate | change | gate | verdict |
|---|---|---|---|
| 1 | AVX-512 4 × 2 block, same summation order | bit-identical | **kept** (Granite Rapids and Zen 5) |
| 2 | thread rule, 2^18 | bit-identical | dropped (agent-dev < 3 %) |
| 2b | thread rule, 2^20 | bit-identical | dropped (unclear) |
