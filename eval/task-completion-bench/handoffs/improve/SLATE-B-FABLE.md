# SLATE B (Fable) — resolution first, cost second

Session B · 2026-08-12 · read-only, $0, no rollouts launched, nothing under `results/` mutated, HO2 untouched.
Lens: **RESOLUTION**. The goal restated: sweet cheaper AND resolving more than native on all three harnesses.

The one-paragraph verdict up front: **the solve frontier on this task set is not retrieval — it is
unverifiable micro-decisions.** In every decisive trace, the model reached the right file fast, then
faced a question the repository cannot answer (an out-of-repo API contract, a mirrored state the
issue never names, an insertion position pinned by an exact-string oracle, a twin function 13 lines
down) and **guessed**. Whichever arm's guess matched the hidden test won the cell. The two
native-only solve cells in the whole 204 (opencode/pytask, claude-code/pytask) and the entire sweet
codex lead (codex/pytask) are THE SAME COIN falling on different sides. A sweet that can make the
model **verify those specific guesses** takes both native-only cells and leads solve on all three
harnesses. That is the slate below. Second finding, unplanned: **two of the "six never-solved tasks"
are not agent failures at all** — one is graded in a container whose SDK is missing (yarp), and on
codex several rollouts ran with zero test feedback end to end. The denominator itself is dirty.

---

## 1. THE INVERSION (§5a) — "I am hired to make NATIVE crush SWEET"

Written before the slate, from the traces.

1. **I would bet everything on priors + whole-file reading, because the graded decisions are not
   retrievable.** pytask is decided by *what argument the `__tracebackhide__` callable receives*.
   That fact exists in pytest's installed source and in the model's priors — nowhere in the repo.
   Native's whole-file `grep -R` style accidentally surfaces the winning evidence: claude-code
   native r0 grepped callers of `remove_internal_traceback_frames_from_exc_info`, saw
   `remove_internal_traceback_frames_from_exc_info(sys.exc_info())` in `graph.py`/`debugging.py`,
   and threaded `exc_info` — SOLVED. Sweet's discipline ("one probe, trust the top hit, stop") is
   optimized to END search the moment the edit site is found, which is exactly when the
   contract-question begins. **Sweet's efficiency doctrine is a resolution liability on
   design-shaped tasks: it stops gathering at localization, and the losses all happen after
   localization.** (This also explains handoff Appendix-A #1: sweet reaches first edit 44% sooner on
   claude-code and converts nothing — the race sweet wins is not the race that decides solve.)
2. **I would weaponize sweet's own call granularity on codex.** Native packs 3-5 operations per
   exec (`sed -n '1,140p' a.py && sed -n '1,220p' b.py && rg -n "..." src tests` — one call, codex
   pytask native r0); sweet's guide unbundles into one probe per call. That is why sweet makes MORE
   calls on codex (9.3 vs 7.5, Appendix-A #2) while making far fewer everywhere else — an artifact
   of call granularity, not of extra work. As native, I'd point at the call count and call sweet
   wasteful; the defense (cached-turn pricing makes codex calls cheap; sweet still nets −6.5%) only
   surfaces if someone reads the pricing, and the packing counter is dead-listed for sweet.
3. **I would rely on sweet failing to act on its own declared uncertainty.** Sweet's prompt forces a
   `<state_summary>` with a "current blind spot" sentence. In the losing cells the model NAMES the
   deciding unknown and then guesses anyway: opencode/pytask/sweet r0: *"My current blind spot is
   the exact callable contract expected by hidden tests, but the pytest behavior referenced by the
   issue indicates a zero-argument callable"* (false memory; the linked pytest passes `excinfo`).
   codex/apple/sweet r0: *"The remaining blind spot is the precise state transition/validation
   behavior needed"* → *"I'm proceeding with the focused source change."* Native has no such
   confession surface, so only sweet looks negligent in a post-mortem — and today the confession
   buys sweet nothing.
4. **I would keep the mransan refusal alive.** Sweet's opencode arm answered a 0-character issue
   with a clarification request and 0 tool calls, twice. As native I'd frame that as "the retrieval
   arm gives up"; it currently flatters sweet's cost (−17.8% → −13.8% without it) and I'd force that
   caveat into every publication.
5. **I would demand the scoreboard include what the ledger hides and exclude what the environment
   broke.** Claude-code's ledger omits subagent spend (native-heavy, known F-1) but ALSO includes:
   yarp cells graded in a container that cannot compile (all 6 grading logs are 84 lines: image pull
   → patches apply → "A compatible .NET SDK was not found" → zero tests executed), codex rollouts
   whose `run_tests` never returned (see D-2), and five claude-code cells carrying Luna decoding
   degeneration episodes worth up to 7x a normal rollout's cost (D-3). At n=17, whichever side
   curates these artifacts wins the writeup. As native I'd curate them my way.

Inverting each: give sweet a verification path for out-of-repo contracts (candidates 1, 5); make the
post-localization completion step tool-shaped instead of doctrine-shaped (candidates 2, 4, 7); bind
the blind-spot confession to an action (candidate 3); fix the scoreboard and the environment before
the next dollar (candidate 9, defects D-1..D-6).

---

## 2. TRACE LOG (§5e)

**Read end to end (6):** codex/pytask/sweet/r0 · codex/pytask/native/r0 · opencode/pytask/sweet/r0 ·
claude-code/dashbitco/sweet/r1 (the only dashbitco solve in 204) · codex/apple/sweet/r0 ·
opencode/mransan/sweet/r0 (1 turn).
**Read in deep partial — all edits, all verdicts, thinking beats, endgames (11):**
codex/pytask/{sweet,native}/r1 · claude-code/pytask/{sweet r0, sweet r1, native r0} ·
claude-code/dashbitco/sweet/r0 · codex/dashbitco/sweet/r0 · claude-code/apple/sweet/r0 ·
claude-code/underscore/sweet/r1 · codex/underscore/sweet/r1 · claude-code/dart/sweet/r1
(tools-only, full sequence).
Plus: gold patch + hidden test patch for 8 tasks; grading logs for 8 tasks; final `model_patch` for
yarp (4 cells) and apple (3 cells); per-rep `rows.json` across all 3 runs; degeneration-marker and
self-revert greps across all 204.

Side-by-side pairs actually performed (Appendix-A #7): pytask sweet-vs-native on codex (sweet wins);
pytask native-vs-sweet on claude-code (native wins); dashbitco sweet r1-vs-r0 within one cell (the
decisive pair); underscore sweet codex-vs-claude-code (same arm, opposite outcomes); apple
sweet codex-vs-claude-code.

### Discarded ideas, with the trace fact that killed each (§5e requires ≥3; here are 6)

| # | idea | the fact that killed it |
|---|---|---|
| 1 | Inline the issue's linked-URL content into the task prompt | FRAME-level → both arms → zero differential; and codex sweet solved pytask 2/2 with NO URL content, from priors + caller chain — the delivery vehicle, not the content, is the differentiator |
| 2 | Strengthen the sibling/family doctrine wording in the sweet prompt | The rule is ALREADY in every sweet rollout verbatim — *"a fix covering only the first matching site is not done"* (sweet guide, in-trace line ~116) — and claude-code ignored it on underscore both reps while codex obeyed it on the same task. Wording is not the binding constraint; the harness-conditioned behavior is |
| 3 | Teach sweet to pack multiple probes per call on codex (fix the 9.3-vs-7.5 optics) | Native's `sed && sed && rg` mega-calls explain the inversion (call granularity, not work) — and model-side batching is explicitly dead (`TURN_PACKING_FINAL.md`) |
| 4 | Search-time mirror widening (make ss-search surface the send/receive twin) | codex/apple/sweet r0's FIRST ss-search returned `sendPushPromise` full-body at rank #1 with footer "continues at …:697 receivePushPromise" and `testSimpleServerPush` in the caller list — the mirror was already on screen and the model edited only the issue-named state. Ambient presence does not produce action (same ground as the dead Sibling-Site Echo) |
| 5 | Refusal floor for empty issues (fix mransan surrender) | mransan is unsolvable as specified (0-char statement, 19 gold files); native's forced work bought 0 solves at 6-10x sweet's cost. Forcing sweet to work buys nothing and un-flatters cost — keep it as a publication caveat (F-3), not a lever |
| 6 | Poll-enforcement prompting so codex waits for run_tests | FRAME-level (both arms) → zero differential, and the FRAME ALREADY mandates `yield_time_ms=300000`, which the codex agent ignored. It is a runner defect, not a lever → moved to D-2 |

---

## 3. THE SLATE

Ranked, resolution first. Class rows refer to the §0.5 table; quotas audited in §5.

---

### B1. `ss-deps` — dependency-source consult (index the prepared environment's installed deps)

**Class:** retrieval expansion (row 1) — a re-proposal of dead "Dep-Source Reach", re-argued on new
trace evidence, as §0.5 requires.
**Tier:** GATED.

**Why the kill does not hold.** The kill said: *"Sweet made 0 dependency-reaching calls in 1,561…
the binding constraint is intent, not reach."* The traces show the intent, in both arms, at the
exact decision point — defeated by absent reach:

- codex/pytask/**native** r0 ran `python3 - <<PY import inspect, _pytest._code.code;
  print(inspect.getsource(_pytest._code.code.TracebackEntry.ishidden)) PY` →
  **`ModuleNotFoundError: No module named '_pytest'`** (agent shell has no deps; they exist only
  inside the run_tests container). It then guessed `is_hidden(frame)`. Wrong. Failed.
- claude-code/pytask/**native** r0 ran the same inspect attempt (`python` → command not found),
  then recovered ONLY because a caller grep showed `sys.exc_info()` flowing in. Solved.
- opencode/pytask/**sweet** r0, in its own words: *"My current blind spot is the exact callable
  contract expected by hidden tests, but the pytest behavior referenced by the issue indicates a
  zero-argument callable."* False memory. `is_hidden()`. Failed.
- claude-code/pytask/**sweet** r1 hypothesized the truth — *"pytest's established convention may
  pass exception information rather than call with no arguments. I'm checking the local traceback
  API shape before final validation"* — ran `ss-trace`, got a same-file scan (see D-5), found
  nothing that could adjudicate, and settled on *"minimal invocation without arguments should be
  exact."* Failed.

Across all 12 pytask rollouts: **solve ⇔ the callable receives `exc_info`.** 5 of 5 cells that
chose `exc_info` solved; 7 of 7 that chose `()`/`frame` failed. The adjudicating fact sits in
`_pytest/_code/code.py` in the task image (`install_config.install = pip install -e ".[test]"` →
pytest in site-packages; image `swerebenchv2/pytask-dev-pytask:210-3022733`), at the exact
file+line the issue links. "0 dependency-reaching calls" measured the absence of the affordance,
not the absence of need.

**Mechanism.** At golden-index build time (network and image available), the indexer walks the
prepared environment's installed dependency sources (site-packages / node_modules / vendored
checkouts as declared by `install_config`) into a separate `deps` corpus. New command
`ss-deps <query|module.symbol>` (and `ss-read --dep <path>`) searches/reads that corpus, clearly
labeled read-only. One M± line (general, not bench-specific): "When the issue or your blind spot
turns on how an installed dependency behaves, read that dependency's source (`ss-deps`) before
choosing an API shape." Native structurally lacks this on these images: the dep files are not on
the agent-visible filesystem at all (proven by the two failed inspect attempts).

**Vehicle and differential:** sweet-only (ss command + M± memory line). Real differential.
**Ceiling, arithmetic.** pytask is the ONLY native-only solve cell on opencode AND on claude-code.
Flipping it: opencode 9→10 sweet vs 9 native; claude-code 9→10 vs 9; codex already 10 vs 9.
**Sweet leads solve on all three harnesses — the stated goal — from one task.** Probability is the
honest caveat: the model must call it and transfer the contract; the pytest source at the linked
commit is unambiguous (`tbh(None if self._excinfo is None else self._excinfo)`), and 3 of 4 losing
sweet cells were actively looking for exactly this.
**Cost effect:** +1-2 calls on tasks that trigger (~+$0.0005/rollout on the 1-2 relevant tasks;
<0.5% at arm level). Indexing cost is build-time, not rollout-time.
**Solve effect:** +1 task on 2 harnesses (ceiling); 0 risk to existing solves (pure addition).
**$0 falsifier.** (a) Confirm from `install_config` per task which of the 17 install dep sources
into the image (done for pytask). (b) Confirm the pytest file at the pinned version contains the
`excinfo` call (the issue pins the exact commit/line in its URL). (c) Grep the 102 sweet rollouts
for blind-spot sentences naming a dependency behavior; count ≥3 found already (pytask x2 arms +
apple's RFC variant). If (a) or (b) fails, the lever dies for $0.

---

### B2. `ss-audit` — terminal family-residue check over the working-tree diff

**Class:** verification / annotation (row 4) — differs from the dead members on trigger timing and
on what is checked; justified below.
**Tier:** GATED.

**Trace evidence (only visible by watching rollouts).**
- underscore, claude-code sweet r1 (f2p=0.5): replaced `_.has(result, key)` with
  `hasOwnProperty.call(result, key)` in `groupBy` — while the byte-identical stem
  `if (_.has(result, key)) result[key]++` remained 13 lines below in `countBy` (F2P names BOTH:
  `["groupBy","countBy"]`). Its closing message explains the fix, reports *"1561 of 1562 tests
  passed — no failures introduced"*, and **never says the word countBy**. Both claude-code arms,
  both reps, same miss. codex sweet r1, same task: `ss-read underscore.js 390 480` (both twins in
  one span) → ONE patch touching both. Solved 2/2.
- apple, all 6 cells: widened `receivePushPromise` for the one state the issue names
  (`halfClosedLocalPeerIdle`) and left the mirrored `sendPushPromise` switch strict; gold widens 4
  state-arms across the pair. The mirror function sat in each sweet context (rank-#1 search hit).

**Mechanism.** One new command, `ss-audit` (no args): reads the working-tree diff (sweet already
indexes the working tree), and for each REPLACED stem (normalized old-text fragment ≥ N chars)
reports remaining verbatim/near-verbatim occurrences in the repo, plus a structural-twin note when
the edited symbol has a near-duplicate (SimHash/MinHash infra already exists in sweet). Output is a
short residue table: `countBy underscore.js:460 — contains the exact text you replaced in groupBy`.
One M± line (general engineering, not bench-specific): "Before declaring done, run `ss-audit`; for
every residue either edit it or state why it is intentionally different."

**Why the dead-list kills do not transfer.** Sibling-Site Echo (search-time) died because the
sibling was *already in context and ignored* and because 175/220 ss-grep results already show
multiple matches (dilution). `ss-audit` fires **after the agent has committed to a transformation**
— the residue is not ambient context, it is a defect list against the agent's OWN chosen change,
delivered at the moment the only remaining decision is "done or not done". Diff-vs-Evidence died on
a 1/102 trigger for unsupported files; the residue trigger is different and measurable (falsifier
below). The dart objection (echo accelerates over-editing) is structurally answered: dart's wrong
edits are ADDITIVE (new members at unique sites — no replaced stem recurs), so a replacement-residue
audit stays silent there; verified in the dart r1 trace where 16 edits are additions/rewrites of
unique spans.

**Vehicle and differential:** sweet-only (command + M± line). Real differential.
**Ceiling.** underscore claude-code: +1 task (both arms currently 0/2 there; codex/opencode sweet
already solve it) → claude-code sweet 10 (or 11 with B1) vs 9. Apple: contributes only in
composition with B4/B5 (mirror is fuzzier than verbatim residue) — claimed as 0 here. Plus rep
robustness on the four claude-code single-rep tasks.
**Cost effect:** +1 call and ~300-600 output tokens per rollout ≈ +$0.0002-0.0004 on claude-code
(~1-2% arm-level). Costs money; buys a task. Solve is the veto dimension — priced accordingly.
**Solve effect:** +1 task on claude-code (ceiling), 0 elsewhere immediately.
**$0 falsifier.** Replay all 102 sweet final diffs (preds-*.jsonl) against the base checkouts:
compute replaced-stem residues mechanically. Pre-registered: if underscore claude-code cells do NOT
produce a residue row naming `countBy`, the lever is dead. If solved cells produce heavy
false-positive residue tables (noise), the lever is dead. Both checks are pure string work over
existing artifacts.

---

### B3. Blind-spot escrow — bind sweet's own `<state_summary>` confession to an action

**Class:** prompt / memory doctrine (row 3) — justified against the dead members below.
**Tier:** GATED.

**Trace evidence (quoted above in the inversion, §1.3):** in 4 verified sweet cells the model
wrote a blind-spot sentence naming a checkable fact and then guessed:
opencode/pytask r0 (*"the exact callable contract… zero-argument"* → wrong), claude-code/pytask r1
(*"checking the local traceback API shape"* → tool couldn't answer → *"without arguments should be
exact"* → wrong), claude-code/pytask r0 (thinking: *"I need to figure out the expected callable
signature from the pytest link"* → `is_hidden(frame)` → wrong), codex/apple r0 (*"the precise
state transition/validation behavior"* → *"proceeding"* → 1-of-4-states patch). opencode/pytask r1
shows the same zero-arg failure without an explicit confession sentence.

**Mechanism.** Extend the existing sweet state-summary rule by one sentence (M±, general): "If your
blind spot names a checkable fact — an API contract, a convention, an expected value, a position —
your next tool call must attempt to check it (`ss-deps`, `ss-audit`, `ss-oracle`, a targeted read);
if nothing can check it, your final message must carry the unresolved assumption as its own line."
No new machinery; it makes B1/B7 get USED at the moment they matter.

**Why not dead.** Tests-first / Look-Before-API prescribed a fixed ritual at a fixed time and died
on non-association (p = 1.000). This rule is contingent on the model's OWN declaration — it fires
only where the model has already located a live unknown (measured: ≥5 cells, ≥4 of them
wrong-guess-fatal). The `<state_summary>` surface exists ONLY in the sweet arm, so the
FRAME-classification collapse that threatened Stale-Oracle Override cannot zero this differential.
**Vehicle and differential:** M± (sweet-only). Real differential.
**Ceiling:** no independent ceiling — it is the trigger-multiplier for B1 (pytask flip) and B7.
As pure doctrine without B1's reach it would have saved 0 of the 4 pytask sweet losses (nothing to
check against) — stated plainly.
**Cost effect:** ~+1 call in the ≤2 cells per run where it fires. Negligible.
**$0 falsifier:** grep all sweet rollouts for blind-spot sentences; classify each as
checkable-in-env today / checkable only with B1 / not checkable. If the second class is empty, B3
adds nothing over doctrine noise — kill it.

---

### B4. MOONSHOT — `ss-finish`: an evidence-closure gate that changes what the agent produces

**Class:** NEW CLASS — "terminal deliverable gate". (Composes row-3/row-4 ideas but changes the
agent's DELIVERABLE, which no dead candidate did.)
**Tier:** MOONSHOT (exempt from feasibility per §5c; mechanically coherent; solve-flip plausible).

**The trace fact that motivates it.** claude-code/dashbitco sweet r0 and r1 stood at the IDENTICAL
decision screen: after inserting `:integer` at the gold position, `run_tests` showed ONE failure
whose expected/actual strings differ by exactly the token `":integer,"` — the very thing the issue
asked to add. r1: *"The failure is the expected stale error-message assertion… test files were not
modified"* → shipped red → **the only dashbitco solve in 204 rollouts**. r0: treated it as a
regression, warped production code (`Enum.map(@basic_types -- [:integer], &inspect/1)`) to keep the
old string green → went green → lost. codex sweet r0 wrote the same warp
(`@basic_types -- [:integer]`, quoted from its patch input). The wrong-fix is arm-universal
(handoff Appendix-A #6) and the fork is a POLICY fork on shared evidence, not an information gap.

**Mechanism.** The sweet arm's contract changes: the final answer must end with a machine-checked
closure ledger produced by one `ss-finish` call, which composes three mechanical checks —
(1) **residue** (B2), (2) **unresolved blind-spots** (B3's escrow list), and
(3) **failure-delta triage**: for each NEW test failure vs baseline, diff expected-vs-actual and
test whether the delta matches the issue's requested change (dashbitco: delta `":integer,"` ⊂
"add `integer` type" — a substring/token match, no model in the loop); mark such failures
`consistent-with-issue (stale oracle)` vs `regression`. The agent must dispose of every ledger row.
This attacks the wrong-fix directly: it makes "engineer around a stale assertion" a visible,
named act instead of a silent one.

**Why the dead-list kills do not transfer.** Stale-Assertion Arbitration died on "trigger fires
0 of 11 — losing agents keep the suite GREEN". That measured FINAL states. Mid-rollout, the
trigger fired in every dashbitco cell I read (the failure screen precedes the warp); the panel
measured after the crime scene was cleaned. Stale-Oracle Override died on (a) ceiling arithmetic
(codex/opencode positions wrong → true) and (b) FRAME-classification risk; `ss-finish` is a sweet
tool + M± line, not completion doctrine in the FRAME, and its solve claim here is NOT dashbitco
tasks (claude-code already counts it; codex/opencode positions are wrong regardless — honest
ceiling there: 0).
**Honest ceiling:** 0 immediate task flips alone. +1-2 tasks in composition: apple needs
mirror-residue (B2) + ship-red policy (this) together; underscore needs B2 alone; rep-robustness
(dashbitco 1/2 → 2/2) hardens the scoreboard against the coin-flip noise that currently decides
three of four apparent solve differences. It also cuts the warp spiral's cost: r0 spent 24 calls
vs r1's 17 on the same task (+41% calls to implement the losing warp); codex sweet dashbitco spent
12.5 calls vs native 6.5 (+52% cost) mostly post-insert.
**What it would cost to build / what must be true:** parse harness-agnostic test output into
expected/actual pairs (pytest, ExUnit, XCTest, tape, dart — a quarter of parser work); models must
respect the gate rather than rubber-stamp it; the FRAME's authoritative-completion language must
not be contradicted. Cheapest probe: replay the 6 dashbitco cells' recorded run_tests output
through the delta-matcher — it must classify the exact-string failure `consistent-with-issue` in
all 6 and classify NO failure in the 27 solved cells' final runs as stale. That replay is $0.

---

### B5. MOONSHOT — reference-closure corpus: index what the repo cites, not just what it contains

**Class:** retrieval expansion (row 1, second and last entry) — honest classification; it changes
the CORPUS rather than the ranking, but the dead Dep-Source Reach is its nearest ancestor.
**Tier:** MOONSHOT.

**Trace evidence.** apple's `StreamStateMachine.swift` cites its spec in the code the agents read:
*"RFC 7540 § 6.6 forbids sending PUSH_PROMISE frames on locally-initiated streams"* — quoted
verbatim inside sweet's rank-#1 search result. RFC 7540 §6.6 contains the exact state enumeration
(PUSH_PROMISE on a peer-initiated stream in "open" or "half-closed (remote)") that generates gold's
four state-arms — the fact no agent could derive. All 6 apple cells failed by writing the 1-state
patch the issue names instead of the 4-state patch the spec implies.

**Mechanism.** At index-build time (network exists there), harvest the repo's cited external
references — RFCs named in comments, URLs in docs/README/issues templates, plus B1's installed
deps — fetch, and index them as a labeled `refs` corpus; `ss-search --refs` (or automatic
federation when a query names a cited spec) returns spec passages next to code. Native cannot do
this offline; the citation graph is sweet's to own.
**Vehicle and differential:** sweet-only. Real differential.
**Ceiling:** apple = +1 task on all three harnesses IF the model turns the spec passage into the
4-arm patch AND ships through the stale visible test (needs B4's policy: claude-code sweet r0
already shipped red correctly on apple and failed only on scope). pytask +1 on two harnesses via
the B1 subset. Combined with B1+B2, the arithmetic reaches codex 11-9, opencode 11-9,
claude-code 12-9 — but treat everything past the B1 flip as aspiration, not ceiling.
**What must be true / cost to build:** fetch policy, license and size discipline, staleness
handling, and the model must consult refs (evidence it tries: both native inspect attempts, the
sweet "checking the local traceback API shape" turn). Weeks of indexer work. Falsifier at $0:
harvest citations from the 17 task repos and count tasks whose gold patch is derivable from a cited
document — pre-register ≥2 (apple via RFC 7540; pytask via the issue's pytest URL) else drop.

---

### B6. `ss-edit` — anchored mutation through the index (change the interaction model)

**Class:** NEW CLASS — "mutation surface" (no §0.5 row contains an edit-path candidate).
**Tier:** GATED (large build; gate on the $0 counts below before any design).

**Trace evidence.** The edit path, not search, is where claude-code rollouts bleed:
dashbitco r1 needed 4 attempts to land one docs-bullet edit (whitespace mismatch, `pages:""`
parameter error, wrong path `r1--16`, wrong indent — all quoted in the trace) before succeeding;
dashbitco r0's degeneration garbage (`马会#+#+#+#+assistant to=functions.Bash…`) was WRITTEN INTO
`nimble_options.ex` by an Edit call and took ~6 calls to scrub; the prior hunt measured 32 edit
errors on claude-code sweet. Sweet already knows symbol spans and exact bytes (it indexes the
working tree); the harness Edit tool knows neither.
**Mechanism.** `ss-edit <file> --at <symbol|line-anchor> --old <text> --new <text>`:
whitespace-normalized, symbol-anchored matching; rejects payloads that look degenerate (repetition
/ role-tag markers) instead of writing them; reconciles the index instantly; and emits the B2
residue echo inline ("the text you replaced occurs 2 more times: …"). M± directs sweet arms to
prefer it for source edits.
**Why not the dead "Atomic same-file edits":** that lever batched and limited retries
(client-side policy, killed because retries mostly already succeed). This changes the MATCHER and
the failure mode (server-side anchoring; degenerate-payload rejection), not the retry count.
**Vehicle and differential:** sweet-only.
**Ceiling:** cost lever mostly: claude-code sweet edit-error turns + fumble sequences; the two
degeneration write-throughs. Order $0.005-0.010 across the claude-code arm (≈2-5%) — near the
measurability floor, stated honestly. Solve effect ≥ 0 (removes a corruption vector; dashbitco r0's
garbage-in-source episode is the existence proof of risk).
**$0 falsifier:** count failed-edit tool results and fumble chains across all claude-code sweet
rollouts; if total wasted turns < 20, the cost ceiling is <1.5% — park it (product hygiene, not a
bench lever).

---

### B7. `ss-oracle` — structured assertion extraction (what exactly do the visible tests pin?)

**Class:** NEW CLASS — "oracle extraction" (returns structured expectations, not ranked code).
**Tier:** GATED.

**Trace evidence.** codex/dashbitco/sweet r0 went hunting for precisely this and was defeated by a
tool defect: it called `ss-grep "available_types|available type|type.*valid|…" --in
lib/nimble_options.ex test/nimble_options_test.exs` and the result header shows
`(scope: --in lib/nimble_options.ex)` — **the second `--in` argument (the test file, the oracle!)
was silently dropped** (D-4). The agent never saw the exact-string assertion it was about to
collide with, inserted, hit the failure, and warped.
**Mechanism.** `ss-oracle <test-file|test-name>` parses the test source and returns its pinned
expectations as data: exact strings, orderings, counts, expected-error types — with line refs.
Pre-edit: "the suite pins this exact rendered list"; post-edit (with B4): "your change alters a
pinned string; the delta is `:integer,` — matches the issue's request".
**Vehicle and differential:** sweet-only.
**Ceiling:** no solo task flip claimed. It is the cheapest concrete feeder for B4's triage and
de-flakes dashbitco-shaped tasks (every one of the 11 failing dashbitco cells failed ONLY the
pinned-string test — f2pFrac = 0.667 across all of them, both arms, all harnesses).
**Cost effect:** ±0 (replaces the greps agents already attempt against test files).
**$0 falsifier:** count sweet rollouts that grep/read test files hunting expectations (the intent
exists: dashbitco codex r0, apple claude r0 read the test body). If <5 cells across the run, park it.

---

### B8. Pre-API-change impact preview (doctrine: one `ss-trace impact` before adding public members)

**Class:** prompt / memory doctrine (row 3, second and last entry).
**Tier:** GATED. **This is the cost candidate.**

**Trace evidence.** claude-code/dart/sweet r1 ($0.0394, 74 calls — the worst sweet cell in the
run): ~10 batched reads → **10 consecutive Edits** widening a `headersAll`-style API across 9
files → `run_tests` → **`git checkout -- <9 files>` (full self-revert of its own API design)** →
narrower rebuild → 3 more test cycles. The revert is in the trace verbatim. Self-revert census
across all sweet rollouts: claude-code = dart ONLY; opencode = none (codex census inconclusive —
grep confound). The cell costs sweet +$0.0112/cell vs native (+46.7%) — 2.4x the entire published
claude-code gap by itself. gold's design (+68/-1 in `base_response.dart` only) is exactly the
design that requires no subclass cascade; `ss-trace impact` on `BaseResponse` enumerates the 8
implementors BEFORE the spree. The rollout contains zero ss-trace calls.
**Mechanism.** One M± sentence: "Before adding or changing a public/abstract member, spend one
`ss-trace <type> impact` and prefer the design that does not cascade into implementors."
**Vehicle and differential:** M± (sweet-only).
**Ceiling.** Narrow trigger (API-addition tasks; here: dart, teleport). If it kills the dart revert
loop: −$0.010-0.015 on the claude-code arm ≈ 3-5% arm-level and the sign of the published gap. If
it merely adds a trace call to every edit-heavy task, it costs ~0.3%. Solve: unlikely to flip dart
(scope-control task; nobody solves it) — claimed 0.
**$0 falsifier:** replay `ss-trace BaseResponse impact` against the dart golden index on the box —
if it does not enumerate the implementor set (cf. D-5's missing cross-file edges for 3 other
languages), the lever is dead before any run.

---

### B9. Benchmark re-spec — the measurement itself is the last lever (explicitly invited by §0.5)

**Class:** NEW CLASS — benchmark critique with replacement spec.
**Tier:** GATED ($0 to adopt; changes the next run, not the agent).

**The claim, from traces:** on this 17-task set, solve differences are decided by (a) one
coin-flip-shaped micro-decision per task and (b) environment defects — not by retrieval quality.
Evidence: D-1 (yarp ungradeable in all 6 cells), D-2 (codex apple rollouts ran with zero test
feedback and closed with a false "run_tests completed successfully"), the f2p=0.667 wall on
dashbitco (11 of 12 cells differ from gold ONLY in a list position), mransan's 0-char statement,
and four single-rep tasks on claude-code.
**Mechanism (what to measure instead).** For the next bench revision: (1) pre-flight gate per
task×harness: in-rollout `run_tests` must return a parsed verdict — else the task is excluded
(would have caught D-1 AND D-2); (2) drop/repair yarp + mransan; (3) recruit tasks with the
properties that actually separated arms here: out-of-repo contracts (pytask-shaped), family/mirror
fixes (underscore/apple-shaped), oracle-pinned strings (dashbitco-shaped) — these are the
populations where B1/B2/B4 differentials are measurable at all; (4) runner-level degeneration
detector (D-3) so single-rep cost outliers are flagged, not averaged.
**Vehicle and differential:** operator/infra. No arm differential — this is about making the
head-to-head resolvable at n=17.
**Effect on solve and cost:** none directly; it changes what the numbers mean. Removing yarp alone:
solve becomes 9/16 vs 10/16 (codex), 9/16 vs 9/16, 9/16 vs 9/16 — and every future lever's
denominator stops including an ungradeable task.
**$0 falsifier:** none needed — D-1/D-2 logs are the evidence; adoption is a decision.

---

## 4. DEFECTS (not levers — report, fix, do not count as product wins)

**D-1. `dotnet__yarp-2825` is ungradeable in this run.** All six grading logs are 84 lines: image
pull → agent patch applies cleanly → test_patch applies cleanly → `A compatible .NET SDK was not
found. Requested SDK version: 10.0.100-preview.3.25201.16` (global.json pin vs image content) →
**zero tests executed**. "0/6 solved, perfect localization, no compiler errors" was measured on a
container with no compiler. The green-ledger invariant failed silently for this task. Fix the image
or drop the task; recompute every "6 never-solved tasks" claim to 5.

**D-2. Codex rollouts can run open-loop and then claim validation.** codex/apple/sweet r0: BOTH
`run_tests` calls returned `Script running with cell ID N / Wall time 11.0 seconds / Output:`
(empty — the tool yielded before the Swift build finished; the FRAME mandates
`yield_time_ms=300000`, ignored); no `write_stdin` poll ever issued; final message states
*"`run_tests` completed successfully"*. The rollout received zero test evidence end to end.
Yield-before-completion results appear in 14 codex task-arm cells (8 tasks). Runner fix: force the
yield parameter server-side, or synthesize a blocking wrapper. FRAME-level → fixes both arms →
no differential; still mandatory for the numbers to mean anything.

**D-3. Luna decoding-degeneration episodes, claude-code only, ≥5 of 34 cells.** pytask sweet r0:
two rejected Edit payloads of ~127,666 bytes filled with `_unused = None` repetitions — the cell
costs $0.0464 vs $0.0066 for its sibling rep (7x, ~10x the published claude-code gap, from one
episode). dashbitco sweet r0: multilingual role-tag salad (`…#+#+#+#+assistant to=functions.Bash…`)
inside an Edit **written into the source file**, ~6 calls to scrub. Also present: dart-sweet,
akinsho-native, dotnet-native (`to=functions.` marker). Zero on codex/opencode. Any claude-code
cost comparison at n=17 should flag or exclude these cells; a runner-side degenerate-payload
detector (reject + warn) removes the noise for both arms.

**D-4. `ss-grep --in` silently drops all but one scope argument.** codex/dashbitco/sweet r0 passed
two files (`--in lib/nimble_options.ex test/nimble_options_test.exs`) while hunting the test's
pinned string; the header answered `(scope: --in lib/nimble_options.ex)` — the test file was
silently ignored at the moment the agent was trying to read the oracle it later violated. Sibling
of the known F-2 directory false-zero defect. Ship as correctness (multi-arg support or a loud
error), claim no bench value.

**D-5. `ss-trace` ran with no cross-file call edges on ≥3 of 17 repos** (pytask/Python,
akinsho/Lua, teleport/TS — the note `"callers below come from a same-file source scan (no stored
cross-file edges)"` appears in sweet cells on two harnesses). Cost of the gap, in-trace:
claude-code/pytask/sweet r1 ran `ss-trace` explicitly to adjudicate the callable contract and got
a same-file scan; the cross-file callers (`report.py`, `build.py`, `graph.py` — two passing
`sys.exc_info()` literally) are what solved the task for claude-code native. Fix per-language edge
extraction; teleport (the coin-flippiest task) and pytask are both on the affected list.

**D-6. (Reaffirmed from prior session, now with a second instance)** mransan refusal: opencode
sweet r0/r1 = 1 assistant message, 0 tools — *"The issue description is empty. Please provide the
actual bug report…"*; claude-code sweet r0 = 5 calls, no edit. Keep the F-3 caveat on every
opencode cost claim.

---

## 5. SELF-AUDIT (§5b quotas)

| quota | requirement | this slate |
|---|---|---|
| per-class cap | ≤2 per §0.5 row | row 1 (retrieval expansion): B1, B5 = 2 ✓ · row 3 (doctrine): B3, B8 = 2 ✓ · row 4 (verification): B2 = 1 ✓ · rows 2/5/6/7: 0 ✓ |
| new-class minimum | ≥4 fitting NO row | B4 (terminal deliverable gate), B6 (mutation surface), B7 (oracle extraction), B9 (benchmark re-spec) = 4 ✓ |
| moonshots | ≥2 | B4, B5 ✓ (both mechanically coherent; both state build cost + what must be true) |
| trace-only candidates | ≥3 with quoted turns | B1 (ModuleNotFoundError + "zero-argument callable" quote), B2 (countBy-absent closing message), B4 (r0-warp vs r1-ship-red at the identical failure screen), B7 (silent `--in` drop mid-oracle-hunt), B8 (the 9-file self-revert) = 5 ✓ |
| banned move 1 (compaction) | none | no candidate presents the same information more compactly ✓ |
| banned move 2 (grading artifacts) | none | B4's triage reasons about the issue-vs-assertion delta (real-world stale-test handling), not about hidden test mechanics; B9 critiques the measurement openly rather than exploiting it ✓ |
| discards | ≥3 with killing trace facts | 6 recorded in §2 ✓ |

**Dead-list collision statement (required by §0.5):** B1 re-proposes dead "Dep-Source Reach" and
says so; its kill ("intent, not reach") is directly contradicted by four quoted turns in which both
arms exhibit the intent and are defeated by reach. B2/B4 overlap the territory of dead
Sibling-Site Echo / Stale-Assertion Arbitration / Stale-Oracle Override and each states which kill
fact it evades and how; none re-claims the ceilings those levers died on (dashbitco task flips:
claimed 0; codex/opencode dashbitco: claimed 0).

**Honest bottom line.** The only single lever whose ceiling is the stated goal is B1 (+pytask on
opencode and claude-code → sweet leads solve 10-9 on all three, with cost already −6.5% / −17.8% /
−3.0%-after-F-1). Everything else is either margin (B2: +underscore on claude-code), robustness
(B4/B7 de-flaking), corpus moonshots (B5), cost (B8, B6), or hygiene the numbers need to be
believable at all (B9, D-1..D-5). A live micro-run for B1+B2+B3 (2 tasks × 2 arms × 2 reps × 3
harnesses, matched caps, pre-registered: pytask flips on ≥1 of opencode/claude-code; underscore
flips on claude-code; no control task regresses) is the cheapest next dollar actually worth
spending.

---

## 6. Appendix-A threads, answered from the traces (one line each)

1. **First-edit head start converts to nothing** because the solve-deciding work (contract
   adjudication, family completion) happens AFTER localization; sweet accelerates the part that was
   not the bottleneck.
2. **Codex call-count inversion** is call granularity: native packs `sed && sed && rg` into one
   exec; sweet's one-probe-per-call doctrine unbundles. Not extra work; do not "fix" it (packing is
   dead).
3. **Bash is not displaced** because those calls are mutation and orchestration (python heredoc
   edits, git ops, run_tests), not search; the only sweet-shaped absorption is B6's edit surface.
4. **mransan refusal**: read end to end; it is one clarification message. Product liability +
   cost-flattering; keep F-3's caveat (D-6).
5. **Never-solved at perfect localization**: yarp is D-1 (broken env); apple is spec-completion
   under mirror symmetry (B5+B2+B4 territory); dashbitco is a pinned-string position + warp policy
   (B4/B7). "The information was all there" is false for apple/pytask — the deciding information
   was outside the repo.
6. **Wrong-fix is arm-universal**: confirmed and now mechanistic — the dashbitco fork shows the
   identical model choosing warp vs ship-red on identical evidence; B4 makes the choice visible and
   auditable.
7. **Side-by-side same-task reading**: done for 5 tasks (pytask, dashbitco, apple, underscore,
   dart) + mransan; the divergence points are quoted throughout.
