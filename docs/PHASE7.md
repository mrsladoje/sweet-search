# Phase 7 — System-Prompt Evolution

**Created**: 2026-05-10
**Status**: Draft, ready for pre-registration tag and implementation
**Reviewed**: 2026-05-10 by (a) Gemini 3.1 Pro Deep Think — THREE PASSES (pass 1 = 13 findings; pass 2 = 12 adversarial findings incl. FATAL Round-11 re-baseline + Maximin race-to-middle + EAS + ghost-context-leak + AST-ification + language-transfer HOMP + pathology probes; pass 3 = SHIP-IT verdict + 3 minor tweaks). All Gemini findings integrated. (b) **GPT-5.5 xhigh** external review — the production target reviewing the plan from inside, surfacing 13 GPT-specific blindspots, methodology attacks, and operational footguns Gemini structurally missed (TPM-vs-RPM concurrency math, 0.15 cap utopia-point bug, asymmetric EAS that rewards GPT under-exploration, Java HOMP omitting GPT-5.5, stale joint-mean/latent-interp/ja-pivot residue, SCS reward-for-stable-wrongness, token-validator multiplicity gaps, OP-2 target-tagging, etc.) — all integrated; see §11.5 for the change-map. (c) **User catch** — reasoning-mode transfer gap: optimization runs against thinking-OFF, but power users run thinking-ON; closed by §3.5.2 reasoning-mode operational HOMP gate (Sonnet+thinking + GPT-5.5+reasoning on 15 held-out probes; +$6). Full critique trail at `docs/PHASE7-gemini-critique-2026-05-10.md` (Gemini pass 1), `docs/PHASE7-gemini-critique-2-2026-05-10.md` (pass 2), `docs/PHASE7-gemini-critique-3-2026-05-10.md` (pass 3), `docs/PHASE7-gpt5-5-critique-2026-05-10.md` (GPT-5.5 xhigh).
**Depends on**:
- **`ss-search` grounding (primary)** — `core/prompt-optimization/data/query-shapes/recommendations-v2.json` produced by PHASE6_REDO (see `docs/PHASE6_REDO.md`). Family-conditioned default + per-family overrides. Deprecates the prior P6 `qshape-v1` artifact for `ss-search`.
- **Other-tools grounding (interim)** — P6 `qshape-v1` artifact (`recommendations.json`, Track A/B JSONLs at commit `7d9eb1d`) retained ONLY for the directional signal on `ss-find`, `ss-semantic`, `structural`. To be superseded when each tool's own Phase-6 redo lands (probe sets pending).

**Successor to**: docs/SYSTEM_PROMPT_OPT_PLAN.md §6, §8, §9, §11

---

## §1 Goal

Produce a **single shipped sweet-search agent system prompt** that maximises joint performance on the two production targets users actually deploy on:

- **Claude Code → Sonnet 4.6** (Anthropic direct API, extended-thinking OFF — Claude Code default)
- **Codex → GPT-5.5-instant** (OpenAI direct API — non-reasoning by name; chosen over GPT-5.4 for **pretrain future-proofing** — see §11.2)

…using a reflective evolutionary loop (GEPA) that is **engineering-effective** (with documented human-in-the-loop reflection) AND **scientifically defensible at submission tier** (TARE-style sharpness-aware selection, disjoint-family judge panel, HOMP, paraphrase-invariance reporting).

**Ship policy: ONE unified prompt.** The selection objective is `mean(score_sonnet, score_gpt5.5)` across the dev probe set. We do NOT ship per-target prompts — the goal is a single universal prompt that does best for MOST users.

**Held-out model classes (HOMP, not targets)**:
- **MiMo-V2.5-Pro** (Xiaomi) — primary HOMP class
- **Qwen 3.6 Plus via opencode CLI** — secondary HOMP class (proves the unified prompt transfers to open-weights even though we didn't optimise on it)

**Headline claim if results land**: "An empirically-evolved sweet-search agent system prompt that achieves [+X pp] Maximin (worst-target) score over default phrasing across Sonnet 4.6 and GPT-5.5-instant, with no per-target absolute regression > 0.15 (§3.7.1 admission cap), robust to paraphrasing (correctness-weighted SCS ≥ 0.8), and validated on two held-out model classes (MiMo-V2.5-Pro, Qwen 3.6 Plus) plus a Java language-transfer probe set on both production targets (§3.5.1)."

**Reasoning mode policy**: ALL evaluation runs in **non-reasoning mode** for parity. Both production targets default to non-reasoning, so this matches deployment reality. Reasoning-mode wins are a separate post-hoc claim, not part of the headline.

**Out of scope for this run**:
- Full §11.6 5-of-5 disjoint jury (we use a 3-of-3 minimum)
- Replication across seeds (single seed=42 run; replication is a follow-up)
- Vault opening (deferred to release/`p7-v1` tag — see §13)

---

## §2 Final decisions summary (the bundle)

### §2.1 Roles → models

| Role | Model | Why min-suitable | Family |
|---|---|---|---|
| **Target A** — Claude Code | **Sonnet 4.6** (Anthropic direct API, NOT Max plan; extended-thinking OFF) | Production representative for Claude Code users | anthropic |
| **Target B** — Codex | **GPT-5.5-instant** (OpenAI direct API; non-reasoning by name) | Production representative for Codex users on the **current pretrain family**; future GPT-5.6+ likely 5.5-derived → longer artifact shelf-life | openai |
| GEPA Reflector | **Kimi K2.6 reasoning** (Moonshot direct API) | AA Intelligence Index 54, top open-weights reasoning, Moonshot family clean against all other roles | moonshot |
| Merge Synthesizer | **Kimi K2.6 reasoning** (same) | Same justification | moonshot |
| OP-3 paraphraser (Persona/Constraint Pivot, replaces ja-pivot) | **Sonnet 4.6** + at least 1 non-Anthropic generator per round (rotate Kimi K2.6 / GPT-5.5; per GPT-5.5 review §C2 — anti-Anthropic-paraphrase-bias) | Strong instruction-follower for "preserve intent, vary surface, freeze [[tokens]]"; rotation breaks single-family paraphrase distribution | anthropic + rotated |
| TARE adversarial paraphraser | **Sonnet 4.6** + ≥1 non-Anthropic per K=3 paraphrases (deterministic structural + Kimi or GPT-5.5; per GPT-5.5 review §C2) | Robustness must be measured against multi-family paraphrase noise | mixed |
| Lazy-user query degrader (§3.6.1) | **Deterministic templates** + **GPT-5.5** as alternate generator (per GPT-5.5 review §C4 — anti-Sonnet-author-bias) | Templates: dropped symbols, wrong extension, abbreviated package names, partial stacktrace fragments | mixed |
| Judge 1 (deepseek family) | **DeepSeek-V4-Flash** (direct API) | Tested 99.9% clean in P6 after `max_tokens: 4096` fix | deepseek |
| Judge 2 (google family) | **Gemini-3.1-Flash-Lite** (direct API) | Tested 100% clean in P6 | google |
| Judge 3 (minimax family) | **MiniMax M2.7** non-reasoning (direct MiniMax API) | Cheap, reliable instruction-follower; clean family vs all targets and other judges | minimax |
| **HOMP class A** | **MiMo-V2.5-Pro** (Xiaomi, via Together or direct API) | Different family from all targets/judges/reflector. AA index 54. Validates cross-model transfer. | xiaomi |
| **HOMP class B** | **Qwen 3.6 Plus** via opencode CLI (or direct via Alibaba Cloud DashScope if available) | Open-weights frontier. Validates the unified prompt transfers to a class we didn't optimise on. | alibaba |

**Family map**: anthropic / openai targets → moonshot reflector → google embedding → deepseek + google + minimax judges → xiaomi + alibaba HOMP. **8 distinct families across all roles** — substantially exceeds §11.6's 5-family disjoint-jury requirement.

**Anthropic family note**: Sonnet 4.6 appears as both Target A AND as a paraphraser/degrader. This is *not* a §11.6 violation because the paraphraser is doing single-shot stateless generation — it never sees task evaluation feedback, never participates in selection or judging. The role-shape is entirely different from a jury slot. Per GPT-5.5 review §C2/§C4, we additionally rotate non-Anthropic generators (Kimi K2.6 / GPT-5.5 / deterministic templates) so paraphrase diversity isn't single-family-biased.

### §2.2 Direct-API everywhere except agents

Per the lesson learned in P6 (CLI harness is 50–100× slower than direct API for stateless calls):

| Call type | Path | Why |
|---|---|---|
| Agent runs (target) | CLI harness OR direct API per target's needs | Agents use tools; harness justified |
| Reflector / Synthesizer | **Direct API** | Stateless; no tools needed |
| Judges | **Direct API** | Stateless; no tools needed |
| Paraphraser (OP-3 / TARE / lazy-user degrader) | **Direct API** | Stateless |
| HOMP replay | **Direct API or CLI**, depending on model | Whichever is cheaper |

Implementation: extends `eval/agent-read-workflows/judge-runner.js` with `runMoonshotDirect`, `runMiniMaxDirect`, `runOpenAIDirect`, `runMiMoDirect`. Pattern mirrors existing `runDeepseekDirect` and `runGeminiDirect`.

### §2.3 GEPA configuration

| Parameter | Value | Rationale |
|---|---|---|
| Initial variants | 14 (T1–T14, hand-authored, P6-grounded — see §4) | Standard slate per §6 of the original plan |
| Pareto front size | 6 (joint front across both targets) | Balances diversity and selection pressure |
| Max rounds | **20** | Above the typical convergence point |
| Patience | **5 rounds** without improvement on Maximin score with EAS modifier (Δ ≤ 1pp on `final_score` per §3.7.1) | Standard early-stop |
| Plateau-breakthrough rule | If patience triggers but the *trajectory* shows step-changes within the last 3 rounds, **extend by 3 more rounds** before final stop | Catches GEPA-style "compositional jumps" — see §3.1 |
| Mutations per round | **3** (portfolio — see §3.2) | GAAPO-style portfolio |
| Reasoning mode for evaluation | **OFF** for both targets | Production-parity (see §1) |
| Screening probes per mutation | 8 (× 2 targets = 16 runs) | Cheap filter before full eval |
| Confirmation probes (survivor) | 25 (× 2 targets = 50 runs) | Joint scoring requires both targets |
| Joint score formula | **Maximin**: `min(score_sonnet, score_gpt5.5)` per probe × EAS efficiency factor − length penalty (full formula §3.7.1); Pareto admission additionally gated by 0.15 absolute-degradation cap relative to **the displaced incumbent** (NOT global per-target Pareto maxima — per GPT-5.5 review §C1, anti-utopia-point fix) | Unified-prompt ship policy (§3.7) |
| Manual reflection cadence | **After every round** (see §3.4) | Human-in-the-loop GEPA |
| Persistence | **Append-only JSONL after every mutation, screen, confirm, TARE step** | Resume MUST work after crash — see §7.4 |

### §2.4 Probe sets (three-tier)

| Tier | n | Purpose | Inspection rules |
|---|---|---|---|
| **Dev** | 25 | GEPA loop free inspection, manual reflection | Free per-query inspection |
| **Held-out** | 15 | Frozen sanity-check after GEPA convergence | NEVER inspect during evolution |
| **Robustness pivots** (post-convergence) | 5 paraphrases × 25 dev + 15 held-out (computed only on the winner) | SCS metric for paraphrase invariance | Computed once, after winner selected |

**Note**: This is engineering-tier, NOT publication-tier. For publication, expand dev to 60 + Sealed-1 to 40 + Vault to 80 per §11.2 of original plan.

### §2.5 Cost envelope

**Target ~$200 ± $30**. Per §10.

---

## §3 Methodology

### §3.1 The GEPA loop

The loop is **joint across both targets** (Sonnet 4.6 + GPT-5.5-instant). Per round:

1. **Selection** — Sample candidate from joint Pareto front (stochastic; weighted by per-probe wins on the **Maximin × EAS final_score** of §3.7.1).
2. **Mutation** — Generate 3 candidates per the §3.2 portfolio.
3. **Screening** — Each mutation evaluated on 8 probes × **both targets** = 16 agent runs per mutation. Maximin × EAS `final_score` is the screen metric.
4. **Persistence checkpoint** — Append every screen result (one JSONL row per (mutation, probe, target)) to `core/prompt-optimization/data/results/p7-v1/gepa-trajectory.jsonl`. **Run is fully resumable from this file at any point.** See §7.4.
5. **Confirmation** — Top survivor re-evaluated on full 25 probes × 2 targets = 50 runs. Append to JSONL.
6. **TARE-style selection gate** — Compute paraphrase-sharpness for the survivor on the Maximin × EAS score (see §3.3). Selection uses dual objective: `final_score` AND `1 − sharpness`.
7. **Pareto update** — Add survivor to front if it Pareto-dominates any incumbent on the joint two-objective space, AND passes the §3.7.1 step-9 0.15 admission cap relative to the *displaced incumbent*.
8. **Manual reflection checkpoint** — User reviews top 3 failures **separately per target** (per GPT-5.5 review §E2): the report distinguishes Sonnet-only failures, GPT-only failures, and joint failures (both targets ≤ 0.4). Logs decisions in `core/prompt-optimization/data/p7-decisions.md` (see §3.4).
9. **Patience check** — If Δ`final_score`-best ≤ 1pp for 5 rounds, evaluate plateau-breakthrough rule (see below). If still flat, stop.

**Plateau-breakthrough rule** — When patience would trigger:

- Look at the past 8 rounds' `final_score`-best trajectory.
- If there's been at least one step-change of ≥ 3pp within those 8 rounds, **extend by 3 more rounds** before final stop. This catches GEPA-style compositional-jump dynamics ("the reflector suddenly figures out a higher-level abstraction").
- Otherwise, stop at patience trigger.

**Hard cap**: 25 rounds total, no exceptions.

**Mid-run probe rotation** (anti-overfit, per Gemini 3.1 Deep Think review): At **start of round 11**, rotate 5 fresh probes into the dev set, retiring the 5 probes with lowest score-variance across the current Pareto front (i.e. the "easy" probes everyone already mastered — they no longer discriminate). Held-out probes stay frozen. This prevents the GEPA loop from over-fitting the original 25 dev probes when there are 60+ candidates in flight. New probes drawn from a held-aside pool of 10 authored at the same time as the dev set (committed under `prereg/p7-v1` so the rotation is pre-registered, not post-hoc).

**Pareto-front re-baseline at rotation** (FATAL fix per Gemini second-pass review §B1): At the **exact moment of rotation** (start of round 11), the GEPA driver MUST re-evaluate the entire current Pareto front (typically 6 variants) on the 5 new probes BEFORE scoring any new mutations. Without this step, Round 12 candidates are evaluated on the new probes while incumbents are scored on old probes — apples-to-oranges Pareto comparison. Cost: 6 variants × 5 new probes × 2 targets = **60 extra agent runs** (~$5). Mathematically non-negotiable. After re-baseline, all variants on the front have scores covering the *same* 25 probes (the 20 retained + 5 newly rotated in).

**Dynamic hard-negative probe weighting** (per Gemini, with GPT-5.5 review §C5 noise-floor fix): from round 5 onward, each probe's contribution to the score is reweighted by its variance across the current Pareto front:

```
raw_variance = variance_of_scores_across_pareto(probe)
# GPT-5.5 review §C5 — anti-noise upweighting at small Pareto front (n=6):
# require ≥2 rounds of evaluation for variance to count, plus a noise floor
if rounds_evaluated(probe) < 2: weight(probe) = 1.0  # neutral until stable
else: weight(probe) = clip(max(raw_variance, judge_noise_floor=0.05), 0.1, 2.0)
final_score(variant) = weighted_min(maximin_per_probe(variant), weights=weight) × eas_factor − length_penalty
```

Probes everyone solves (low variance) get weighted ~0.1; probes that genuinely discriminate (high variance) get weighted ~2.0. This is the IR-learning-to-rank insight (LambdaMART-style query weighting) applied to prompt evolution: the optimizer spends pressure on the *frontier of difficulty*, not on already-mastered probes. The 2-round stability gate prevents single-round judge-noise from being upweighted as if it were genuine probe difficulty (per GPT-5.5 review §C5).

### §3.2 Mutation portfolio (GAAPO-style, post-Gemini-Deep-Think)

The mutation operator pool was substantially redesigned after Gemini 3.1 Pro Deep Think reviewed the original plan and identified a fatal flaw in the latent-interpolation approach (off-the-shelf retrieval embeddings cannot be decoded by a generative LLM — they map to a similarity manifold, not a generative latent space). The replacement design is empirically grounded and creatively richer.

**Operator pool (5 operators)**:

| ID | Operator | Mechanism | Why it's in the pool |
|---|---|---|---|
| OP-1 | **Reflective rewrite** (Kimi K2.6) | Reads N=5 failure traces from the candidate's worst probes (joint-score ≤ 0.4), proposes a targeted edit | GEPA's native operator. Workhorse. |
| OP-2 | **Contrastive Trajectory Crossover** (Kimi K2.6) | Find a probe where prompt A wins (≥0.8) and prompt B fails (≤0.4). Pass A's full tool-call trajectory + both prompts to Kimi + **the most recent manual-reflection hint as a hard negative constraint** (anti-schizophrenia per Gemini 2nd-pass §B3). **Trajectories MUST be target-tagged** (`target: 'sonnet'\|'gpt5_5'`) and the operator MUST identify whether the bottleneck is Sonnet-only, GPT-only, or joint (per GPT-5.5 review §B3 — anti-Sonnet-style import). When both targets have winning trajectories on the same probe, both are passed to Kimi as a **balanced pair** so the operator merges *behaviors compatible with both*, not just Sonnet's exploration cadence. When only one target has a winning trajectory, the operator is explicitly informed that the bottleneck is single-target and the other target needs different mechanism. Merge B's structural strengths with A's specific routing instructions, *while obeying the latest human-injected constraint*. | Empirically-grounded crossover. Compositional jumps grounded in actual agent behaviour, not abstract text similarity. **Replaces** the rejected latent-interp. |
| OP-3 | **Persona / Constraint Pivot + AST-ification** (Sonnet 4.6 + rotated non-Anthropic generator per round) | Two-mode operator: (a) standard structural-format pivot (bullets → numbered lists, paragraphs → strict pseudocode layout) AND (b) **AST-ification of routing constraints** (per Gemini 2nd-pass §D1, with GPT-5.5 review §B4 fix): convert prose routing rules into pseudocode blocks **labelled `# routing policy pseudocode — NOT executable code` and prefer decision tables over fenced ```python``` for high-level routing**. GPT-5.5 can over-interpret fenced python as executable; explicit non-executable framing prevents this. LLMs process structured pseudocode at higher fidelity than dense English — fewer scope-ambiguity failures on conditional rules. Mode (a) is default; mode (b) fires on rounds where the candidate has ≥3 conditional routing rules in prose. **Generator rotation per GPT-5.5 review §C2**: Sonnet is default but every 3rd round uses Kimi K2.6 or GPT-5.5 to generate the pivot, so the family of paraphrase noise isn't single-Anthropic. | **Replaces** ja-pivot. 2026-era LLMs exhibit translation invariance. Format-pivot + pseudocode-routing guarantees surface variance, clear rule semantics, AND multi-family paraphrase distribution. |
| OP-4 | **Tool-Signature Masking** (Kimi K2.6) | Temporarily alias `[[ss-search]] → [[TOOL_ALPHA]]`, `[[ss-find]] → [[TOOL_BETA]]`, `[[ss-semantic]] → [[TOOL_GAMMA]]`, `[[structural]] → [[TOOL_DELTA]]` in the candidate. Ask Kimi to optimize the prompt so an agent could correctly use these tools *based only on prompt descriptions, not lexical priors*. After mutation, map names back. **Domain-stripping** (per Gemini 2nd-pass §A3 — anti-ghost-context-leak): the OP-4 reflector system prompt MUST also strip the words "code", "repository", "search", "semantic", "regex" and instead frame the task as "optimizing a generic database retrieval tool (TOOL_ALPHA), a regex-anchor lookup tool (TOOL_BETA), a vector-similarity tool (TOOL_GAMMA), and a graph-traversal tool (TOOL_DELTA)". Without this, the reflector hallucinates the domain back into surrounding context, defeating the masking. | **Cognitive forcing**: breaks the agent's reliance on pre-trained "search/find/semantic" lexical priors. Forces unambiguous self-contained tool descriptions. |
| OP-5 | **The Pruner** (Kimi K2.6) | "Remove ~20% of words from this prompt without changing any operational rule, `[[token]]`, or behavioural expectation. Make it terse. **DO NOT alter the syntax, indentation, or logic of any pseudocode, `if/then` blocks, or fenced code blocks — restrict pruning to natural-language prose only.** This protects OP-3 AST-ified routing rules from accidental syntax destruction (per Gemini 3rd-pass §C1)." | **Bloat control.** GEPA's biggest failure mode is monotonic prompt inflation — reflectors add rules, never delete them. By round 20, prompts can balloon to 2,500+ tokens, diluting attention. Pruner provides downward pressure. Combined with the explicit length penalty in §3.7. The pseudocode-protection clause is critical because OP-3 AST-ification produces `if/then` routing blocks that "make it terse" would otherwise mangle (deleting `elif`, flattening indentation, dropping closing brackets). |

**Per-round slot composition (3 mutations per round)**:

- **Slot 1**: OP-1 Reflective rewrite (always — the workhorse)
- **Slot 2**: OP-2 Contrastive Trajectory Crossover when a Pareto-front pair has the required A-wins / B-fails mismatch on at least one dev probe; otherwise fallback to a *second independent* OP-1 reflective rewrite on a different failure cluster.
- **Slot 3**: rotates through OP-3 → OP-4 → OP-5 → OP-3 → … per round (cycle of 3). At round 11+ when probe rotation has fired, the cycle resets to give each new probe set fresh exposure to all three structural operators.

**Pruner timing**: introduced from round 3 onward (rounds 1-2 prompts are still fresh and short — pruning would be a no-op). Kimi instructed to refuse pruning when the input is already minimal.

**Tool-Signature Masking timing**: every round it appears in slot 3. The mask-mapping is regenerated per call (different aliases each time) so the optimizer doesn't memorize the alias scheme.

#### §3.2.3 Stateful summarization forcing (anti-RIF, structural rule per Gemini 2nd-pass §D2)

Retrieval-Induced Forgetting (RIF) is a known cognitive-LLM failure mode: in long agent trajectories, the system-prompt instructions get pushed out of the primary attention window by accumulated tool results. By turn 4, the agent forgets the routing rules.

**Mitigation**: T2, T8, T13, T14, T15 seed variants explicitly include the structural rule:

> "Before your 3rd tool call (or before your final answer, whichever comes first), you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question."

This forces the LLM to re-attend to the core objective mid-trajectory, breaking late-turn hallucination drift. It's NOT a mutation operator — it's a content rule available for the reflector to inject when failures show late-turn drift patterns. After round 5, if Gemini Deep Think's reflection (§3.4) flags "agent forgot the routing rules in turn 4+", the reflector can be hinted to add the `<state_summary>` rule to the candidate.

#### §3.2.1 Tokens that MUST be preserved verbatim through any paraphrase

The following tokens are wrapped as `[[...]]` in T1–T14 source files and are protected through ALL paraphrase/mutation operators that produce text variants:

| Category | Tokens |
|---|---|
| Tool names | `[[ss-search]]`, `[[ss-find]]`, `[[ss-semantic]]`, `[[structural]]`, `[[ss-grep]]`, `[[ss-trace]]`, `[[ss-read]]` |
| Format markers | `[[agent-format]]`, `[[json]]`, `[[regex]]` |
| File-shape mentions | `[[expectedFiles]]`, `[[expectedSymbols]]`, `[[expectedFacts]]`, `[[no-match]]` |
| Structural placeholders | code fences, regex literals, file-path patterns matching `^[a-zA-Z][a-zA-Z0-9_/.-]*\.(js|ts|tsx|jsx|py|rs|go|md)$` |

**Tool-Signature Masking exception**: OP-4 *intentionally* substitutes tool names with `[[TOOL_ALPHA/BETA/GAMMA/DELTA]]` aliases during mutation. The post-mutation step maps them back deterministically before the candidate enters screening.

The mutation system prompt for OP-3 (Persona Pivot) includes:
> "Tokens wrapped in `[[ ... ]]` are protected — output them character-for-character with NO whitespace inside the brackets. Do NOT translate, paraphrase, or remove them. Code fences (```...```) and regex patterns are also protected."

After mutation, the **`[[token]]` validator** (per Gemini's risk D3 + GPT-5.5 review §B5 — whitespace corruption AND multiplicity/alias gaps are real):

1. Extracts all `[[...]]` tokens from the source candidate, recording **multiplicity** (how many times each appears).
2. Normalizes whitespace inside brackets in the mutated output: `[[  ss-search ]]` → `[[ss-search]]`, `[[ ss-find ]]` → `[[ss-find]]`.
3. Verifies all source `[[...]]` tokens appear in the output after normalization, **at the same multiplicity** (per GPT-5.5 review §B5 — token count must be preserved, not just presence).
4. **Rejects unmapped OP-4 aliases** (per GPT-5.5 review §B5): if any `[[TOOL_ALPHA]] / [[TOOL_BETA]] / [[TOOL_GAMMA]] / [[TOOL_DELTA]]` survive in the candidate after the OP-4 alias-back-mapping step, the mutation is rejected. Leftover masking aliases in a shipped prompt are silent prompt corruption that would tank tool-use performance.
5. **Rejects surplus protected tokens** (per GPT-5.5 review §B5): the mutated output cannot contain `[[...]]` tokens that don't exist in the source — the operator may not invent new sentinels.
6. If ANY check fails, **rejects the mutation** and logs a `_kind: 'mutation-rejection'` event with the specific failure mode (`whitespace-norm` | `missing-token` | `multiplicity-changed` | `unmapped-alias` | `surplus-token`). No silent drops.

#### §3.2.2 Why this portfolio (rationale for the replacements)

Gemini 3.1 Pro Deep Think identified two specific failures in the original (pre-review) plan, both addressed by the new portfolio:

- **Original "latent-interpolation" was scientifically invalid**: passing 768-dim Gemini retrieval embeddings to Sonnet 4.6 with "decode this intent" would have produced hallucinated text. Retrieval embeddings live on a similarity manifold, not a generative latent space. **Replaced by OP-2 Contrastive Trajectory Crossover**, which achieves the same goal (compositional jumps from combining two parents) but grounded in observed agent execution traces — empirically valid.
- **Original ja-pivot is increasingly a no-op on 2026 LLMs**: Sonnet 4.6 exhibits translation invariance for short technical prose; en→ja→en often returns text near-identical to the source. **Replaced by OP-3 Persona/Constraint Pivot**, which guarantees surface variance by changing structural format directly.

The two new creative operators OP-4 (Tool-Signature Masking) and OP-5 (The Pruner) are additive — they address failure modes (lexical-prior interference and bloat) that no existing operator targeted.

**Rejected (and why)**:
- AMR-pivot — no off-the-shelf AMR pipeline worth the integration cost.
- Triple-language pivot (en→de→el→en) — compounds translation errors past useful threshold.
- Embedding-only mutation without LLM decoder — would produce incoherent text (Gemini critique confirmed).
- ja-pivot anywhere — fully removed (translation invariance on 2026 LLMs makes it a no-op). §3.6 SCS robustness uses the multi-family paraphrase set (Kimi reflective + Sonnet OP-3 + GPT-5.5 OP-3 + deterministic structural + OP-4 mask + manual hand-edit) instead, post-GPT-5.5 review §C2.

### §3.3 TARE-style adversarial paraphrase selection gate (Pareto-gated, post-Gemini-review)

Per [TARE (NeurIPS 2025, arXiv:2509.24130)](https://arxiv.org/abs/2509.24130). Gemini 3.1 Pro Deep Think identified an inefficiency in the original design: running TARE on every survivor wastes ~70% of the TARE budget on candidates that never make the Pareto front anyway.

**Pareto-gated TARE flow** (revised):

1. Each candidate that survives the screen+confirm steps gets a **task-only joint score** computed first (no TARE yet).
2. Check if the candidate would **enter the Pareto front by task score alone** (i.e., would Pareto-dominate at least one current incumbent on `joint_task_score` > incumbent's `joint_task_score`). Cheap check — single comparison against Pareto front.
3. **Only if** the candidate would enter the front, run TARE:
   a. Generate K=3 adversarial paraphrases via Sonnet 4.6 with system prompt: *"Generate an adversarial paraphrase of the prompt below. Preserve task semantics exactly, but vary register, syntax, and vocabulary maximally. Preserve `[[tokens]]` verbatim with no whitespace inside brackets."*
   b. Evaluate candidate + 3 paraphrases on 8-probe screen × 2 targets = 64 evaluations per TARE step.
   c. Compute `sharpness = max(joint_score_i) − min(joint_score_i)` over the 4 evaluations.
   d. Pareto front uses **two objectives**: `joint_task_score` (max) AND `1 − sharpness` (max).
4. Candidates that don't would-enter the Pareto by task score: discarded immediately, no TARE needed.

A prompt that's high-accuracy but brittle under paraphrasing won't enter the Pareto front. A prompt that's slightly lower-accuracy but invariant *does*, if the sharpness objective allows it.

**Cost impact**: ~70% reduction in TARE evaluations (most mutations don't make the Pareto cut). Methodologically equivalent — TARE only matters for candidates that would otherwise be admitted, and we still apply it to all of those.

**This remains the load-bearing methodology innovation over P6.**

### §3.4 Manual reflection protocol — AI-assisted

After every GEPA round, the reflection step is **AI-assisted by Gemini 3.1 Pro Deep Think** (`gemini-3.1-pro-preview` with `thinkingBudget: -1`). This standardises the reflection process, brings a different model family's perspective to per-round failure analysis, and reduces human-fatigue bias over a 20-round run.

**Protocol per round**:

1. **Auto-build reflection input package** (`p7-reflect.mjs`):
   - The round's survivor variant (full prompt text + score breakdown per probe per target)
   - Top 3 failure clusters (dev probes where joint score ≤ 0.4, grouped by stratum/repo/tool)
   - The round's mutation lineage (what operator produced this candidate, from which parent)
   - Trajectory excerpts for each failure (tool calls, agent answers)
   - Current Pareto front summary (variant IDs + scores)
   - Convergence trajectory: joint-best per round so far

2. **Gemini Deep Think reflection call**:
   - System prompt: *"You are a senior IR researcher reviewing a single round of a GEPA prompt-evolution loop for an agentic code-search system. Identify the top 3 failure clusters, propose a structural insight (not a literal prompt edit), assess plateau/breakthrough signals in the trajectory, and recommend whether the human should hand-craft a 4th mutation or inject a hint into the next round's reflector."*
   - Input: the package from step 1
   - Output budget: ~1500 tokens
   - Cost: ~$0.07/round
3. **User reviews Gemini's report** — typically 2-3 minutes per round. Three decision options:
   - **No edit** — round stands as-is, Gemini's analysis logged.
   - **Hand-craft a mutation** — author a 4th mutation manually (informed by Gemini's recommendation), evaluate on next round's screen.
   - **Inject a hint** — modify the next round's reflector prompt with a high-level structural insight (e.g., "in this domain, agents struggle with X — emphasise this in mutations").
4. **Log every decision** in `core/prompt-optimization/data/p7-decisions.md` with format:
   ```markdown
   ## Round N
   ### Gemini Deep Think summary (auto)
   <Gemini's reflection output, verbatim>

   ### Failures observed (top 3)
   - <list of 3 failures + dev probe IDs>

   ### User decision
   - **Action**: no-edit | hand-craft | inject-hint
   - **Rationale**: <1-2 sentences explaining accept/modify/reject of Gemini's recommendation>
   - **Edit content (if any)**: <verbatim>
   ```

**Rules**:

- Hand-edits MUST be motivated by dev-set failures only, never held-out probes. This is the standard for human-in-the-loop GEPA to remain defensible.
- User can ACCEPT, MODIFY, or REJECT Gemini's recommendation — but every decision (incl. no-edit) is logged so the publication writeup can show provenance.
- Gemini's output is treated as advisory, not authoritative. The user retains final call.

**Why Gemini Deep Think specifically**:

- Different family from Kimi K2.6 (the in-loop reflector) — independent perspective, no correlated blind spots.
- Excellent reasoning quality with dynamic thinking (we validated this on the §11.1 review of the plan itself — caught a fatal flaw and proposed 5 creative additions).
- Direct API, ~5-10s per call. No CLI harness overhead.
- Cost ~$0.07/call × 20 rounds = ~$1.40 total. Trivial.

**Total cost added by AI-assisted reflection**: ~$1.40 over the run. Already included in §8 cost envelope under "Reflector + Synth" line (which now spans Kimi K2.6 in-loop reflections + Gemini round-end reviews).

### §3.5 HOMP — held-out model panel + language-transfer

After GEPA converges, the **single unified winning variant** is replayed on:

- **HOMP class A — MiMo-V2.5-Pro** (Xiaomi family) — 30 probes (15 dev + 15 held-out)
- **HOMP class B — Qwen 3.6 Plus via opencode CLI** (alibaba family) — 30 probes (same)

**Pass criterion**: HOMP score on each class ≥ 0.7 × (Maximin × EAS `final_score` on Sonnet+GPT-5.5). Below this floor, the prompt is flagged "model-class-specific" and shipped with the caveat documented.

This catches the common failure mode where an optimised prompt is tuned to specific quirks of the target model classes (Anthropic + OpenAI) and doesn't transfer to open-weights families.

**Why two HOMP classes**: with only 2 production targets, demonstrating cross-family transfer is more meaningful with 2 held-out classes (xiaomi + alibaba) than 1. Cost of second HOMP class is negligible (~$1 marginal).

#### §3.5.1 Language-transfer HOMP probe set (anti-Frankenstein-prompt, per Gemini 2nd-pass §E)

The 5 dev repos (fastify, gin, flask, ripgrep, ai-chatbot) cover JS/TS, Go, Python, Rust. **A prompt over-fit to those AST patterns will silently regress on a language family completely absent from training.** Gemini's worst-case scenario: ship a prompt that scores 0.82 on dev but completely breaks on a C++ repository (header/implementation split unfamiliar) or Java (different package conventions, getter/setter idioms).

**Mitigation — language-absent HOMP probe set**:

- Author **10 additional probes** on a repository in a language NOT represented in the dev set. Recommended: **a Java codebase** (e.g., a recent Apache project on GitHub post-cutoff) — fundamentally different from JS/Go/Py/Rs/TS in package layout, import semantics, getter/setter conventions, and AST shape.
- These 10 probes are run on **HOMP class A (MiMo-V2.5-Pro)** as the primary cross-language test, AND on **BOTH production targets — Sonnet 4.6 AND GPT-5.5-instant** (per GPT-5.5 review §B2 — anti-Sonnet-bias fix; both production targets must validate language-transfer, not just one).
- **Pass criterion**: ≥ 0.6 Maximin score on the language-absent probes across **both** Sonnet AND GPT-5.5. Lower threshold than the 0.7× HOMP gate, because language transfer is a harder ask than model transfer. If GPT-5.5 fails Java but Sonnet passes (or vice versa), prompt is shipped as "single-target-for-non-trained-languages" with that caveat documented.
- File: `core/prompt-optimization/data/p7-language-transfer-probes.json` — committed under `prereg/p7-v1` so the language choice is pre-registered, not post-hoc.

**Cost**: 10 probes × 3 evaluations (MiMo + Sonnet + GPT-5.5) = 30 agent runs ≈ $1 (was $0.50; +$0.50 for GPT-5.5 inclusion). Trivial.

If the prompt fails the language-transfer gate, that's diagnostic information — the GEPA loop overfit AST structures of the dev repos. Decision then forks to §3.7.3 gate-failure handling: ship-with-caveat or re-run-with-language-transfer-as-objective.

#### §3.5.2 Reasoning-mode HOMP gate (operational HOMP)

**The problem**: §1 + §2.3 fix reasoning OFF for both targets during optimization (production-parity for default users, and a budget reality — reasoning premiums would 3-5× the run cost). But power users — disproportionately the ones who care about prompt quality — flip thinking ON. As model defaults shift forward (Sonnet 4.7+ may make thinking the default; OpenAI is migrating reasoning into more tiers), this gap widens.

Reasoning-mode behavior diverges from non-reasoning in ways the loop cannot observe:

1. **Tool-call cadence shifts** — reasoning models pre-plan, often using fewer but more deliberate calls. EAS per-stratum windows (`multi-file-flow: [3, 6]`) calibrated on non-reasoning may misfire.
2. **Routing rules may be ignored** — reasoning models sometimes derive routing from first principles, skipping the prompt's prescriptions. AST-ified `if/then` blocks help less when the model is doing its own decomposition.
3. **Stateful-summarization (anti-RIF) becomes redundant or harmful** — reasoning models manage their own working memory; our rule may conflict.
4. **Pruner-driven length cuts may hurt more** — reasoning-on benefits from richer context to ground its planning; an over-aggressively-pruned prompt may starve the planner.

There's a counter-case: prompt optimization on non-reasoning models *generally* transfers to reasoning (DSPy / Auto-CoT literature). But "generally" is not a number for sweet-search.

**Mitigation — operational HOMP (treat reasoning as a deployment mode, like a HOMP family)**:

- **Class A (operational)**: Sonnet 4.6 with **extended-thinking ON** (Anthropic API `thinking: { type: 'enabled', budget_tokens: 8000 }`)
- **Class B (operational)**: GPT-5.5 reasoning variant (the non-`-instant` tier; OpenAI direct API)
- Run the unified winning prompt against each on the **15 held-out probes** (NOT dev — held-out is intentionally untouched).
- **Pass criterion**: each operational HOMP class must score **≥ 0.7 × final_score** on the held-out probes — identical to the model-family HOMP gate (§3.5).

**Why 0.7× and not 0.85×**: reasoning-mode is a different operational regime, not a different model. We expect *some* drift (reasoning may waste tool calls relative to EAS calibration); 0.7× catches catastrophic failure without rejecting normal mode-drift.

**Cost**: 15 probes × 2 modes = 30 runs. Reasoning premium adds roughly 2-3× per call (~$0.20 vs ~$0.06 baseline). **Total: ~$6 — fits inside the $99 buffer below the $420 hard cap.**

**Scheduling**: runs at the same point as the model-family HOMP (§3.5) — after winner selection, before final ship gate. Implementation: `core/prompt-optimization/sweep/p7-reasoning-homp.mjs`.

**If the gate fails**: fork to §3.7.3:
- **Option 1 (cheap)**: ship as "non-reasoning-default-optimised" with a caveat documenting which target's reasoning mode regressed and by how much. Power users get the caveat in the README.
- **Option 2 (expensive but principled)**: extend the run with reasoning-on as a 5th-objective (treat reasoning-passing as a Pareto dimension). Adds ~$80 marginal. Still under hard cap.

**Honest residual risk**: this gate validates transfer, it doesn't *optimise* for reasoning. If reasoning users diverge sharply enough that the gate fails, we have to fork. The alternative — pulling reasoning into the optimization loop — would 3-5× the run cost and hit the hard cap. Operational HOMP is the right cost/insurance trade.

### §3.6 Post-convergence robustness reporting (SCS)

After unified-winner selection:

1. Generate **6 paraphrases** of the winner via 6 distinct methods (multi-family, post-GPT-5.5 review §C2):
   - 1 reflective rewrite (Kimi K2.6 — moonshot family)
   - 1 OP-3 Persona/Constraint Pivot via Sonnet 4.6 (anthropic family)
   - 1 OP-3 Persona/Constraint Pivot via GPT-5.5-instant (openai family — ensures non-Anthropic paraphrase distribution)
   - 1 deterministic structural paraphrase (programmatic: rules → table form, table → rules form; family-free)
   - 1 OP-4 Tool-Signature Mask + roundtrip (kimi family)
   - 1 manual hand-edit
2. Evaluate winner + 6 paraphrases (= 7 prompt versions) on (15 dev + 15 held-out) = 30 probes × **2 production targets** = 420 agent runs.
3. Compute **Semantic Consistency Score (SCS)** per [ParaConsist (2026)](https://arxiv.org/abs/2605.04665):
   - **Answer Consistency** (AC): `# probes where ≥5 of 7 prompts agree on answer / 30`
   - **Semantic Similarity** (SS): mean cosine similarity of output embeddings (**Gemini Embedding 2**, 768-dim) across the 7 prompts per probe
   - **Length Stability** (LS): `1 − stddev(token_count) / mean(token_count)` per probe, then averaged
   - **SCS** = harmonic mean(AC, SS, LS)
   - **Correctness-weighted SCS** (per GPT-5.5 review §C3 — anti-stable-wrongness): `cw_SCS = SCS × min_paraphrase_accuracy` where `min_paraphrase_accuracy` is the lowest-accuracy paraphrase's correctness-on-gold across the 30 probes. A prompt that consistently gives the same WRONG answer scores high on naive SCS; correctness-weighting collapses it.
4. **Report**: per-target SCS, cw_SCS, and per-paraphrase accuracy delta.
5. **Ship gate**: **cw_SCS ≥ 0.8 across both targets jointly, AND minimum-paraphrase accuracy ≥ 0.6 on both targets** (per GPT-5.5 review §C3 — naive SCS alone is gameable). Naive SCS is reported but does not gate.

#### §3.6.1 Lazy-user query robustness (per Gemini 2nd-pass §D5)

Beyond paraphrasing the system prompt, we also evaluate the winner against **degraded versions of the dev queries** — what real production users actually type. Sweet-search dev probes are well-formed ("Where is the Sink trait defined in the ripgrep repo?"); real users write garbage ("sink trait broken why").

**Procedure**:

**Multi-source degradation** (per GPT-5.5 review §C4 — anti-Sonnet-author-bias):

1. **Deterministic templates** (10 of 25 — family-free, no LLM): drop the trailing `?`, lowercase everything, drop articles ("the"/"a"/"an"), abbreviate package names (`fastify` → `fty`), wrong file extension (`.tsx` → `.js`), partial-stacktrace fragment, telegraphic style.
2. **Sonnet-generated** (8 of 25): Sonnet 4.6 with prompt: *"Rewrite this query as a tired developer would type it into a search bar at 2am: lowercase, missing punctuation, telegraphic, possibly missing context words. Preserve the user's underlying intent. Output the rewritten query only."*
3. **GPT-5.5-generated** (7 of 25): GPT-5.5 with the same prompt — ensures degradation distribution isn't single-family.
4. Run the winning system prompt against both targets on these 25 degraded queries.
5. Compute the score delta vs the well-formed query baseline.
6. **Pass criterion**: degraded-query Maximin score drops by ≤20% on each target individually. If GPT-5.5 alone drops by >20%, that's a target-asymmetry signal — §3.7.3 gate-failure flow kicks in.

**Cost**: 25 degraded queries × 2 targets = 50 extra agent runs ≈ $4 (degradation generation: ~$0.10 amortized).

This is a real shipping concern, not just a publication signal. Production-deployed prompts encounter degraded queries constantly; this gate prevents shipping a brittle artifact.

This (combined with SCS) is the publishable robustness claim that ICLR/NeurIPS reviewers expect.

### §3.7 Single unified prompt — ship policy (Maximin + length penalty, post-Gemini-review)

We ship **one** prompt, not per-target prompts. Gemini 3.1 Pro Deep Think identified two specific issues with the original mean-based scoring that this section now addresses:

- **Variance asymmetry trap**: if GPT-5.4 has higher score variance across probes than Sonnet 4.6, mean-scoring would implicitly become a GPT-5.4 optimizer (chasing the larger absolute deltas in its score space). **Solution**: switch to **Maximin** scoring, which forces the loop to always improve the *weaker* target.
- **GEPA prompt bloat**: reflectors monotonically add rules, never delete them. By round 20 prompts can balloon to 2,500+ tokens, diluting attention. **Solution**: explicit length penalty in the score formula + the OP-5 Pruner mutation operator (§3.2).

#### §3.7.1 Selection mechanics (post-Gemini-second-pass)

1. **Per-target raw score**: for each (variant, probe), compute `score_sonnet(variant, probe)` and `score_gpt5.5(variant, probe)` independently. Each is in `[0, 1]`.
2. **Per-probe joint score** (Maximin): `joint_per_probe(variant, probe) = min(score_sonnet, score_gpt5.5)` — the worse of the two targets on that probe.
3. **Variant-level task score**: weighted-mean of `joint_per_probe` across the dev set, weighted by §3.1's dynamic hard-negative probe weights:
   ```
   task_score(variant) = Σ weight(probe) × joint_per_probe(variant, probe) / Σ weight(probe)
   ```
4. **Efficiency-Adjusted Scoring** (EAS, per Gemini second-pass §B2 + GPT-5.5 review §B1 — symmetric anti-gluttony AND anti-early-stop, per-target per-stratum): the original Gemini formula penalised over-exploration (Sonnet failure mode) but not under-exploration (GPT-5.5 failure mode = "one plausible lexical hit, confident final"). Fix: per-target, per-stratum expected-call windows + evidence-adequacy penalty:

   ```
   # Per-stratum expected calls (authored at probe time, in the probe JSON):
   expected_call_window = {
     'literal-lookup':     [1, 3],   # quick targeted hit
     'multi-file-flow':    [3, 6],   # follow imports/refs
     'behavioral':         [3, 6],
     'no-match':           [2, 5]    # must verify negative, not just guess
   }

   # Per-target tool-call deviation penalty:
   for target in ['sonnet', 'gpt5_5']:
       lo, hi = expected_call_window[probe.stratum]
       calls = tool_calls(variant, target, probe)
       under = max(0, lo - calls)            # GPT-5.5 early-stop case
       over  = max(0, calls - hi)            # Sonnet over-exploration case
       call_deviation_penalty[target] += 0.02 × (under + over)

   # Evidence-adequacy penalty (GPT-5.5 review §B1):
   # If final answer was emitted with NO read/grep/trace tool call AND probe is non-trivial,
   # apply 0.10 penalty regardless of judge's correctness vote — judges reward plausible
   # final answers, but unsupported answers are reward-hacking.
   if final_answer_emitted AND no_read_or_grep_tool_call AND probe.stratum != 'no-match':
       evidence_adequacy_penalty[target] += 0.10

   # Aggregate efficiency factor — per-target then min:
   per_target_factor[target] = 1 − mean(call_deviation_penalty[target] over probes)
                                 − mean(evidence_adequacy_penalty[target] over probes)
   efficiency_factor(variant) = min(per_target_factor['sonnet'], per_target_factor['gpt5_5'])
   ```

   The `min` aggregation is structurally consistent with Maximin: a variant cannot pretend efficiency is fine because Sonnet's call distribution averages out GPT-5.5's reckless early-stops. Probe-stratum-aware windows mean a literal-lookup probe doesn't get penalised for 1 call, but a multi-file probe with 1 call (i.e., no-real-search) DOES.
5. **Length penalty**:
   ```
   length_penalty(variant) = 0.05 × (token_count(variant) / 1000)
   ```
   So a 1000-token prompt loses 5pp; a 2500-token prompt loses 12.5pp.
6. **Final variant score**:
   ```
   final_score = task_score × efficiency_factor − length_penalty
   ```
   This composite is what the Pareto front orders on.
7. **TARE sharpness** uses Maximin too: `sharpness = max(joint_min_score_i) − min(joint_min_score_i)` over candidate + 3 adversarial paraphrases.
8. **Pareto front** (6-element) on two objectives: `final_score` (max), `1 − sharpness` (max).
9. **Pareto admission hard constraint** (FATAL fix per Gemini second-pass §A1, with GPT-5.5 review §C1 anti-utopia-point fix — Maximin race-to-the-middle guard): A candidate cannot enter the Pareto front if it degrades EITHER target's score by more than **0.15** relative to the **incumbent it would displace** (NOT relative to global per-target Pareto maxima — those may be different specialist prompts, creating a "utopia point" constraint that rejects genuinely joint-improving candidates).

   ```
   # Find which incumbent the candidate would displace:
   if candidate Pareto-dominates some incumbent V_dom:
       baseline_sonnet = V_dom.score_sonnet
       baseline_gpt5_5 = V_dom.score_gpt5_5
   else:
       # Candidate is added without displacement; compare to current joint-best
       # (the incumbent with highest final_score) — NOT per-target maxima:
       baseline_sonnet = joint_best_incumbent.score_sonnet
       baseline_gpt5_5 = joint_best_incumbent.score_gpt5_5

   if (baseline_sonnet − candidate_sonnet > 0.15) OR
      (baseline_gpt5_5 − candidate_gpt5_5 > 0.15):
        REJECT (don't add to Pareto, even if Maximin × EAS final_score is higher)
   ```

   **Why displaced-incumbent-relative**: Pareto front may have V_S = (0.91 Sonnet, 0.50 GPT) and V_G = (0.50 Sonnet, 0.91 GPT) as specialist incumbents. The aggregate per-target maxima are (0.91, 0.91) — a "utopia point" no actual incumbent achieves. A new candidate V_C = (0.75, 0.85) is genuinely joint-improving (Maximin 0.75 > both incumbents' 0.50), would Pareto-dominate V_G, and the 0.15 check should compare to V_G (the displaced incumbent: |0.50 − 0.75| = 0 violation on Sonnet, |0.91 − 0.85| = 0.06 violation on GPT — passes). Comparing to per-target maxima (0.91 Sonnet) would reject V_C at 0.91 − 0.75 = 0.16 — incorrectly rejecting the actual joint improvement. GPT-5.5 review §C1 catches Gemini's original 0.15-cap formulation as buggy.

   Without this guard at all, Maximin can mathematically *mandate* shipping a per-target regression. Example: V_A = (Sonnet 0.9, GPT 0.2), V_B = (Sonnet 0.55, GPT 0.55). Maximin prefers V_B (0.55 > 0.2), but V_B is a -0.35 regression for Sonnet users. The 0.15 cap rejects this trade.
10. **Final winner** = the Pareto-front variant with **highest `final_score`**, subject to:
    - **Floor**: per-target dev score ≥ 0.5 (no collapsed targets)
    - **HOMP gate**: passes both HOMP classes at ≥ 0.7× `final_score` (see §3.5)
    - **Language-transfer gate**: passes the language-absent-from-dev HOMP probe set (§3.5.1) at ≥ 0.6 — anti-Frankenstein-prompt guard per Gemini second-pass §E
    - **Reasoning-mode operational HOMP**: passes both reasoning-on classes (Sonnet thinking-ON + GPT-5.5 reasoning) at ≥ 0.7× `final_score` on held-out probes (§3.5.2). Fails → ship-with-caveat for power users, OR fork to reasoning-as-5th-objective extension run.
    - **Robustness gate**: passes correctness-weighted SCS ≥ 0.8 on both targets (§3.6)
    - **Length cap**: ship variant ≤ 2000 tokens
11. **Ship file**: `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` — one file, the unified prompt, headed with a YAML front-matter block citing the run ID, both raw per-target scores, joint Maximin score, EAS factor, avg tool calls, length, length-penalty, final score, SCS, HOMP scores per class incl. language-transfer.

#### §3.7.2 Why Maximin (with the §3.7.1 step 9 admission constraint)

Gemini's first pass suggested Z-score normalization OR Maximin. We chose Maximin because:

- Maximin is interpretable: "the prompt is at least X-good on every target." Reviewers and users get this immediately.
- Maximin matches the user-facing claim: "this prompt does well for MOST users" requires no user is left worse than X.
- Z-score normalization requires estimating per-target variance, which is itself noisy at n=25 probes.

**However, Maximin alone is insufficient** (Gemini's second pass critique §A1): in zero-sum target preferences (e.g., Sonnet wants verbose, GPT-5.5 wants terse), Maximin mathematically mandates a "race to the middle" that ships per-target regressions. The 0.15 absolute-degradation hard constraint (§3.7.1 step 9) closes that loophole. Without it, Maximin would happily promote a variant that scores 0.55/0.55 over a variant that scored 0.9/0.2 — a +0.35 Maximin gain but a -0.35 catastrophic regression for the high-target users.

The combination — Maximin scoring + 0.15 hard constraint + EAS efficiency factor — is the load-bearing ship policy after both Gemini review passes.

#### §3.7.3 If gates fail

- **HOMP < 0.7× OR SCS < 0.8 on either target**:
- **Option 1**: ship with caveat documented (the prompt works for the optimised targets but doesn't generalise to one HOMP class — narrower deployment claim).
- **Option 2**: re-run GEPA from the failed-gate point with the failed gate as an additional optimization objective (turns into a 3-objective Pareto). Adds ~5-8 rounds of cost.

Decision at gate-failure time, not pre-committed.

---

## §4 Variant slate (T1–T15)

### §4.1 P6 grounding — reasoning HARD over Phase 6 data

> **Update 2026-05-11 — supersession by PHASE6_REDO**: the original P6 `recommendations.json`
> (runId `partial-test-1778496156116`) is **deprecated** for `ss-search` shape grounding. The
> replacement is `core/prompt-optimization/data/query-shapes/recommendations-v2.json` produced
> by the PHASE6_REDO run (see `docs/PHASE6_REDO.md`). The new artifact ships a **family-conditioned
> default + per-family overrides** instead of a single flat shape recommendation. T_i variant
> bodies for the `[[ss-search]]` clauses must consume `recommendations-v2.json` schema, NOT the
> deprecated `recommendations.json`. The other three tools (`ss-find`, `ss-semantic`, `structural`)
> retain the prior P6 directional signal in this section until their respective Phase-6 redoes land.
>
> The new schema expects two fields per consumer:
> - `default.instruction_text` — global default, applied when family detection is unavailable or
>   the file's language doesn't map to a known family.
> - `family_overrides[<family>].instruction_text` — per-family override applied when the agent
>   has classified the target file into one of the 5 PHASE6_REDO families (OO-monolithic,
>   Systems-modular-terse, C-family, JS-mobile, Scripting-dynamic). Family detection is a
>   deterministic file-extension → family lookup; the agent does not reason about it.

All four ss-* tools now have PHASE6_REDO artifacts — `ss-search`, `ss-find`, `ss-semantic`,
and `structural`. See §4.2 below for the verbatim recommendations. P6's
`track-b-summary.json:perToolWinRates` is no longer the load-bearing input for any tool's
variant authoring; the per-tool redo artifacts supersede it.

**Historical qshape-v1 directional signal (superseded, kept for cross-reference)** — the
original P6 sweep flagged `structural` as preferring `short+with-symbol+narrow-regex+interrogative+high-density`
at 28% win rate. The 2026-05-14 structural redo confirmed the parser-firing condition but
discovered a stronger finding: phrasing is rank-equivalent once the parser fires (zero
variance across all 5 phrasings within a relationship type, 170/170 probes). The qshape-v1
"interrogative" preference was an artifact of which phrasings happened to fire the parser,
not a ranking signal.

**`ss-search` shape findings from PHASE6_REDO (qshape-v2, 2026-05-13, n=1,424 sweep rows over 18 languages)** — supersedes the deprecated qshape-v1 row above:

| Shape | Global file_recall@1 | Global symbol_recall@1 | Δ vs baseline (symbol) |
|---|---|---|---|
| V_baseline (gold's original phrasing) | 0.575 | 0.420 | — |
| V1 (very-short + symbol + imperative) | 0.736 | 0.528 | +10.8pp |
| V2 (short + symbol + interrogative) | **0.792** ← best file_recall | 0.465 | +4.5pp |
| V3 (short + no-symbol + declarative) | 0.415 | 0.241 | -17.9pp |
| V4 (medium + symbol + interrogative) | 0.750 | 0.500 | +8.0pp |
| V5 (medium + no-symbol + low-density) | 0.241 | 0.127 | -29.3pp |
| V6 (long-NL + no-symbol) | 0.269 | 0.160 | -26.0pp |
| **V7 (medium + symbol + declarative)** | 0.757 | **0.535** ← best symbol_recall | **+11.5pp** |

**Primary metric chosen for `ss-search`: symbol_recall@1.** Rationale: each `ss-search` call should hit the exact symbol chunk; a file-match-only result (PARTIAL) costs a follow-up `ss-semantic` call. V7 wins symbol_recall globally; V4 wins on C-family; V2 saves the file_recall on JS-mobile where V7 ties on symbol_recall but loses 12pp on file_recall. The full per-family breakdown lives in `recommendations-v2.json:cell_table`.

### §4.2 Inferred per-tool guidance (baked into variants)

From the P6 directional signal, the variants encode these tool-specific recommendations:

- **`[[ss-search]]`** (NL hybrid retrieval): **PHASE6_REDO ships THREE distinct strategies** in `recommendations-v2.json` (2026-05-13 amendment). Each strategy populates a separate T_i variant slot so GEPA can evolve and select empirically:

  **Strategy 1 — `simple_global` (single shape, no family detection):** V7. *"Phrase a medium-length declarative noun-phrase query (9-15 tokens) that contains the target symbol verbatim and at least one domain-specific keyword. Skip leading verbs; use the form `<symbol> <symbolType> that <domain noun-phrase>`."*

  **Strategy 2 — `family_conditioned` (family detection + overrides):**
  ```
  classify target file → {OO-monolithic, Systems-modular-terse, C-family, JS-mobile, Scripting-dynamic, unknown}
  if family == C-family:        use V4 (interrogative + symbol)
  if family == JS-mobile:       use V2 (short interrogative + symbol)
  otherwise (incl. unknown):    use V7 default
  ```
    - C-family override (V4): *"For C / C++ / Zig files, phrase a medium-length interrogative query (9-15 tokens) that contains the target symbol verbatim. Use 'how does X …' / 'where does X …' framing; mention at least one neighboring symbol from the same file when known."*
    - JS-mobile override (V2): *"For JS / TS / Dart files, phrase a short interrogative query (4-8 tokens) that contains the target symbol verbatim. Use 'how does X …' / 'where is X defined' framing."*

  **Strategy 3 — `popular_weighted` (agentic-tier weighting, no family detection):** V1. *"Phrase a very-short imperative query (≤ 3 tokens, whitespace-split) consisting of just the target symbol — optionally one descriptor word. Goal: lean on the symbol verbatim and let the hybrid retrieval pipeline do the rest."* Calibrated on agentic-tier weights (TS/Python/Rust = 5) per the 2026 GitHub Octoverse + JetBrains AI Pulse data — winner 51.8% weighted symbol_recall vs V7 49.7%.

  **Secondary metrics (2026-05-14 republish — see `cross-tool-benchmark-audit-2026-05-13.md`):** `recommendations-v2.json` now publishes a `secondary_metrics` block with strict / relaxed_def / file_recall@5 alongside the headline. relaxed_def reads each row's top-1 chunk text from the locked AST-tester-probes repos and counts the row as PASS iff the expected symbol appears with a definition anchor — quantifying the F1 chunker-label artifact (67-83% of ss-search PARTIALs are hidden PASSes per the audit). **Strategy recommendations are unchanged** (default V7, JS-mobile→V2, C-family→V4, popular_weighted V1). Note: the per-shape argmax does flip under relaxed_def (V1 narrowly beats V7 at 0.611 vs 0.598 weighted, mirroring V7-vs-V1's 0.36pp strict tie) — recorded in `secondary_metrics.ranking_stability_check` for transparency. The strategy cells remain stable because gates pin the chosen shape, not the rubric argmax.
- **`[[ss-find]]`** (regex+find): **PHASE6_REDO ss-find redo SHIPPED 2026-05-13** — `recommendations-v2-ss-find.json` ships THREE distinct strategies (7×7 = 49 R×Q grid swept across 144 ast-tester golds, n=7,157 rows). PHASE7 exposes each as a separate T_i variant slot.

  **Strategy 1 — `simple_global` (no family detection):** `R5 × Q3`. *"Build the regex as `\b(<symbol>|<sibling1>|<sibling2>)\b` — small alternation: symbol + 2 graph-neighbour or chunk-sibling identifiers. Phrase the semantic query as a short imperative containing the symbol verbatim (4-8 tokens, e.g., 'find <Symbol> usage')."* Global symbol_recall 60% (+11pp over R2-narrow baseline).

  **Strategy 2 — `family_conditioned` (family detection + 1 override):**
  ```
  classify target file → 5-family lookup (same family-map.mjs as ss-search)
  if family == JS-mobile:       use R3 × Q4
                                regex `\b(function|const|let|var|class|export|async|...)\s+<symbol>\b`
                                query short interrogative + symbol (4-8 tokens, "how does X work")
  otherwise:                    use R5 × Q3 default
  ```
  JS-mobile override gains +16.1pp symbol_recall (54.8% → 71%). The other 4 families tie or trail R5×Q3 by <8pp so they don't trigger overrides — a notably stable signal.

  **Strategy 3 — `popular_weighted` (agentic-tier, no family detection):** `R3 × Q3` (diversity-enforced 2nd-best — natural winner ties Strategy 1's R5×Q3). *"Build the regex as `\b(<family-keyword>)\s+<symbol>\b` — language-keyword + symbol at the definition site. Phrase the query as a short imperative with the symbol verbatim (4-8 tokens)."* Weighted agentic-tier symbol_recall 56.5%; the agent-runtime instruction is simpler than R5 (no sibling inference needed). Distinct from Strategy 1 so GEPA gets genuine candidate diversity.

  **Secondary metrics (2026-05-14 republish — see `cross-tool-benchmark-audit-2026-05-13.md`):** `recommendations-v2-ss-find.json` now publishes a `secondary_metrics` block with strict / relaxed_def / file_recall@5 trios on every strategy entry, plus a global `cell_table` view across all 49 (R, Q) cells. The chunker-label artifact is even more dominant for ss-find (92-100% of PARTIALs are hidden PASSes per the audit); the simple_global cell R2|Q3 jumps from 65.0% strict → 74.1% relaxed_def. **Strategy recommendations are unchanged** (simple_global R2|Q3, JS-mobile override R3|Q4, popular_weighted R5|Q3). The per-cell argmax under relaxed_def shifts to R2|Q1 (78.3%) — recorded in `ranking_stability_check` for transparency. As with ss-search, the strategy cells are pinned by gates, not by rubric argmax.
- **`[[ss-semantic]]`** (in-file span retrieval): **PHASE6_REDO ss-semantic redo SHIPPED 2026-05-13** — `recommendations-v2-ss-semantic.json` ships THREE strategies, primary metric span top-1 IoU. Variants are REUSED VERBATIM from the ss-search V1-V7 corpus (the NL surface is identical; only the retrieval mechanism differs).

  **Strategy 1 — `simple_global`:** V1 (avg IoU 0.332 across 144 ast-tester golds). *"Phrase a very short imperative query consisting of the target symbol verbatim, optionally with one descriptor word (≤ 3 tokens)."*

  **Strategy 2 — `family_conditioned`:**
  ```
  if family == C-family:  use V2 (short interrogative + symbol, 4-8 tokens)
  otherwise:              use V1 default
  ```
  C-family override gains +12.8pp IoU (V1 0.255 → V2 0.383). All other families top-out at V1 within 5pp of each other.

  **Strategy 3 — `popular_weighted`:** V2 (diversity-enforced — natural agentic-tier winner matched Strategy 1). *"Phrase a short interrogative query (4-8 tokens) that contains the target symbol verbatim."* Distinct from Strategy 1 so GEPA gets a real second candidate.

  Confirms the prior qshape-v1 directional hint that ss-semantic loves "very-short + symbol + narrow" — but adds the family-conditioned C-family→V2 finding and the popular-weighted V2 fallback for GEPA diversity.
- **`[[structural]]`** (tree-sitter relationships): **PHASE6_REDO structural redo SHIPPED 2026-05-14** — `recommendations-v2-structural.json` ships THREE strategies per relationship type (callers / callees / impact), primary metric Recall@5 over the gold's `graphNeighbors` set. The redo covered 170 probes (68 callers + 34 callees + 68 impact) derived from existing AST-tester inputs that had non-empty graphNeighbors data, across 14 languages.

  **Empirical headline** (load-bearing for GEPA): every phrasing inside a relationship type produces IDENTICAL Recall@5 (zero variance across P1-P5, 170/170 probes). This is because `structuralSearch.parseStructuralQuery` extracts `(structuralType, targetEntity)` from the NL query and discards the rest — once the parser fires, phrasing is rank-equivalent. The artifact's three strategies (simple_global / family_conditioned / popular_weighted) all collapse to the same canonical phrasing (P3 declarative) by tie-break. The recommendation for PHASE7 is "pick the canonical P3 for predictability; the parser absorbs all variance".

  **Runtime contract** (agent picks phrasing per relationship type detected in the NL query):
  ```
  detect structural intent from the user's NL → {callers, callees, impact, none}
  if intent == none:        do not use structural mode (fall back to hybrid/semantic)
  if intent == callers:     phrase as "callers of <symbol>"            (P3 declarative)
  if intent == callees:     phrase as "callees of <symbol>"            (P3 declarative)
  if intent == impact:      phrase as "impact of refactoring <symbol>" (P3 declarative)
  ```

  **Strategy 1 — `simple_global` (per relationship type):**
    - callers: *"For ss-* structural mode (callers): phrase the NL query as declarative — e.g., 'callers of \<symbol\>'."*
    - callees: *"For ss-* structural mode (callees): phrase the NL query as declarative — e.g., 'callees of \<symbol\>'."*
    - impact:  *"For ss-* structural mode (impact): phrase the NL query as declarative — e.g., 'impact of refactoring \<symbol\>'."*

  **Strategy 2 — `family_conditioned` (per relationship type):** identical to Strategy 1 — no family overrides triggered. The override gate (family-best ≥ 8pp Recall@5 above default) cannot fire because all phrasings tie within a relationship type. This is a real finding, not a missing measurement. Documented as `family_conditioned.overrides: {}` in the artifact.

  **Strategy 3 — `popular_weighted` (agentic-tier, per relationship type):** also identical to Strategy 1 — tie-break to P3 because per-language scores match across phrasings. The artifact emits `alt_so_tier` for reference (also P3).

  **Quality data** (Recall@5 on dev split, n=105 probes / 525 rows): callers 0.298, callees 0.579, impact 0.242. The lower Recall@5 vs ss-search/ss-find reflects a tool-internal limitation: `findCallers`' SQL `WHERE (name = ? OR name LIKE '%X%') LIMIT 1` does not prefer exact matches over LIKE substring matches, so short symbol names (e.g., cpp `Vec`) resolve to arbitrary substring siblings. This is independent of phrasing and is a documented follow-up workstream (independent of this redo's prompt-shape charter).

  **Impact ground-truth model**: 1-hop direct-callers-as-proxy. 2-hop closure recorded as diagnostic; sweep finds 2-hop minus 1-hop = +2.60pp (well under the 15pp escalation threshold) — tool is NOT doing transitive expansion that would invalidate 1-hop GT.

  **Excluded from scope**: `implementations` relationship (only 17 inputs / 12% graph coverage; not on user-prioritized list). C-family probe coverage is genuinely thin (5 dev probes / 0 heldout) — documented as a known limitation in the artifact, not papered over by relaxing the gold-data filter.

These bullets go *verbatim* into the relevant T_i variant bodies. For `[[ss-search]]`, `[[ss-find]]`, `[[ss-semantic]]`, and `[[structural]]`, the bullet is regenerated from the corresponding `recommendations-v2-*.json` whenever that artifact updates.

### §4.3 Variant slate

The 14 hand-authored seed variants are organised along three orthogonal axes:

- **Strategy emphasis**: tool-routing-first vs query-shape-first vs evidence-first
- **Verbosity**: terse / medium / verbose
- **Failure-mode handling**: handles `expectedNoMatch` cases, multi-file flow, behavioral queries

| ID | Strategy | Verbosity | Special handling | P6 grounding | Length target |
|---|---|---|---|---|---|
| T1 | Tool-routing first | Terse | None | uses §4.2 routing rules | ~400 tokens |
| T2 | Tool-routing first | Medium | Multi-file flow | + §4.2 + behavioral routing away from ss-semantic | ~700 tokens |
| T3 | Tool-routing first | Verbose | All | + §4.2 + explicit `expectedNoMatch` handling | ~1100 tokens |
| T4 | Query-shape first | Terse | None | encodes top winRate shapes per-tool from §4.1 | ~400 tokens |
| T5 | Query-shape first | Medium | None | + §4.2 + avoid_shapes warnings | ~700 tokens |
| T6 | Query-shape first | Verbose | All | full §4.1 + §4.2 detail | ~1100 tokens |
| T7 | Evidence-first | Terse | None | citation discipline; ignores P6 routing (control for shape-doesn't-matter hypothesis) | ~400 tokens |
| T8 | Evidence-first | Medium | Multi-file flow | + minimal §4.2 routing for ss-semantic-avoidance only | ~700 tokens |
| T9 | Evidence-first | Verbose | All | + §4.2 + structured citation requirements | ~1100 tokens |
| T10 | Hybrid: tool + shape | Medium | None | full §4.1 + §4.2 + structural-prefers-interrogative | ~700 tokens |
| T11 | Hybrid: tool + evidence | Medium | None | §4.2 routing + citation discipline | ~700 tokens |
| T12 | Minimal baseline (control) | Terse | None | NO P6 grounding (proves §4.1 helps) | ~250 tokens |
| T13 | Aggressive "no-match-first" | Medium | `expectedNoMatch` | + §4.2 + early-exit logic | ~700 tokens |
| T14 | Behavioral-query optimized | Medium | Multi-file flow + behavioral | + §4.2 + ripgrep-sink-trait-style multi-callback handling (the gold class P6 timed out on) | ~800 tokens |
| T15 | **Hypothesis-Driven Backtracking** (per Gemini critique) | Medium | All + structured `<failure_analysis>` blocks | encodes "if a tool returns empty result, write `<failure_analysis>` explaining why the code wasn't there before invoking next tool"; leverages 2026-era LLM test-time-compute even with extended-thinking OFF | ~900 tokens |

**Family-conditioned `ss-search` clauses (post-PHASE6_REDO supersession)**: every T_i whose body contains a `[[ss-search]]` clause and whose `p6_grounding` is `full` or `partial` must consume `recommendations-v2.json` (default + per-family overrides), NOT the deprecated flat `recommendations.json`. The other three tools' clauses (`[[ss-find]]`, `[[ss-semantic]]`, `[[structural]]`) continue to consume the old artifact until their respective Phase-6 redoes ship. T12 (the no-grounding control) remains literally control — no shape clauses for any tool.

**T12 (the no-grounding control) matters**: if T12 wins despite skipping §4.1 guidance, that's evidence that P6's directional signal didn't generalise. If T12 underperforms, the P6 grounding was load-bearing. Either way, useful. The family-conditioned ss-search supersession does NOT change T12's role — T12 stays grounding-free regardless of which P6 artifact is the live one.

**T15 (Hypothesis-Driven Backtracking, added per Gemini critique)** addresses a specific failure mode P6 surfaced: agentic code search often spirals when an early tool call returns empty — the agent blindly tries another query without updating its mental model. T15 forces an explicit `<failure_analysis>` block after any empty result before the next tool invocation, which empirically engages test-time compute even when the agent is in non-reasoning mode (Sonnet thinking-OFF, GPT-5.4-instant). If T15 dominates other variants on the `expectedNoMatch` and behavioural strata, that's a publishable observation in itself.

Each seed is a separate file: `core/prompt-optimization/data/p7-variants/T1.md` … `T14.md`. Each carries YAML front-matter:

```yaml
---
id: T<n>
strategy: tool-routing-first | query-shape-first | evidence-first | hybrid | control
verbosity: terse | medium | verbose
p6_grounding: full | partial | none
special_handling: [no-match, multi-file-flow, behavioral]
expected_strengths: [...]
expected_weaknesses: [...]
target_tokens: <n>
---
```

### §4.4 Why these 14 and not more

14 is the standard slate per the original §6 plan. Going to 20+ seeds dilutes per-seed evaluation; going to 7-10 reduces diversity below GEPA's effective exploration radius. 14 is the published GEPA empirical sweet spot.

---

## §5 Probe set authoring

### §5.1 Dev probes (n=25)

Stratified by:

- **Repo**: 5 from each of fastify, gin, flask, ripgrep, ai-chatbot (the 5 P6 dev repos)
- **Difficulty**: 8 easy, 12 medium, 5 hard (matches a real-user query distribution)
- **Stratum**: 8 literal-lookup, 8 multi-file-flow, 5 behavioral, 4 no-match (negative cases)
- **Trick-probe ratio**: 7 out of 25 = 28% (under the 30% Gemini-3rd-pass §C2 cap to keep the dev set representative of production traffic, not an adversarial gauntlet). Composition: 4 pathology probes from §5.5 (1 wrong-extension + 1 flooding + 2 rabbit-hole) + 3 distractor probes from §5.6. The remaining 3 pathology probes (2 wrong-extension + 1 flooding + 0 rabbit-hole) are deferred to the rotation pool — see §5.3.

Each probe is a JSON record:
```json
{
  "id": "p7-dev-001",
  "repo": "fastify",
  "stratum": "literal-lookup",
  "difficulty": "easy",
  "query": "Where is the Sink trait defined?",
  "expectedFiles": ["lib/foo.js"],
  "expectedSymbols": ["Sink"],
  "expectedFacts": ["Sink", "lib/foo.js"],
  "expectedNoMatch": false,
  "max_turns": 6
}
```

File: `core/prompt-optimization/data/p7-dev-probes.json`

### §5.2 Held-out probes (n=15)

Same structure, frozen. **Authored at the same time as dev to prevent post-hoc bias** but not inspected until winner selection. File: `core/prompt-optimization/data/frozen/p7-heldout-probes.json` — committed under a `frozen/` directory at pre-registration time.

### §5.3 Probe-rotation pool (n=13, post-Gemini-review + 3rd-pass dilution)

To support the mid-run probe rotation at round 11 (§3.1), **13 probes** are authored at the same time as the dev set and committed under `core/prompt-optimization/data/p7-rotation-pool.json`:

- **10 standard rotation probes** (original Gemini 1st-pass design) — held aside to guard against dev-set overfitting after 60+ candidate evaluations.
- **3 deferred trick probes** — 2 wrong-extension + 1 flooding pathology probes moved out of the dev set per Gemini 3rd-pass §C2, so the agent masters the basics first before facing them. These 3 are tagged `tier: deferred-pathology` in the JSON record.

These probes are NOT used during rounds 1–10. At the start of round 11, the 5 lowest-variance dev probes (those everyone has mastered — i.e. `score_variance_across_pareto < 0.1`) are retired and replaced as follows: 2 of the 3 deferred-pathology probes guaranteed-promoted in (the agent must demonstrate it has learned the basics by round 11; this is the test), then 3 highest-difficulty standard rotation probes drawn deterministically by author-assigned difficulty rating.

Rationale: prevents over-fitting to the original 25 dev probes when the GEPA loop has evaluated 60+ candidates against them, and concentrates the trick-probe evaluation in the second half of the run when the agent has mastered the literal-lookup baseline. The rotation membership is pre-registered (committed under `prereg/p7-v1`), so the swap is deterministic and not post-hoc.

### §5.4 Sources for probe content

- **5 probes** drawn from P6 golds NOT in P6's 25-gold subsample (avoids leakage; uses the remaining 65 golds from the 90-gold P6 pool).
- **30-40 hand-authored fresh probes** covering scenarios P6 missed (FreshStack-style post-cutoff repos, error-recovery scenarios, multi-callback behavioural queries that P6's `ripgrep:sink-trait` revealed as hard).
- **All 50 probes** (25 dev + 15 held-out + 10 rotation) labeled by author + date + difficulty + stratum in YAML front-matter.

### §5.5 Pathology probes — code-search domain failure modes (per Gemini 2nd-pass §C, 3rd-pass §C2 dilution)

Seven probes encoding three specific code-search failure modes. Per Gemini 3rd-pass §C2 (avoid >30% adversarial-trick density in dev set), they are split across dev and rotation pool:

| Pathology probe | What it tests | Encoding |
|---|---|---|
| **Wrong-extension death loop** | Query implies `.js`, answer is in `.tsx`. Tests whether prompt instructs agent to *relax file filter before relaxing search term*. | **3 probes total**: 1 in dev set, 2 deferred to rotation pool (§5.3). |
| **Context-window flooding (minified trap)** | Repository contains `dist/bundle.min.js` or `package-lock.json` near the answer. Tests whether prompt instructs agent to *negative-space-route* (skip `dist/`, `build/`, `node_modules/`, large minified files). | **2 probes total**: 1 in dev set, 1 deferred to rotation pool. |
| **Transitive rabbit hole** | Answer is 1-2 hops from the entry point but agent can be tempted into 5+ hops. Tests whether prompt encodes a *depth-limit heuristic*. | **2 probes total**: both in dev set (these are the most-representative-of-production failure mode and warrant continuous evaluation). |

Result: **4 pathology probes in dev** (within the 28% trick-probe budget when combined with the 3 distractor probes in §5.6) + **3 deferred** in rotation pool (faced from round 11 onward). If GEPA's winner doesn't handle them, the prompt is overfit to non-pathological queries.

### §5.6 Poisoned/distractor probes (per Gemini 2nd-pass §D3)

3 of the 25 dev probes contain **adversarial distractor files** in the target repository:

- A file named *exactly what the user is searching for* (e.g., `auth_v2_new.ts`) but containing **deprecated or wrong code with a "moved to X" comment**. The correct answer is the file the comment points to.

This tests **verification, not just retrieval**. A prompt that blindly trusts filenames will fail. A prompt that instructs the agent to *read the file content* before reporting will pass. Implementation: distractor files are added to local fork copies of the dev repos under `eval/repos/<repo>-with-distractors/`, with the addition pre-registered.

### §5.7 Adversarial counter-probes (per Gemini 2nd-pass §B4 — anti-self-fulfilling-prophecy)

Risk: the probe author (human) subconsciously aligns dev probes with the P6 win-rate signal (e.g., authoring structural probes in interrogative form because P6 said `structural` likes interrogative). The GEPA loop would then trivially "validate" P6's signal — but only because the test was rigged.

**Mitigation — adversarial counter-probes**: pass 10 of the original 25 dev probes through Sonnet 4.6 with the system prompt:

> *"Rewrite this code-search query so its surface form is HOSTILE to the following heuristic [insert P6 winRate guidance here, e.g., 'structural tools prefer interrogative + symbol + narrow regex']. Preserve the underlying user intent and gold answer exactly. Make the rewritten query violate the heuristic — terse imperative without symbol, or broad NL without anchor, etc."*

These 10 adversarial counter-probes are added to the held-out set (NOT the dev set — they're a generalization gate, not a training signal). At the end of the run, the winning prompt is evaluated on them. If it scores within 15% of its dev-set score, the P6 signal generalised. If it crashes (>25% drop), the prompt was overfit to query-shape alignment.

File: `core/prompt-optimization/data/frozen/p7-adversarial-counter-probes.json`. Cost: 10 probes × 2 targets at the end of the run = 20 agent runs ≈ $1.

---

## §6 Pre-registration discipline

### §6.1 Tag conventions

| Tag | When | What it freezes |
|---|---|---|
| `prereg/p7-v1` | Before any GEPA run | T1–T14 variants, dev probes, held-out probes, mutation pool spec, judge panel, TARE config, decision log file initialized |
| `release/p7-v1` | Before final headline-number release / Vault opening | The shipped winning prompt |

Both tagged commits MUST include this `PHASE7.md` doc and the variant + probe files at the exact state used for the run.

### §6.2 The decision log

`core/prompt-optimization/data/p7-decisions.md` is the **load-bearing artifact** for human-in-the-loop GEPA defensibility. It's append-only during the run and committed at `release/p7-v1`.

Format per round entry: see §3.4.

### §6.3 What's NOT pre-registered (and why)

- **Termination round**: patience-rule based, not pre-committed. Documented at the end.
- **Manual edits**: their content is not pre-committed (would defeat the purpose), but the *rule* "edits are dev-failure-driven only" is.
- **HOMP threshold (0.7×)**: pre-committed but a ship/no-ship gate, not a soft threshold.

---

## §7 Implementation tasks

The work breakdown:

### §7.1 Code (no big new components — extensions of P6 infra)

| Task | File(s) | Estimated effort |
|---|---|---|
| Add `runMoonshotDirect` (Kimi K2.6) | `eval/agent-read-workflows/judge-runner.js` | 1 hr (mirror runDeepseekDirect) |
| Add `runMiniMaxDirect` (M2.7) | same | 1 hr |
| Add `runOpenAIDirect` (Sonnet-style API path; OpenAI chat completions) | same | 1 hr |
| Add `runAnthropicDirect` (direct Sonnet 4.6 — NOT via Claude CLI / Max plan) | same | 1 hr |
| Add `runMiMoDirect` | same | 1 hr |
| Add `runQwenDirect` (or opencode harness wrapper for HOMP class B) | same | 1 hr |
| Add `runGeminiEmbedding2` (text embeddings, batch + standard) | new file `eval/agent-read-workflows/embeddings.js` | 1 hr |
| GEPA loop driver (joint scoring, Maximin, length penalty, probe rotation, hard-negative weighting) | `core/prompt-optimization/sweep/gepa.mjs` (new) | 1.5 day |
| TARE selection gate (Pareto-gated per §3.3) | `core/prompt-optimization/sweep/tare.mjs` (new) | 0.5 day |
| OP-2 Contrastive Trajectory Crossover | `core/prompt-optimization/sweep/op-trajectory-crossover.mjs` (new) | 0.5 day |
| OP-3 Persona/Constraint Pivot | `core/prompt-optimization/sweep/op-persona-pivot.mjs` (new) | 0.25 day |
| OP-4 Tool-Signature Masking (mask + unmask + stable-token-map per call) | `core/prompt-optimization/sweep/op-tool-mask.mjs` (new) | 0.5 day |
| OP-5 Pruner | `core/prompt-optimization/sweep/op-pruner.mjs` (new) | 0.25 day |
| `[[token]]` validator with whitespace normalization (per Gemini risk D3) | `core/prompt-optimization/sweep/token-validator.mjs` (new) | 0.25 day |
| Probe set authoring tool | `core/prompt-optimization/sweep/author-probes.mjs` (new) | 0.5 day |
| Hard-negative probe weighting (variance-based) | inline in gepa.mjs | included |
| SCS metric calculator | `core/prompt-optimization/stats/scs.mjs` (new) | 0.5 day |
| **Persistence + resume scaffolding** (see §7.4) | `core/prompt-optimization/sweep/p7-persist.mjs` (new) | 0.5 day |
| **Pre-flight checklist runner** (see §7.5) | `core/prompt-optimization/sweep/p7-preflight.mjs` (new) | 0.5 day |
| **Verbose logger** (see §7.6) | inline in gepa.mjs | included above |
| AI-assisted reflection runner (Gemini Deep Think round-end calls) | `core/prompt-optimization/sweep/p7-reflect.mjs` (new) | 0.25 day |
| Decision log scaffold | `core/prompt-optimization/data/p7-decisions.md` template | 1 hr |
| **EAS efficiency-adjusted scoring** + **0.15 Pareto-admission constraint** + **Round-11 Pareto re-baseline** (per Gemini 2nd-pass) | inline in gepa.mjs | 0.5 day |
| **OP-3 AST-ification** sub-mode of Persona Pivot | inline in op-persona-pivot.mjs | 0.25 day |
| **OP-4 domain-stripping** for Tool-Signature Masking | inline in op-tool-mask.mjs | 0.25 day |
| **OP-2 reflection-hint-as-constraint** (anti-schizophrenia) | inline in op-trajectory-crossover.mjs | 0.25 day |
| **Stateful summarization rule** baked into T2/T8/T13/T14/T15 seed variants | content of variant files | included in authoring |
| **Pathology probes** + **poisoned/distractor probes** + **adversarial counter-probes** authoring | distinct sub-tools in `author-probes.mjs` | 0.5 day |
| **Language-transfer HOMP probe authoring** (10 probes on Java/C# repository post-cutoff) | one-time human authoring | 0.5 day |
| **Lazy-user query degrader** (Sonnet 4.6 query-rewriter for §3.6.1) | inline in scs.mjs | 0.25 day |
| Unit tests for new code (incl. token-validator whitespace, Maximin + 0.15 admission, EAS, Pareto-rebaseline at round 11) | `tests/unit/prompt-optimization/p7-*.test.js` | 1.5 day |
| **TPM-aware token-bucket scheduler** + tests for TPM enforcement (per GPT-5.5 review §D1) | `core/prompt-optimization/sweep/p7-token-bucket.mjs` (new) | 0.5 day |
| **Real-fsync persistence wrapper** + kill-9 recovery test (per GPT-5.5 review §D2) | extend `p7-persist.mjs` | 0.25 day |
| **Token-validator multiplicity + unmapped-alias + surplus-token rejection** + tests (per GPT-5.5 review §B5) | extend `token-validator.mjs` | 0.25 day |
| **Per-target per-stratum EAS + evidence-adequacy penalty** (per GPT-5.5 review §B1) | inline in `eas.mjs` | 0.5 day |
| **Pareto admission cap relative to displaced incumbent** (per GPT-5.5 review §C1) | inline in `gepa.mjs` | 0.25 day |
| **OP-2 target-tagged trajectory ingestion + balanced-pair logic** (per GPT-5.5 review §B3) | inline in `op-trajectory-crossover.mjs` | 0.25 day |
| **OP-3 generator rotation (Sonnet/Kimi/GPT-5.5) + non-executable pseudocode labelling** (per GPT-5.5 review §C2/§B4) | inline in `op-persona-pivot.mjs` | 0.25 day |
| **Correctness-weighted SCS** + minimum-paraphrase-accuracy gate (per GPT-5.5 review §C3) | inline in `scs.mjs` | 0.25 day |
| **Hard-negative weighting noise floor + 2-round stability gate** (per GPT-5.5 review §C5) | inline in `gepa.mjs` | 0.25 day |
| **Forensic-metadata JSONL extension** (per GPT-5.5 review §D4) | inline in `gepa.mjs` + `judge-runner.js` | 0.5 day |
| **Multi-source lazy-user degrader** (deterministic + Sonnet + GPT-5.5) (per GPT-5.5 review §C4) | inline in `lazy-user-degrader.mjs` | 0.5 day |
| **OpenAI tier ≥ 2 pre-flight check** (per GPT-5.5 review §D1) | inline in `p7-preflight.mjs` | 0.25 day |
| **Reasoning-mode operational HOMP runner** (Sonnet thinking-ON + GPT-5.5 reasoning over held-out probes; §3.5.2 — user catch) | `core/prompt-optimization/sweep/p7-reasoning-homp.mjs` (new) | 0.5 day |
| **Total** | | **~14.5 days** |

### §7.4 Persistence + resume — MANDATORY

P6 burned hours when a run died at hour 3 with no resume path. P7 must NOT repeat that. The contract:

1. **Append-only JSONL** — `core/prompt-optimization/data/results/p7-v1/gepa-trajectory.jsonl` is written to after EVERY:
   - Mutation generation (one row per mutation: `_kind: 'mutation', round: N, source_op: 'reflective|trajectory-crossover|persona-pivot|tool-mask|pruner', new_prompt_hash: ..., parent_hash: ...`)
   - Screen result (one row per (mutation × probe × target): `_kind: 'screen', mutation_hash: ..., probe_id: ..., target: 'sonnet|gpt-5.5', score: ..., wall_ms: ..., tool_calls: ...`)
   - Confirm result — must include the **full EAS modifier breakdown PLUS forensic run metadata** (per Gemini 3rd-pass §E + GPT-5.5 review §D4 — without these, GPT-vs-Sonnet deltas cannot be explained post-hoc):
     ```json
     {
       "_kind": "confirm",
       "round": 7,
       "mutation_hash": "abc123",
       "prompt_hash": "0xdeadbeef",
       "probe_id": "p7-dev-014",
       "probe_hash": "0xc0ffee",
       "probe_stratum": "multi-file-flow",
       "target": "sonnet",
       "model_id": "claude-sonnet-4-6-20260115",
       "api_path": "https://api.anthropic.com/v1/messages",
       "temperature": 1.0,
       "tool_schema_version": "ss-v3",
       "repo_commit": "52904f6",
       "raw_sonnet": 0.78,
       "raw_gpt5_5": 0.71,
       "maximin_base": 0.71,
       "tool_calls": 4,
       "expected_call_window": [3, 6],
       "call_deviation_penalty": 0.0,
       "evidence_adequacy_penalty": 0.0,
       "eas_factor": 1.0,
       "token_count_prompt": 1820,
       "length_penalty": 0.091,
       "final_score": 0.619,
       "input_tokens": 11842,
       "output_tokens": 1893,
       "cache_read_tokens": 4096,
       "result_bytes": 9214,
       "retry_count": 0,
       "judge_panel": ["deepseek-v4-flash", "gemini-3.1-flash-lite", "minimax-m2.7"],
       "wall_ms": 4112
     }
     ```
   - **Pareto-rejection telemetry** (mandatory new event — without this the loop's decisions look like black-box hallucinations):
     ```json
     {
       "_kind": "pareto-rejection",
       "round": 7,
       "mutation_hash": "abc123",
       "reason": "0.15-cap-violation" | "dominated" | "language-transfer-gate" | "scs-gate" | "lazy-user-gate",
       "target_degraded": "sonnet" | "gpt5_5" | null,
       "drop": 0.22,
       "incumbent_being_compared": "T7-r3"
     }
     ```
   - TARE adversarial probe (`_kind: 'tare-adversarial'`)
   - Pareto update (`_kind: 'pareto-update', round: N, front: [hashes]`)
   - **Round-11 re-baseline event** (per §3.1): `_kind: 'pareto-rebaseline', round: 11, before_front: [...], after_rebaseline_scores: {...}, evictions: [...]`
   - Manual reflection (`_kind: 'manual-reflection', round: N, decision: ..., motivation: ...` — content lives in `p7-decisions.md`)
2. **`fsync` on every append — explicit, not platform-dependent** (per GPT-5.5 review §D2): `appendFileSync` does NOT guarantee `fsync` on macOS or Linux. Open the fd, write, call `fs.fsyncSync(fd)`, close — every event:
   ```js
   const fd = fs.openSync(jsonlPath, 'a');
   try {
     fs.writeSync(fd, JSON.stringify(event) + '\n');
     fs.fsyncSync(fd);  // mandatory — without this, kernel may delay writeback
   } finally {
     fs.closeSync(fd);
   }
   ```
   Wrapper helper: `core/prompt-optimization/sweep/p7-persist.mjs:appendFsynced(path, event)`. Unit-test: kill -9 mid-write, verify last full event is recoverable.
3. **Variant + mutation prompt content stored separately** — `core/prompt-optimization/data/results/p7-v1/prompt-bank.jsonl` (one row per unique prompt-hash → full text). Trajectory references prompts by hash to keep the trajectory file small.
4. **Pareto front state cached** — every Pareto update also writes `core/prompt-optimization/data/results/p7-v1/pareto-current.json` (atomic write + rename). On resume, reload this directly.
5. **Resume flag** — `--resume` on `gepa.mjs` re-reads the trajectory + prompt bank + pareto-current, computes "where were we", and continues. Missing rounds are detected and re-run from scratch (idempotent step IDs prevent double-execution).
6. **Crash recovery test** — unit-tested: run 3 rounds, kill mid-confirm, resume, verify the resumed run reaches the same Pareto front state as a fresh run with the same seed.

If a 4-hour run dies at hour 2.5, resume picks up at the partial round and finishes. **No re-spending.**

### §7.5 Pre-flight checklist — MANDATORY before every run

Before starting a real run, `node core/prompt-optimization/sweep/p7-preflight.mjs --run p7-v1` must pass ALL of these:

| Check | What it does | Pass criterion |
|---|---|---|
| API keys present | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, `MINIMAX_API_KEY`, `MIMO_API_KEY` (or Together fallback for MiMo / Qwen) | All defined and ≥10 chars |
| Smoke each lineage | One short call to each direct API (system="say hi", user="ok") | All return non-empty text within 30s |
| OpenAI tier ≥ 2 | `GET https://api.openai.com/v1/usage/tier` (or compute from observed RPM) | Tier ≥ 2 — else surface "wall-time will be 6× longer at Tier 1; pay $50 to upgrade" and require `--allow-tier-1-gpt5` flag (per GPT-5.5 review §D1) |
| Anthropic tier ≥ 2 | check via headers from a smoke call | Tier ≥ 2 — Tier 1 throughput is too constrained for a 20-round run |
| Token-bucket scheduler self-test | feed scheduler 100 fake calls; verify it blocks at TPM ceiling | scheduler enforces TPM, not just RPM |
| Embedding API smoke | Call Gemini Embedding 2 with "test" → expect 768-dim vector | Vector returned, correct dim |
| `~/.gemini/settings.json` auth | Confirm `selectedType: "gemini-api-key"` (not `oauth-personal`) | Match — else AUTO-FIX (with backup) |
| Orphan process check | `pgrep -f "track-b\|gepa\|aqe-mcp\|_ss-helpers"` | Count ≤ 5 (user's interactive sessions); else surface and ask user to clean |
| Disk space | ≥ 5GB free under `core/prompt-optimization/data/results/` | yes |
| Git tree clean (or near-clean) | `git status --short` shows ≤ 2 modified files (the run produces uncommitted artifacts) | warn if dirty |
| Pre-registration tag | `prereg/p7-v1` exists and points to current HEAD | yes — else require `--allow-no-prereg` flag |
| Probe sets exist + frozen | `p7-dev-probes.json` and `frozen/p7-heldout-probes.json` both exist; held-out file is git-tracked at the prereg tag | yes |
| Variant slate complete | T1.md … T14.md all exist with valid YAML front-matter | 14 files, all valid |
| Decision log initialized | `p7-decisions.md` exists with at least the header | yes |

Failing any check ABORTS with a clear error message. The pre-flight script exits 0 only when all pass.

### §7.6 Verbose logging — MANDATORY

P6's verbose progress logging was the difference between "diagnose in 5 min" and "diagnose in 5 hours." P7 keeps the same format and tightens it:

1. **Per-call start/done lines** to stdout AND to `/tmp/p7-v1-run.log` (via `tee`):
   ```
   [HH:MM:SS] gepa: round 7 start, fronts=6, patience=2/5, plateau-bt=NO
   [HH:MM:SS] gepa: round 7 mut 1/3 reflective on T4-r3 → new T4-r3-m1
   [HH:MM:SS] gepa: round 7 mut 2/3 trajectory-crossover T4-r3 × T7-r2 (target-tagged: sonnet+gpt5.5) → T-x-007
   [HH:MM:SS] gepa: round 7 mut 3/3 persona-pivot T6-r1 → T6-r1-pp1 (tokens preserved: 7/7, multiplicity OK, no surplus)
   [HH:MM:SS] gepa: round 7 screen 16/16 sonnet+gpt5.5 t=43.2s mean=0.61 (best=T-l-007)
   [HH:MM:SS] gepa: round 7 confirm 50/50 t=128s sonnet=0.68 gpt5.5=0.72 joint=0.70
   [HH:MM:SS] gepa: round 7 tare 12/12 t=31s sharpness=0.07 → joint_score=0.70 sharpness_score=0.93
   [HH:MM:SS] gepa: round 7 pareto: ADD T-l-007, evict T2-r0 (joint 0.66 → 0.70)
   ```
2. **Rate-limit telemetry** — every API call records `latency_ms`, `retry_count`, `provider_status_code` to the trajectory JSONL. If retry count for any provider exceeds 3 within a 60-second window, log a WARN and (optionally) auto-throttle that lineage's concurrency for the next round.
3. **Round summary** at end of each round: 1-line digest of `(round, joint_score_best, joint_score_mean, sharpness_best, n_pareto, wall_clock)` printed in green.
4. **Heartbeat** — if no progress event for 60s, print a heartbeat with the in-flight call counts. P6 had stretches with no output; that won't repeat.

### §7.7 Concurrency policy — TPM-aware token-bucket scheduling

**Critical correction per GPT-5.5 review §D1**: RPM-only concurrency math is wrong. TPM (tokens-per-minute) is typically the binding constraint at lower tiers — GPT-5.5 Tier 1 has 500 RPM but only 30,000 TPM, and our agent runs are ~12,000 input + ~2,000 output tokens each. Naive RPM=500 would suggest 30 concurrent calls, but 30 × 12K = 360K tokens in flight = 12× over TPM and would 429-storm minute-one.

**The correct formula** (every direct-API target):

```
max_calls_per_min = floor(min(
    RPM,
    ITPM / estimated_input_tokens_per_call,
    OTPM / estimated_output_tokens_per_call
))
max_concurrent = ceil(max_calls_per_min × avg_call_duration_seconds / 60)
```

Implemented in `core/prompt-optimization/sweep/p7-token-bucket.mjs` — token-bucket scheduler that tracks rolling 1-min windows for both requests and tokens, blocks until budget is available, and logs `_kind: 'rate-limit-throttled', target, wait_ms` events to the trajectory.

**Practical concurrency targets** (computed from §14 tier tables; assume ~12K in / 2K out per agent run):

| Bucket | Tier | RPM | ITPM | OTPM | calls/min | Practical concurrent |
|---|---|---|---|---|---|---|
| Sonnet 4.6 | 1 | 50 | 30K | 8K | min(50, 2.5, 4) = **2-3/min** | **~1-2** |
| Sonnet 4.6 | 2 | 1,000 | 80K | 16K | min(1000, 6.6, 8) = **6-8/min** | **~6-8** |
| Sonnet 4.6 | 3 | 2,000 | 160K | 32K | min(2000, 13, 16) = **~13/min** | **~12-13** |
| GPT-5.5-instant | 1 | 500 | 30K | n/a | min(500, 2.5) = **~2-3/min** | **~2-3** |
| GPT-5.5-instant | 2 | 5,000 | 450K | n/a | min(5000, 37) = **~37/min** | **~30** |
| GPT-5.5-instant | 3 | 5,000 | 800K | n/a | **~66/min** | **~30** (RPM cap) |
| Kimi K2.6 / DeepSeek-V4-Flash / MiniMax M2.7 / Gemini-Flash-Lite | n/a | dynamic | dynamic | dynamic | direct-API tier-2+ | **30** each |
| Gemini Embedding 2 | n/a | ~1500 | n/a | n/a | text-only embeddings ≪ TPM | **20** |
| Total CLI-harness calls (Qwen HOMP via opencode) | n/a | n/a | n/a | n/a | local subprocess contention | **8** |

**Operational implication**: at OpenAI Tier 1 + Anthropic Tier 2, total agent throughput is ~6–8 calls/min on Sonnet and ~2–3 on GPT-5.5. A 20-round run with ~3,640 joint runs would take ~12 days wall-clock if Tier 1 GPT-5.5. **Bumping OpenAI to Tier 2 ($50 paid + 7d) is operationally mandatory** — a one-time $50 cost cuts wall-time from ~12 days to ~2 days. Verify the user's tier in the §7.5 pre-flight check.

Rule: **NO CLI harness for any stateless call** — judges, reflector, synthesizer, paraphraser ALL use direct API. Only AGENTS can use a CLI harness, and only the Qwen target (HOMP class B) does.

### §7.2 Authoring (human work)

| Task | Estimated effort |
|---|---|
| T1–T14 variant authoring (seeded from P6 winRate data) | 0.5 day |
| 25 dev probes | 0.5 day |
| 15 held-out probes (then frozen) | 0.5 day |
| Pre-reg doc finalization + tag | 0.25 day |
| **Total** | **~1.75 days** |

### §7.3 Run execution

| Phase | Wall time |
|---|---|
| Authoring + tagging | 1.5 days human time |
| Code (above) | 3.5 days |
| GEPA execution per target (20 rounds, ~1 hr each) | ~20 hrs/target × 3 targets = ~60 hrs (parallelizable across targets) |
| HOMP replay + SCS computation | ~2 hrs |
| Manual reflection between rounds | 5–10 min/round × 20 rounds × 3 targets = ~10 hrs human time |
| **Total wall time** | **~5 days human, ~3 days API time (overlappable)** |

---

## §8 Cost envelope (post-Gemini-review revisions)

**Key cost-relevant changes from the original draft**:

- **Codex target stays GPT-5.5-instant** (cost $5/$30 per 1M, ~$0.11/run). Gemini's critique recommended GPT-5.4 to save ~$100 based on a transfer-asymmetry claim that we couldn't verify. The user's counter-argument — that GPT-5.5 is a new pretrain family (corroborated by the 2× pricing jump from 5.4 and the discrete launch event on April 23, 2026), and future GPT-5.6+ will be 5.5-derived — wins on shelf-life grounds. **Optimising for 5.5 buys longer artifact relevance**; the +$112 cost is the price of future-proofing. Post-hoc backwards-compat replay on GPT-5.4 (~$5) covers users still on the previous tier. See §11.2 for full rationale.
- **TARE adversarial probes are Pareto-gated** (only run on candidates that would enter the front by task score) — saves ~70% of TARE budget per §3.3.
- **Latent-interp removed** (was scientifically invalid). Replaced by OP-2 Contrastive Trajectory Crossover, which uses Kimi K2.6 reasoning calls and reuses already-collected agent trajectories — net cheaper.
- **ja-pivot in the loop removed** (translation-invariance concern). Replaced by OP-3 Persona Pivot — same cost (Sonnet calls), better diversity.
- **Two new operators added**: OP-4 Tool-Signature Masking (Kimi calls), OP-5 Pruner (Kimi calls). Both cheap.
- **Maximin objective**: identical compute cost to mean — same per-probe agent runs, just different aggregation.
- **Mid-run probe rotation**: 5 new probes drawn from the 10-probe held-aside pool at round 11. No marginal cost in run-time (same 25 probes per round, just different membership).
- **Dynamic hard-negative probe weighting**: zero marginal cost, just changes the score formula.

**Joint per-target workload** (Sonnet 4.6 + GPT-5.5-instant):

| Bucket | Per joint round | × rounds | Joint runs |
|---|---|---|---|
| Variant ablation (T1–T15 × 25 probes × 2 targets) | 375 × 2 = 750 | 1 | **750** |
| GEPA evolution (3 mutations × 8 screen × 2 + 1 survivor × 25 confirm × 2 = 98) | 98 | 20 | **1960** |
| TARE adversarial (Pareto-gated; ~30% of survivors qualify; 3 paraphrases × 8 screen × 2 targets × ~6 qualifying candidates) | — | — | **~150** |
| Super-variants ablation (5 super × 25 × 2) | — | — | **250** |
| Held-out validation (1 winner × 15 × 2) | — | — | **30** |
| Robustness pivots (6 paraphrases × 30 × 2) | — | — | **360** |
| Round-11 Pareto-front re-baseline (6 incumbents × 5 new probes × 2 targets) — Gemini 2nd-pass §B1 | — | — | **60** |
| GPT-5.5 added to Java language-transfer HOMP (10 probes × 1 extra target) — GPT-5.5 review §B2 | — | — | **10** |
| Reasoning-mode operational HOMP (Sonnet thinking-ON + GPT-5.5 reasoning × 15 held-out probes) — §3.5.2 user catch | — | — | **30** |
| Lazy-user degraded queries (25 × 2 targets) — Gemini 2nd-pass §D5 | — | — | **50** |
| Adversarial counter-probes on winner (10 × 2) — Gemini 2nd-pass §B4 | — | — | **20** |
| Language-transfer HOMP probes (10 × Sonnet only as the production check) — Gemini 2nd-pass §E | — | — | **10** |
| **Total joint runs** | | | **~3680** |

Cost split:

| Target | Runs | Per-run | Cost |
|---|---|---|---|
| Sonnet 4.6 (Anthropic direct API, $3/$15 per 1M, ~10K in + 2K out) | ~1820 | $0.06 | **$109** |
| GPT-5.5-instant (OpenAI direct API, $5/$30 per 1M, ~10K in + 2K out) | ~1820 | $0.11 | **$200** |
| (optional) GPT-5.4 backwards-compat replay of winner (~30 probes × $0.055) | 30 | $0.055 | **$1.65** |

**Targets total: ~$309 + $2 backwards-compat replay**.

Other roles:

| Bucket | Calc | Cost |
|---|---|---|
| Reflector (Kimi K2.6 reasoning, OP-1 + OP-2 trajectory-crossover when applicable) | ~30 calls × $0.013 | $0.39 |
| AI-assisted manual-reflection (Gemini 3.1 Pro Deep Think, between every round) | 20 calls × $0.07 | $1.40 |
| OP-3 Persona Pivot (Sonnet 4.6, single rewrite) | ~7 calls × $0.045 | $0.32 |
| OP-4 Tool-Signature Masking (Kimi K2.6) | ~7 calls × $0.013 | $0.09 |
| OP-5 Pruner (Kimi K2.6, smaller call ~3K in + 1K out) | ~6 calls × $0.008 | $0.05 |
| TARE adversarial paraphraser (Sonnet 4.6, Pareto-gated) | ~18 calls × $0.045 | $0.81 |
| Synthesizer (Kimi K2.6 reasoning) | 5 super-variant merges × $0.013 | $0.07 |
| Judges (3-panel × 2 swaps × ~15 candidates × 25 probes × 2 targets) | ~4500 calls × $0.0007 avg | $3.15 |
| HOMP class A — MiMo-V2.5-Pro × 30 probes | 30 runs × $0.011 | $0.33 |
| HOMP class B — Qwen 3.6 Plus × 30 probes | 30 runs × $0.022 | $0.66 |
| SCS robustness embeddings (Gemini Embedding 2 for SS metric only — NOT for any mutation operator anymore) | ~250 calls × ~1K tokens × $0.20/1M | $0.05 |
| IAA (judge-only cost; human time NOT included) | ~180 calls × $0.0007 | $0.13 |

**Other roles total: ~$9** (incl. $1.40 AI-assisted reflection + new lazy-user query degrader at ~$0.30 + adversarial counter-probe authoring via Sonnet at ~$0.25).

**Headline total: ~$327** (incl. $2 backwards-compat replay + $1.40 Gemini Deep Think reviews + ~$10 of Gemini 2nd-pass-driven additions + ~$1 of GPT-5.5 review-driven additions + **$6 reasoning-mode operational HOMP** per §3.5.2 — Sonnet thinking-ON + GPT-5.5 reasoning over 15 held-out probes, validating transfer to power-user reasoning mode), with safety buffer = **$420 hard cap**. **One-time $50 OpenAI Tier-2 upgrade is operationally mandatory** (per GPT-5.5 review §D1) but not part of the run cost — it's a prerequisite for reasonable wall-time.

This is **$99 more than a GPT-5.4 run would cost**. The user accepted this premium for pretrain future-proofing; rationale documented in §11.2.

**Mid-run early-stop**: actual cost may be substantially lower if the patience rule fires before round 20. A run that converges at round 12 saves ~$80 (8 rounds × ~$10/round). User reviews convergence between rounds and can call early stop at any point — see §3.1 patience + plateau-breakthrough rules.

### §8.1 Compression options (if budget tighter)

| Cut | Savings | Trade-off |
|---|---|---|
| Reduce GEPA rounds 20 → 15, patience 5 → 3 | -$45 → **~$162** | Risk: not at convergence on hard probes; plateau-breakthrough rule helps |
| Reduce dev probes 25 → 20 | -$28 → **~$179** | n=20 is workable; below pair-floor for some BH-FDR-style stats but those are out-of-scope here |
| Drop OP-4 Tool-Signature Masking (revert slot 3 to OP-3/OP-5 cycle of 2) | negligible savings | Lose the cognitive-forcing operator — methodologically less creative |
| Disable mid-run probe rotation | $0 | Higher overfit risk on the original 25 |
| Reduce SCS post-convergence paraphrases 6 → 4 | -$3 | Marginal; not worth |
| **All cuts above** | → **~$130** | Methodologically thinner but still defensible |

### §8.2 Recommended bundle ($207 with $270 cap)

Keep the full 20 rounds, full TARE Pareto-gating, full 6-paraphrase SCS, 25-probe dev, mid-run probe rotation, and ALL five mutation operators. **The methodology is the value-add over P6 and over the original draft of this plan** — don't cut it.

The user explicitly chose to invest in scientific rigour while remaining budget-conscious. ~$207 (down from the original ~$227 estimate, even after adding GPT-5.4 and the new operators) is the right answer for that intent.

---

## §9 File conventions

```
docs/
└── PHASE7.md                                 (this file)

core/prompt-optimization/
├── data/
│   ├── p7-variants/
│   │   ├── T1.md  ... T15.md                 (15 seed variants, P6-grounded per §4.2,
│   │   │                                      T15 = Hypothesis-Driven Backtracking,
│   │   │                                      with [[token]] markers and YAML front-matter)
│   ├── p7-dev-probes.json                    (25 probes — see §5.1)
│   ├── p7-rotation-pool.json                 (10 probes — held aside for mid-run rotation
│   │                                          at round 11; see §5.3)
│   ├── p7-pathology-probes.json              (7 probes — wrong-extension, flooding,
│   │                                          rabbit-hole; see §5.5; included in dev set)
│   ├── p7-distractor-probes.json             (5 probes — poisoned/distractor; see §5.6)
│   ├── p7-counter-probes.json                (10 adversarial counter-probes — Sonnet rewrites
│   │                                          of dev probes with anti-P6-shape phrasing;
│   │                                          §5.7; evaluated only at end of run)
│   ├── p7-langtransfer-probes.json           (10 Java-language HOMP probes; §3.5.1;
│   │                                          Sonnet-only; ≥0.6 score required to ship)
│   ├── p7-lazyuser-probes.json               (degraded-query versions of dev probes; §3.6.1)
│   ├── frozen/
│   │   └── p7-heldout-probes.json            (15 probes — DO NOT INSPECT during evolution;
│   │                                          tracked under prereg/p7-v1 tag)
│   ├── p7-decisions.md                       (append-only manual reflection log; §3.4)
│   └── p7-final/
│       ├── sweet-search-system-prompt.md     (THE shipped unified prompt; §3.7)
│       ├── recommendations.json              (run report: Maximin score, per-target scores,
│       │                                      length-penalty applied, SCS, HOMP per class,
│       │                                      decision-log link, alias-mapping audit log)
│       └── per-target-scorecards.json        (post-hoc analysis: how the unified prompt
│                                              performs on each target individually)
├── results/
│   └── p7-v1/
│       ├── gepa-trajectory.jsonl             (append-only: every mutation, screen, confirm,
│       │                                      TARE-adversarial, pareto-update event;
│       │                                      load-bearing for resume — §7.4)
│       ├── prompt-bank.jsonl                 (one row per unique prompt-hash → full text)
│       ├── pareto-current.json               (atomic-write current Pareto front state)
│       ├── homp-replay.jsonl                 (MiMo + Qwen HOMP outputs, both classes)
│       ├── scs-report.json                   (final paraphrase-invariance scores)
│       └── preflight-snapshot.json           (preflight check results at run start)
└── sweep/
    ├── gepa.mjs                              (loop driver — Maximin scoring, length penalty,
    │                                          probe rotation, hard-negative weighting,
    │                                          persistence)
    ├── tare.mjs                              (Pareto-gated sharpness selection)
    ├── op-trajectory-crossover.mjs           (OP-2: Contrastive Trajectory Crossover —
    │                                          replaces the rejected latent-interp)
    ├── op-persona-pivot.mjs                  (OP-3: Persona/Constraint Pivot —
    │                                          replaces the rejected ja-pivot)
    ├── op-tool-mask.mjs                      (OP-4: Tool-Signature Masking)
    ├── op-pruner.mjs                         (OP-5: Pruner — bloat control)
    ├── token-validator.mjs                   ([[...]] preservation + whitespace
    │                                          normalization)
    ├── author-probes.mjs                     (utility for probe authoring)
    ├── p7-persist.mjs                        (resume scaffold — §7.4)
    ├── p7-preflight.mjs                      (pre-run checklist — §7.5)
    ├── p7-reflect.mjs                        (AI-assisted reflection runner —
    │                                          calls Gemini Deep Think between rounds; §3.4)
    ├── eas.mjs                                (Efficiency-Adjusted Scoring — efficiency
    │                                          factor + length penalty + 0.15 Pareto
    │                                          admission constraint; §3.7.1)
    ├── pareto-rebaseline.mjs                  (Round-11 Pareto-front re-baselining on the
    │                                          new probe set; §3.1)
    ├── lazy-user-degrader.mjs                 (multi-source query degrader: deterministic
    │                                          templates + Sonnet + GPT-5.5; §3.6.1 per
    │                                          GPT-5.5 review §C4)
    ├── p7-token-bucket.mjs                    (TPM-aware concurrency scheduler; §7.7
    │                                          per GPT-5.5 review §D1)
    ├── p7-persist.mjs                          (extends with appendFsynced wrapper using
    │                                          fs.fsyncSync; §7.4 per GPT-5.5 review §D2)
    ├── p7-reasoning-homp.mjs                  (operational HOMP runner: Sonnet
    │                                          thinking-ON + GPT-5.5 reasoning on
    │                                          held-out probes; §3.5.2 — user catch)
    └── (existing P6 files unchanged)

core/prompt-optimization/stats/
└── scs.mjs                                   (Semantic Consistency Score calculator)

eval/agent-read-workflows/
├── judge-runner.js                           (extended: runAnthropicDirect, runOpenAIDirect,
│                                              runMoonshotDirect, runMiniMaxDirect,
│                                              runMiMoDirect, runQwenDirect)
└── embeddings.js                             (NEW — Gemini Embedding 2 client)

tests/unit/prompt-optimization/
├── p7-gepa.test.js                           (loop logic, joint scoring, resume)
├── p7-tare.test.js                           (sharpness computation)
├── p7-scs.test.js                            (Semantic Consistency Score)
├── p7-trajectory-crossover.test.js          (OP-2 reflection-hint-as-constraint behavior)
├── p7-persona-pivot.test.js                  (OP-3 + AST-ification + token validator)
├── p7-tool-mask.test.js                      (OP-4 + domain-stripping reflector prompt)
├── p7-eas.test.js                            (efficiency factor + length penalty + admission)
├── p7-pareto-rebaseline.test.js              (Round-11 re-baselining math)
└── p7-preflight.test.js                      (pre-flight checks behaviour on missing keys etc.)
```

---

## §10 Risk register / known limitations

| Risk | Mitigation | Residual |
|---|---|---|
| **Manual reflection introduces researcher bias** | Decision log committed; rule "edits motivated by dev failures only, never held-out" | Acceptable for human-in-the-loop GEPA per literature (see [PromptBreeder, GEPA papers]) |
| **3-judge panel is below §11.6's 5-of-5 disjoint jury** | Document as deviation in the limitations section. 7 disjoint families across all roles is stronger than naive 3-of-5. | Acceptable for engineering-tier; flag for publication track |
| **Single seed=42 run; no replication** | Document; replicate with seed=43 only if a result is on the publication path | Variance bounds unmeasured |
| **DeepSeek reflector overlap** — DSv4-Flash judge correlates with potential future DSv4-Pro reflector use | Currently use Kimi K2.6 reflector → no overlap | None for this run |
| **Held-out probes may overlap with P6 golds** by accident | Probes drawn from non-P6 sources; cross-check at pre-reg time | Audit at tag time |
| **HOMP uses single held-out class (MiMo-V2.5-Pro)** | Document. For publication path, add Llama-3.3-70B as second HOMP class for ~$1 extra | Acceptable for engineering tier |
| **CLI harness still used for Qwen/opencode HOMP class** | Unavoidable IF DashScope direct API isn't available. NOT used for any judge or reflector. Pre-flight checks DashScope first. | Acceptable |
| **SCS metric uses Gemini Embedding 2** | Code-specialised, multimodal, well-established (March 2026 release). Document choice. | Acceptable |
| **Vault not opened in this phase** | Defer to release-track follow-up (separate run) | Headline number not "vault-validated" |
| **20 rounds may not converge for hard tasks** | Patience rule + plateau-breakthrough extension + manual reflection are the convergence proxies. Document max-rounds-hit as a finding if it happens. | Acceptable per GEPA literature (10-50 rounds is the published range) |
| **GPT-5.5-instant pricing changed mid-2026** ($2.50/$15 → $5/$30 in 7 weeks) | If pricing changes again before P7 runs, use GPT-5.4 (stable at $2.50/$15) to lock cost. Pre-flight script logs the resolved per-call price. | Cost variance bound by pre-flight |
| **Sonnet 4.6 Tier-2 vs Tier-3 RPM ceiling** (1000 vs 2000 RPM) | At Tier 2 with ~30 concurrent calls, we're 30 RPM observed — well within. Pre-flight checks current Anthropic tier and warns if Tier 1 (50 RPM cap). | Acceptable |
| **Rate-limit changes mid-run** (provider tier downgrades, quota changes) | Verbose logger detects spike in 429s; auto-throttle cuts the affected lineage's concurrency in half until the next round. Trajectory records all retries. | Acceptable |
| **`[[token]]` preservation can fail silently in paraphrase** | Post-translation validator REJECTS any mutation missing source `[[...]]` tokens. Logged as translation failure, no silent drop. | Mitigated |
| **Joint scoring variance asymmetry** (Gemini risk A2) | Mean would chase higher-variance target's deltas. **Mitigated by Maximin** (§3.7) — Pareto improvements must benefit BOTH targets, not just the noisier one. | Resolved |
| **"Compromise prompt" mode collapse** (Gemini risk D1) | Pareto front fills with mediocre-on-both prompts rather than great-on-both, if the targets have fundamentally different routing preferences. | Mitigated by Maximin: the loop is forced to find prompts that are *jointly* high. If Maximin can't break a target asymmetry above floor, the §3.7.3 gate-failure flow kicks in (caveat-ship or 3-objective re-run). |
| **GEPA prompt bloat** (Gemini risk C3) | Reflectors monotonically add rules; prompts balloon to 2,500+ tokens by round 20, diluting attention. | Mitigated by length penalty (§3.7) + OP-5 Pruner (§3.2) + 2000-token ship hard cap. |
| **Overfitting 25 probes over 20 rounds** (Gemini risk D2) | 60+ candidates evaluated against only 25 probes → severe overfit risk to dev quirks. | Mitigated by mid-run probe rotation at round 11 (§3.1) + dynamic hard-negative weighting that down-weights saturated probes. |
| **`[[token]]` whitespace corruption** (Gemini risk D3) | Translators/paraphrasers return `[[ ss-search ]]` with extra spaces inside brackets, breaking strict regex validation. | Mitigated by `[[token]]` validator's whitespace normalization step (§3.2.1). Strict regex first normalizes `[[\s*X\s*]]` → `[[X]]`. |
| **Reflective rewrites get stuck in lexical-prior loops** (e.g., overemphasising "search" because the tool has "search" in its name) | The reflector's prompt mutations might converge on tropes that exploit lexical priors rather than describing tool behaviours unambiguously. | Mitigated by OP-4 Tool-Signature Masking (§3.2): periodically re-aliases tool names to break lexical-prior reliance, forcing self-describing prompt content. |
| **Pareto-gated TARE may miss occasionally-brittle prompts** | A candidate that doesn't make the Pareto front by task score gets discarded WITHOUT TARE — but might have been borderline-Pareto and brittle. | Acceptable: those candidates wouldn't have entered the front anyway. The methodological point of TARE is to filter brittle Pareto entrants; non-entrants don't need filtering. |
| **Maximin race-to-the-middle catastrophe** (Gemini 2nd-pass §A1) | A variant scoring (Sonnet 0.55, GPT 0.55) Pareto-dominates (Sonnet 0.9, GPT 0.2) on Maximin (0.55 > 0.2), but the dominator ships a -0.35 catastrophic regression for Sonnet users. | Mitigated by §3.7.1 step 9: 0.15 absolute-degradation hard constraint. No Pareto admission if either target's score drops by >0.15 vs current joint-best. |
| **Round 11 probe rotation discontinuity** (Gemini 2nd-pass §B1) | After rotation, new mutations are evaluated on new probes while incumbents have scores from old probes — apples-to-oranges Pareto comparison. Could permanently lock new mutations out of the front. | Mitigated by Pareto-front re-baseline at rotation (§3.1): 6 incumbents × 5 new probes × 2 targets = 60 extra runs (~$5). Mathematically non-negotiable. |
| **PRP judge verbosity bias rewards tool-call gluttony** (Gemini 2nd-pass §B2) | LLM-as-judge prefers more-tokens-of-reasoning answers, not more-efficient answers. Without a counter-pressure, GEPA evolves a 5-tool-call-per-probe prompt that destroys production rate limits. | Mitigated by Efficiency-Adjusted Scoring (§3.7.1 step 4): `efficiency_factor = 1 − 0.02 × max(0, avg_tool_calls − 3)`. Surgical tool use Pareto-dominates exhaustive use. |
| **OP-2 trajectory-crossover schizophrenia** (Gemini 2nd-pass §B3) | OP-2 acts as genetic memory — resurrects deprecated behaviors that the human just penalized via manual reflection in the previous round. Prompt becomes self-contradictory. | Mitigated by passing latest manual-reflection hint to OP-2 as a hard negative constraint (§3.2 OP-2 row). |
| **Tool-Signature Masking ghost-context leak** (Gemini 2nd-pass §A3) | Reflector sees `[[TOOL_ALPHA]]` but knows it's optimizing a code-search agent — hallucinates "search" / "code" / "repository" back into the surrounding context, defeating the masking. | Mitigated by domain-stripping in OP-4's reflector system prompt (§3.2 OP-4 row). Reflector is told it's optimizing "generic database retrieval / regex anchor / vector similarity / graph traversal" tools — no code-domain words. |
| **Gold-probe self-fulfilling prophecy** (Gemini 2nd-pass §B4) | Author subconsciously aligns dev probes with P6 win-rate signal → GEPA trivially "validates" P6 because the test is rigged. | Mitigated by adversarial counter-probes (§5.7): 10 dev probes rewritten by Sonnet with anti-P6-shape phrasing, evaluated on the winner at end of run. Score within 15% of dev = generalised; >25% drop = overfit. |
| **Domain-specific code-search pathologies undetected** (Gemini 2nd-pass §C) | Wrong-extension death loop, context-window flooding (minified file traps), transitive rabbit hole — all common production failures with no probe coverage. | Mitigated by §5.5 pathology probes: 7 dev probes specifically encode these failure modes so GEPA discovers prompt-level defenses naturally. |
| **Frankenstein-prompt language overfit** (Gemini 2nd-pass §E) | Optimised prompt over-fits AST patterns of dev repos (JS/Go/Py/Rs/TS). Production user deploys on C++/Java/C# → silent regression. | Mitigated by §3.5.1 language-transfer HOMP: 10 probes on a Java repository (post-cutoff), evaluated on Sonnet. ≥0.6 score required to ship. |
| **Brittle to lazy/degraded user queries** (Gemini 2nd-pass §D5) | Prompt optimised for well-formed dev queries; production users type "sink trait broken why" — score collapses. | Mitigated by §3.6.1 lazy-user robustness pivot: degraded query versions of dev probes; ≤20% score drop required. |
| **RIF (Retrieval-Induced Forgetting) drift in late-turn trajectories** (Gemini 2nd-pass §D2) | Long agent trajectories push system-prompt instructions out of attention; by turn 4, agent forgets routing rules. | Mitigated by §3.2.3 stateful-summarization rule baked into T2/T8/T13/T14/T15 seed variants. |
| **Concurrency math wrong — TPM not RPM is the binding constraint** (GPT-5.5 review §D1) | Naive RPM ceiling at Tier 1 GPT-5.5 = 30 concurrent calls × 12K tokens = 360K tokens in flight = 12× over 30K TPM ceiling. Run would 429-storm minute-one. | Mitigated by TPM-aware token-bucket scheduler (§7.7) + pre-flight check that flags Tier 1 as operationally insufficient and recommends $50 Tier-2 upgrade. |
| **0.15 cap utopia-point bug in Gemini's own fix** (GPT-5.5 review §C1) | Comparing degradation to per-target Pareto MAXIMA (different specialist incumbents) creates a "utopia point" constraint that systematically rejects genuinely joint-improving candidates. | Mitigated by changing cap baseline to **the displaced incumbent** (or current joint-best when not displacing) instead of per-target maxima. Worked example in §3.7.1 step 9. |
| **Stale rejected-plan residue in §1/§2/§13/§7.6/§3.x** (GPT-5.5 review §D3) | joint-mean references throughout, ja-pivot/latent-interp still in §2.1 roles, §13 day-3 still says "implement latent-interp + ja-pivot", verbose-logging examples reference dead operators. Implementers will follow stale sections. | Mitigated by sweep through §1, §2.1, §2.3, §3.1, §3.4, §3.5, §3.5.1, §3.6, §3.6.1, §7.6, §13 replacing all stale references with current Maximin × EAS / trajectory-crossover / persona-pivot terminology. |
| **Java HOMP omits GPT-5.5** (GPT-5.5 review §B2) | Direct Sonnet bias — only Sonnet validates language transfer despite GPT-5.5 being a production target. | Mitigated by adding GPT-5.5 to §3.5.1 language-transfer probe runners (10 probes × 3 evaluations: MiMo + Sonnet + GPT-5.5; pass criterion ≥0.6 Maximin on BOTH targets). |
| **Asymmetric EAS — GPT-5.5 early-stop unpenalized** (GPT-5.5 review §B1) | Original Gemini formula penalised over-exploration (Sonnet failure mode) but rewarded under-exploration ("one plausible lexical hit, confident final" — GPT-5.5 failure mode). | Mitigated by per-target per-stratum expected-call windows + evidence-adequacy penalty for unsupported finals. EAS aggregated as `min` across targets to be Maximin-consistent. |
| **Token validator gaps — multiplicity / unmapped aliases / surplus tokens** (GPT-5.5 review §B5) | Validator only checked presence; missed multiplicity drift, unmapped `[[TOOL_*]]` survival, and operator-invented surplus sentinels. Silent prompt corruption risk. | Mitigated by extending validator (§3.2.1) to record source multiplicity, require same multiplicity in output, reject unmapped OP-4 aliases, reject surplus protected tokens. New `mutation-rejection` JSONL events per failure mode. |
| **OP-2 trajectory style imports Sonnet** (GPT-5.5 review §B3) | Crossover not target-tagged → Kimi may learn Sonnet's exploration cadence as the universal "winning" pattern. | Mitigated by target-tagging requirement on trajectories + balanced-pair crossover when both targets have winning trajectories + bottleneck-tagging (Sonnet-only / GPT-only / joint). |
| **SCS rewards stable wrongness** (GPT-5.5 review §C3) | Naive consistency metric rewards a prompt that consistently gives the SAME WRONG answer. | Mitigated by correctness-weighted SCS = SCS × min_paraphrase_accuracy as the ship gate, with minimum-paraphrase-accuracy floor of 0.6. Naive SCS reported but no longer gates. |
| **appendFileSync doesn't fsync — durability bug** (GPT-5.5 review §D2) | Crash mid-round can lose recent JSONL events; resume picks up at wrong point. | Mitigated by `appendFsynced` wrapper using explicit `openSync → writeSync → fsyncSync → closeSync`. Kill-9-recovery unit test. |
| **Single-family TARE / lazy-user paraphrase distribution** (GPT-5.5 review §C2/§C4) | Sonnet-only paraphrase generation tests Anthropic-style robustness only. | Mitigated by TARE K=3 requiring ≥1 non-Anthropic paraphrase + OP-3 generator rotation Sonnet/Kimi/GPT-5.5 + lazy-user multi-source degradation (10 deterministic templates + 8 Sonnet + 7 GPT-5.5). |
| **n=6 Pareto noise overweighted as discriminative variance** (GPT-5.5 review §C5) | Small-front variance can be judge-noise rather than probe difficulty. | Mitigated by 2-round stability gate (variance only counts after probe evaluated ≥2 rounds) + judge-noise floor of 0.05 in §3.1 weighting. |
| **Forensic-metadata gap in JSONL telemetry** (GPT-5.5 review §D4) | Without model_id/api_path/temperature/commit/probe_hash/token_counts/judge_panel logged, post-hoc explanation of GPT-vs-Sonnet deltas is impossible. | Mitigated by extending confirm-event schema (§7.4) to log all forensic metadata. |
| **Fenced-python pseudocode over-literally interpreted** (GPT-5.5 review §B4) | GPT-5.5 may treat ```python``` blocks as executable examples rather than routing-policy pseudocode. | Mitigated by labelling pseudocode blocks `# routing policy pseudocode — NOT executable code` and preferring decision tables for high-level routing. |
| **Reasoning-mode transfer gap — power users run thinking ON; we optimise OFF** (user catch, post-GPT-review) | Optimization runs against `extended-thinking=OFF` Sonnet and `GPT-5.5-instant` (non-reasoning) for cost and production-default parity. Power users — disproportionately the prompt-quality-sensitive cohort — flip thinking ON. EAS per-stratum windows, AST-ified routing, stateful-summarization rules, and Pruner-driven length cuts all may misfire under reasoning. | Mitigated by §3.5.2 reasoning-mode operational HOMP gate: 30 runs (~$6) on Sonnet+thinking-ON and GPT-5.5-reasoning over the 15 held-out probes. Pass criterion ≥0.7× `final_score` per class. Fail → ship-with-caveat OR §3.7.3 fork to reasoning-as-5th-objective extension run (~$80). Validates transfer, doesn't optimise for it — accepted cost/insurance trade. |

---

## §11 Comparison to original §11 (publication-tier) plan & Gemini-Deep-Think-integrated

| Dimension | Original §11 spec | This P7 plan | Trade-off |
|---|---|---|---|
| Judge panel | 5-of-5 disjoint + 1 adversarial | 3-of-3 disjoint | -3 judges, +practical |
| Probe sets | 60 dev + 40 sealed-1 + 80 vault | 25 dev + 15 held-out + 0 vault | smaller n, no Vault |
| Replication | ≥2 seeds | 1 seed | no variance bounds |
| HOMP | ≥2 classes | 1 class (MiMo-V2.5-Pro) | weaker transfer evidence |
| GEPA rounds | not pinned | 20 with patience=5 | typical range |
| Sharpness/robustness | not in original | TARE-style selection + SCS reporting | **stronger than original** |
| Pre-registration | yes | yes (`prereg/p7-v1` tag) | ✓ |
| Decision log | not specified | append-only `p7-decisions.md` | **stronger than original** |
| Direct-API for judges | not specified | mandatory | **stronger than original** |
| Manual reflection | "researcher degrees of freedom" warning | Documented protocol with dev-only-edits rule | **explicit, defensible** |
| Mutation operators | 14 hand-authored seeds + naive paraphrase | 5-operator portfolio: Reflective + Trajectory-Crossover + Persona-Pivot + Tool-Mask + Pruner | **stronger than original** |
| Score aggregation | not specified | Maximin + length penalty + dynamic hard-negative weighting | **stronger than original** |
| Probe rotation | static probe set | mid-run rotation at round 11 (anti-overfit) | **stronger than original** |
| Total cost | $400-1000+ implied | ~$320 (post-Gemini-2nd-pass revisions; user kept GPT-5.5) | -65-70% |
| Publication-tier | yes | engineering with publication-grade methodology where it costs $1 | most of the value, fraction of the cost |

### §11.1 What Gemini 3.1 Pro Deep Think changed (2026-05-10 review)

The full critique lives at `docs/PHASE7-gemini-critique-2026-05-10.md`. Summary of integrations:

| Gemini finding | Section affected | Change |
|---|---|---|
| FATAL: latent-interp invalid (retrieval embeddings ≠ generative latents) | §3.2 | Replaced with OP-2 Contrastive Trajectory Crossover |
| Joint-mean variance-biased | §3.7 | Switched to Maximin scoring |
| TARE-on-every-candidate wasteful | §3.3 | Pareto-gated TARE (only on candidates that would enter front by task score) |
| GPT-5.5 unnecessarily expensive | §12, §14.2, §11.2 | **OVERRIDDEN by user strategic decision** — kept GPT-5.5-instant for pretrain future-proofing (see §11.2). Backwards-compat to GPT-5.4 verified via post-hoc replay (~$5). |
| ja-pivot near-no-op on 2026 LLMs | §3.2 | Replaced with OP-3 Persona/Constraint Pivot |
| Idea: Contrastive Trajectory Crossover | §3.2 | Added as OP-2 |
| Idea: Dynamic hard-negative probe weighting | §3.1 | Added as core scoring rule |
| Idea: Evolutionary bloat control | §3.2, §3.7 | OP-5 Pruner + length penalty + 2000-token ship cap |
| Idea: Tool-Signature Masking | §3.2 | Added as OP-4 |
| Idea: Hypothesis-Driven Backtracking | §4 | Added as T15 variant |
| Risk: Compromise Prompt mode collapse | §10 | Documented; Maximin is the mitigation |
| Risk: 25 probes / 20 rounds overfit | §3.1, §10 | Mid-run probe rotation at round 11 |
| Risk: `[[token]]` whitespace corruption | §3.2.1, §10 | Validator normalizes whitespace inside brackets |

### §11.2 User strategic override: GPT-5.5 over GPT-5.4

Gemini 3.1 Pro Deep Think recommended GPT-5.4 over GPT-5.5-instant on cost grounds (~$100 saving) plus an unverified transfer-asymmetry claim ("prompts work upward but not downward"). The user (project owner, 2026-05-10) overrode this recommendation. Rationale captured for the methods section:

**The case for GPT-5.5 (accepted)**:

1. **GPT-5.5 is plausibly a new pretrain family.** Evidence: pricing doubled vs GPT-5.4 ($2.50/$15 → $5/$30 per 1M) — inconsistent with a marginal alignment refresh; OpenAI made GPT-5.5 the default ChatGPT model on April 23, 2026 — they don't do that for fine-tunes; the discrete launch event with paid-tier rollout matches a new-base-model release pattern.
2. **Future iterations build on the new pretrain.** If GPT-5.5 IS the new family base, then GPT-5.6, 5.7, 6.0 will be 5.5-derived. A prompt optimised on the 5.5 family transfers forward; a prompt optimised on 5.4 may need re-optimisation when users migrate (which they will — OpenAI deprecates older tiers).
3. **The transfer-asymmetry claim Gemini cited is unverified.** Neither direction (5.4→5.5 or 5.5→5.4) has rigorous published evidence. Gemini's claim was an intuition, not a result. We shouldn't make a $100 budget decision based on unverified intuition.
4. **Backwards compat is cheap to verify.** A post-hoc replay of the unified winner on GPT-5.4 over the held-out probe set costs ~$2-5 and tells us whether downward transfer holds.

**The case for GPT-5.4 (rejected)**:

1. ~$100 savings — real but small in absolute terms relative to the project's value.
2. More users on 5.4 today — but this is rapidly changing as OpenAI rolls 5.5 to all paid tiers.
3. Gemini's transfer-asymmetry claim — unverified, not load-bearing.

**Decision**: optimise on Sonnet 4.6 + **GPT-5.5-instant** as the joint Maximin targets. Run a backwards-compat replay on GPT-5.4 after winner selection. If transfer-down is clean (≥90% of held-out joint score preserved on 5.4), ship as universal. If not, document the divergence and ship as "GPT-5.5+ generation" with a note for 5.4 users.

**Cost impact**: total run goes from ~$207 (5.4 plan) to ~$306 (5.5 plan + 5.4 replay) — +$99 (+48%). Hard cap raised from $270 to $400.

**Documentation imperative**: in any final write-up, the rationale above is published verbatim. Reviewers should be able to evaluate the strategic choice on its merits.

### §11.3 What the Gemini second-pass adversarial review changed (2026-05-10)

After integrating the first-pass critique, we asked Gemini 3.1 Pro Deep Think for a deliberately adversarial second pass — specifically targeting integration-induced failure modes, domain-specific code-search pathologies, and creative additions still on the table. The full second-pass critique lives at `docs/PHASE7-gemini-critique-2-2026-05-10.md`. Summary of integrations:

| Gemini 2nd-pass finding | Severity | Section affected | Change |
|---|---|---|---|
| **FATAL: Round-11 probe rotation creates apples-to-oranges Pareto comparison** | FATAL | §3.1, §10 | Pareto-front re-baseline at rotation: 6 incumbents × 5 new probes × 2 targets = 60 extra runs ($5). Mathematically non-negotiable. |
| **Maximin alone causes race-to-the-middle** (a (0.55, 0.55) variant Pareto-dominates a (0.9, 0.2) one but ships catastrophic regression) | HIGH | §3.7.1, §3.7.2, §10 | Added **0.15 absolute-degradation hard admission constraint** to the Pareto front. |
| **PRP judges blind to efficiency — reward tool-call gluttony** | HIGH | §3.7.1, §10 | Added **EAS (Efficiency-Adjusted Scoring)**: `efficiency_factor = 1 − 0.02 × max(0, avg_tool_calls − 3)` with length penalty `0.05 × tokens/1000`. |
| **OP-2 trajectory-crossover schizophrenia — resurrects deprecated behaviors** | MEDIUM | §3.2 (OP-2 row), §10 | Latest manual-reflection hint passed to OP-2 reflector as a hard negative constraint. |
| **Tool-Mask ghost-context leak — reflector hallucinates "search/code/repository"** | MEDIUM | §3.2 (OP-4 row), §10 | OP-4 reflector system prompt now domain-strips: tools framed as "generic database / regex anchor / vector similarity / graph traversal". |
| **Gold-probe self-fulfilling prophecy — author subconsciously aligns dev probes with P6 signal** | MEDIUM | §5.7, §10 | Added 10 adversarial counter-probes (Sonnet-rewrites with anti-P6-shape phrasing); ≤25% drop required at end of run. |
| **Domain-specific code-search pathologies missing from probes** (wrong-extension death loop, context-window flooding, transitive rabbit hole) | HIGH | §5.5, §10 | Added 7 dedicated pathology probes encoding these failure modes. |
| **Frankenstein-prompt language overfit (JS/Go/Py/Rs/TS) — silent regression on Java/C++/C#** | HIGH | §3.5.1, §10 | Added **language-transfer HOMP probe set**: 10 Java probes (post-cutoff repo), Sonnet-only, ≥0.6 score required to ship. |
| **Brittle to lazy/degraded production user queries** | MEDIUM | §3.6.1, §10 | Added lazy-user robustness pivot: degraded-query versions of dev probes; ≤20% score drop required. |
| **RIF (Retrieval-Induced Forgetting) drift in late-turn trajectories** | MEDIUM | §3.2.3, §10 | Stateful-summarization rule baked into T2/T8/T13/T14/T15 seed variants. |
| **Idea: Length penalty (already in §3.7.1 now made explicit) + AST-ification of routing rules** | NEW | §3.2 (OP-3 row), §3.7.1 | OP-3 Persona Pivot now includes AST-ification sub-mode (rules expressed as decision trees / regex skeletons). |
| **Idea: Distractor probes catching answer-shape-overfit, not just answer-content-overfit** | NEW | §5.6 | Added 5 poisoned/distractor probes in dev set. |

**Cost impact of 2nd-pass integrations**: +$10 (Round-11 re-baseline $5, language-transfer HOMP $0.50, lazy-user pivot $4, adversarial counter-probes $1, distractor probes covered by existing dev-probe budget). New total: ~$320, hard cap $420.

**Strategic decisions on 2nd-pass critique**:
- **GPT-5.5 (not 5.4)**: User reaffirmed the §11.2 override; Gemini 2nd-pass re-evaluation softened its position to "the team's reasoning is defensible". Keeping 5.5.
- **Everything else**: All 12 second-pass findings integrated as documented above.

### §11.4 What the Gemini third-pass review changed (2026-05-10) — SHIP-IT VERDICT

After integrating both prior passes, we asked Gemini for a third-pass review with explicit framing: *be honest about diminishing returns; if the plan is researcher-defensible, say so and don't manufacture critique*. Full critique at `docs/PHASE7-gemini-critique-3-2026-05-10.md`.

**Verdict (verbatim)**: *"Production-ready engineering with publication-grade methodology... You have reached [diminishing returns]. The structural methodology of this plan is now better than 95% of the prompt-optimization pipelines currently running in the industry, and it easily clears the bar for a top-tier conference submission (ICLR/NeurIPS) in the applied tracks. I have no new major mechanisms to suggest. Do not add any more operators, gates, or objectives... **SHIP IT.**"*

**Explicit retractions** (Gemini, 3rd pass):
- Retracts the GPT-5.4 cost recommendation: *"I fully retract my push for GPT-5.4. The team's logic in §11.2 regarding the April 23 pretrain shift is sound."*
- Retracts the second-pass dev-set adversarial-probe density: *"I officially retract the density of my own adversarial probe recommendations for the dev set... A dev set must remain a representative distribution of production traffic; 48% trick-queries violates that."*

**Three minor config tweaks integrated** (the only remaining material gaps):

| Gemini 3rd-pass finding | Severity | Section affected | Change |
|---|---|---|---|
| **OP-5 Pruner can mangle OP-3 AST-ified pseudocode** ("make it terse" deletes `elif`, flattens indentation, drops brackets) | LOW | §3.2 (OP-5 row) | Pruner system prompt now explicitly says: *"Do NOT alter syntax/indentation/logic of any pseudocode or fenced code blocks — restrict pruning to natural-language prose only."* |
| **Dev set is 40% adversarial trick probes** (7 pathology + 3 distractor / 25 = 40%, exceeds the 30% representativeness cap; agent over-evolves toward paranoia at the cost of literal-lookup baseline) | MEDIUM | §5.1, §5.3, §5.5 | Moved 3 pathology probes to rotation pool. Dev set now has 4 pathology + 3 distractor = 7 trick / 25 = 28%. Rotation pool grew 10 → 13, with 3 deferred-pathology probes guaranteed-promoted at round 11. |
| **JSONL rejection telemetry missing** (Pareto rejections will look like black-box hallucinations on Wednesday morning when EAS/length/0.15-cap interact) | MEDIUM | §7.4 | Added explicit `_kind: 'pareto-rejection'` event with `reason`, `target_degraded`, `drop`, `incumbent_being_compared`. `_kind: 'confirm'` now logs full EAS modifier breakdown (raw scores, multiplier, length penalty, final). New `_kind: 'pareto-rebaseline'` event for round-11. |

**Cost impact**: $0 (pure config + telemetry).

**Decision**: ship. Do not add any more operators, gates, or objectives. The plan now goes to `prereg/p7-v1` tagging.

### §11.5 What the GPT-5.5 xhigh external review changed (2026-05-10)

After Gemini's three-pass ship-it verdict, we commissioned an external review by GPT-5.5 xhigh — explicitly leveraging two angles Gemini structurally cannot use: (1) GPT-5.5 IS one of the production targets, so it can flag bias against itself that no external critic would notice, and (2) it reads the doc as an *implementer* about to run code on Tuesday morning rather than a methodologist. Full critique at `docs/PHASE7-gpt5-5-critique-2026-05-10.md`.

**Verdict (verbatim)**: *"Production-ready after preflight fixes, not 'ship unchanged.' The remaining issues are not 'add more clever operators.' They are target asymmetries and calibration details that matter specifically because GPT-5.5-instant is one of the production targets. Ship after pre-registration fixes; the research design is strong, but the current draft still has GPT-specific bias and operational footguns."*

**13 findings integrated** (all of them; no overrides):

| GPT-5.5 review finding | Severity | Section affected | Change |
|---|---|---|---|
| **D1: Concurrency math wrong — TPM is the binding constraint, not RPM** (Tier 1 GPT-5.5: 30 calls × 12K tokens = 360K in flight = 12× over 30K TPM, would 429-storm minute-one) | CRITICAL | §7.7, §7.5 | Replaced RPM-only ceiling with TPM-aware token-bucket: `min(RPM, ITPM/in, OTPM/out)`. Added pre-flight tier check that flags Tier 1 as operationally insufficient (recommends $50 Tier 2 upgrade — cuts wall-time from ~12 days to ~2 days). |
| **D3: Stale rejected-plan residue** (joint-mean references throughout, ja-pivot/latent-interp in §2.1 roles, §13 day-3 still says "implement latent-interp + ja-pivot", logging examples reference dead operators) | CRITICAL | §1, §2.1, §2.3, §3.1, §3.4, §3.5, §3.5.1, §3.6, §3.6.1, §7.6, §13 | All stale references replaced with current Maximin × EAS final_score formula and current operator names (trajectory-crossover, persona-pivot+AST-ification). Implementers will no longer follow the rejected design. |
| **C1: 0.15 cap utopia-point bug** (Gemini's own fix introduced the bug — comparing to per-target Pareto MAXIMA rejects genuinely joint-improving candidates that fall under different specialist incumbents) | CRITICAL | §3.7.1 step 9 | Cap baseline now relative to the **displaced incumbent** (or current joint-best when not displacing), NOT global per-target Pareto maxima. Worked example showing V_C=(0.75, 0.85) correctly admitted instead of incorrectly rejected. |
| **B2: Java HOMP omits GPT-5.5** (direct Sonnet bias — only Sonnet validates language-transfer despite GPT-5.5 being a production target) | CRITICAL | §3.5.1 | Added GPT-5.5 to the language-transfer probe runners: 10 probes × 3 evaluations (MiMo + Sonnet + GPT-5.5). Pass criterion now requires ≥0.6 Maximin on BOTH targets. +$0.50 cost. |
| **B1: EAS asymmetric — penalizes over-exploration but not under-exploration** (Sonnet-style gluttony penalised, GPT-5.5-style early-stop rewarded) | HIGH | §3.7.1 step 4 | Replaced global averaged formula with per-target, per-stratum expected-call windows + evidence-adequacy penalty for unsupported final answers. EAS aggregated as `min` across targets to be Maximin-consistent. |
| **B5: Token validator incomplete** (only checks presence; misses multiplicity changes, surplus tokens, unmapped OP-4 aliases — silent prompt corruption risk) | HIGH | §3.2.1 | Validator now records source multiplicity, requires same multiplicity in output, rejects unmapped `[[TOOL_*]]` aliases, rejects surplus protected tokens. New `mutation-rejection` JSONL events with specific failure modes. |
| **B3: OP-2 imports Sonnet trajectory style** (crossover not target-tagged — Kimi may learn Sonnet's exploration cadence and prose style as the universal "winning" pattern) | HIGH | §3.2 (OP-2 row) | Trajectories must carry `target` field. OP-2 explicitly identifies whether bottleneck is Sonnet-only / GPT-only / joint. Balanced-pair crossover when both targets have winning trajectories. |
| **C3: SCS rewards stable wrongness** (consistency metric rewards a prompt that consistently gives the same wrong answer) | HIGH | §3.6 | Added correctness-weighted SCS as the ship gate: `cw_SCS = SCS × min_paraphrase_accuracy`. Naive SCS reported but no longer gates. Minimum-paraphrase-accuracy floor of 0.6. |
| **D2: appendFileSync doesn't guarantee fsync** (durability bug — kernel may delay writeback; crash mid-round loses recent events) | HIGH | §7.4 | Replaced platform-dependent appendFileSync with explicit `openSync → writeSync → fsyncSync → closeSync` wrapper `appendFsynced`. Added kill-9-recovery unit test. |
| **D4: JSONL telemetry missing forensic metadata** (post-hoc explanation of GPT-vs-Sonnet deltas would be impossible) | HIGH | §7.4 | Confirm events now log: model_id, api_path, temperature, tool_schema_version, repo_commit, prompt_hash, probe_hash, probe_stratum, expected_call_window, call_deviation_penalty, evidence_adequacy_penalty, input/output/cache tokens, result_bytes, retry_count, judge_panel ids. |
| **C2: TARE paraphrases are Sonnet-only** (single-family paraphrase distribution) | MEDIUM | §3.3, §2.1 | TARE K=3 must include ≥1 non-Anthropic paraphrase (deterministic structural OR Kimi/GPT-5.5). OP-3 generator rotates Sonnet → Kimi → GPT-5.5 every 3rd round. |
| **C4: Lazy-user generator is Sonnet-only** (Sonnet's notion of "tired developer" phrasing biases the degradation distribution) | MEDIUM | §3.6.1 | Multi-source degradation: 10 deterministic templates + 8 Sonnet-generated + 7 GPT-5.5-generated. Pass criterion now per-target (not joint) so target-asymmetric brittleness is detectable. |
| **C5: Hard-negative weighting can overweight noise at small Pareto front (n=6)** | MEDIUM | §3.1 | Added 2-round stability gate (variance only counts after a probe has been evaluated ≥2 rounds) + judge-noise floor of 0.05. |
| **B4: Fenced python pseudocode can be over-literally interpreted** (GPT-5.5 may treat fenced ```python``` blocks as executable examples) | LOW | §3.2 (OP-3 row) | OP-3 AST-ification now labels blocks `# routing policy pseudocode — NOT executable code` and prefers decision tables for high-level routing. |

**Cost impact of GPT-5.5 review integrations**: +$1 (Java HOMP for GPT-5.5 +$0.50, GPT-5.5 lazy-user generator +$0.30 amortized, GPT-5.5 OP-3 rotation +$0.20 amortized). New total: **~$321, hard cap $420**.

**Additional user-caught gap (post-GPT-review)**: §3.5.2 reasoning-mode operational HOMP gate adds $6 (15 held-out probes × 2 reasoning modes × ~$0.20 reasoning premium). New running total: **~$327, hard cap unchanged at $420**.

**Operational readiness change**: tier-2 OpenAI billing is now operationally mandatory. This is a $50 one-time pre-flight cost, not added to the run budget — it's a prerequisite for the run wall-time being reasonable.

**Decision**: ship after these pre-registration fixes (now integrated). The plan now goes to `prereg/p7-v1` tagging.

---

## §12 Open questions — RESOLVED at pre-registration (2026-05-10)

All 6 questions are now locked. Decisions:

1. **Codex target: GPT-5.5-instant** ✅ — user strategic override of Gemini's GPT-5.4 recommendation; rationale in §11.2. +$99 cost vs GPT-5.4 buys pretrain future-proofing as 5.6+ will likely be 5.5-derived. Backwards-compat post-hoc replay on GPT-5.4 (~$2-5) verifies transfer-down. Scheduled for §13 day 9.
2. **Run length: 20-round budget, stop-when-plateau-fires** ✅ — lock 20 as the budget cap; rely on the patience rule (5 rounds without improvement) + plateau-breakthrough extension (§3.1) to stop early when convergence is reached. This may end at round 12-15 if the trajectory is clean; only goes to 20 if there are late-round step-changes. The user reviews convergence between rounds and can stop early at any point.
3. **Probe corpus: deno 2.x** ✅ — for fresh hand-authored post-cutoff probes (covering the 30-40 non-P6-derived probes per §5.4). Most representative of typical Codex/Claude Code agentic-search use.
4. **Manual reflection cadence: every round, AI-assisted** ✅ — between every round, Gemini 3.1 Pro Deep Think (`gemini-3.1-pro-preview` with `thinkingBudget: -1`) generates a reflection report on the round's results. User reviews Gemini's report, decides what to act on, logs the decision to `p7-decisions.md`. Cost: ~$0.07/round × 20 = ~$1.40 total. See §3.4 for protocol.
5. **HOMP class B (Qwen 3.6 Plus): opencode CLI** ✅ — user prefers harness-realism over direct-API speed. Real Qwen users on opencode see the prompt through the same CLI overhead, including system-context injection. Using opencode CLI for HOMP makes the "does it transfer to opencode users?" claim more honest. The only call path in P7 that uses a CLI harness; documented as such in §10 risk register. **Reminder**: Qwen 3.6 Plus is HOMP-only, NOT a target — we ship a unified prompt optimised for Sonnet+GPT-5.5; Qwen validates cross-family transfer.
6. **OP-4 Tool-Signature Masking aliases: randomized per call** ✅ — each call gets a fresh permutation of `[[TOOL_ALPHA/BETA/GAMMA/DELTA]]` aliases mapped to `[[ss-search/ss-find/ss-semantic/structural]]`. Mapping logged to the trajectory JSONL for audit. Prevents the optimizer from memorising the alias scheme and gaming it.

All locked. Ready for `prereg/p7-v1` tag.

---

## §13 Next steps

1. **Now**: review this PHASE7.md; resolve the 7 open questions in §12.
2. **Day 1**: author T1–T14 seeds (P6-grounded per §4.2) + dev/held-out probes (per §5).
3. **Day 2**: implement direct-API runners (Anthropic, OpenAI, Moonshot, MiniMax, MiMo, Qwen-DashScope) + Gemini Embedding 2 client. Unit-test the `[[token]]` preservation.
4. **Day 3**: implement GEPA driver + Pareto-gated TARE + the 5-operator portfolio (OP-1 reflective, OP-2 trajectory-crossover with target-tagging, OP-3 persona-pivot+AST-ification with rotated generators + non-executable labelling, OP-4 tool-mask with domain-stripping, OP-5 Pruner with pseudocode-protection). Implement EAS (per-target per-stratum + evidence-adequacy), 0.15 admission cap (relative to displaced incumbent), TPM-aware token-bucket scheduler, persistence/resume with `fs.fsyncSync`, full-metadata JSONL telemetry (§7.4), pre-flight checklist (§7.5), verbose logger (§7.6). Unit-test crash-resume + token-validator multiplicity/alias gates.
5. **Day 4**: dry-run on 3 probes × 1 round to validate end-to-end (cost: ~$1). Fix bugs.
6. **Day 5**: tag `prereg/p7-v1`. Push. Run pre-flight script. If it fails, fix and re-tag.
7. **Days 6–8**: run full GEPA (joint Sonnet 4.6 + GPT-5.5-instant). Manual reflection between rounds. Trajectory written to disk continuously — resumable.
8. **Day 9**: HOMP (MiMo + Qwen) + language-transfer HOMP (Java × MiMo + Sonnet + GPT-5.5) + **reasoning-mode operational HOMP** (Sonnet thinking-ON + GPT-5.5 reasoning over 15 held-out probes; §3.5.2) + correctness-weighted SCS + GPT-5.4 backwards-compat replay (~$2-5) + winning prompt selection.
9. **Day 10**: write up `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` + `recommendations.json` + the run report.
10. **Day 11**: tag `release/p7-v1`. Push. Update CLAUDE.md / sweet-search MCP to ship the new prompt.

Optional (publication path):
- **Day 12+**: open Vault on `release` tag for headline-number computation. Replicate with seed=43. Add 3rd HOMP class. ~$50-100 marginal.

---

## §14 Provider rate limits & pricing reference (May 2026)

This is the snapshot used for §7.7's concurrency policy and §8's cost envelope. Re-validate at pre-flight time (rate limits drift).

### §14.1 Anthropic Sonnet 4.6 (direct API, NOT Max plan)

Source: [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits) (note: Anthropic), [devtk.ai 2026 comparison](https://devtk.ai/en/blog/ai-api-rate-limits-comparison-2026/), [pecollective 2026 pricing guide](https://pecollective.com/tools/anthropic-api-pricing/).

| Tier | Qualification | RPM | ITPM | OTPM |
|---|---|---|---|---|
| Tier 1 | $5 paid | 50 | 30,000 | 8,000 |
| Tier 2 | $40 paid + 7 days | 1,000 | 450,000 | 90,000 |
| Tier 3 | $200 paid + 7 days | 2,000 | 800,000 | 160,000 |
| Tier 4 | $400 paid + 14 days | 4,000 | 2,000,000 | 400,000 |

Pricing: $3 input / $15 output per 1M (1M context, no surcharge). Prompt caching: 90% off cached input. Per-call estimate (~10K in + 2K out): **$0.06/agent run**.

**P7 assumption**: user is at Tier 2+ (≥$40 spent over 7+ days). If at Tier 1, lower Sonnet concurrency to ≤6 to stay within 50 RPM.

### §14.2 OpenAI GPT-5.5-instant (direct API) — Codex target

Source: [OpenAI rate limits docs](https://developers.openai.com/api/docs/guides/rate-limits), [GPT-5.5 launch announcement](https://openai.com/index/gpt-5-5-instant/) (April 23, 2026).

| Tier | Qualification | RPM (GPT-5.5 class) | TPM |
|---|---|---|---|
| Tier 1 | $5 paid | 500 | 30,000 |
| Tier 2 | $50 paid + 7 days | 5,000 | 450,000 |
| Tier 3 | $100 paid + 7 days | 5,000 | 800,000 |
| Tier 4 | $250 paid + 14 days | 10,000 | 2,000,000 |
| Tier 5 | $1,000 paid + 30 days | 10,000 | 30,000,000 |

GPT-5.5 pricing: $5 input / $30 output per 1M tokens. Per-call estimate (~10K in + 2K out): **$0.11/agent run**.

**Why GPT-5.5-instant over GPT-5.4** (user strategic override; full rationale in §11.2):

- **Pretrain future-proofing**: GPT-5.5 is plausibly a new base model (corroborated by 2× pricing jump and discrete April 23, 2026 launch). Future GPT-5.6, 5.7, 6.0 will be 5.5-derived → longer artifact shelf-life.
- **Production trajectory**: OpenAI is migrating Codex paid tiers to 5.5 as default. Optimising for 5.4 today means re-optimising when users move.
- **Cost premium accepted**: ~$99 more than 5.4 plan. Worth it for shelf-life.

**Backwards compat to GPT-5.4**: post-hoc replay of the winning variant on GPT-5.4 over held-out probes (~$2-5). Pass criterion: ≥90% of joint score preserved on 5.4. If pass: ship as universal. If fail: ship as "GPT-5.5+ generation" with a note for 5.4 users.

**GPT-5.4 pricing kept for reference** (used in backwards-compat replay only): $2.50 input / $15 output per 1M, Tier-1 RPM 500, same tier ladder as 5.5. Per-call: $0.055/run.

### §14.3 DeepSeek V4 Flash (direct API)

Source: [DeepSeek API docs rate limits](https://api-docs.deepseek.com/quick_start/rate_limit), [LLMReference V4 Flash comparison](https://www.llmreference.com/compare/deepseek-v4-flash/kimi-k2-6).

- **Dynamic rate limit** (no fixed RPM/TPM table). Returns 429 under load with keep-alive throttling.
- Pricing: $0.14 input / $0.28 output per 1M.
- Per-judge call (~2K in + 200 out): **$0.0004**.

P7 assumption: 30 concurrent calls is well within DeepSeek's dynamic capacity for short PRP prompts.

### §14.4 Gemini-3.1-Flash-Lite (direct API)

Source: [ai.google.dev rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [aifreeapi 2026 per-tier guide](https://www.aifreeapi.com/en/posts/gemini-api-rate-limits-per-tier).

| Tier | Qualification | RPM (Flash class) | TPM |
|---|---|---|---|
| Tier 1 | Billing enabled (~$50+) | 300 | 1,000,000 |
| Tier 2 | $250 paid + 3 days | 1,000 | 4,000,000 |
| Tier 3 | $1,000 paid + 30 days | 2,000-4,000 | 10,000,000+ |

Pricing: $0.25 input / $1.50 output per 1M. Per-judge call: **$0.0008**.

### §14.5 Gemini Embedding 2 (`gemini-embedding-2-preview`)

Source: [tokencost.app review (March 2026)](https://tokencost.app/blog/gemini-embedding-2-pricing).

- $0.20 / 1M tokens input (text). Batch: $0.10 / 1M.
- 8K context, 768/1536/3072-dim Matryoshka outputs.
- Tier 1 paid: ~1500 RPM (well above our needs).

### §14.6 Kimi K2.6 reasoning (Moonshot direct API)

Source: [DeepInfra Kimi K2.6 benchmarks](https://deepinfra.com/blog/kimi-k2-6-api-benchmarks-latency-throughput-cost), [LLMReference comparison](https://www.llmreference.com/compare/deepseek-v4-flash/kimi-k2-6).

- Pricing varies by host: $0.74-$1.20 input / $3.49-$4.50 output per 1M (Moonshot direct vs Together vs Fireworks vs DeepInfra).
- Per-reflector call (~5K in + 2K out): **$0.013** (using DeepInfra/Together rates).
- Rate limits: Moonshot's are dynamic; Together/Fireworks have published tiers around 60-300 RPM at paid tiers.

### §14.7 MiniMax M2.7 (direct API)

- $0.30 input / $1.20 output per 1M (with $0.06 cached input — 80% off).
- Per-judge call: **$0.0008** (or $0.0002 with caching, since our PRP system prompt is identical across all calls).
- Rate limits not publicly published; behaviour like DeepSeek (dynamic).

### §14.8 MiMo-V2.5-Pro (HOMP class A)

- Hosted via Together / Fireworks at varying prices (~$0.30-$0.50/1M input).
- Per-agent call: **~$0.011-$0.015**.
- AA Intelligence Index 54 (tied with Kimi K2.6 for top open-weights).

### §14.9 Qwen 3.6 Plus (HOMP class B, via opencode or DashScope direct)

- $0.30/1M (Together AI estimate).
- Via opencode CLI harness (the only target/HOMP that needs CLI; agent uses tools).
- Per-agent call: **~$0.022**.

---

## §15 Memory cross-references

The durable lessons learned during P6 that govern P7's design choices live in `~/.claude/projects/-Users-admin-Projects-sweet-search-private/memory/`. Implementers should read these before starting:

| Memory file | Why it matters for P7 |
|---|---|
| [feedback_direct_api_for_stateless_calls.md](../memory/feedback_direct_api_for_stateless_calls.md) | Why §7.7 mandates no-CLI for judges/reflector/paraphrasers |
| [feedback_claude_max_budget.md](../memory/feedback_claude_max_budget.md) | Why §2.1 specifies Sonnet 4.6 via direct API NOT Max plan |
| [feedback_gemini_preview_throttling.md](../memory/feedback_gemini_preview_throttling.md) | Why §2.1 uses Gemini-3.1-Flash-Lite (GA) not gemini-3-flash-preview |
| [project_p6_qshape_v1_complete.md](../memory/project_p6_qshape_v1_complete.md) | What P6 produced (winRates) and what it didn't (BH-FDR promotions) — the basis for §4.1 |
| [project_deepseek_max_tokens_reasoning.md](../memory/project_deepseek_max_tokens_reasoning.md) | Why DeepSeek-V4-Flash judge uses `max_tokens: 4096`, not 1024 |
| [project_aqe_mcp_orphans.md](../memory/project_aqe_mcp_orphans.md) | Why §7.5 pre-flight checks `pgrep -f aqe-mcp` first |
| [project_gemini_cli_auth_apikey.md](../memory/project_gemini_cli_auth_apikey.md) | Why §7.5 verifies `~/.gemini/settings.json:selectedType == "gemini-api-key"` |
| [feedback_search_before_loop.md](../memory/feedback_search_before_loop.md) | Web search after 3 failed attempts; applies to debugging during the run |
| [feedback_no_memory_cap.md](../memory/feedback_no_memory_cap.md) | Don't pass `--max-old-space-size`; M3 Max 128GB is fine |

When the run starts hitting unexpected failures, the first action is to check these memories — most P6 failure modes are documented.

---

## §16 Sources / references

Foundational:
- [GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://arxiv.org/abs/2507.19457) — Agrawal, Khattab et al., ICLR 2026 Oral
- [TARE: Textual Sharpness-Aware Evolving](https://arxiv.org/abs/2509.24130) — NeurIPS 2025
- [LatentPrompt: Optimizing Prompts in Latent Space](https://arxiv.org/html/2508.02452v1) — 2025
- [GAAPO: Genetic Algorithm Applied to Prompt Optimization](https://arxiv.org/pdf/2502.18746.pdf) — 2025
- [PromptBreeder](https://arxiv.org/abs/2309.16797) — Fernando et al., 2023
- [EvoPrompt](https://arxiv.org/abs/2309.08532) — Guo et al., ICLR 2024
- [E-SPL: Evolutionary System Prompt Learning](https://arxiv.org/abs/2510.01472) — 2026

Robustness / paraphrase:
- [ParaConsist: Semantic Consistency Score](https://arxiv.org/abs/2605.04665) — 2026
- [Pivot-based Paraphrase Generation Revisited](https://aclanthology.org/2021.emnlp-main.350/) — EMNLP 2021 (still cited as background in 2026)
- [When Prompt Under-Specification Improves Code Correctness](https://arxiv.org/html/2604.24712v1) — 2026
- [Semantics-Preserving Code Mutations](https://web-backend.simula.no/sites/default/files/2025-06/Hort%20et%20al.%20-%202025%20-%20Semantic-preserving%20transformations%20as%20mutation%20operators%20a%20study%20on%20their%20effectiveness%20in%20defect%20-%20hort2025_semanticpreserving.pdf) — Hort et al., 2025

P6 antecedents in this repo:
- `docs/SYSTEM_PROMPT_OPT_PLAN.md` §6, §8, §9, §11
- `core/prompt-optimization/data/query-shapes/recommendations.json` (P6 artifact, commit 7d9eb1d)
- `core/prompt-optimization/data/results/qshape-v1/track-b-summary.json:perToolWinRates` (Phase 7 input signal)

External review (integrated 2026-05-10):
- `docs/PHASE7-gemini-critique-2026-05-10.md` — Gemini 3.1 Pro Deep Think (`gemini-3.1-pro-preview` with `thinkingBudget: -1`) review of an earlier draft of this plan. Identified the latent-interpolation fatal flaw, the joint-mean variance trap, the TARE inefficiency, and contributed the 5 creative additions (Contrastive Trajectory Crossover, Dynamic Hard-Negative Probe Weighting, Evolutionary Bloat Control, Tool-Signature Masking, Hypothesis-Driven Backtracking). All 13 of its recommendations are integrated in the current plan; see §11.1 for the change-map.
- `docs/PHASE7-gemini-critique-2-2026-05-10.md` — Gemini 3.1 Pro Deep Think second-pass adversarial review (deliberately harsh, asked to attack the integrated plan). Surfaced the FATAL Round-11 probe-rotation discontinuity, the Maximin race-to-the-middle pathology, PRP-judges-blind-to-efficiency, Tool-Mask ghost-context-leak, OP-2 trajectory-crossover schizophrenia, gold-probe self-fulfilling prophecy, three code-search-specific pathologies, Frankenstein-prompt language regression, and 5 new creative additions (AST-ification of routing rules, stateful summarization forcing, distractor probes, length penalty, lazy-user query robustness). All 12 second-pass findings integrated; see §11.3 for the change-map.
- `docs/PHASE7-gemini-critique-3-2026-05-10.md` — Gemini 3.1 Pro Deep Think third-pass review with explicit "diminishing-returns honest" framing. Verdict: **SHIP IT** ("production-ready engineering with publication-grade methodology... better than 95% of the prompt-optimization pipelines currently running in the industry"). Three minor config tweaks integrated (Pruner pseudocode-protection, dilute trick probes <30%, JSONL rejection telemetry); explicit retractions of the GPT-5.4 push and the second-pass dev-set adversarial-probe density. See §11.4.
- `docs/PHASE7-gpt5-5-critique-2026-05-10.md` — GPT-5.5 xhigh external review (the production target itself). Surfaced 13 findings Gemini structurally couldn't catch: TPM-vs-RPM concurrency math (CRITICAL — would 429-storm the run), 0.15 cap utopia-point bug in Gemini's own fix (CRITICAL), stale joint-mean/latent-interp/ja-pivot residue throughout the doc (CRITICAL — implementers would follow rejected design), Java HOMP omitting GPT-5.5 (CRITICAL — direct Sonnet bias), asymmetric EAS that rewards GPT-5.5 under-exploration (HIGH), token-validator multiplicity gaps + surplus alias bugs (HIGH), OP-2 trajectory-style Sonnet import (HIGH), SCS-rewards-stable-wrongness (HIGH), real-fsync requirement (HIGH), forensic-metadata JSONL gaps (HIGH), single-family TARE/lazy-user paraphrase distribution (MEDIUM), n=6 Pareto noise floor (MEDIUM), fenced-python over-literalness (LOW). All 13 integrated; see §11.5 for change-map.

---

*Status: SHIP-IT verdict from Gemini three-pass review and GPT-5.5 xhigh external review (after integration of all 13 GPT-5.5 findings). Resolve §12 open questions (already resolved as of 2026-05-10), then tag `prereg/p7-v1` and kick off the run.*
