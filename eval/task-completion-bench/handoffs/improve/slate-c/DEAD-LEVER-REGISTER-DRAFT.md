# Dead-lever register — DRAFT (2026-09-02, compiled from memory notes and result docs)

> **Superseded by [`register/DEAD-LEVER-REGISTER.md`](./register/DEAD-LEVER-REGISTER.md) (123 rows,
> 2026-09-02).** Known errors in this draft: D4 is NOT fixed (see `SLATE-C-UBER.md` §4.1); D6 is a
> legacy-model-only exposure, not a general product risk. Kept as provenance only.

Purpose: every lever below has already been proposed, gated, shipped, or killed. A new
candidate that is one of these under another name is not new. The workflow's Phase 1
verifies and extends this draft into `register/DEAD-LEVER-REGISTER.md`.

Verdict vocabulary: **DEAD** (killed at a gate with a recorded fact), **CLOSED** (owner or
measurement closed the whole class), **SHIPPED** (in production; not a new lever),
**INVERTED** (replay said win, live said loss), **PARKED** (allowed, no one has run its `$0`
screen), **OPEN** (a `$0` question nobody has answered), **BLOCKED** (cannot be evaluated
as specified), **OWNER-EXCLUDED** (a decision, not a measurement).

## A. Turn economy, packing, batching

| # | lever | verdict | killing fact / status | source | revival condition |
|---|---|---|---|---|---|
| A1 | prompt-steered call packing / parallel Bash envelopes | DEAD ×4 | Grok 2/8→4/8 packed; luna instruction-deaf; external replication (2608.01347) explicit efficiency instruction = zero change, p=1.0 | `TURN_PACKING_FINAL.md`, memory `turnfix-program` | backbone trained for parallel emission |
| A2 | `ss-batch` structural packing CLI | DEAD | Grok packs dependent ops with invented args (3/4 traps under maximal guard); luna: deployed, called 0× in 198 opencode rollouts | same | per-backbone re-screen |
| A3 | server-side search→read fusion v1 / v2 (reference batching) | RETIRED / CLOSED | v1: ss-calls, cost, solves unchanged; v2: standalone net-negative (top1 −$0.0097), positive only as a rider on eviction | `lever3-eviction/GATE0-RESULTS.md` | — |
| A4 | MCP tool surface (structured `ss-*` tools) as the packing/parallel-emission vehicle | OWNER-EXCLUDED, UNBENCHMARKED | scoped out 2026-07-31 (Bash/CLI only); product ships `init --mcp --no-cli`; the `-mcp.md` guide variant is unbenchmarked; a new tool schema changes the cached prefix | memory `mcp-nocli`, `turnfix-program`; 08-28 §5.1 C4 | user decision; the opencode +3.4-request driver is its motivation |
| A5 | hard turn cap (p75 / p90) | REJECTED / NULL | p75 kills 6 solved rollouts; capped cell null on cost; tail = noise AND treatment | `turnfix-program` | — |
| A6 | mid-task advisories / footer nudges / stall controller | REFUTED | Grok ignores mid-task instructions in every channel (3/3); footer "win" was an accidental A/A | same | — |
| A7 | thrash levers T1 novelty-stall / T2 failed-edit streak / T3 no-progress abort | DEAD | no doomed tail on luna: all exit `model_stopped`, median failed run ends 1–2 turns after last progress; oracle ceiling 13.4% < 15% bar; any cut clearing 15% removes up to 25/34 solves | `thrash-census.mjs`, memory `thrash-nogo` | backbone change |
| A8 | checkpoint-on-green (restore best verified state) | NO-GO | 0/119 exposure; selector prefers smaller earlier patches (2/5 regressions); over-edit-past-green 0 in all cells | `lever2-checkpoint/RESULT-*.md` | trigger rate >5% |
| A9 | `run_tests` long-yield (`SS_RT_LONGYIELD`) | SHIPPED | polls −71%, solve-neutral, both arms | memory `poll-await-lever` | — |
| A10 | D2 terminal `run_tests` verdict (`rt-inflight`) | DEPLOYED | arm-universal; zero differential | `D2-DEPLOYED-RESULTS.md` | — |
| A11 | poll `run_tests` via prompt | DEAD | FRAME already mandates; agent ignored; D2 is the runner fix | `SLATE-B-UBER` §8 | — |

## B. Context mass and re-send

| # | lever | verdict | killing fact / status | source | revival condition |
|---|---|---|---|---|---|
| B1 | phase-aware tool-result eviction + span-capped fusion | DEAD | the re-send tail is the fixed preamble (18% of spend, un-evictable); tool bodies 10.9%; prefix-cache break re-prices the suffix → 32K cap −12.3%, 40K −15.1% net | `lever3-eviction/GATE0-RESULTS.md` | backbone with much longer trajectories; must read the break-priced column |
| B2 | tool-guide / preamble trim | CLOSED | +1,457 tokens = 2.6–4.5% of sweet spend; trimming redundancy netted 23 tokens (0.07%); docs are dense (40 tok/rule); guidance block owner-protected | `PREAMBLE-TRIM-GATE.md`; 08-28 §5.1 C2 | via prompt-optimization process with a length term |
| B3 | drop the guide entirely and measure | PROPOSED, NOT RUN | 08-28 research ranked it #1 (repo context files cost 20–23% for −0.5 to −2% resolution in two 2026 studies) but conflicts with owner scope; guide carries measured behaviour (no-delegation, fewer calls) | `07-research-resolution-levers.md` §7–8 | user decision |
| B4 | remove `<state_summary>` | DEAD | <0.5% of spend; never its own request | 08-28 §5.1 | — |
| B5 | compaction / eviction on this bench | UNTESTABLE | never fires; max context 100,624 of 1.05M | `06-research-cost-mechanics.md` | — |
| B6 | cache engineering | NOTHING | 99.3–100% hit on re-sent tokens | same | — |
| B7 | result diet / "render the same lines smaller" | BANNED CLASS | honest ceiling 1.9% (61% of collapsible mass is doc comments that must stay) | `SLATE-A-UBER` §9.6; memory `no-retrieval-headroom` | — |
| B8 | inline type/enum/class definition bodies into top-1 | NO-GO | 79% of the shipped pointer rows never followed; bodies ~6× the pointer cost | memory `type-inline-nogo` | new cohort with starved cases |
| B9 | bounded repair-completeness card (surface missed sibling sites) | DEAD | 0–1 starved cases vs bar 2; missed siblings were already in context | `lever4-completeness/` | ≥2 independent starved cases on a new cohort |
| B10 | already-in-context dedupe hint | DEAD | 0 duplicate `ss-*` calls; 3% repeat-hit share | `OVERNIGHT-LOOP-2026-08-07.md` | — |
| B11 | turn-0 retrieval dossier (R-1) | DEAD | calls-to-first-edit down 2–16% while cost rose 4.8–19.8% in C-4's live A/B; top-5 localization 66% | `SLATE-A-RESIDUE-RESULTS.md` | — |
| B12 | whole-file-on-first-touch / span expansion (C-4) | INVERTED | replay −1.6/−2.1/−4.7%; live +4.78/+19.79/+11.72% (claude ex-never-solved +41%); agent handed the whole file does MORE work; code kept, default OFF (`SS_READ_SPAN_EXPAND`) | `search-read.js` comment; `SLATE-A-CLOSE-RESULTS.md` §9.13 | — |
| B13 | payload budgeting by lifetime (on `sufficient=YES` return top-1 body + manifest of lower ranks) | PARKED | early read is 1.9× as dear as a late read; admissible only as "different lines" | 08-28 §5.1 C5 | `$0`: count lower-rank bodies later edited/re-read; kill >20% |
| B14 | adaptive query-conditioned read budgeting (which lines to return) | OPEN | SWE-Pruner 23–54% tokens (abstract-only); admissible only if it changes WHICH lines | `07` L3 | `$0` trace replay first |
| B15 | pack-re-showing-pack, unchanged-reread suppression | LOW VALUE | codex L5: borderline against discard log | `04-resolution-codex.md` L5 | — |

## C. Rendering and gutter

| # | lever | verdict | killing fact / status | source | revival condition |
|---|---|---|---|---|---|
| C1 | `N\| ` → `N<TAB>` read gutter | SHIPPED (116ca2b) | claude-code carried-whitespace anchors 15.4% → 0 in the paid A/B | memory `read-gutter-tab` | — |
| C2 | number every `ss-*` code surface, not just `ss-read` | SHIPPED (ba5b4ee) | 27–36% of delivered lines were unnumbered | `GUTTER-MECHANISM-INVESTIGATION.md` | — |
| C3 | per-harness delimiter (PIPE codex/opencode, TAB claude) | OVERTURNED | n=18 suggestion; at n=66 all forms within 3 rollouts, p ≥ 0.72 on every harness; keep TAB everywhere | `GUTTER-AB-RESULTS.md` → `FRESH-POOL-RESULTS.md`, `HARNESS-GUTTER-COST-ANALYSIS` §0 | a run that clears ±6 |
| C4 | gutter as a cost lever, any form | CLOSED | $0.0003–0.0004/rollout; −15% needs ~5,300 numbered lines/rollout vs 878 delivered | 08-28 §3–4 | — |
| C5 | new gutter designs: sparse-10, landmark, header-only, indent-aware, `N:` | PARKED (`$0` screens only) | none detectable in an affordable run; `N:` is the only zero-ambiguity dense form (+0.71 tok/line); claude-code Edit prompt says "number + tab" (`tengu_tab_read_sep` default off) | 08-28 §4.2 | claude-code separator gate flips |
| C6 | padded `cat -n` gutter | REJECTED | miscalibrates edit wrapping (Claude Code #36654) | `search-read.js` | — |
| C7 | delete the gutter | REJECTED | NONE not better at n=66; gutter historically validated | fresh pool | — |
| C8 | raise codex's output cap (`tool_output_token_limit`) / uncap sweet | REJECTED as lever | delivering truncated output in full costs 2–19× more; 0/480 anchors in a cut span; shared setting | `12-truncation-census.md`; `05` §4.3 | — |
| C9 | fit `ss-read`/`ss-search` under codex's ~2,400-token cap with an addressable continue span | DEFERRED `$0` | ~2%, correctness not cost; codex `04` L4 said "already dead, my data does not revive it" | memory `index-hygiene-fixes-0828`; `04-resolution-codex.md` L4 | — |
| C10 | tab carry on tab-indented files (claude-code Edit fails; codex/opencode write an extra tab) | KNOWN DEFECT, 0 solves changed | 8/61 edits in 3 tab-indented tasks; hazard in tab-indented Python/Haskell/F# | 08-28 §1.1–1.2 | — |

## D. Edit mechanics

| # | lever | verdict | killing fact / status | source | revival condition |
|---|---|---|---|---|---|
| D1 | `ss-edit` / index-addressed structural editing (C-9) | DEAD as C-9; OPEN as hygiene | C-9: 44–86% addressable vs 90% bar; post-fix prize 0.64% of one arm; BUT W0-P7: claude sweet failed-edit turns = 13.4% of arm, 28/32 mechanically addressable; n=66 like-for-like anchor fails native 7.4 / TAB 5.9%; no `ss-edit` exists; owner no-new-tools rule | `PHASE-1-RESULTS.md`, `W0-P7-GATE-RESULTS.md`, 08-28 §1.5 | user decision on scope |
| D2 | `apply_patch` preflight / canonicaliser / order-invariant apply | REJECTED | harness-owned surface (Cline's >10% is an apply-side fix we do not own) | `05` §4.3 | — |
| D3 | report where an edit landed / flag ambiguous anchors (R3) | MEASURE ONLY | decided one task (accenture) at n=1; "evidence presence does not force the choice" | 08-28 §5.2 R3 | — |
| D4 | claude-code `Read` empty `pages` parameter (D-4) | FIXED both arms | PreToolUse normalizer hook + prompt note recover 189/299 | `claude-code-task-runner.mjs` | — |
| D5 | decoding degeneration detection (D-3) | RUNNER-SIDE | both arms; 32k output-token cap signature | `SLATE-B-UBER` D3 | — |
| D6 | claude-code read-before-edit gate on Anthropic models | UNMEASURED PRODUCT RISK | 218/259 sweet edits had no prior native Read; gate is model-gated off for luna | 08-28 §1.4 | `$0` price + small real-model check |

## E. Retrieval, index, corpus

| # | lever | verdict | killing fact / status | source | revival condition |
|---|---|---|---|---|---|
| E1 | index `.jam`, re-admit git-tracked `src/build/`, skip minified by content shape, honor `.gitattributes` | SHIPPED (36b802e, fb9f936) | retrieval win (gold files now reached), no resolution/cost flip; inert until goldens rebuilt | memory `fixval-smoke+banner-0831` | — |
| E2 | `ss-*` hygiene package (regex crash, positional path as `--in`, ENOENT hint, empty body, "not indexed", banner leak) | SHIPPED (36b802e, 1a00765) | requests after failed ss calls ≤ ~2% | 08-28 §5.1 C1 | — |
| E3 | `ss-grep` working-tree freshness (index cannot see same-rollout edits) | MEASURE `$0` | 4 clean codex rollouts; decided none | 08-28 §5.2 R4 | population ≥5% of calls |
| E4 | more sibling / mirror retrieval at search time | DEAD | apple: both methods in the first result; ambient presence did not produce action | `SLATE-A` §9.3, `SLATE-B` §8 | — |
| E5 | dependency-source corpus `ss-deps` (C-5 / P1) | PASSED gate, PARKED | 13/14 tasks ship source offline; sweet reaches for it 6/102 vs native 17/102; ceiling +1 task (pytask); 51× repo size; new tool | `W0-P1-GATE-RESULTS.md` | user decision |
| E6 | cited-reference / RFC corpus (P4b) | DEAD | 0/2 probes; 1 of 18 repos cites a section on a changed file | `W0-P4-GATE-RESULTS.md` | — |
| E7 | cross-file `ss-trace` edges (D5) / `ss-trace` symbol gap | OPEN DEFECT | Python/Lua/TS same-file fallback scans; opencode L6 | `SLATE-B-UBER` D5; `04-resolution-opencode.md` L6 | — |
| E8 | semantic search as a general grep replacement | NEGATIVE | +6% to +118% token premium; agents pick it 0–6% when free | `07` L9 | — |
| E9 | selective superset routing native-first / sweet-on-demand (C-2) | DEAD as pre-run predictor | LOTO router loses a task on two harnesses; oracle −14.9% claude is real; runtime-signal router NOT refuted | `PHASE-1-RESULTS.md` | runtime-signal design |
| E10 | ephemeral causal coprocessor / context reset (C-3, L2 exploration specialist) | DEAD live | re-derivations 0 → 1.33/rollout, calls 6.8 → 12.5, cost +79%; native already delegates, sweet's win is not needing to | `SLATE-A-RESIDUE-RESULTS.md` | — |
| E11 | structure-graph supplement (L4) | PARKED | overlaps R-1; ~zero retrieval headroom | `07` L4 | — |
| E12 | cross-file reference-completeness as a targeted mode (L5) | OPEN `$0` | +0.07 F1 on one query class; count cross-file tasks in the pool first | `07` L5 | — |
| E13 | index-selected regression tests (L1 / R5) | OPEN `$0` | +8–12.9% relative published (abstract-only, 2025 prices); sweet-only only if index-side | `07` L1; 08-28 §5.2 R5 | `$0` census of `run_tests` scope |
| E14 | retrieval headroom on rotate20 | ~ZERO | six never-solved tasks: perfect localization, empty issue, naming lotteries | memory `no-retrieval-headroom` | — |

## F. Resolution and verification

| # | lever | verdict | killing fact / status | source | revival condition |
|---|---|---|---|---|---|
| F1 | terminal family-residue audit `ss-audit` (P2) | DEAD | W0 passed 08-17 (countBy 2/2, 4 FP/38 cells); re-gated 08-25: 98 false residues per correct rollout vs bar 2.0 | `P2-RESIDUE-GATE-RESULTS.md` | — |
| F2 | executable issue witnesses / `ss-oracle` / `ss-witness` / `ss-finish` (P3) | BLOCKED | tools do not exist; prompt form closed twice; an over-specified witness rejects the reference fix and 11 solved rollouts | `W0-P3-GATE-RESULTS.md`, memory `p6-p3-disposition` | — |
| F3 | state-space checker `ss-statecheck` (P4) | PASSES, PARKED on generality | rejects 12/12 wrong patches blind, names the fix; apple 0/3 → 16/16 live on its output; strict shape fires on 1 file in 152,270; Swift front end | `W0-P4-GATE-RESULTS.md`, `HINT-LADDER-RESULTS.md` | a general family of computable facts |
| F4 | artifact-graph authoring `ss-author-api` (P5) / obligation compiler (C-6) | FAILED | blinded 3/5 and 4/5; bingo is a naming lottery | `SLATE-A-RESIDUE-RESULTS.md`, `NAME-LOCK-CENSUS.md` | — |
| F5 | runtime public-surface probe (P6) | PASSES, ceiling unsupported | only enumerability discriminated; 0/12 cells ever resolved; over-specification unpriced | `W0-P6-GATE-RESULTS.md` | — |
| F6 | local repair forge / patch tournament (P7, C-8) | COST-ONLY PASS | addressability 31.6/34.4/43.5% (codex fails break-priced at 27%); native's is HIGHER (42.5%); visible suite false-greens 7/16 tasks | `W0-P7-GATE-RESULTS.md` | — |
| F7 | data/cardinality simulation (Q1) | DEAD | YARP removed (gold fails its own gate) | `PHASE-0-B-RESULTS.md` | — |
| F8 | general engineering clauses in the guide (family-completeness, minimal-change, symmetry) | DEAD | 153 rollouts; every condition 3/8 on unused tasks; originating signal reverses | `CLAUSE-SCREEN-RESULTS.md` | — |
| F9 | delivered computed certificate (hint ladder) | WORKS when computed | apple 16/16; placebo 0/4; rule-only 1/4; prose 0/3; localization 0 | `HINT-LADDER-RESULTS.md` | generalizing the computation is the open problem |
| F10 | tests-first prompt | REJECTED ×2 | shared vehicle; zero differential | memory `p3-rejected` | — |
| F11 | stale-assertion override doctrine | BANNED | benchmark-specific oracle rule | `SLATE-A` §9.4 | — |
| F12 | issue-derived acceptance (agent writes its own test from the visible issue) | QUEUED, NOT BUILT | raises the shared floor; arm-symmetric; adds cost | memory `resolution-floor` | — |
| F13 | deterministic verification / rollback-rerun (L6); reproduce-then-fix (L7) | SHARED | biggest published gain, zero differential | `07` L6–L7 | ship as correctness only |
| F14 | best-of-K / tournaments (L8) | SHARED, saturates | — | `07` L8 | — |
| F15 | delegation for sweet on claude-code | REJECTED | native already delegates 15 cells; sweet's win is not needing to; ledger prices subagents as a lower bound | 08-28 §5.3 | — |
| F16 | zero-edit floor / auto-refuse / force exploration on vague issues | DEAD | mransan: refusal flatters cost, forced work burns it; repair task admission instead | `SLATE-A` §9.1, `SLATE-B` §8 | — |
| F17 | static first-file edit cap / tighter edit-scope guard | DEAD | dart wrong design stays wrong in one file; akinsho narrow-and-green failed | `SLATE-A` §9.5, `SLATE-B` §8 | — |
| F18 | insertion-position oracle; mirror-switch echo; git-diff absorber | DEAD | deciding adjacency already in context; both arms ignore the mirror; git self-state arm-similar | `SLATE-A` §9.6–9.8 | — |
| F19 | a 20×-priced backbone | BUYS NOTHING | terra 0/10 unaided; 2/2 with the certificate | `HINT-LADDER-RESULTS.md` | — |
| F20 | naming-lottery tasks (bingo, dart) | UNWINNABLE | hidden tests import an invented identifier; 4/18 rotation tasks | `NAME-LOCK-CENSUS.md` | admission filter, not a lever |

## G. Measurement (not levers; do not book as wins)

| # | item | status |
|---|---|---|
| G1 | claude sidechain-inclusive ledger (labelled lower bound) | SHIPPED |
| G2 | break-priced cost column (`breakPricedCostUsd`) | SHIPPED; any context-reordering lever must be read on it |
| G3 | vacuity pre-screen, name-lock census, 5-task control set (2 later found vacuous, replaced with zlint-299 + dot-prop-105) | WIRED into admission |
| G4 | HO2 frozen, denominator 199 | never per-task |
| G5 | recommended next paid run: fresh 22-task pool + 5 controls × 3 harnesses × 3 reps ≈ 486 rollouts, ~$7.5–15 | not launched |
| G6 | claude-code native cost is a lower bound (205 delegated requests without usage) | disclose always |
