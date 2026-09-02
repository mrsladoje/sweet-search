# Register reader — turn-economy group

The turn-economy program tested nine cost mechanisms on the Grok-4.5 backbone and one on Luna.
One lever shipped (run-tests long-yield). Every other cooperation-dependent lever failed because
Grok-4.5 ignores mid-task instructions in three separate channels. Every structural (no-cooperation)
lever failed an economics or exposure gate. This document lists every lever found in the eleven
source files, tags it against the draft register, and lists open threads the program named but
never ran.

All facts below are [M] measured from the ten source documents (paths given per row) unless marked
[C] (read from code) or [I] (inferred). No paid runs occurred while producing this document — all
work is reading existing result files.

## Register rows

### A1 — prompt-steered call packing (draft match, correction)

- Family: turn-economy
- Verdict: DEAD
- Killing fact: three separate tests, not one. (1) `TURN-ECONOMY-2026-07-30.md` §4.0d, Stage 1 (7
  dev tasks, 14 rollouts): ctx/turn ratio 1.138 with 95% CI [1.034, 1.260] excluding 1.0 — turns got
  WIDER, not fewer; cost rose 34.8%; solve identical 5/7 both arms. (2) `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md`
  §11: two ss-batch screens, $1.73 total, adoption 8/8 but 3/4 (screen e, hardened guard) to 4/4
  (screen c) dependency traps still packed under maximal instruction. (3) §20 of the same file: the
  underlying calls/turn gap (native 1.64 vs sweet 0.98) is a COUNTING ARTIFACT — OpenCode's own
  embedded system prompt already mandates parallel bash calls on both arms; native satisfies it with
  multiple tool-call ENVELOPES per message, sweet already satisfies it by `&&`/`;`-CHAINING 84% of
  its ss-bearing bash calls into one envelope. Op-level recount: 1.725 vs 1.883 ops/turn = 8.4%
  ceiling (not the 35.8% envelope-level gap). There is nothing left to pack that isn't already
  packed.
- Source: `TURN-ECONOMY-2026-07-30.md` §4.0c-d; `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §10-11,
  §19-20; `TURN_PACKING_FINAL.md` §0, §1.1, §1.5.
- Revival condition: a backbone trained for parallel emission (external evidence: training-time RL
  recipes teach it; inference-time instructions recover less — 2606.25447 up to 22.5pp gap;
  2608.01347 preregistered null p=1.0 on efficiency wording, the closest external analog).
- sweet_only: shared vehicle (AGENTS.md instruction reaches both arms in principle, but the
  mechanism target — sweet's bash-hidden ss-* chaining vs native's first-class tool envelopes — is
  sweet's own packaging, not a native lever).
- draft_row_id: A1
- correction_to_draft: draft's "DEAD ×4" line does not carry the counting-artifact finding (§20),
  which is the real closing argument — not "the model won't cooperate" but "there was never a real
  gap to close by cooperation; the gap was in how calls were counted." Add this as the primary
  killing fact, ahead of the instruction-deafness evidence.

### A2 — `ss-batch` structural packing CLI (draft match, minor correction)

- Family: turn-economy
- Verdict: DEAD
- Killing fact: screen c (original guard) 4/4 dependency traps packed with invented arguments;
  screen e (hardened explicit-argument-visibility guard + tolerant subset broker matching) still
  3/4 traps packed under a maximal "put exactly the requested 2-3 operations" instruction. $1.73
  total spend across both screens. Design-law conclusion (all three model reviewers): safe batching
  of dependent calls needs EXECUTOR-side reference resolution (LLMCompiler-style), not natural-
  language argument-provenance proof.
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §11; `TURN_PACKING_FINAL.md` §0 row 2, §1.9.
- Revival condition: per-backbone re-screen, ~$0.80.
- sweet_only: yes (a sweet-only CLI tool).
- draft_row_id: A2
- correction_to_draft: none material; draft is accurate. Add the $1.73/two-screen provenance and
  the LLMCompiler design-law framing for completeness.

### A3 — server-side search→read fusion, expanded into three named mechanisms

- Family: turn-economy
- Verdict: fusion-v1 RETIRED; fusion-v2 (Mechanism A/B/C) CLOSED standalone, PARKED as a paired
  design pending eviction
- Killing fact: fusion-v1 (top-1 cap raise 2000→8000) — live micro-smoke on read-heavy tasks showed
  IDENTICAL ss-call counts, cost, and solves (py-cov 39 v 35, cedar 24 v 21 calls) — top-1
  truncation was never why agents re-read. Retired per its own pre-registered arbiter.
  Fusion-v2 (server-resolved forward reference, `ss-search Q --then-read hit:1..2`): availability
  84.8% (467/551) — read target named in the immediately preceding search 84.8% of the time — but
  the ECONOMICS GATE is a conditional NO-GO: `net = p_hit·turnCost − R·(c_new + c_cached·T_remaining)`,
  bootstrap 90% LCB over 551 pairs: baseline top-1 net −$0.0097 (LCB −$0.0112, NO-GO), top-3 −$0.0070
  (LCB −$0.0085, NO-GO). p_hit@1=47.9%, @3=68.6%, @5=76.4%. R (payload size) median 994 tok, p90
  2893 tok; break-even span R_max1 = 1122 tokens — the median sits just under it, the mean (1348)
  and p90 (2893) sit over, and the fat tail drags net negative. The gate flips positive only under
  one of three riders: (1) eviction pairing, +$0.0064 mean / +$0.0060 LCB — "the clean flip" — but
  eviction (B1) itself failed its own Gate 0; (2) a hard span cap at the break-even point (~1122
  tok), an "optimistic" upper-bound flip that clips only the top quartile; (3) restricting fusion to
  late-session hops only (low turns-remaining), positive but leaves most of the pool unaddressed.
  Verdict: "DO NOT ship W1 fusion standalone" — build only span-capped AND paired with eviction, or
  not at all.
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §6, §16-17, §22-23; `TURN_PACKING_FINAL.md`
  §4, §1.9-1.10; `handoffs/lever3-eviction/GATE0-RESULTS.md` Gate 0c.
- Revival condition: a backbone with much longer trajectories (Trem drives the tax); or a shipped
  eviction mechanism, which has none currently (see B1).
- sweet_only: yes (server-side, sweet's own retrieval product).
- draft_row_id: A3
- correction_to_draft: draft's one line ("v2: standalone net-negative … positive only as a rider on
  eviction") is directionally correct but collapses three distinct mechanisms (A/B/C) and the actual
  numbers (p_hit, R, LCBs, the 1122-token break-even span, the two non-eviction riders) into a
  single sentence. The span-cap and late-hop-only riders are real, cheap alternatives that were
  never explored further — flagged as an open thread below.

### A4 — MCP as the packing vehicle (draft match, one addition)

- Family: turn-economy
- Verdict: OWNER-EXCLUDED, UNBENCHMARKED (unchanged)
- Killing fact: scoped out 2026-07-31 by explicit user decision, bash/CLI surface only for this
  program. `TURN_PACKING_FINAL.md` records the queued but never-run isolation test: "mimic
  OpenCode's batch wording in frame, or expose ss-* as first-class tools (MCP path)" — gated on
  W0.c chain-rework materiality, which was never measured (W0.c was never completed; §23 closes out
  W0.a/b but not W0.c). This is the origin of the still-open opencode +3.4-request MCP-motivation
  line in BRIEF.md §1.1.
- Source: `TURN_FIX_PLAN.md` §4.1, §12; `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §19 (native
  1.64 vs sweet 0.98 calls/turn explained by first-class-tool parallel dispatch); `TURN_PACKING_FINAL.md`
  §0 row 5, §3 (W0.c).
- Revival condition: user decision; W0.c chain-rework census (never run).
- sweet_only: unknown/design-dependent.
- draft_row_id: A4
- correction_to_draft: draft cites the same owner exclusion; add that W0.c (the chain-rework count
  that was supposed to gate a possible MCP isolation test) was pre-registered in `TURN_PACKING_FINAL.md`
  §3 but never executed in any of these 11 documents — this is an open thread, not a closed one.

### A5 — hard turn cap (draft match, add numbers)

- Family: turn-economy
- Verdict: REJECTED / NULL
- Killing fact: capped cell FINAL (35/36 pairs, 2 reps, ~$25.5, `SS_HARD_TURN_CAP=44`, pooled p90
  over moq-free rollouts): cost ratio sweet-capped/native-capped 1.047 (slightly WORSE, not better);
  sweet-capped vs sweet-uncapped on the same 18 tasks was FLAT (cost $6.75 vs $6.72); solve dropped
  on the one task that reached the cap (raml 0/2 capped vs solved uncapped). Retro preflight showed
  the cap's entire apparent saving (up to 65% of ledger cost at p75) came from cutting exactly the
  deep moq-class tails that were separately excluded from this cohort by standing instruction — "the
  cap is a null treatment on a tail-free cohort, with a real casualty risk when it does bind." p75
  caps independently fail solve non-inferiority outright (6 solved rollouts cut).
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §13-14.2.
- Revival condition: a headline comparison run WITH moq-class deep-tail tasks explicitly in scope,
  capped, both arms, same numeric cap.
- sweet_only: no — arm-symmetric harness-level lever by design.
- draft_row_id: A5
- correction_to_draft: draft's summary ("p75 kills 6 solved rollouts; capped cell null on cost") is
  correct but omits the cap=44 (~p90) full result, which is the actual final measurement (p75 was
  rejected before the cell was even run). Replace with the cap=44 numbers above.

### A6 — mid-task advisories / footer nudges / stall controller (draft match, major expansion)

- Family: turn-economy
- Verdict: REFUTED (compliance), but the story has three acts, not one
- Killing fact: Act 1 — the T1 footer cell's headline win (−36.8% cost, +1 solve vs untreated sweet)
  was a REVERSAL: ledger forensics over 21 sessions / 94 invocations showed `guidance = 'none'` on
  EVERY invocation — the advisory never rendered; the model never saw it; the "win" was pure
  run-to-run variance at an accidentally-identical config (an A/A test), caused by two implementation
  gaps (moq's untrusted baseline paused the streak counter; no pass-state/stop-when-green branch
  existed). Act 2 — after fixing both gaps (controller v2), the exposure replay showed v2 WOULD have
  fired 10/19 times, and the first live smoke (4 tasks × 2 reps) showed the mechanism PROVEN: bfgroup
  rep1 finished at 32 calls vs 59 in the un-advised run (−46%) after seeing the advisory render. Act
  3 — a sentence-rendered version (imperative text instead of a bare token) was tested next and
  compliance was REFUTED: bfgroup received the imperative FIVE times and produced its LONGEST grind
  ever (62 calls/$1.72, worse than every prior variant); stingray edited after being told to submit.
  This is the third of three independently-observed channels (memory-file packing prose, tool-
  description dependency guard, tool-output imperative advisory) where Grok-4.5 ignores mid-task
  behavioral instructions — the paper concludes this is a backbone property, not a wording
  deficiency, and treats the wording-iteration curve as exhausted.
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §12-12.5.
- Revival condition: none on Grok-4.5; a backbone change.
- sweet_only: yes (sweet arm only received the controller).
- draft_row_id: A6
- correction_to_draft: draft's "footer 'win' was an accidental A/A" captures only Act 1. Add Acts 2
  and 3 — a controller that DID render and DID demonstrably change behavior once (bfgroup −46%),
  before failing again under a stronger rendering. The full story is stronger evidence for backbone-
  level instruction-deafness than the draft's one-liner, because it rules out "the advisory never
  rendered" as the reason for the final null.

### A7 — thrash levers T1/T2/T3 (draft match, add spend-distribution finding)

- Family: turn-economy
- Verdict: DEAD (NO-GO ×3)
- Killing fact: matches draft — oracle ceiling 13.4% (run1) / 13.3% (screen18) already below the
  15% pre-registered bar before any trigger exists; every FP=0 combination across 32 threshold/
  variant combinations on 2 independent runs recovers ≤4.3% (run1) / 0.0% (screen18); every
  combination that clears 15% costs up to 25/34 solved trajectories. New finding not in the draft:
  the follow-up spend-distribution census (`thrash-census.mjs --mode spend`) shows FAILED and
  SOLVED trajectories spend money in the SAME proportions, in the SAME phases (explore 45-51%,
  repair 49-56%), at the same $/turn — "a doomed trajectory is not a productive one plus waste; it
  is the same process that arrived at a wrong answer." This is registered as the cost-side mechanical
  confirmation of the arm-universal wrong-fix floor (project memory `resolution-floor`): no progress-
  based detector can separate the two populations because on every spend axis measured they are
  identical.
- Source: `handoffs/lever-thrash/RUN-LEDGER-THRASH.md`.
- Revival condition: a backbone that runs to a turn cap or loops after going doomed (this backbone's
  self-termination ~1-2 turns after last progress is a specific, falsifiable property).
- sweet_only: no — measured on both arms, near-identical shape.
- draft_row_id: A7
- correction_to_draft: add the spend-distribution finding (no waste signature exists; failed and
  solved trajectories are statistically the same population on every spend axis) as new supporting
  evidence, and the mechanical reproduction of the poll-share drop (11.2%→2.4% of failed-task spend)
  as an independent confirmation of A9's shipped result.

### A8 — checkpoint-on-green (draft match, minor expansion)

- Family: turn-economy
- Verdict: NO-GO
- Killing fact: matches draft. Three independent gates: Gate 0a — on 6/6 probed tasks the gold
  patch produces the SAME `run_tests` verdict as an empty patch; "green" carries zero correctness
  information about the hidden target test. Gate 0 (exposure) — 0 triggers in 119 cleanly-joined
  rollouts (the "reached green then edited past it and submitted a worse state" shape never occurs);
  95% upper bound on trigger rate 2.5%, requiring ~2,400 rollouts before the safety gate is even
  evaluable. Gate 0c (selector safety) — 2 grader regressions in 5 graded reconstructed exposures
  (40%), including a case where the checkpoint selector would have frozen a HALF-FINISHED refactor
  failing all 8 pass-to-pass tests, which the agent then correctly went on to repair. New finding not
  in draft: the flagship motivating anecdote (`underscore-2757`) was reclassified on replay — it was
  never a "corrupted checkpoint" case; the failing rep never touched the second required function
  (`countBy`) at all, an incompleteness failure, not oscillation-then-corruption.
- Source: `handoffs/lever2-checkpoint/RESULT-CHECKPOINT-ON-GREEN.md`.
- Revival condition: trigger rate clears ~5% on a future backbone/cohort.
- sweet_only: no — arm-symmetric harness feature.
- draft_row_id: A8
- correction_to_draft: add the flagship-anecdote reclassification (underscore-2757 is
  incompleteness, not checkpoint corruption) as a correction of record the source itself makes
  against `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §24.3.

### A9 — `run_tests` long-yield poll fix (draft match, add scale confirmation)

- Family: turn-economy
- Verdict: SHIPPED
- Killing fact: matches draft. Root cause: codex's `exec_command` yields after 1s while the shim is
  still running, forcing 1-N polling `write_stdin` calls; fix sets a 300s yield so the call returns
  complete in one shot. $0 gate: poll turns were 23.1% of all model requests, 15.9% of ideal spend,
  symmetric across arms (native 16.2%/sweet 15.6% — harness-wide waste, not sweet-specific). Live
  confirm: −62% poll turns on first smoke (3 tasks), −93% on rotation to fresh tasks (statamic/
  oceanparcels/mransan), combined −71% across 6 tasks/24 rollouts. 18-task screen at scale confirmed
  −53% relative poll rate reduction (23.1%→10.8%) with every 2/2-solved task in run1 holding 1/1 in
  BOTH arms post-treatment — zero solve regressions from run1 baseline to shipped config.
- Source: `OVERNIGHT-LOOP-2026-08-07.md` (full ledger).
- Revival condition: none — shipped and gated on (not silently defaulted).
- sweet_only: no — arm-symmetric.
- draft_row_id: A9
- correction_to_draft: none material; the 18-task screen confirmation numbers are worth adding as
  the final-scale evidence (draft just says SHIPPED with no scale confirmation cited).

### A10/A11 — D2 terminal verdict; poll via prompt (draft match)

- No new evidence found in these 11 documents beyond what the draft already cites (`D2-DEPLOYED-RESULTS.md`,
  `SLATE-B-UBER.md` §8). No correction.

### NEW-1 — `ss-read` truncation and arg-semantics friction ("P" lever)

- Family: edit-mechanics / retrieval-index
- Verdict: SHIPPED (as a targeted micro-smoke win, −16% cost, solves held) — but the underlying
  product defects it targets are only partially covered by the later index-hygiene fixes (E1/E2 in
  the draft register); this specific lever is NOT the same mechanism.
- Killing fact: cost-thrash forensics (`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §18) traced the
  four costliest failed rollouts and found a cross-cutting sweet-only product bug in 3 of 4: (a)
  chained multi-file `ss-read`s in one bash call silently TRUNCATE the combined output, so a later
  file goes unseen and the agent blind-edits (kompendium-208, call 6); (b) `ss-read`'s (start,count)
  argument semantics FLIP between count and end depending on end<start vs end>start, so the agent
  cannot predict slice size (registry-994); (c) `# unread below` pagination trailers are left
  unfollowed, leaving files partially read (registry, b2-259). A targeted micro-smoke of
  `SS_READ_LINENUMS` plus these fixes ("P") scored a clean −16% cost win with solves held
  (`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §19). Note the stacked P+V3 combination (see NEW-2)
  regressed kompendium's solve twice (§19, §21 "Wave thrash"), so "P-alone" was the recommended safe
  champion, not the stack — and no confirmation that P-alone was independently screened at scale
  before the program pivoted to the Luna backbone.
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §18, §18.1, §19, §21.
- Revival condition: this lever's specific fixes (chained-read truncation, arg-semantics
  determinism, harder pagination-trailer surfacing) are candidates for a fresh $0 audit against the
  CURRENT `ss-read` implementation — status as of this document's writing is unverified; the
  register should flag whether E1/E2 (36b802e, fb9f936, 1a00765 — index hygiene/ENOENT/banner fixes)
  actually cover this, since they target a different defect class (index coverage, not read
  truncation/arg semantics).
- sweet_only: yes (sweet-only product surface).
- draft_row_id: none — new lever, not currently in the draft register. Nearest existing rows are E2
  (`ss-*` hygiene package) and C4/C9 (gutter/truncation), but neither names chained-read truncation
  or the count/end argument-semantics flip specifically.

### NEW-2 — V3 "exemplar-stop" retrieval-discipline clause

- Family: prompt-guide
- Verdict: DEAD as a standalone win on rotation (overfit to tuning tasks); DEAD in combination with
  NEW-1 (regresses a solve)
- Killing fact: alone, on the 6 tuning tasks, V3 ("once you have 1-2 exemplars of a pattern, stop
  reading siblings and start writing") scored a clean −13% cost win with solves held
  (`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §19). On the overnight generalization loop's 18-task
  V2 screen it contributed to a −15% cost / +1 solve joint win. But on 6 FRESH never-tuned tasks
  (`§21` Wave gen) the champion (P+V3) was cost-NEUTRAL after removing a cap confound — "the tuning-
  task wins went NEUTRAL on rotation: they were partly overfit to the six tuning tasks." Combined
  with NEW-1 (P), V3's "stop reading siblings" instruction consistently regressed kompendium's solve
  (1/2→0/2) TWICE, independently, in two separate waves (STACK and "Wave thrash") — V3 cuts off a
  multi-file fix before the agent reads a needed sibling. A fourth wave (V4, V3 + an explicit
  "read-the-pack" clause) offset the regression on kompendium but fixed no other failure and showed
  no cost win once cap-confounding was removed.
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §18.1, §19, §19.1, §21 (Wave gen/thrash/v4),
  §21.X.
- Revival condition: none identified — the program's own synthesis (§21.X point 2) recommends
  "P-alone, or V3+read-the-pack, NOT bare P+V3" as the only safe combination, but this was never run
  as its own screen before the program pivoted away from prompt/format levers toward the Luna
  backbone and the thrash program.
- sweet_only: yes (M± / memory-file content).
- draft_row_id: none — nearest is F8 (general engineering clauses, DEAD) but F8's killing fact
  (153 rollouts, every condition 3/8, originating signal reverses) is about family-completeness/
  minimal-change/symmetry clauses, a different content family from V3's retrieval-stop instruction.
  This should be a distinct row, not merged into F8.

### NEW-3 — commitment-quality / fix-shape discipline prompts (V1, V2 from §15)

- Family: prompt-guide
- Verdict: PARKED (positive micro-smoke, never advanced)
- Killing fact: solve-divergence forensics (`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §15) traced
  all three of the capped cell's solve losses to two mechanisms: (raml) a failed rep skipped
  `ss-trace` and shotgun-edited 5 files, or made zero edits in 31 read-only calls; (express) the
  agent declared its fix shape BEFORE gathering evidence and searched only to rubber-stamp it,
  shipping the wrong contract shape (callback vs Promise) though its own tests passed. Two targeted
  system-prompt-level (not mid-task) variants were micro-smoked, 2 reps each on 4 tasks, $4.96 total:
  V1 (persistence + plan/reflect, GPT-4.1-sourced) flipped raml 0/2→2/2; V2 (locate-vs-design
  carve-out + repo-convention check + trace-before-multi-file-edit) delivered express's FIRST sweet
  solve in its 0-for-3 lifetime (1/2) and also partially flipped raml (1/2). Both controls
  (tablib, camel-k) stayed 2/2 throughout — no control regression. This is presented as the deep
  answer to "why doesn't sweet solve more": commitment quality after correct retrieval is the
  failure site, not localization, and system-prompt-level (persistent) guidance is a channel Grok
  DOES respond to — unlike the mid-task channels killed in A1/A6.
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §15, §15.1, §15.2.
- Revival condition: the source itself lays out the next ladder rungs — (1) migrate V1's content
  into the shared FRAME (arm-symmetric, since it is bench-general per the M±-generality rule); (2)
  advance V2 (bench-agnostic wording) to a full 18-task screen; (3) a V1+V2 combined cell; (4) a
  screen winner faces CONFIRM-28. None of these rungs appear completed in any of the 11 source
  documents — this is a genuinely open thread.
- sweet_only: V2 is sweet-only M± content; V1 was recommended for the shared FRAME (arm-symmetric,
  zero differential per the BRIEF's differential rule).
- draft_row_id: none — this is a resolution-quality lever discovered inside the turn-economy program
  and does not appear in the draft's F-family (resolution/verification) rows either. Nearest is F16
  (zero-edit floor DEAD, a different mechanism) — not the same lever.

### NEW-4 — Luna/cheap-backbone pricing as a structural cost-lever substitute (W3)

- Family: other (backbone/pricing)
- Verdict: SHIPPED operationally (superseded the question), OWNER-EXCLUDED as a benchmark claim at
  the time it was probed
- Killing fact: a 3-task Luna capability probe on OpenCode (contradicting the GPT→codex routing
  policy in force at the time) scored 3/3 solved at 9-45× cheaper per solved task than Grok-4.5
  (cccl $0.0052 vs $0.122; camel-k $0.0046 vs $0.042; tablib $0.0039 vs $0.175) with the SAME
  ~1-call/turn habit (Luna does not parallelize bash either — this confirms the turn-structure gap
  is backbone-independent, not fixable by switching model). At Luna's $0.10/M input rate the
  re-send tax the whole turn-economy program was built to attack becomes "financially negligible…
  this entire program is nearly moot." A follow-up 18-task Luna rotation run (proper codex harness,
  per policy) reproduced solve parity questions unrelated to turn economy (see teleport finding,
  NEW-5) but did not revisit the turn-structure question, since it was already deprioritized.
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §14, §14.1, §14.2 ("PROGRAM VERDICT");
  BRIEF.md §1 (confirms the shipped backbone is `openai/gpt-5.6-luna` via OpenRouter for all later
  slates).
- Revival condition: none needed — this is now the standing backbone per BRIEF.md, so the original
  turn-economy cost-gap-closing motivation is moot on the current backbone; register this
  explicitly so a future reader does not re-open the Grok-4.5 turn-economy questions against the
  wrong backbone.
- sweet_only: no — backbone choice affects both arms equally.
- draft_row_id: none — not present anywhere in the draft register, despite being the program's own
  stated resolution ("PROGRAM VERDICT on Grok-4.5 turn-economy levers, all tested… Remaining paths:
  (a) Luna-class pricing makes the re-send tax financially irrelevant").

### NEW-5 — Teleport retrieval-completeness (usage/call-site starvation) finding

- Family: retrieval-index
- Verdict: OPEN, checked and found RARE (1 of 3 divergent cases; not a systematic driver)
- Killing fact: on the Luna 18-task rotation, the ONLY consistent (2/2) sweet-vs-native divergence
  was `teleport`: both arms patched the same file and location, differing only in whether the
  dedup check kept a `fileType` conjunct (`existingFile.fileType === file.fileType`). Native's
  retrieved context contained the string `fileType` 39 times (grep flooded every usage); sweet's
  contained it once (only the interface declaration). Hypothesis: sweet's ranked/diet span
  surfacing gets the edit LOCATION right but starves the model of the redundant USAGE signal that
  disambiguates a repair. Checked against the OTHER two divergent tasks in the same run
  (underscore-2757, gradethis-161): NEITHER fits the pattern — both had rich, adequate context in
  BOTH arms, and the failure was generation/coherence variance on a complex change, not retrieval
  starvation. Verdict: "retrieval-completeness is a REAL but RARE failure mode — 1 supporting case
  out of 3 divergences… DO NOT build the call-site-surfacing lever on this evidence (n=1 task)."
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §24.2-24.3.
- Revival condition: "a cohort of sweet-CONSISTENT (0/2) failures" beyond teleport — this run
  produced only one such case, so the systematic-mechanism question stays open.
- sweet_only: yes (a sweet-side ranking/diet property).
- draft_row_id: none directly, though B9 (completeness card, DEAD) is the follow-up attempt to build
  a lever from this exact finding — teleport is B9's flagship example, and B9's own gate
  disqualified teleport as an incompleteness case at all (see NEW-6 below). Cross-reference B9.

### NEW-6 — correction to B9 (bounded repair-completeness card): teleport disqualified twice over

- Family: context-mass (matches B9's family)
- Verdict: DEAD (unchanged from draft) — but the reasoning in the draft is incomplete
- Killing fact: draft B9 says "0-1 starved cases vs bar 2; missed siblings were already in context."
  The source document is more specific and different in a way worth correcting: teleport, the
  flagship motivating example for this whole lever, is DISQUALIFIED from the incompleteness pool
  entirely — it has exactly 1 FAIL_TO_PASS test, so `f2pFrac` is binary (0.00, both reps), which
  classes it as WRONG-FIX, not incompleteness, and wrong-fix is explicitly excluded as a lever-#4
  target by the handoff's own pre-registration. Separately, teleport's starvation claim is
  half-refuted even on its own terms: in sweet rep 0 the disambiguating token WAS present in context
  (1 occurrence) and the agent still matched on the wrong field. Of the 24 signature-A candidate
  tasks (edited a gold file, missed a sibling gold file), the ONLY case clearing conditions 1+2
  (fact absent, fact reachable) is `pennylane-3651`, and even it fails condition 3: the missing fact
  is an ABSENCE at the base commit (the gold patch adds `SpecialUnitary` to a file that never
  mentions it), and "a use-site card cannot surface an absence" — only a different mechanism
  (sibling-declaration enumeration across device classes) could, and building that from a single
  example would be overfitting. Strict count: 0 qualifying cases. Most generous count: 1. Bar: ≥2.
  11 of 16 full-context signature-A cases are plain generation-variance (the missed file was already
  read and the agent skipped it anyway) — "the same wrong-fix/variance floor that bounds every
  retrieval lever here."
- Source: `handoffs/lever4-completeness/RUN-LEDGER-COMPLETENESS.md` (full document).
- Revival condition: ≥2 independent RETRIEVAL-STARVED cases (fact absent + fact reachable + a
  nameable card field) on a fresh cohort, per the pre-registered bar — unchanged from draft.
- sweet_only: yes.
- draft_row_id: B9
- correction_to_draft: replace the killing fact with the specifics above — the draft's summary is
  correct in outcome but omits that the flagship example was itself disqualified as the wrong
  failure class entirely, which is the stronger and more instructive fact for a future reader
  tempted to revive this lever from the teleport anecdote.

### NEW-7 — resident-context eviction (B1 correction/expansion)

- Family: context-mass (matches draft B1)
- Verdict: DEAD (unchanged from draft) — mechanism and numbers should be corrected/expanded
- Killing fact: draft B1 states "32K cap −12.3%, 40K −15.1% net" without the mechanism. The full
  mechanism, worth preserving: prompt caching is a PREFIX cache; evicting oldest-first puts the hole
  near the conversation START, so the entire surviving suffix re-prices at the full (not cached)
  rate — 10× the cache-read rate on Luna ($0.10/M vs $0.01/M). This happens at every edit/test
  boundary (250 of 760 turns in the measured cohort). The bench's canonical `idealCost` metric is
  cache-NORMALIZED and is STRUCTURALLY BLIND to this — it scored the 32K cap at +7.7% (a win) while
  the break-priced NET column showed it actually loses 12.3%. This is registered as a standing
  methodology rule: "any lever that reorders or deletes context… MUST be read on a break-priced
  column, never on idealCost alone" — now shipped as `breakPricedCostUsd` (draft G2). Gate 0a also
  failed: the residual non-poll tool-body tail is only 10.2% of ideal spend (bar was ≥15%), because
  59% of the re-send tax is the FIXED PREAMBLE (18.0% of spend), which is un-evictable by
  construction — GPT's original 33.4% figure replicated in total but was misattributed as evictable.
- Source: `handoffs/lever3-eviction/GATE0-RESULTS.md` (full document).
- Revival condition: unchanged from draft — a backbone with substantially longer trajectories, read
  only on the NET/break-priced column.
- sweet_only: no — measured arm-symmetric (native 12.1% / sweet 8.0% of the un-evictable tail;
  sweet's tail is smaller because ss-* returns tighter payloads).
- draft_row_id: B1
- correction_to_draft: add the prefix-cache-break mechanism and the idealCost-blindness finding —
  this is arguably the single most reusable methodology finding in the whole turn-economy program
  and the draft's terse citation undersells it.

### NEW-8 — preamble/tool-doc trim (B2 correction, add untested quality hypothesis)

- Family: context-mass (matches draft B2)
- Verdict: CLOSED (unchanged from draft)
- Killing fact: matches draft's numbers (net saving 23 tokens = 0.07%, ceiling 74 tokens = 0.21%,
  both ~2 orders of magnitude below the ±37% noise floor). New detail not in draft: the trimmed
  variant (`sweet-search-system-prompt.trim1-tooldocs.md`) ADDED concrete usage examples to all six
  tools where the parent doc had signatures with placeholders and almost no concrete usage — this
  is kept as an untested tool-use QUALITY hypothesis (not a cost lever), explicitly never smoke-
  tested, and explicitly not claimed. Also: the guidance block (`## Fix discipline`) was
  deliberately excluded from this gate's scope by user authorization and remains byte-identical —
  only the tool-docs half (87% of the 1457 tokens) was in scope.
- Source: `handoffs/lever3-eviction/PREAMBLE-TRIM-GATE.md` (full document).
- Revival condition: via prompt-optimization process with a length term (unchanged from draft); the
  quality hypothesis (added examples improving tool use) needs its own solve-safety smoke,
  independent of any cost claim.
- sweet_only: yes.
- draft_row_id: B2
- correction_to_draft: add the untested tool-use-quality hypothesis (concrete examples added) as a
  parked, distinct candidate from the cost question — the draft's framing treats this gate as purely
  closed, but the source explicitly separates "cost lever: closed" from "quality hypothesis: kept,
  untested."

### NEW-9 — `run_tests` verdict-label defect (measurement fix, arm-symmetric)

- Family: measurement
- Verdict: SHIPPED
- Killing fact: across 326 `run_tests` calls in four Luna runs, 31% printed `status=FAIL` while the
  next line said `verdict=PASS` (later refined to a provable 15% mislabel rate; the rest were
  defensible non-zero-exit-with-real-error cases); 18% had an untrustworthy baseline; 9/18 tasks
  never emitted `status=PASS` at all under ANY patch (2 runners — yarp exit 145, polyfactory exit 4
  — were fully non-discriminative between empty/gold/broken patches). Repair shipped
  (`2b80ee3`): false-red rate went from 10.3%→0.0% (native) and 15.9%→0.0% (sweet); trustworthy-
  baseline coverage rose 83%→88%. Resolution stayed FLAT as designed (the repair is a truth-telling
  fix, not a capability change) — re-baseline showed native 10/17→9/17, sweet 7/17→6/17, both
  documented as known 1-of-2 coin-flip tasks, not a real regression (McNemar p=1.000 at n=17, zero
  power). This repair is also what retired the "circularity caveat" on the checkpoint-on-green
  exposure census (A8), since that census no longer reads the field this defect corrupted.
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §25 ("byproduct worth fixing"), §26 (repair
  shipped); `handoffs/lever2-checkpoint/RESULT-CHECKPOINT-ON-GREEN.md` §5.
- Revival condition: none — shipped.
- sweet_only: no — fully arm-symmetric, feeds both arms' footer.
- draft_row_id: none in the draft's G (measurement) section — this is a genuine gap; the draft's G1-G6
  rows cover ledger/accounting fixes but not this run-tests label defect. Should be added to family
  G in the merged register.

### NEW-10 — dev sample offline egress / model-cache blind spot (harness fix, arm-asymmetric symptom)

- Family: harness-adaptation
- Verdict: SHIPPED (partial), one item PENDING at time of writing
- Killing fact: a written `escape=0` gate had actually failed on polluted attempt counters, not
  agent misbehavior — sweet's own model-fetcher defaults to `hfEndpoint: https://huggingface.co` and
  the jail sets no offline flag, so ~231 connection attempts/task were DNS/TLS retries, not agent
  escapes; native's counterpart was npm-registry chatter from OpenCode itself. Root-causing this
  exposed that the box's model cache (`/root/.cache/sweet-search`) did not exist for part of a
  baseline window (likely erased by an Aug-1 disk-cleanup), meaning that baseline arm ran with a
  38.9s cold-start ss-search latency (vs 4.0s warm) and possibly degraded ranking. Shipped fix:
  `SWEET_SEARCH_OFFLINE=1` fails fast on a cache miss instead of attempting network revalidation
  (13/13 tests). PENDING at time of writing: wiring that env var into the jail itself and per-jail
  egress-log attribution, both flagged as needing the explicit frozen-surface unfreeze.
- Source: `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §1, §7, §9.
- Revival condition: n/a — the pending items are a to-do, not a gated hypothesis; flagged as an open
  thread below.
- sweet_only: the SYMPTOM (HF traffic) is sweet-only; the underlying jail-offline-flag gap and
  egress-log attribution issue are harness-level and affect measurement of both arms.
- draft_row_id: none — not present in the draft's harness-adaptation or measurement families.

## Open threads ($0 questions left unanswered or explicitly recommended but never run)

1. **W0.c chain-rework count** (`TURN_PACKING_FINAL.md` §3): counting `&&` short-circuit failures vs
   `;` blind-concatenation mis-attribution across the retired-run trajectories, explicitly gating a
   possible small MCP isolation test. Pre-registered, never executed in these 11 documents.
2. **Fusion-v2 non-eviction riders**: the span-cap-at-break-even (~1122 tokens) rider and the
   late-session-hops-only rider both flip the fusion economics gate positive WITHOUT needing
   eviction (which is dead). Neither was built or smoke-tested; the span cap was explicitly called
   "the safest near-term move… product-side, no frozen-surface change" but the program moved on to
   the Luna backbone before testing it.
3. **P-alone (NEW-1) as an independent screen**: recommended as the safe champion over the P+V3
   stack (which twice regressed kompendium), but no 18-task or larger screen of P in isolation
   appears in any of these 11 documents.
4. **V1/V2 commitment-quality prompts (NEW-3)**: micro-smoke flipped both raml (0/2→2/2) and express
   (0-for-3 lifetime→1/2) with controls intact. The source's own next-rung plan (migrate V1 to the
   shared FRAME; screen V2 at 18 tasks; combine; advance to CONFIRM-28) has no completion evidence
   in any of the eleven documents read for this task.
5. **The MCP first-class-tool test queued in `TURN_PACKING_FINAL.md` §19** ("mimic OpenCode's batch
   wording in frame, or expose ss-* as first-class tools") — never run; this is the origin of the
   opencode +3.4-request/calls-per-request driver named in BRIEF.md §1.1, so it may still be worth
   reopening under the current owner-exclusion rules (needs `needs_user_decision`).
6. **W4 (context eviction/compaction) revisit "after W1 resolves"** (`TURN_PACKING_FINAL.md` §6b) —
   W1 (fusion) never resolved to a build decision, so this revisit trigger never fired; W4 stays
   explicitly DEFERRED, not concluded, on the current backbone.
7. **Whether the current `ss-read` implementation still exhibits the chained-multi-file truncation
   and count/end argument-semantics flip** identified in NEW-1 — the later index-hygiene fixes
   (E1/E2 in the draft register) target a different defect class (index coverage, hygiene/ENOENT),
   and no document in this set confirms the read-truncation/arg-semantics defects were independently
   verified fixed or still present in the current codebase.
8. **Whether Luna's turn-structure gap (still ~1 call/turn, per the W3 probe) was ever formally
   re-measured on a larger cohort** — the 3-task capability probe and one 18-task rotation run both
   note the habit persists, but no document runs the packing/A6 tests against Luna specifically
   (they were only ever tested on Grok-4.5).
