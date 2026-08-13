```markdown
# RUN-LEDGER — lever hunt against 204 rollouts (17 DEV-RET tasks x 2 arms x 2 reps x 3 harnesses, Luna backbone)
Date: 2026-08-12 · Screen: 19 proposals · Panel: 3 model families · Data: read-only, no rollouts launched, nothing written to `results/`

---

## Verdict

**No. Nothing in this hunt makes sweet win on cost and resolution on all three harnesses — every one of the five panel-reviewed levers was killed 3 votes to 0, so the survivor slate is empty. But the claude-code cost loss is an accounting defect, not a product defect, and I verified that directly this session.** The claude-code ledger excludes subagent spend. Native spawns a subagent in 11 of its 34 claude-code rollouts; sweet in 3. Fold that spend back in, on the ledger's own prices, and claude-code moves from **+2.38% to −2.93%** across all 17 paired tasks, and from **+0.24% to −8.22%** on the 8 both-solved tasks. Cost then reads as a clean sweep: codex −6.5%, opencode −17.8%, claude-code −2.9%. Resolution does not move, and I do not expect it to move from anything in this slate. Sweet leads on solve only on codex (10 of 17 against 9), and ties 9-9 on the other two. Outside the six tasks nobody ever solved, sweet has exactly **5 unsolved task-harness cells out of 51**, and native beats sweet in only **2** of them — each on a single rep of two. So the honest position is: **cost is winnable everywhere once the scoreboard is correct; resolution is not winnable from retrieval, and this task set contains almost no retrieval-shaped resolution headroom to win.** Solve is the veto dimension, so no cost claim below is offered without its solve number beside it, and every solve number below is zero.

---

## Ranked slate — SURVIVORS

| rank | lever | proposer family | gate verdict | panel result |
|---|---|---|---|---|
| — | *(none)* | — | — | **Empty. All five reviewed levers were refuted 3-0.** |

### Why the slate is empty

Five levers reached the adversarial panel. Each drew three votes from three separate lenses (trigger, outcome, collateral). Each lost every vote. The refutations were not stylistic. Four of the five were killed by a **new fact re-derived from the artifacts**, not by opinion:

- Two levers rested on removing a "warp hunk" from `dashbitco__nimble_options-43`. Two independent refuters read all 12 patches. Gold inserts `:integer` after `:atom` in the type list; the two sweet cells carrying the whole claimed ceiling insert it after `:boolean`. The failing test asserts the rendered list as an exact ordered string. Deleting the warp still fails. Solve ceiling: 0.
- Two levers rested on the model missing a sibling edit site. Both refuters showed the site was already in context. `ss-read underscore.js 400 470` returned lines 445 and 458; both cells edited 445 only. Native, reading the whole file, produced a byte-identical patch.
- The fifth lever pre-registered its own falsifier and the falsifier fired. Pre-edit test consultation does not associate with solving (p = 1.000 across the four design-shaped tasks), and inverts once the one supporting task is removed (0 of 12 with consultation solved, against 6 of 24 without).

Full kill detail is in **Killed, group (c)**.

---

## Not levers — three verified findings that do survive

These are **not** panel-reviewed levers. Two came out of gate-agent notes; I re-derived all three from the artifacts this session and state the evidence class for each. I list them because the operator's question about claude-code has an answer, and it is here.

### N-1. Claude-code's cost loss is off-ledger subagent spend (evidence: DIRECT, verified this session)

**Mechanism.** The claude-code runner records only the main session. When the model uses its subagent tool, the subagent runs as a separate session and its tokens never enter `rows.json`. Native uses that tool far more than sweet, so the ledger charges native less than it spent.

**Which finding it attacks.** Digest I-3, which says a claude-code cost lever must attack the roughly 9 million cached input tokens. It turns out part of that mass is not even being counted, and the uncounted part is native-heavy.

**Measured exposure, and exactly what was counted.** I walked every assistant record in `results/sb-claudecode-20260811/agent-state/*/claude-home/projects/*/*/*.jsonl`, deduplicated on (run directory, requestId), and split on the `isSidechain` flag.

| | rollouts with a subagent | unique subagent requests | cache-read tokens | output tokens |
|---|---|---|---|---|
| claude-code native | 11 of 34 | 121 | 581,083 | 18,681 |
| claude-code sweet | 3 of 34 | 35 | 325,588 | 5,603 |
| codex (both arms) | 0 of 68 | 0 | — | — |
| opencode (both arms) | 0 of 68 | 0 | — | — |

**Proof the spend is excluded, not double-counted.** For `dart-lang__http-1114` sweet rep 0, the main session's non-sidechain unique-requestId totals are input 144, cache-write 60,952, cache-read 2,062,397, output 7,800. `rows.json` for that cell reports the same four numbers exactly. The sidechain totals (25 requests) appear nowhere in the ledger.

**Ceiling, with arithmetic.** Priced at the ledger's own rates (`price` object in `turns/*.jsonl`: $0.10/M input, $0.01/M cache-read, $0.60/M output; cache-creation charged at the input rate, which reproduces the recorded per-cell cost to within 0.7%):

| basis | native | sweet | result |
|---|---|---|---|
| ledger only, 17 paired tasks | $0.1992 | $0.2040 | **+2.38%** |
| plus subagent spend | $0.2152 | $0.2089 | **−2.93%** |
| ledger only, 8 both-solved | — | — | +0.24% |
| plus subagent spend, 8 both-solved | — | — | **−8.22%** |

Off-ledger totals: native $0.03194, sweet $0.00982 — a ratio of 3.25 to 1. My re-pricing reproduces the recorded arm totals to within 1.5% (native $0.40444 computed against $0.398435 recorded; sweet $0.41340 against $0.407928), biased the same way on both arms, so the differential is safe.

**Per-harness applicability.** claude-code only. Codex exposes a shell and has no subagent tool. Opencode spawned none in 68 rollouts. Codex −6.5% and opencode −17.8% are unaffected by this defect.

**Effect on solve: ZERO.** This changes no rollout and no patch. Sweet stays 9 of 17 against native 9 of 17 on claude-code.

**Effect on cost: the sign flips.** Claude-code becomes sweet-cheaper. Cost then wins on all three harnesses.

**Adversarial standing.** This was never put to the panel; it surfaced inside a gate agent's note on a lever that itself died. The gate agent's figures (native $0.0716, sweet $0.0216) counted duplicate assistant records. Deduplicating on requestId gives native $0.0319 and sweet $0.0098. **The sign flip survives either method; the magnitude does not.** The strongest objection I can construct against myself: this is an unpaired token audit re-priced by me, not the runner's own pricing function, and one confounder remains — sweet's low subagent use may be a behavioural consequence of having ss-* tools, in which case the saving is real and causal, or it may be incidental, in which case it is still a real bill but a weaker product claim. Either way the current published number is wrong.

**The exact next experiment — $0, no rollouts.** Fold sidechain usage into `breakPricedCostUsd` inside the runner's existing pricing function, re-derive the claude-code column from the retained session store, and republish. Pre-registered bar: the recomputed native and sweet arm totals must reproduce the current values to within 0.5% when sidechain records are excluded, before the corrected column is trusted. If they do not, the ledger has a second defect and the flip is not yet publishable.

### N-2. Opencode's −17.8% is inflated by a task where sweet did no work (evidence: DIRECT, cuts AGAINST sweet)

On `mransan__ocaml-protoc-202` — the task with a zero-character problem statement — opencode sweet made **0 tool calls in 1 turn in both reps**, cost $0.00086, and produced no edit. Native made 14 and 22 calls and cost $0.0057 and $0.0087. Dropping that one task takes opencode from −17.76% to **−13.82%**. So 3.94 of the 17.76 points, about 26% of the opencode advantage, come from a refusal. Publish opencode with this caveat attached. The same refusal appears on claude-code sweet rep 0 (5 calls, no edit).

### N-3. Directory scoping in ss-grep returns false zeros by construction (evidence: DIRECT, read from source)

`core/search/grep-output-shaping.js:25` is `return target === f || target.endsWith('/' + f)`. That is a whole-file-path test. `core/search/search-pattern.js:144` is its only consumer, and `eval/agent-read-workflows/bin/_ss-helpers.mjs:260,266` maps ss-grep `--in` straight onto it. A directory scope therefore can never match, and the output prints `0 total match(es) ... (no matches)`, which reads as a statement about the code. `tests/search/grep-output-shaping.test.js` locks the defect in: it asserts that a directory filter returns false.

Measured exposure: 15 ss-grep calls pass a directory to `--in`, across 11 cells and 9 tasks, on all three harnesses; every readable result line is a zero. Two more defects sit on the same path: `--help` exits 2, and a non-zero exit inside an `&&` chain silently drops every later subcommand (5 of 12 ss error calls).

**Ceiling: cost about 1% of sweet spend, solve 0 tasks.** Dead as a bench lever, and it was correctly killed at the gate on those numbers. Ship it as a correctness fix with a unit test asserting that a substring query can never return fewer hits than a query containing it. Claim no benchmark value for it. Do **not** ship the source-priority reranking that was bundled with it: it is a structural ranking signal, and ungated structural signals have cost this project −0.07 and then −27.57 percentage points on GenCodeSearchNet.

---

## Killed — with reasons

### (a) Dead-list hits — removed mechanically, before any agent saw them

| proposal | dead item it duplicated | matching pattern | recoverable? |
|---|---|---|---|
| **Redundant-tool retirement** (drop the harness's own retrieval tool schemas in the sweet arm) | preamble trimming | `/\bpreamble\b/i` | **YES — likely false positive. See below.** |
| Envelope density pass (thinner ss-read / ss-search rendering) | turn/context packing | `/\bpack(ing\|ed)?\b/i` | Partly — see below |
| Symbol-complete first read (widen a read to the enclosing symbol) | turn/context packing | same | Partly — but its own falsifier says blanket widening is net-negative |
| Per-turn output ceiling | thrash reduction | `/\bthrash/i` | No — the author states it is delta-neutral in expectation |
| run_tests result compaction | preamble trimming | `/\bpreamble\b/i` | No — it lands in both arms and the author scores it about 0.3 points **against** sweet |
| Coalesced independent lookups (multi-target ss calls) | turn/context packing | `/\bpack(ing\|ed)?\b/i` | No — merging calls into fewer turns is what packing was |
| Duplicate-span elision (hash-gated stub for a repeated read) | turn/context packing | same | No — the author sized it at 1 to 1.5%, under the bar |

**Recoverable false positive: Redundant-tool retirement.** The dead item trimmed sweet's own +1,457 tokens of tool documentation and netted 23 tokens. This proposal removes a **different and larger object**: the harness's native retrieval tool schemas, via runner configuration rather than prose. Sweet does not use those tools — across 34 sweet rollouts per harness, native-grep calls number 1 (codex), 4 (opencode) and 6 (claude-code), against 220, 280 and 294 ss-* calls. The supporting measurement is real: claude-code's turn-1 input is 19,217 tokens for sweet against opencode's 8,368, for the identical task and identical frame. **But the removable block's size was NOT MEASURED.** The proposal gives a range, not a number, and pre-registers its own kill at under 800 tokens. Its falsifier costs under one cent and no rollouts: run the claude-code binary once with and once without the disallowed-tools flag and diff turn-1 input tokens. Do that before anything else in this file, because it is the cheapest open question left. Note that N-1 already removes the urgency: claude-code is sweet-cheaper once the ledger is right.

**Weaker recoveries.** "Envelope density pass" and "Symbol-complete first read" were killed by a pattern matching "packing", but neither schedules calls or rewrites the transcript; both change what one tool result contains. Both have $0 offline falsifiers (replay the 794 recorded ss-* calls against the golden indexes and count tokens). Neither is worth reviving until N-1 is settled, because both are pure cost levers with a stated solve ceiling of zero, and cost is no longer the open problem.

### (b) Killed at the $0 exposure gate

| proposal | measured exposure | ceiling | reason it died |
|---|---|---|---|
| **Caller Set Inline** (append caller list to definition spans) | **0 cells** | solve at most +2 of 51, realistic 0; cost under 1% | Exactly 1 of 17 gold patches changes a function signature. In all 4 failing sweet cells the caller line was **already in the returned span** — one cell ran the exact caller trace and still failed. The information was never absent. |
| **Scope-Honest Retrieval** | 10 impossible calls | cost **0.97%**, solve **0 tasks** | Real defect, wrong size. The 10 land on tasks that are either already solved in all 6 cells or already at perfect localization. See N-3: ship as correctness, not as a lever. |
| **Zero-Edit Floor Guard** | 3 of 204 cells | solve **0**, cost **negative** | All 3 are the never-solved zero-statement task. Forcing work moves opencode from −17.8% to −13.1% and claude-code from +2.38% to +3.27%. It costs money to buy nothing. Its real value is the scoreboard caveat now recorded as N-2. |
| **Delegation retrieval brief** | 3 of 34 claude-code sweet cells | **$0.00** on the measured column | The subagent segment is off-ledger, so a richer brief cannot move the number — and a richer brief is larger, so the sign is probably positive. This gate produced N-1. |
| **Scope and flag honesty for the ss CLI** | 11 cells, 13 ledger-visible wasted calls | cost **0.99%**, solve **under 1 task** | Same family as the row above. Engineering hygiene, not a lever. |
| **Stale-Test Annotation in run_tests** | fires on **211 of 515** red test runs and inside **33% of solved cells** | differential ceiling **0.0 tasks** | The predicate is a constant: 0 of 201 patches ever touch a test file, so "unchanged from base" is always true. It is shared bench infrastructure, so it reaches both arms. Its own kill condition was 10% of solved cells; measured 33%. |
| **Dep-Source Reach** (address installed dependency sources) | **1 of 17** tasks; about **1 of 200** on the frozen held-out set | solve at most +1 on 2 of 3 harnesses; cost **negative** | Failed its own pre-registered bar by 10 to 20 times. Sweet made **0 dependency-reaching calls in 1,561 calls** across 102 rollouts, while holding 336 shell calls. The binding constraint is intent, not reach. |

### (c) Refuted by the adversarial panel

| proposal | lens that killed it | family | killer fact |
|---|---|---|---|
| **Stale-Oracle Override** (memory-file doctrine: an old test that asserts the behaviour the issue changes is stale) | trigger, outcome, collateral | Opus, Opus, Sol | Gold inserts `:integer` after `:atom`; the two sweet cells carrying the whole ceiling insert it after `:boolean`. The failing test asserts the rendered list as an exact ordered string, so deleting the warp still fails. Only one warped sweet cell is one hunk from gold, and it sits on the one harness where that task already counts solved. **Solve ceiling 0 on all three harnesses.** Cost claim also falls: the sweet rep that never warped cost the same as the one that did ($0.00953 against $0.00988), so the loop is worth 3.5%, not the banked amount. |
| **Atomic same-file edits** (batch edits; never retry an edit blind) | trigger, outcome, collateral | Opus, Opus, Sol | The retry half runs backwards. 15 of sweet's 32 claude-code edit errors are followed immediately by an edit that **succeeds**; read-then-retry succeeds only 5 of 9. The rule adds a turn to recoveries that already work, about +$0.011, taking claude-code from +2.38% toward +3.8%. The batch half yields little: the flagship rollout already runs 72 tool calls inside 48 API turns, so collapsing its edit runs removes 0 turns. The batched vehicle was invoked **0 times in 291 edit calls**. Trigger also fires on **18 of 34 native** cells against 15 of 34 sweet, with native's collapsible surface 88% larger in dollars. Solve ceiling 0. |
| **Stale-Assertion Arbitration** (resolve a failing assertion to its source; plus a shared frame line) | trigger, outcome, collateral | Fable, Opus, Sol | The information is not missing. The red-run digest `53c234e5` appears in **all 12** cells of the target task, both arms, all three harnesses — 11 saw it and engineered around it anyway. Worse, the frame half reaches native, and the one native cell it converts is on claude-code, where sweet already counts the task. Working perfectly, the lever is **relative minus one** on the harness sweet was losing. |
| **Sibling-Site Echo** (trailer listing other sites matching the same expression) | trigger, outcome, collateral | Opus, Opus, Sol | On its single claimed flip target, the trailer's payload was already delivered and ignored. One native cell's grep returned lines 448 and 461 as the first two adjacent lines of one result; both arms then produced the **byte-identical** one-hunk patch at 448. Both sweet reps had 461 inside their returned span. Usable exposure **0 of 102** sweet rollouts. Its own dilution falsifier fails at $0: **175 of 220** ss-grep results already report more than one match, and five solved control tasks fire at 79 to 100%. It also accelerates the dart-lang failure mode, which is 237% of claude-code's entire net loss. |
| **Look-Before-API** (read the covering tests and trace callers before designing a new signature) | trigger, outcome, collateral | Opus, Opus, Sol | Its own pre-registered falsifier fired. Across the four design-shaped tasks, pre-edit test consultation solved 4 of 21 against 6 of 27 without (p = 1.000); remove the one supporting task and it **inverts** to 0 of 12 against 6 of 24. The rescue (callers only) rests on 2 cells on the harness the lever explicitly excludes, and the caller trace returns `fan-in=0`. On the two target harnesses, **all four** native reps already performed the prescribed behaviour and solved exactly half. The discriminating fact (`exc_info`) exists nowhere in the base repository. |

No verdict above is softened. No proposal in group (c) is recoverable as written.

---

## What this run establishes about the ceiling

**There is almost no resolution headroom in this task set, and the cost headroom is already spent.** That is the central negative result, and it is a stronger statement than "these five levers failed".

**Resolution.** Sweet solves 28 of 51 task-harness cells. Of the 23 it misses, **18 sit inside the six tasks that no arm, no harness and no rep ever solved.** That leaves **5 addressable cells**, and native beats sweet in only **2** of them:

| addressable sweet miss | native | sweet | character |
|---|---|---|---|
| codex / dashbitco | 0/2 | 0/2 | perfect localization, agent-bound — both arms fail |
| opencode / dashbitco | 0/2 | 0/2 | same |
| claude-code / underscore | 0/2 | 0/2 | arm-universal; both arms emit the identical patch |
| opencode / pytask | 1/2 | 0/2 | native wins on one rep of two |
| claude-code / pytask | 1/2 | 0/2 | native wins on one rep of two |

Three of the six never-solved tasks (`apple`, `dotnet`, and `dashbitco` on two of three harnesses) already touch **every** gold file in **every** cell and still fail. Retrieval is finished there. One (`mransan`) has a zero-character problem statement and 19 gold files. One (`codeception`) is arm-universal confusion: five of six cells, both arms, edited the same wrong file, and the one cell that reached a gold file still failed. The last (`bingo-274`) was the only never-solved task with a claimed retrieval path, and it has none: three of its missing files carry `new file mode` in the gold patch, so they do not exist at base and no retrieval mechanism can surface them.

**The gold file set is not the pass criterion**, which shrinks every coverage-shaped ceiling further. 25 of 51 solved or partial cells resolved while touching a strict subset of gold files or none. `ontodev__robot-710` solves in all 6 cells hitting 0 of 3. `statamic__cms-9029` solves in all 6 hitting 1 of 24. Gold patches routinely bundle changelogs, documentation and manifests that no test needs.

**Cost.** The fixed prefix is exactly +1,457 tokens on codex and opencode and +1,586 to +1,589 on claude-code, with **zero variance across all 17 tasks**. Priced over about 12 turns that is roughly $0.0003 against a mean rollout near $0.0080 — a hard ceiling near **3.9%**. Any prefix-trimming lever lives under that number. On the worst codex regression the prefix explains about 10% of the loss; the other 90% is 12.5 sweet tool calls against native's 6.5.

Claude-code's native bill is **43% cached input and 29% output**; sweet's is 49% cached input and 18% output. Sweet halves claude-code output (105,834 to 53,996 tokens) and the win is eaten by an input mass sweet does not touch. That framing is right, and N-1 sharpens it: part of that mass was never billed to the arm that generated it.

**Where the remaining cost levers are blocked.** Break-priced cost equals ideal cost in **all 204 cells**, because context rewrites are 0 in all 204. No rollout broke its prefix cache. The column is correct and carries no extra information on this dataset. Do not claim a break-priced difference here. Eviction, fusion, preamble trimming and thrash reduction all died at $0 in earlier rounds; this round adds packing-adjacent proposals to that pile, one of which is a probable false positive.

**No doomed tail.** All 204 rollouts exit `model_stopped`. None hits a cap. Failed rollouts have the same spend profile as solved ones. There is no truncation to recover and no budget to reclaim by stopping earlier.

**What this means for the goal.** Cost can plausibly be a clean sweep after N-1, with the opencode caveat in N-2 attached honestly. Resolution cannot be won here, because there are only five addressable cells and the panel refuted every mechanism aimed at them. To move resolution, the next run needs a **different task population** with real multi-site, existing-file under-coverage — not a better lever against this one.

---

## Method + caveats

**Panel composition.** Three model families: Opus, Fable, and Sol (reached through the codex transport). Every reviewed proposal drew three refutation votes under three fixed lenses — trigger (does the trigger fire where claimed), outcome (does the claimed effect follow), collateral (what does it break or cost elsewhere).

**Agent counts, as observed in the record.** Generation produced 19 proposals: Fable authored 4 of the 5 that reached the panel, Opus 1, and Opus authored 5 of the 7 dead-listed items with Fable 2. **Sol generated nothing.** Two Sol generator slots failed with a capacity error (`sol-gen-4`, `sol-gen-5`, "Selected model is at capacity"). Refutation votes split Opus 9, Sol 5, Fable 1 of 15. Seven further proposals were screened by $0 exposure gate agents, whose measurement notes are quoted above.

**This is a real weakness in the panel, and I will not minimise it.** The GPT family never proposed, only refuted. One family (Opus) both authored a proposal and cast 9 of the 15 kill votes. Family diversity on the generation side was therefore two, not three. Nothing was carried unrefuted because of the panel cap — the carry list is empty.

**What the dead-list screen removed mechanically.** Seven proposals were dropped by regular-expression match against previously killed items, before any agent read them. The patterns are blunt. `/\bpack(ing|ed)?\b/i` also matches "package"; `/\bpreamble\b/i` matched a proposal that explicitly disclaimed the dead item and targets a different object. I flag **Redundant-tool retirement** as a probable false-positive kill, with a falsifier costing under one cent. I flag two more as partial false positives with $0 offline falsifiers. I did not overturn any of them, because the screen ran before evidence was gathered and none has a measured ceiling.

**Where evidence is speculative, stated plainly.**
- N-1's causal reading (that ss-* tools cause sweet to spawn fewer subagents) is **inferred**, not measured. The token accounting itself is direct and verified.
- N-1's re-pricing is mine, not the runner's pricing function. It reproduces the recorded arm totals to within 1.5%. The implementation must use the runner's own function.
- The removable token size in **Redundant-tool retirement** is **NOT MEASURED**. The proposal gives a range. Treat the range as a hypothesis.
- All ceilings in group (b) are the gate agents' measurements. I re-derived only the two I use above (the mransan refusal and the leave-one-out cost swings) and both reproduced exactly.

**Two corrections to the digest, for the record.**
1. Section I-3's cost decomposition is captioned "sum over all 34 cells per arm". It covers **17 cells per arm** — one rep each, because `turns/*.jsonl` holds one rep per task, arm and harness. The percentages inside it are computed within that same sample and stand; the caption should be fixed.
2. The brief says seven tasks were never solved. Six tasks were never solved by anyone anywhere. The per-harness figure of seven is larger because two tasks are harness-sensitive: `dashbitco` solves only on claude-code, one rep of two, and `underscore` solves only on codex and opencode.

**Statistical limits at n = 17.** Every solve claim in this document is a count over 17 tasks and 2 reps. Of the five task-level solve differences across the three harnesses, **four rest on a single rep**; only codex `pytask` (sweet 2 of 2 against native 0 of 2) separates cleanly across both reps. A one-task change is worth about 5.9 percentage points of the task count, which is inside the coin-flip band. Cost percentages are paired and mean-over-reps, which is tighter, but claude-code's rep-level variance is large enough that rep 0 alone reads +26% and rep 1 alone reads −17%. Do not publish a claude-code cost claim from a single rep. Do not treat any single-rep solve difference in this run as a result.

**Read-only discipline.** No rollouts were launched. No money was spent. Nothing under `results/` was written or modified. All box access was read-only, over ssh, while other agents were using the machine.
```