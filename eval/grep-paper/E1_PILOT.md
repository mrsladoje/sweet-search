# Dev replay and E1 pilot with Gate A (2026-10-20)

**Conclusion.** Gate A does not report "low observed prevalence". At definition level, the agent's own cut
hid all L1 evidence in **28.6%** of 500 evidence-bearing pilot calls (cluster interval 23.9–32.6%). The
threshold is about 5%. The full dev pool gives the same picture: 27.2% of 1,380 calls. The shipped
selector lowers the pilot rate to 13.8% (15.4% on the full pool). These are dev numbers only. No held-out
call was replayed or read.

Sources: `mine/replay.py` at 56d7c604 (records), `mine/tune.py` (Gate A, `gate_a.json`),
`mine/replay_report.py` (replay tables). Data: `~/.ss-eval/grep-paper/replay-dev/` and
`~/.ss-eval/grep-paper/tuning/`. Replay of the cut calls: 01:16–02:17 CEST, 6 jobs, GNU grep 3.12.

## 1. Replay of the eligible cut calls (SWE-rebench-V2, dev repositories)

| Harness | Calls | O+ | O | X | Agree (O+ and O) |
|---|---:|---:|---:|---:|---:|
| unknown | 3 | 0 | 0 | 3 | 0.0% |
| minisweagent | 1,642 | 1 | 1,497 | 144 | 91.2% |
| openhands | 2,593 | 5 | 2,308 | 280 | 89.2% |
| sweagent | 3,613 | 2 | 3,191 | 420 | 88.4% |
| **All** | 7,851 | 8 | 6,996 | 847 | 89.2% |

Tiers: O = every visible line comes back in the replay, in order. O+ = O, and a count observation in the
same trace (`wc -l`, `-c`) also agrees. X = no agreement; the call is out.

Tier X reasons: visible lines not in the replay 744; path outside the repository 76; checkout failed 16;
unsupported upstream 5; command error 3; harness error 3. The 50-call test showed that most
"not in replay" cases come from files that the task setup made (`node_modules`, `build/`), which a plain
checkout does not have.

## 2. Overflowing calls

- 6,485 of 7,004 agreeing cut calls overflow (92.6%): the full output is longer than the budget.
  3,659 tasks, 911 repositories.
- Full output: median 40 lines, 90th percentile 134, maximum 36,475.
- Files in the full output: median 11, 90th percentile 47.
- Full lines divided by visible lines: median 1.8.
- **Share of matching files that the agent saw** (the travelling figure): mean 61.4%, median 62.5%.

| Agent's limit N | Calls | Mean share of matching files seen |
|---|---:|---:|
| 5 | 864 | 49.3% |
| 10 | 1,403 | 57.2% |
| 20 | 1,812 | 62.2% |
| 30 | 1,075 | 65.9% |
| 40 | 625 | 69.8% |
| 50 | 385 | 63.6% |
| 60 | 172 | 76.6% |
| 80 | 55 | 79.3% |

## 3. Evidence-bearing base (L1 evidence in the full output)

| Level | Evidence-bearing overflowing calls | Share of overflowing |
|---|---:|---:|
| definition (primary) | 1,380 | 21.3% |
| file | 1,832 | 28.3% |
| line (strict) | 628 | 9.7% |

Base 6,474 overflowing calls in `tune.py`. `replay_report.py` counts 6,485 and 1,384 at definition level.
The small difference comes from two rendering rules: `tune.py` renders context groups with `--` lines, and
it uses only `ev_D` for the definition level. Gate A uses the `tune.py` numbers.

**Pool size.** The plan expected about 1,700 evidence-bearing calls at definition level; the replay gives
1,380 (81% of the plan). The yield check measured 40% evidence-bearing at file level with looser matching;
the replay gives 28.3% at file level and 21.3% at definition level. The plan says to resize before the
held-out run if the pool is much lower. This is an owner decision.

## 4. E1 pilot and Gate A

Pilot: 500 evidence-bearing calls at definition level, seed 42; 491 trajectories, 467 tasks,
278 repositories. Budget N = the agent's `head -N`, or the visible lines for a harness cut. Intervals
are 95% cluster bootstrap intervals by repository (2,000 resamples, seed 42).

### Definition level (primary)

| Policy | Pilot misses | Pilot rate (interval) | All dev (n = 1,380) |
|---|---:|---:|---:|
| As seen (the agent's real cut) | 143 / 500 | **28.6%** (23.9–32.6%) | 27.2% (24.4–29.9%) |
| Native order (APFS replay) | 162 | 32.4% (28.0–36.4%) | 32.5% |
| Sorted path order | 128 | 25.6% (21.7–29.5%) | 26.0% |
| Round robin over files | 84 | 16.8% (13.4–20.0%) | 18.4% |
| Frequency order (most hits first) | 196 | 39.2% (34.3–43.9%) | 39.6% |
| **Shipped selector** | 69 | **13.8%** (10.6–16.9%) | 15.4% (13.1–17.8%) |
| Shipped selector + summary header | 80 | 16.0% (12.8–19.1%) | 16.9% |
| Oracle (evidence first) | 0 | 0.0% | 0.1% |

### File and line levels (same 500 pilot calls)

| Policy | File level | Line level (strict) |
|---|---:|---:|
| As seen | 23.2% | 12.0% |
| Native order | 27.4% | 14.2% |
| Sorted path order | 19.6% | 13.0% |
| Round robin | 6.0% | 8.8% |
| Frequency order | 35.0% | 18.2% |
| Shipped selector | 5.2% | 7.6% |
| Shipped selector + header | 6.0% | 7.6% |
| Oracle (definition evidence first) | 0.0% | 0.6% |

On the file and line bases of the full dev pool, the oracle orders by definition-level evidence, so it is
not an upper bound there (file base: oracle 8.6%, shipped 4.6%).

### Paired counts on the pilot (definition level)

| Comparison | Recovered | Newly lost | Net |
|---|---:|---:|---:|
| Shipped selector vs as seen | 96 | 22 | +74 |
| Shipped selector + header vs as seen | 91 | 28 | +63 |
| Shipped selector vs round robin | 21 | 6 | +15 |
| Shipped selector + header vs round robin | 16 | 12 | +4 |

- The selector reaches its phase 2 (more than one item per file) in 378 of 500 pilot calls.
- Sensitivity of the as-seen rate to reconstruction error (each hidden record dropped with probability r,
  seed 42): r = 0.05 → 27.0% (371/1,375); r = 0.10 → 26.5% (362/1,366); r = 0.20 → 25.5% (343/1,347).
  The rate is stable.
- Other bases for the as-seen definition-level misses (376 calls): 5.8% of all overflowing calls and 5.4%
  of all usable cut calls. The 5% threshold applies to the evidence-bearing base (plan §2).

### Gate A decision

The as-seen definition-level miss rate (28.6%, lower bound 23.9%) is far above about 5%. **Gate A: the
paper keeps the truncation-loss framing.** The pilot does not test harm; harm is a question for the agent
experiments.

## 5. Replay agreement on uncut calls (a diagnostic)

4,000 eligible uncut dev calls (seed 42), replayed 02:17–02:54 CEST. Tier F = the replay prints exactly
the visible output.

| Visible lines | Calls | F (agree) | X | Agreement |
|---|---:|---:|---:|---:|
| ≤10 | 3,284 | 3,118 | 166 | 94.9% |
| 11–30 | 564 | 539 | 25 | 95.6% |
| 31–100 | 145 | 135 | 10 | 93.1% |
| 101–300 | 7 | 6 | 1 | 85.7% |
| **All** | 4,000 | 3,798 | 202 | 95.0% |

Tier X reasons: output differs 163; path outside the repository (Go module cache, site-packages, cargo
registry, `/workspace`) 20; checkout failed 5. The uncut agreement (95.0%) is higher than the cut
agreement (89.2%). I did not study the cause tonight.

## 6. Limits

- Dev only, SWE-rebench-V2 only. Scale-SWE needs the image HEAD (plan) and is not in this replay.
- Definition spans are heuristic (Python `ast`; brace matcher for C-like languages; `end` for Ruby).
  tree-sitter is not installed. The gold-file text is stored, so the labels can be redone offline.
- For harness cuts (380 calls in the census), the budget is the visible line count, which approximates a
  character limit.
- The edit detector (v3) agrees with blind annotators on 48 of 50 fresh calls (`CENSUS.md`).
