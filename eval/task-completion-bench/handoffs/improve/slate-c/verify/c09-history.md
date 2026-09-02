# c09 — adversarial verify, HISTORY lens

Date: 2026-09-02. Cost of this study: `$0` (trace reading, static code reading, arithmetic).
Evidence box read-only; my scratch is `/tmp/wf-slatec/c09-history-v2/`.
Tags: `[M]` measured with a named script, `[C]` read from code, `[W]` web, `[I]` inferred.

---

## 0. Verdict

**REFUTED as a lever. Confidence 0.94.** Both halves of c09 fail, and each fails on the
candidate's own pre-registered kill condition, measured by me from the raw data.

The help repair is E2's family. The 2026-08-28 adversarial panel already named `--help` exits 2
by name, priced the class, and dispositioned it: *"Ceiling: cost about 1% of sweet spend, solve
0 tasks. Dead as a bench lever, and it was correctly killed at the gate on those numbers. Ship
it as a correctness fix … Claim no benchmark value for it."* (`PANEL-SYNTHESIS.md` §N-3). The
same file killed the flag-honesty proposal at the `$0` exposure gate at 0.99% cost and under one
task. c09's own ceiling, 0.56%, is smaller than what was already killed.

I then ran c09's two `$0` falsifiers on the data it names. **Both fire against it.**

1. **Falsifier 1.** c09's argument table rescues **13 of 48** recorded usage errors (27.1%)
   against its kill line of 30 of 48. Even the most generous literal reading of its table
   reaches **27 of 48** (56.3%), still below the line. Exposure on codex is **0 of 970**
   operations and on opencode **0 of 788**; all 13 events are claude-code `Explore` subagents,
   in 4 tasks and 6 of 198 rollouts `[M scan.py, classify.py, chain.py]`.
2. **Falsifier 2.** Under c09's own literal wording (reclassify `-k` and read spans only),
   residual guide dependence is **33.92% on claude-code**, 13.92% codex, 11.42% opencode
   `[M g3.py]`. c09's guide-branch kill condition is *"dependence still >20% on any harness after
   repair"*. **It fires.** Under the wider reclassification (every form the shipped usage strings
   already print), the residual collapses to 0.69 / 1.24 / 0.76% — and then the "fires at
   98–100%, closing B3" headline evaporates. Both horns are fatal.

One code fact shrinks the whole candidate: `failUsage` **already prints the full usage text**
before exiting 2, and the traces confirm the agent received it in all 11 `--help` / `-h` events.
The repair changes an exit code and one prefix line, not the information delivered.

What survives is exactly what E2 already is: a correctness fix, claude-code subagents only, with
no benchmark value claimed. B3 must be withdrawn — it is an owner decision, not an evidence
question (register §0.1).

---

## 1. The code fact the candidate did not price

`[C]` `eval/agent-read-workflows/bin/_ss-helpers.mjs` lines 188–190:

```
function failUsage(message, usage) {
  process.stderr.write(`[ss] ${message}\n${usage}\n`);
  process.exit(2);
}
```

Lines 226–228 are `rejectUnknownOptions`, which calls it. Both of c09's code citations are
exact.

**But the usage payload is already delivered.** Here is what the agent actually received, from
the raw traces `[M helpout.py]`:

```
CMD: …/bin/ss-grep --help
OUT: Exit code 2
     [ss] unrecognised option "--help"
     Usage: ss-grep <regex> [-i|--ignore-case] [-w|--word-regexp] [-F|--fixed-strings] [--in <path>]... [-k N]
```

All 11 `--help` / `-h` events in the pool returned their tool's complete usage line `[M]`. Two of
them prove the agent read it on purpose: the subagent typed `ss-find -h 2>&1 | head -80` and
`ss-grep -h 2>&1 | head -80`, redirecting stderr deliberately.

So the honest counterfactual saving of the `--help` repair is **zero requests**. The agent asked
for usage and got usage. The only events that genuinely lost an operation are `ss-grep -E …` ×1
and `ss-grep -iE …` ×1 — **2 events in 198 rollouts** `[M classify.py]`.

**Corrected ceiling.** At claude-code's blended $0.000702 per main-thread request
(`native-capability-gaps.md` §9) and a claude-code sweet arm of 66 × $0.020727 = $1.368
`[M BRIEF.md §1]`: 2 recoverable requests = $0.0014 = **0.10% of the claude-code sweet arm**,
and **0.00% of codex and opencode**. c09's "≤0.56% claude-code, ~0.2% elsewhere" is about five
times too high on claude-code and simply wrong elsewhere: measured exposure on codex and
opencode is exactly zero.

---

## 2. Most of the proposed mechanism is already shipped

| c09 proposes | status in the tree today | evidence |
|---|---|---|
| accept `-i` | already accepted on `ss-grep`, `ss-find` | `[C]` `_ss-helpers.mjs` 331, 449 |
| accept `-F` | already accepted on `ss-grep`, `ss-find` | `[C]` 333, 451 |
| accept `--full` | already accepted on `ss-search`, `ss-find`; absent on `ss-grep`, which is `file:line` only | `[C]` 447, 707; `GREP_USAGE` 328 |
| accept `--in` on `ss-trace` | already accepted, and already present before the run | `[C]` 950; `git show ba5b4ee:…` line 875 (2026-08-26) |
| accept `--in` on `ss-find` | shipped 2026-08-28 | `[C]` `36b802e`; `FIND_USAGE` 445 now carries `[--in <path>]...` |
| (not in c09's list) extra positional path | shipped 2026-08-28 as `absorbPositionalPaths` | `[C]` `_ss-helpers.mjs` 235; `36b802e` |
| `--help` / `-h` exit 0 | **genuinely unbuilt** | `[C]` 226–228, no help path anywhere |
| `-E` inert | **genuinely unbuilt** | `[C]` `_ss-argparse.mjs` `INERT_FLAGS` 60–63 has no `-E` |

Two of seven items are new. The rest is `36b802e`'s shipped work, which c09's 48-error
denominator counts as its own prize. Independent date check: the `ss-find` usage string recorded
in the run has no `--in` `[M helpout.py]`, while today's has it — so the `--in` fix post-dates
the fresh pool and cannot be claimed by a new candidate.

---

## 3. Falsifier 1 re-run — the kill fires under every reading

Method, written from scratch, not reused: `/tmp/wf-slatec/c09-history-v2/{scan.py,classify.py,chain.py,helpout.py}`
over `/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz`. Population: sweet arm,
canonical rows, the three `fp-*-tab-20260826` fresh-pool runs.

**Instrument validation.** My operation counts reproduce the census exactly: codex 970, opencode
788, claude-code 1,306 (973 main + 333 subagent), total **3,064** `[M scan.py]`.

**Usage-error events found: 49** — claude-code subagent 33, claude-code main 10, opencode 5,
codex 1 `[M scan.py]`. The candidate's 48 is the claude-code-only population from
`native-capability-gaps.md` §3.2 (36 subagent of 329 + 12 main of 779). The two instruments agree
to within one event.

**Cause of each error `[M classify.py]`:**

| cause | events | rescued by c09's table? |
|---|---:|---|
| extra positional not consumed | 18 | no — not in c09's table; already shipped (`36b802e`) |
| `--in` rejected | 9 | already shipped for `ss-find`; the one `ss-trace` case is a *repeated* `--in`, which c09 does not propose |
| `--help` | 9 | **yes, new** |
| `--full` (all on `ss-grep`) | 3 (5 commands) | contested — `ss-grep` has no such mode |
| `-h` | 2 | **yes, new** |
| `-iname` | 2 | no — a `find(1)` flag, not in c09's table |
| `-iE` | 1 | **yes, new** (needs `-E`) |
| `-E` | 1 | **yes, new** |
| `--include=*.jam` | 1 | no |
| other (`--in ""` empty value; 2 chained-command artefacts) | 3 | no |

**Scoring against c09's own kill line (fewer than 30 of 48 become valid → kill):**

| reading | rescued | of 48 | verdict |
|---|---:|---:|---|
| genuinely new items only (`--help`, `-h`, `-E`, `-iE`) | **13** | **27.1%** | **kill fires** |
| + `--full` accepted on `ss-grep` | 16–18 | 33.3–37.5% | kill fires |
| + every item literally in c09's table, including the already-shipped `--in` | 25–27 | 52.1–56.3% | kill fires |
| + the 18 positional events c09 never proposed | 43–45 | 89.6–93.8% | passes only by claiming `36b802e` |

**Exposure by harness `[M chain.py]`:**

| harness | `ss-*` operations | events c09 newly rescues | share |
|---|---:|---:|---:|
| codex | 970 | **0** | 0.00% |
| opencode | 788 | **0** | 0.00% |
| claude-code | 1,306 | **13** | 1.00% |

All 13 sit in claude-code `Explore` subagents, in 4 tasks
(`asynkron__protoactor-dotnet-1909`, `awslabs__aws-embedded-metrics-node-21`,
`bfgroup__b2-113`, `final-form__final-form-64`) and **6 of 198 rollouts** `[M chain.py]`.

**The `&&`-abort mechanism has no exposure here.** `PANEL-SYNTHESIS.md` §N-3 warned that a
non-zero exit inside an `&&` chain drops later subcommands. Of 49 error events, 3 are in an `&&`
chain, and **0 of the 13 c09 would rescue** are `[M chain.py]`. The one chained help probe uses
`;`, which runs the next command regardless.

---

## 4. Falsifier 2 re-run — two horns, both fatal

I rebuilt the guide-syntax census independently `[M gsyn.py, g3.py]`. Pre-repair, it reproduces
the candidate's numbers: claude-code 1,282/1,306 = **98.2%**, codex 950/970 = **97.9%** (doc says
97.7%), opencode 788/788 = **100.0%**. My `ss-trace` mode-word count is 27, matching the census
exactly. Instrument validated.

Now apply the repair. c09's falsifier text is specific: *"re-run guidesyntax.py … with `-k` and
read spans reclassified as self-describable."*

| harness | `ss-*` ops | **Horn B**: c09's literal falsifier (`-k` + spans self-describable) | **Horn C**: full repair (every form the shipped usage strings print) |
|---|---:|---:|---:|
| claude-code | 1,306 | **443 (33.92%)** | 9 (0.69%) |
| codex | 970 | 135 (13.92%) | 12 (1.24%) |
| opencode | 788 | 90 (11.42%) | 6 (0.76%) |

**Horn B kills c09's guide branch on c09's own kill condition.** That condition reads: *"Guide
branch: dependence still >20% on any harness after repair."* Claude-code is 33.92%. It fires.

**Horn C destroys c09's headline.** c09 asserts the census *"fires at 98–100%, closing B3"*. That
is the *pre-repair* number, produced by an instrument that counts optional documented flags as
guide dependence. Its own repair is designed to move that number, and does — to about 1%. A
1% instrument reading cannot close anything.

There is no third position. Either the repair leaves dependence above 20% (guide branch dead by
c09's own kill line) or it drops it near zero (headline false). The two halves of c09 contradict
each other.

Worse, the entire Horn-C residual is a **guide/product mismatch**, not guide dependence. The
guide teaches `ss-trace <symbol> [callers|callees|impact] [--in <file>]`
`[C sweet-search-system-prompt.md:32]`, and the wrapper does not implement a mode word:
`TRACE_USAGE` has none and `cmdTrace` consumes only the first positional
`[C _ss-helpers.mjs 939, 954]`. So the 27 remaining "guide-taught" operations use a form the tool
silently ignores. Real guide-taught *syntax* dependence in this pool is indistinguishable from
zero.

The register already records this exact counting error in another family: A1's strongest kill is
"the counting artifact" — an envelope-level gap of 35.8% that was 8.4% at operation level
(`register/DEAD-LEVER-REGISTER.md` A1).

---

## 5. Recorded killing facts that apply to this mechanism

1. **`PANEL-SYNTHESIS.md` §N-3.** Names `--help` exits 2 explicitly, as one of three defects on
   one code path. Class verdict: *"Ceiling: cost about 1% of sweet spend, solve 0 tasks. Dead as
   a bench lever … Ship it as a correctness fix … Claim no benchmark value for it."* c09's
   ceiling (0.56% claimed, 0.10% measured) is below what was already killed.
2. **`PANEL-SYNTHESIS.md` §(b), "killed at the `$0` exposure gate".** Row *"Scope and flag
   honesty for the ss CLI | 11 cells, 13 ledger-visible wasted calls | cost 0.99%, solve under 1
   task | … Engineering hygiene, not a lever."* That is c09, under its earlier name, already
   killed at a gate. Note the coincidence of size: 13 wasted calls then, 13 rescuable events now.
3. **Register E2, SHIPPED.** Same family. The row records `[M]` that requests following a failed
   `ss-*` call are 2.4 / 2.2 / 1.9% of a sweet rollout — *"an upper envelope, not removable
   spend"* — that *"the review panel explicitly rejected the zero-behavioural-risk framing"*, and
   that the directory-scope item *"shipped as correctness with no benchmark value claimed"* at a
   0.99% ceiling. c09 derives its ceiling from that envelope and inherits the rejection.
4. **`04-resolution-opencode.md` §L4, "Accept the grep-shaped invocations the model actually
   types"** — the seed of the E2 package, whose own note is *"Low ceiling, near-zero risk."* c09
   is L4's next iteration.
5. **The candidate's own seed conceded the point before c09 was written.**
   `forensics/native-capability-gaps.md` §S3 proposes exactly `-E`, `-h`, `--help` with exit 0,
   gives ceiling **≤0.2%**, states the same 48-error falsifier and the same 30-of-48 kill line,
   and closes: *"Nothing in this census supports a 'sweet beats native' cost lever above the ±6
   rollout bar by itself."* `forensics/claude-subagents.md` §M1 pre-registers the same judgement:
   *"treat M1 as hygiene, not a cost lever."*
6. **Register §0.1, owner decision 2026-08-10 / 2026-08-13.** *"The tool guide's guidance block is
   not to be trimmed. → Rows B2 and B3 need a user decision, not more evidence."* Register rule 2:
   *"A row is only revived by its own revival condition, not by a new argument."* B3's revival
   condition is a user decision. c09 supplies an argument.
7. **Register class G.** Measurement items are *"not levers; do not book as wins."* Closing a
   parked row moves no headline number and cannot make sweet cheaper than native.

---

## 6. Three further defects in the B3-closing argument

**(a) A syntax census cannot answer B3.** It measures which forms *guided* agents typed. B3 asks
what a *guide-less arm* costs. Register open thread 33: *"Whether removing the tool guide breaks
the sufficiency trailer or the stop discipline it also carries. Untested side effect."* The
guide's policy block (`sweet-search-system-prompt.md` 38–54: sufficiency handling, stop
discipline, chaining, the one mapping call) is invisible to any syntax instrument.

**(b) The 7.5% no-delegation value is attributed to the guide against the register's own
record.** Register open thread 45: *"Whether sweet's lower subagent usage on claude-code is
causal (a product effect of the `ss-*` tools) or incidental. Neither source that flags it
adjudicates."* `forensics/claude-subagents.md` §0 attributes it to the **tools** — *"sweet
delegates less on claude-code because `ss-search` occupies the slot where native spawns an
`Explore` subagent"* — with sweet's first substantive call being `ss-search`/`ss-grep` in 43 of
45 rollouts `[M]`. So "dead on claude-code regardless" rests on an unadjudicated attribution.

**(c) The guide-less population is a bench artefact, not a clean measurement of guide absence.**
The eight `Explore` subagents ran in a git worktree the index did not cover: of 57 worktree-scoped
calls, 45 returned a silent zero and 12 were usage errors, across 5 rollouts, with 127 native
operations and 184k tokens downstream `[M native-capability-gaps.md §3.2, G1]`. The
≈$0.0032-per-agent discovery cost that c09 converts into a "6.2–7.6× loss" is therefore
contaminated by an index-coverage defect. `claude-subagents.md` records `[C]` that in production,
without the runner's `SWEET_SEARCH_PROJECT_ROOT` pin, `ss-*` inside such a subagent would fail
outright with "no Sweet Search index" — so this population is not production either.

---

## 7. What survives, and the corrections the synthesis must adopt

**Survives (as correctness only, not as a lever):**

- Ship `--help` / `-h` printing usage on exit 0, and `-E` / `--extended-regexp` as inert. About
  half a day. No solve risk. Book it exactly as E2 was booked: correctness, **no benchmark value
  claimed**, harness scope **claude-code subagents only**.
- **New finding, not in c09 and not in the register:** the guide documents an `ss-trace` mode word
  the wrapper silently ignores `[C guide:32 vs TRACE_USAGE 939 / cmdTrace 954]`; 27 operations in
  the pool used it. Either implement it or delete it from the guide. This is a distinct item from
  anything in E2 or c10 and is the only real content of the repaired census.

**Corrections the synthesis must adopt:**

1. Ceiling is **0.10% of the claude-code sweet arm, 0.00% on codex and opencode** — not
   "≤0.56% claude-code, ~0.2% elsewhere". Measured exposure on codex is 0 of 970 operations and
   on opencode 0 of 788.
2. Drop `-i`, `-F`, `--full`, `--in` on `ss-trace`/`ss-find` from the mechanism list. They are
   already accepted `[C]`; keeping them counts `36b802e`'s shipped work as this candidate's prize.
3. `--help` **already returns the full usage text** `[C failUsage 188–190; M helpout.py]`. State
   that the repair changes an exit code, not the information delivered.
4. Falsifier 1 result: **13 of 48 (27.1%)**, generous 16–18 (33.3–37.5%), maximum literal 25–27 (52.1–56.3%) —
   all below the 30-of-48 kill line. **The candidate's own kill condition fires.**
5. Falsifier 2 result: literal reading **33.92% claude-code** (>20% → c09's guide-branch kill
   fires); wide reading **0.69 / 1.24 / 0.76%** (headline false). Delete the claim that the
   census "fires at 98–100%, closing B3".
6. **Withdraw the B3 branch entirely.** Register §0.1 makes it an owner decision; register rule 2
   forbids reviving a row by argument; register class G forbids booking a closure as a win.
7. Overlap to record: the whole measured population is the eight guide-less `Explore` subagents,
   which candidate c08 targets directly. c09 adds nothing on top of c08 for that population.

---

## 8. Denominators, paths, and what I could not finish

Everything below is `$0` — no rollouts, no writes under `results/`.

Measured by me, from scratch:
- 3,064 sweet `ss-*` operations in 198 canonical rollouts: codex 970, opencode 788, claude-code
  1,306 (973 main + 333 subagent) `[M scan.py]`.
- 49 usage-error events; 3 of them inside an `&&` chain `[M scan.py, chain.py]`.
- 13 events rescued by c09's genuinely new items; 16–18 generous; 25–27 maximum literal; of 48
  `[M classify.py]`. 4 tasks, 6 of 198 rollouts.
- 11 of 11 `--help` / `-h` events already returned full usage text `[M helpout.py]`.
- Pre-repair guide-syntax census reproduced: 98.2 / 97.9 / 100.0% `[M gsyn.py]`.
- Post-repair residual, literal horn 33.92 / 13.92 / 11.42%; wide horn 0.69 / 1.24 / 0.76%
  `[M g3.py]`.

Paths opened: `eval/agent-read-workflows/bin/_ss-helpers.mjs`, `_ss-argparse.mjs`;
`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`;
`handoffs/improve/PANEL-SYNTHESIS.md` §N-3 and §(b);
`handoffs/improve/slate-c/register/DEAD-LEVER-REGISTER.md` §0, §0.1, rows E2, B3, A1, threads
33 and 45; `handoffs/improve/slate-c/forensics/native-capability-gaps.md` §3.2, §4 (G1–G8), §7 S3,
§9; `handoffs/improve/slate-c/forensics/claude-subagents.md` §0, §1.1, §2.1, §2.2, §M1;
`handoffs/improve/slate-c/candidates/inversion-and-removal.md` §B1, §B3;
`handoffs/improve/slate-c/research/agent-efficiency-2026.md` §8 S1.
Git: `git show ba5b4ee:…_ss-helpers.mjs`, `git show 36b802e --stat`.

Box scripts I wrote (scratch only): `/tmp/wf-slatec/c09-history-v2/{scan.py,classify.py,chain.py,helpout.py,gsyn.py,g3.py}`.
Source data: `/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz`.

**Not finished.**
1. I priced the recoverable requests with the published blended `$0.000702` per claude-code
   main-thread request rather than re-deriving per-request cost from the raw usage records. The
   conclusion does not depend on it: the recoverable count is 2 requests in 198 rollouts.
2. I did not check whether the 2 lost `-E` / `-iE` searches were retried in the next request, so
   "2 recoverable requests" is an upper bound.
3. I did not decide whether `--full` is semantically definable on `ss-grep`; `ss-grep` is
   `file:line` only, so those 3 rejections may be correct behaviour that should stand.
4. I did not open HO2, any `ho2-*` run, or any grading log, per the brief.
