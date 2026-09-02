# c15 — adversarial verify, differential and measurability lens

**Verdict: REFUTED.** The candidate is not a lever and it is not new. Its vehicle is shared
admission, so it has zero head-to-head differential — the candidate says this itself. Its class
is already on the register as **G13** (`run_tests` verdict-label defect, SHIPPED), which recorded
"9 of 18 tasks never emitted a passing status under any patch" on 2026-08-07, three weeks before
the fresh pool ran. Its vehicle is already on the register as **G11** (task-admission blocklist,
SHIPPED), which already carries a reason vocabulary (`empty-issue | vacuous-f2p | ungradeable`).
Its central count is wrong by 4×: the correct discriminator finds **4 of 22 fresh-pool tasks**
with no trustworthy verdict in any rep, not 1. Its kill condition carries no number. And applying
it moves no solve verdict past the ±6 bar on any harness while moving the published cost
comparison **against** sweet on every harness. What survives is a correction to G13 plus a cheap
row-schema addition, both worth adopting.

Confidence 0.86.

---

## 1. What I measured, and with what

All work read-only on `root@167.233.69.121` under
`/root/sweet-search-private/eval/task-completion-bench/results/`. Scratch on the box at
`/tmp/wf-slatec/c15-measurability/`. Scripts copied to
`/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/slate-c/verify/scripts-c15-measurability/`
(`untrusted-cell-census.sh`, `headline-drop-class.mjs`). No model calls. Spend `$0`.
HO2 was never opened; every run touched is a DEV pool (`fp-*`, `rp-*`, `fixval-*`, `rb-*`, `sb-*`).

---

## 2. The candidate's own facts: what reproduces, what does not

### 2.1 Reproduces

The `status=INFRA` grep over the four TAB runs reproduces exactly `[M`, grep over
`<run>/agent-state`, subagent files excluded`]`. `accenture__sfmc-devtools-1974` is the only task
in `fp-codex-tab-20260826`, `fp-opencode-tab-20260826`, `fp-claudecode-tab-20260826` and
`rp-oc-tab-20260827` with an `INFRA` verdict.

The six losers reproduce `[M rows.json]`. Non-resolved accenture rows with `f2pFrac=1`,
`ranTests=true`, `rtNoVerdict=0`: `fp-codex-tab` native rep0/rep1/rep2 and sweet rep0,
`fp-opencode-tab` native rep1, `fp-claudecode-tab` sweet rep1. That is 6 of 6.

The nine solves reproduce, with a denominator caveat in §2.2 `[M rows.json]`.

The register facts reproduce from code, not prose. `select/task-gates.json` states the gate is
"METADATA-ONLY and OUTCOME-BLIND" `[C]`, and `harness/task-gates.mjs` only reads
`FAIL_TO_PASS` / `PASS_TO_PASS` counts and a stamped name-lock boolean `[C]`. So G20 genuinely
cannot detect this. The jail is real and universal: `isolated=true` on 68 of 68 rows in
`sb-codex-20260811`, 78 of 78 in `rb-codex-20260825`, 132 of 132 in `fp-codex-tab-20260826` `[M]`.

### 2.2 Does not reproduce

**"status=INFRA on every call" is false.** Full-suite calls are always `INFRA`; targeted calls
execute and return a real `FAIL`. Verdict census over all twelve `fp-*` / `rp-*` runs
`[M, grep of "run_tests verdict] status=… scope=… exit=…"]`:

| scope | status | occurrences across 12 runs |
|---|---|---:|
| full | INFRA (exit 233 or 234) | 178 |
| targeted | FAIL (exit 7) | 6 |
| any | PASS | 0 |
| | **total verdict occurrences** | **184** |

The six targeted `FAIL` verdicts sit in `fp-codex-tab` (1), `fp-codex-none` (1),
`fp-opencode-pipe` (2) and `rp-oc-none` (2). The `fp-codex-tab` one is rollout
`agent-state/accenture__sfmc-devtools-1974-sweet/codex-home/sessions/2026/08/26/rollout-2026-08-26T22-30-34-01a04032-4f6f-7b12-b5e5-190431514aaf.jsonl`.

**The invariant that does hold is `trustworthy=no`, not `INFRA`.** Every `trustworthy=` token on
accenture across the twelve runs reads `no` — 181 of 181, including the six targeted `FAIL`s
`[M]`. The 3-occurrence gap against the 184 verdict lines is claude-only and is consistent with a
truncated duplicate record; no `trustworthy=yes` appears anywhere on this task. Claude duplicates
each request about 2.46×, so these are occurrence counts, not call counts. This is a strictly
better discriminator and the candidate should adopt it.

**"opencode native 5 files + sweet 4 (fp) + 5 (rp)" counts artifacts, not rollouts.** The extra
files are `opencode-data/opencode.db` and `opencode.db-wal` `[M ls]`. Rollout counts for
`fp-opencode-tab` accenture are native 3 of 3 sessions and sweet **2 of 3** — the third sweet
session directory (`session-1787754235368-1040662-4bf06226`) holds only
`opencode.generated.json`, with no stdout NDJSON `[M ls -la]`. Consistently,
`fp-opencode-tab-20260826/rows.json` has **129 rows, not 132**, and only 5 accenture rows.

**"9 of 18" needs its composition stated.** With `rp-oc-tab-20260827` substituted for the missing
opencode sweet cell the count is 9 of 18; on `fp-*-tab` alone it is 9 of 17 `[M]`. The wording is
also inverted: every accenture rollout was blind, and 9 of them solved. It is not that 9 solves
out of some larger solve count were blind.

**The `$0` falsifier as written returns a false positive.** I ran it. Over
`fp-*-none`, `fp-*-pipe`, `rp-oc-none`, `rp-oc-pipe`, `fixval-*` and `rb-*`, a raw `INFRA` grep
returns accenture everywhere plus **one hit outside the fresh pool**:
`rb-claudecode-20260824/agent-state/dart-lang__http-1114-sweet/claude-home/projects/-root--ss-eval-runs-r0-1/50f8586f-0fdf-4af9-98a6-780e474446d6.jsonl`.
That rollout's verdicts are PASS, INFRA, PASS `[M]` — a transient infrastructure error inside a
working suite, not an unverifiable task. A grep for the string cannot separate "always INFRA"
from "one flaky INFRA among passes", so the falsifier would have been read wrongly in both
directions.

---

## 3. The count is wrong by 4×

Run the correct discriminator instead: a task-and-arm cell where **every** recorded verdict is
`trustworthy=no` and at least one verdict exists. Census over 18 runs
`[M untrusted-cell-census.sh]`. Four fresh-pool tasks qualify in at least one cell:

| task | cause | verdict statuses seen |
|---|---|---|
| `accenture__sfmc-devtools-1974` | network lockdown blocks the dependency install | INFRA (full), FAIL (targeted) |
| `devlooped__moq-1262` | no usable baseline diff | FAIL full exit=1 |
| `hotmeteor__spectator-181` | no usable baseline diff | FAIL full exit=2, FAIL/PASS targeted |
| `mathnet__mathnet-numerics-1072` | no usable baseline diff | FAIL full exit=141 |

That is **4 of 22 fresh-pool tasks, about 18%** `[M]`. Only accenture is caused by the jail. The
other three return a verdict the shim itself marks untrustworthy because there is no baseline to
diff against `[C harness/rt-shim-runtime.mjs classifySuiteResult: trustworthy = baselineDiff !==
null && !infra]`. The candidate's mechanism ("needs network to install dependencies") explains
one quarter of the class it is really pointing at.

`fixval-*` and `rb-codex` / `rb-opencode` show no all-untrusted cell `[M]`. `rb-claudecode` shows
none once the transient dart hit is classified correctly `[M]`.

---

## 4. Differential: zero, and the sign is against sweet

The vehicle is shared admission. Both arms run the same task list, so relabelling or dropping a
task changes both denominators identically. The candidate states this (`sweet_only: no`,
"Not a lever; zero differential") and I confirm it. Under brief rule 6 it can never be a
"sweet beats native" lever, and register family G says such items are not booked as wins.

It also does not change which lines or which requests happen, so it is neither an admissible
payload lever nor a member of the banned same-information-compaction class. It is outside that
axis entirely: it changes the population, not the payload.

Applying it makes sweet look worse. Recomputed from `rows.json`, opencode merged with its repair
pass, which reproduces the published codex and opencode headlines exactly
`[M headline-drop-class.mjs]`:

| cell | solves native → sweet | $/rollout native | $/rollout sweet | sweet vs native |
|---|---|---:|---:|---:|
| codex, all 22 tasks | 41/66 → 39/66 | 0.012287 | 0.012330 | **+0.35%** |
| codex, drop accenture | 41/63 → 38/63 | 0.012191 | 0.012444 | **+2.08%** |
| codex, drop all 4 | 37/54 → 34/54 | 0.010873 | 0.010970 | **+0.89%** |
| opencode, all 22 tasks | 41/66 → 41/66 | 0.008968 | 0.009265 | **+3.31%** |
| opencode, drop accenture | 39/63 → 40/63 | 0.008807 | 0.009255 | **+5.09%** |
| opencode, drop all 4 | 36/54 → 37/54 | 0.007898 | 0.008570 | **+8.51%** |
| claude-code, all 22 tasks | 43/66 → 40/66 | see note | see note | see note |
| claude-code, drop accenture | 40/63 → 38/63 | — | — | — |
| claude-code, drop all 4 | 37/54 → 35/54 | — | — | — |

Claude-code cost is not quoted because 28 of 66 native rows carry a null realised cost (G6); a
naive mean over the non-null rows is not the published ledger and would mislead.

The `+0.35%` and `+3.31%` match the brief's `+0.3%` and `+3.3%`, so the reconstruction is sound.

---

## 5. Detectability: below the bar on solves, adverse on cost

Pre-registered bar is ±6 rollouts of 66 per cell.

- Dropping accenture alone moves solves by at most **2 rollouts** in any cell (opencode native
  41 → 39). Pool-wide the native-minus-sweet gap moves from 5 to 4 of 198 `[M]`.
- Dropping the whole 4-task class moves the pool gap from 5 to 4 as well, while cutting each
  denominator from 66 to 54 (−18%), which widens every interval `[M]`.
- No published conclusion changes in either case. Nothing crosses ±6.
- On cost the direction is one-sided: every variant makes sweet relatively dearer. The absolute
  per-rollout differences (codex $0.000043 → $0.000253; opencode $0.000297 → $0.000672) sit
  inside the ±$0.001–0.005 per-rollout band the brief quotes, so the percentage headline moves
  more than the underlying quantity does.

**Three of the four tasks carry no head-to-head signal for reasons already recorded.**
`mathnet__mathnet-numerics-1072` solves 3/3 in both arms on all three harnesses — the
"always solves both arms" shape that G3c records as close to a filter for undiscriminating
tasks. `devlooped__moq-1262` and `hotmeteor__spectator-181` are on the brief's own
dead-everywhere list. Accenture is the only one of the four that discriminates at all `[M]`.
So the class the item identifies overlaps almost completely with tasks already known to be
inert for the sweet-versus-native comparison.

---

## 6. Register check: the item is not new, and its vehicle already exists

**G13 records the class.** `register/DEAD-LEVER-REGISTER.md:231`: "`run_tests` verdict-label
defect … 9 of 18 tasks never emitted a passing status under any patch … SHIPPED." The source is
`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §25–26, dated 2026-08-07, which states across 326
`run_tests` calls "18% have an untrustworthy baseline", names two runners as "fully
non-discriminative between empty, gold and broken patches", and reports the repair (`2b80ee3`)
raising trustworthy-baseline coverage 83% → 88% `[M read of §25–26]`. That is exactly "a task
unverifiable for the agent while gradeable for the grader", measured, named and partly repaired.

**§25 Gate 0a is stronger still.** "The gold patch produces the SAME `run_tests` verdict as an
empty patch on 6/6" tasks probed, and ≥12 of 18 fail-to-pass targets are unrunnable by the agent
because `test_patch` creates the test. Agent-side blindness is therefore the *normal* condition
of this benchmark for a reason that has nothing to do with the jail. c15 attributes to a network
lockdown on one task a property the bench already had on most tasks.

**The jail did not cause the class.** The jail shipped 2026-07-29 (`d75d4fd`, `c61b5e8`) `[M git
log]`, before the G13 measurement; and three of the four tasks I found fail for a missing
baseline, not for egress. "G18 causes it" holds only for accenture's full-suite path.

**G11 is the vehicle, already shipped.** `harness/task-blocklist.json` exists, is enforced in
`run-pilot.mjs` immediately after `INSTANCES` resolves, refuses named blocked tasks, shrinks the
denominator for swept ones, and already defines a reason vocabulary
`empty-issue | vacuous-f2p | ungradeable` `[C]`. Adding an admission label needs a new reason
code and a census, not a new mechanism.

**A new fact does survive.** §26 claimed "the `trustworthy=no` category is gone entirely" after
the repair. That claim was made on the rotate20 DEV-RET pool. On the fresh 22-task pool three
weeks later, 4 of 22 tasks are all-untrusted in at least one cell `[M]`. Either the repair was
pool-specific or the class recurs. That is worth adding to G13; it is not a new register row.

---

## 7. Rule check

| rule | result |
|---|---|
| HO2 never opened per task | Respected here. **Warning for the synthesis:** HO2 is frozen at denominator 199 (G4). An admission filter applied retroactively to a frozen set would break that freeze. Any adoption must be forward-only. |
| No gold, task identity or hidden tests as runtime inputs | Not violated. The proposal runs at admission, not runtime. |
| Ranking-signal format gate | Not applicable. |
| Owner decisions without a flag | **Violated in the metadata.** `needs_user_decision: no` is wrong. Running `run_tests` in the jailed image at admission breaks the documented "METADATA-ONLY and OUTCOME-BLIND" contract of `select/task-gates.json` `[C]` and, since the gate runs before the seeded draw over a roughly 19,000-task pool `[C PLAN.md §6 row P6]`, a jailed image run per candidate is not affordable there. |
| Solve is the veto | No solve risk; also no solve gain. |
| Differential rule | Honoured and self-declared: zero differential. |

---

## 8. Corrections the synthesis must adopt

1. Replace `status=INFRA` with **`trustworthy=no` on every verdict in every rep** as the
   discriminator. INFRA is one cause among several.
2. Replace "the only fresh-pool task" with **4 of 22 fresh-pool tasks (about 18%)**:
   `accenture__sfmc-devtools-1974`, `devlooped__moq-1262`, `hotmeteor__spectator-181`,
   `mathnet__mathnet-numerics-1072`. Only accenture is caused by the jail.
3. Delete "the agent has no verification signal". Say: full-suite calls always return INFRA;
   six targeted calls across twelve runs executed and returned FAIL; no accenture call ever
   returned PASS; every trustworthiness token on the task reads untrustworthy, 181 of 181.
4. Fix the opencode counts: 3 native and 2 retained sweet rollouts on `fp-opencode-tab`, not
   "5 files" and "4 files". `fp-opencode-tab-20260826/rows.json` holds 129 rows, not 132.
5. State the denominator: 9 of 18 with the repair pass substituted, 9 of 17 on `fp-*-tab` alone.
   And say "all rollouts were blind; 9 solved", not "9 solves were blind".
6. Change the register check from "new validity item" to **"correction and extension of G13,
   using the vehicle of G11"**. Add the new fact: G13's repair claim that `trustworthy=no` was
   eliminated does not hold on the fresh pool.
7. Give the kill condition a number. Proposed: **drop the item if fewer than 2 admitted tasks in
   a pool are all-untrusted across every rep of every arm.** The current pool scores 4, so the
   item would survive that bar — on the corrected class, not on the INFRA class.
8. Replace the falsifier. The grep must be a per-cell census (every verdict untrusted, at least
   one verdict present), not a substring search, or it flags transient errors such as the dart
   rollout in `rb-claudecode-20260824`.
9. Set `needs_user_decision: true`. Also split the build cost: **hours** for the cheap form —
   `rows.json` already carries `rtLaunched`, `rtVerdicts`, `rtNoVerdict` and `rtEndedUnverified`
   but no verdict *status* and no trustworthiness, so an all-INFRA rollout is indistinguishable
   from an all-PASS one in the row file `[M field dump]`; adding `rtTrustworthy` and `rtInfra`
   counters is small. **Days and an owner decision** for the preflight form that executes a suite
   at selection time.
10. Record the ceiling honestly as a negative: applying the filter moves the published cost
    comparison against sweet on both harnesses with a valid ledger (codex +0.35% → +2.08% or
    +0.89%; opencode +3.31% → +5.09% or +8.51%) and moves no solve verdict past ±6.
11. Note the overlap: 3 of the 4 tasks are already non-discriminating (one always solves in both
    arms, two are dead everywhere), so the class it isolates is nearly disjoint from the tasks
    that carry head-to-head signal.

---

## 9. What I could not finish

- I did not establish why `devlooped__moq-1262`, `hotmeteor__spectator-181` and
  `mathnet__mathnet-numerics-1072` have no baseline diff. I only established that the shim marks
  their verdicts untrustworthy and that they are not INFRA. Tracing the baseline-capture path is a
  separate `$0` job.
- I did not test whether the untrusted verification *causes* moq and spectator to be dead
  everywhere. The correlation is exact on this pool; causation is not established at `$0`.
- I did not re-price claude-code with the sidechain-inclusive ledger, so no claude-code cost
  effect is reported. My drop-class numbers for claude are solve counts only.
- I did not audit `sb-*-20260811`, `gab-*`, `gx-*`, `bd-*`, `bv-*`, `cf-*` or `cs-*` for the
  class. The census covers the twelve `fp-*` / `rp-*` runs plus `fixval-*` and `rb-*`.
- Claude occurrence counts are inflated by its ~2.46× record duplication; I did not deduplicate
  by `message.id` for the verdict census, so per-harness occurrence totals are not comparable
  across harnesses. The per-cell all-untrusted verdict does not depend on that.
