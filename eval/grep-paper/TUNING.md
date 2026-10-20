# Ranking tuning round on dev (GREP_PAPER_PLAN.md §5.4, step S3b)

**Status.** Part 1 (this section) was written and committed on 2026-10-20 at about 01:15 CEST, before
the dev replay finished and before any tuning result existed. Part 2 holds the results. Nothing in
part 1 changes after a result is seen. The selector is **not** frozen by this round, and the product
ranking does not change (owner decision).

## Part 1. Fixed before the round

### Data
- Frozen dev replay records (`~/.ss-eval/grep-paper/replay-dev/records-cut.jsonl.gz`, harness 9977bd35):
  SWE-rebench-V2 cut calls, dev repositories only, tiers O and O+, with a real overflow (full output
  longer than the budget), and **definition-level L1 evidence in C** (evidence-bearing overflowing).
- Budget N: the agent's own `head -N`. For a harness cut, N is the number of visible lines (an
  approximation of the character limit, the same for every policy).
- No repository access, no API, no held-out record.

### Rendering and scoring
- Items: without context flags, one output line is one item. With `-A/-B/-C`, one item is one context
  group (consecutive lines of one file); every item after the first costs one more line for grep's `--`.
- A policy orders the items; the first N lines are shown (`head -N` cuts inside an item if needed).
- Levels: definition (primary), file, line. For `-l`/`-c` calls (file records), the definition level uses
  the file label.
- **Truncation miss:** C holds evidence at the level, and no shown record carries it.
- **Primary score:** out-of-fold truncation-miss rate at N, without the summary header, definition level.
  Results with the header (N−1 lines for records) are reported beside it.

### Shipped selector (reference)
`mine/ranker.py` at 9977bd35 (the pilot stand-in for the shipped algorithm since 945a9664): weight
w = h/(h+k) × prior, k = 2, priors source 1 / test 0.5 / generated 0.25; every file admitted, sorted by
(−w, path); phase 1 one item per file; phase 2 Sainte-Laguë w/(2s+1); declarations first inside a file.
The tuning code reproduces it from parameters; a check asserts equal orders on no-context calls.

### Candidate list (one change from the shipped selector per family)

| # | Family | Values |
|---|---|---|
| 1 | Saturation constant k | 1, 2 (shipped), 4, 8 |
| 2 | File-kind priors | test ∈ {0.25, 0.5, 1.0} × generated ∈ {0.1, 0.25, 0.5} (shipped 0.5, 0.25) |
| 3 | Declarations first | always (shipped), never, only for definition-shaped patterns |
| 4 | Test prior by intent | off (shipped); on = test prior 1.0 when the pattern or a path operand targets tests |
| 5a | Search term in the file path | weight × b for files whose path contains a pattern term; b ∈ {1 (off), 1.5, 2} |
| 5b | Directory distance from the search root | weight × 1/(1 + g·depth); g ∈ {0 (off), 0.1, 0.3} |
| 6 | Learned ranker | logistic regression on the file features below; file weight = predicted probability; phases 1–2 and declarations first unchanged |

Learned-ranker features per file: log(1+h), h/(h+2), share of the call's matches, test, generated,
a declaration among its matches, search term in path, depth, test-intent × test. Label: the file holds
definition-level evidence. Plain-Python gradient descent, standardized features, L2 = 1.0, 300 epochs.

Definitions used by the families and the intent guard:
- *Definition-shaped pattern:* a pattern term starts with or contains `def `, `class `, `func `, `fn `,
  `function `, `interface `, `struct `, `type `, `trait `, `impl `, `enum `, `module `.
- *Pattern terms:* the pattern split on `\|` and `|`, regex characters removed, terms of 3+ characters,
  lowercase.
- *Targets tests:* a term contains `test` or `spec`, or a path operand or `--include` names a test path.
- *Call intent* (first rule that applies): definition (definition-shaped) → test (targets tests) →
  configuration (`--include` or a path operand with a config extension: json, yaml, yml, toml, cfg, ini,
  xml, conf, properties, env, lock) → call site (a term ends with `(` in the raw pattern, or the pattern
  has `\.\w+\(` or `->`) → other.

### Protection against overfitting
- Five folds, grouped by repository: the dev repositories are shuffled with seed 42 and dealt round
  robin into 5 folds.
- For a family with several values, the value is chosen on the 4 training folds (lowest miss rate; a tie
  keeps the shipped value) and scored on the held fold. The learned ranker is trained on the 4 training
  folds. The out-of-fold score pools the 5 held folds.
- No family, value or feature is added after results are seen.

### Decision rule (from §5.4)
A family replaces the shipped selector only if, out of fold:
1. its truncation-miss rate is at least **2 percentage points** lower than the shipped selector's;
2. its **newly lost** rate against the shipped selector (shipped shows evidence, the variant does not)
   is at most **1 percentage point**;
3. **intent guard:** no intent stratum with at least 50 calls gets worse by more than **3 points**.
If several pass, the simplest wins: fewest changed constants (families 1, 3, 4: one constant; 2, 5a, 5b:
one or two; 6: learned, last).

## Part 2. Results

Run on 2026-10-20 at 02:18 CEST, harness 56d7c604, `mine/tune.py` (the header column was added after the
first run, at 02:20 CEST; it scores the same chosen values with N−1 lines and does not change any choice).
Output: `~/.ss-eval/grep-paper/tuning/tuning.json`.

**Conclusion: no family passes the decision rule. The shipped selector stays the reference.** The best
family (2, file-kind priors) lowers the out-of-fold miss rate by 0.43 points; the rule needs 2 points.
The selector is not frozen by this round, and no product code changed.

### Data actually used
- 1,380 evidence-bearing overflowing calls at definition level (plan §5.4 expected about 1,700),
  1,139 tasks, 516 dev repositories. One point is about 14 calls.
- Selector check: the parameterized selector gives the same order as `mine/ranker.py` on 142 of 142
  no-context calls with two or more files.
- Intent strata: other 901, test 402, definition 37, call site 23, configuration 17. Only "other" and
  "test" have 50 or more calls, so only they enter the intent guard.

### Out-of-fold results (definition level)

Shipped selector: **15.4%** truncation-miss without the header, 16.9% with it (213 and 233 of 1,380).

| Family | OOF miss | OOF miss, header | Δ vs shipped (pp) | Newly lost (%) | Recovered (%) | Guard Δ (pp), strata ≥50 | Rule | Value chosen per fold |
|---|---:|---:|---:|---:|---:|---|---|---|
| 1 k | 15.5% | 17.0% | +0.07 | 0.14 | 0.07 | other +0.1, test +0.0 | fail | k=1.0; shipped; k=1.0; k=1.0; k=1.0 |
| 2 priors | 15.0% | 16.4% | -0.43 | 0.00 | 0.43 | other -0.3, test -0.7 | fail | test=0.25, gen=0.1; test=0.25, gen=0.1; test=0.25, gen=0.1; test=0.25, gen=0.1; test=0.25, gen=0.1 |
| 3 declarations | 15.4% | 16.9% | +0.00 | 0.00 | 0.00 | other +0.0, test +0.0 | fail | shipped; shipped; shipped; shipped; shipped |
| 4 test intent | 15.4% | 16.9% | +0.00 | 0.00 | 0.00 | other +0.0, test +0.0 | fail | shipped; shipped; shipped; shipped; shipped |
| 5a path term | 15.5% | 17.0% | +0.07 | 0.29 | 0.22 | other -0.1, test +0.2 | fail | shipped; path_boost=1.5; path_boost=1.5; path_boost=1.5; path_boost=1.5 |
| 5b depth | 15.9% | 17.2% | +0.43 | 0.58 | 0.14 | other +0.6, test +0.2 | fail | shipped; depth_g=0.3; shipped; shipped; shipped |
| 6 learned ranker | 15.7% | 17.0% | +0.29 | 1.67 | 1.38 | other +0.3, test +0.5 | fail | learned weights (5 fits) |

### Every candidate value on all 1,380 calls (not out of fold; for reading only)

| Family | Setting | Miss rate |
|---|---|---:|
| 1 k | shipped | 15.43% |
| 1 k | k=1.0 | 15.36% |
| 1 k | k=4.0 | 15.72% |
| 1 k | k=8.0 | 15.72% |
| 2 priors | shipped | 15.43% |
| 2 priors | test=0.25, gen=0.1 | 15.00% |
| 2 priors | test=0.25 | 15.00% |
| 2 priors | test=0.25, gen=0.5 | 15.07% |
| 2 priors | gen=0.1 | 15.43% |
| 2 priors | gen=0.5 | 15.51% |
| 2 priors | test=1.0, gen=0.1 | 17.32% |
| 2 priors | test=1.0 | 17.32% |
| 2 priors | test=1.0, gen=0.5 | 17.39% |
| 3 declarations | shipped | 15.43% |
| 3 declarations | decl=never | 16.52% |
| 3 declarations | decl=defpattern | 16.45% |
| 4 test intent | shipped | 15.43% |
| 4 test intent | test_intent=True | 16.23% |
| 5a path term | shipped | 15.43% |
| 5a path term | path_boost=1.5 | 15.29% |
| 5a path term | path_boost=2.0 | 15.36% |
| 5b depth | shipped | 15.43% |
| 5b depth | depth_g=0.1 | 15.80% |
| 5b depth | depth_g=0.3 | 15.72% |


"test=0.25" keeps the shipped generated prior (0.25); "gen=0.1" keeps the shipped test prior (0.5).

### Reading
- The constants are near a flat optimum. The largest in-sample gain of any single value is 0.43 points
  (test prior 0.25). Each fold chose it, but the gain is far below the 2-point bar.
- Changes that move test files up hurt: test prior 1.0 adds 1.9 points; the intent-conditioned test
  prior (family 4) adds 0.8 points in sample, and no fold chose it.
- Declarations first helps: "never" adds 1.1 points.
- The learned ranker reorders the most calls (1.67% newly lost, 1.38% recovered) and nets a small loss.
  Its largest standardized weights are on the file's share of the call's matches (about +0.46), test
  files (about −0.52) and depth (about −0.2 to −0.3).
- An oracle order misses 1 of 1,380 calls, so the budget almost always has room for the evidence. The
  remaining 15% is an ordering problem that none of these features solves. I did not classify the
  remaining misses tonight.

### Not done in this round
- No freeze, no pre-registration, no product port (owner decisions).
- No held-out record was read.
