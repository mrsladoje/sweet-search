# Candidates, lens "inversion and removal"

Date: 2026-09-02. Agent: inversion-and-removal (slate C ideation). Spend: `$0` — trace reading,
static reads, arithmetic. No product code and no bench code was edited. Nothing was written under
`results/`. HO2 was never opened. No grading log was opened, so no hidden test name and no
reference-patch content appears below.

---

## 0. Verdict

**Sweet cannot be made cheaper than native on all three harnesses by removing things, and the
measurement cannot prove it either way at this pool size.** Three facts decide it, and I measured
all three myself.

First, the noise floor swallows every admissible lever. The 95 percent bootstrap interval on the
sweet-minus-native cost ratio is [−11.5%, +13.2%] on codex, [−8.1%, +17.0%] on opencode and
[−19.6%, +26.9%] on the claude-code main thread `[M]`. The published gaps (+0.35%, +3.31%,
−1.38%) sit near the middle of intervals that are twenty to fifty times wider than themselves.

Second, sweet's one measured win is partly a defect in our own claude-code adapter. Native loses
93 requests of 66 rollouts to an invalid `pages` argument, against sweet's 25 `[M]`. Repairing
that for both arms moves the claude-code main-thread comparison from −1.38 percent to **+0.62
percent** at the conservative price and to **+4.8 percent** at the fuller attribution `[M]+[I]`.

Third, the biggest single number on codex is a harness subsidy that sweet cannot claim. Codex's
output cap deletes 610,123 tokens of native's tool output and 108,679 of sweet's, over 66
rollouts each `[M]`. Priced at the effective per-token rate that is $0.002246 per native rollout
against $0.000426 per sweet rollout — an asymmetric forgiveness of **$0.001820 per rollout, 14.8
percent of the codex native cell** `[I on M]`. Native is paid to over-fetch. Sweet's whole design
optimises a quantity the harness already zeroes out for its competitor.

On removal: **"drop the guide and measure" is killed at `$0` by its own pre-registered
falsifier.** 97.7 percent of codex, 100.0 percent of opencode and 98.2 percent of claude-code
sweet `ss-*` operations use an argument form that only the guide documents, against a kill line of
20 percent `[M, 3,064 operations, 198 rollouts]`. The tools have no working self-description —
`--help` exits 2 — so the guide is the only source of their syntax. The honest sequence is to make
the tools self-describing first, then re-price the guide. What can be removed today is smaller and
narrower: three guide passages that implement mechanisms the register has already killed three
separate times, and two tools that account for 1.9 percent and 0.0 percent of sweet's calls.

---

## 1. Scope and method

Runs read: `fp-{codex,opencode,claudecode}-{tab,none,pipe}-20260826` and `rp-oc-{tab,none,pipe}-20260827`
under `/root/sweet-search-private/eval/task-completion-bench/results/` (read-only). Scratch:
`/tmp/wf-slatec/inversion-removal/` on the box and the local scratchpad. Scripts I wrote and ran:

| script | what it measures |
|---|---|
| `gutter_cost3.py` | per-cell cost and solves by gutter form; paired per-task log ratios; 4,000-draw bootstrap intervals |
| `pagescheck.py` | claude-code main-thread `Read` failures on an invalid `pages` value, by arm, and requests where every call failed |
| `guidesyntax.py` | share of sweet `ss-*` operations that use guide-documented argument forms |
| `capsubsidy.py` | codex output-cap deleted tokens per arm, priced at the effective re-send rate |

`guidesyntax.py` and `capsubsidy.py` read two artefacts a sibling agent left on the box:
`/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz` (10,942 classified calls) and
`/tmp/wf-slatec/codex-cap-x-ss/cx-census.json` (343 truncation cases). Raw output of all four is
saved locally at
`/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f/scratchpad/inversion-measurements.txt`.

Price vector, as registered: $0.10 per million new input, $0.01 cached, $0.60 output. Re-sends per
ingested token: codex sweet 15.9, codex native 14.3 (`BRIEF.md` §1.1). Counterfactual price of a
removed request, from `verify-tail.md` §5: codex $0.000374, opencode $0.000266, claude-code
$0.000318. That price is output plus prefix re-send only, because the ingest a removed request
carried moves to the next request.

Canonical cells `[M gutter_cost3.py]`, reproducing the brief exactly:

| harness | native $/rollout | sweet $/rollout | gap | gap % | 95% CI on gap % |
|---|---:|---:|---:|---:|---|
| codex | 0.012287 | 0.012330 | +$0.000043 | +0.35% | [−11.5%, +13.2%] |
| opencode | 0.008968 | 0.009265 | +$0.000297 | +3.31% | [−8.1%, +17.0%] |
| claude-code, main only | 0.016542 | 0.016314 | −$0.000228 | −1.38% | [−19.6%, +26.9%] |
| claude-code, inclusive | ≥0.021558 | 0.020727 | −$0.000831 | −3.9% | not computed here |

Solves: codex 41 native / 39 sweet, opencode 41 / 41, claude-code 43 / 40, of 66 each `[M]`.

---

## 2. Part A — inversion: ten ways a native-side adversary wins on this pool

I was asked to argue the other side. Each exploit gets either a defensive lever sweet can build,
or a plain admission that sweet cannot answer it.

### A1. Keep our own `pages` defect alive on claude-code

`[M pagescheck.py]` In `fp-claudecode-tab-20260826`, main thread only, `Read` calls that died on
`Invalid pages parameter`: native 163 calls in 67 transcripts; sweet 25 in 20. Requests where
**every** tool call failed that way: native 93, sweet 25, over 66 rollouts each — 1.41 and 0.38
wholly wasted requests per rollout. This reproduces `phase-anatomy.md` PA-6 (1.39 against 0.42)
from a second, independent parser.

Priced at the counterfactual removal price ($0.000318), the defect costs native $0.000448 per
rollout and sweet $0.000120 `[I]`. Repairing it for both arms moves the claude-code main-thread
comparison from −1.38 percent to **+0.62 percent** `[I]`. Priced instead at
`claude-main-thread.md` F4's realized attribution (6.81 percent of the native arm, 1.00 percent of
sweet), the move is to **+4.8 percent** `[I]`.

**Admission.** Register D4b records that the residual failures cannot be closed by any documented
Claude Code surface, and that the normalizer hook is provably inert. Sweet's claude-code lead is
partly rent from a defect in our own adapter, and the rent is between 2.0 and 6.2 points.

### A2. Reprice native's subagents at the model native asked for

`[M cited claude-subagents.md F7]` Native requested haiku for 19 of 33 subagents, which carried
56.4 percent of native's sidechain spend; sweet requested it for 6 of 11, carrying 36.3 percent.
Every one was billed at luna's rate. At Anthropic's list ratios sweet's inclusive claude-code
margin moves from −9.2 percent to −3.0 or −4.1 percent `[I]`.

**Admission.** This is a pricing convention, not a lever. It should be disclosed beside G6
whenever the claude-code number is published.

### A3. Delegate more, and on a newer binary

`[M cited agent-efficiency-2026.md F6]` Native launched the built-in Explore agent 60 times
against sweet's 12 in the same run, and Explore writes no usage record. `[W harness-changelogs.md
F10]` Claude Code 2.1.232 turns subagent forking on by default, so a forked subagent inherits the
parent's prompt cache; native's 5.3-to-8.5k-token fresh preamble per subagent becomes a cache
read. Native's delegation therefore gets cheaper on any newer binary, and the claude-code delta
widens against sweet.

**Admission, plus a measurement rule.** Never pool a run across a harness upgrade, exactly as the
register forbids pooling across a shipped product fix. Register F15 already forbids the obvious
counter-move (make sweet delegate too).

### A4. Over-fetch on codex, because the cap makes over-fetching free

`[M capsubsidy.py, over cx-census.json]` The ~2,500-token output cap truncated 238 native calls
and 105 sweet calls, deleting 610,123 and 108,679 tokens respectively over 66 rollouts each.
Effective price per delivered token, ingest plus re-send: native $0.243 per million, sweet $0.259
per million. Had the deleted text been billed it would have cost native $0.002246 per rollout
(18.3 percent of the native cell) and sweet $0.000426 (3.5 percent). **The asymmetric forgiveness
is $0.001820 per rollout, 14.8 percent of the codex native cell** `[I on M]`.

A native adversary maximises this deliberately: read wider spans, add `-C 8`, chain more `sed -n`
into one envelope. Everything above the cap is free.

**Admission.** Register C8 already rejects raising the cap (delivering the truncated text in full
costs 2 to 19 times what the follow-ups cost) and notes it is a shared setting with zero
differential. Sweet's only in-scope answer is C9, the addressable continuation span, which
`codex-cap-x-ss.md` F11 prices at −0.36 percent best case and **cost-positive above a 9.5 percent
pointer-follow rate**, against a measured follow rate of 23.6 percent. C9 stays PARKED as
correctness. Codex is a harness where sweet's discipline is structurally unrewarded, and this is
the mechanism behind G15's −6.5 percent to +6.3 percent inversion.

### A5. Emit structured tools in parallel on opencode

`[M cited opencode-calls-per-request.md F2]` Inside the native arm, the share of calls sitting in a
multi-call request is: `read` 84.5 percent, `glob` 90.1 percent, `grep` 75.2 percent, `bash` 37.3
percent. Sweet's bash is 36.1 percent — one point from native's own bash. The tool family, not the
arm, sets the habit. `[C]` opencode 1.18.4's `read` description says "call this tool in parallel";
its `bash` description forbids file operations. Sweet pays +3.38 requests per rollout, +10.2
percent.

**Admission unless the owner reopens A4.** Register A1 kills the prompt route four times over, and
`harness-changelogs.md` F5 shows opencode's own system prompt already orders parallel bash calls
verbatim while luna emits 1.11 calls per request anyway. The only mechanism left is a structured
surface, which is OWNER-EXCLUDED.

### A6. Attack the index admission policy — every exclusion is a native win

Native's `grep` sees the disk. Sweet's index has an admission policy, so every rule in it is an
attack surface. One 22-task pool already contains five instances: a committed 35,000-line bundle
(native edited it in 9 of 9 rollouts, sweet in 3 of 9 `[M cited verify-tail.md §6]`), `.jam` build
files, git-tracked source under build directories, an extensionless dot-config (`.eslintrc`,
`[M cited phase-anatomy.md PA-5]`), and worktree paths (45 of 45 scoped calls returned a silent
zero, `[M cited native-capability-gaps.md F3]`).

**Partial defence.** E1 and E2 shipped three of the five. Dot-configs and worktree scopes are
open. But the class is unbounded by construction: an index that admits everything is a `grep`.

### A7. Make sweet trust a false absence

`[M cited claude-main-thread.md F7–F9, F11]` Three distinct `ss-grep` mechanisms return a false
"no matches": an alternation branch with no three-character literal (59 real matches dropped),
`--in .` (5 of 5 calls answered zero), and a `--in` path that does not exist (11 calls). 64 of 71
zero-match candidates over 198 rollouts are index-coverage exclusions. `[C]` The guide then tells
the model: "Two empty index probes over the whole codebase are more conclusive than any raw scan
or file listing, so state the negative and stop searching."

Native has no equivalent. A `grep` that finds nothing has looked at the file.

**Defensive lever, and it is a removal — candidate C3 below.** Its cost sign is negative: honest
absence answers will provoke more probes. Under the cost objective this is not a lever; it is a
correctness obligation that must not be sold as one.

### A8. Run sweet on a gated Anthropic model

`[C claude-main-thread.md F5, verified in two binaries]` The claude-code `Edit` read-before-edit
guard fires only for ten legacy model ids. The bench ran luna, outside the set, so the risk is
invisible here. `[M cited F6]` Where it binds, sweet would pay one failed `Edit` plus one `Read`
for 68 files across 56 of 66 rollouts: **+7.8 to +9.4 percent of the sweet main-only arm**. Native
pays nothing — 92 of 92 first edits had a prior `Read`. The guide actively steers away from the
native reader.

**Admission plus a bounded defence.** A harness-compatibility sentence caps the tax at roughly
half by removing the failed `Edit`, but wastes a `Read` on every ungated model, and the guide
cannot see the model id. This is register H1/D6, still UNMEASURED as a product risk, now priced.

### A9. Strand sweet's tools where the guide does not reach

`[M cited claude-subagents.md F2, F3]` Claude Code's built-in Explore subagent receives no project
rules: sweet and native Explore first requests differ by **zero tokens**. Eight guide-less Explore
subagents made 215 `ss-*` calls, 200 of them by absolute path, with 13 binary-hunt calls, 12
rejected `--help` calls and a 14.0 percent failure rate against 4.8 percent in the guided main
thread. `[M guidesyntax.py]` I count 11 `--help` or `-h` calls on the claude-code sweet side; all
are rejected, because `--help` exits 2.

**Defensive lever, cheap.** Fix `--help` to print usage and exit 0, accept the aliases guide-less
callers actually guessed, and let `init` write a project `Explore.md` that carries the guide. This
is also the precondition for the guide question (Part B).

### A10. Choose the pool, then point at the noise

`[M gutter_cost3.py]` The NONE-versus-TAB gutter contrast is the cleanest noise probe this
programme owns, because the treatment's true token effect is known analytically to be about 0.3
percent (register C4). Measured, paired per task, sweet only:

| harness | NONE against TAB, cost | 95% CI | solves TAB / NONE |
|---|---:|---|---:|
| codex | −0.09% | [−7.1%, +10.1%] | 39 / 41 |
| opencode | −7.35% | [−14.2%, +0.6%] | 41 / 39 |
| claude-code, main | −5.06% | [−19.2%, +8.1%] | 40 / 41 |

A treatment worth 0.3 percent measures anywhere from −0.1 to −7.4 percent across three harnesses.
That spread **is** the noise floor of a 22-task, 3-rep cell, and it is one-sided; the two-sided
bootstrap half-width is 9 to 23 points.

**Defence: pre-register the pool and publish intervals.** Register G10 already prices the honest
alternative at about 465 tasks for 80 percent power on a 5 percent effect, against the current
paired corpus of 16 to 17.

### Bonus exploit — simply count sweet's constant tax

Guide $0.00042 to $0.00051 (2.6 to 4.5 percent), gutter $0.00030 to $0.00039 (2.0 to 3.7 percent),
requests reacting to a failed `ss-*` call at most 2.4 / 2.2 / 1.9 percent (`BRIEF.md` §1.1,
register E2, an upper envelope not removable spend). Sweet starts each rollout 7 to 10 percent
behind. Native carries no equivalent. This is the frame of the whole removal question.

---

## 3. Part B — removal: what sweet should turn off, and what `$0` evidence bounds it

Ranked by measured size, largest first. Two of the six are recommendations **not** to remove.

### B1. Drop the guide and measure — answered at `$0`, and the answer is no

`[M guidesyntax.py; 3,064 `ss-*` operations across 198 canonical sweet rollouts]` Share of `ss-*`
operations that use an argument form documented only in the guide:

| harness | ss-* operations | guide-taught syntax | bare / guessable |
|---|---:|---:|---:|
| codex | 970 | 948 (**97.7%**) | 22 (2.3%) |
| opencode | 788 | 788 (**100.0%**) | 0 (0.0%) |
| claude-code | 1,306 | 1,283 (**98.2%**) | 23 (1.8%) |

Forms counted: `-k N` (1,527 uses), a read span (1,380), `--in` (338), `--regex` (245), the
`ss-semantic <file> "<query>"` two-argument form (at least 52), an `ss-trace` mode word (27). The 45 "bare"
operations are whole-file `ss-read` calls (codex) and rejected `--help` / `-h` probes (claude-code).

`agent-efficiency-2026.md` seed S1 pre-registered the kill line for a harness-conditional guide
drop: **kill if more than 20 percent of `ss-*` calls depend on guide-taught syntax.** The measured
value is 98 to 100 percent. The falsifier fires on every harness.

The second, independent `$0` bound is the in-bench natural experiment nobody has named as one.
Eight claude-code Explore subagents ran with `ss-*` on PATH and no guide. Over those eight,
`claude-subagents.md` §5 prices the pre-first-`ss-*` phase at 31 requests and the wholly-failed
`ss-*` requests at 15 more, union at most $0.0255 `[M]` — **about $0.0032 and roughly 5.8 requests
of pure discovery per guide-less agent** `[I]`. The guide costs $0.000417 to $0.000511 per
rollout. Dropping it is predicted to lose **6.2 to 7.6 times** what it saves, before any
behaviour changes.

The third bound is behavioural and only applies to claude-code: the guide's no-delegation effect
is worth $0.001529, 7.5 percent of a rollout (`agent-efficiency-2026.md` F5), against a guide cost
of 3.1 percent there. On claude-code the guide already pays for itself three times over.

**Conclusion.** Do not run a guide ablation. The precondition that would make one meaningful is a
working self-description: `--help` currently exits 2 with `[ss] unrecognised option`, so a
guide-less caller cannot learn `-k`, a span, `--in` or `--regex` from the tool. Fix that first,
re-run this census, and the 98-to-100-percent dependence becomes zero; only then is the guide's
remaining value pure policy and worth pricing. Owner decision flagged: this is register **B3**,
PARKED, and the owner's 2026-08-10/13 decision protects the guidance block. Nothing here asks to
reopen it; it removes the reason to.

### B2. Remove the guide passages that implement register-dead mechanisms — candidate C1

Three passages in `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` implement
mechanisms the register has already killed:

1. *"Before editing a symbol with visible siblings ... spend ONE mapping call: `ss-trace <symbol>`,
   or a broad `ss-grep` of the stem."* Register E4 (sibling retrieval, DEAD, usable exposure 0 of
   102), B9 (completeness card, DEAD, strict count 0 against a bar of 2) and P1 (general clauses,
   DEAD, every condition flat at 3 of 8 tasks) all kill this mechanism from three directions.
   `[M cited phase-anatomy.md PA-3]` On claude-code it drives 2.21 single-probe post-edit requests
   per solved rollout against native's 1.03, and **0 of 87 such probes on solved sweet rollouts
   preceded an edit of a new file**, against native's 33 of 83.
2. *"Any sub-agent you delegate to must use these `ss-*` tools, with this system prompt verbatim."*
   `[M cited claude-subagents.md F2]` It is structurally unobeyable where 21 of 27 delegations
   land, because the built-in Explore agent skips project rules; the sweet and native Explore
   first requests differ by zero tokens. Where it does fire, on general-purpose subagents, it adds
   1,516 uncached tokens. Register F15 kills the delegation direction it protects.
3. The `ss-semantic` tool line, see B3.

Removal is a removal, not a trim: it deletes about 95 tokens of 1,457 and, on claude-code, a
measured request chain with zero measured yield.

**Why this is not register B2.** B2 is CLOSED because trimming *redundancy* nets 23 tokens. This
removes *content*, and its case is not word count: three independent gates say the content buys
nothing, and one forensics report prices the requests it causes.

**Why P1 is evidence for removal, not against it.** P1's own killing fact is that four clause
conditions all solve exactly 3 of 8 tasks and 9 of 24 rollouts, with cost flat at +0.6 / −0.2
percent — "free but inert". If adding an engineering clause is inert, removing one is inert on
solves and returns its cost. No document has read P1 in that direction.

### B3. Retire `ss-semantic` and `ss-batch` from the agent surface — candidate C4

`[M guidesyntax.py]` Of 3,064 sweet `ss-*` operations across 198 rollouts:

| tool | codex | opencode | claude-code | total | share |
|---|---:|---:|---:|---:|---:|
| `ss-read` | 542 | 438 | 429 | 1,409 | 46.0% |
| `ss-grep` | 219 | 199 | 465 | 883 | 28.8% |
| `ss-search` | 123 | 102 | 198 | 423 | 13.8% |
| `ss-find` | 27 | 35 | 192 | 254 | 8.3% |
| `ss-semantic` | 46 | 6 | 7 | 59 | **1.9%** |
| `ss-trace` | 13 | 8 | 15 | 36 | 1.2% |
| `ss-batch` | 0 | 0 | 0 | **0** | 0.0% |

`ss-batch` is deployed, absent from the guide, and called zero times — consistent with register
A2's "0 times in 198 opencode rollouts", now confirmed across all three harnesses. `ss-semantic`
is effectively codex-only (0.70 calls per rollout there, 0.09 elsewhere). Register E8 records a +6
to +118 percent token premium for semantic retrieval and a 0-to-6-percent voluntary pick rate.
`[M cited phase-anatomy.md PA-9]` 7 of its 58 calls returned a `[FALLBACK]` whole-file span on an
index-excluded file, about 2.8 kB of bundle head each.

Ceiling, honestly bracketed. Provable waste is the 7 fallback calls: 0.035 requests per rollout,
−$0.000013, **−0.1 percent** of the codex sweet cell. Upper bound, if every `ss-semantic` call
were pure waste with no substitute: 0.70 × $0.000374 = $0.000262, **−2.1 percent** on codex, about
zero elsewhere. The truth is near the floor, because the substitute is usually one `ss-read` and
one request either way.

### B4. Do not remove the gutter — re-measured and still closed

The task asks about "the gutter on some surface". `[M gutter_cost3.py]` The NONE cells are not
reliably cheaper and not reliably worse on solves (table in A10). Register C4 closes the gutter as
a cost lever ($0.0003–0.0004 per rollout analytically); C7 kills deletion (121 against 120 of 198
solves); the owner decided on 2026-08-28 to keep `N<TAB>` everywhere. My contribution is one
correction of interpretation: the **cell-level** NONE-minus-TAB delta is 10 to 20 times the
analytic token effect on opencode and claude-code, which means what is being measured there is
run-to-run variance, not the gutter. Do not read −5 or −7 percent as a gutter saving.

One residual asymmetry is worth recording rather than acting on: register C1's own n=66 numbers put
like-for-like anchor-failure rates at native 7.4 percent, TAB 5.9 percent, NONE 4.4 percent. The
form that motivated the gutter fix is not the form with the fewest anchor failures at scale. That
is a `$0` observation, inside noise, and it does not reopen an owner decision.

### B5. Do not remove the sufficiency line, the `<state_summary>` block, or the continuation trailer

- **Sufficiency trailer.** `[M cited codex-cap-x-ss.md F5]` It reached the model in 33 of 33
  truncated search packs, including 29 of 33 where the cut landed inside the top-1 body. It is one
  line and it is the last thing to survive a truncation. Removing it saves nothing and removes the
  one signal that survives the codex cap.
- **`<state_summary>`.** Register B4, DEAD: under 0.5 percent of spend and never its own request.
  `[M cited verify-tail.md §7]` Exactly 2 of 396 rollouts end on one, and only 1 with no patch.
- **`continue: ss-read` pointer trailer.** `[M cited codex-cap-x-ss.md F10]` 242 pointers, followed
  within three calls 23.6 percent of the time and ever 32.6 percent. Register B8 kills inlining the
  *bodies*; the pointer tier ships and earns a follow one time in four for one line. Keep it.

### B6. The removal that costs money, and must not be sold as a lever — candidate C3

Delete the guide's certainty about absence and make every zero-result path say why it is zero.
Evidence in A7. The expected cost sign is **negative**: an honest "not indexed" or "scope missing"
answer invites a further probe. The prize is real-world correctness — on one task sweet shipped a
patch that native did not, because sweet believed a silent zero about a committed bundle
(3 of 9 against 9 of 9) — and the bench graders happened not to punish it (all 18 rollouts solved).
State this as correctness. Do not book it against the cost objective.

---

## 4. Part C — the honest cost-sign arithmetic

Question: is any combination of admissible levers big enough to reach at most native cost on all
three harnesses?

**Answer: yes as a point estimate, no as a demonstration.**

### C.1 What has to be closed

| harness | gap to close, $/rollout | as % of the sweet cell | 95% CI on that % |
|---|---:|---:|---|
| codex | $0.000043 | 0.35% | [−11.5%, +13.2%] |
| opencode | $0.000297 | 3.31% | [−8.1%, +17.0%] |
| claude-code, main only, today | already −$0.000228 | −1.38% | [−19.6%, +26.9%] |
| claude-code, main only, after the `pages` repair | +$0.000099 | +0.62% | interval unchanged |

The last row is the one that matters. `[M+I]` Repairing the invalid-`pages` defect for both arms
removes $0.000448 per native rollout and $0.000120 per sweet rollout, giving native $0.016094 and
sweet $0.016194. The sign flips. Under the fuller attribution it flips to +4.8 percent.

### C.2 Admissible levers with a stated ceiling

Admissible means: sweet-only vehicle, and not DEAD / CLOSED / INVERTED / BANNED on the register.

| lever | source | codex | opencode | claude-code (main) |
|---|---|---:|---:|---:|
| plan-tool suppression via the guide | `verify-tail.md` §10 and `phase-anatomy.md` PA-8, **already booked — do not re-book** | −$0.001469 (−11.9%) | −$0.001006 (−10.9%) | −$0.000606 (−3.7%) |
| dead-clause purge (candidate C1) | this report | −$0.000027 (−0.22%) | −$0.000027 (−0.29%) | −$0.000133 to −$0.000533 (−0.8% to −3.3%) |
| retire `ss-semantic` / `ss-batch` (C4) | this report | −$0.000013 to −$0.000262 | ≈0 | ≈0 |
| opencode plugin surface | `harness-changelogs.md` L-1, needs a user decision | — | −$0.000945 (−10.2%) | — |
| codex continuation span (C9) | register, PARKED | −$0.000045 best; **+$0.000125 at the measured 23.6% follow rate** | — | — |
| `--help` and alias repair, worktree scope, absence honesty | this report and siblings | ≈0 or negative | ≈0 or negative | ≈0 or negative |

### C.3 Arithmetic per harness

**codex.** Gap $0.000043. The two smallest removals alone — the purge ($0.000027) plus the
`ss-semantic` retirement at its provable floor ($0.000013) — total $0.000040, which is 94 percent
of the gap; at the retirement's upper bound they total $0.000289, **6.7 times** the gap. The plan
lever alone is 34 times the gap. Codex reaches parity on removals only. C9 must be excluded: it is
cost-positive at the measured pointer-follow rate.

**opencode.** Gap $0.000297. The small removals cover $0.000027, **9 percent** of the gap. Only
two levers are large enough: plan-tool suppression ($0.001006, 3.4×) and the plugin surface
($0.000945, 3.2×). The first is behavioural and unfalsifiable at `$0`; the second needs the owner
to reopen the 2026-07-31 structured-surface decision. Opencode is the harness where removal alone
does not reach parity.

**claude-code.** Today the sign already favours sweet on both accountings. After the `pages`
repair the gap is +$0.000099. The purge covers it 1.3 to 5.4 times over. But three things push the
other way and none is a lever sweet controls: repricing native's subagents at haiku
(−9.2 percent to −3.0 percent inclusive), subagent forking becoming default on newer binaries, and
the read-before-edit gate costing sweet 7.8 to 9.4 percent on any gated Anthropic model.

### C.4 Why the answer is still "no" in the sense that matters

Take the strongest admissible portfolio: plan-tool suppression on all three, plus the purge, plus
the tool retirement. The post-lever point estimates would read −11.9 percent on codex, −8.2
percent on opencode, and −4.0 percent on the claude-code main thread once the `pages` repair is
applied to both arms (−5.8 percent without it). Every one of those sits **inside** the interval
the same 22-task pool already produces for a null treatment: [−11.5%, +13.2%], [−8.1%, +17.0%],
[−19.6%, +26.9%]. The largest of them, −11.9 percent on codex, clears that interval's lower bound
of −11.5 percent by four tenths of a point.

Three further vetoes:

1. **Solve is the veto and no removal has a solve estimate.** P1 is the best available proxy and it
   says clauses are inert both ways, at n=153 rollouts. That is a proxy, not a measurement of these
   passages.
2. **Compliance is unmeasured.** The guide's tool-choice directives are obeyed almost completely
   (sweet's tail uses a native reader 1, 0 and 0 times against 18, 15 and 45 `ss-*` calls). Its
   negative directives have never been tested, and register A1 and A6 record four independent
   findings that luna ignores instructions to change its call pattern.
3. **Power.** Register G10 puts 80 percent power on a 5 percent cost effect at about 465 tasks. The
   fresh pool is 22.

**The honest recommendation.** Stop trying to move the sign. Ship the two arm-universal repairs
that stop native looking dearer than it is (the `pages` residue and the subagent price
disclosure), ship the correctness removals, and publish all three cells with their bootstrap
intervals and their denominators. A programme that reports "+0.35 percent, 95 percent interval
[−11.5, +13.2], n=22 tasks" is telling the truth; one that reports "−11.9 percent after the plan
lever" on the same pool is not.

---

## 5. Candidates

Five, in the required schema. Two are cost levers, two are correctness removals whose cost sign is
zero or negative, and one is a shared accounting obligation that is explicitly **not** a lever.

### C1 — Dead-clause purge: remove three guide passages that implement register-dead mechanisms

- **Family:** prompt guide and clauses. **Lens:** removal.
- **Harnesses:** claude-code (large), codex and opencode (token-only).
- **Mechanism:** delete from `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`
  (a) the sibling mapping-call paragraph, (b) the subagent-verbatim sentence, (c) the
  `ss-semantic` tool line (see C4). About 95 tokens of 1,457.
- **Why native cannot match it:** the guide reaches only the sweet arm. The removed request chain
  exists only in sweet.
- **Evidence:** `phase-anatomy.md` PA-3 (claude-code sweet 2.21 post-edit single-probe requests per
  solved rollout against native 1.03; **0 of 87 probes preceded a new-file edit** against native's
  33 of 83; transcripts `fp-claudecode-tab-20260826/callstack__react-native-paper-972/sweet/rep2`
  requests 10–21, 25–28, 33–34; `.../jazzband__tablib-454/sweet/rep1` requests 8–12;
  `.../aws-actions__configure-aws-credentials-42/sweet/rep1` requests 7–21). `claude-subagents.md`
  F2 (Explore first-request token delta zero; general-purpose +1,516). Register E4, B9, P1, F15.
- **Ceiling:** guide tokens −$0.000027 codex (−0.22%), −$0.000027 opencode (−0.29%), −$0.000033
  claude (−0.20%). Behaviour, claude-code only: −$0.000519 per solved-everywhere rollout (−5.9% of
  the sweet main thread there) at full compliance; pooled over all sweet rollouts the excess is only
  +0.24 probes, so −$0.000100 to −$0.000500 (−0.6% to −3.1%). Total claude-code −$0.000133 to −$0.000533, −0.8% to −3.3%.
  Solves: predicted flat, on P1's flat-in-both-directions result. **Not enough on its own for
  opencode.**
- **Vehicle:** tool guide, `AGENTS.md` and `.claude/rules/sweet-search.md`. **sweet_only: yes.**
- **`$0` falsifier:** re-run `scripts-phase-anatomy/postedit-search-yield.py` over
  `anatomy-alltasks.json`, restricted to solved rollouts, and count post-first-edit `ss-*` probes
  that precede an edit of a file not yet edited.
- **Kill condition:** kill if more than 10 percent of sweet's post-first-edit probes on solved
  rollouts precede a new-file edit on any harness. Measured today: 0 of 87 on claude-code
  (0.0 percent), 25 of 56 on codex (44.6 percent), 20 of 37 on opencode (54.1 percent) — so the
  falsifier **already restricts the removal to claude-code**, and the codex and opencode part of
  this candidate is the token removal only.
- **Build cost:** three deletions in one Markdown file plus a prompt-optimisation length re-check.
  No product code.
- **Register check:** nearest rows are B2 (guide trim, CLOSED — that is word count on redundant
  text; this removes content whose mechanism three gates killed), P1/F8 (clauses DEAD — read here
  as evidence that removal is inert on solves), E4 and B9 (the mechanism itself, DEAD), F15
  (delegation, DEAD). No row records the post-edit probe cost or its zero yield.
- **new_tool:** false. **needs_user_decision:** true — the guidance block is owner-protected
  (2026-08-10/13).
- **Solve risk:** low but real and unmeasured. The mapping sentence is the only guide text that
  asks for completeness; P1 says such text is inert, but P1 tested added clauses, not these.

### C2 — Make the tools self-describing, then re-price the guide

- **Family:** wrapper hygiene, and the precondition for register B3. **Lens:** removal, sequenced.
- **Harnesses:** all three; the measured demand is on claude-code.
- **Mechanism:** in `eval/agent-read-workflows/bin/_ss-argparse.mjs`, make `--help` and `-h` print
  usage and exit 0 instead of `[ss] unrecognised option` with exit 2, and accept the aliases
  guide-less callers actually guessed (`-E`, `-i`, `-F`, `--full`). Then re-run the guide-syntax
  census; if dependence falls under 20 percent, the harness-conditional guide drop becomes
  measurable for the first time.
- **Why native cannot match it:** it is sweet's own wrapper.
- **Evidence:** `[M guidesyntax.py]` 97.7 / 100.0 / 98.2 percent of 3,064 sweet `ss-*` operations
  use guide-only syntax; 11 rejected `--help` or `-h` probes on claude-code sweet.
  `[M cited claude-subagents.md F3]` guide-less Explore subagents: 215 calls, 30 failures (14.0%),
  13 binary hunts, 12 rejected `--help`, against 4.8 percent failures in the guided main thread and
  5.9 percent in three guided general-purpose subagents that made 0 hunts.
  `[M cited native-capability-gaps.md F8]` 36 of 329 subagent `ss-*` calls were usage errors
  against 12 of 779 on the main thread.
- **Ceiling:** the repair itself is at most the failed-`ss-*` request envelope, ≤$0.0073 = 0.56
  percent of the claude-code sweet arm, and about 0.2 percent elsewhere. Its real value is that it
  converts register B3 from an unfalsifiable owner question into a measurable one. Today the answer
  to B3 is **do not run it**: the guide costs $0.000417–$0.000511 per rollout and the one measured
  guide-less population pays about $0.0032 per agent in discovery, a 6.2-to-7.6-times loss `[I on M]`.
- **Vehicle:** `_ss-argparse.mjs` and `_ss-helpers.mjs`. **sweet_only: yes.**
- **`$0` falsifier:** re-parse the recorded `--help`, `-h`, `-E`, `-i`, `-F`, `--full` rejections
  against the proposed argument table; then re-run `guidesyntax.py` with `-k` and read spans
  reclassified as "self-describable".
- **Kill condition:** kill the help repair if fewer than half of the 48 recorded usage errors
  become valid calls. Kill the guide-drop branch permanently if, after the repair, guide-taught
  dependence still exceeds 20 percent of `ss-*` operations on any harness.
- **Build cost:** one argument-table change and a usage string per tool. Half a day.
- **Register check:** E2 (hygiene package, SHIPPED) lists six items and `--help` is not among them;
  B3 (drop the guide, PARKED) has never had a `$0` falsifier attached, and this supplies one and
  fires it. `claude-subagents.md` M4 and `native-capability-gaps.md` S3 seed the same repair — this
  candidate adds the census that makes it decide B3.
- **new_tool:** false. **needs_user_decision:** true for the guide branch only (B3 is an owner
  decision); false for the help repair.
- **Solve risk:** none for the repair. The guide branch carries the claude-code no-delegation
  behaviour, worth 7.5 percent of a rollout, and must never be dropped there.

### C3 — Absence honesty: remove the guide's certainty and make every zero say why

- **Family:** retrieval correctness. **Lens:** removal, cost-negative.
- **Harnesses:** all three.
- **Mechanism:** (a) delete the guide sentence "Two empty index probes over the whole codebase are
  more conclusive than any raw scan or file listing", replacing it with an absence rule conditioned
  on the answer being *searchable*; (b) close the three paths where a zero is not an absence —
  the alternation prefilter, `--in .`, and a `--in` path that does not exist; (c) extend the shipped
  not-indexed note to the `ss-semantic` fallback and to `ss-read` on an excluded or minified file.
- **Why native cannot match it:** native has the inverse problem — its `grep` cannot lie about
  absence, so this closes a sweet-only failure mode rather than creating an advantage. Honest
  framing: this is a defensive lever, not a competitive one.
- **Evidence:** `claude-main-thread.md` F7 (alternation prefilter drops 59 real matches; 1 event in
  198 rollouts), F8 (`--in .`, 5 of 5 zero, 4 with real hits), F9 (absent scope path, 11 calls),
  F11 (64 of 71 zero-match candidates are coverage exclusions, $0.000195 per rollout envelope);
  `verify-tail.md` §6 and `phase-anatomy.md` PA-4 (the bundle case: sweet edited the committed
  bundle in 3 of 9 rollouts, native in 9 of 9); `phase-anatomy.md` PA-9 (7 `[FALLBACK]` whole-file
  spans). `[C]` guide text quoted above.
- **Ceiling:** cost **negative or zero** — honest absence answers provoke further probes. The
  measured envelope of the whole zero-answer class is ~1.2 percent of the claude-code sweet arm and
  it is not removable spend (register E2, panel note). The prize is correctness: on the one task
  measured, sweet's silent zero produced a patch that omitted the artefact a real deployment runs
  from.
- **Vehicle:** the tool guide plus `core/search/grep-output-shaping.js` and
  `eval/agent-read-workflows/bin/_ss-helpers.mjs`. **sweet_only: yes.**
- **`$0` falsifier:** replay every recorded zero-result `ss-grep` from `fp-*` and `fixval-*` against
  the goldens with `grep -E` and the same scope, using the existing
  `/tmp/wf-slatec/claude-main-thread/ss-grep-nomatch-audit.mjs`; count how many were genuine.
- **Kill condition:** kill if, after the three code fixes, genuine false absences remain above one
  per 200 rollouts; kill the guide edit if the honest wording raises `ss-*` calls per rollout by
  more than 10 percent in a later paired run.
- **Build cost:** one guide paragraph, two branches in the wrapper, one predicate in
  `grep-output-shaping.js`.
- **Register check:** E2 (SHIPPED) covers the regex crash, positional path, `ss-read` ENOENT and
  the not-indexed message for `ss-grep`; it does not cover the alternation prefilter, `--in .`, the
  `ss-semantic` fallback, or the guide sentence that makes a false zero decisive. E1 (index
  coverage) fixed instances, not the certainty. No row touches the guide sentence.
- **new_tool:** false. **needs_user_decision:** true for the guide edit only.
- **Solve risk:** low. Bench solves were unaffected on the one measured task; the change adds
  probes, which costs money and cannot lose a solve by removing information.

### C4 — Retire `ss-semantic` and `ss-batch` from the agent tool surface

- **Family:** tool surface reduction. **Lens:** removal.
- **Harnesses:** codex (all of the effect); opencode and claude-code get the guide-token part only.
- **Mechanism:** drop `ss-semantic` from the guide's tool list and stop putting `ss-batch` on the
  agent's PATH. Both remain product CLI surfaces; only the agent-facing surface shrinks.
- **Why native cannot match it:** the surface is sweet's.
- **Evidence:** `[M guidesyntax.py]` over 3,064 sweet operations in 198 rollouts: `ss-batch` 0
  calls; `ss-semantic` 59 calls (1.9 percent), of which 46 on codex, 6 on opencode, 7 on
  claude-code. `[M cited phase-anatomy.md PA-9]` 7 of 58 `ss-semantic` calls returned a
  `[FALLBACK]` whole-file span (`dist/index.js` 1–35000 five times). Register E8 (+6 to +118
  percent token premium, 0–6 percent voluntary pick rate) and A2 (`ss-batch` called 0 times).
- **Ceiling:** codex −$0.000013 (−0.1 percent, the provably wasted fallback calls) to −$0.000262
  (−2.1 percent, if every `ss-semantic` call is waste with no substitute); opencode and
  claude-code about −$0.000027 of guide tokens each (−0.3 percent, −0.2 percent). Requests:
  −0.035 to −0.70 per codex rollout, ~−0.03 elsewhere. Solves: predicted flat — E8 records the
  agents already avoid semantic retrieval when it is free.
- **Vehicle:** the tool guide and `scripts/inject-agent-instructions.js`. **sweet_only: yes.**
- **`$0` falsifier:** for each recorded `ss-semantic` call, check whether the next `ss-*` call is
  an `ss-read` of the same file within the returned span. If it is, the tool added a request and
  the substitute is free.
- **Kill condition:** kill if more than 30 percent of `ss-semantic` calls are the **last**
  retrieval call before an edit of that file — that would mean the tool is deciding edits, not
  padding the path to them.
- **Build cost:** two deletions. No product code beyond the PATH list.
- **Register check:** E8 kills semantic search as a *general grep replacement* (a routing
  question); A2 kills `ss-batch` as a *packing lever* (a mechanism question). Neither proposes
  retiring either tool from the agent surface, and no row carries a per-tool call census across all
  three harnesses.
- **new_tool:** false. **needs_user_decision:** true — it narrows a shipped product contract, and
  `init --mcp` exposes the same tool list.
- **Solve risk:** low. 1.9 percent of calls, and E8 says the model prefers not to use it.

### C5 — Arm-symmetry audit before any claude-code claim (not a lever)

- **Family:** measurement and benchmark validity. **Lens:** inversion.
- **Harnesses:** claude-code.
- **Mechanism:** repair the residual invalid-`pages` `Read` failures for both arms, and publish the
  claude-code cell alongside a subagent-price sensitivity (luna rate against the model each
  subagent actually requested).
- **Why native cannot match it — it does not need to:** this is a shared repair with **zero
  head-to-head differential** (`BRIEF.md` rule 6). It is booked here because the inversion lens says
  sweet's only measured win rests on it.
- **Evidence:** `[M pagescheck.py]` native 163 failed `Read` calls and 93 wholly-wasted requests of
  66 rollouts, against sweet 25 and 25. `[M cited phase-anatomy.md PA-6]` the same census from a
  second parser (1.39 against 0.42 wasted requests per rollout). `[M cited claude-main-thread.md
  F4]` 6.81 percent of the native arm against 1.00 percent of sweet. `[M cited claude-subagents.md
  F7]` haiku share 56.4 percent native against 36.3 percent sweet. Register D4a, D4b, G6.
- **Ceiling, stated as a risk not a win:** the repair moves the claude-code main-thread comparison
  from −1.38 percent to **+0.62 percent** (conservative) or **+4.8 percent** (fuller attribution).
  The subagent repricing moves the inclusive margin from −9.2 percent to −3.0 or −4.1 percent.
  Together they can erase the published −3.9 percent.
- **Vehicle:** `harness/claude-code-task-runner.mjs` and `claude-code-accounting.mjs`.
  **sweet_only: no — shared, zero differential.**
- **`$0` falsifier:** already run. `pagescheck.py` on the box reproduces the counts independently of
  `claude-errors.py`.
- **Kill condition:** none — it is an accounting obligation, not a hypothesis. If a later Claude
  Code release is confirmed to change `pages` validation (register D4b's revival condition), the
  repair is unnecessary and the disclosure is not.
- **Build cost:** the repair is blocked (D4b: the hook is provably inert and no documented surface
  closes it); the disclosure is one paragraph in every published table.
- **Register check:** D4a and D4b record the defect and its blocked repair; G6 records the lower
  bound. Neither records that the residual is **arm-asymmetric by a factor of 3.7** in native's
  disfavour, nor prices the sign flip.
- **new_tool:** false. **needs_user_decision:** false.
- **Solve risk:** none.

---

## 6. Register check, one line per claim I make

| my claim | nearest register row | why it is not that row |
|---|---|---|
| purge three guide passages | B2 CLOSED (trim), P1 DEAD (clauses), E4/B9 DEAD (siblings), F15 DEAD | B2 is word count on redundant text; P1/E4/B9 kill *adding* the mechanism. Nobody has read those kills as a licence to delete the passage that ships it, and nobody has priced the request chain it causes. |
| guide-drop is killed at `$0` | B3 PARKED (needs user decision) | B3 has no falsifier attached. I attach one, run it, and it fires at 98–100 percent against a 20 percent line. This closes B3 rather than reopening it. |
| fix `--help` first | E2 SHIPPED (six hygiene items) | `--help` is not one of the six. It is the precondition that makes B3 measurable. |
| absence honesty | E1, E2 SHIPPED | Three code paths and one guide sentence are outside both. |
| retire `ss-semantic` / `ss-batch` | E8 DEAD (semantic as grep replacement), A2 DEAD (`ss-batch` as packing) | Both rows kill a *use*; neither proposes retiring the surface, and no row holds a per-tool call census across three harnesses. |
| `pages` asymmetry flips the claude sign | D4a SHIPPED, D4b BLOCKED, G6 disclose | None records the 3.7-times arm asymmetry of the residual or prices the sign flip. |
| codex cap subsidises native 14.8 percent | C8 CLOSED, G15 INVERTED | C8 rejects raising the cap; G15 records 35.1 against 10.6 percent of tool tokens. Neither converts it to dollars per rollout or names it as a structural subsidy. |
| noise floor is 9–23 points | G10 PARKED (465 tasks for 5 percent) | G10 is a power calculation from an older paired corpus. This is a direct bootstrap on the fresh pool plus a null-treatment probe (the gutter forms). |
| do not remove the gutter | C4 CLOSED, C7 DEAD | I re-measure and agree; the contribution is that the cell-level NONE−TAB delta is noise, not gutter. |
| plan-tool suppression | absent from the register | **Already booked by `verify-tail.md` §10 and `phase-anatomy.md` PA-8. I do not re-book it; I only use its ceiling in the arithmetic.** |

---

## 7. Measurement traps I met

1. `fp-opencode-{none,pipe}-20260826` contain **no native arm**. Only the `tab` run has one. Any
   form comparison on opencode must take native from the `tab` run and must substitute
   `rp-oc-<form>-20260827` for the 11 repair tasks, or the sweet cell reads 57–63 rows, not 66.
2. Claude-code rows that delegated have `costRealizedUsd` and `idealTurns` null. Cell means must use
   `costRealizedMainOnlyUsd`, or 28 of 66 native rows vanish and the arm reads +123 percent (G6).
3. `toolCounts.ss` counts envelopes, not operations: it gives 541 / 710 / 894 where the
   operation-level census gives 970 / 788 / 1,306. Never mix the two denominators.
4. `preds-<arm>.jsonl` has one line per task, not per rep.
5. A pre-2026-08-28 `ss-grep --in <path>` zero on an excluded path means "not searchable", not
   "absent". Do not read fresh-pool zeros as evidence of absence.
6. Attributing a request class's full realized cost overstates its removal saving, because the
   ingest it carried moves to the next request. I used `verify-tail.md`'s counterfactual price
   throughout, which is roughly half the attributed price.
7. The gutter forms are a **null treatment** analytically (0.3 percent) but measure −0.1 to −7.4
   percent. Any lever below about 8 percent cannot be distinguished from a re-run at this n.

---

## 8. What I could not finish

- **No solve estimate for any removal.** Every candidate's solve line is a prediction from P1's
  inertness result or from E8's pick-rate result, never a measurement. Only a paid smoke can price
  it, and this work was `$0`.
- **The 98-to-100-percent guide-dependence figure counts `-k` and read spans as guide-taught.**
  A working `--help` would also teach them. The number therefore measures "the guide is currently
  the only source", not "the guide is irreplaceable". That is exactly why C2 sequences the two.
- **The guide-less discovery tax ($0.0032 per agent) comes from eight short, read-only Explore
  subagents.** Whether a 20-request main thread would pay the same fixed tax is inferred, not
  measured, and the alternative outcome — a guide-less agent simply not using `ss-*` at all — would
  make the sweet arm native-with-extra-steps and is untested.
- **I did not re-derive the haiku repricing, the read-gate price, or the opencode parallel-emission
  rates**; those are carried from sibling reports with their tags.
- **I did not replay any `ss-*` command against a golden checkout.** The absence-honesty falsifier
  is specified and its script exists on the box; running it needs a rebuilt golden.
- **I did not open HO2, any `ho2-*` run, or any grading log.** The wrong-fix classes referenced in
  Part C come from `wrongfix-facts.md`, described by class only.
- **The codex cap subsidy is priced at the delivered-token rate.** Register C8's finding — that
  delivering the truncated text in full costs 2 to 19 times the follow-ups it provokes — means the
  counterfactual is not "native pays 18.3 percent more". The honest statement is the one I make:
  the cap forgives 14.8 percent of a cell more of native's over-fetching than of sweet's.

---

## 9. Evidence paths

**Box, read-only:** `/root/sweet-search-private/eval/task-completion-bench/results/{fp-codex-tab-20260826,fp-codex-none-20260826,fp-codex-pipe-20260826,fp-opencode-tab-20260826,fp-opencode-none-20260826,fp-opencode-pipe-20260826,rp-oc-tab-20260827,rp-oc-none-20260827,rp-oc-pipe-20260827,fp-claudecode-tab-20260826,fp-claudecode-none-20260826,fp-claudecode-pipe-20260826}/rows.json` and `agent-state/`; `/root/fresh-run/repair-tasks.txt`.

**Box, my scratch (writable):** `/tmp/wf-slatec/inversion-removal/{gutter_cost.py,gutter_cost2.py,gutter_cost3.py,pagescheck.py,guidesyntax.py,capsubsidy.py}`.

**Box, sibling artefacts I read:** `/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz`; `/tmp/wf-slatec/codex-cap-x-ss/cx-census.json` and `cx-census.log`; `/tmp/wf-slatec/claude-main-thread/ss-grep-nomatch-audit.mjs`.

**Local, raw output of my four scripts:** `/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f/scratchpad/inversion-measurements.txt`.

**Local, code read `[C]`:** `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` (64 lines, 1,016 words, frontmatter `token_count: 1307`); `eval/agent-read-workflows/bin/_ss-argparse.mjs`, `_ss-helpers.mjs`; `core/search/grep-output-shaping.js`; `core/search/search-read.js`; `scripts/inject-agent-instructions.js`.

**Local, reports cited:** `handoffs/improve/slate-c/forensics/{phase-anatomy,claude-main-thread,claude-subagents,codex-cap-x-ss,verify-tail,native-capability-gaps,opencode-calls-per-request,wrongfix-facts}.md`; `handoffs/improve/slate-c/research/{harness-changelogs,agent-efficiency-2026,competitor-mechanisms,structured-vs-shell-parallelism}.md`; `handoffs/improve/slate-c/register/DEAD-LEVER-REGISTER.md`; `handoffs/improve/slate-c/BRIEF.md`.
