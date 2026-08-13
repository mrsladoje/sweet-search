# TURN_PACKING_FINAL — consolidated close-out + the surviving structural program

**Status: DECISION DOC, 2026-08-06, rev 1.1.** Supersedes every packing thread in
`TURN_FIX_PLAN.md` rev 3. Rev 1.1 (same day) incorporates the GPT-5.6 read-only audit: three
blocking correctness fixes (§2 economics p_hit double-count; §1.12 retrieval-failure scope;
294 = multi-READ not multi-file, verified in `stats/search-read-replay.mjs`), literature claims
re-scoped to what the sources actually tested (§1.6-1.8), W1 turn-collapse mechanisms
disentangled from safety mechanisms (§4), shell-chain semantics corrected and all gates made
explicit and uncertainty-adjusted (§3).
Companion: `EDIT_THRASHING.md` rev 2 (the thrash program continues unchanged; referenced, not
duplicated here).

**Inputs.** `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` (§6, §10-§21); three independent model
reviews run 2026-08-06 on the same question (Fable 5 + 3-agent sourced literature sweep; Opus 5
economics review; GPT-5.6 Sol repo-grounded review); `TURN-ECONOMY-2026-07-30.md` (ops/turn
recount); the clean-baseline ledgers (18 pairs) and the 551-pair search→read replay cohort.

All three reviews independently converged: prompting/packing is closed; plan-forward prose is a
NO-GO; the surviving levers are server-side reference resolution (fusion-v2), failed-task thrash,
and measurement/caching hygiene. Divergences are recorded in §1.13 and §2.

---

## 0. One-table verdict

| Lever | Verdict | Basis |
|---|---|---|
| Prose packing prompts (incl. "plan forward then pack") | **CLOSED on Grok-4.5 — all tested surfaces; no new spend without a qualitatively new MECHANISM (a wording variant is not one)** | Primary: 4 internal nulls (inert prompt, unsafe ss-batch, 3-for-3 advisory, cap null) + prize below detection floor (§1.11). Supporting analogs, scoped in §1.6-1.8: efficiency-instruction null p=1.0 (2608.01347), harness-conditioning gap up to 22.5pp (2606.25447), adaptive>upfront retrieval in adjacent domains (IRCoT, FLARE) |
| ss-batch free-argument batching | **CLOSED on Grok-4.5** | 3/4 traps under hardened guard; dependent args require executor substitution (LLMCompiler 2312.04511). Re-screen per backbone allowed (~$0.80) |
| Mid-task advisory (any channel) | **CLOSED on Grok-4.5** | 3-for-3 channel-deaf (results §12.5) |
| Hard turn cap | **CLOSED except tail-inclusive cohorts** | capped cell NULL on cost, raml casualty (results §14.2) |
| MCP first-class exposure (same payloads) | Isolation test ONLY, gated on W0.c | envelope form = counting; CodeAct 2402.01030 (+20pp, ~2 fewer turns for code-style chains); Aider (function-call edits ≈ half plain-text); Terminal-Bench 2601.11868 (turns↔success uncorrelated) |
| **W0 — $0 trace/ledger studies** | **RUN FIRST** | they size every remaining prize before a dollar is spent |
| **W1 — fusion-v2 = reference-batching** | **BUILD on W0.b GO** | 97.9% of 551 search→read pairs intact (results §6); 294/551 envelopes multi-READ (distinct-file share = a W0.b measurement, §1.2b); census: NO shipped harness does this |
| ss-flow typed dependency plan | Design-only, gated on fusion-v2 handle adoption | LLMCompiler architecture; plan-emission quality unproven on this backbone |
| **W2 — failure-thrash program** | **THE MONEY — continues** | 72% of V2-screen sweet spend on failed rollouts (results §18); repair ≈80% of cost both arms |
| W0.d — cache stickiness / session id audit | $0, immediate | realized-cost only; idealCost is already cache-normalized |
| W3 — backbone pricing (Luna-class) | Open user decision | 9-45× cheaper per solved task (results §14.1); makes the re-send tax financially moot; routing-policy conflict (GPT→codex) |
| W4 — resident-context eviction/compaction | DEFERRED (§6b) | strongest external re-send lever (−84% tokens/+29% perf) but frozen-surface + both-arms + ledger re-sweep; revisit after W1 |

---

## 1. Settled facts — do not relitigate

1. **The calls/turn gap was a counting artifact.** Native emits parallel ENVELOPES (1.64/turn);
   sweet &&-chains OPS inside one bash envelope (0.98 envelopes/turn, 84% of ss-bearing calls
   chain 2+). Both satisfy the same OpenCode mandate (verified upstream: 14 model-family prompt
   files, all mandate parallel calls). Op-level recount: 1.725 vs 1.883 ops/turn = **8.4%
   op-level turn ceiling** (the envelope-level gap was −35.8%), measured on the RETIRED run
   (`TURN-ECONOMY-2026-07-30.md:352`).
2. **The clean-baseline op-level prize is UNKNOWN** (Sol's correction, accepted). 84% chain-rate
   does not establish zero headroom: ops-per-envelope distribution, eligible-sibling counts for
   single-op turns, argument availability at decision time, and the phase split of the +115 turns
   are all unmeasured on the clean 18 pairs. W0.a measures them. Expected outcome: small.
2b. **The "294/551 multi-file" claim is UNVERIFIED as stated — it is 294/551 multi-READ.**
   The replay counter (`auditCandidates` in `stats/search-read-replay.mjs`) increments when one
   envelope contains 2+ ss-read COMMANDS; it never checks that the paths are distinct files
   (verified 2026-08-06). Multi-range same-file reads may be coverable by wider top-1 spans;
   distinct-file reads need multi-file returns. W0.b measures the true distinct-file share.
3. **Width vs depth.** The right quantity is `actual model decision rounds − critical-path depth
   of the op dependency DAG`. Packing compresses width only. The residual turns are depth
   (search→read→edit). No client-side actor can compress depth; only the server can (fusion).
4. **Turn-cost asymmetry favors sweet per turn.** Context in/turn 44.1k vs 49.2k; growth 1.25k vs
   1.67k. The deficit is turn COUNT only (509 v 394). Width hypothesis REFUTED (results §10).
5. **Model-cooperation levers are dead on Grok-4.5** (internal): prompt packing density −5.4%;
   ss-batch traps 3/4 under maximal guard; advisory ignored 3-for-3 across channels; hard cap
   null-to-risky. One recorded confound (Sol): the hardened batch screen's "put exactly the
   requested 2-3 operations" sentence fought the dependency guard — logged for honesty; it does
   NOT reopen the lever (natural language cannot prove argument provenance).
6. **External evidence supports the training-side mechanism (supporting, not sealing).**
   Tool-use RL recipes are one-call-per-step (Search-R1 2503.09516; ReTool 2504.11536). One
   pipeline strips multi-call-per-turn examples from ONE multi-turn training subset
   (2606.00135) — a concrete mechanism for the habit; NOTE the same paper also finds
   task-relevant system-prompt instructions improve BFCL scores, so it evidences that data and
   serialization shape the habit, NOT that prompts can never move behavior. Moonshot named the
   untrained default "serial collapse" and fixed it with dedicated RL (K2.5 PARL); Windsurf
   TRAINED SWE-grep models for parallel retrieval; Cursor's Composer 2 report describes an RL
   efficiency penalty over tool tokens/calls/turns that teaches parallel calling. Pattern: when
   labs want parallel emission, they train for it.
7. **Inference-time instructions recover less than training-time conditioning (scoped).**
   Harness-conditioning study (2606.25447, ALFWorld-class environments where the harness also
   exposes feasible actions): training WITH a harness beats applying it only at inference by up
   to 22.5pp — supports training-time conditioning mattering; it is NOT a direct test of a
   packing instruction. Preregistered Aug-2026 study (2608.01347): efficiency/scope wording (not
   packing-specific) produced zero redundancy-metric change (p=1.0) across 6 models × 2
   harnesses; the authors limit claims to the tested formulations. This is the CLOSEST EXTERNAL
   ANALOG to our 3-for-3 null, not a replication of it. Contrast case: Claude reaches ~100%
   parallel compliance with Anthropic's documented prompt tag — a family trained on that
   instruction surface. Grok was not. Luna also ran ~1 call/turn.
8. **Adaptive/interleaved retrieval beats upfront in ADJACENT domains (direction, not proof).**
   IRCoT: +7.9-22.6 recall on multi-hop QA; FLARE: adaptive > fixed > upfront, and upfront
   (68.6) < NO retrieval (72.9) on StrategyQA. These are QA/long-form results, not code-repair
   tool scheduling; they establish the risk direction, not that sequential probing is THE
   optimum here — hybrid planned+iterative methods report gains over pure interleaving
   (PAR²-RAG 2603.29085, audit-supplied). The plan-forward-prose NO-GO therefore rests on:
   (i) no measured decision-time-independent headroom pending W0.a; (ii) the prize is below the
   detection floor (§1.11); (iii) internal evidence that upfront-listing pushes toward retrieval
   touring — our two costliest failure classes (registry/b2); (iv) accuracy is non-negotiable.
9. **Safe batching of dependent calls requires executor-side reference resolution.** LLMCompiler
   $N placeholders substituted by the executor after the prerequisite resolves; ReWOO's
   documented assume-unseen-content failure is exactly our trap behavior. Design law: the model
   is the semantic reasoner; the server is the scheduler and provenance authority (Sol).
10. **Fusion payloads must be span-precise, not fat.** SWE-agent ACI (2405.15793): capped
    summarized search 18.0% > no search 15.7% > uncapped iterative 12.0%; 100-line window beats
    whole-file. Internal analog: budget-pointer regression; rank-2/3 bodies sometimes
    load-bearing. Additive-only: never delete or re-rank existing evidence to pay for fusion.
11. **The noise floor closes width on measurement grounds alone.** ±37% aggregate cost at n=19;
    one tail task decides the sign (4 consecutive runs); REPS≥2 mandatory. A ~6-8% prize is
    below any affordable detection floor (Opus). Even a perfect packing treatment could not be
    confirmed.
12. **The money is failures, not turns — and retrieval splits in two.** 72% of V2-screen sweet
    spend on failed rollouts; repair ≈80% of cost on BOTH arms. Retrieval RANKING/quality is not
    the failure site (localization 2× faster: first edit step 8 vs 17.5; solve-gap forensics
    §15: retrieval perfect in all 3 divergent rollouts). Retrieval BEHAVIOR is: cost forensics
    §18 classifies registry-994 (sibling touring) and b2-259 (read-only paralysis) as
    retrieval-phase failures and kompendium-208 as read-tool friction — and §21 shows the
    touring class is not prompt-reachable. SWE-agent analog: failures 21 steps / successes 12.
13. **Divergences between the three reviews, resolved:** (a) "nothing left to pack" (Fable) was
    too strong → replaced by §1.2-1.3 and W0.a; (b) Opus's price coefficients ($5/$0.5/$30) do
    not match Grok list rates → §2 recomputes from the ledger; (c) Opus's "BFCL parallel far
    worse than single" is overstated (ToolACE table: parallel not uniformly worse) → dropped;
    (d) MCP: "counting-only" (Fable) vs "semantics could matter" (Sol) vs "chain-abort rework"
    (Opus) → unified as the W0.c/W0.a dual gate + W1 semantics (fusion IS the semantics upgrade,
    and it is transport-agnostic); (e) rev 1.1 audit corrections accepted: economics p_hit
    double-count, retrieval-claim scope (ranking vs behavior), 294 = multi-read not multi-file,
    `&&` vs `;` rework semantics, handles ≠ turn collapse, gates made explicit.

---

## 2. Economic model (recompute coefficients from the ledger before use)

Structure (Opus), coefficients TBD from real ledger prices + measured cache-read fractions:

- Cost of one extra model turn ≈ `W·c_cached + o·c_out` (W = resident context, o = output).
  At W≈44.1k this is $0.02-0.04/turn depending on true cached rate.
- Resident-token tax: injecting R result tokens with T turns remaining ≈ `R·(c_new + c_cached·T)`.
  A retrieval result is not paid once; it is re-sent every remaining turn.
- Break-even payload at certain hit (`p_hit`=1): `R_max1 ≈ turnCost / (c_new + c_cached·T)`.
  Illustrative at Opus's rates: R_max1 ≈ 2,267 tokens; at p_hit=0.3 the bound is ~680. Recompute
  with Grok list ($2/M in, $6/M out) + the ledger's per-turn `cached_tokens`.
- **DESIGN LAW:** any fused or speculative content must clear `R < p_hit · R_max1` — ONE
  multiplication by p_hit (rev 1.1 fix: the earlier draft defined R_max with p_hit inside and
  then multiplied by p_hit again, squaring the probability). The
  speculation literature (SPORK 2607.03333 etc.) discards wrong speculations; ours enter resident
  context and are re-sent forever. Our bar is strictly higher. Never skip the threshold.

---

## 3. W0 — $0 offline studies (run FIRST; no model calls)

Tools exist (`stats/search-read-replay.mjs`, `stats/edit-thrash-replay.mjs`). **Data caveat
(verified 2026-08-06):** the Mac's read-only copy of the box OpenCode DB was pulled 2026-08-03
and PREDATES the Aug-04 clean baseline; no local `results/turnfix-clean-baseline*` dirs exist.
W0.a therefore needs one fresh read-only box pull of the DB + clean-run ledgers first ($0 model
spend; a box copy operation). W0.b and W0.c run on the existing retired-run copy as-is. No HO2
paths (both replay tools enforce HO2-path refusal by construction).

**W0.a — op-level re-measure on the clean 18 pairs** (Sol). Parse every shell chain into
underlying ops → ops per assistant response (NOT per envelope). Classify each op's arguments:
(i) known before the response; (ii) mechanically derivable from another result (fusible);
(iii) semantically chosen after seeing another result (irreducible). Build the per-rollout
dependency DAG; compute `decision rounds − critical-path depth` = max removable turns. Decompose
the +115 turns by phase (locate / repair / test / zero-tool). Distinguish hindsight independence
(both arguments visible in the transcript) from decision-time independence (argument existed
BEFORE the response) — only the latter is packable, and it is what the trap screens measured.
**GATE (explicit):** compute the minimum detectable effect (MDE) for cost at REPS=2, n=18 from
the measured A/A variance (results §12.2) and publish it next to the result. Width is CLOSED
unless the BEST-CASE width saving (every decision-time-independent op merged, priced at the §2
recomputed turn cost) ≥ that MDE. Expected outcome: closed — the retired-run 8.4% op-level
ceiling is far below any MDE consistent with ±37% aggregate noise. Class-(ii) mass separately
sizes the fusion prize and feeds W1's budget.

**W0.b — fusion feasibility mining on the 551 search→read pairs** (Opus). Per pair measure:
(1) was the read target NAMED in the immediately preceding search result? If mostly no →
reference-following fusion is dead too; stop before building. (2) Rank of the target under a
simple resolver (top-1, top-3) → `p_hit`, taken as a conservative lower bound from backtest.
(3) Token size of the span the read actually consumed → `R`. (4) DISTINCT-FILE count per read
envelope — this resolves the §1.2b ambiguity (the 294/551 counter counted read COMMANDS, not
distinct files); same-file multi-range pairs score against wider-span fusion, distinct-file
pairs against multi-file fusion. Estimate the two W1 mechanisms separately: Mechanism A
(proactive span containment) and Mechanism B (inline forward-ref co-issue). The fusion-v1
lesson stands: agents were not truncated, they were hopping — score top-k and multi-target
resolution, not top-1 only. **GATE (explicit, uncertainty-adjusted):** W1 build authorized only
if the 90% lower confidence bound (bootstrap over pairs) of net expected saving —
`Σ p_hit·turnCost − E[R]·(c_new + c_cached·T̄)` with §2 ledger-derived coefficients — is > 0.
Else fusion closes and the cost story rests on W2+W3.

**W0.c — chain rework count** (Opus, semantics corrected rev 1.1). Two distinct classes:
class 1 — `&&` chains SHORT-CIRCUIT on failure, so the tail never runs and the next turn
re-issues it; class 2 — `;` chains always run every op but CONCATENATE outputs, producing
mis-attribution and the kompendium-style blind-edit path. Count both separately. This is the
honest first-class-exposure argument (independent failure + per-result separation).
**GATE (dual, revised per audit):** schedule a small MCP isolation test if W0.c rework is
material OR if W0.a surfaces decision-time-independent ops that schema envelopes might pack
where chains do not. Cost note: `mcp/server.js` already ships first-class `search`
(self-contained-block claim) and `read` (1-20 files) — the test is close to a harness-config
switch. Caveats: the MCP-variant prompt is UNBENCHMARKED, and the self-contained claim failed
strict payload containment on 97.9% of replayed pairs — the SEMANTICS need validating, not just
the envelope. If neither gate fires, close the envelope/MCP thread.

**W0.d — cache + request audit** (Sol). From the clean-run ledgers: actual cache-read fraction
per turn (fields already recorded in `opencode-task-runner.mjs` / `agent-runner-shared.mjs`).
Inspect one raw provider request: parallel tool calling enabled? all same-response tool results
returned in ONE message (Anthropic documents that splitting them teaches sequential behavior)?
conversation routing stable? Evaluate session stickiness (`prompt_cache_key` /
`x-grok-conv-id`) — the generated OpenCode config currently carries only the API key.
**NOTE:** any request-shape change alters the config fingerprint → green-ledger re-sweep +
frozen-surface reopen. Improves REALIZED cost only; idealCost is already cache-normalized.

---

## 4. W1 — fusion-v2 = reference-batching (build only on W0.b GO)

The unified design (all three reviews + SWE-agent constraint):

**Three mechanisms with explicit turn accounting (rev 1.1 — the earlier draft conflated them):**

- **Mechanism A — proactive bounded spans (TURN-COLLAPSING, zero cooperation).** Search returns
  owning-symbol / full-span content for the top 1-k hits within an explicit budget, span-precise
  (§1.10), ADDITIVE only — no deletion or re-ranking of rank-2/3 evidence. Collapses the hop
  exactly when the span covers what the read would have fetched. Sized by W0.b containment.
- **Mechanism B — inline forward-reference (TURN-COLLAPSING, adoption-dependent).** One command
  in one response co-issues search plus its dependent read via a server-resolved reference
  (shape: `ss-search Q --then-read hit:1..2`). The server executes the search, resolves the
  reference, and returns one labeled pack — the LLMCompiler $N substitution as a 2-node special
  case of ss-flow. The dependent argument never exists model-side; one model round total.
  Needs the model to USE the surface (ss-batch's 8/8 adoption says surfaces get adopted; the
  reference removes the unsafe degree of freedom that killed ss-batch).
- **Mechanism C — opaque handles for LATER reads (SAFETY/PRECISION, NOT turn-collapsing).** A
  handle consumed in the NEXT response is still a second model round. Its value is zero invented
  paths, exact spans, cheap request tokens. Ship it with A/B; never book it as turn reduction.

**Result framing (all mechanisms):** per-file labeled sections + explicit truncation/sufficiency
metadata (kills the silent chained-read truncation class); multi-target capable end-to-end
(294/551 envelopes are multi-READ; the distinct-file share W0.b measures decides how much
multi-FILE capability matters vs wider same-file spans).

**Read side:** accepts handles and multi-file requests natively; never silently truncates
(auto-split with loud per-file continuation markers); deterministic range semantics (line-number
+ range-arg fixes already shipped).

**ss-flow (typed dependency DAG, Sol's "executable plan"):** design document only. The full
generalization of Mechanism B (model emits a validated node/edge plan; server schedules,
resolves refs, rejects unresolved/invented arguments; returns one labeled evidence pack).
GATE to build: Mechanism B shows real live adoption AND removes hops on this backbone. Do not
build the general DAG before the 2-node case has evidence.

**Validation ladder (standing rules apply: REPS≥2, CONCURRENCY=1 for micro-cohorts, DEV only,
HO2 untouched until the end, green-ledger re-sweep on any harness change):**
1. $0 replay containment on the 551 cohort with fusion-v2 output. Explicit bar: ≥20% of
   decidable pairs eliminated-or-partial (fusion-v1 scored 0.5%). Below the bar → no paid
   smokes; return to design or close.
2. Micro-smoke on the read-heavy failure sites (kompendium, registry, b2) + controls (tablib,
   camel-k), 2 reps.
3. 18-task screen only on a target flip with controls intact.
**Metrics:** solves; ideal AND realized cost per assigned task; ACTUAL model turns; underlying
ops; context growth; search→read hops removed; zero invented refs/paths (hard gate). NEVER
envelope calls/turn.

---

## 5. W2 — failure-thrash program (the largest prize; owned by EDIT_THRASHING.md)

Pointer only; the structural (non-prompt) items in priority order: (1) checkpoint-on-green as a
HARNESS feature — freeze/grade the passing intermediate state so later self-corruption cannot
destroy it (py-cov self-revert class; Coherence Collapse 2603.24631: edit-checkpoint recovered
5/5); (2) py-cov false-pass grader/suite mismatch — a grading integrity item, not a prompt item;
(3) retrieval-tour class (registry/b2) — proven not prompt-reachable (results §21 waves thrash +
v4); candidate structural levers only; (4) baseline-trust repair for volatile suites (moq class).
Prompt levers remain valid ONLY for commitment-quality content at system-prompt level (V2
fix-shape class; safe champion forms: P-alone OR V3+read-the-pack — never bare P+V3).

---

## 6. W3 — backbone pricing (user decision, standing)

Luna probe: 3/3 solved, $0.0039-0.0052/task, 9-45× cheaper per solved task, same ~1 call/turn
habit — at that price the re-send tax is financially negligible and this entire program is
nearly moot. Conflict: multi-harness routing policy says GPT→codex; the probe ran on OpenCode.
Options: policy amendment, or a proper Luna/codex arm. Dev-iteration migration to a cheap
backbone remains the standing recommendation for micro-smokes.

---

## 6b. W4 — DEFERRED: resident-context eviction / compaction

The strongest external lever for the re-send tax is context editing: Anthropic measured −84%
tokens with +29% performance on 100-turn agents by evicting stale tool results (keep-last-N +
placeholder markers; server-side compaction variant exists). It is DEFERRED here, not adopted,
because on this bench it is a harness-loop change: OpenCode is pinned at 1.18.4 (frozen
surface), the change hits BOTH arms, it invalidates the ledger (fingerprint change → full
re-sweep), and its interaction with grading/trust signals is unstudied. Product-side partial
substitutes already shipped (result diet, span maps, within-file affordances). Revisit only
after W1 resolves, with its own pre-registered design. Recorded so the idea is not lost — it
was rank-3 in the unified lever table.

---

## 7. Paper obligations

1. Report **operations per assistant message** (parsed from chains), never tool-call envelopes.
   A reviewer will find the artifact otherwise.
2. The two-syntaxes finding is publishable color: two harness arms satisfying an IDENTICAL
   batching instruction in two syntaxes that score 1.7× apart on the naive metric.
3. Disclose the accidental A/A and the ±37% noise floor; REPS≥2 in every design.
4. The instruction-deafness result has a close external ANALOG (2608.01347) — cite it scoped to
   its tested formulations (efficiency/scope wording, not packing); do not call it a replication
   and don't claim novelty for the null.

---

## 8. Sequencing and budget

1. **Now:** W0.a-d, all $0, Mac-only. Order: W0.b first (it gates the only build), then W0.a,
   W0.c, W0.d.
2. **User decision point:** review W0 numbers → GO/NO-GO on W1 build; MCP isolation test only if
   W0.c is material; cache stickiness change only with fingerprint re-sweep accepted.
3. **On GO:** W1 ladder (replay $0 → micro-smoke ~$2-5 → screen ~$12).
4. **In parallel, independent:** W2 items via their own plan; W3 decision.
5. **Standing invariants:** no run without green ledger; DEV-RET only; HO2 once, aggregate-only,
   at the end; REPS≥2 everywhere; micro-cohorts CONCURRENCY=1.

**Closed list (final):** prose packing prompts + plan-forward prose planning — CLOSED on
Grok-4.5 across all tested surfaces; reopen only for a qualitatively new MECHANISM (an executor
surface like Mechanism B qualifies; a wording variant does not); ss-batch free-argument
batching on Grok-4.5 (re-screen $0.80 per NEW backbone only); mid-task advisory on Grok-4.5;
generic hard caps on tail-free cohorts; W&D-style width instructions (task-shape mismatch:
code repair has a narrow dependency frontier, and the calls-flat guard forbids the redundant
exploration that produced W&D's gains); MCP-for-packing absent a W0.c/W0.a gate signal.
