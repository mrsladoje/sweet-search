# c03 — worktree-aware `ss-*` — adversarial verify, HISTORY lens

**Verdict: REFUTED as a lever. Confidence 0.80.** The mechanism is real and the code facts hold,
but the register already prices this class and the price is a correctness item, not a cost
lever. Register row E2 (`ss-*` wrapper hygiene, SHIPPED) was built on a census of eleven `--in`
directory scopes of which ten returned a false zero; **one of those eleven recorded scopes is a
worktree path** (`--in /root/.ss-eval/runs/…/agent-ae7cf969…`, `FIX-REPORT.md` §3.1) `[M]`. That
lever's measured ceiling was 0.99% of cost and under one task, and it shipped "as correctness
with no benchmark value claimed" (register E2). Half of c03 — the git-common-dir index
resolution — has **exactly zero** benchmark differential, because the runner pins
`SWEET_SEARCH_PROJECT_ROOT` `[C]`. The other half reaches five of sixty-six claude-code sweet
rollouts and zero of two hundred sixty-four codex and opencode rollouts `[M]`. Expected solves
are zero, on the one harness where sweet is already cheaper. c03 should be re-labelled a
product-correctness item under E2, and its ceiling numbers corrected downward.

---

## 1. What I checked, and what held

Every code claim in the candidate is true. I verified each one first-hand.

| candidate claim | verdict | evidence |
|---|---|---|
| `_ss-helpers.mjs` sets `PROJECT_ROOT = env \|\| cwd` and exits 2 on a missing `codebase.db` | **holds** | `[C]` `/Users/admin/Projects/sweet-search-private/eval/agent-read-workflows/bin/_ss-helpers.mjs:138-146` |
| a git worktree has no `.sweet-search/codebase.db` | **holds** | `[M]` scratch probe, below |
| `git rev-parse --git-common-dir` names the main checkout | **holds** | `[M]` scratch probe, below |
| the runner pins `SWEET_SEARCH_PROJECT_ROOT = rundir` | **holds** | `[C]` `eval/task-completion-bench/harness/agent-runner-shared.mjs`, `buildAgentEnv`, `SWEET_SEARCH_PROJECT_ROOT: rundir` |
| 44 of 44 claude-code subagent launches ran in worktrees | **holds** | `[M]` `slate-c/forensics/claude-subagents.md` §6.1 |
| 45 of 57 worktree-scoped calls returned zero, 12 usage errors | **holds** | `[M]` `slate-c/forensics/native-capability-gaps.md` §3.2 |
| the shipped `(not indexed: …)` hint does not fire for a worktree scope | **holds** | `[C]` `_ss-helpers.mjs:247-269` `excludedScopeNote`; `.claude/` is on `AGENTIC_GITIGNORE_ALLOWLIST.directories` in `core/infrastructure/config/search.js`, so `isExcluded` returns false and the wrapper prints `(no matches)` |

Scratch probe `[M]`, `$0`, no write to the user's repository, no `ss-*` invoked
(`/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f/scratchpad/wt-probe2`):
a fresh `git worktree add <main>/.claude/worktrees/agent-abc` gives
`git rev-parse --git-common-dir` = `<main>/.git`, `index present here? NO`,
`index at main? yes`. So candidate falsifier (1) would pass. The mechanism works.

**Nothing on the register names worktrees.** `grep -i worktree` over
`slate-c/register/DEAD-LEVER-REGISTER.md` returns only F15, B18 and G1b, all about delegation
volume, none about the working directory. The candidate's `register_check` is literally accurate.

That is not enough to survive. A candidate survives the history lens when no recorded killing
fact reaches its mechanism. Four do.

---

## 2. Killing fact 1 — the `--in` false-zero class is already priced, and a worktree scope was in the census

Register E2 is SHIPPED. Its killing fact reads: "A separate census found 251 grep calls, 31 with
a scope flag, 11 directory scopes, of which 10 (91%) returned a false zero match; that lever's
ceiling was 0.99% of cost and under one task, so it shipped as correctness with no benchmark
value claimed."

I opened the source. `FIX-REPORT.md` §3.1 lists all eleven recorded scopes. Two are absolute
paths. The ninth line of that list is `--in /root/.ss-eval/runs/…/agent-ae7cf969…` `[M]` — a
Claude Code agent worktree directory, returning zero matches, on the `dart http` task. So the
worktree spelling of the `--in` false zero is not a new observation. It sat inside the census
that set the 0.99% price, and the fix that shipped (whole-segment matching plus absolute-scope
root stripping, `core/search/grep-output-shaping.js:16-91`) resolved the path but could not
create index entries for a tree the index does not cover.

`reader-history-memory.md` line 32 states the verdict for that whole family in one line:
"Scope and flag honesty for the `ss` CLI (fix silent no-match on bad `--in`/flags) … **SHIPPED
as correctness, DEAD as a cost/solve lever** … ceiling 0.99% cost, <1 task solve. Shipped as a
bug fix, explicitly claiming no benchmark value."

c03 part (2) is that lever with a wider trigger. Its message half — "say 'no indexed entities in
scope' instead of '(no matches)'" — is E2's already-shipped `excludedScopeNote` `[C]` with one
extra condition. The candidate is a one-condition extension of a shipped row whose measured
benchmark value is zero.

**Escape offered by the candidate:** exposure grew. The 08-13 census saw one worktree scope in
251 `ss-grep` calls; the fresh pool sees 57 worktree-scoped calls in 1,108 claude-code sweet
`ss-*` calls `[M]`, a rise from 0.4% to 5.1%. That is a real change and it is why I do not put
confidence above 0.80. It does not clear the bar, because the extra mass lands where §3 shows
it cannot be spent.

---

## 3. Killing fact 2 — 59% of the addressable mass is register E1, already shipped, on tasks that never solve

The candidate's ceiling comes from 184,470 tokens of native fallback in the delegating rollouts.
I recomputed the addressable subset from the forensics' own data file
(`slate-c/forensics/scripts-native-capability-gaps/data/analysis-extras.txt` §C) `[M]`.

Only five rollouts had worktree-scoped zeros. Their native-retrieval token totals:

| rollout (`fp-claudecode-tab-20260826`, sweet) | tokens |
|---|---:|
| `asynkron__protoactor-dotnet-1909/rep1` | 20,627 |
| `bfgroup__b2-113/rep1` | 17,744 |
| `bfgroup__b2-113/rep2` | 25,777 |
| `bfgroup__b2-259/rep0` | 37,742 |
| `final-form__final-form-64/rep2` | 36,267 |
| **total** | **138,157** |

Three facts follow.

1. **138,157, not 184,470.** The remaining 46,313 tokens sit in `bfgroup__b2-259/rep1`,
   `awslabs__aws-embedded-metrics-node-21/rep0` and `/rep2`, which delegated but issued no
   worktree-scoped `ss-*` call `[M]`. They are not addressable by this lever at all.
2. **81,263 of the 138,157 (58.8%) are the two `bfgroup__b2` tasks** `[M]`. Register E1 records
   that their zero hits were caused by the index missing `.jam` files and git-tracked
   `src/build/` source, fixed in `36b802e` and `fb9f936`. Rewriting the scope prefix would not
   have produced a hit on those tasks in these runs, because the target files were not in the
   index at all.
3. **Both `b2` tasks are on the dead-everywhere list.** `BRIEF.md` §1.2 lists `bfgroup__b2-259`
   as 0/3 in every cell and `bfgroup__b2-113` as discordant with the cause "index gap, now
   fixed". So the largest block of the claimed saving sits on rollouts that never solve.

Recomputing the ceiling with the forensics' own price model ($0.301 per million tokens after
the 20.1× re-send multiplier, $0.000701 per extra request) `[I]`:

| envelope | tokens | requests | $/rollout | % of the $0.020727 claude-code sweet cell |
|---|---:|---:|---:|---:|
| candidate's stated upper bound | 184,470 | 91 | 0.001809 | 8.7% |
| **corrected upper bound** (worktree rollouts only) | 138,157 | 68 | 0.001352 | **6.5%** |
| **corrected realistic** (non-`b2`, post-E1) | 56,894 | 28 | 0.000557 | **2.7%** |

The candidate's "about 3% realistic" happens to land near the corrected 2.7%, but its 8.7%
upper bound is wrong by a third and should not be quoted. Weighted across the three harnesses
(claude-code only, 66 of 198 sweet rollouts) the corrected realistic figure is **0.9% of total
sweet spend** `[I]`.

A further caveat the candidate does not carry: those nine delegating claude-code sweet rollouts
are exactly the rows with a null `costRealizedUsd` (`native-capability-gaps.md` §8 trap 3)
`[M]`, and register G6 records claude-code cost as a lower bound with 205 native delegated
requests holding no usage record. The percentage is a modelled share of the rows the ledger
cannot price.

---

## 4. Killing fact 3 — the mitigation for part (1) is a prose clause, and prose clauses are dead

Part (1) proposes reading the main checkout's index from inside a worktree. The candidate's own
cited evidence records what that produces. `claude-subagents.md` §6.1 `[M]`: with the runner's
pin doing exactly this, "in the two late-delegation subagents whose parent had already edited,
2 of 9 and 4 of 13 `ss-*` results contained lines the parent had written with `Edit` before
delegating", and one subagent's final report recommended the parent's own uncommitted edit back
as the likely intended behaviour. That is 6 of 22 `ss-*` results in two subagents.

The candidate's mitigation is "a header line naming the reflected tree is mandatory". A header
line is a rule delivered as prose. The register kills that delivery class twice:

- **F8** — general engineering clauses in the guide: DEAD, 153 rollouts, every condition 3/8.
- **F9 / hint ladder** — placebo 0/4, prose rules 0/3, rule-only 1/4, against a computed
  certificate at 16/16. The register's own words: "The value is the computation, not the rule."

So part (1) knowingly ships a measured coherence hazard and mitigates it with the one delivery
form the program has shown does not change behaviour. It also converts a loud failure (exit 2)
into the quiet failure that register E3 records as still OPEN: an index that does not match the
tree the agent is looking at. E3's revival condition is a population where such calls exceed 5%
of calls. Part (1) manufactures that population rather than answering it.

---

## 5. Killing fact 4 — the prefix strip is not always correct, and the candidate's own kill condition fires

`native-capability-gaps.md` §8 trap 7 `[M]`: "`.claude/` sits on the index ALLOWLIST, not a deny
list; a worktree copy may be indexed (duplicate, 08-28 observation) or not (silent zero, this
report) depending on maintainer timing. Do not assume one behaviour."
`04-resolution-claude-code.md` line 174 `[M]` records `ss-grep` returning a `.jam` path four
times from inside a `.claude/worktrees/` copy.

I confirmed the structural cause `[M][C]`. In the scratch probe, `git worktree add` under
`<repo>/.claude/worktrees/` places a full second copy of the repository **inside the repository**,
and `git check-ignore` reports it is not ignored. `.claude/` is then on
`AGENTIC_GITIGNORE_ALLOWLIST.directories` `[C]`, and `grep -rn worktrees` over
`core/infrastructure/config/search.js` and `core/indexing/*.js` returns nothing `[C]` — there is
no worktree exclusion anywhere in the index configuration.

Two consequences the candidate does not address.

1. Any reindex while a Claude Code worktree exists duplicates the entire repository into the
   index once per live worktree. That is an index-hygiene defect larger than the retrieval
   problem c03 is trying to solve.
2. In the duplicate case, stripping the prefix silently searches a different tree than the agent
   asked about. The candidate's own kill condition (1) — "`ss-grep` from a fresh worktree already
   returns results" — is satisfied by the recorded 08-28 observation.

**The cheaper, safer fix is a different lever.** Add `.claude/worktrees/` to the index deny path.
`excludedScopeNote` (`_ss-helpers.mjs:247-269`, already shipped under E2) then fires
automatically for every worktree scope with no wrapper rewrite, no prefix arithmetic, and no
two-views hazard. If the synthesis keeps anything from c03, keep that.

---

## 6. Two secondary problems

**The `$0` falsifier as written is not runnable.** Falsifier (2) replays the 45 patterns
"against the `b2`, `final-form` and `protoactor` goldens". Register §12.4 item 25 records:
"Four named falsifiers — hygiene replay, index-rebuild replay, working-tree freshness census,
`run_tests` scope census — are all specified and none has been run. **Each needs scratch write
access to a rebuilt golden.**" Register E1 records that every fresh-pool row still carries a
golden index dated 2026-07-16. So for the 59% of the mass that is `b2`, the replay either
returns the same zero it returned live, or it is run on a rebuilt golden and measures E1 and
c03 together, confounded. Falsifier (1) is genuinely instant and genuinely `$0`; it also proves
nothing that `_ss-helpers.mjs:138-146` does not already state.

**The 54% real-user figure is a max-of-maxima.** `candidates/DEDUP.md` derives it as 16.04 Bash
envelopes per rollout × $0.00070 = $0.0112 = 54% of the claude-code sweet cell `[I]`. That
assumes a real user's whole session lives inside a worktree and that every `ss-*` call in it is
issued and fails. The measured worktree residency in this evidence is subagents only, 9 of 66
sweet rollouts. Do not publish 54% without that condition attached.

---

## 7. What this means for the brief's target

`BRIEF.md` asks for sweet to be at most as expensive as native on **each** of three harnesses
while solving at least as many tasks. c03 gives:

| harness | sweet vs native today `[M]` | c03 corrected ceiling `[I]` | solves |
|---|---:|---:|---:|
| codex | +0.3% | 0.0% (no delegation in 132 rollouts) | 0 |
| opencode | +3.3% | 0.0% (no delegation in 132 rollouts) | 0 |
| claude-code | −3.9% | −2.7% | 0 |

It moves nothing on the two harnesses where sweet is not ahead. It improves the one harness
already ahead on cost and behind on solves (40/66 against 43/66). Rule 9 — solve is the veto —
is not violated, but nothing is bought either. Exposure is 5 of 66 claude-code sweet rollouts
(7.6%), 5 of 198 sweet rollouts overall (2.5%). For calibration, register B18 was killed DEAD at
an exposure of 3 of 34 claude-code sweet cells.

---

## 8. Disposition I recommend

- **Refute c03 as a lever.** Re-file it under **E2** as a wrapper-correctness item, alongside the
  other hygiene fixes that shipped with no benchmark value claimed.
- **Keep part (1) as a genuine production defect.** It is code-confirmed, hours to build, and
  real users do run Claude Code worktrees. Ship it as correctness, priced at zero, and drop the
  header line as the mitigation — a prose line is not one.
- **Replace part (2) with the index-side fix.** Deny `.claude/worktrees/` at index time. It fixes
  the silent zero, fixes the duplicate-index face, needs no prefix arithmetic, and reuses the
  shipped `excludedScopeNote` message.
- **Correct the numbers wherever c03 is quoted:** upper bound 6.5% not 8.7%; addressable mass
  138,157 tokens not 184,470; 58.8% of that is register E1 on dead-everywhere tasks; realistic
  2.7% of one harness's sweet cell, 0.9% of total sweet spend, 0 solves.

## 9. What I could not finish

1. I did not run falsifier (2). The `b2` half needs a rebuilt golden, which is a box write and,
   per register §12.4 item 25, has never been done for any of the four falsifiers in this class.
2. I did not open the raw subagent transcripts on the evidence box. Every rollout-level number
   here is taken from `slate-c/forensics/scripts-native-capability-gaps/data/analysis-extras.txt`,
   which is that agent's own measurement, not my re-derivation from the traces.
3. I did not price what fraction of the 45 worktree-scoped zeros would return a hit after a
   prefix strip on a current index. That is the candidate's central unknown and it stays unknown.
4. I did not confirm whether `_admissionPolicy.isExcluded('.claude/worktrees/agent-X')` returns
   false in the shipped policy. I inferred it from `AGENTIC_GITIGNORE_ALLOWLIST` `[C]` and from
   the forensics agent's independent statement of the same conclusion `[M]`.
