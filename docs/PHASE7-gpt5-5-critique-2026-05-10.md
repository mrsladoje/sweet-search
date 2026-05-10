# Phase 7 — GPT-5.5 xhigh External Review

**Date**: 2026-05-10
**Reviewer**: GPT-5.5 xhigh (extended-thinking / reasoning-high mode)
**Verdict**: Ship after pre-registration fixes; the research design is strong, but the current draft still has GPT-specific bias and operational footguns.

This is the fourth external review of PHASE7.md (after three Gemini 3.1 Pro Deep Think passes). It was specifically commissioned to surface concerns Gemini structurally cannot — by virtue of being one of the production targets being optimised for, and by reading the doc as an implementer rather than a methodologist.

---

## A) Honest Assessment

This is researcher-defensible and close to production-ready, but I would not tag prereg/p7-v1 exactly as written. The core methodology is strong: GEPA + Pareto-gated TARE + Maximin + degradation cap + HOMP + probe rotation is a serious pipeline, not prompt tinkering. Gemini's ship-it verdict is directionally fair.

My rating: production-ready after preflight fixes, not "ship unchanged." The remaining issues are not "add more clever operators." They are target asymmetries and calibration details that matter specifically because GPT-5.5-instant is one of the production targets.

## B) GPT-5.5-Target-Specific Blindspots

**B1. EAS is calibrated against Sonnet-style over-exploration, not GPT-style under-exploration.**
GPT-style code-search failure is often not "5 tool calls forever." It is "one plausible lexical hit, confident final answer." Current EAS in §3.7.1 rewards low call count and only penalizes excess above 3 calls averaged across targets. That can select prompts that make GPT-5.5 terminate too early.

Fix: make EAS per-target and per-stratum. Literal lookup may expect 1-2 calls; multi-file and no-match probes may expect 3-5. Penalize both excess calls and unsupported early final answers.

**B2. Language-transfer HOMP omits GPT-5.5.**
§3.5.1 runs Java transfer on MiMo and Sonnet only. That is a direct Sonnet bias. If GPT-5.5 is a production target, Java transfer must include GPT-5.5 too. Cost is trivial: 10 extra GPT runs.

**B3. OP-2 can import Sonnet trajectory style.**
Contrastive trajectory crossover in §3.2 uses "A's full tool-call trajectory," but the plan does not require that the trajectory be target-tagged or target-balanced. If the winning trajectory is Sonnet's, Kimi may learn Sonnet's exploration cadence and prose style, not the behavior GPT needs.

Fix: OP-2 packages should include both target traces when available, and the operator should explicitly identify whether the bottleneck is Sonnet-only, GPT-only, or joint.

**B4. AST-ification helps, but fenced pseudo-Python can be over-literal.**
GPT-5.5 will usually respect structured routing rules, but fenced python blocks can be treated as examples or executable-ish code, especially if tool names and placeholders look syntactic. Prefer "routing policy pseudocode, not executable code" labels, or decision tables for high-level routing.

**B5. The [[token]] contract is mostly fine, but validation is incomplete.**
§3.2.1 checks that source tokens appear after mutation. It should also reject unmapped OP-4 aliases, surplus protected tokens, and changed token multiplicity. GPT is good at preserving sentinels, but leftover [[TOOL_ALPHA]] artifacts are exactly the kind of silent prompt corruption that will hurt tool use.

## C) Methodology Attacks

**C1. The 0.15 cap may freeze GPT-friendly candidates.**
§3.7.1 says the cap is relative to the "current joint-best Pareto incumbent," but the formula uses best_sonnet_on_pareto and best_gpt5_5_on_pareto. Those may be different specialist prompts. That creates a utopia-point constraint and can reject a candidate that improves the true joint-best while being 0.16 below a Sonnet specialist.

Fix: define the cap relative to either the current joint-best incumbent or the incumbent being displaced, not per-target maxima across the whole front.

**C2. TARE paraphrases are Sonnet-generated.**
§3.3 uses Sonnet for adversarial paraphrases. That tests Anthropic-style paraphrase robustness more than GPT-style robustness. I would not replace the panel, but I would require K=3 paraphrases to include at least one non-Anthropic generator or deterministic structural paraphrase.

**C3. SCS can reward stable wrongness.**
§3.6 measures agreement, semantic similarity, and length stability. A prompt that consistently gives the same wrong answer can score well. Report SCS, but gate on correctness-weighted SCS or minimum paraphrase accuracy too.

**C4. Lazy-user robustness is Sonnet-authored.**
§3.6.1 uses Sonnet to degrade user queries. That likely reflects Sonnet's notion of "tired developer" phrasing. Add either GPT-5.5-generated degraded queries or deterministic templates: dropped symbols, wrong extension, abbreviated package names, partial stacktrace fragments.

**C5. Dynamic hard-negative weighting can overweight noise.**
§3.1 weights by variance across a Pareto front of size 6. With n=6, judge noise can masquerade as discriminative probe variance. Add a noise floor or shrinkage term before upweighting.

## D) Operational Gaps

**D1. OpenAI concurrency is wrong if §14.2 TPM numbers are used.**
§7.7 says GPT-5.5 Tier 1 default concurrency is 30 because RPM is 500. But §14.2 says Tier 1 TPM is 30,000, and each run is estimated at ~12K tokens. That is about 2-3 calls/minute, not 30 concurrent calls. TPM, not RPM, is the limiting resource.

Fix: use token-bucket scheduling: `max_calls_per_min = min(RPM, ITPM / estimated_input_tokens, OTPM / estimated_output_tokens)`.

**D2. appendFileSync does not guarantee fsync.**
§7.4 says Node append may fsync on macOS. Do not rely on that. Open the fd, write, call `fs.fsyncSync(fd)`, then close.

**D3. The document still contains stale rejected-plan residue.**
Examples: §1/§2 still say joint mean despite §3.7 Maximin; §2.1 still lists latent-interp and ja-pivot roles; §13 says implement latent-interp + ja-pivot; §8.2 has old $207/$270 budget; §11 comparison says one HOMP class despite two. This is not just cosmetic: implementers will follow stale sections.

**D4. JSONL telemetry needs model/run parameters.**
Add exact model id, API path, temperature/default sampling params, tool schema version, repo commit, probe hash, prompt hash, input/output/cache tokens, result-byte count, retry count, and judge ids. Otherwise GPT-vs-Sonnet deltas will be hard to explain.

## E) Top 3 Actionable Changes

**1. Patch §3.7.1 scoring for GPT early-stop risk.**
Replace global averaged EAS with per-target, per-stratum expected-call scoring. Add an evidence adequacy penalty for final answers with insufficient read/trace support. Clarify the 0.15 cap baseline as current joint-best or compared incumbent, not global per-target Pareto maxima.

**2. Patch §3.2, §3.3, §3.4, §3.5.1 for target balance.**
OP-2 must carry target-tagged trajectories. TARE must include at least one non-Sonnet paraphrase. Manual reflection must report GPT-only failures separately. Java language-transfer must run on GPT-5.5, not only Sonnet.

**3. Patch §7.4, §7.7, §8, §13 before prereg.**
Implement TPM-aware concurrency, real fsync, expanded JSONL run metadata, and remove stale mean/latent/ja-pivot/old-budget/HOMP inconsistencies.

**Verdict**: ship after these pre-registration fixes; the research design is strong, but the current draft still has GPT-specific bias and operational footguns.
