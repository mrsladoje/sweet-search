# Phase 7 — System-Prompt Evolution

**Created**: 2026-05-10
**Status**: Draft, ready for pre-registration tag and implementation
**Reviewed**: 2026-05-10 by (a) Gemini 3.1 Pro Deep Think — THREE PASSES (pass 1 = 13 findings; pass 2 = 12 adversarial findings incl. FATAL Round-11 re-baseline + Maximin race-to-middle + EAS + ghost-context-leak + AST-ification + language-transfer HOMP + pathology probes; pass 3 = SHIP-IT verdict + 3 minor tweaks). All Gemini findings integrated. (b) **GPT-5.5 xhigh** external review — the production target reviewing the plan from inside, surfacing 13 GPT-specific blindspots, methodology attacks, and operational footguns Gemini structurally missed (TPM-vs-RPM concurrency math, 0.15 cap utopia-point bug, asymmetric EAS that rewards GPT under-exploration, Java HOMP omitting GPT-5.5, stale joint-mean/latent-interp/ja-pivot residue, SCS reward-for-stable-wrongness, token-validator multiplicity gaps, OP-2 target-tagging, etc.) — all integrated; see §11.5 for the change-map. (c) **User catch** — reasoning-mode transfer gap: optimization runs against thinking-OFF, but power users run thinking-ON; closed by §3.5.2 reasoning-mode operational HOMP gate (Sonnet+thinking + GPT-5.5+reasoning on the full 30 held-out probes; ~$12 — see §3.5.2 and the cost table §11.4).
**Depends on**:
- **`ss-search` grounding (primary)** — `core/prompt-optimization/data/query-shapes/recommendations-v2.json` produced by PHASE6_REDO (see `docs/PHASE6_REDO.md`). Family-conditioned default + per-family overrides. Deprecates the prior P6 `qshape-v1` artifact for `ss-search`.
- **Other-tools grounding** — P6 `qshape-v1` artifact (`recommendations.json`, Track A/B JSONLs at commit `7d9eb1d`) is now superseded by per-tool v2 artifacts (`recommendations-v2-ss-find.json`, `recommendations-v2-ss-semantic.json`, `recommendations-v2-ss-trace.json`). All four tools have shipped Phase 6 redoes; see §4.2.

**Successor to**: docs/SYSTEM_PROMPT_OPT_PLAN.md §6, §8, §9, §11

---

## §1 Goal

Produce a **single shipped sweet-search agent system prompt** that maximises joint performance on the two production targets users actually deploy on:

- **Claude Code → Sonnet 4.6** (Anthropic direct API, extended-thinking OFF — Claude Code default)
- **Codex → GPT-5.5-instant** (OpenAI direct API — non-reasoning by name; chosen over GPT-5.4 for **pretrain future-proofing** — see §11.2)

…using a reflective evolutionary loop (GEPA) that is **engineering-effective** (with documented human-in-the-loop reflection) AND **scientifically defensible at submission tier** (TARE-style sharpness-aware selection, disjoint-family judge panel, HOMP, paraphrase-invariance reporting).

**Ship policy: ONE unified prompt.** The selection objective is the §3.7.1 native-relative `final_score` when a frozen native rg+Read baseline is supplied: correctness, tool-call count, and agent-token use are all scored relative to native search on the same probe and target, then aggregated with Maximin discipline across Sonnet 4.6 and GPT-5.5-instant. We do NOT ship per-target prompts — the goal is a single universal prompt that does best for MOST users.

**Held-out model classes (HOMP, not targets)**:
- **MiMo-V2.5-Pro** (Xiaomi) — primary HOMP class
- **Qwen 3.6 Plus via opencode CLI** — secondary HOMP class (proves the unified prompt transfers to open-weights even though we didn't optimise on it)

**Headline claim if results land**: "An empirically-evolved sweet-search agent system prompt that improves native-relative code-search desirability over default phrasing across Sonnet 4.6 and GPT-5.5-instant — preserving accuracy while reducing tool calls and agent tokens versus native rg+Read — with no per-target absolute accuracy regression > 0.15 (§3.7.1 admission cap), robust to paraphrasing (correctness-weighted SCS ≥ 0.8), and validated on two held-out model classes (MiMo-V2.5-Pro, Qwen 3.6 Plus) plus an 8-language out-of-distribution transfer set on both production targets (§3.5.1), plus a held-out Vault (n=25) opened exactly once as the final untouched confirmation number."

**Reasoning mode policy**: ALL evaluation runs in **non-reasoning mode** for parity. Both production targets default to non-reasoning, so this matches deployment reality. Reasoning-mode wins are a separate post-hoc claim, not part of the headline.

**Out of scope for this run**:
- Full §11.6 5-of-5 disjoint jury (we use a 3-of-3 minimum)
- Replication across seeds (single seed=42 run; replication is a follow-up)
- Larger publication-tier probe sets (60 dev / 40 sealed / 80 vault) — this run uses a credible supporting-contribution sizing instead (40 dev / 30 held-out / 25 vault across 10 languages + 8 out-of-distribution languages; see §2.4 and §5.0)

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
| Agent-query degrader/emitter (§3.6.1) | **Sonnet 4.6 / Opus 4.7 / GPT-5.5 / MiMo / Qwen** (agent-delegation paraphrase + cross-model emission) + **deterministic templates** (CLI-style) | Models emit agent-delegation phrasings + natural cross-model query shapes; templates cover the CLI/human minority | mixed |
| Judge 1 (deepseek family) | **DeepSeek-V4-Flash** (direct API) | Tested 99.9% clean in P6 after `max_tokens: 4096` fix | deepseek |
| Judge 2 (google family) | **Gemini-3.1-Flash-Lite** (direct API) | Tested 100% clean in P6 | google |
| Judge 3 (minimax family) | **MiniMax M2.7** non-reasoning (direct MiniMax API) | Cheap, reliable instruction-follower; clean family vs all targets and other judges | minimax |
| **HOMP class A** | **MiMo-V2.5-Pro** (Xiaomi, via Together or direct API) | Different family from all targets/judges/reflector. AA index 54. Validates cross-model transfer. | xiaomi |
| **HOMP class B** | **Qwen 3.6 Plus** via opencode CLI (or direct via Alibaba Cloud DashScope if available) | Open-weights frontier. Validates the unified prompt transfers to a class we didn't optimise on. | alibaba |

**Family map**: anthropic / openai targets → moonshot reflector → google embedding → deepseek + google + minimax judges → xiaomi + alibaba HOMP. **8 distinct families across all roles** — substantially exceeds §11.6's 5-family disjoint-jury requirement.

**Anthropic family note**: Sonnet 4.6 appears as both Target A AND as a paraphraser/degrader. This is *not* a §11.6 violation because the paraphraser is doing single-shot stateless generation — it never sees task evaluation feedback, never participates in selection or judging. The role-shape is entirely different from a jury slot. Per GPT-5.5 review §C2/§C4, we additionally rotate non-Anthropic generators (Kimi K2.6 / GPT-5.5 / deterministic templates) so paraphrase diversity isn't single-family-biased.

### §2.2 Direct-API by default for paid runs

Per the lesson learned in P6 (CLI harness is 50–100× slower than direct API for stateless calls):

| Call type | Path | Why |
|---|---|---|
| Agent runs (paid target) | **Direct API tool loop**: Sonnet via `ANTHROPIC_API_KEY`, GPT-5.5 via `OPENROUTER_API_KEY` | Avoids Claude/Codex subscription quotas while preserving measured Bash/Read / ss-* tool calls |
| Agent runs (development smoke) | CLI harness allowed with `--agent-provider cli` | Useful for subscription-backed local debugging only; not the production GEPA spend path |
| Reflector / Synthesizer | **Direct API** | Stateless; no tools needed |
| Judges | **Direct API** | Stateless; no tools needed |
| Paraphraser (OP-3 / TARE / agent-query degrader) | **Direct API** | Stateless |
| HOMP replay | **Direct API or CLI**, depending on model | Whichever is cheaper |

Implementation: target agent evaluation uses `p7-api-agent-runner.mjs` for paid runs. It implements an explicit local tool loop over the Anthropic Messages API and OpenRouter Chat Completions API. `gepa-cli.mjs` real runs default to `--agent-provider api`; `--dry-run --real` defaults to `cli` unless overridden. Stateless model calls continue through `eval/agent-read-workflows/judge-runner.js` direct runners.

### §2.3 GEPA configuration

| Parameter | Value | Rationale |
|---|---|---|
| Initial variants | 15 (T1–T15, hand-authored, P6-grounded + consumer-clean per §4.5 — see §4) | Standard 14-slate + T15 (Hypothesis-Driven Backtracking) |
| Pareto front size | 6 (joint front across both targets) | Balances diversity and selection pressure |
| Max rounds | **20** | Above the typical convergence point |
| Patience | **5 rounds** without improvement on §3.7.1 `final_score` (native-relative when `--native-baseline` is supplied; legacy Maximin × EAS fallback otherwise) | Standard early-stop |
| Plateau-breakthrough rule | If patience triggers but the *trajectory* shows step-changes within the last 3 rounds, **extend by 3 more rounds** before final stop | Catches GEPA-style "compositional jumps" — see §3.1 |
| Mutations per round | **3** (portfolio — see §3.2) | GAAPO-style portfolio |
| Reasoning mode for evaluation | **OFF** for both targets | Production-parity (see §1) |
| Screening probes per mutation | 8 (× 2 targets = 16 runs), selected by deterministic mixed language/stratum sampling rather than `first 8` | Cheap filter before full eval without the C++/C# prefix bias observed in gen-1 |
| Confirmation probes (survivor) | 40 = full dev (× 2 targets = 80 runs) | Joint scoring requires both targets |
| Joint score formula | **Native-relative desirability** when a frozen native rg+Read baseline is supplied: accuracy / tool calls / agent tokens are transformed to desirabilities with weights 0.60 / 0.25 / 0.15, combined by weighted geometric mean per probe-target, averaged per target, then aggregated by `min(sonnet, gpt5_5)` and length-penalized. Token desirability uses overhead-adjusted work tokens when the baseline supplies `overhead_tokens`, so fixed CLI/system context does not drown out retrieval-token savings. Legacy Maximin × EAS remains a fallback and diagnostic. Pareto admission is still gated by the 0.15 absolute accuracy-degradation cap relative to **the displaced incumbent** (NOT global per-target Pareto maxima — per GPT-5.5 review §C1, anti-utopia-point fix). | Unified-prompt ship policy (§3.7); aligns the optimizer with accuracy, speed, and token savings |
| Manual reflection cadence | **After every round** (see §3.4) | Human-in-the-loop GEPA |
| Persistence | **Append-only JSONL after every mutation, screen, confirm, TARE step** | Resume MUST work after crash — see §7.4 |

### §2.4 Probe sets (four-tier)

| Tier | n | Purpose | Inspection rules |
|---|---|---|---|
| **Dev** | 40 | GEPA loop free inspection, manual reflection | Free per-query inspection |
| **Held-out** | 30 | Frozen sanity-check after GEPA convergence | NEVER inspect during evolution |
| **Vault** | 25 | Final untouched confirmation — opened EXACTLY ONCE on the shipped winner after selection + all gates; reported, never optimized against (§5.8) | NEVER inspect; opened once at end of run |
| **Robustness pivots** (post-convergence) | 6 paraphrases × (15 dev + the full 30 held-out) = 45 probes (computed only on the winner) | SCS metric for paraphrase invariance | Computed once, after winner selected |

**Note**: This sizing (40 dev / 30 held-out / 25 vault) targets a *supporting-contribution* publishability bar with **broad language coverage**: dev/held-out/vault are a **stratified split by language (seed 42, per the CLAUDE.md benchmark methodology)** across **10 in-distribution languages** (JS, TS, Go, Python, Rust — the 5 P6 anchor repos — plus Java, C++, C#, Ruby, Kotlin from the SHA-locked ast-tester set; see §5.0), and §3.5.1 adds **8 out-of-distribution languages** (C, Dart, Elixir, Lua, PHP, Scala, Swift, Zig) as a winner-only cross-language gate — so the plan covers **all 18 distinct languages in the SHA-locked ast-tester set** (the 5 P6 anchor repos supply JS/TS/Go/Py/Rust; ast-tester repos supply the other 13 language slots). The held-out (n=30) is the published number, reported as a paired/directional claim backed by triangulation (HOMP × 2 families, SCS, 8-language transfer, pre-registration, the once-opened Vault), NOT a precise standalone point estimate. For GEPA-as-the-primary-contribution (a methods paper whose headline IS the prompt-opt number), the bar rises to 60 dev / 40 sealed / 80 vault per §11.2 of original plan.

### §2.5 Cost envelope

**Target ~$200 ± $30**. Per §10.

---

## §3 Methodology

### §3.1 The GEPA loop

The loop is **joint across both targets** (Sonnet 4.6 + GPT-5.5-instant). Per round:

1. **Selection** — Sample candidate from joint Pareto front (stochastic; weighted by per-probe wins on the §3.7.1 `final_score`: native-relative when the baseline is present, legacy Maximin × EAS otherwise).
2. **Mutation** — Generate 3 candidates per the §3.2 portfolio.
3. **Screening** — Each mutation evaluated on 8 mixed probes × **both targets** = 16 agent runs per mutation. The §3.7.1 `final_score` is the screen metric.
4. **Persistence checkpoint** — Append every screen result (one JSONL row per (mutation, probe, target)) to `core/prompt-optimization/data/results/p7-v1/gepa-trajectory.jsonl`. **Run is fully resumable from this file at any point.** See §7.4.
5. **Confirmation** — Top survivor re-evaluated on full 40 probes × 2 targets = 80 runs. Append to JSONL.
6. **TARE-style selection gate** — Compute paraphrase-sharpness for the survivor on the task-only Maximin score (see §3.3). Selection uses dual objective: `final_score` AND `1 − sharpness`; token/call efficiency belongs in `final_score`, not in the sharpness variance measurement.
7. **Pareto update** — Add survivor to front if it Pareto-dominates any incumbent on the joint two-objective space, AND passes the §3.7.1 step-11 0.15 accuracy-admission cap relative to the *displaced incumbent*.
8. **Manual reflection checkpoint** — User reviews top 3 failures **separately per target** (per GPT-5.5 review §E2): the report distinguishes Sonnet-only failures, GPT-only failures, and joint failures (both targets ≤ 0.4). Logs decisions in `core/prompt-optimization/data/p7-decisions.md` (see §3.4).
9. **Patience check** — If Δ`final_score`-best ≤ 1pp for 5 rounds, evaluate plateau-breakthrough rule (see below). If still flat, stop.

**Screen-probe selection (2026-05-28 fix).** Screening MUST NOT use `probeSet.slice(0, 8)`. Gen-1's first eight probes were all C++/C# and made the screen a noisy lower bound for the full 10-language dev set. The driver now uses `selectScreenProbes()` to choose a deterministic, resume-safe mix across strata and languages. For targeted diagnostics, `--screen-probe-ids <csv>` can force a problem-probe screen, but promotion-quality comparisons should use the representative mixed selector.

**Plateau-breakthrough rule** — When patience would trigger:

- Look at the past 8 rounds' `final_score`-best trajectory.
- If there's been at least one step-change of ≥ 3pp within those 8 rounds, **extend by 3 more rounds** before final stop. This catches GEPA-style compositional-jump dynamics ("the reflector suddenly figures out a higher-level abstraction").
- Otherwise, stop at patience trigger.

**Hard cap**: 25 rounds total, no exceptions.

**Mid-run probe rotation** (anti-overfit, per Gemini 3.1 Deep Think review): At **start of round 11**, rotate 5 fresh probes into the dev set, retiring the 5 probes with lowest score-variance across the current Pareto front (i.e. the "easy" probes everyone already mastered — they no longer discriminate). Held-out probes stay frozen. This prevents the GEPA loop from over-fitting the original 40 dev probes when there are 60+ candidates in flight. New probes drawn from a held-aside pool of 13 authored at the same time as the dev set (committed under `prereg/p7-v1` so the rotation is pre-registered, not post-hoc).

**Pareto-front re-baseline at rotation** (FATAL fix per Gemini second-pass review §B1): At the **exact moment of rotation** (start of round 11), the GEPA driver MUST re-evaluate the entire current Pareto front (typically 6 variants) on the 5 new probes BEFORE scoring any new mutations. Without this step, Round 12 candidates are evaluated on the new probes while incumbents are scored on old probes — apples-to-oranges Pareto comparison. Cost: 6 variants × 5 new probes × 2 targets = **60 extra agent runs** (~$5). Mathematically non-negotiable. After re-baseline, all variants on the front have scores covering the *same* 40 probes (the 35 retained + 5 newly rotated in).

**Dynamic hard-negative probe weighting** (per Gemini, with GPT-5.5 review §C5 noise-floor fix): from round 5 onward, each probe's contribution to the score is reweighted by its variance across the current Pareto front:

```
raw_variance = variance_of_scores_across_pareto(probe)
# GPT-5.5 review §C5 — anti-noise upweighting at small Pareto front (n=6):
# require ≥2 rounds of evaluation for variance to count, plus a noise floor
if rounds_evaluated(probe) < 2: weight(probe) = 1.0  # neutral until stable
else: weight(probe) = clip(max(raw_variance, judge_noise_floor=0.05), 0.1, 2.0)
task_score(variant) = weighted_mean(maximin_per_probe(variant), weights=weight)
if native_baseline_present:
    # Per probe-target: desirability = weighted_geomean(
    #   accuracy_desirability^0.60,
    #   call_desirability^0.25,
    #   token_desirability^0.15
    # )
    native_relative = min(mean(desirability over sonnet probes),
                          mean(desirability over gpt5_5 probes))
    final_score(variant) = native_relative − length_penalty
else:
    final_score(variant) = task_score(variant) × eas_factor − length_penalty
```

Probes everyone solves (low variance) get weighted ~0.1; probes that genuinely discriminate (high variance) get weighted ~2.0. This is the IR-learning-to-rank insight (LambdaMART-style query weighting) applied to prompt evolution: the optimizer spends pressure on the *frontier of difficulty*, not on already-mastered probes. The 2-round stability gate prevents single-round judge-noise from being upweighted as if it were genuine probe difficulty (per GPT-5.5 review §C5).

### §3.2 Mutation portfolio (GAAPO-style, post-Gemini-Deep-Think)

The mutation operator pool was substantially redesigned after Gemini 3.1 Pro Deep Think reviewed the original plan and identified a fatal flaw in the latent-interpolation approach (off-the-shelf retrieval embeddings cannot be decoded by a generative LLM — they map to a similarity manifold, not a generative latent space). The replacement design is empirically grounded and creatively richer.

**Operator pool (5 operators)**:

| ID | Operator | Mechanism | Why it's in the pool |
|---|---|---|---|
| OP-1 | **Reflective rewrite** (Kimi K2.6) | Reads N=5 native-relative inefficiency traces first (low call/token desirability versus native rg+Read even when accuracy is correct), falling back to joint-score ≤ 0.4 failures only when efficiency data is unavailable. Proposes one targeted edit. | GEPA's native operator. Workhorse. After accuracy saturation, this keeps pressure on fewer tool calls and lower agent tokens instead of prompting prose bloat. |
| OP-2 | **Contrastive Trajectory Crossover** (Kimi K2.6) | Find a probe where prompt A wins (≥0.8) and prompt B fails (≤0.4). Pass A's full tool-call trajectory + both prompts to Kimi + **the most recent manual-reflection hint as a hard negative constraint** (anti-schizophrenia per Gemini 2nd-pass §B3). **Trajectories MUST be target-tagged** (`target: 'sonnet'\|'gpt5_5'`) and the operator MUST identify whether the bottleneck is Sonnet-only, GPT-only, or joint (per GPT-5.5 review §B3 — anti-Sonnet-style import). When both targets have winning trajectories on the same probe, both are passed to Kimi as a **balanced pair** so the operator merges *behaviors compatible with both*, not just Sonnet's exploration cadence. When only one target has a winning trajectory, the operator is explicitly informed that the bottleneck is single-target and the other target needs different mechanism. Merge B's structural strengths with A's specific routing instructions, *while obeying the latest human-injected constraint*. | Empirically-grounded crossover. Compositional jumps grounded in actual agent behaviour, not abstract text similarity. **Replaces** the rejected latent-interp. |
| OP-3 | **Persona / Constraint Pivot + compact router tables** (Sonnet 4.6 + rotated non-Anthropic generator per round) | Two-mode operator: (a) standard structural-format pivot (bullets / numbered lists / prose / compact tables) AND (b) **router-table consolidation**: convert scattered conditional routing rules into a compact table with columns such as `Query signal | First call | Follow-up | Stop condition`. Mode (b) explicitly forbids ASTs, procedure blocks, pseudocode blocks, flowcharts, and fenced code. Mode (a) is default; mode (b) fires when the candidate has ≥3 conditional routing rules in prose. **Generator rotation per GPT-5.5 review §C2**: Sonnet is default but every 3rd round uses Kimi K2.6 or GPT-5.5 to generate the pivot, so the family of paraphrase noise isn't single-Anthropic. | **Replaces** ja-pivot and supersedes AST-ification. The gen-1 evidence favours compact dispatch tables over executable-looking pseudocode: less bloat, fewer over-literal interpretations, and clearer first-call routing. |
| OP-4 | **Tool-Signature Masking** (Kimi K2.6) | Temporarily alias `[[ss-search]] → [[TOOL_ALPHA]]`, `[[ss-find]] → [[TOOL_BETA]]`, `[[ss-semantic]] → [[TOOL_GAMMA]]`, `[[ss-trace]] → [[TOOL_DELTA]]` in the candidate. Ask Kimi to optimize the prompt so an agent could correctly use these tools *based only on prompt descriptions, not lexical priors*. After mutation, map names back. **Domain-stripping** (per Gemini 2nd-pass §A3 — anti-ghost-context-leak): the OP-4 reflector system prompt MUST also strip the words "code", "repository", "search", "semantic", "regex" and instead frame the task as "optimizing a generic database retrieval tool (TOOL_ALPHA), a regex-anchor lookup tool (TOOL_BETA), a vector-similarity tool (TOOL_GAMMA), and a graph-traversal tool (TOOL_DELTA)". Without this, the reflector hallucinates the domain back into surrounding context, defeating the masking. | **Cognitive forcing**: breaks the agent's reliance on pre-trained "search/find/semantic" lexical priors. Forces unambiguous self-contained tool descriptions. |
| OP-5 | **The Pruner** (Kimi K2.6) | "Remove ~20% of words from this prompt without changing any operational rule, `[[token]]`, or behavioural expectation. Make it terse. Preserve any existing fenced examples byte-identically; otherwise prune natural-language prose and tables." | **Bloat control.** GEPA's biggest failure mode is monotonic prompt inflation — reflectors add rules, never delete them. By round 20, prompts can balloon to 2,500+ tokens, diluting attention. Pruner provides downward pressure. Combined with the explicit length penalty in §3.7. With OP-3 now producing compact router tables instead of pseudocode, pruning pressure should consolidate rows and duplicate prose rather than preserving large code-looking blocks. |

**Per-round slot composition (3 mutations per round)**:

- **Slot 1**: OP-1 Reflective rewrite (always — the workhorse)
- **Slot 2**: OP-2 Contrastive Trajectory Crossover when a Pareto-front pair has the required A-wins / B-fails mismatch on at least one dev probe; otherwise fallback to a *second independent* OP-1 reflective rewrite on a different failure cluster.
- **Slot 3**: rotates through OP-3 → OP-4 → OP-5 → OP-3 → … per round (cycle of 3). At round 11+ when probe rotation has fired, the cycle resets to give each new probe set fresh exposure to all three structural operators.

**Pruner timing**: introduced from round 3 onward (rounds 1-2 prompts are still fresh and short — pruning would be a no-op). Kimi instructed to refuse pruning when the input is already minimal.

**Tool-Signature Masking timing**: every round it appears in slot 3. The mask-mapping is regenerated per call (different aliases each time) so the optimizer doesn't memorize the alias scheme.

#### §3.2.3 Stateful summarization forcing (anti-RIF, structural rule per Gemini 2nd-pass §D2)

Retrieval-Induced Forgetting (RIF) is a known cognitive-LLM failure mode: in long agent trajectories, the system-prompt instructions get pushed out of the primary attention window by accumulated tool results. By turn 4, the agent forgets the routing rules.

**Mitigation**: T2, T8, T13, T14, T15 seed variants explicitly include the structural rule:

> "Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first, you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question."

This forces the LLM to re-attend to the core objective mid-trajectory, breaking late-turn hallucination drift. It's NOT a mutation operator — it's a content rule available for the reflector to inject when failures show late-turn drift patterns. After round 5, if Gemini Deep Think's reflection (§3.4) flags "agent forgot the routing rules in turn 4+", the reflector can be hinted to add the `<state_summary>` rule to the candidate.

#### §3.2.1 Tokens that MUST be preserved verbatim through any paraphrase

The following tokens are wrapped as `[[...]]` in T1–T15 source files and are protected through ALL paraphrase/mutation operators that produce text variants:

| Category | Tokens |
|---|---|
| Tool names | `[[ss-search]]`, `[[ss-find]]`, `[[ss-semantic]]`, `[[ss-trace]]`, `[[ss-grep]]`, `[[ss-read]]` |
| Format markers | `[[json]]`, `[[regex]]` (`[[agent-format]]` removed from all bodies 2026-05-25 — undefined label, see §4.5 item 6) |
| Outcome marker | `[[no-match]]` (the gold-schema tokens `[[expectedFiles]]`/`[[expectedSymbols]]`/`[[expectedFacts]]` were removed from all bodies 2026-05-25 — see §4.5 item 6) |
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

- **HOMP class A — MiMo-V2.5-Pro** (Xiaomi family) — 30-probe subset (15 dev + 15 held-out)
- **HOMP class B — Qwen 3.6 Plus via opencode CLI** (alibaba family) — 30-probe subset (same)

**Pass criterion**: HOMP score on each class ≥ 0.7 × §3.7.1 `final_score` on Sonnet+GPT-5.5. Below this floor, the prompt is flagged "model-class-specific" and shipped with the caveat documented.

This catches the common failure mode where an optimised prompt is tuned to specific quirks of the target model classes (Anthropic + OpenAI) and doesn't transfer to open-weights families.

**Why two HOMP classes**: with only 2 production targets, demonstrating cross-family transfer is more meaningful with 2 held-out classes (xiaomi + alibaba) than 1. Cost of second HOMP class is negligible (~$1 marginal).

#### §3.5.1 Out-of-distribution language-transfer HOMP probe set (anti-Frankenstein-prompt, per Gemini 2nd-pass §E; expanded for the 10-language dev set)

With dev/held-out/vault now spanning **10 in-distribution languages** (§5.0), the Frankenstein-prompt risk shifts to languages *outside* that pool. **A prompt over-fit to the 10 in-distribution AST shapes could still silently regress on a language family absent from the optimization loop.**

**Mitigation — 8-language out-of-distribution (OOD) probe set**:

- Author **40 probes** = **5 each on 8 languages NOT in the in-distribution pool**: C (hiredis), Dart (dart-lang/http), Elixir (jason), Lua (Penlight), PHP (Slim), Scala (requests-scala), Swift (Alamofire), Zig (http.zig) — all SHA-locked in `eval/ast-tester-probes/repos.json`. These span systems (C/Zig), functional (Elixir/Scala), embedded (Lua), mobile (Swift/Dart), and web (PHP) — genuinely different from the in-distribution 10.
- Run on **HOMP class A (MiMo-V2.5-Pro)** AND **BOTH production targets — Sonnet 4.6 AND GPT-5.5-instant** (per GPT-5.5 review §B2 — anti-Sonnet-bias fix), winner-only.
- **Pass criterion**: aggregate **Maximin ≥ 0.55** across the 40 OOD probes on **both** Sonnet AND GPT-5.5 (lowered from the 1-language ≥0.6 because true 8-language OOD is a harder ask), with a **per-language scorecard** reported. Any single language < 0.4 is flagged a documented weak spot → ship-with-caveat for that language.
- **Chunker-path confound (honest caveat)**: 5 of the 8 OOD languages — Dart, Elixir, Lua, Scala, Zig — have **no tree-sitter grammar** and use the regex-fallback chunker (Elixir has a known `defprotocol`/`defimpl` gap; see `repos.json`). An OOD miss on those may reflect chunker-path quality, not prompt brittleness; the scorecard tags these so the two causes aren't conflated. They are deliberately kept OOD (not in dev) so the GEPA loop can't overfit to working *around* a chunker bug.
- File: `core/prompt-optimization/data/frozen/p7-langtransfer-probes.json` — committed under `prereg/p7-v1` so the language choice is pre-registered, not post-hoc.

**Cost**: 40 probes × 3 evaluations (MiMo + Sonnet + GPT-5.5) = 120 agent runs ≈ $7 (was 30 ≈ $1; +$6 for the 8-language expansion).

If the prompt fails the OOD gate, that's diagnostic — the GEPA loop overfit the in-distribution AST structures. Decision forks to §3.7.3: ship-with-caveat (per-language) or re-run with language-transfer as an added objective.

#### §3.5.2 Reasoning-mode HOMP gate (operational HOMP)

**The problem**: §1 + §2.3 fix reasoning OFF for both targets during optimization (production-parity for default users, and a budget reality — reasoning premiums would 3-5× the run cost). But power users — disproportionately the ones who care about prompt quality — flip thinking ON. As model defaults shift forward (Sonnet 4.7+ may make thinking the default; OpenAI is migrating reasoning into more tiers), this gap widens.

Reasoning-mode behavior diverges from non-reasoning in ways the loop cannot observe:

1. **Tool-call cadence shifts** — reasoning models pre-plan, often using fewer but more deliberate calls. EAS per-stratum windows (`multi-file-flow: [3, 6]`) calibrated on non-reasoning may misfire.
2. **Routing rules may be ignored** — reasoning models sometimes derive routing from first principles, skipping the prompt's prescriptions. Compact router tables help only if the reasoning model chooses to consult them.
3. **Stateful-summarization (anti-RIF) becomes redundant or harmful** — reasoning models manage their own working memory; our rule may conflict.
4. **Pruner-driven length cuts may hurt more** — reasoning-on benefits from richer context to ground its planning; an over-aggressively-pruned prompt may starve the planner.

There's a counter-case: prompt optimization on non-reasoning models *generally* transfers to reasoning (DSPy / Auto-CoT literature). But "generally" is not a number for sweet-search.

**Mitigation — operational HOMP (treat reasoning as a deployment mode, like a HOMP family)**:

- **Class A (operational)**: Sonnet 4.6 with **extended-thinking ON** (Anthropic API `thinking: { type: 'enabled', budget_tokens: 8000 }`)
- **Class B (operational)**: GPT-5.5 reasoning variant (the non-`-instant` tier; OpenAI direct API)
- Run the unified winning prompt against each on the **30 held-out probes** (NOT dev — held-out is intentionally untouched).
- **Pass criterion**: each operational HOMP class must score **≥ 0.7 × final_score** on the held-out probes — identical to the model-family HOMP gate (§3.5).

**Why 0.7× and not 0.85×**: reasoning-mode is a different operational regime, not a different model. We expect *some* drift (reasoning may waste tool calls relative to EAS calibration); 0.7× catches catastrophic failure without rejecting normal mode-drift.

**Cost**: 30 probes × 2 modes = 60 runs. Reasoning premium adds roughly 2-3× per call (~$0.20 vs ~$0.06 baseline). **Total: ~$12 — fits inside the ~$80 buffer below the $550 hard cap.**

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
2. Evaluate winner + 6 paraphrases (= 7 prompt versions) on **45 probes (15 dev + the full 30 held-out)** × **2 production targets** = 630 agent runs. (The full untouched held-out anchors the robustness claim; the dev portion stays a 15-probe subset since on-distribution invariance is the secondary signal.)
3. Compute **Semantic Consistency Score (SCS)** per [ParaConsist (2026)](https://arxiv.org/abs/2605.04665):
   - **Answer Consistency** (AC): `# probes where ≥5 of 7 prompts agree on answer / N` (where `N` = the probe count being scored — here the 45 probes of step 2, i.e. 15 dev + the full 30 held-out; `scs.mjs` `computeScsReport` divides by `N`, not a hardcoded 30)
   - **Semantic Similarity** (SS): mean cosine similarity of output embeddings (**Gemini Embedding 2**, 768-dim) across the 7 prompts per probe
   - **Length Stability** (LS): `1 − stddev(token_count) / mean(token_count)` per probe, then averaged
   - **SCS** = harmonic mean(AC, SS, LS)
   - **Correctness-weighted SCS** (per GPT-5.5 review §C3 — anti-stable-wrongness): `cw_SCS = SCS × min_paraphrase_accuracy` where `min_paraphrase_accuracy` is the lowest-accuracy paraphrase's correctness-on-gold across the 45 probes. A prompt that consistently gives the same WRONG answer scores high on naive SCS; correctness-weighting collapses it.
4. **Report**: per-target SCS, cw_SCS, and per-paraphrase accuracy delta.
5. **Ship gate**: **cw_SCS ≥ 0.8 across both targets jointly, AND minimum-paraphrase accuracy ≥ 0.6 on both targets** (per GPT-5.5 review §C3 — naive SCS alone is gameable). Naive SCS is reported but does not gate.

#### §3.6.1 Agent-mediated query robustness (per Gemini 2nd-pass §D5; re-scoped — sweet-search is consumed by agents, not humans)

**Re-scoping (why the original "lazy-user / tired-developer-at-2am" framing was wrong)**: that framing modelled a *human → sweet-search* pipeline. But sweet-search's production traffic is *human → parent agent (Claude Code / Codex) → sweet-search agent → [[ss-search]] / [[ss-grep]] / [[ss-find]]*. By the time a task reaches the sweet-search agent's system prompt it is **already an LLM-generated string** — cleaned up, structured, phrased in agent-typical ways — not a human typing telegraphic garbage. The dominant real-world variance is therefore **cross-model query-formulation shape** (Sonnet → interrogative "Where is X defined?"; GPT → imperative "Find the definition of X."; Opus → fuller context with file hints; reasoning models → narrower, symbol-anchored; smaller delegators → over-/under-decomposing), NOT missing-punctuation human typos. Direct-human input (CLI `[[ss-grep]]`, API power-users during exploration) is real but a small minority (~5–15% of traffic), so the human-typo case is **rebalanced down, not deleted**.

We evaluate the winner against agent-formulated / varied versions of the **40 dev queries**, distributed to match the production reality:

| Bucket | n (dev probes) | Variants | Source | Distribution it represents |
|---|---|---|---|---|
| **A — Agent-delegation paraphrase** | 28 | 1 each (28) | Generators rotated across Sonnet 4.6 / Opus 4.7 / GPT-5.5-instant / MiMo / Qwen, prompt: *"Rewrite this as a parent coding agent delegating a search task to a search sub-agent — include the symbol if known, anchor file hints if known, omit conversational fluff. Preserve the underlying intent and gold target. Output the delegated query only."* | The **dominant** production distribution |
| **B — Cross-model query-shape variance** | 6 | 4 each (24) | The same underlying intent *emitted* (not instructed-paraphrased) by 4 distinct families — Sonnet (anthropic) / GPT-5.5 (openai) / MiMo (xiaomi) / Qwen (alibaba) — each given the task + gold symbol and asked to formulate the search query it would issue; record what each naturally produces | Measures the **shape-variance the prompt must absorb**; the production-critical signal |
| **C — Deterministic templates (CLI-style)** | 3 | 1 each (3) | Family-free, no LLM: drop articles, abbreviate package names, lowercase, wrong extension | Power-user direct CLI invocation |
| **D — "Tired developer" (rare direct human)** | 3 | 1 each (3) | The old §3.6.1 framing, kept for completeness: telegraphic, missing punctuation, lowercase | Rare direct human input |

Covers all 40 dev probes (28 + 6 + 3 + 3); **58 query-variants** total.

**Gold-validity guard**: every generator/emitter is handed the probe's `[[expectedSymbols]]`/`[[expectedFiles]]` and instructed to preserve the underlying intent and gold target. This stops a "natural" bucket-B emission from drifting to a *different* answer — so a score drop reflects prompt brittleness, not query drift.

**Procedure**:
1. Generate the 58 variants (buckets A–D) via direct API (stateless).
2. Run the winning system prompt against **both targets** on all 58 variants = 116 agent runs.
3. Compute the score delta vs the well-formed-query baseline, and **query-shape cw_SCS** across bucket B's 4 emissions per probe (reuses the §3.6 correctness-weighted SCS machinery).
4. **Pass criteria** (per target, individually):
   - Aggregate degraded Maximin drop ≤ 20%.
   - **Bucket A alone** (the dominant distribution) drop ≤ 20% — so the small C/D buckets cannot mask an agent-delegation failure.
   - **Bucket B target-asymmetry check**: if one family's emitted phrasings (e.g. GPT-emitted) drop > 20% while another's (e.g. Sonnet-emitted) do not, that is a target-asymmetry EAS won't catch → §3.7.3 gate-failure flow.

**Bonus signal (free)**: bucket B directly measures the cross-model query-formulation variance the sweet-search agent prompt must be robust to in the first place — a prompt that aces its own paraphrases but craters on GPT/Qwen-emitted phrasings is target-asymmetric, which feeds the Pareto front. This overlaps the §3.5 HOMP classes (MiMo, Qwen), which are doing double duty: testing whether the prompt *runs* on those models AND whether *their query-formulation* stresses it — relevant because a user on Claude Code may delegate search to a Qwen sub-agent. (Restructuring §3.5 to make that explicit is deferred; bucket B probes it directly here.)

**Cost**: 58 variants × 2 targets = 116 agent runs ≈ $10 (variant generation across 5 families: ~$0.70 amortized).

This is a real shipping concern, not just a publication signal: production sweet-search sees agent-formulated queries constantly, and this gate prevents shipping an artifact brittle to the *actual* query distribution.

This (combined with SCS) is the publishable robustness claim that ICLR/NeurIPS reviewers expect.

### §3.7 Single unified prompt — ship policy (native-relative + Maximin discipline)

We ship **one** prompt, not per-target prompts. Gemini 3.1 Pro Deep Think identified two specific issues with the original mean-based scoring that this section now addresses:

- **Variance asymmetry trap**: if GPT-5.5 has higher score variance across probes than Sonnet 4.6, mean-scoring would implicitly become a GPT-5.5 optimizer (chasing the larger absolute deltas in its score space). **Solution**: keep **Maximin discipline** across targets: per-probe task scoring uses worst-target correctness, and native-relative selection takes the minimum target mean after per-target desirability aggregation.
- **GEPA prompt bloat**: reflectors monotonically add rules, never delete them. By round 20 prompts can balloon to 2,500+ tokens, diluting attention. **Solution**: explicit length penalty in the score formula + the OP-5 Pruner mutation operator (§3.2).

#### §3.7.1 Selection mechanics (native-relative objective)

1. **Per-target raw score**: for each (variant, probe), compute `score_sonnet(variant, probe)` and `score_gpt5.5(variant, probe)` independently. Each is in `[0, 1]`.
2. **Per-probe joint score** (Maximin): `joint_per_probe(variant, probe) = min(score_sonnet, score_gpt5.5)` — the worse of the two targets on that probe.
3. **Variant-level task score**: weighted-mean of `joint_per_probe` across the dev set, weighted by §3.1's dynamic hard-negative probe weights:
   ```
   task_score(variant) = Σ weight(probe) × joint_per_probe(variant, probe) / Σ weight(probe)
   ```
4. **Legacy Efficiency-Adjusted Scoring** (EAS, per Gemini second-pass §B2 + GPT-5.5 review §B1 — symmetric anti-gluttony AND anti-early-stop, per-target per-stratum): this remains computed and logged as a diagnostic/fallback. In paid GEPA runs, the primary scalar objective is the native-relative score in step 6. EAS still catches two behaviors worth inspecting: over-exploration (Sonnet failure mode) and under-exploration ("one plausible lexical hit, confident final" GPT-5.5 failure mode).

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

   # Native-search contamination penalty (Codex review round 2; §4.5):
   # The eval corpus is fully indexed + static, so reaching for native grep/rg
   # instead of the ss-* tools bypasses the retrieval being optimized. Tool use is
   # classified from BOTH the tool NAME and the shell command (Claude wraps ss-* in
   # Bash → name='Bash', command in input.command); ss-grep/ss-read are never
   # counted as native. usedReadOrGrep (the evidence flag) = ss OR native (any
   # evidence); usedNativeSearch drives this separate penalty.
   if used_native_search[target]:           # native grep/rg/ripgrep on the indexed corpus
       native_search_penalty[target] += 0.10

   # Aggregate efficiency factor — per-target then min:
   per_target_factor[target] = 1 − mean(call_deviation_penalty[target] over probes)
                                 − mean(evidence_adequacy_penalty[target] over probes)
                                 − mean(native_search_penalty[target] over probes)
   efficiency_factor(variant) = min(per_target_factor['sonnet'], per_target_factor['gpt5_5'])
   ```

   The `min` aggregation is structurally consistent with Maximin: a variant cannot pretend efficiency is fine because Sonnet's call distribution averages out GPT-5.5's reckless early-stops. Probe-stratum-aware windows mean a literal-lookup probe doesn't get penalised for 1 call, but a multi-file probe with 1 call (i.e., no-real-search) DOES.
5. **Native rg+Read baseline requirement** (primary paid-run objective): before a production GEPA run, freeze a per-target, per-probe native rg+Read baseline containing accuracy, tool-call count, and agent-token count for every probe the loop can score (the exact dev set, plus the rotation pool if rotation is enabled). The CLI flag is `--native-baseline <file>`. Missing baseline metrics for any scored `(target, probe)` are fatal; the run must fail rather than silently falling back to accuracy-only scoring.

   Accepted baseline JSON shapes are normalized to:
   ```json
   {
     "sonnet": {
       "probe-id": { "score": 0.90, "calls": 4, "tokens": 12000, "overhead_tokens": 7000 }
     },
     "gpt5_5": {
       "probe-id": { "score": 0.88, "calls": 5, "tokens": 13500, "overhead_tokens": 7800 }
     }
   }
   ```

   Row form is also accepted (`baselines: [{ target, probe_id, accuracy, tool_calls, agent_tokens, overhead_tokens }]`). Targets are canonicalized (`gpt-5.5`, `gpt5_5`, and OpenAI-family labels map to `gpt5_5`).

6. **Native-relative desirability** (primary scalar when the baseline exists):
   ```
   accuracy_floor = max(0.80, native_accuracy − 0.03)
   accuracy_target = min(1.00, max(0.95, native_accuracy + 0.02))
   d_accuracy = 0 below floor, 1 at/above target, linear between

   d_calls  = 1 at <= 0.50 × native_calls, 0 at >= 1.50 × native_calls
   work_tokens = max(1, total_tokens − overhead_tokens)   # overhead optional
   native_work_tokens = max(1, native_tokens − overhead_tokens)
   d_tokens = 1 at <= 0.65 × native_work_tokens, 0 at >= 1.50 × native_work_tokens

   probe_target_desirability =
       weighted_geomean(d_accuracy^0.60, d_calls^0.25, d_tokens^0.15)

   native_relative =
       min(mean(probe_target_desirability for sonnet),
           mean(probe_target_desirability for gpt5_5))
   ```

   The weighted geometric mean is deliberate: a prompt cannot compensate for a near-zero accuracy desirability by being cheap, and cannot compensate for extreme tool/token waste by scoring marginally well. This gives GEPA actual headroom even when the raw accuracy baseline is high (e.g. 0.935), because it can still improve call and token efficiency while preserving accuracy.

7. **Length penalty**:
   ```
   length_penalty(variant) = 0.05 × (token_count(variant) / 1000)
   ```
   So a 1000-token prompt loses 5pp; a 2500-token prompt loses 12.5pp. This prompt-bloat guard is retained even though agent tokens are already part of the native-relative objective.
8. **Final variant score**:
   ```
   if native_baseline_present:
       final_score = native_relative − length_penalty
   else:
       final_score = task_score × efficiency_factor − length_penalty
   ```
   This composite is what the Pareto front orders on. `task_score` and `efficiency_factor` stay recorded for diagnostics and for no-baseline dry runs.
9. **TARE sharpness** uses task-only Maximin: `sharpness = max(joint_min_score_i) − min(joint_min_score_i)` over candidate + 3 adversarial paraphrases. Tool-call and token efficiency are not folded into sharpness; otherwise a cheaper paraphrase could look "robust" for the wrong reason.
10. **Pareto front** (6-element) on two objectives: `final_score` (max), `1 − sharpness` (max).
11. **Pareto admission hard constraint** (FATAL fix per Gemini second-pass §A1, with GPT-5.5 review §C1 anti-utopia-point fix — Maximin race-to-the-middle guard): A candidate cannot enter the Pareto front if it degrades EITHER target's raw accuracy score by more than **0.15** relative to the **incumbent it would displace** (NOT relative to global per-target Pareto maxima — those may be different specialist prompts, creating a "utopia point" constraint that rejects genuinely joint-improving candidates).

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
        REJECT (don't add to Pareto, even if final_score is higher)
   ```

   **Why displaced-incumbent-relative**: Pareto front may have V_S = (0.91 Sonnet, 0.50 GPT) and V_G = (0.50 Sonnet, 0.91 GPT) as specialist incumbents. The aggregate per-target maxima are (0.91, 0.91) — a "utopia point" no actual incumbent achieves. A new candidate V_C = (0.75, 0.85) is genuinely joint-improving (Maximin 0.75 > both incumbents' 0.50), would Pareto-dominate V_G, and the 0.15 check should compare to V_G (the displaced incumbent: |0.50 − 0.75| = 0 violation on Sonnet, |0.91 − 0.85| = 0.06 violation on GPT — passes). Comparing to per-target maxima (0.91 Sonnet) would reject V_C at 0.91 − 0.75 = 0.16 — incorrectly rejecting the actual joint improvement. GPT-5.5 review §C1 catches Gemini's original 0.15-cap formulation as buggy.

   Without this guard at all, Maximin can mathematically *mandate* shipping a per-target regression. Example: V_A = (Sonnet 0.9, GPT 0.2), V_B = (Sonnet 0.55, GPT 0.55). Maximin prefers V_B (0.55 > 0.2), but V_B is a -0.35 regression for Sonnet users. The 0.15 cap rejects this trade.
12. **Final winner** = the Pareto-front variant with **highest `final_score`**, subject to:
    - **Floor**: per-target dev score ≥ 0.5 (no collapsed targets)
    - **HOMP gate**: passes both HOMP classes at ≥ 0.7× `final_score` (see §3.5)
    - **Language-transfer gate**: passes the language-absent-from-dev HOMP probe set (§3.5.1) at ≥ 0.6 — anti-Frankenstein-prompt guard per Gemini second-pass §E
    - **Reasoning-mode operational HOMP**: passes both reasoning-on classes (Sonnet thinking-ON + GPT-5.5 reasoning) at ≥ 0.7× `final_score` on held-out probes (§3.5.2). Fails → ship-with-caveat for power users, OR fork to reasoning-as-5th-objective extension run.
    - **Robustness gate**: passes correctness-weighted SCS ≥ 0.8 on both targets (§3.6)
    - **Length cap**: ship variant ≤ 2000 tokens
13. **Ship file**: `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` — one file, the unified prompt, headed with a YAML front-matter block citing the run ID, both raw per-target scores, joint Maximin score, native-relative factor, EAS diagnostic factor, avg tool calls, agent-token totals, length, length-penalty, final score, SCS, HOMP scores per class incl. language-transfer.
14. **Vault confirmation (opened EXACTLY ONCE)**: after the winner is selected and all gates above pass, open the 25-probe Vault (`frozen/p7-vault-probes.json`) and evaluate the shipped winner on it ONCE × 2 targets. This is a **pure confirmation/report, NOT a selection or gate** — the winner is never re-selected on Vault scores (that would burn the set). Report rule: if the Vault Maximin and native-relative aggregate are within ~15% of held-out, the result generalizes and the **Vault number becomes the headline**; a >25% drop is a documented overfit finding, disclosed with a caveated headline. Record in the YAML front-matter alongside the held-out scores. See §5.8.

#### §3.7.2 Why Maximin discipline still matters (with the §3.7.1 step 11 admission constraint)

Gemini's first pass suggested Z-score normalization OR Maximin. We chose Maximin because:

- Maximin is interpretable: "the prompt is at least X-good on every target." Reviewers and users get this immediately.
- Maximin matches the user-facing claim: "this prompt does well for MOST users" requires no user is left worse than X.
- Z-score normalization requires estimating per-target variance, which is itself noisy at n=40 probes.

**However, Maximin alone is insufficient** (Gemini's second pass critique §A1): in zero-sum target preferences (e.g., Sonnet wants verbose, GPT-5.5 wants terse), Maximin mathematically mandates a "race to the middle" that ships per-target regressions. The 0.15 absolute-degradation hard constraint (§3.7.1 step 11) closes that loophole. Without it, Maximin would happily promote a variant that scores 0.55/0.55 over a variant that scored 0.9/0.2 — a +0.35 Maximin gain but a -0.35 catastrophic regression for the high-target users.

The current combination — native-relative desirability + Maximin target aggregation + 0.15 raw-accuracy hard constraint + EAS diagnostics/fallback — is the load-bearing ship policy after the 2026-05-24 judging review.

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
> deprecated `recommendations.json`. The other three tools (`ss-find`, `ss-semantic`, `ss-trace`)
> have shipped their own PHASE6_REDO artifacts (`recommendations-v2-ss-find.json`,
> `recommendations-v2-ss-semantic.json`, `recommendations-v2-ss-trace.json`) — all four
> per-tool artifacts now exist and supersede the legacy directional signal.
>
> The new schema expects two fields per consumer:
> - `default.instruction_text` — global default, applied when family detection is unavailable or
>   the file's language doesn't map to a known family.
> - `family_overrides[<family>].instruction_text` — per-family override applied when the agent
>   has classified the target file into one of the 5 PHASE6_REDO families (OO-monolithic,
>   Systems-modular-terse, C-family, JS-mobile, Scripting-dynamic). Family detection is a
>   deterministic file-extension → family lookup; the agent does not reason about it.

All four ss-* tools now have shipped PHASE6_REDO artifacts — `ss-search`, `ss-find`,
`ss-semantic`, and `ss-trace` (shipped 2026-05-14 at commit `d70259b`). See §4.2 below
for the verbatim per-tool recommendations.
P6's `track-b-summary.json:perToolWinRates` is no longer the load-bearing input for any
ss-* tool; the per-tool redo artifacts supersede it.

**Historical (retracted) qshape-v1 directional signal for `structural`/`ss-trace`** —
the original P6 sweep flagged `structural` as preferring
`short+with-symbol+narrow-regex+interrogative+high-density` at 28% win rate. A 2026-05-14
session attempted a Phase 6 redo under that label but mistakenly targeted
`SweetSearch.structuralSearch` (the NL-regex-parse-then-route variant in
`core/search/sweet-search.js`, NOT used in production) instead of `ss-trace`'s actual
production path `traceSymbol` (in `core/search/search-trace.js` →
`StructuralContextBuilder.build` in `core/graph/structural-context.js`). The artifacts
produced under that session (`recommendations-v2-structural.json`,
`core/prompt-optimization/scripts/structural/`,
`core/prompt-optimization/data/query-shapes/structural/`,
`tests/unit/prompt-optimization/phase6-redo-structural.test.js`) are **retracted**. The
phrasing-tie finding from that session is also retracted — it applies to the wrong code path.
**Replaced** by the correct-path ss-trace failure-analysis program shipped at commit `d70259b`
(see §4.2 ss-trace bullet for the post-ship recommendations).

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
- **`[[ss-trace]]`** (symbol-in, structural-context-out via `traceSymbol` → `StructuralContextBuilder.build`): **PHASE6_REDO redo SHIPPED 2026-05-14** at commit `d70259b` — `recommendations-v2-ss-trace.json` ships THREE strategies covering one canonical options config (`maxDepth=3, queryHint=null, tokenBudget=null, k=5`); no NL-query shape grid since ss-trace is symbol-in. Strategies converge on the same options but carry distinct `instruction_text` to drive GEPA candidate diversity. The prior wrong-path session targeting `SweetSearch.structuralSearch` is retracted (see §12.1 above).

  **Headline (dev / heldout, n=105 / 65)**:

  | metric | callers | callees | impact (vs 1-hop proxy) |
  |---|---|---|---|
  | strict Recall@5 dev | 0.71 (27P / 14p / 1F) | 0.94 (21P / 0p / 0F) | 0.55 (21P / 15p / 6F) |
  | strict Recall@5 heldout | 0.81 (23P / 2p / 1F) | 0.87 (12P / 1p / 0F) | 0.62 (17P / 6p / 3F) |
  | production_recall_at_5 dev | 0.81 | 0.94 | 0.75 |

  `production_recall_at_5` re-grades after dropping test-path entries from the gold (mirror of ss-find's `relaxed_def_recall_at_1`). The +10pp callers / +20pp impact lift quantifies a **rubric vs ranker mismatch**: `graphNeighbors` gold includes test-file callers, and ss-trace's `-0.38 isTestPath` penalty in `scoreEntity` correctly demotes them per the tool's design (production callers must beat test fixtures). 6 of 7 dev FAILs are this rubric drift; the other 4 (all Python: `CustomContext`, `CustomCommand`, `MyType`, `ConfigParamType`) reveal a tree-sitter gap where test classes that inherit from production classes have ZERO outgoing call relationships in the graph — out of session scope to fix.

  **Two architectural assumptions verified** (handoff Stage 1):
  - *Adaptive 2-hop default for impact*: ✓ — `buildImpactPaths` does BFS upstream + downstream at `maxDepth = 3` default, stops at frontier exhaustion or limit=120. `core/graph/structural-context.js:186-246`.
  - *PageRank-in-rank*: ✓ — `scoreEntity` fuses 0.20 × directional Personalized PageRank (computed per-query from target) + 0.10 × static `page_rank` column (11,294 entities populated) + 0.10 × fan-in. `SWEET_SEARCH_TRACE_NO_PPR=1` / `SWEET_SEARCH_TRACE_NO_PR=1` ablation knobs already exist. `core/graph/structural-importance.js:60-101`.

  Both user beliefs are correct in code; no code change made. The handoff's intended Fix 1 (SQL substring-fallback guard on `findCallers`) is also NOT applied — 0 of 7 dev FAILs have symbols of length < 5 where the guard would change behavior. Documented unapplied with empirical justification in `recommendations-v2-ss-trace.json:failure_analysis.fix_1_sql_substring_guard`.

  **Strategy 1 — `simple_global` (single config, no family detection):** *"`[[ss-trace]]` is symbol-in / structural-context-out. Call when you already know the target symbol and want callers, callees, and impact paths in one response. CLI: `sweet-search trace <symbol> [--in <file>] [--depth N] [--budget N]`. Pass the symbol verbatim — do NOT phrase as an NL question. Default options (maxDepth=3, adaptive 4k/8k/12k budget) are optimal across all 18 indexed languages: dev callers R@5=0.71, callees R@5=0.94, impact R@5=0.55 against graphNeighbors-derived gold (n=105 dev probes, 21 PASS callees, 27 PASS callers, 21 PASS impact). Add `--in <file>` when the symbol is ambiguous across files (`Vec`, `Mux`, `get`, `App`, `Use` have ≥2 entity rows in the indexed corpora)."*

  **Strategy 2 — `family_conditioned` (family detection, no overrides triggered):**
  ```
  classify target file → 5-family lookup (same family-map.mjs as ss-search/ss-find)
  no per-family override fires — single options config measured; no family-best R@5
  beats default by ≥ 8pp (future maxDepth/queryHint sweeps may populate)
  default applies to all families:
  ```
    Default (all families): *"`[[ss-trace]]` is symbol-in / structural-context-out. Call when you already know the target symbol and want callers, callees, and impact paths in one response. CLI: `sweet-search trace <symbol> [--in <file>] [--depth N] [--budget N]`. Pass the symbol verbatim — do NOT phrase as an NL question. Same defaults as simple_global apply per-family. The C-family / JS-mobile families have the strongest baseline (R@5 ≥ 0.93 callers, 1.0 callees); Scripting-dynamic (python/ruby/php) is the weakest (R@5=0.62 callers, R@5=0.83 callees) primarily because tree-sitter Python doesn't capture test-class-inherits-production-class edges (4 of 7 dev FAILs). For Python specifically, the impact tool's transitive expansion underperforms — prefer callees/callers calls when in Python."*

  **Strategy 3 — `popular_weighted_agentic` (agentic-tier weighting, no family detection):** *"`[[ss-trace]]` is symbol-in / structural-context-out. Call when you already know the target symbol and want callers, callees, and impact paths in one response. CLI: `sweet-search trace <symbol> [--in <file>] [--depth N] [--budget N]`. Pass the symbol verbatim — do NOT phrase as an NL question. Under 2026 agentic-tier weights (TS/Python/Rust=5, mainstream=3, longtail=1), the canonical defaults remain optimal. Python's higher weight surfaces its callers/impact failure modes — see family_conditioned guidance."* Same `agentic-tier-weights.json` scheme as ss-find / ss-semantic; weighted callers R@5=0.67, callees R@5=0.93, impact R@5=0.49.

These bullets are the **source findings**, not the shipped prompt text. **As of 2026-05-23 they are compiled into bare, consumer-facing directives before entering a T_i variant body — NOT pasted verbatim** (this paragraph's original "go verbatim" rule was the root cause of the provenance-leak defect; it is now superseded). The `recommendations-v2-*.json` artifacts carry optimizer-internal provenance — Phase-6 labels, `V1–V7` shape names, recall metrics (`R@5`, `symbol_recall`, `IoU`), `pp` deltas, `dev FAILs`, tree-sitter notes, agentic-tier weighting — that the consuming agent has no knowledge of and cannot act on. Embedding it verbatim wastes tokens and (per the *Curse of Instructions* / constraint-attention literature) actively diverts the model's attention from the actual rule. The compilation strips all provenance and keeps only the actionable imperative. **See §4.5 for the full consumer-clean authoring contract.** Until a programmatic transform exists this compilation is performed by hand at authoring time; making it a script is the open follow-up in §4.5.

**Schema divergence across `recommendations-v2-*.json` artifacts (PHASE7 consumer alert)**: the four per-tool artifacts ship two distinct top-level shapes:

- **ss-search** (`recommendations-v2.json`, `schemaVersion: 5`): top-level `{ default, family_overrides, popular_weighted, ... }` — the historical first-shipper schema.
- **ss-find / ss-semantic / ss-trace** (`recommendations-v2-ss-{find,semantic,trace}.json`, `schemaVersion: 1–2`): nested `{ strategies: { simple_global, family_conditioned, popular_weighted_agentic } }` — the later, more uniform schema.

The semantics are equivalent (each ships three strategies + per-family breakdown + secondary metrics) but the JSON paths differ. PHASE7 GEPA consumer code that ingests these artifacts must abstract over both shapes — e.g., normalize-on-read into a `{ tool, simple_global, family_conditioned, popular_weighted }` shape before reasoning about strategies uniformly. A schema migration to one canonical shape is deferred to a focused session post-PHASE7; aligning here would be a semantic rewrite, not housekeeping.

### §4.3 Variant slate

The 15 hand-authored seed variants (the standard 14 + T15) are organised along three orthogonal axes:

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
| T10 | Hybrid: tool + shape | Medium | None | full §4.1 + §4.2 + ss-trace symbol-not-query contract | ~700 tokens |
| T11 | Hybrid: tool + evidence | Medium | None | §4.2 routing + citation discipline | ~700 tokens |
| T12 | Minimal baseline (control) | Terse | None | NO P6 grounding (proves §4.1 helps) | ~250 tokens |
| T13 | Aggressive "no-match-first" | Medium | `expectedNoMatch` | + §4.2 + early-exit logic | ~700 tokens |
| T14 | Behavioral-query optimized | Medium | Multi-file flow + behavioral | + §4.2 + ripgrep-sink-trait-style multi-callback handling (the gold class P6 timed out on) | ~800 tokens |
| T15 | **Hypothesis-Driven Backtracking** (per Gemini critique) | Medium | All + structured `<failure_analysis>` blocks | encodes "if a tool returns empty result, write `<failure_analysis>` explaining why the code wasn't there before invoking next tool"; leverages 2026-era LLM test-time-compute even with extended-thinking OFF | ~900 tokens |

**Family-conditioned `ss-search` clauses (post-PHASE6_REDO supersession)**: every T_i whose body contains a `[[ss-search]]` clause and whose `p6_grounding` is `full` or `partial` derives its shaping rule from `recommendations-v2.json` (default + per-family overrides), NOT the deprecated flat `recommendations.json` — but the rule is **compiled to a provenance-free directive (§4.5), not embedded verbatim**. `[[ss-find]]`, `[[ss-semantic]]`, and `[[ss-trace]]` clauses likewise derive from their own `recommendations-v2-*.json` artifacts (all four shipped). T12 (the no-grounding control) remains literally control — no shape clauses for any tool.

**T12 (the no-grounding control) matters**: if T12 wins despite skipping §4.1 guidance, that's evidence that P6's directional signal didn't generalise. If T12 underperforms, the P6 grounding was load-bearing. Either way, useful. The family-conditioned ss-search supersession does NOT change T12's role — T12 stays grounding-free regardless of which P6 artifact is the live one.

**T15 (Hypothesis-Driven Backtracking, added per Gemini critique)** addresses a specific failure mode P6 surfaced: agentic code search often spirals when an early tool call returns empty — the agent blindly tries another query without updating its mental model. T15 forces an explicit `<failure_analysis>` block after any empty result before the next tool invocation, which empirically engages test-time compute even when the agent is in non-reasoning mode (Sonnet thinking-OFF, GPT-5.4-instant). If T15 dominates other variants on the `expectedNoMatch` and behavioural strata, that's a publishable observation in itself.

Each seed is a separate file: `core/prompt-optimization/data/p7-variants/T1.md` … `T15.md`. Each carries YAML front-matter:

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

14 is the standard slate per the original §6 plan. Going to 20+ seeds dilutes per-seed evaluation; going to 7-10 reduces diversity below GEPA's effective exploration radius. 14 is the published GEPA empirical sweet spot. (T15 is an explicit addition beyond the standard 14, added per Gemini critique — see §4.3 — so the live slate is 15 files.)

### §4.5 Consumer-clean authoring contract (added 2026-05-23)

**Problem.** The seed bodies authored under the original §4.2 "verbatim" rule leaked optimizer-internal knowledge into the shipped prompt. A variant prompt has two distinct audiences that the original authoring conflated:

1. **The optimizer (us)** — knows Phase 6, the `V1–V7` shape labels, recall deltas, `dev FAILs`, the agentic-tier weighting, tree-sitter quirks. This is *provenance*: the evidence for *why* a rule exists.
2. **The consumer agent** — a fresh coding agent (Claude Code → Sonnet 4.6, Codex → GPT-5.5-instant, or any host with no prior context) that must *execute* the rule. It has never heard of any of the above.

A shipped system prompt must contain only what audience (2) can act on. The original §4.2 directive ("these bullets go *verbatim* into the variant bodies") violated this — it shipped audience-(1) provenance to audience (2).

**The contract.** Every T_i body MUST satisfy all of the following (enforced by `tests/unit/prompt-optimization/p7-variants.test.js` → describe block *"consumer-clean contract"*):

1. **Capability-card framing, not persona.** Open with `# Sweet-search — code search tool guide`, NOT "You are the sweet-search agent." Rationale: sweet-search is consumed *by* an agent (§3.6.1 production pipeline: human → parent agent → tools). A persona causes (a) identity collision with the host agent and (b) non-composability — a persona only fits a dedicated sub-agent slot, whereas a capability card composes into *both* a sub-agent and direct injection into a host's context. The headline goal (§1) is one prompt that generalises to *any* consuming agent, so the deployment-agnostic framing dominates. (Anthropic, *Writing effective tools for agents*: tool docs should read like instructions "to a new hire," never role-play.)

2. **Native-tools boundary (load-bearing).** Every body states: prefer the index-backed `[[ss-*]]` tools over raw `grep`/`ripgrep` and blind file reads for code search/navigation. This is the single highest-value instruction — frontier coding agents are heavily trained to reach for `rg` + read, and without an explicit redirect they never invoke sweet-search at all (optimising a tool nobody calls). The boundary is a **strong default, not an absolute**: it explicitly permits falling back to plain `grep` for changes not yet indexed (uncommitted working-tree edits — the known dirty-overlay gap) or when the `[[ss-*]]` tools return nothing. An absolute "NEVER use grep" would manufacture wrong answers on freshly-edited files.

3. **No provenance leakage.** Bodies MUST NOT contain: `Phase 6` references, `V1–V7` shape labels, recall metrics (`R@5`, `symbol_recall`, `IoU`), percentage-point deltas (`18–29 pp`), `dev FAILs`, `tree-sitter`, `graphNeighbors`, `agentic-tier weights`, or `N indexed languages`. Each finding is compiled to a bare imperative — e.g. *"Omitting the symbol cuts symbol_recall@1 by 18–29 pp vs the V7/V4 winners"* → **"Always include the target symbol verbatim in the query."**

4. **Strengths-vs-weaknesses asymmetry.** A tool's *strength* is not actionable (you use the tool normally regardless), so strong-spot statements are dropped entirely. A *weakness* is actionable only when paired with a compensating action, so it survives only in that compiled form. Concretely, all the `ss-trace` family `R@5` baselines were removed except the one actionable consequence: **"In Python/Ruby/PHP, prefer callers/callees over impact — impact is unreliable there."**

5. **Sufficiency-based stopping, not hard caps.** Bodies MUST NOT impose fixed call/hop counters ("cap at 3 hops", "report no-match after 2 attempts"). Two reasons: (a) such caps contradict the EAS scoring (§3.7.1), whose per-stratum windows expect up to 6 calls for `multi-file-flow` and explicitly penalise *under*-exploration — an agent obeying a "give up after 2" prompt would be penalised by the very metric selecting it; (b) a hard cap on a misqueried search manufactures a confident **false negative**, the worst failure mode for a search tool (and the documented no-match-precision risk in CLAUDE.md). Replacement rule, in every body: stop on confirmed evidence; between failed attempts change the approach (re-form hypothesis / broaden / switch tool) rather than repeat a near-identical query; conclude `[[no-match]]` only after verifying absence (a symbol search and a broad `[[ss-grep]]` both empty). This keeps a soft anti-spiral guard (the escalation ladder, esp. in T15's `<failure_analysis>` loop) without the brittleness of a counter.

6. **Consumer-language answer contract — no gold-schema or agent-format tokens (added 2026-05-25).** The output section names the answer in plain developer terms — e.g. *"name the file(s) and symbol(s) and explain how they work, or `[[no-match]]`"* — and MUST NOT use `[[expectedFiles]]` / `[[expectedSymbols]]` / `[[expectedFacts]]`. Those are the probe **gold field names** and a near-verbatim mirror of the judge's reward rubric (`buildJudgeUserPrompt` rewards "answers that cite the expected files/symbols and state the expected facts"), so coaching them in the prompt couples the optimization to the grader — the output-layer analog of the §5.7 query-shape overfit, and the one overfit channel neither the counter-probes nor the held-out gates would catch. The *internal* gold-field names stay `expectedFiles` in `ProbeSchema` (`p7-shared.mjs`), `buildJudgeUserPrompt`, and every probe JSON — they are never shown to the production agent (only the judge reads them), so no schema/data rename was needed. Also removed in the same pass: the `[[agent-format]]` token — an *undefined* label (no glossary ships, so the agent received `[[agent-format]]` with nothing defining it) that added no actionable signal beyond the concrete answer clause. The eval harness user-turn (`buildAgentUserPrompt`) was reconciled from "respond in the requested agent format" to a concrete "report which file(s) and symbol(s) answer it and how" so its reference does not dangle. Enforced by the *"no body references gold-schema or the undefined agent-format token"* assertion in `p7-variants.test.js`, with `[[expectedFiles]]`/`[[expectedSymbols]]`/`[[expectedFacts]]`/`[[agent-format]]` all dropped from `KNOWN_TOKEN_NAMES` so any reintroduction fails CI.

**Preserved unchanged.** The three design axes (§4.3 table); the `[[token]]` sentinels and their multiplicity (§3.2.1); the §3.2.3 `<state_summary>` rule in exactly T2/T8/T13/T14/T15; T15's `<failure_analysis>` block; family-conditioned query shaping (kept as a design axis for GEPA + the T12 control to evaluate empirically — see the open question below); and all front-matter (so `validateVariant` and the GEPA driver are unaffected). Token budgets remain inside the §4.3 ±30% gate (measured 0.78–1.04× target — bodies are leaner but the verbosity ordering terse < medium < verbose holds).

**Test-contract change (transparency for review).** The pre-2026-05-23 `p7-variants.test.js` asserted each grounded body embedded a §4.2 bullet *verbatim* (plus the `ss-trace` bullet and the `ss-search` default bullet) — i.e. it enforced the very provenance coupling this contract removes. Those three assertions were re-pointed (not deleted) to the new invariants: (i) no body matches any provenance pattern; (ii) no body uses the persona opening; (iii) every body carries the capability-card header; (iv) every body carries the native-tools boundary; (v) grounded bodies carry compiled shaping guidance; (vi) `none` bodies carry no family-conditioning; (vii) `full` bodies encode the `ss-trace` symbol-not-query contract; (viii) the compiled Python `ss-trace` directive appears in the slate. Suite status: **78/78** in `p7-variants.test.js`, **148/148** across the P7 unit suite (gepa / evaluate / scoring / token-validator / cli / pareto-rebaseline / ood-gate / reasoning-homp), including the GEPA crash-resume / Pareto-equivalence tests.

**Open follow-up — compilation step.** The provenance→directive compilation is currently performed **by hand** at authoring time. This is fragile under regeneration: the §4.2 note still regenerates clauses from `recommendations-v2-*.json` on artifact update, GEPA's OP-5 Pruner is forbidden from editing numbers inside pseudocode (§3.2), and reflectors monotonically *add* rules — so provenance could creep back without a guard. The durable fix is a small programmatic transform (`recommendations-v2-*.json` → provenance-stripped directive string) invoked wherever a variant clause is (re)generated, with the `p7-variants.test.js` provenance scan as the CI backstop. Deferred to a focused session; tracked here so it is not lost.

**Open question — family-conditioning cost.** The per-family `ss-search`/`ss-find` shaping tables (classify file → C-family / JS-mobile / default → distinct shape) are the single largest token line-item remaining in the grounded variants, and the deltas that justified them lived in the now-stripped metrics. Whether the family table earns its token cost vs a single robust default is left to GEPA + the T12 control to answer empirically; it was deliberately NOT removed in this pass (removing it would be a design change, not a cleanup).

### §4.5.1 Codex review round 2 — additional fixes (2026-05-23)

A second external review (GPT-5.5 / Codex) on the consumer-clean commit surfaced four blocking issues that materially change *what the GEPA run optimizes*, plus prompt-body tightenings. All are now fixed; the run should NOT start without them.

**Blocker A — shell-wrapper call syntax (operational, not provenance).** The ss-* tools are CLI shims on `PATH` (`eval/agent-read-workflows/bin/`), invoked through the shell — they are NOT native tool names. The seed bodies named `[[ss-find]]` etc. but never told the agent the call shape, so a non-Claude agent could hunt for a literal tool named `[[ss-find]]`. Every body now carries a **"Calling the tools"** block mapping each sentinel to its real CLI signature (verified against the shims):
```
[[ss-search]]  → ss-search "<query>" [-k N]
[[ss-find]]    → ss-find "<query>" --regex "<regex>" [-k N]
[[ss-semantic]]→ ss-semantic <file> "<query>"
[[ss-trace]]   → ss-trace <symbol> [--in <file>]
[[ss-grep]]    → ss-grep "<regex>" [-k N]
[[ss-read]]    → ss-read <file> [start] [end]
```

**Blocker B — Bash-command telemetry misclassification (anti-Sonnet bias).** `usedReadOrGrep` was computed as `SS_TOOL_RE.test(tc.name)`. For Claude, ss-* runs through Bash so `tc.name === 'Bash'` (the command is in `tc.input.command`) → every Claude run that used ss-* was scored as "no evidence" and hit the 0.10 evidence-adequacy penalty, while Claude's *native* `Read` tool (name `'Read'`) was wrongly credited. Fix: `classifyToolUse(toolCalls)` in `gepa-evaluate.mjs` inspects **name + command** and returns `{ ss, nativeSearch, nativeRead }`; `usedReadOrGrep = ss || nativeSearch || nativeRead`, plus the new `usedSweetSearch / usedNativeSearch / usedNativeRead` fields. (Codex confirmed the eval slot: Sonnet gets the variant via `--append-system-prompt`, Codex via an `[SYSTEM]` block — host-agent context, so the capability-card framing is correct.)

**Blocker C — native-fallback eval contamination.** The production-correct "fall back to plain grep" clause would let native grep rescue ss-* misses on the fully-indexed, static eval corpus, so GEPA could optimize "try sweet-search, then grep" instead of sweet-search quality. Fix: the §3.7.1 EAS now applies `nativeSearchPenalty` (DEFAULTS, initial 0.10) per run where `usedNativeSearch` is true; the CONFIRM event logs `native_search_penalty` per (probe, target) so the native-fallback rate is measurable on the first smoke (validate the magnitude then). The fallback clause stays in the prompt (production robustness) but is now scored as a defect in eval — consistent, not contradictory: a prompt good at ss-* never triggers it.

**Prompt-body tightenings (Codex round 2):**
- **Unknown symbol/file → Default.** Family-conditioned shaping assumed the target file/symbol was already known. Every family variant now states: *"If the target symbol or file is unknown, lead with domain terms (Default shaping) and switch to symbol-anchored shaping once a candidate symbol appears."* — fixing both the "assumes file known" gap and the "Always include the symbol" backfire when the symbol is unknown.
- **No-symbol (conceptual) no-match.** No-match guidance assumed a concrete symbol exists. Every no-match variant (T3/T6/T9/T13/T15) now adds: *"For a conceptual query with no obvious symbol, first try 2–3 likely lexical anchors or a broad [[ss-search]]; only conclude [[no-match]] after those also come up empty."*
- **T12 fallback parity.** The grounding-free control now carries the same native-tools fallback clause as the rest of the slate, so the boundary is held constant across the experiment (only strategy/shape varies).

**Test contract (round 2).** `p7-variants.test.js` adds: wrapper-syntax present for all six tools in every body; no hard-cap counters (`cap at N` / `after two attempts` / `do NOT continue` / `at most N hops`); fallback clause in every body incl. T12; broadened provenance scan (`recall@N`, `recall at N`, `percentage points`, `winner(s)`, `benchmark`, `recommendations-v2`, `\bV\d+\b`); unknown-hint default in family variants; no-symbol guidance in no-match variants. `p7-evaluate.test.js` adds `classifyToolUse` tests (Claude Bash-wrap, Codex command-name, native grep, ss-grep guard, native Read, query-string false-positive, malformed input). `p7-eas.test.js` adds native-search-penalty tests (applied, back-compat when absent, stacks with evidence penalty). Suite after round 2: full P7 unit suite green (1097 prompt-optimization tests).

**DONE (2026-05-25) — `[[expectedFiles]]` / `[[expectedSymbols]]` / `[[expectedFacts]]` removed from the prompt bodies.** Round 2 deferred this as a risky cross-cutting *rename*, but that conflated two separable things. The consumer-facing problem is only the **prompt-body tokens** (the sole place the production agent sees them); those are now reworded to consumer language across all 15 (§4.5 item 6). The **internal gold-field names** are deliberately KEPT as `expectedFiles` in `ProbeSchema`, `buildJudgeUserPrompt`, and every probe JSON — the production agent never sees them (only the judge does), so no schema/data/JSON rename was performed and the original regression risk does not apply. `token-validator.mjs` matches `[[...]]` by shape (`PROTECTED_TOKEN_RE`), not a name list, so it was unaffected; `KNOWN_TOKEN_NAMES` was tightened to forbid the tokens' return. Full P7 suite green (1147).

### §4.6 Gen-1b restart scaffold after round-10 analysis (2026-05-28)

Gen-1 reached an accuracy-saturated front where the remaining objective is native-relative efficiency: fewer tool calls, fewer agent work tokens, and faster sufficient-evidence stopping. The restart path is intentionally explicit rather than silently mutating the historical gen-1 run:

1. **Normalize the current Pareto front** by stripping any outer markdown fences from incumbent prompts. This addresses the observed fence artifact: fenced whole-prompt bodies can be interpreted as inert/code-like text by host agents and make OP-5 preserve the entire prompt as a protected fenced block.
2. **Append three new hand seeds** focused on the actual stable failures: exact-anchor-first routing (`[[ss-grep]]` / `[[ss-find]]` before `[[ss-search]]`), fast no-match termination, and trace-first multi-file flow after an anchor.
3. **Ablate the normalized front plus the three seeds on the full 40 dev probes** before starting any new GEPA rounds. This creates a clean gen-1b front from comparable measurements rather than patching stale gen-1 scores.
4. **Use representative mixed screening** for later rounds. Problem-probe screens are useful diagnostics, but they should not be the default selection screen because they overfit the mutation operator to known pain points.

Implementation scaffolding:

```bash
# Dry plan only; does not write and does not start a run.
node core/prompt-optimization/sweep/gepa-restart-scaffold.mjs \
  --from-run p7-gen1-20260526-v3

# When ready, materialise the restart T_i slate.
node core/prompt-optimization/sweep/gepa-restart-scaffold.mjs \
  --from-run p7-gen1-20260526-v3 \
  --out-dir core/prompt-optimization/data/p7-variant-restarts/p7-gen1b-normalized \
  --write

# Later, after review/preflight, a real run can consume the slate with:
node core/prompt-optimization/sweep/gepa-cli.mjs \
  --variants-dir core/prompt-optimization/data/p7-variant-restarts/p7-gen1b-normalized \
  --probes core/prompt-optimization/data/p7-dev-probes.json \
  --native-baseline core/prompt-optimization/data/frozen/p7-native-rg-read-baseline.json
```

**Cache/control note.** Prompt-cache effects can dominate native-relative token measurements when candidate runs are interleaved differently. Treat any winner promoted by a rerun amendment as provisional until it is remeasured under the same harness path, concurrency, and candidate ordering as its peers. Keep concurrency modest enough that identical-prefix Sonnet calls can benefit from cache writes before the next batch fans out; avoid mixing a cold full-front ablation with a warm single-candidate rerun when comparing final scores.

#### §4.6.1 Round-0 seed ablation gate (mandatory before any gen-1b evolutionary round)

The normalized front, the three hand seeds, and the pruner-placeholder seed (`source_id: pruner-placeholder-joint-best`) are **hypotheses until measured on the dev set under one consistent harness path**. Their `expected_strengths` / `expected_weaknesses` frontmatter records intent, **not** a fitness signal. Mutation operators must never be allowed to select a parent whose only support is its frontmatter — this is the GEPA analogue of training-on-the-test-set.

Before the first OP-1/OP-2/OP-3/OP-4/OP-5 mutation in gen-1b:

1. **Run a full 40-probe dev-set measurement** on every variant in the restart slate (normalized front + 3 hand seeds + pruner placeholder, plus `p7-native-baseline-dev-3panel.json` for native-relative scoring). Use a single concurrency setting, a single ordering, and a single cold start so that prompt-cache, rate-limit bucketing, and TARE adversarial paraphrases are comparable across candidates.
2. **Do NOT inspect held-out probes** during this ablation, per CLAUDE.md benchmark methodology. The 40-probe dev set is the only signal the ablation may use.
3. **Admit seeds and front members to the gen-1b Pareto front by measured `finalScore` only.** Drop any candidate whose measured finalScore is below the worst kept member by more than the gen-1b admission cap (default 0.15, same as gen-1). Hand-authored seeds that score below the worst gen-1 incumbent are evicted before evolution starts.
4. **Record the ablation as the gen-1b round-0 trajectory event** so the round-1 driver replays from a frozen ground truth. The pruner-placeholder seed in particular MUST survive this gate on its own measured finalScore — its `unverified-until-round-0-ablation` tag is a launch-blocker, not a soft warning.

If the pruner-placeholder fails the gate, do NOT start round 1 with it on the front. Either (a) run a single live OP-5 invocation against the joint-best prompt (one screen pass, ~$3, ~10 min), re-add the OP-5 output as a fresh seed, and re-run the ablation; or (b) drop the slot and start gen-1b with three seeds instead of four. The driver MUST refuse to launch evolutionary rounds without all admitted seeds carrying a measured finalScore.

#### §4.6.2 Stale per-event trajectory scores after surgical reruns

The 2026-05-27 round-7 surgical rerun and the 2026-05-28 joint-best per-probe persistence repair both updated aggregates in `pareto-current.json` but **left the original confirm events in `gepa-trajectory.jsonl` with their pre-correction `final_score` values intact**. Corrected confirm events were appended with a `_repair_rerun` field and (from 2026-05-28 onward) an explicit `corrected: true` flag plus a `supersedes` natural-key block — they do not destructively rewrite the originals.

**Authoritative sources for front-member scores:**

- `pareto-current.json` is the single source of truth for any member's `finalScore`, `score_sonnet`, `score_gpt5_5`, `sharpnessScore`, and per-probe `scores` / `detail`.
- `gepa-trajectory.jsonl` is the source of truth for the *event stream* (mutations, screens, confirms, TARE, pareto-update, mutation-rejection). For confirm events specifically: when both an original and a `corrected: true` (or `_repair_rerun`-tagged) confirm exist for the same `(round, mutation_hash, probe_id, target)` tuple, the corrected event supersedes the original. Any analysis tool that reads trajectory MUST deduplicate by that natural key, preferring corrected events.
- `gepa-restart-scaffold.mjs` reads `pareto-current.json` only — it never derives front scores from trajectory. This is enforced by a comment in `loadParetoForRestart()`.

Existing on-disk events from before 2026-05-28 carry only the `_repair_rerun` marker (no explicit `corrected: true`). Treat both markers as equivalent for dedup.

---

## §5 Probe set authoring

> **Status (updated 2026-05-24)**: the probe SET DESIGN (§5.0–§5.8) is fully pre-registered. Probe RECORDS authored so far: `p7-dev-probes.json`, `frozen/p7-heldout-probes.json`, `frozen/p7-vault-probes.json`, `frozen/p7-langtransfer-probes.json` (40 OOD, §5.6/§3.5.1 — authored 2026-05-24, gate wired), and `frozen/p7-adversarial-counter-probes.json` (10, §5.7 — authored 2026-05-24, gate wired). **STILL UNAUTHORED**: `p7-rotation-pool.json` (§5.3 — only consumed from round 11 onward, so NOT a launch blocker). Moving the `prereg/p7-v1-pre-probe` tag forward to `prereg/p7-v1` is gated on the rotation pool (the last remaining record) + decision-log init. The pre-probe tag (committed at the end of the 2026-05-14 housekeeping session) freezes the documented design, per-tool variant artifacts, baseline metrics snapshot, and overfit framework — everything except the probe records. Authoring methodology + sources are spec'd in §5.0/§5.4; budget is in §8.2.

### §5.0 Repo & language coverage (stratified by language, seed 42)

Probe sets are **stratified by language** per the CLAUDE.md benchmark methodology (stratified random split, fixed seed=42). Two pools:

**In-distribution pool — 10 languages** (dev + held-out + vault + rotation are a stratified split across these):

| Language | Repo | Source | On disk |
|---|---|---|---|
| JavaScript | fastify | P6 anchor | `eval/repos/fastify` |
| TypeScript | vercel/ai-chatbot | P6 anchor | `eval/repos/ai-chatbot` |
| Go | gin | P6 anchor | `eval/repos/gin` |
| Python | flask | P6 anchor | `eval/repos/flask` |
| Rust | ripgrep | P6 anchor | `eval/repos/ripgrep` |
| Java | google/gson | ast-tester (SHA-locked) | `eval/ast-tester-probes/_repos/java` |
| C++ | google/highway | ast-tester (SHA-locked) | `eval/ast-tester-probes/_repos/cpp` |
| C# | microsoft/garnet | ast-tester (SHA-locked) | `eval/ast-tester-probes/_repos/csharp` |
| Ruby | sinatra/sinatra | ast-tester (SHA-locked) | `eval/ast-tester-probes/_repos/ruby` |
| Kotlin | kotlinx.coroutines | ast-tester (SHA-locked) | `eval/ast-tester-probes/_repos/kotlin` |

The 5 P6 anchors preserve the T1–T15 P6 winRate grounding (§4.1/§4.2) and the §5.4 P6-gold reuse; the 5 added languages bring structurally-distinct AST shapes (Java wildcard generics + getter/setter, C++ header/impl split + templates, C# partial classes, Ruby mixins + `class << self`, Kotlin suspend/structured-concurrency).

**Out-of-distribution (OOD) pool — 8 languages** (§3.5.1 winner-only transfer gate; never in the optimization loop): C (hiredis), Dart (dart-lang/http), Elixir (jason), Lua (Penlight), PHP (Slim), Scala (requests-scala), Swift (Alamofire), Zig (http.zig) — all SHA-locked in `eval/ast-tester-probes/repos.json`.

**Split mechanics**: per in-distribution language, author probes then stratify-split by seed=42 into dev (4/language), held-out (3/language), vault (2–3/language), with the secondary stratum/difficulty marginals (§5.1) maintained globally. Held-out and vault therefore measure *same-distribution* generalization; the OOD pool measures *cross-language* generalization — the two axes are kept distinct.

**Reproducibility action (pre-reg)**: BOTH repo pools are already SHA-pinned. The 13 ast-tester repos (10 in-distribution + the OOD set) are SHA-locked in `eval/ast-tester-probes/repos.json`. The **5 P6 anchor repos ARE also SHA-pinned**, in `eval/read-workflows/repo-manifest.json` (the `manifest.json`-declared source of truth, matching `eval/scripts/fetch-benchmark-repos.js`):

| P6 anchor (language) | Repo | Pinned SHA |
|---|---|---|
| fastify (JS) | `fastify/fastify` | `39f0f24233cf6da2fef48551f51be2f589f7d5d0` |
| vercel/ai-chatbot (TS) | `vercel/ai-chatbot` | `107a43a8039bb4f19d0ced4ff3445e2523d14305` |
| gin (Go) | `gin-gonic/gin` | `d3ffc9985281dcf4d3bef604cce4e662b1a327a6` |
| flask (Python) | `pallets/flask` | `7ef2946fb5151b745df30201b8c27790cac53875` |
| ripgrep (Rust) | `BurntSushi/ripgrep` | `4519153e5e461527f4bca45b042fff45c4ec6fb9` |

(The TS anchor's SHA is identical to the ast-tester `typescript` entry in `repos.json` — same `vercel/ai-chatbot` commit — so there is no cross-manifest drift. `repo-manifest.json` also pins an extra `express` JS repo that is *not* a P7 anchor; ignore it for P7.) **Pre-reg requirement**: these five SHAs must be carried verbatim into the `prereg/p7-v1` probe-repos manifest so the P6 set matches the ast-tester set for reproducibility — copy them from `repo-manifest.json`, do not re-resolve `eval/repos/` working trees.

### §5.1 Dev probes (n=40)

Stratified — **primary by language** (§5.0), **secondary by stratum/difficulty** (global marginals):

- **Language**: 4 probes from each of the 10 in-distribution languages (§5.0) = 40.
- **Difficulty** (global): 12 easy, 20 medium, 8 hard (matches a real-user query distribution).
- **Stratum** (global): 13 literal-lookup, 13 multi-file-flow, 8 behavioral, 6 no-match (negative cases).
- **Trick-probe ratio**: 7 out of 40 = 18% (well under the 30% Gemini-3rd-pass §C2 cap to keep the dev set representative of production traffic, not an adversarial gauntlet). Composition: 4 pathology probes from §5.5 (1 wrong-extension + 1 flooding + 2 rabbit-hole) + 3 distractor probes from §5.6. The remaining 3 pathology probes (2 wrong-extension + 1 flooding + 0 rabbit-hole) are deferred to the rotation pool — see §5.3.

Each probe is a JSON record:
```json
{
  "id": "p7-dev-001",
  "repo": "fastify",
  "language": "javascript",
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

### §5.2 Held-out probes (n=30)

Same structure, frozen, **stratified by language (§5.0): 3 per in-distribution language**. **Authored at the same time as dev to prevent post-hoc bias** but not inspected until winner selection. File: `core/prompt-optimization/data/frozen/p7-heldout-probes.json` — committed under a `frozen/` directory at pre-registration time.

### §5.3 Probe-rotation pool (n=13, post-Gemini-review + 3rd-pass dilution)

To support the mid-run probe rotation at round 11 (§3.1), **13 probes** are authored at the same time as the dev set and committed under `core/prompt-optimization/data/p7-rotation-pool.json`:

- **10 standard rotation probes** (original Gemini 1st-pass design) — held aside to guard against dev-set overfitting after 60+ candidate evaluations.
- **3 deferred trick probes** — 2 wrong-extension + 1 flooding pathology probes moved out of the dev set per Gemini 3rd-pass §C2, so the agent masters the basics first before facing them. These 3 are tagged `tier: deferred-pathology` in the JSON record.

These probes are NOT used during rounds 1–10. At the start of round 11, the 5 lowest-variance dev probes (those everyone has mastered — i.e. `score_variance_across_pareto < 0.1`) are retired and replaced as follows: 2 of the 3 deferred-pathology probes guaranteed-promoted in (the agent must demonstrate it has learned the basics by round 11; this is the test), then 3 highest-difficulty standard rotation probes drawn deterministically by author-assigned difficulty rating.

Rationale: prevents over-fitting to the original 40 dev probes when the GEPA loop has evaluated 60+ candidates against them, and concentrates the trick-probe evaluation in the second half of the run when the agent has mastered the literal-lookup baseline. The rotation membership is pre-registered (committed under `prereg/p7-v1`), so the swap is deterministic and not post-hoc.

### §5.4 Sources for probe content

- **8 probes** drawn from P6 golds NOT in P6's 25-gold subsample (avoids leakage; uses the remaining 65 golds from the 90-gold P6 pool) — these land in the 5 P6-anchor languages.
- **~100 hand-authored fresh probes** across the 10 in-distribution languages (§5.0), covering scenarios P6 missed (FreshStack-style post-cutoff repos, error-recovery scenarios, multi-callback behavioural queries that P6's `ripgrep:sink-trait` revealed as hard) plus the 5 added-language AST shapes.
- **All 108 core probes** (40 dev + 30 held-out + 13 rotation + 25 vault) labeled by author + date + language + difficulty + stratum in YAML front-matter. (OOD language-transfer probes, §3.5.1, are authored separately: 40 across 8 languages.)

### §5.5 Pathology probes — code-search domain failure modes (per Gemini 2nd-pass §C, 3rd-pass §C2 dilution)

Seven probes encoding three specific code-search failure modes. Per Gemini 3rd-pass §C2 (avoid >30% adversarial-trick density in dev set), they are split across dev and rotation pool:

| Pathology probe | What it tests | Encoding |
|---|---|---|
| **Wrong-extension death loop** | Query implies `.js`, answer is in `.tsx`. Tests whether prompt instructs agent to *relax file filter before relaxing search term*. | **3 probes total**: 1 in dev set, 2 deferred to rotation pool (§5.3). |
| **Context-window flooding (minified trap)** | Repository contains `dist/bundle.min.js` or `package-lock.json` near the answer. Tests whether prompt instructs agent to *negative-space-route* (skip `dist/`, `build/`, `node_modules/`, large minified files). | **2 probes total**: 1 in dev set, 1 deferred to rotation pool. |
| **Transitive rabbit hole** | Answer is 1-2 hops from the entry point but agent can be tempted into 5+ hops. Tests whether prompt encodes a *depth-limit heuristic*. | **2 probes total**: both in dev set (these are the most-representative-of-production failure mode and warrant continuous evaluation). |

Result: **4 pathology probes in dev** (within the 28% trick-probe budget when combined with the 3 distractor probes in §5.6) + **3 deferred** in rotation pool (faced from round 11 onward). If GEPA's winner doesn't handle them, the prompt is overfit to non-pathological queries.

### §5.6 Poisoned/distractor probes (per Gemini 2nd-pass §D3)

3 of the 40 dev probes contain **adversarial distractor files** in the target repository:

- A file named *exactly what the user is searching for* (e.g., `auth_v2_new.ts`) but containing **deprecated or wrong code with a "moved to X" comment**. The correct answer is the file the comment points to.

This tests **verification, not just retrieval**. A prompt that blindly trusts filenames will fail. A prompt that instructs the agent to *read the file content* before reporting will pass. Implementation: distractor files are added to local fork copies of the dev repos under `eval/repos/<repo>-with-distractors/`, with the addition pre-registered.

### §5.7 Adversarial counter-probes (per Gemini 2nd-pass §B4 — anti-self-fulfilling-prophecy)

Risk: the probe author (human) subconsciously aligns dev probes with the P6 win-rate signal (e.g., authoring ss-trace probes in interrogative form because qshape-v1 said `structural` liked interrogative — a now-retracted signal since it targeted the wrong code path). The GEPA loop would then trivially "validate" P6's signal — but only because the test was rigged.

**Mitigation — adversarial counter-probes**: pass 10 of the original 40 dev probes through Sonnet 4.6 with the system prompt:

> *"Rewrite this code-search query so its surface form is HOSTILE to the following heuristic [insert P6 winRate guidance here, e.g., 'ss-find narrow-regex + interrogative wins for JS-mobile']. Preserve the underlying user intent and gold answer exactly. Make the rewritten query violate the heuristic — terse imperative without symbol, or broad NL without anchor, etc."*

These 10 adversarial counter-probes are added to the held-out set (NOT the dev set — they're a generalization gate, not a training signal). At the end of the run, the winning prompt is evaluated on them. If it scores within 15% of its dev-set score, the P6 signal generalised. If it crashes (>25% drop), the prompt was overfit to query-shape alignment.

File: `core/prompt-optimization/data/frozen/p7-adversarial-counter-probes.json`. Cost: 10 probes × 2 targets at the end of the run = 20 agent runs ≈ $1.

**Status: IMPLEMENTED (2026-05-24).** The 10 records are hostile-surface rewrites of one dev probe per in-distribution language (cpp/csharp/go/java/js/kotlin/python/ruby/rust/ts), each carrying the source probe's gold **byte-for-byte** with the target symbol stripped from the query surface (provenance recorded per-record as `source_probe_id` / `violated_heuristic`). Authored by 2 Opus subagents; reviewed by 2 independent Opus reviewers against the pinned repos for answerability, hostility, and gold integrity (one reviewer FLAG on `java-002-cp` was a reviewer-side cwd false-positive — the `gson/` path prefix is correct relative to the indexed monorepo root `_repos/java`, verified via `resolveRepoCwd`). The gate is `core/prompt-optimization/sweep/p7-counter-probe-gate.mjs` (`runCounterProbeGate`): at run end the winner is replayed on the 10 via the same `makeOodReplayRunner` machinery used by the OOD gate, per production target; `drop = (devTaskScore − counterMaximin) / devTaskScore` where `counterMaximin = min(meanSonnet, meanGpt5_5)`. **≤0.15 generalised; >0.25 FAILS the gate** (block 3b in `finalizeRun`, immediately after OOD); in-between is borderline (reported, non-failing). Thresholds live in `DEFAULTS.counterProbeGeneralizeDrop` / `counterProbeOverfitDrop`; loaded + wired in `gepa-cli.runFinalizeStage`. Tests: `tests/unit/prompt-optimization/p7-counter-probe-gate.test.js` (18 — scoring/thresholds incl. binary-exact boundary, input/runner validation, frozen-set integrity + e2e wiring).

### §5.8 Vault probes (n=25) — final untouched confirmation

25 probes authored at the same time as dev/held-out, **stratified by language (§5.0): 2–3 per in-distribution language**, and committed frozen under `core/prompt-optimization/data/frozen/p7-vault-probes.json` at the `prereg/p7-v1` tag.

- Drawn from sources **disjoint from dev, held-out, and rotation** (remaining P6 golds + fresh post-cutoff authoring) to avoid leakage; cross-checked at pre-reg time.
- **NEVER inspected** — not during evolution, not at convergence, not during HOMP/SCS. Opened EXACTLY ONCE on the shipped winner at the very end of the run (§4 step 12).
- **Reported, not optimized against.** The Vault never feeds selection, gates, or hand-edits. Its only job is to produce one credible, single-touch generalization number. Vault within ~15% of held-out → result generalizes, Vault becomes the headline. >25% drop → documented overfit finding, headline caveated; the winner is NOT reselected.
- Cost: 25 probes × 2 targets = 50 agent runs ≈ $4.25.

File: `core/prompt-optimization/data/frozen/p7-vault-probes.json`.

---

## §6 Pre-registration discipline

### §6.1 Tag conventions

| Tag | When | What it freezes |
|---|---|---|
| `prereg/p7-v1-pre-probe` | After pre-PHASE7 housekeeping, BEFORE probe authoring | Per-tool `recommendations-v2-*.json` artifacts, this `PHASE7.md` doc, the baseline-metrics snapshot under `eval/baselines/pre-phase7-snapshot.md`, mutation pool spec, judge panel, TARE config, GEPA config, overfit framework. Does NOT include probe records — those don't exist yet (see §5 status). |
| `prereg/p7-v1` | After probe authoring, before any GEPA run | Everything in `prereg/p7-v1-pre-probe` + the probe records (`p7-dev-probes.json`, `frozen/p7-heldout-probes.json`, `p7-rotation-pool.json`, `frozen/p7-adversarial-counter-probes.json`, `frozen/p7-vault-probes.json`, `frozen/p7-langtransfer-probes.json`) + decision log file initialized |
| `release/p7-v1` | Before final headline-number release / Vault opening | The shipped winning prompt |

Both `prereg/*` tagged commits MUST include this `PHASE7.md` doc and the variant artifacts at the exact state used for the run. The `prereg/p7-v1` tag additionally includes the probe records.

### §6.2 The decision log

`core/prompt-optimization/data/p7-decisions.md` is the **load-bearing artifact** for human-in-the-loop GEPA defensibility. It's append-only during the run and committed at `release/p7-v1`.

Format per round entry: see §3.4.

### §6.2.1 Baseline metrics — the "before" reference

The pre-PHASE7 baseline-metrics snapshot is committed at `eval/baselines/pre-phase7-snapshot.md` (locked under `prereg/p7-v1-pre-probe`). It captures the exact `recommendations-v2-*.json` SHAs, the locked GCSN MRR@10 = 86.93%, the locked retrieval-probes count from `eval/retrieval-probes/post-perf-60.json`, per-tool dev + heldout aggregates from the most recent failure-analysis sessions (ss-search dev 55/18/17 + heldout 28/18/8; ss-find / ss-semantic latest commits; ss-trace callers 0.81 heldout / callees 0.94 / impact 0.75 from `d70259b`), and unit test counts (347 ranking + 823 search + 292 prompt-opt). This is the "before" picture every PHASE7 milestone compares against. Do NOT regenerate this artifact during the GEPA run — it's frozen at tag time.

### §6.2.2 Native rg+Read baseline — the optimizer reference

Before any paid GEPA run that claims speed or token savings, generate and freeze a native rg+Read baseline over every probe the loop can score (the exact dev probe set, plus the rotation pool if rotation is enabled) and both production targets. This baseline is the denominator for the §3.7.1 native-relative objective; without it, the optimizer only has the legacy accuracy/EAS fallback and the 0.935-style raw-accuracy ceiling leaves too little useful selection pressure.

Required metrics per `(target, probe)`:

- `score` / `accuracy`: judged correctness in [0, 1].
- `calls` / `tool_calls`: native rg+Read tool-call count for the successful answer trajectory.
- `tokens` / `agent_tokens`: agent input + output tokens for that trajectory. Cached-read tokens may be logged separately but are not added again when the provider already includes them in input accounting.
- API-backed agent loops are stateless HTTP conversations. Their raw provider usage logs total input across turns, but scoring treats repeated replayed chat history as `cached_input_tokens` / `cache_read_input_tokens` and scores effective tokens as `input_tokens - cached + output_tokens`, matching the Codex cached-input convention.
- `overhead_tokens` (optional but recommended for CLI targets): measured no-tool fixed harness overhead for the same target/workspace. When present, token desirability is scored on `max(1, tokens - overhead_tokens)` for both native and candidate rows, while raw total tokens remain logged for cost reporting.

The GEPA CLI consumes the frozen file with:

```bash
node core/prompt-optimization/sweep/gepa-cli.mjs \
  --probes core/prompt-optimization/data/p7-dev-probes.json \
  --agent-provider api \
  --native-baseline core/prompt-optimization/data/frozen/p7-native-rg-read-baseline.json
```

Generate the frozen native baseline with the same paid-run target path:

```bash
node core/prompt-optimization/sweep/p7-native-rg-read-baseline.mjs \
  --tier dev \
  --targets sonnet,gpt5_5 \
  --repeats 3 \
  --judge-panel deepseek \
  --policy default-native \
  --agent-provider api
```

If budget permits, run 2-3 native rg+Read repeats per target/probe and store the aggregate used for scoring (`mean` or `median`, recorded in the file). CLI-only development baselines may still use `--agent-provider cli`; for those, also run a cheap no-tool overhead calibration per `(target, repo)` and attach it to each row as `overhead_tokens`; this prevents the optimizer from under-rewarding narrower retrieval output. Missing target/probe rows, non-finite scores, non-positive call counts, or non-positive token counts are fatal; the run should stop before spending GEPA money. Held-out and Vault baselines may be generated for reporting, but per-query held-out/Vault details remain sealed according to §2.4.

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
| **OP-3 compact router-table** sub-mode of Persona Pivot | inline in op-persona-pivot.mjs | 0.25 day |
| **OP-4 domain-stripping** for Tool-Signature Masking | inline in op-tool-mask.mjs | 0.25 day |
| **OP-2 reflection-hint-as-constraint** (anti-schizophrenia) | inline in op-trajectory-crossover.mjs | 0.25 day |
| **Stateful summarization rule** baked into T2/T8/T13/T14/T15 seed variants | content of variant files | included in authoring |
| **Pathology probes** + **poisoned/distractor probes** + **adversarial counter-probes** authoring | distinct sub-tools in `author-probes.mjs` | 0.5 day |
| **OOD language-transfer probe authoring** (40 probes across 8 SHA-locked languages, §3.5.1) | one-time human authoring | 1.5 day |
| **Agent-query degrader — deterministic templates** (CLI-style, for §3.6.1) | inline in `agent-query-degrader.mjs` | 0.25 day |
| Unit tests for new code (incl. token-validator whitespace, Maximin + 0.15 admission, EAS, Pareto-rebaseline at round 11) | `tests/unit/prompt-optimization/p7-*.test.js` | 1.5 day |
| **TPM-aware token-bucket scheduler** + tests for TPM enforcement (per GPT-5.5 review §D1) | `core/prompt-optimization/sweep/p7-token-bucket.mjs` (new) | 0.5 day |
| **Real-fsync persistence wrapper** + kill-9 recovery test (per GPT-5.5 review §D2) | extend `p7-persist.mjs` | 0.25 day |
| **Token-validator multiplicity + unmapped-alias + surplus-token rejection** + tests (per GPT-5.5 review §B5) | extend `token-validator.mjs` | 0.25 day |
| **Per-target per-stratum EAS + evidence-adequacy penalty** (per GPT-5.5 review §B1) | inline in `eas.mjs` | 0.5 day |
| **Native rg+Read baseline loader + native-relative desirability objective** (accuracy / calls / tokens; §3.7.1 and §6.2.2) | `eas.mjs`, `gepa-scoring.mjs`, `gepa-cli.mjs`, `gepa-finalize.mjs` | 0.5 day |
| **OP-1 inefficiency trace extractor** (native-relative calls/tokens before accuracy failures) | `gepa-scoring.mjs`, `gepa-mutate.mjs`, `gepa.mjs` | 0.25 day |
| **Representative mixed screen selector** (language/stratum mix + optional diagnostic `--screen-probe-ids`) | `gepa-screening.mjs`, `gepa.mjs`, `gepa-cli.mjs` | 0.25 day |
| **Normalized restart seed scaffold** (strip outer fences, append three efficiency seeds, load via `--variants-dir`) | `gepa-restart-scaffold.mjs`, `variant-loader.mjs`, `gepa-cli.mjs` | 0.25 day |
| **Pareto admission cap relative to displaced incumbent** (per GPT-5.5 review §C1) | inline in `gepa.mjs` | 0.25 day |
| **OP-2 target-tagged trajectory ingestion + balanced-pair logic** (per GPT-5.5 review §B3) | inline in `op-trajectory-crossover.mjs` | 0.25 day |
| **OP-3 generator rotation (Sonnet/Kimi/GPT-5.5) + compact router-table consolidation** (per GPT-5.5 review §C2/§B4, revised after gen-1) | inline in `op-persona-pivot.mjs` | 0.25 day |
| **Correctness-weighted SCS** + minimum-paraphrase-accuracy gate (per GPT-5.5 review §C3) | inline in `scs.mjs` | 0.25 day |
| **Hard-negative weighting noise floor + 2-round stability gate** (per GPT-5.5 review §C5) | inline in `gepa.mjs` | 0.25 day |
| **Forensic-metadata JSONL extension** (per GPT-5.5 review §D4) | inline in `gepa.mjs` + `judge-runner.js` | 0.5 day |
| **Multi-family agent-query degrader + cross-model emitter** (Sonnet/Opus/GPT-5.5/MiMo/Qwen; per GPT-5.5 review §C4, re-scoped §3.6.1) | `agent-query-degrader.mjs` | 0.5 day |
| **OpenAI tier ≥ 2 pre-flight check** (per GPT-5.5 review §D1) | inline in `p7-preflight.mjs` | 0.25 day |
| **Reasoning-mode operational HOMP runner** (Sonnet thinking-ON + GPT-5.5 reasoning over held-out probes; §3.5.2 — user catch) | `core/prompt-optimization/sweep/p7-reasoning-homp.mjs` (new) | 0.5 day |
| **Total** | | **~15.5 days** |

### §7.4 Persistence + resume — MANDATORY

P6 burned hours when a run died at hour 3 with no resume path. P7 must NOT repeat that. The contract:

1. **Append-only JSONL** — `core/prompt-optimization/data/results/p7-v1/gepa-trajectory.jsonl` is written to after EVERY:
   - Mutation generation (one row per mutation: `_kind: 'mutation', round: N, source_op: 'reflective|trajectory-crossover|persona-pivot|tool-mask|pruner', new_prompt_hash: ..., parent_hash: ...`)
   - Screen result (one row per (mutation × probe × target): `_kind: 'screen', mutation_hash: ..., probe_id: ..., target: 'sonnet|gpt-5.5', score: ..., wall_ms: ..., tool_calls: ..., input_tokens: ..., output_tokens: ...`). Screen token fields are required for native-relative resume replay; a resumed run must not re-spend already-paid screen calls merely to recover token usage.
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
       "native_relative_factor": 0.84,
       "native_relative_target_factors": {"sonnet": 0.86, "gpt5_5": 0.84},
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
       "reason": "0.15-cap-violation" | "dominated" | "language-transfer-gate" | "scs-gate" | "agent-query-gate",
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
| API keys present | `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`; direct OpenAI-compatible provider keys only if OpenRouter is not used | All required paid-run keys defined and ≥10 chars |
| Smoke each lineage | One short call to each direct API (system="say hi", user="ok") | All return non-empty text within 30s |
| OpenAI tier ≥ 2 | Only when using direct `OPENAI_API_KEY`; skipped in OpenRouter mode | Tier ≥ 2 for direct OpenAI, or "N/A: GPT-5.5 routed via OpenRouter" |
| Anthropic tier ≥ 2 | check via headers from a smoke call | Tier ≥ 2 — Tier 1 throughput is too constrained for a 20-round run |
| Token-bucket scheduler self-test | feed scheduler 100 fake calls; verify it blocks at TPM ceiling | scheduler enforces TPM, not just RPM |
| Embedding API smoke | Call Gemini Embedding 2 with "test" → expect 768-dim vector | Vector returned, correct dim |
| `~/.gemini/settings.json` auth | Confirm `selectedType: "gemini-api-key"` (not `oauth-personal`) | Match — else AUTO-FIX (with backup) |
| Orphan process check | `pgrep -f "track-b\|gepa\|aqe-mcp\|_ss-helpers"` | Count ≤ 5 (user's interactive sessions); else surface and ask user to clean |
| Disk space | ≥ 5GB free under `core/prompt-optimization/data/results/` | yes |
| Git tree clean (or near-clean) | `git status --short` shows ≤ 2 modified files (the run produces uncommitted artifacts) | warn if dirty |
| Pre-registration tag | `prereg/p7-v1` exists and points to current HEAD | yes — else require `--allow-no-prereg` flag |
| Probe sets exist + frozen | `p7-dev-probes.json`, `frozen/p7-heldout-probes.json`, and `frozen/p7-vault-probes.json` all exist; held-out + vault files git-tracked at the prereg tag | yes |
| Variant slate complete | T1.md … T15.md all exist with valid YAML front-matter + consumer-clean contract (§4.5) | 15 files, all valid |
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

**Operational implication**: at OpenAI Tier 1 + Anthropic Tier 2, total agent throughput is ~6–8 calls/min on Sonnet and ~2–3 on GPT-5.5. A 20-round run with ~5,296 joint runs would take ~17 days wall-clock if Tier 1 GPT-5.5. **Bumping OpenAI to Tier 2 ($50 paid + 7d) is operationally mandatory** — a one-time $50 cost cuts wall-time from ~17 days to ~3 days. Verify the user's tier in the §7.5 pre-flight check.

Rule: **NO CLI harness for any stateless call** — judges, reflector, synthesizer, paraphraser ALL use direct API. Only AGENTS can use a CLI harness, and only the Qwen target (HOMP class B) does.

### §7.2 Authoring (human work)

| Task | Estimated effort |
|---|---|
| T1–T15 variant authoring (seeded from P6 winRate data) | 0.5 day |
| 40 dev probes (10 languages) | 1.5 day |
| 30 held-out probes (10 languages, frozen) | 1.0 day |
| 25 vault probes (10 languages, frozen, opened once at end) | 1.0 day |
| 40 OOD language-transfer probes (8 languages, §3.5.1) | 1.5 day |
| Pre-reg doc finalization + P6-repo SHA manifest + tag | 0.5 day |
| **Total** | **~6 days** |

### §7.3 Run execution

| Phase | Wall time |
|---|---|
| Authoring + tagging | ~6 days human time (per §7.2) |
| Code (above) | see §7.x code-task table (~14.5 days of dev tasks) |
| GEPA execution per target (20 rounds, ~1.3 hr each at 40-probe rounds) | ~26 hrs/target × **2 targets** = ~52 hrs (parallelizable across targets) |
| HOMP replay + SCS computation | ~3 hrs |
| Manual reflection between rounds | 5–10 min/round × 20 rounds = ~3 hrs human time (per-round; both targets reviewed together) |
| **Total wall time** | **~6 days authoring + code-task time (§7.x), ~3 days API time (overlappable)** |

---

## §8 Cost envelope (post-Gemini-review revisions)

**Key cost-relevant changes from the original draft**:

- **Codex target stays GPT-5.5-instant** (cost $5/$30 per 1M, ~$0.11/run). Gemini's critique recommended GPT-5.4 to save ~$100 based on a transfer-asymmetry claim that we couldn't verify. The user's counter-argument — that GPT-5.5 is a new pretrain family (corroborated by the 2× pricing jump from 5.4 and the discrete launch event on April 23, 2026), and future GPT-5.6+ will be 5.5-derived — wins on shelf-life grounds. **Optimising for 5.5 buys longer artifact relevance**; the +$112 cost is the price of future-proofing. Post-hoc backwards-compat replay on GPT-5.4 (~$5) covers users still on the previous tier. See §11.2 for full rationale.
- **TARE adversarial probes are Pareto-gated** (only run on candidates that would enter the front by task score) — saves ~70% of TARE budget per §3.3.
- **Latent-interp removed** (was scientifically invalid). Replaced by OP-2 Contrastive Trajectory Crossover, which uses Kimi K2.6 reasoning calls and reuses already-collected agent trajectories — net cheaper.
- **ja-pivot in the loop removed** (translation-invariance concern). Replaced by OP-3 Persona Pivot — same cost (Sonnet calls), better diversity.
- **Two new operators added**: OP-4 Tool-Signature Masking (Kimi calls), OP-5 Pruner (Kimi calls). Both cheap.
- **Maximin objective**: identical compute cost to mean — same per-probe agent runs, just different aggregation.
- **Mid-run probe rotation**: 5 new probes drawn from the 13-probe held-aside pool at round 11. No marginal cost in run-time (same 40 probes per round, just different membership).
- **Dynamic hard-negative probe weighting**: zero marginal cost, just changes the score formula.

**Joint per-target workload** (Sonnet 4.6 + GPT-5.5-instant):

| Bucket | Per joint round | × rounds | Joint runs |
|---|---|---|---|
| Variant ablation (T1–T15 × 40 probes × 2 targets) | 600 × 2 = 1200 | 1 | **1200** |
| GEPA evolution (3 mutations × 8 screen × 2 + 1 survivor × 40 confirm × 2 = 128) | 128 | 20 | **2560** |
| TARE adversarial (Pareto-gated; ~30% of survivors qualify; 3 paraphrases × 8 screen × 2 targets × ~6 qualifying candidates) | — | — | **~150** |
| Super-variants ablation (5 super × 40 × 2) | — | — | **400** |
| Held-out validation (1 winner × 30 × 2) | — | — | **60** |
| Robustness pivots (6 paraphrases × 45 probes [15 dev + 30 full held-out] × 2) | — | — | **540** |
| Round-11 Pareto-front re-baseline (6 incumbents × 5 new probes × 2 targets) — Gemini 2nd-pass §B1 | — | — | **60** |
| Language-transfer OOD HOMP (GPT-5.5, 40 probes × 8 OOD langs) — §3.5.1 | — | — | **40** |
| Reasoning-mode operational HOMP (Sonnet thinking-ON + GPT-5.5 reasoning × 30 held-out probes) — §3.5.2 user catch | — | — | **60** |
| Agent-mediated query robustness (58 variants × 2 targets) — Gemini 2nd-pass §D5, re-scoped §3.6.1 | — | — | **116** |
| Adversarial counter-probes on winner (10 × 2) — Gemini 2nd-pass §B4 | — | — | **20** |
| Language-transfer OOD HOMP (Sonnet, 40 probes × 8 OOD langs) — §3.5.1 | — | — | **40** |
| Vault confirmation (1 winner × 25 × 2, opened once) — §5.8 | — | — | **50** |
| **Total joint runs** | | | **~5296** |

Cost split:

| Target | Runs | Per-run | Cost |
|---|---|---|---|
| Sonnet 4.6 (Anthropic direct API, $3/$15 per 1M, ~10K in + 2K out) | ~2620 | $0.06 | **$157** |
| GPT-5.5-instant (OpenAI direct API, $5/$30 per 1M, ~10K in + 2K out) | ~2620 | $0.11 | **$288** |
| Reasoning-mode operational HOMP premium (60 runs × ~$0.20) — §3.5.2 | 60 | ~$0.20 | **$12** |
| (optional) GPT-5.4 backwards-compat replay of winner (~30 probes × $0.055) | 30 | $0.055 | **$1.65** |

**Targets total: ~$457 + $2 backwards-compat replay** (base split excludes the 60 reasoning-HOMP runs, which carry the premium row above).

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
| Judges (3-panel × 2 swaps × ~15 candidates × 40 probes × 2 targets) | ~7200 calls × $0.0007 avg | $5.04 |
| HOMP class A — MiMo (30 model-transfer subset + 40 OOD language-transfer) | 70 runs × $0.011 | $0.77 |
| HOMP class B — Qwen 3.6 Plus × 30 probes | 30 runs × $0.022 | $0.66 |
| SCS robustness embeddings (Gemini Embedding 2 for SS metric only — NOT for any mutation operator anymore) | ~350 calls × ~1K tokens × $0.20/1M | $0.07 |
| IAA (judge-only cost; human time NOT included) | ~180 calls × $0.0007 | $0.13 |

**Other roles total: ~$11** (incl. $1.40 AI-assisted reflection + multi-family agent-query degrader/emitter at ~$0.70 + adversarial counter-probe authoring via Sonnet at ~$0.25).

**Headline total: ~$470** (40 dev / 30 held-out / 25 vault across **10 in-distribution languages** + an **8-language OOD transfer gate** — ~$84 over the prior 30/25/20 single-anchor ~$386, almost all from the larger per-round GEPA confirmation + variant ablation. Note: spreading a *fixed* probe count across more languages is itself cost-neutral; the marginal $ comes from the bigger tiers + the §3.5.1 OOD expansion (~$6). Incl. $2 backwards-compat replay + $1.40 Gemini Deep Think reviews + **$12 reasoning-mode operational HOMP** (§3.5.2, 30 held-out probes) + **~$4.25 once-opened Vault** (§5.8) + full-30-held-out SCS (§3.6) + agent-mediated query robustness (§3.6.1) + 8-language OOD transfer (§3.5.1)), with safety buffer (~$80) = **$550 hard cap** (raised from $420 for the heavier-depth language diversification). **One-time $50 OpenAI Tier-2 upgrade is operationally mandatory** (per GPT-5.5 review §D1) but not part of the run cost — it's a prerequisite for reasonable wall-time.

This is **~$115 more than a GPT-5.4 run would cost** (the gap grows with the larger probe tiers since GPT-5.5 runs are 2× the price). The user accepted this premium for pretrain future-proofing; rationale documented in §11.2.

**Mid-run early-stop**: actual cost may be substantially lower if the patience rule fires before round 20. A run that converges at round 12 saves ~$80 (8 rounds × ~$10/round). User reviews convergence between rounds and can call early stop at any point — see §3.1 patience + plateau-breakthrough rules.

### §8.1 Compression options (if budget tighter)

| Cut | Savings | Trade-off |
|---|---|---|
| Reduce GEPA rounds 20 → 15, patience 5 → 3 | -$45 → **~$162** | Risk: not at convergence on hard probes; plateau-breakthrough rule helps |
| Reduce dev probes 40 → 30 | -$70 → **~$400** | reverts the dev half of the heavier-depth bump; held-out (n=30) + 10-language coverage retained |
| Revert tiers to 30/25/20 (keep 10-lang spread) | -$84 → **~$386** | cost-neutral language diversification only; loses the deeper per-language signal |
| Drop OP-4 Tool-Signature Masking (revert slot 3 to OP-3/OP-5 cycle of 2) | negligible savings | Lose the cognitive-forcing operator — methodologically less creative |
| Disable mid-run probe rotation | $0 | Higher overfit risk on the original 30 |
| Reduce SCS post-convergence paraphrases 6 → 4 | -$3 | Marginal; not worth |
| **All cuts above** | → **~$130** | Methodologically thinner but still defensible |

### §8.2 Recommended bundle (~$470 with $550 cap)

Keep the full 20 rounds, full TARE Pareto-gating, full 6-paraphrase SCS over the full 30 held-out (45 probes), the 40-probe dev / 30-probe held-out / 25-probe once-opened Vault sizing across **10 in-distribution languages** + the **8-language OOD transfer gate**, mid-run probe rotation, and ALL five mutation operators. **The methodology is the value-add over P6 and over the original draft of this plan** — don't cut it.

The user explicitly chose to invest in scientific rigour while remaining budget-conscious. ~$470 — one run, well under the user's ~$1000 ceiling, sized for *supporting-contribution* publishability with broad language coverage (held-out at n=30, full-30-held-out SCS, an agent-mediated query-robustness gate, 8-language OOD transfer, + a once-opened Vault) rather than a second run — is the right answer for that intent. The biggest variance win is the language spread (10 in-distribution + 8 OOD = all 18 distinct languages in the SHA-locked set); the heavier-depth tier bump (30/25/20 → 40/30/25) tightens per-language signal and the dev→held-out generalization gap.

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
│   ├── p7-dev-probes.json                    (40 probes, 10 languages — see §5.0/§5.1)
│   ├── p7-rotation-pool.json                 (13 probes — held aside for mid-run rotation
│   │                                          at round 11; see §5.3)
│   ├── p7-pathology-probes.json              (7 probes — wrong-extension, flooding,
│   │                                          rabbit-hole; see §5.5; included in dev set)
│   ├── p7-distractor-probes.json             (5 probes — poisoned/distractor; see §5.6)
│   ├── p7-counter-probes.json                (10 adversarial counter-probes — Sonnet rewrites
│   │                                          of dev probes with anti-P6-shape phrasing;
│   │                                          §5.7; evaluated only at end of run)
│   ├── p7-agent-query-probes.json            (agent-mediated query variants of dev probes; §3.6.1)
│   ├── frozen/
│   │   ├── p7-heldout-probes.json            (30 probes, 10 languages — DO NOT INSPECT during
│   │   │                                      evolution; tracked under prereg/p7-v1 tag)
│   │   ├── p7-vault-probes.json              (25 probes, 10 languages — opened ONCE on the winner
│   │   │                                      at end of run; NEVER inspected; §5.8)
│   │   └── p7-langtransfer-probes.json       (40 OOD probes × 8 langs — C/Dart/Elixir/Lua/
│   │                                          PHP/Scala/Swift/Zig; winner-only; §3.5.1)
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
    ├── agent-query-degrader.mjs               (multi-family agent-query degrader + cross-model
    │                                          emitter: deterministic templates + Sonnet/Opus/
    │                                          GPT-5.5/MiMo/Qwen; §3.6.1 re-scoped)
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
├── p7-persona-pivot.test.js                  (OP-3 + compact router tables + token validator)
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
| **HOMP transfer evidence depth** | Two held-out classes used (MiMo-V2.5-Pro + Qwen 3.6 Plus); for publication path add a 3rd class for ~$1 extra | Acceptable; 2 classes already matches pub-tier minimum |
| **CLI harness still used for Qwen/opencode HOMP class** | Unavoidable IF DashScope direct API isn't available. NOT used for any judge or reflector. Pre-flight checks DashScope first. | Acceptable |
| **SCS metric uses Gemini Embedding 2** | Code-specialised, multimodal, well-established (March 2026 release). Document choice. | Acceptable |
| **Vault opened once on the winner (n=25)** | Authored + frozen at prereg; opened EXACTLY ONCE at end of run; reported not optimized against (§5.8) | Headline IS vault-validated at n=25 across 10 languages; small-n CI disclosed |
| **20 rounds may not converge for hard tasks** | Patience rule + plateau-breakthrough extension + manual reflection are the convergence proxies. Document max-rounds-hit as a finding if it happens. | Acceptable per GEPA literature (10-50 rounds is the published range) |
| **GPT-5.5-instant pricing changed mid-2026** ($2.50/$15 → $5/$30 in 7 weeks) | If pricing changes again before P7 runs, use GPT-5.4 (stable at $2.50/$15) to lock cost. Pre-flight script logs the resolved per-call price. | Cost variance bound by pre-flight |
| **Sonnet 4.6 Tier-2 vs Tier-3 RPM ceiling** (1000 vs 2000 RPM) | At Tier 2 with ~30 concurrent calls, we're 30 RPM observed — well within. Pre-flight checks current Anthropic tier and warns if Tier 1 (50 RPM cap). | Acceptable |
| **Rate-limit changes mid-run** (provider tier downgrades, quota changes) | Verbose logger detects spike in 429s; auto-throttle cuts the affected lineage's concurrency in half until the next round. Trajectory records all retries. | Acceptable |
| **`[[token]]` preservation can fail silently in paraphrase** | Post-translation validator REJECTS any mutation missing source `[[...]]` tokens. Logged as translation failure, no silent drop. | Mitigated |
| **Joint scoring variance asymmetry** (Gemini risk A2) | Mean would chase higher-variance target's deltas. **Mitigated by Maximin discipline** (§3.7): raw task score uses worst-target correctness, and native-relative scoring takes the minimum target mean. Pareto improvements must benefit BOTH targets, not just the noisier one. | Resolved |
| **"Compromise prompt" mode collapse** (Gemini risk D1) | Pareto front fills with mediocre-on-both prompts rather than great-on-both, if the targets have fundamentally different routing preferences. | Mitigated by Maximin target aggregation and the 0.15 accuracy cap: the loop is forced to find prompts that are *jointly* high without silently sacrificing a target. If target asymmetry remains below floor, the §3.7.3 gate-failure flow kicks in (caveat-ship or 3-objective re-run). |
| **GEPA prompt bloat** (Gemini risk C3) | Reflectors monotonically add rules; prompts balloon to 2,500+ tokens by round 20, diluting attention. | Mitigated by length penalty (§3.7) + OP-5 Pruner (§3.2) + 2000-token ship hard cap. |
| **Overfitting 40 probes over 20 rounds** (Gemini risk D2) | 60+ candidates evaluated against only 40 probes → overfit risk to dev quirks. | Mitigated by mid-run probe rotation at round 11 (§3.1) + dynamic hard-negative weighting + **10-language stratified dev** (§5.0, no single-language overfit) + the once-opened Vault (§5.8) and 8-language OOD gate (§3.5.1) as final overfit checks. |
| **`[[token]]` whitespace corruption** (Gemini risk D3) | Translators/paraphrasers return `[[ ss-search ]]` with extra spaces inside brackets, breaking strict regex validation. | Mitigated by `[[token]]` validator's whitespace normalization step (§3.2.1). Strict regex first normalizes `[[\s*X\s*]]` → `[[X]]`. |
| **Reflective rewrites get stuck in lexical-prior loops** (e.g., overemphasising "search" because the tool has "search" in its name) | The reflector's prompt mutations might converge on tropes that exploit lexical priors rather than describing tool behaviours unambiguously. | Mitigated by OP-4 Tool-Signature Masking (§3.2): periodically re-aliases tool names to break lexical-prior reliance, forcing self-describing prompt content. |
| **Pareto-gated TARE may miss occasionally-brittle prompts** | A candidate that doesn't make the Pareto front by task score gets discarded WITHOUT TARE — but might have been borderline-Pareto and brittle. | Acceptable: those candidates wouldn't have entered the front anyway. The methodological point of TARE is to filter brittle Pareto entrants; non-entrants don't need filtering. |
| **Maximin race-to-the-middle catastrophe** (Gemini 2nd-pass §A1) | A variant scoring (Sonnet 0.55, GPT 0.55) Pareto-dominates (Sonnet 0.9, GPT 0.2) on Maximin (0.55 > 0.2), but the dominator ships a -0.35 catastrophic regression for Sonnet users. | Mitigated by §3.7.1 step 11: 0.15 raw-accuracy degradation hard constraint. No Pareto admission if either target's accuracy score drops by >0.15 vs the displaced incumbent. |
| **Round 11 probe rotation discontinuity** (Gemini 2nd-pass §B1) | After rotation, new mutations are evaluated on new probes while incumbents have scores from old probes — apples-to-oranges Pareto comparison. Could permanently lock new mutations out of the front. | Mitigated by Pareto-front re-baseline at rotation (§3.1): 6 incumbents × 5 new probes × 2 targets = 60 extra runs (~$5). Mathematically non-negotiable. |
| **Accuracy-only judging leaves no optimization headroom** (user catch, 2026-05-24) | A raw dev score around 0.935 can look "done" while the agent still wastes tool calls and tokens compared with native rg+Read. Accuracy-only GEPA then optimizes judge prose instead of production value. | Mitigated by §3.7.1 native-relative desirability: accuracy, tool-call count, and agent tokens are all rewarded/penalized against a frozen native baseline, with 0.60 / 0.25 / 0.15 weights and geometric aggregation. |
| **PRP judge verbosity bias rewards tool-call gluttony** (Gemini 2nd-pass §B2) | LLM-as-judge prefers more-tokens-of-reasoning answers, not more-efficient answers. Without a counter-pressure, GEPA evolves a 5-tool-call-per-probe prompt that destroys production rate limits. | Mitigated by native-relative call/token desirability (§3.7.1 step 6), plus EAS diagnostics/fallback (§3.7.1 step 4). Surgical tool use Pareto-dominates exhaustive use only when accuracy is preserved. |
| **OP-2 trajectory-crossover schizophrenia** (Gemini 2nd-pass §B3) | OP-2 acts as genetic memory — resurrects deprecated behaviors that the human just penalized via manual reflection in the previous round. Prompt becomes self-contradictory. | Mitigated by passing latest manual-reflection hint to OP-2 as a hard negative constraint (§3.2 OP-2 row). |
| **Tool-Signature Masking ghost-context leak** (Gemini 2nd-pass §A3) | Reflector sees `[[TOOL_ALPHA]]` but knows it's optimizing a code-search agent — hallucinates "search" / "code" / "repository" back into the surrounding context, defeating the masking. | Mitigated by domain-stripping in OP-4's reflector system prompt (§3.2 OP-4 row). Reflector is told it's optimizing "generic database retrieval / regex anchor / vector similarity / graph traversal" tools — no code-domain words. |
| **Gold-probe self-fulfilling prophecy** (Gemini 2nd-pass §B4) | Author subconsciously aligns dev probes with P6 win-rate signal → GEPA trivially "validates" P6 because the test is rigged. | Mitigated by adversarial counter-probes (§5.7): 10 dev probes rewritten by Sonnet with anti-P6-shape phrasing, evaluated on the winner at end of run. Score within 15% of dev = generalised; >25% drop = overfit. |
| **Domain-specific code-search pathologies undetected** (Gemini 2nd-pass §C) | Wrong-extension death loop, context-window flooding (minified file traps), transitive rabbit hole — all common production failures with no probe coverage. | Mitigated by §5.5 pathology probes: 7 dev probes specifically encode these failure modes so GEPA discovers prompt-level defenses naturally. |
| **Frankenstein-prompt language overfit** (Gemini 2nd-pass §E) | Optimised prompt over-fits AST patterns of the in-distribution languages → silent regression on absent languages. | Mitigated by (a) **10-language in-distribution dev/held/vault** (§5.0 — JS/TS/Go/Py/Rust + Java/C++/C#/Ruby/Kotlin, no longer 5 web/server languages) AND (b) §3.5.1 **8-language OOD transfer gate** (C/Dart/Elixir/Lua/PHP/Scala/Swift/Zig), aggregate Maximin ≥0.55 on both targets required to ship. |
| **Brittle to the production query distribution** (Gemini 2nd-pass §D5, re-scoped) | Prompt optimised for well-formed dev queries; but production queries are **agent-formulated** (parent agent → sweet-search agent) with cross-model shape variance — not human typos. | Mitigated by §3.6.1 agent-mediated query robustness: agent-delegation paraphrase (dominant) + cross-model query-shape variance + small CLI/human buckets; ≤20% drop per target, with bucket-A-alone and bucket-B target-asymmetry checks. |
| **RIF (Retrieval-Induced Forgetting) drift in late-turn trajectories** (Gemini 2nd-pass §D2) | Long agent trajectories push system-prompt instructions out of attention; by turn 4, agent forgets routing rules. | Mitigated by §3.2.3 stateful-summarization rule baked into T2/T8/T13/T14/T15 seed variants. |
| **Concurrency math wrong — TPM not RPM is the binding constraint** (GPT-5.5 review §D1) | Naive RPM ceiling at Tier 1 GPT-5.5 = 30 concurrent calls × 12K tokens = 360K tokens in flight = 12× over 30K TPM ceiling. Run would 429-storm minute-one. | Mitigated by TPM-aware token-bucket scheduler (§7.7) + pre-flight check that flags Tier 1 as operationally insufficient and recommends $50 Tier-2 upgrade. |
| **0.15 cap utopia-point bug in Gemini's own fix** (GPT-5.5 review §C1) | Comparing degradation to per-target Pareto MAXIMA (different specialist incumbents) creates a "utopia point" constraint that systematically rejects genuinely joint-improving candidates. | Mitigated by changing cap baseline to **the displaced incumbent** (or current joint-best when not displacing) instead of per-target maxima. Worked example in §3.7.1 step 11. |
| **Stale rejected-plan residue in §1/§2/§13/§7.6/§3.x** (GPT-5.5 review §D3) | joint-mean references throughout, ja-pivot/latent-interp still in §2.1 roles, §13 day-3 still says "implement latent-interp + ja-pivot", verbose-logging examples reference dead operators. Implementers will follow stale sections. | Mitigated by sweep through §1, §2.1, §2.3, §3.1, §3.4, §3.5, §3.5.1, §3.6, §3.6.1, §7.6, §13 replacing all stale references with then-current Maximin × EAS / trajectory-crossover / persona-pivot terminology. §11.6 supersedes the live scalar objective with native-relative scoring. |
| **Language-transfer omits GPT-5.5** (GPT-5.5 review §B2) | Direct Sonnet bias — only Sonnet validates language transfer despite GPT-5.5 being a production target. | Mitigated: §3.5.1 OOD set (40 probes × 8 languages) runs on MiMo + Sonnet + GPT-5.5; pass criterion ≥0.55 aggregate Maximin on BOTH production targets, with per-language scorecard. |
| **Asymmetric EAS — GPT-5.5 early-stop unpenalized** (GPT-5.5 review §B1) | Original Gemini formula penalised over-exploration (Sonnet failure mode) but rewarded under-exploration ("one plausible lexical hit, confident final" — GPT-5.5 failure mode). | Mitigated by per-target per-stratum expected-call windows + evidence-adequacy penalty for unsupported finals. EAS aggregated as `min` across targets to be Maximin-consistent. |
| **Token validator gaps — multiplicity / unmapped aliases / surplus tokens** (GPT-5.5 review §B5) | Validator only checked presence; missed multiplicity drift, unmapped `[[TOOL_*]]` survival, and operator-invented surplus sentinels. Silent prompt corruption risk. | Mitigated by extending validator (§3.2.1) to record source multiplicity, require same multiplicity in output, reject unmapped OP-4 aliases, reject surplus protected tokens. New `mutation-rejection` JSONL events per failure mode. |
| **OP-2 trajectory style imports Sonnet** (GPT-5.5 review §B3) | Crossover not target-tagged → Kimi may learn Sonnet's exploration cadence as the universal "winning" pattern. | Mitigated by target-tagging requirement on trajectories + balanced-pair crossover when both targets have winning trajectories + bottleneck-tagging (Sonnet-only / GPT-only / joint). |
| **SCS rewards stable wrongness** (GPT-5.5 review §C3) | Naive consistency metric rewards a prompt that consistently gives the SAME WRONG answer. | Mitigated by correctness-weighted SCS = SCS × min_paraphrase_accuracy as the ship gate, with minimum-paraphrase-accuracy floor of 0.6. Naive SCS reported but no longer gates. |
| **appendFileSync doesn't fsync — durability bug** (GPT-5.5 review §D2) | Crash mid-round can lose recent JSONL events; resume picks up at wrong point. | Mitigated by `appendFsynced` wrapper using explicit `openSync → writeSync → fsyncSync → closeSync`. Kill-9-recovery unit test. |
| **Single-family TARE / query-degradation distribution** (GPT-5.5 review §C2/§C4) | Sonnet-only paraphrase generation tests Anthropic-style robustness only. | Mitigated by TARE K=3 requiring ≥1 non-Anthropic paraphrase + OP-3 generator rotation Sonnet/Kimi/GPT-5.5 + §3.6.1 agent-query degradation across 5 families (Sonnet/Opus/GPT-5.5/MiMo/Qwen) incl. natural cross-model emission. |
| **n=6 Pareto noise overweighted as discriminative variance** (GPT-5.5 review §C5) | Small-front variance can be judge-noise rather than probe difficulty. | Mitigated by 2-round stability gate (variance only counts after probe evaluated ≥2 rounds) + judge-noise floor of 0.05 in §3.1 weighting. |
| **Forensic-metadata gap in JSONL telemetry** (GPT-5.5 review §D4) | Without model_id/api_path/temperature/commit/probe_hash/token_counts/judge_panel logged, post-hoc explanation of GPT-vs-Sonnet deltas is impossible. | Mitigated by extending confirm-event schema (§7.4) to log all forensic metadata. |
| **Code-looking routing blocks over-literally interpreted** (GPT-5.5 review §B4, revised after gen-1) | GPT-5.5 may treat fenced code or pseudocode as executable examples instead of routing policy, and OP-5 may preserve them too aggressively. | Mitigated by replacing OP-3 AST-ification with compact router tables and forbidding AST/procedure/pseudocode/fenced-code outputs in mode b. |
| **Reasoning-mode transfer gap — power users run thinking ON; we optimise OFF** (user catch, post-GPT-review) | Optimization runs against `extended-thinking=OFF` Sonnet and `GPT-5.5-instant` (non-reasoning) for cost and production-default parity. Power users — disproportionately the prompt-quality-sensitive cohort — flip thinking ON. EAS per-stratum windows, compact router tables, stateful-summarization rules, and Pruner-driven length cuts all may misfire under reasoning. | Mitigated by §3.5.2 reasoning-mode operational HOMP gate: 60 runs (~$12) on Sonnet+thinking-ON and GPT-5.5-reasoning over the 30 held-out probes. Pass criterion ≥0.7× `final_score` per class. Fail → ship-with-caveat OR §3.7.3 fork to reasoning-as-5th-objective extension run (~$80). Validates transfer, doesn't optimise for it — accepted cost/insurance trade. |

---

## §11 Comparison to original §11 (publication-tier) plan & Gemini-Deep-Think-integrated

| Dimension | Original §11 spec | This P7 plan | Trade-off |
|---|---|---|---|
| Judge panel | 5-of-5 disjoint + 1 adversarial | 3-of-3 disjoint | -3 judges, +practical |
| Probe sets | 60 dev + 40 sealed-1 + 80 vault | 40 dev + 30 held-out + 25 vault (10 languages) + 8 OOD transfer languages | smaller n; broad language coverage (all 18 distinct SHA-locked languages), Vault included |
| Replication | ≥2 seeds | 1 seed | no variance bounds |
| HOMP | ≥2 classes | 2 classes (MiMo-V2.5-Pro + Qwen 3.6 Plus) | matches pub-tier on HOMP |
| GEPA rounds | not pinned | 20 with patience=5 | typical range |
| Sharpness/robustness | not in original | TARE-style selection + SCS reporting | **stronger than original** |
| Pre-registration | yes | yes (`prereg/p7-v1` tag) | ✓ |
| Decision log | not specified | append-only `p7-decisions.md` | **stronger than original** |
| Direct-API for judges | not specified | mandatory | **stronger than original** |
| Manual reflection | "researcher degrees of freedom" warning | Documented protocol with dev-only-edits rule | **explicit, defensible** |
| Mutation operators | 14 hand-authored seeds + naive paraphrase | 5-operator portfolio: Reflective + Trajectory-Crossover + Persona-Pivot + Tool-Mask + Pruner | **stronger than original** |
| Score aggregation | not specified | Maximin + length penalty + dynamic hard-negative weighting | **stronger than original** |
| Probe rotation | static probe set | mid-run rotation at round 11 (anti-overfit) | **stronger than original** |
| Total cost | $400-1000+ implied | ~$470 (40/30/25 tiers, 10 in-dist + 8 OOD languages; user kept GPT-5.5) | one run, well under $1000 |
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
| **Idea: Length penalty (already in §3.7.1 now made explicit) + structured routing rules** | NEW | §3.2 (OP-3 row), §3.7.1 | Initially integrated as AST-ification; revised after gen-1 to compact router-table consolidation because it is shorter and less code-looking. |
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
| **OP-5 Pruner can mangle structured routing blocks** ("make it terse" deletes conditions or table rows) | LOW | §3.2 (OP-5 row) | OP-3 now uses compact router tables instead of pseudocode; OP-5 preserves fenced examples and prunes redundant prose/table rows without changing operational rules. |
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
| **D3: Stale rejected-plan residue** (joint-mean references throughout, ja-pivot/latent-interp in §2.1 roles, §13 day-3 still says "implement latent-interp + ja-pivot", logging examples reference dead operators) | CRITICAL | §1, §2.1, §2.3, §3.1, §3.4, §3.5, §3.5.1, §3.6, §3.6.1, §7.6, §13 | All stale references replaced with the then-current Maximin × EAS final_score formula and current operator names (trajectory-crossover, persona-pivot; OP-3 later revised from AST-ification to compact router tables). §11.6 later supersedes the live scalar objective with native-relative scoring. |
| **C1: 0.15 cap utopia-point bug** (Gemini's own fix introduced the bug — comparing to per-target Pareto MAXIMA rejects genuinely joint-improving candidates that fall under different specialist incumbents) | CRITICAL | §3.7.1 step 11 | Cap baseline now relative to the **displaced incumbent** (or current joint-best when not displacing), NOT global per-target Pareto maxima. Worked example showing V_C=(0.75, 0.85) correctly admitted instead of incorrectly rejected. |
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
| **B4: Fenced python pseudocode can be over-literally interpreted** (GPT-5.5 may treat fenced ```python``` blocks as executable examples) | LOW | §3.2 (OP-3 row) | Initially mitigated with labels; revised after gen-1 to avoid pseudocode entirely in OP-3 mode b and use compact router tables. |

**Cost impact of GPT-5.5 review integrations**: +$1 (Java HOMP for GPT-5.5 +$0.50, GPT-5.5 lazy-user generator +$0.30 amortized, GPT-5.5 OP-3 rotation +$0.20 amortized). New total: **~$321, hard cap $420**.

**Additional user-caught gap (post-GPT-review)**: §3.5.2 reasoning-mode operational HOMP gate adds ~$12 (the full 30 held-out probes × 2 reasoning modes × ~$0.20 reasoning premium — see §3.5.2). *(Historical snapshot: at the time this change-map was written the gate was scoped to 15 held-out probes / +$6 and the running total read **~$327, hard cap $420**. Both were later superseded — the held-out set was widened to 30 (§3.5.2) and the authoritative current totals are the **~$470 headline / $550 hard cap** in §11.4. This line is retained as a historical change-map entry, not the live total.)*

**Operational readiness change**: tier-2 OpenAI billing is now operationally mandatory. This is a $50 one-time pre-flight cost, not added to the run budget — it's a prerequisite for the run wall-time being reasonable.

**Decision**: ship after these pre-registration fixes (now integrated). The plan now goes to `prereg/p7-v1` tagging.

### §11.6 What the 2026-05-24 judging review changed

User review flagged that a 0.935-ish dev accuracy baseline is too high for useful GEPA pressure if the scalar objective only judges correctness. That critique is accepted. The production goal is not just "answer correctly"; it is to beat native rg+Read on all three dimensions that matter to users:

- accuracy: preserve or improve correctness against both targets;
- speed proxy: use fewer tool calls for the same correct answer;
- token savings: spend fewer agent tokens for the same correct answer.

Integrated changes:

| Finding | Section affected | Change |
|---|---|---|
| Accuracy-only scoring leaves little room for GEPA to optimize and can reward verbose judge-pleasing answers. | §3.7.1, §6.2.2, §10 | Added native-relative desirability against a frozen native rg+Read baseline. Accuracy / calls / tokens use weights 0.60 / 0.25 / 0.15 and weighted-geometric aggregation. |
| Codex CLI total tokens include a large fixed harness/system context, so raw total-token ratios can under-reward retrieval-token savings. | §3.7.1, §6.2.2 | Added optional `overhead_tokens`; when present, token desirability uses overhead-adjusted work tokens while raw total tokens remain recorded for cost. |
| Resume replay must preserve token usage, not just score/tool calls. | §7.4 | SCREEN/CONFIRM events carry agent input/output tokens so resumed runs can recompute native-relative scores without re-spending API calls. |
| Documentation still described Maximin × EAS as the primary scalar. | §1, §2.3, §3.1, §3.7.1, §13 | Reframed Maximin × EAS as fallback/diagnostic when no native baseline is supplied; paid GEPA runs should use `--native-baseline`. |

**Decision**: do not spend the full GEPA budget until the native rg+Read baseline file exists and validates for every dev `(target, probe)` row.

---

## §12 Open questions — RESOLVED at pre-registration (2026-05-10)

All 6 questions are now locked. Decisions:

1. **Codex target: GPT-5.5-instant** ✅ — user strategic override of Gemini's GPT-5.4 recommendation; rationale in §11.2. +$99 cost vs GPT-5.4 buys pretrain future-proofing as 5.6+ will likely be 5.5-derived. Backwards-compat post-hoc replay on GPT-5.4 (~$2-5) verifies transfer-down. Scheduled for §13 day 9.
2. **Run length: 20-round budget, stop-when-plateau-fires** ✅ — lock 20 as the budget cap; rely on the patience rule (5 rounds without improvement) + plateau-breakthrough extension (§3.1) to stop early when convergence is reached. This may end at round 12-15 if the trajectory is clean; only goes to 20 if there are late-round step-changes. The user reviews convergence between rounds and can stop early at any point.
3. **Probe corpus: deno 2.x** ✅ — for fresh hand-authored post-cutoff probes (covering the 30-40 non-P6-derived probes per §5.4). Most representative of typical Codex/Claude Code agentic-search use.
4. **Manual reflection cadence: every round, AI-assisted** ✅ — between every round, Gemini 3.1 Pro Deep Think (`gemini-3.1-pro-preview` with `thinkingBudget: -1`) generates a reflection report on the round's results. User reviews Gemini's report, decides what to act on, logs the decision to `p7-decisions.md`. Cost: ~$0.07/round × 20 = ~$1.40 total. See §3.4 for protocol.
5. **HOMP class B (Qwen 3.6 Plus): opencode CLI** ✅ — user prefers harness-realism over direct-API speed. Real Qwen users on opencode see the prompt through the same CLI overhead, including system-context injection. Using opencode CLI for HOMP makes the "does it transfer to opencode users?" claim more honest. The only call path in P7 that uses a CLI harness; documented as such in §10 risk register. **Reminder**: Qwen 3.6 Plus is HOMP-only, NOT a target — we ship a unified prompt optimised for Sonnet+GPT-5.5; Qwen validates cross-family transfer.
6. **OP-4 Tool-Signature Masking aliases: randomized per call** ✅ — each call gets a fresh permutation of `[[TOOL_ALPHA/BETA/GAMMA/DELTA]]` aliases mapped to `[[ss-search/ss-find/ss-semantic/ss-trace]]`. Mapping logged to the trajectory JSONL for audit. Prevents the optimizer from memorising the alias scheme and gaming it.

All locked. Ready for `prereg/p7-v1` tag.

---

## §13 Next steps

1. **Now**: review this PHASE7.md; resolve the 7 open questions in §12.
2. **Day 1**: author T1–T15 seeds (P6-grounded per §4.2, consumer-clean per §4.5) + dev / held-out / vault probes across 10 in-distribution languages + 40 OOD language-transfer probes across 8 languages (per §5.0/§5).
3. **Day 2**: implement direct-API runners (Anthropic, OpenAI, Moonshot, MiniMax, MiMo, Qwen-DashScope) + Gemini Embedding 2 client. Unit-test the `[[token]]` preservation.
4. **Day 3**: implement GEPA driver + Pareto-gated TARE + the 5-operator portfolio (OP-1 reflective with inefficiency traces, OP-2 trajectory-crossover with target-tagging, OP-3 persona-pivot+compact-router-table mode with rotated generators, OP-4 tool-mask with domain-stripping, OP-5 Pruner). Implement native-relative scoring against a frozen rg+Read baseline, EAS diagnostics/fallback (per-target per-stratum + evidence-adequacy), 0.15 admission cap (relative to displaced incumbent), TPM-aware token-bucket scheduler, persistence/resume with `fs.fsyncSync`, full-metadata JSONL telemetry (§7.4), pre-flight checklist (§7.5), verbose logger (§7.6), mixed screen selection, and restart scaffolding. Unit-test crash-resume + token-validator multiplicity/alias gates.
5. **Day 4**: dry-run on 3 probes × 1 round to validate end-to-end (cost: ~$1). Fix bugs.
6. **Day 5**: generate/freeze the native rg+Read baseline file (§6.2.2), tag `prereg/p7-v1`, push, and run the pre-flight script. If it fails, fix and re-tag before any GEPA spend.
7. **Days 6–8**: run full GEPA (joint Sonnet 4.6 + GPT-5.5-instant) with `--native-baseline`. Manual reflection between rounds. Trajectory written to disk continuously — resumable.
8. **Day 9**: HOMP (MiMo + Qwen) + **8-language OOD language-transfer** (40 probes × MiMo + Sonnet + GPT-5.5; §3.5.1) + **reasoning-mode operational HOMP** (Sonnet thinking-ON + GPT-5.5 reasoning over 30 held-out probes; §3.5.2) + correctness-weighted SCS + GPT-5.4 backwards-compat replay (~$2-5) + winning prompt selection. Then **open the Vault ONCE** on the selected winner (25 probes × 2 targets; §5.8) — the final untouched confirmation number.
9. **Day 10**: write up `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` + `recommendations.json` + the run report.
10. **Day 11**: tag `release/p7-v1`. Push. Update CLAUDE.md / sweet-search MCP to ship the new prompt.

Optional (publication path):
- **Day 12+**: replicate with seed=43 for variance bounds. Add a 3rd HOMP class. Expand to full publication-tier probe sets (60 dev / 40 sealed / 80 vault) only if GEPA becomes the *primary* paper contribution. ~$50-100 marginal.

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
- **Cost premium accepted**: ~$144 more than 5.4 plan (at the 40/30/25 sizing). Worth it for shelf-life.

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
