# TURN_FIX_PLAN — turn-economics fix, unified plan (2026-07-31)

Synthesized from three independent analyses of `TURN-ECONOMY-HANDOFF.md` and the stage-1 REVERT:
Claude Fable 5 (this session), GPT-5.6 Sol / Codex (ran box-side measurements), Kimi K3 Max
(Cursor). Best ideas merged; disagreements adjudicated in §1 and §8.

**Companion:** `EDIT_THRASHING.md` — the *larger* lever (completion-tail control). The two plans
share Phase 0 and the final 2×2 study. Read both before running anything.

**Evidence tags used throughout:**
- `[verified]` — checked in this repo/doc at the cited location during synthesis (2026-07-31)
- `[box — re-verify]` — measured by the Codex session on run artifacts; commands exist, numbers
  not yet independently re-derived
- `[paper]` — arXiv abstract verified; `[paper detail]` — full-text claim, spot-check before
  citing in anything published

---

## 0. The corrected problem statement

Operation-level accounting of the retired heldout-200 run (recomputed from the shared DB)
`[verified: TURN-ECONOMY-2026-07-30.md:350-364]`:

| arm | turns | envelopes | operations | ops/envelope | envelopes/turn | operations/turn |
|---|---|---|---|---|---|---|
| native | 5,003 | 9,248 | 9,419 | 1.02 | 1.848 | 1.883 |
| sweet | 5,908 | 7,009 | 10,193 | 1.45 | 1.186 | 1.725 |
| sweet vs native | +18.1% | — | +8.2% | — | −35.8% | **−8.4%** |

- **77% of the motivating 1.14-vs-1.76 headline was packaging artifact.** The real decomposition
  of sweet's +18.1% turn inflation: **~8.2pp more operations + ~9pp lower packing density**. Only
  the density half is a packing target.
- **Perfect packing ceiling ≈ 8.4% turn reduction** (10,193 ops at native's 1.883 ops/turn ≈
  5,414 turns vs 5,908). Prompt-reachable packing is worth low-single-digit % of cost — real, but
  secondary.
- **The tail owns the gap:** 8 tasks contributed +$16.70 = **107.2% of the whole-run cost gap**
  (the other 192 net-offset) `[verified: PLAN.md:426]`. → `EDIT_THRASHING.md` is the primary
  lever; this plan is the structural, secondary one.
- **Every pre-frame number is baseline-contaminated.** 9/10 smoke rollouts attempted upstream
  fetches; 13/16 native-only heldout wins were ground-truth-assisted (forensics). The offline
  frame clause (escape 265→0) changed both arms' economics. **No lever is sized or tuned against
  pre-frame numbers again; re-baseline first (Phase 2).**

## 1. Why the prompt-only lever failed — consolidated verdict

Seven stacked attenuations (any one sufficient to hide the effect; together overdetermined):

1. **Small target.** ~9pp density headroom, not the apparent 35.8% (accounting above).
2. **Wrong dialect.** The block taught `;`-fusion *inside one bash envelope*. The trained,
   provider-supported form is **multiple tool-call envelopes in one assistant message** —
   Anthropic documents steering this to ~100% when phrased as parallel *tool calls*; xAI ships
   `parallel_tool_calls` default-on; Grok already emitted 383 multi-bash-call messages in the
   sweet arm. Hiding `ss-*` inside bash denies the provider its trained structured-call surface.
3. **Wrong channel.** Persistent memory-file placement is the delivery W&D found inferior; the
   effective channel is **per-turn/per-step injection** `[paper: W&D 2602.07359; paper detail:
   per-turn > persistent; More-with-Less reminder ablation]`.
4. **Baseline already fused.** Sweet ran 1.45 ops/envelope with 2,746 multi-operation bash
   envelopes (native: 1,557) `[verified: design note §3.3]`; ~2.25 ops/search-envelope in
   stage 1. The easy half of packing was already happening.
5. **Confounded meter.** Edits contribute an envelope and zero operations, so edit surges fake
   packing changes. Canonical metric from now on: **operations per retrieval envelope**. The
   harness counter itself is prefix-anchored (`classifyShell`) and counts a fused chain as one
   call `[verified: design note §3.3(b)]` — fix the *analysis* meter (probe-count.mjs), never the
   frozen turn logs.
6. **Noise floor.** n=7 gives ±20% CIs; detectable-effect math: ~60 pairs for a true 10% effect,
   ~240 for 5%. **Only levers with expected effects ≥15-20% are testable at affordable n.**
7. **Smoke credit stolen by the frame.** The −32% smoke turns rode on 265 refused-fetch escapes
   that the offline clause then eliminated for free on both arms.

**Closed question — repair starvation.** The handoff's live hypothesis ("the block front-loads
retrieval and starves repair") is **rejected**: control made 92% of searches before the first
edit (116/126) vs variant 75% (90/120); the variant made 3× more post-edit searches (30 v 10)
and still thrashed `[box — re-verify]`. thelounge thrash was completion uncertainty amplified by
a harness warning bug (`EDIT_THRASHING.md` §1), not retrieval starvation. Consequence: the
"never a probe you had not planned" sentence is dropped for having no measured benefit — not for
proven harm.

## 2. Strategy: move packing from prose to structure

Three surfaces, with hard rules about what may ship on each:

| surface | examples | arm rule |
|---|---|---|
| **S-product** — sweet's tool surface & output | ss-batch, MCP server, result trailers, server-side fusion | sweet arm only — this IS the treatment |
| **S-harness** — frame, run_tests shim, controllers | budget reminders, progress footers, composite tools | **must be arm-symmetric** or the paper claim degrades from "retrieval instrument" to "agent runtime vs native tools" |
| **S-prompt** — the memory-file prompt (M±) | width guidance, re-anchor clause | product; delivered verbatim via memory file per the standing delivery rule; minimal residue only |

### 2.1 S-product: `ss-batch` — deterministic packing primitive

One command that makes a single model decision produce N operations, every time, no habit change
required:

- accepts **up to 3** independent **read-only** operations (grep/search/read/semantic/trace)
- executes them concurrently; returns **labeled per-operation results with explicit per-op
  success/no-match status** (error isolation — a failing op never suppresses siblings; the whole
  `&&`-vs-`;` exit-code analysis dissolves)
- **deduplicates overlapping file spans** across ops
- **one shared token budget** (~1.5× a single probe, NOT 3×) — collapses turns without inflating
  ctx-width; the founding guardrail ("fewer, not wider") holds by construction
- operations are *declared*, fixing the measurement problem permanently

Width cap 3 by design (wider is shotgun territory `[paper detail: W&D schedulers]`). CLI first;
mirrored on MCP.

### 2.2 S-product: the MCP/structured surface (exists, unbenchmarked)

`mcp/server.js` already registers structured `search` (`:170` `[verified]`) and `trace`
(`:198` `[verified]`) with agent-format defaults and read-only annotations. Rationale: first-class
tools inherit the provider's trained parallel-envelope behavior that bash-wrapped CLIs never get,
and eliminate the shell-quoting/BRE-dialect failure class entirely.

Checks before betting on it: OpenCode pinned 1.18.4 MCP/custom-tool integration works; MCP result
JSON isn't verbose vs CLI packs; tool-schema resident-width tax is small. The MCP variant of the
prompt exists and is UNBENCHMARKED — this is the standing biggest structural bet.

### 2.3 S-product: server-side collapse of dependent pairs

The 551 search→read collapsible pairs are **dependent** — no client-side instruction can ever
pack them, because the model needs the search result to know what to read. Only the tool can
collapse them: sufficiency-triggered full-span return / auto-read-of-top-hit (the shipped
within-file affordances already do part of this). **$0 first:** determine which sweet version the
retired run used and measure what fraction of the 551 pairs the current tool would already kill.

### 2.4 S-prompt: residue (only after the mechanism grid picks a winner)

- **Phase-scoped width, in the trained dialect:** during orientation, up to 3 independent probes
  as **separate tool calls in one message** (or one `ss-batch`); refinement ≤2; after the first
  edit default to 1 unless a genuinely independent diagnostic set exists (descending schedule
  `[paper detail: W&D; FuseSearch exploration→refinement]`).
- Keep the dependency guard ("a probe needing another's result goes in a later message").
- **Drop** "never a probe you had not planned" (§1 closed question).
- Repair-phase re-anchor clause is owned by `EDIT_THRASHING.md` §5.

## 3. Phase 1 — mechanism grid before ANY dollar stage (~$0-6)

Five arms on 3-5 dev tasks each; **compliance metrics only** (per-turn proportions have far lower
variance than $ — a tiny smoke CAN detect compliance):

| arm | what |
|---|---|
| A | status quo (persistent M±, CLI) — control |
| B | per-turn nudge via ss output trailer, CLI |
| C | `ss-batch` available + one usage line in M± |
| D | MCP surface + MCP prompt variant |
| E | MCP + per-turn nudge |

**Gates (all must pass to advance):**
- packing compliance ≥90% on identified eligible opportunities
- **zero dependency violations** (no guessed/placeholder arguments — count them)
- operations flat (two-sided 0.85–1.05, as the stage-1 adjudicator)
- output tokens non-increasing (shared-budget check)
- canonical metrics recorded: ops/retrieval-envelope; single-call-turn rate (baseline 85.7%
  sweet / 52% native); multi-envelope-message rate

Any arm failing compliance is killed **free** — no dollar stage for it, ever.

## 4. Phase 2 — re-baseline, then Phase 3 — the dollar stage

- Phase 2: fresh dev baseline under the hardened offline frame **after** `EDIT_THRASHING.md`
  Phase 0 harness fixes land (green-ledger re-sweep mandatory — harness change ⇒ configHash
  change ⇒ gold re-grade; the eligible dev pool is currently 20, with 14 stale needing re-sweep
  anyway).
- Phase 3: **2×2 dev study — ss-batch (or grid winner) × progress-controller** (from
  `EDIT_THRASHING.md`), 12-20 pairs. Primary outcome: **cost per correct solve** with **solve
  non-inferiority**; predeclared adjudicator (two-sided operations gate, ctx/turn ≤1.10 upper,
  robust per-pair log-ratio estimator with predeclared trimming). Dev tasks only; heldout-2 stays
  frozen for the gated re-run plan.

Why 12-20 pairs is enough here and wasn't before: the controller/batching effects being chased
are in the 15-60% class `[paper: More-with-Less; FuseSearch]`, not the 3-8% class the prose lever
was chasing under a ±20% noise floor.

## 5. Fix the meter itself

- Analysis-side operation splitter (probe-count.mjs style: split on `;`/`&&`/`||`/newline, same
  buckets as `classifyShell`) becomes the canonical counter for all future stages; envelope
  counts are reported but never gate.
- Unify the stats CLIs (`turn-economy-ab.mjs` takes paths, `turn-economy-smoke.mjs` takes run
  IDs — noted in the handoff as a footgun).
- PLAN.md §4.3's −14.2% counterfactual is envelope-based and flagged unreliable by the design
  note `[verified: design note §3.3(c) caveat]` — recompute at operation level before citing.

## 6. What we will NOT do

- No more persistent-prompt packing A/Bs at n≤7 (§1.6 math).
- No width >3; no `&&` joining of independent probes (exit-code coupling, measured).
- No tuning against pre-frame baselines; any comparison to them discloses the frame change.
- No per-query inspection of held-out sets; heldout-1/2 never used for lever validation.
- No asymmetric harness features (S-harness ships to both arms or not at all).

## 7. Cost & sequencing summary

| phase | what | cost | gate to advance |
|---|---|---|---|
| 0 | `EDIT_THRASHING.md` Phase 0 (harness bug fix + $0 forensics) | ~$0 | bug fixed, ledger re-swept |
| 1 | mechanism grid (5 arms × 3-5 tasks, compliance only) | ~$0-6 | ≥90% compliance, 0 violations, ops flat |
| 2 | re-baseline dev under fixed harness | ~$3-5 | green ledger, escape=0 |
| 3 | 2×2: batching × controller, 12-20 pairs | ~$20-30 | predeclared adjudicator |
| 4 | (wave 2, optional) `apply_patch_and_test`, full MCP staging | scoped later | separate decision — changes comparability |

## 8. Adjudicated disagreements (for the record)

1. **"<1% addressable" (Claude) vs "~9pp density" (design note, via Codex/Kimi):** the design
   note's operation-level accounting supersedes the handoff-only reading. The ~38 adjacent
   single-probe turns were the *prose-addressable adjacent-turn* class; the full density gap is
   ~9pp of turns ≈ 8.4% ceiling. Adopted: 8.4% ceiling.
2. **"edit→test pairs unreachable" (Claude) vs `apply_patch_and_test` (Codex):** Codex is right —
   co-issued calls can't be serialized in OpenCode 1.18.4, but a *single composite tool* is
   sequential internally and safely reaches the 292 pairs. Adopted as wave 2, **symmetric across
   arms**, default OFF for the headline comparison (it changes the "stock harness" claim).
3. **Front-loading hypothesis:** proposed by handoff, prioritized by Claude, **measured and
   rejected by Codex** `[box — re-verify]`. Adopted: rejected pending re-derivation.
4. **Re-baseline sequencing (Claude, unique):** adopted as Phase 2 — pre-frame numbers are
   contaminated in both cost AND solve.
5. **Per-turn channel as the load-bearing mechanism (Kimi, from More-with-Less/W&D):** adopted;
   implemented via channels we control end-to-end (ss trailers = product; run_tests footer =
   symmetric harness), since true per-turn injection in pinned OpenCode is unverified.

## 9. Verification ledger (open items)

| claim | source | status |
|---|---|---|
| timing test: 92% v 75% pre-first-edit; 30 v 10 post-edit searches | Codex, box DBs | re-derive via HANDOFF §8.2-8.3 |
| identifier-warning incidence 8/14 stage-1 rollouts | Codex | re-count on box logs |
| W&D per-turn>persistent; 45.7→23.8 turns; −35.9% cost; calls 46→71; cap-3 optimum | 2602.07359 | abstract verified; details = full-text spot-check |
| FuseSearch 7.52→5.60 turns / 59.4k→30.9k tok; downstream 68.4→68.1% at 41.1→31.6 turns | 2601.19568 | abstract verified (67.7% fewer turns headline); details = full-text |
| More-with-Less reminder ablation (71v63, 60v24) | 2510.16786 | abstract verified (24-68%, +12-24%); ablation = full-text |
| `&&`-chain share 67.8% of ss-* calls | Kimi (design note) | locate in design note |
| OpenCode 1.18.4 MCP/custom-tool support | opencode.ai docs | verify against pinned binary |

## 10. Constraints in force (unchanged)

Dev tasks only — heldout-1/2 never for lever validation. Green-ledger invariant: no run without
gold-FULL under the exact configHash; re-sweep after ANY harness change. One run-pilot process
per box (CONCURRENCY=2 in-process is fine). Frozen: ranking/sufficiency logic, isolation jail,
egress guard, turn logs, grader; the run_tests shim/condenser edits in `EDIT_THRASHING.md`
Phase 0 require the same explicit reopen the frame clause got. Production M± untouched until a
grid winner exists. Solo repo — direct to main.
