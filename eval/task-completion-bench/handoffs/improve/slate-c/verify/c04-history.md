# c04 — adversarial verify, HISTORY lens: REFUTED

Date: 2026-09-02. Agent: `c04-history`. Spend: `$0` (file reading, one local `$0` gate test, one
read-only script on the evidence box). Nothing under `results/` was written. No grading log was
opened. No HO2 task was read. Box scratch: `/tmp/wf-slatec/c04-history/`.

Tags: `[M]` measured (script named), `[C]` read from code, `[W]` web, `[I]` inferred.

---

## 0. Verdict

**Refuted. Confidence 0.88.** The candidate bundles four deletions. Three are already on the
record under other names, and the largest one proposes to revert a shipped, smoke-validated,
solve-positive change.

1. **The mapping-call paragraph is a shipped lever, not incidental prose.** It is the "P2
   fix-surface paragraph", shipped 2026-07-08 as commit `d309860` after three smoke rounds. Its
   round-3 smoke flipped a task to resolved with a 13-file family patch and held 5 of 5 controls
   `[M]`. Its cost tax was measured at +4.8% control ideal cost (worst row +17.2%) and **accepted
   on purpose** `[M]`. Two attempts to reword it both made cost worse, one by +12.7% on controls
   and +220% on a tail task `[M]`. The candidate proposes to delete it for a claude-code saving of
   at most −2.4% of the published cell, with "solves predicted flat, unmeasured". The record has
   solve evidence pointing the other way. Solve is the veto (`BRIEF.md` rule 9).
2. **The token half is register row B2, which is CLOSED, and the B2 gate already named this exact
   act.** The gate document says that reaching a material share of the guide's cost "would mean
   **deleting rules**, not rewording them", that "a dropped rule is a product change, not a trim",
   and that proving specific rules are inert "is a per-rule ablation programme, not a trim". No
   such ablation has ever been run in this program.
3. **The shipped `$0` gate test names all three passages by hand.** `tooldoc-trim-gate.mjs` carries
   a 30-rule inventory that includes `sub-agents inherit this prompt verbatim`, `siblings -> ONE
   mapping call before editing`, `read the edited function to its end` and `single-site edits skip
   the mapping call`; and an assertion that "no `ss-*` tool disappeared". The candidate breaks four
   inventory rules and that product-shape assertion. I ran the gate: it passes today `[M]`.
4. **The subagent sentence saves nothing it is credited with.** The +1,516 tokens the candidate
   cites are the guide arriving through the project rules file, which Claude Code loads for a
   general-purpose subagent on its own. The sentence itself was "fully obeyed 0 of 27 times" `[M]`.
   Deleting it saves about 21 tokens. The forensics report that produced the number says in plain
   words: "Not recommended: rewording the guide's 'with this system prompt verbatim' sentence."
5. **Taking `ss-batch` off PATH cannot move any number.** PATH never enters the model's context, and
   the tool was called 0 times in 3,064 recorded operations `[M]`. The stated vehicle is also wrong:
   `scripts/inject-agent-instructions.js` contains no PATH list `[C]`.
6. **The one part that survives its own falsifier is worth −0.1%.** I ran the candidate's unrun
   `ss-semantic` falsifier on the box. Its kill condition does not fire (1 of 66 calls, 1.5%,
   against a 30% bar) `[M]`. But the same run destroys the −2.1% upper bound: only 4 of 66 calls
   touch a file the rollout later edits, and 38 of 66 are followed immediately by more retrieval on
   the same file. Removal substitutes a call, it does not delete one.

The candidate's own pre-registered kill condition for the mapping paragraph already fires on codex
and opencode. Those are the two harnesses that carry the cost gap. What is left is a claude-code
lever, and claude-code is the one harness where sweet already costs less than native.

---

## 1. What the candidate claims, and what the record holds

| sub-lever | candidate's ceiling | register / record | verdict |
|---|---|---|---|
| delete the mapping-call paragraph (line 54) | −0.6% to −3.1% claude-code | **SHIPPED `d309860`** after 3 smokes; solve flip measured; cost tax priced and accepted; 2 rewordings rejected | reversion of a shipped lever |
| delete the subagent sentence (line 24) | +1,516 tokens where it fires | the 1,516 tokens are not caused by the sentence; source says "Not recommended"; F15 / B3 name the inversion risk | refuted |
| delete the `ss-semantic` lines (27, 31, 43) | −0.1% floor, −2.1% upper | own falsifier does not kill it; upper bound refuted by measurement; breaks the gate's product-shape assertion | shrunk to −0.1% |
| `ss-batch` off the agent PATH | included in "~95 tokens" | A2 DEAD, 0 calls; PATH is not in context; vehicle misidentified | not a lever |
| all four, token accounting | −0.2% to −0.3% per harness | B2 CLOSED; gate ceiling 0.21%; noise floor ±37% | refuted |

---

## 2. Killing fact 1 — the mapping paragraph is shipped lever `d309860`

The candidate treats the paragraph as prose that implements register-dead mechanisms (E4, B9, P1).
It is instead a lever with its own design document, its own pre-registered bars, three smoke rounds
and a ship commit.

Source: `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/memory/project_p2_fix_surface_candidate.md`;
`eval/task-completion-bench/analysis/fix-surface-p2-design-2026-07-07.md`;
`eval/task-completion-bench/analysis/fix-surface-p2-smoke-2026-07-07.md`.

- The paragraph is `+87 tokens`, appended to the guide's "Search output" section on 2026-07-07 `[M]`.
- Round-1 smoke `codex-fixsurface-smoke10`, gpt-5.5, sweet arm: the mapping call fired on 4 of 5
  targeted tasks, against a pre-registered bar of 3 of 5 `[M]`.
- Round-1 control cost: valid controls 4 of 4 resolved, aggregate ideal cost **+4.8%**, worst row
  **+17.2%**, caused by redundant `ss-trace` calls on symbols whose sites were already on screen `[M]`.
- Round-2 reworded variant ("hold a map … or the search hits you already have") was **REJECTED**:
  controls +12.7%, one task +220% ideal cost, another +183% `[M]`. The smoke's conclusion: "the
  imperative ONE-call budget is load-bearing".
- Round-3 smoke on the repaired stack: **6 of 10 resolved against a 5 of 10 baseline set**;
  `glam-rs-382` **flipped to resolved with `f2p=1` and a 13-file family patch**; `kotlin-faker`
  restored; controls 5 of 5 resolved; control ideal cost **+1.8%** `[M]`.
- Ship: `d309860` (agent), `0b3f320` (engine trace fixes), `457782f` (harness), 2026-07-08 `[M]`.
- The referendum the ship named — the full-200 re-baseline — ran on 2026-07-13 and read cost −20.1%
  both-solved with parity 65 against 57, `p≈.039` `[M` memory `full200-rebaseline``]`.

Two consequences for the candidate.

**(a) The cost the candidate wants to remove was already priced and accepted.** The 08-28 forensics
observe the same behaviour the 07-07 smoke observed: redundant probes on symbols already on screen.
The 07-07 smoke wrote "Accept the tax". A candidate that re-discovers a known accepted tax and
proposes to remove it must beat the solve evidence that bought the tax. This one does not try:
it states "Solves predicted flat, unmeasured."

**(b) The wording is measured-fragile in the adverse direction.** Both recorded modifications of this
paragraph moved cost the wrong way, one of them by +12.7% on controls. The candidate predicts a
saving from a third modification with no live evidence. That is the exact shape of register B12
(`INVERTED`: replay and reasoning said cheaper, live said +4.78% / +19.79% / +11.72%).

Register gap this exposes: **`DEAD-LEVER-REGISTER.md` has no row for the P2 fix-surface paragraph.**
Grep for `fix-surface`, `d309860` and `mppppp` returns nothing in the register `[M]`. The synthesis
should add it as `SHIPPED (solve-positive, wording-fragile)`.

---

## 3. Killing fact 2 — B2's gate already ruled on "delete rules"

`eval/task-completion-bench/handoffs/lever3-eviction/PREAMBLE-TRIM-GATE.md` is the source for
register row B2 (`CLOSED`). Its closing section says, verbatim:

> Realising a material share of the 4.1% would mean **deleting rules**, not rewording them — roughly
> 25 of the 30 would have to go. That is precisely the tool-use-degradation risk this gate was set up
> to protect against, and it is a solve-safety question, not a cost question. It would need evidence
> of a different kind: proof that specific rules do not change behaviour, which is a per-rule
> ablation programme, not a trim.

The candidate's escape is "B2 trimmed redundancy; this deletes content". That is precisely the act
B2 considered, named, priced as unmeasurable, and routed to a different programme. The candidate
supplies no per-rule ablation. No guide ablation of any kind has ever been run in this program; the
register's own open question 33 records the same absence.

B2's revival condition is "cost question: only via the prompt-optimization process with a length
term". The candidate does not use that process.

### 3.1 The gate test names the three passages by hand

`eval/task-completion-bench/tests/tooldoc-trim-gate.mjs` `[C]`, run by me just now, `$0`, `GATE PASS`
`[M]`. It asserts:

- assertion 3, "product shape untouched (no tool/mode/flag removed)": `no ss-* tool disappeared`.
  Deleting the `ss-semantic` lines fails this by name.
- assertion 4, a 30-rule behavioural inventory, "A dropped rule is a product change, not a trim".
  Four of the 30 entries are the candidate's targets:
  `['sub-agents inherit this prompt verbatim', …]`,
  `['siblings -> ONE mapping call before editing', …]`,
  `['read the edited function to its end', …]`,
  `['single-site edits skip the mapping call', …]`.

So the candidate deletes 4 of 30 inventoried rules and one tool from the guide's tool set.

### 3.2 The owner-protection claim is misplaced, and the real conflict is worse

The candidate says it "reopens the owner-protected guidance block". The gate defines that block
exactly: it is `## Fix discipline`, 778 bytes, about 175 tokens, 13% of the guide `[C]`. **None of
the three passages is inside it.** Line 54 sits in "Search output"; line 24 in the opening
paragraph; lines 27 and 31 in the tool list. The candidate therefore over-states one conflict and
misses the binding one: the 30-rule inventory and the product-shape assertion.

---

## 4. Killing fact 3 — the subagent sentence does not cause the 1,516 tokens

`forensics/claude-subagents.md` `[M]`:

- "The general-purpose subagent's +1,516 is the same guide, delivered through the project rules
  file." A non-fork subagent inherits every level of the memory hierarchy on its own
  `[W https://code.claude.com/docs/en/sub-agents]`. Built-in `Explore` subagents skip it by design.
- The sentence "was therefore half-obeyed 27 of 27 times … and **fully obeyed 0 of 27 times**".
- "the guide text itself never appeared in any user-side record (delegation prompt, tool result,
  attachment) of any of the 27 sweet subagents".

Deleting the sentence removes about 21 tokens of guide text `[M`, 92 bytes at the gate's own
calibrated slope`]` and **zero subagent tokens**. The candidate's evidence line credits it with
1,516 tokens "where it fires". That is a misreading of its own source.

The same source states the recommendation directly: "**Not recommended: rewording the guide's 'with
this system prompt verbatim' sentence.** It is prose the model half-obeys today; instruction-following
levers are recorded dead on this backbone (A1, A6), and the guidance block is owner-protected."

There is also a named inversion risk. Register F15 (`DEAD`) records that sweet's claude-code
advantage is **not needing to delegate**, and register B3 records that the guide "carries measured
behaviour (no-delegation, fewer calls)". `claude-subagents.md` says the sentence "adds friction to
delegating" and that separating the two effects "needs a guide ablation, which is a paid run".
Deleting the friction may raise delegation, and delegation is what makes native expensive on
claude-code. The candidate prices no such risk.

---

## 5. The `ss-semantic` half — falsifier run, ceiling collapsed

I ran the candidate's unrun falsifier (2) and its kill condition on the box, read-only.

Script: `/tmp/wf-slatec/c04-history/semantic-yield.py`. Input:
`/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz` (10,942 classified calls; sweet
rows of `fp-codex-tab-20260826`, `fp-opencode-tab-20260826`, `fp-claudecode-tab-20260826`,
`rp-oc-tab-20260827`).

Result over **66 sweet `ss-semantic` operations** `[M]`:

| question | count | share |
|---|---:|---:|
| `ss-semantic` is the last retrieval of that file before an edit of it | 1 | **1.5%** |
| the file is edited later in the same rollout at all | 4 | 6.1% |
| the next working operation is an `ss-read` of the same file | 18 | 27.3% |
| the next working operation is another `ss-semantic` | 16 | 24.2% |
| the next working operation is any further retrieval | 38 | 57.6% |

The single terminal case is `claude-code / awslabs__aws-embedded-metrics-node-21 / sweet / rep2`,
request 7, file `MetricsContext.ts` `[M]`.

Reading: **the candidate's kill condition does not fire** (1.5% against a 30% bar). But the same
data refutes the candidate's own upper bound. The `−2.1%` codex figure assumes every `ss-semantic`
call is pure waste. In 58% of calls the model immediately retrieves more of the same file, so
removing the tool substitutes another call rather than deleting a request. The honest ceiling is the
floor the candidate itself states: the 7 recorded `[FALLBACK]` calls, `−$0.000013`, **−0.1% of the
codex sweet cell**.

Register B17 is the arithmetic precedent. Retiring three tool schemas worth **758 tokens** was
`DEAD` because the prize sat below the proposer's own kill line. The `ss-semantic` guide lines are
**45 tokens** `[M]`, seventeen times smaller.

Two more facts against retirement. `forensics/phase-anatomy.md` §6.5 recommends **fixing** the
`[FALLBACK]` path, not retiring the tool (its seed S3). And both shipped guide variants carry the
tool: the MCP variant exposes it as `read-semantic` `[C
core/prompt-optimization/data/p7-final/sweet-search-system-prompt-mcp.md:42,54]`, so retirement
narrows a shipped contract on two surfaces, not one file.

---

## 6. `ss-batch` off PATH — zero effect, wrong vehicle

- Register A2 is `DEAD`: the tool was called **0 times in 198 opencode rollouts**.
- The Slate C census confirms it across all three harnesses: **0 of 3,064 sweet operations** `[M
  guidesyntax.py, quoted in `candidates/inversion-and-removal.md` §B3]`.
- The guide never mentions `ss-batch` `[C]`, so removing it from PATH changes **zero tokens**. PATH
  never enters the model's context.
- `ss-batch` is already absent from the npm `files` list `[C package.json`, I verified this`]`, so
  real installs never receive it. The candidate states this correctly.
- **Vehicle correction.** `scripts/inject-agent-instructions.js` contains **no PATH list**: the
  string `PATH` appears 0 times in the file `[C]`. The bench PATH is built by
  `buildAgentEnv` in `eval/task-completion-bench/harness/agent-runner-shared.mjs:134-141`, which
  prepends the **whole** `ssBinDir` directory. Removing one binary means changing the shared bin
  directory, not editing "one PATH line".

Net: a hygiene tidy with no measurable effect on any published number.

---

## 7. Numbers the synthesis must correct

1. **Deleted token count.** The three passages are about **145 tokens, not ~95** `[M]`, using the
   0.2254 tokens-per-byte slope that the B2 gate itself fitted from 692 real turn deltas across 68
   codex rollouts. Split: mapping paragraph 78.7, subagent sentence 20.7, `ss-semantic` lines 45.0.
   That is 10.6% of the 1,363-token guide body, worth **0.28% to 0.48%** of sweet spend depending on
   harness, against B2's declared unreachable ceiling of 0.21% and a ±37% noise floor.
2. **Claude-code behavioural percentages use a main-thread denominator.** The source's pooled ceiling
   is −$0.0001 to −$0.0005 per rollout. Against the published sweet claude-code cell of $0.020727
   that is **−0.5% to −2.4%**, not −0.6% to −3.1% `[I]`.
3. **The +1,516 subagent tokens are not attributable to the sentence.** Strike that number from the
   candidate's evidence line.
4. **The `ss-semantic` upper bound of −2.1% is refuted.** Use the floor, −0.1% of a codex cell.
5. **"Reopens the owner-protected guidance block" is wrong.** The protected block is `## Fix
   discipline` only. The binding constraint is the 30-rule inventory plus the product-shape
   assertion in `tooldoc-trim-gate.mjs`.
6. **Build cost is understated.** Two shipped guide files (CLI and MCP), plus the shipped gate test's
   rule inventory and product-shape assertion, plus the shared bin directory. Not "three deletions in
   one Markdown file … one PATH-list line".
7. **Register gap.** Add a row for the P2 fix-surface paragraph: `SHIPPED d309860`, solve-positive
   (`glam-rs-382` flip, 13-file patch), cost tax +4.8% controls accepted, two rewordings rejected.

---

## 8. Where the candidate does escape, and why it is not enough

The candidate's strongest true point is that **the removal direction was never measured**. That is
correct: P1 measured added clauses, and no guide ablation has ever run. Three answers.

1. P1's inertness is equally explained by saturation. Conditions `CG` and `C14` were built **on top
   of** the production guide, which already carries the mapping rule; `G1` (family completeness) and
   `G3` (symmetry and siblings) restate it. A duplicate of an obeyed rule is inert by construction.
   Concluding "removal is inert too" requires the model to be ignoring the base rule — which the
   `d309860` smoke measured it is not, 4 of 5 targeted firings `[M]`.
2. P1 also shows this content class is unmeasurable at bench scale on cost: about 400 added tokens
   moved cost by **+0.6%** in one condition and **−0.2%** in the other, at n≈37–39 per condition. The
   sign was not even stable. A 145-token change is far below that floor.
3. The B2 gate already assigned the correct instrument for the removal direction: a per-rule ablation
   programme, which is a paid run, not a `$0` deletion.

The `ss-semantic` half also escapes its own falsifier. It survives at **−0.1% of one codex cell**,
against a codex gap of +0.3% that is itself inside the bench's noise floor. That is not a lever; it
is a candidate for the S3 fallback-path repair the forensics already recommends.

---

## 9. What I could not finish

- I did not measure whether deleting the mapping paragraph changes claude-code behaviour. That needs
  a paid ablation; no `$0` method exists, and the attribution in the candidate's own source is
  explicitly `[I]` ("Which rule the model is following is inferred, not read"; "the claude-code
  system prompt is not persisted").
- I did not price what replaces an `ss-semantic` call after removal. The substitution pattern is
  measured (58% further same-file retrieval), the cost of the substitute is not.
- I did not check whether the `d309860` fix-surface effect reproduces on luna. Every fix-surface
  smoke ran gpt-5.5. The paragraph's solve evidence is therefore backbone-specific, which is the one
  genuine opening a future candidate could use — through an ablation, not an assertion.
- I did not open HO2, any grading log, or any hidden test.

---

## 10. Evidence opened

Local:
- `eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/DEAD-LEVER-REGISTER-DRAFT.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/register/DEAD-LEVER-REGISTER.md` (rows A1, A2,
  A6, B2, B3, B12, B17, B18, C4, E4, E8, F15, P1, G5, G6; §0.1, §0.2, open questions 33, 45)
- `eval/task-completion-bench/handoffs/lever3-eviction/PREAMBLE-TRIM-GATE.md`
- `eval/task-completion-bench/tests/tooldoc-trim-gate.mjs` (read `[C]` and executed `[M]`, `GATE PASS`)
- `eval/task-completion-bench/handoffs/improve/CLAUSE-SCREEN-RESULTS.md`,
  `CLAUSE-SCREEN-PREREGISTRATION.md`, `phase1-scripts/general-clauses.mjs`
- `eval/task-completion-bench/analysis/fix-surface-p2-smoke-2026-07-07.md`
- `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/memory/project_p2_fix_surface_candidate.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/phase-anatomy.md` (§0, §2, §6.1–6.6, S1, S3, §10)
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/claude-subagents.md` (§0, §1.2, §2, §3, §6, §7, F2)
- `eval/task-completion-bench/handoffs/improve/slate-c/candidates/DEDUP.md` (§0–§3, c04)
- `eval/task-completion-bench/handoffs/improve/slate-c/candidates/inversion-and-removal.md` (§B2, §B3, §C4)
- `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` (lines 22–64)
- `core/prompt-optimization/data/p7-final/sweet-search-system-prompt-mcp.md` (frontmatter, lines 36, 42, 54, 65)
- `scripts/inject-agent-instructions.js`; `package.json` `files`
- `eval/task-completion-bench/harness/agent-runner-shared.mjs:134-141`

Evidence box, read-only (`root@167.233.69.121`):
- `/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz` (10,942 rows)
- wrote only `/tmp/wf-slatec/c04-history/semantic-yield.py`
