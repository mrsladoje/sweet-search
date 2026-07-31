# EDIT_THRASHING — killing the completion tail (2026-07-31)

The **primary** cost lever. Synthesized from three independent analyses (Claude Fable 5, GPT-5.6
Sol / Codex, Kimi K3 Max) of `TURN-ECONOMY-HANDOFF.md`; companion to `TURN_FIX_PLAN.md` (shares
Phase 0 and the final 2×2). Evidence tags as in the companion: `[verified]`, `[box — re-verify]`,
`[paper]` / `[paper detail]`.

---

## 0. Why this is the primary lever

- **8 tasks = +$16.70 = 107.2% of the retired run's entire cost gap**; the other 192 tasks
  net-offset `[verified: PLAN.md:426]`. Removing the tail matters more than shaving a search turn
  everywhere.
- Stage-1 signature: search −3.6%, **edits +63%, tests +43%**, operations exactly flat (143→143).
  One task (thelounge: turns 11→28, edits 5→17, failed both arms) carries the entire REVERT.
- **thelounge anatomy** `[box — re-verify]`: the variant *complied* with batching (first two
  search envelopes carried 3 commands each); reached an early state of "link tests pass, only the
  6 baseline SQLite failures remain"; then spent ~25 envelopes oscillating between two designs
  (Promise caching vs callback multiplexing), re-testing each flip. It searched MORE during
  repair than control (30 v 10 post-edit searches). **Thrash = completion uncertainty + a harness
  warning amplifier — not retrieval starvation.** Capability without stable policy.
- Literature (independent convergence):
  - **Coherence Collapse**: 60-69% of agent failures reach and modify the correct function, then
    corrupt it; preserving best patch states recovered 5/5 cases where gold patches existed
    mid-trajectory `[paper: 2603.24631]`.
  - **More with Less**: fixed turn caps at the model's p75 cut cost 24-68% at ~flat solve;
    dynamic staged budgets add 12-24%; the per-turn remaining-budget **reminder is the mechanism,
    not the cap** (solve collapses without it) `[paper: 2510.16786; ablation = paper detail]`.
  - **To Run or Not to Run** (ISSTA'26): banning test execution cost ~1.25pp solve (n.s.) while
    saving 56-62% tokens; **81-100% of failed runs passed the agent's own validation** — the
    edit→test loop is frequently uninformative about the real objective; quotas price
    uninformative iteration `[paper detail — verify venue+numbers]`.
  - **EET / SWE-Effi**: failed trajectories cost 3-4× successful ones ("token snowball"); early
    termination −19-55% cost at ≤0.2pp solve `[paper detail — verify]`.
  - **SWE-agent**: lint/parse gating stops error cascades; they *abandoned* semantic
    stuck-detection for false positives → circuit breakers need ~100% precision.
  - **OpenHands stuck detector**: matches exact/alternating action patterns — insufficient here:
    our agents change the patch string every cycle while world-state stays put. **Detect on
    external STATE (diff hash + failure set), never on command strings.**

## 1. Phase 0a — remove the harness thrash amplifier (VERIFIED bug)

**The identifier warning is generating false authority-displacing noise:**

- `harness/rt-condense-lib.mjs:253` ff `[verified]`: extracts identifiers from the diff and
  treats the **project symbol index as the authority for whether they resolve**. Runtime
  built-ins (`Promise`, `AbortSignal`, …) are never in a project symbol index → false "added
  identifier not found in symbol index" warnings. Reported incidence: **8/14 stage-1 rollouts**,
  including `Promise` and even `You` `[box — re-verify]`.
- `harness/rt-shim-runtime.mjs:156-167` `[verified]`: when a warning exists, the **authority
  banner is REPLACED** (`head = identifierWarning ? '' : buildAuthorityBanner()`), and the
  warning renders as the **final** line of the output. So any `run_tests | tail` keeps the false
  warning and **drops the authoritative verdict + baseline-diff**. All six of the variant's
  thelounge test runs were piped through `tail` `[box — re-verify]`. Control dismissed the
  warning once; the variant engaged with it 7×, flip-flopped its implementation to silence it,
  flipped back because the issue text demanded promises, and re-tested each time.

**Fixes, in order:**
1. Suppress warnings for identifiers that are **runtime globals of the diff's language** — or
   better, an index-aware existence check before warning. (The repo's own rule applies to the
   harness too: shape/index-aware checks over growing stopword lists — `DIFF_IDENTIFIER_KEYWORDS`
   is already at the edge of that anti-pattern.)
2. **Never displace the authority banner.** Render verdict + baseline-diff in the FINAL lines of
   run_tests output (tail-safe ordering); warnings go above, not below.
3. These files were effectively frozen — this needs the same **explicit reopen** the frame clause
   got, then a **green-ledger re-sweep** (harness change ⇒ configHash change ⇒ gold re-grade) and
   a disclosed comparability break, exactly like the offline frame.

## 2. Phase 0b — $0 forensics before building anything

1. Re-derive the Codex box measurements (timing test, warning incidence, thelounge anatomy) from
   the te-s1 DBs — commands in `TURN-ECONOMY-HANDOFF.md` §8.2-8.3.
2. **Retro-fit the progress ledger** (§3) over the retired + stage-1 transcripts: does
   "2 consecutive non-improving edit/test cycles" predict eventual failure with ~100% precision?
   Calibrate thresholds on data before shipping the controller.
3. **Retro-simulate a p75 turn budget** on the retired run's rows: how many tail dollars would it
   have censored, at what solve cost? (More-with-Less transfer check — Grok is in nobody's
   published ablation.)
4. Measure the search→read server-side collapse potential (`TURN_FIX_PLAN.md` §2.3).

## 3. The progress controller (S-harness, arm-symmetric)

Track per edit/test cycle, from **external state only**:
- diff hash of the working tree
- normalized failure-set signature (`extractFailureSignatures` already exists in the shim)
- new-vs-baseline failure classification (baseline-diff machinery exists)
- targeted-test/build status
- **best-so-far checkpoint**: the patch whose failure set is minimal, retained with its signature

**Progress** := fewer new failures | a previously-failing relevant test now passes | build
advances to a later failure | first run of a genuinely new diagnostic. Model confidence never
counts.

**Policy (footer text appended to run_tests output — the per-cycle channel we control):**
1. After **2 consecutive non-improving cycles**: append a compact state footer — unchanged
   failure set, current-vs-best patch status, "no observed improvement" — and permit ONE recovery
   step (a diagnostic batch or a fresh-context patch review). Discourage a third blind edit.
2. After a **3rd non-improving cycle**: instruct restore/submit of the **best checkpoint**, not
   the latest patch. Never kill a session in a way that loses a previously-working solution.
3. Once relevant tests pass with only baseline failures: allow exactly **one bounded
   edge-case/contract review**; if it finds no concrete missing requirement, submit. (Stops the
   corrupt-your-own-gold-patch failure mode.)

**Precision rule:** deterministic external-state definitions only; no semantic/LLM judging of
stuckness. Start advisory (footer text), measure compliance, only then consider enforcement.

**Grading-safe checkpoint measurement first:** before making "submit best checkpoint" a harness
*policy*, record BOTH final and best-checkpoint patches in preds and grade both offline on dev —
if best-checkpoint grading flips tasks, that quantifies the prize without changing bench
semantics prematurely.

## 4. Budgets and quotas (S-harness, arm-symmetric)

- **Turn budget** at the backbone's p75 of the *re-baselined dev* turn distribution, delivered
  with a **per-cycle countdown reminder** in the run_tests footer (the reminder is the mechanism
  `[paper detail]`). Dynamic extension granted only when the §3 ledger shows progress (staged
  budgets `[paper: More-with-Less]`).
- **Test-run quota** K with "unused budget is wasted" framing — composes with the existing
  run_tests dedup (dedup kills *identical* repeats; the quota prices *non-identical but
  uninformative* repeats).
- **Parse/lint pre-gate in the shim**: if the diff fails parse/lint for changed files, return the
  lint error fast **without burning a suite run** (adapts SWE-agent's gate to our surface —
  deterministic, cheap, symmetric).
- Denominate budgets in **cycles, not wall-time** (30-min wall × slow-suite interaction).
- Honest bounds: all the budget numbers are SWE-bench-Verified numbers on other backbones —
  Phase 0b.3 re-proves the shape on our dev tasks before anything gates.

## 5. Prompt residue (S-prompt, sweet M± — small, adjunct)

- **Re-anchor clause** (repair-scoped): "a failed test after an edit is new information — re-read
  the failing span or run one targeted probe before the next edit." Wording must not induce
  premature give-up on FIX tasks (known over-stop history): frame as *change information before
  changing code again*, never "stop".
- **Stop-when-green**: "once the previously-failing tests pass and only baseline failures remain,
  stop editing; one bounded review, then submit."
- Caveat from the timing data: the variant retrieved MORE during repair and still thrashed — so
  prompt-side retrieval nudges are adjunct; the controller (§3) is the primary medicine for
  oscillation-type thrash.

## 6. Wave 2 (optional): `apply_patch_and_test`

Atomic composite tool: apply patch → run targeted tests **sequentially inside one tool
execution**. Safely reaches the 292 edit→run_tests collapsible pairs that co-issued calls cannot
(OpenCode 1.18.4 has no in-message serialization barrier — verified in the handoff). Must ship to
BOTH arms; changes the "stock harness" claim and run comparability → separate decision, default
OFF for the paper's headline comparison.

## 7. Experiment design

Second factor of the 2×2 in `TURN_FIX_PLAN.md` §4 (batching × controller), 12-20 dev pairs after
re-baseline. Expected effect class for the controller: 15-60% on tail-heavy tasks `[papers]` —
visible at this n, unlike the 3-8% prose effects. Predeclared: cost-per-correct-solve primary,
solve non-inferiority, two-sided operations gate, escape=0, robust per-pair estimator, seeds.
Enrich the pair set with known thrash-prone tasks (they carry the cost mass), and report
tail-task and non-tail strata separately. Dev only; heldout-2 stays frozen.

## 8. Kill criteria

- Controller: if Phase 0b.2 retro-fit shows <95% precision for the 2-cycle rule on dev history,
  recalibrate or abandon enforcement (advisory footer may stay).
- Budgets: if the Phase 0b.3 retro-sim shows solve losses beyond non-inferiority margin at p75,
  do not ship a hard cap; ship countdown-only.
- Prompt residue: mechanism-gated like everything else — if repair-phase behavior doesn't move in
  a 3-5 task smoke, drop it.

## 9. Constraints in force

Identical to `TURN_FIX_PLAN.md` §10 — dev-only, green ledger after any harness change, explicit
reopen for shim/condenser edits, arm symmetry for every S-harness feature, one run-pilot process,
production M± untouched until gated evidence exists.
