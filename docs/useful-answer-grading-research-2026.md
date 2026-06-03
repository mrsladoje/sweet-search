# Grading Code-Retrieval Answers by Downstream Usefulness — SOTA Research & Recommendation (2026-06)

**Status:** research deliverable (literature review + implementable design).
**Author:** research agent, 2026-06-03.
**Motivating problem:** our P7 correctness signal is a 3-panel LLM judge whose rubric is pure **reference + fact recall** ("reward answers that cite the expected files/symbols and state the expected facts; penalize hallucinations" — verbatim from `core/prompt-optimization/sweep/gepa-evaluate.mjs:183-199`). That rubric rewards terse, reference-shaped answers (which native `rg`→`file:line:match` produces by construction) and gives **zero credit** for the *extra downstream usefulness* of sweet-search's richer answers (workable code chunks + surrounding context). We want a SOTA-grounded, hard-to-game way to credit the USEFULNESS dimension that connects to / predicts task-completion success (sibling: `docs/TASK_COMPLETION_BENCH_PLAN.md`).
**Scope note:** searches were date-scoped to the last 6–12 months. The core LLM-judge and code-RAG eval literature is very active in 2026; two foundational anchors (CodeRAG-Bench 2406.14497, Length-Controlled AlpacaEval 2404.04475) are ~12–24 months old and are flagged as such — they remain the canonical references and have not been superseded, only extended.

---

## 1. Bottom-line recommendation (one paragraph)

**Adopt a hybrid, two-layer metric: keep reference/fact recall as a hard CORRECTNESS FLOOR (an answer that is wrong or hallucinated cannot be "useful"), and add an EXTRINSIC, task-grounded USEFULNESS LIFT measured by feeding the *answer-as-context* to a fixed, cheap downstream solver and scoring whether the solver succeeds at a small downstream sub-task.** The intrinsic multi-dimensional LLM-judge rubric (helpfulness/completeness/actionability/groundedness) is the right *interim* instrument and the right *online* monitor, but on its own it is gameable by verbosity and self-preference and only weakly predicts task completion; the 2026 literature is consistent that **the least-gameable usefulness signal is execution/task-grounded, not judge-opinion-grounded** (CodeRAG-Bench, SWE-ContextBench, DeR2). Concretely for sweet-search: (a) immediately re-judge with an **analytic, binary-criterion, evidence-anchored rubric reported as a SEPARATE usefulness vector alongside the unchanged recall floor** (never collapsed into one number, mirroring the precedent already in `relaxed-grading.mjs`), with the published anti-verbosity controls; and (b) build the usefulness LIFT into the task-completion bench as the **"answer-fed-solver" extrinsic protocol** — the answer text from a probe becomes the *only* context a frozen DeepSeek solver gets for a paired edit/QA sub-task, and we score solver success deterministically. This respects every house principle (held-out split, pre-committed N, CIs-exclude-0, disjoint-family panel, cache-aware cost) and ties the per-exploration usefulness signal directly to the resolve-rate thesis. The single most important design decision is **do not fold usefulness into the recall score and do not let "richer" become "longer" — gate usefulness on a downstream effect or on length-controlled, evidence-anchored criteria, because an easily-gamed verbosity reward is worse than the status quo.**

---

## 2. Why the current rubric under-credits sweet-search (the precise failure, with citations)

The flaw is not subtle and the literature names it three ways:

1. **"A faithful, grounded answer to the right reference is still not the same as a useful answer."** RAG-eval frameworks separate *faithfulness/recall* from *answer relevance/utility* precisely because the former can be maxed by a minimal, reference-shaped answer. RAGAS (2309.15217) and ARES (2311.09476, NAACL 2024) both treat **answer relevance** as a distinct closing-the-loop axis on top of faithfulness/context-relevance; the 2026 practitioner consensus (FutureAGI, Evidently, Braintrust RAG-tool surveys, Jan–Feb 2026) is that measuring only the recall/faithfulness side misses real regressions. Our rubric measures only the recall side.

2. **More/longer retrieved context is not monotonically more useful — and can be net-negative.** This is the strongest 2026 result against a "richness = goodness" assumption and against naïvely rewarding longer answers:
   - **DeR2 / Retrieval-Infused Reasoning Sandbox (2601.21937, Jan 2026)** decouples *retrieval loss* from *reasoning loss* with four regimes (Instruction-only / Concepts-only / Related-only / Full-set) and finds **"mode-switch fragility": many SOTA models perform WORSE with the Full document set than with Instruction-only**, plus "structural concept misuse" (the model names the right concept but can't execute it). Implication: a metric must measure whether context is *usable*, not how much is present.
   - **SWE-ContextBench (2602.08316, Feb 2026)** runs the canonical extrinsic ablation (No-Context vs Free/autonomous-retrieval vs Oracle context, on real SWE tasks) and finds **Oracle compact summaries lift resolve 26.26%→34.34% (+8pp), but autonomous "Free" retrieval gives ≈0 and is sometimes net-negative**, and **compact summaries (217 tokens) beat full trajectories (25,633 tokens)**. Verbatim: *"Retrieval alone is insufficient; agents must learn when to trust and how to adapt retrieved context… concise summaries are highly effective when correctly selected, but misleading when irrelevant."* This is direct evidence that the right usefulness signal rewards **correctly-targeted, compact** context — which is exactly sweet-search's claim — and *penalizes* dumping volume, which a verbosity-biased judge would reward.

3. **Resolve/recall ceilings under-measure real-world usefulness — humans credit the dimension our judge ignores.** METR's *"Many SWE-bench-Passing PRs Would Not Be Merged into Main"* (metr.org, 2026-03) had maintainers review 296 AI PRs: many test-passing patches are rejected for "breaks other code" / "code quality." Conversely, **"Are 'Solved Issues' Really Solved?" (2503.15223, ICSE 2026)** shows 29.6% of plausible patches are behaviourally "suspicious" and resolution drops 6.4–17.3pp under stronger tests — i.e., the binary signal both over- and under-credits. The lesson cuts both ways: a usefulness metric must be **grounded in an effect (a downstream success or a verifiable property), not in surface form**, or it will be as fragile as the thing it augments.

**Net:** the current rubric is a valid *correctness floor* but an *incomplete* signal. The fix is to add a usefulness axis that (a) is gated on correctness, (b) rewards targeted/usable context rather than length, and (c) ideally bottoms out in a downstream effect.

---

## 3. Ranked approaches (with SOTA evidence and trade-offs)

### Rank 1 (recommended core) — Extrinsic, task-grounded usefulness: "answer-fed-solver"
**Idea:** usefulness = does the retrieved answer, *used as the sole context by a fixed downstream solver*, make the solver succeed at a small downstream sub-task (apply a patch that passes a hidden test, or answer a verifiable follow-up)? This is the "feed retrieved context to a frozen solver, measure end-task success" design.

**SOTA evidence (strong, execution-grounded, hard to game):**
- **CodeRAG-Bench (2406.14497, NAACL Findings 2025)** — *the* canonical code-RAG extrinsic benchmark. Holds the generator fixed, varies the retrieved context (no-context / canonical-doc / open-retrieval / gold), and scores with **execution metrics (pass@1, SWE-bench resolve)**. Headline: GPT-4o gains **+27.4% on SWE-Bench** and +6.9% on ODEX when canonical documents are provided; some retrieval configs even *beat* gold-doc performance. It also surfaces the non-monotonicity (DeepSeekCoder "benefits less from retrieval"), reinforcing that the metric must be per-system. *(~12 months old — flagged. Still the reference design; not superseded.)*
- **SWE-ContextBench (2602.08316, Feb 2026)** — the same ablation lifted to *agentic* SWE with the No-Context / Free / Oracle regimes and **deterministic F2P∧P2P resolve** as the primary signal, plus cost/runtime. This is the closest published analogue to what `TASK_COMPLETION_BENCH_PLAN.md` proposes, and validates the Oracle-vs-Free toggle as the clean causal design.
- **DeR2 (2601.21937, Jan 2026)** — the decoupling discipline: separate *retrieval loss* (does the context contain the answer) from *reasoning/utilization loss* (can a fixed solver use it). Its two-phase validation (instance must be unsolvable without evidence, solvable with oracle) is the right gate for our sub-task design — it guarantees the sub-task actually *depends on* the retrieved context, so the metric isn't measuring the solver's parametric knowledge.

**Trade-offs:** + least gameable (a verbose, padded answer that doesn't help the solver scores 0; a terse `file:line` answer that *does* contain the needed code scores high — this is exactly symmetric and fair to both arms); + directly predicts task completion by construction; + execution signal is deterministic and reproducible. − heaviest to build (needs the solver harness + hidden sub-task tests); − introduces solver-model variance (mitigate: fix the solver, ≥3 reps, paired); − a weak solver can floor out (mitigate: pick sub-tasks with a verified oracle-solvable / no-context-unsolvable gap, per DeR2).

### Rank 2 (recommended interim + online monitor) — Intrinsic analytic multi-dim rubric, evidence-anchored, length-controlled
**Idea:** keep an LLM-judge, but replace the single holistic "correctness" prompt with an **analytic rubric of independent, mostly-binary criteria**, scored with explicit anti-bias controls, and **report the usefulness criteria as a separate vector from the recall floor**.

**SOTA evidence (mature, validated to humans, but bias-prone):**
- **Autorubric (2603.00077, Feb 2026)** — unifies the rubric-based-judge lessons into opinionated defaults: **analytic rubrics with binary / ordinal / nominal criteria, single + ensemble judging, few-shot calibration, bias mitigations, and psychometric reliability metrics** (validated e.g. RiceChem 80% w/ 5 criteria). This is effectively a reference spec for the rubric we should write.
- **Rulers: Locked Rubrics and Evidence-Anchored Scoring (2601.08654, Jan 2026)** — names the three failure modes we must avoid — *rubric instability (prompt sensitivity), unverifiable reasoning (no auditable evidence), scale misalignment* — and fixes them with **immutable versioned rubric bundles + structured decoding that requires the judge to cite the evidence span before scoring + post-hoc calibration**. Reports higher human agreement and **stability under adversarial rubric perturbation**, letting small judges rival large ones. The "must quote the span that satisfies each criterion" mechanism is the single best anti-gaming and anti-verbosity device for a code rubric (you can't claim "complete" without pointing at the code that makes it complete).
- **FLASK / G-Eval / Prometheus-2 lineage + "Judging the Judges" (2604.23178, TMLR 2026)** — fine-grained skill-decomposed scoring beats holistic scoring; and the meta-study confirms **style/format bias is the dominant bias (0.76–0.92), far above position bias**, with **verbosity nuanced** — so the controls must target *style/format and length together*, not length alone.
- Human-agreement is real for analytic code judges: **CodeVisionary** (requirement-decomposed, multi-judge negotiation) beats baselines by +0.14–0.22 correlation to humans; **SWE-PRBench (2603.26130)** validates a fixed high-capability code judge at **κ=0.75**, cross-checked κ=0.616 — i.e., a well-built code rubric *can* reach "usable" human agreement (κ>0.6, the 2026 production bar).

**Trade-offs:** + cheap, fast, no solver harness, drop-in to `gepa-evaluate.mjs`; + interpretable per-criterion; + great as an online/regression monitor. − **gameable**: verbosity/style/self-preference biases are intrinsic to the embedding distribution and only *halved* (not removed) by rubric instructions ("Judging the Judges"; Reward-Hacking survey 2604.13602 explicitly lists verbosity as reward-hacking); − correlates with but does not *prove* downstream success. Use it as the LIFT's interim proxy and permanent monitor, but anchor ship-decisions to Rank-1 when stakes are high.

### Rank 3 (necessary scaffolding, not sufficient alone) — Reference-grounded RAG decomposition (context-recall / faithfulness / answer-relevance / context-utility)
**Idea:** import the RAGAS/ARES/RAGChecker metric set, but add a **context-utility / necessity** axis.

**SOTA evidence:** RAGAS (reference-free faithfulness/answer-relevance/context-relevance), ARES (PPI-calibrated fine-tuned judges, +human anchors, beats RAGAS on Kendall-τ), **RAGChecker (claim-level entailment, retriever/generator decomposition)**, CoFE-RAG, and the 2026 survey *Deepchecks: Evaluating RAG (2605.14488)*. The 2026 practitioner refinement that matters for us: **context recall + context utility must be on the dashboard, not just faithfulness** (FutureAGI's worked example: 0.91 faithfulness hid a 0.62 context-recall multi-hop regression). **CARE / Context-Aware Retriever Evaluation (2604.18234, Apr 2026)** extends LLM-judge retriever scoring to multi-hop where chunks are only useful in combination.

**Trade-offs:** + standard, well-tooled, decomposable; + "answer-relevance" and "context-utility" are the named axes we're missing. − these are *generic-QA* metrics; "answer relevance" ≠ "usefulness for editing code"; − faithfulness/context-recall reward retrieving-the-right-text, i.e. the same recall axis we already have. Use these as **component diagnostics** under Rank-2, not as the headline usefulness number.

### Rank 4 (reject as a primary signal) — Pairwise win-rate of "rich vs terse" answers by an LLM judge
**Why rejected:** pairwise A-vs-B preference is exactly where verbosity/length bias is most documented and where our long ss-* answers would get an unearned tailwind. If used at all, it MUST be **length-controlled** (Dubois et al. 2024, LC-AlpacaEval, COLM 2024 — regression that conditions on equal length; raises Chatbot-Arena correlation to 0.98) — and even LC-AlpacaEval needed *regularization* because the naïve correction was itself gameable (truncation attack pushed win-rate 3.7→25.9). Net: too fragile for a ship metric; the analytic binary rubric (Rank 2) is strictly safer.

---

## 4. Concrete, implementable design for our harness

Two deliverables, sequenced. Both live behind the existing injectable `evaluateCandidate` seam and reuse `judge-runner.js` (the disjoint panel) + `eas.mjs`/`gepa-scoring.mjs` (scoring), so they drop into `core/prompt-optimization/sweep/gepa-evaluate.mjs` without touching production search code.

### 4.A — The intrinsic USEFULNESS rubric (interim + permanent monitor)

**Principle: two independent vectors, never collapsed.** Mirror the precedent already in this repo (`relaxed-grading.mjs` reports `relaxed_def_recall@1` *alongside* strict `symbol_recall@1`; the policy memo `project_gold_rubric_under_credits_correct_behavior` already mandates "score strict + secondaries, never strict alone"). We report:

- `correctness` (UNCHANGED) — the current recall/fact floor from `JUDGE_SYSTEM_PROMPT`. This stays the gate.
- `usefulness` (NEW) — an analytic vector, only meaningful when `correctness ≥ θ_floor`.

**The rubric (analytic, binary criteria, evidence-anchored — per Autorubric + Rulers):** the judge sees the query, the gold expectations, **and the full agent answer**, and must, for each criterion, **first quote the verbatim span of the answer that satisfies it, then emit 0/1** (Rulers' evidence-anchoring; if it can't quote a span, the criterion is 0 — this kills "claim-without-substance" padding):

1. **`workable_code` (binary):** does the answer include the *actual code* (a runnable/edit-ready snippet or chunk) needed to act, not merely a `path:line` pointer or a name? *(This is the precise sweet-search edge; recall-only grading is blind to it.)*
2. **`control_flow` (binary):** does it explain *how* the relevant code is reached/used (caller/callee, the relevant branch, the relation), sufficient to understand the change site?
3. **`edit_locality` (binary):** does it identify the specific site(s) where an edit would go (function/region), not just the file?
4. **`completeness_no_gap` (binary):** could a competent engineer act on this answer *without another retrieval round*? (Penalises under-answering; it is the counterweight to criterion 5 so the rubric is not monotone in length.)
5. **`no_padding` (binary, anti-verbosity):** is the answer free of irrelevant/unsupported/duplicated content? Explicitly: *"Do NOT reward length, lists, hedging, or citation count; a longer answer is NOT better; dock this criterion if the answer pads, repeats, or includes content not needed for the task."* (Per "Judging the Judges": this halves verbosity/style bias; combined with evidence-anchoring it's the strongest cheap control.)

`usefulness = mean of the 5 binary criteria` (median across the 3-judge panel per criterion, then mean — matches the existing `judgePanelScore` median-of-panel pattern). Binary criteria (not Likert) are deliberate: Hamel-Husain-style binary verdicts are *harder to game with verbosity* than 1–10 scales, and QWK/agreement is more stable.

**Anti-gaming / anti-verbosity controls (all from the 2026 literature, layered — bias is reduced ~by half per layer, never fully, so stack them):**
- **L1 — evidence-anchoring (Rulers):** every positive criterion requires a quoted span. Structural; the most effective single control for code.
- **L2 — explicit anti-length instruction (criterion 5 + a global "score on content, not length/format" line):** halves verbosity AND style bias ("Judging the Judges").
- **L3 — disjoint-family panel + median (already in place):** deepseek-v4-flash + gemini-3.1-flash-lite + abab6.5s-chat are three families → family-specific verbosity/self-preference biases partially cancel; median is robust to one outlier (your `JUDGE_PANEL` + `judgePanelScore` already do this — keep it).
- **L4 — length as a reported COVARIATE, not a reward:** log `answer_tokens` per row and **report usefulness conditioned on / regressed against length** at analysis time (Dubois LC-style; "Beyond Resolution Rates" 2604.02547 stresses *controlling for confounds before length claims*). If the usefulness gap between arms *shrinks to ~0 once length is matched*, it was verbosity — do not ship. This is the decisive audit and it directly answers "are we just rewarding longer answers."
- **L5 — locked rubric bundle (Rulers):** the rubric string + criteria are versioned/hashed (reuse `hashContent`) and frozen per run; rubric edits force a new run-id. Prevents rubric-drift p-hacking.

**Reproducibility & stats (house principles, enforced):** stratified dev/held-out split with the existing seed=42 discipline; **per-criterion** report so reviewers (Codex) can see *which* axis moved; CIs via the existing paired bootstrap (`scripts/vault-stats.mjs`), significant only if CI excludes 0; pre-commit the panel + rubric hash + N; cache-aware cost on the judge calls (already normalized in `normalizeJudgeUsage`). Calibrate once against a small hand-labelled set (20–30 answers, both arms) and **report panel-vs-human Cohen's κ / QWK; require κ ≥ 0.6** before trusting the vector for any decision (the 2026 production bar; LangChain/FutureAGI/SWE-PRBench all converge on it). Run a **length-truncation probe** (a few high-usefulness answers mechanically truncated to ~40%, expected to lose `completeness`/`workable_code`) and a **padding probe** (a correct terse answer with appended irrelevant boilerplate, expected to lose `no_padding`) as standing reliability tests — directly lifted from the "Judging the Judges" controlled-pair methodology.

**Why this isn't just "reward verbosity":** criteria 1–4 reward *content an engineer needs*; criterion 5 + L1/L2/L4 actively punish length-without-substance; and SWE-ContextBench's empirical result (compact-correct > verbose) means a well-built rubric that tracks usefulness should, if anything, *favour* compact targeted answers. If our re-judge shows ss-* winning on usefulness *and* the L4 length-controlled check holds, that is a credible, reviewer-defensible result.

**Integration sketch (`gepa-evaluate.mjs`):** add `JUDGE_USEFULNESS_SYSTEM_PROMPT` + `buildUsefulnessJudgePrompt({probe, answer})` (answer already available as `finalText`), a `usefulnessPanelScore()` cloned from `judgePanelScore` but returning per-criterion vectors, and extend the returned object with `usefulness`, `usefulnessByCriterion`, `answerTokens`. **Do NOT route it into `finalScore`** (which is `taskScore·ef − lengthPenalty`, and whose `lengthPenalty` penalises the *system-prompt* token count, not the answer — so usefulness must stay a parallel reported axis, not be fused into the GEPA objective unless/until validated). Keep GEPA optimizing the existing objective; surface usefulness as a **reported diagnostic** first; promote it to the objective only with held-out evidence (same discipline the repo used for format-gated signals).

### 4.B — The extrinsic USEFULNESS LIFT (the rigorous signal; lands in the task-completion bench)

This is the Rank-1 design and the natural home is `eval/task-completion-bench/`. It reuses that plan's machinery (isolated checkout, off-clock index, host-grade, escape audit) but adds an **"answer-fed-solver" sub-task** so usefulness is measured as a *downstream effect*, fully decoupled from the agent that produced the answer.

**Protocol (per probe, paired across NATIVE vs SWEET arms, same seed/task/solver):**
1. **Retrieval phase (the thing under test):** run the agent (M++/sweet vs native) on the probe; capture its **final answer text** (and optionally the retrieved chunks). This is the artifact whose usefulness we grade.
2. **Decouple:** discard the agent's trajectory. The *only* thing carried forward is the answer text.
3. **Solver phase (frozen, identical for both arms):** a fixed cheap solver (DeepSeek-V4, temp per `project_deepseek_max_tokens_reasoning`) is given **the original task + the agent's answer as its ONLY context** (NO repo access, or repo access ablated per regime) and must produce a patch / answer to a **downstream sub-task** that is *known to depend on the retrieved content* (DeR2 two-phase gate: unsolvable with no context, solvable with oracle context).
4. **Grade deterministically:** sub-task success = hidden unit test passes (F2P∧P2P) for an edit sub-task, or an exact/verifiable check for a QA sub-task. `usefulness_lift = P(solver succeeds | this answer) − P(solver succeeds | no-context baseline)`, paired.

**Why this is the least-gameable design (and symmetric):**
- It is **execution-grounded** — verbosity, style, and self-preference have no purchase; only "did the answer let the solver succeed" counts (CodeRAG-Bench / SWE-ContextBench philosophy).
- It is **symmetric to both arms**: native's terse `file:line:match` answer can win if those lines are exactly what the solver needs; sweet-search's chunk wins only if the extra context *actually* helps the solver. This is the fair test of our core hypothesis — and it can *disconfirm* it (H0), which is what makes it credible.
- It **directly instantiates the No-Context / answer-as-context / Oracle ablation** from SWE-ContextBench, so we can report sweet-vs-native *and* answer-vs-oracle on the same axis.
- It **predicts task completion by construction** — the LIFT *is* a task-completion delta on a controlled sub-task, so it's the bridge between P7 (single-shot) and the resolve-rate thesis (H1: per-exploration usefulness compounds).

**Statistics:** paired McNemar / clustered bootstrap by repo (already specified in `TASK_COMPLETION_BENCH_PLAN.md` §7); ≥3 solver reps (solver is stochastic); pre-committed N from a power calc on pilot-observed discordance; report pass@1 and pass^k; **pre-register** the sub-task set + solver + seeds (frozen, git-tagged) before the powered run; **never inspect held-out per-probe**. Pilot is plumbing-only (Python, escape=0), per that plan.

**Practical catch (call it out):** our vault runners currently **store scores, not answer text** (`evaluateCandidate` returns `trajectory.answer` truncated to 2000 chars but the persisted rows keep scores). The extrinsic LIFT — and even the cheap re-judge experiment in §5 — **requires capturing full answer text**. This is a small runner change (persist `finalText`), not a re-architecture.

---

## 5. Cheap next experiment — test whether our *existing* results under-credit sweet-search

**Goal:** a low-cost, decision-quality check of the central suspicion *before* building the extrinsic harness. **Dual-rubric re-judge: report `correctness` (unchanged floor) and `usefulness` (§4.A) on the SAME answers for both arms, then run the length-controlled audit.**

**Steps:**
1. **Re-run the existing 60-probe vault on both arms (NATIVE rg+read vs SWEET/M++), capturing FULL answer text.** Reuse `claude-runner.js` / `p7-codex-runner.mjs` exactly as the P7 validation did — same models, same probes, seed=42. This is the only new compute (≈ one M++-vs-native vault pass on the two targets; route the *judging* through the cheap disjoint panel, not Claude Max — per `feedback_claude_max_budget`). Capturing answer text is the one required runner change (see §4.B catch).
2. **Judge each answer twice** with the existing 3-panel: once with the current `JUDGE_SYSTEM_PROMPT` (correctness floor) and once with the new evidence-anchored usefulness rubric. Log `answer_tokens` per answer.
3. **Report three things, paired, with bootstrap CIs:** (a) `Δcorrectness` (sweet−native) — expected ≈0, replicating "near-parity accuracy"; (b) `Δusefulness` and **per-criterion** Δ (expect `workable_code`, `control_flow`, `edit_locality` to favour sweet); (c) the **length-controlled audit (L4)**: regress usefulness on `answer_tokens` and report the *length-matched* `Δusefulness`.
4. **Decision rule (pre-committed):** sweet-search is genuinely under-credited **iff** `Δcorrectness` CI includes 0 (parity holds) AND `Δusefulness` CI excludes 0 in sweet's favour AND that gap **survives length-control** (does not collapse to ~0 when length is matched). If the usefulness gap vanishes under length-control, the richness was verbosity → the current rubric was *right* to ignore it, and we drop the claim (this is the honest, reviewer-proof outcome either way).

**Cost/scope:** one vault pass × 2 targets + ~2× cheap-panel judge calls per answer + a hand-labelled κ-calibration on 20–30 answers. No frontier-judge spend; no solver harness. It directly produces the number the user wants ("are our results under-crediting sweet-search?") with a built-in gaming check, and the rubric it validates is the same one that becomes the permanent online monitor and the interim proxy for the extrinsic LIFT.

---

## 6. Key citations (dated; one-line relevance + honest evidence strength)

**Extrinsic / task-grounded context-utility (the recommended core — strong, execution-grounded):**
- **CodeRAG-Bench — Can Retrieval Augment Code Generation?** `2406.14497` (NAACL Findings 2025). *Canonical code-RAG extrinsic bench: fixed generator, varied context, execution metrics (pass@1, SWE-bench resolve); +27.4% SWE-Bench with canonical docs; non-monotone per model.* **Strength: high.** *Flag: ~12 mo old; not superseded.*
- **SWE-ContextBench** `2602.08316` (Feb 2026). *No-Context/Free/Oracle agentic SWE ablation; Oracle compact summary +8pp resolve, Free retrieval ≈0/net-negative, compact > full. The clearest "usefulness is conditional + compact-wins" evidence.* **Strength: high.**
- **DeR2 / Retrieval-Infused Reasoning Sandbox** `2601.21937` (Jan 2026). *Decouples retrieval-loss vs reasoning-loss; mode-switch fragility (worse with Full-set); two-phase oracle-solvable gate. Best argument that more context ≠ more useful and the controller's utilization must be isolated.* **Strength: high (controlled), domain = science not code.**
- **Beyond Resolution Rates: Behavioral Drivers of Coding Agent Success** `2604.02547` (2026). *Process/mediator metrics (steps-to-first-edit ρ=+0.68, patch-fail-spiral ρ=−0.78), action+environment encoding, "control for confounds before length claims." Anchors the mediator metrics + the length-control discipline.* **Strength: high.**
- **Are "Solved Issues" in SWE-bench Really Solved?** `2503.15223` (ICSE 2026). *29.6% suspicious patches; resolve drops 6.4–17.3pp under stronger tests. The weak-test / over-credit caveat for any execution metric.* **Strength: high.**
- **METR — Many SWE-bench-Passing PRs Would Not Be Merged** (metr.org, 2026-03). *Maintainer review of 296 AI PRs; test-pass ≠ mergeable. Human evidence that resolve-rate under-measures usefulness.* **Strength: medium-high (human, small N).**

**LLM-as-judge multi-dim rubrics + reliability (the interim instrument — mature, human-validated, bias-prone):**
- **Autorubric: Unifying Rubric-based LLM Evaluation** `2603.00077` (Feb 2026). *Analytic binary/ordinal/nominal criteria + ensemble + few-shot calibration + bias mitigations + psychometric reliability. Reference spec for our rubric.* **Strength: high.**
- **Rulers: Locked Rubrics and Evidence-Anchored Scoring** `2601.08654` (Jan 2026). *Three failure modes (instability/unverifiable/misalignment); immutable rubric bundles + evidence-span-before-score + calibration; stable under adversarial perturbation. The anti-gaming backbone of §4.A.* **Strength: high.**
- **Judging the Judges: Systematic Bias-Mitigation in LLM-Judge Pipelines** `2604.23178` (TMLR 2026). *Style bias dominant (0.76–0.92) ≫ position bias; verbosity nuanced; controlled LENGTH-truncation pairs; n=400 MDE≈4–5pp, McNemar. The bias-control + reliability-probe methodology.* **Strength: high.**
- **Length-Controlled AlpacaEval** `2404.04475` (COLM 2024). *Regression-based length debiasing; corr-to-Arena 0.98; truncation attack 3.7→25.9 ⇒ needs regularization. The canonical verbosity control + its own gameability lesson.* **Strength: high.** *Flag: ~24 mo old; still standard.*
- **Bias in the Loop: Auditing LLM-as-a-Judge for SE** `2604.16790` (Apr 2026). *Code-specific judge audit: repeated evals disagree, semantics-preserving perturbations swing verdicts. Why a code judge needs determinism + perturbation tests.* **Strength: medium-high.**
- **CodeVisionary** (ASE 2025) & **SWE-PRBench** `2603.26130` (2026). *Agent/rubric code judges that reach human agreement (CodeVisionary +0.14–0.22 corr; SWE-PRBench κ=0.75 / 0.616 cross-check). Evidence a code usefulness rubric CAN hit κ>0.6.* **Strength: medium-high.**
- **Reward Hacking in the Era of Large Models** `2604.13602` (Apr 2026). *Survey naming verbosity bias / sycophancy / benchmark-overfit as reward-hacking. Frames "don't reward verbosity" as anti-reward-hacking.* **Strength: medium (survey).**
- Foundational judge biases (older, still cited): MT-Bench/Zheng 2023 (position/verbosity/self-enhancement), Saito 2023 (verbosity), Panickssery 2024 (self-preference), FLASK/Prometheus-2 (fine-grained > holistic). **Use as background.**

**RAG-eval decomposition (component diagnostics — standard but generic-QA):**
- **RAGAS** `2309.15217` (2023) — reference-free faithfulness/answer-relevance/context-relevance. **ARES** `2311.09476` (NAACL 2024) — PPI-calibrated fine-tuned judges + human anchors; beats RAGAS on Kendall-τ. **RAGChecker / CoFE-RAG** — claim-level entailment, retriever/generator decomposition. **Deepchecks: Evaluating RAG** `2605.14488` (2026, survey). **CARE** `2604.18234` (Apr 2026) — multi-hop context-aware retriever eval. *"Context utility/recall must be on the dashboard, not just faithfulness" (FutureAGI 2026 worked example).* **Strength: high as tooling; relevance medium (generic QA, not code-edit).**
- **Is Summary Useful or Not? Extrinsic Human Eval on Downstream Tasks** `2305.15044` (2023). *Pre-LLM precedent that intrinsic quality ≠ extrinsic usefulness, task-dependent. The conceptual root of "grade by downstream use."* **Strength: medium (older, but on-point).**

**Repo-level code understanding context (domain framing):**
- **SWE-QA: Repository-level Code Questions** (2025, 576 QA pairs, intention/cross-file/multi-hop). **Codebase-Memory** (2026, "83% answer-quality vs 92% file-explorer at 10× fewer tokens" — a near-identical tool to sweet-search, judged on an LLM "answer quality" metric — a useful comparator and a caution that *its* metric is exactly the recall-shaped one we're trying to improve on). **Strength: medium (framing/comparators).**

**Honest disagreements / caveats in the literature:**
- **Intrinsic vs extrinsic don't always agree** (Is-Summary-Useful 2305.15044): intrinsic metrics correlated with extrinsic usefulness on some downstream tasks but not others — so the intrinsic rubric (§4.A) is a *proxy*, and the extrinsic LIFT (§4.B) is the arbiter when they diverge.
- **Execution metrics over-credit** (2503.15223) while **resolve-rate under-credits real usefulness** (METR) — both point the same way: ground usefulness in an *effect with a verifiable property*, and report multiple axes, never one number.
- **Bias controls are partial, not total** ("Judging the Judges": rubric instructions ~halve verbosity/style bias; embedding-level self-preference resists prompting) — hence the layered L1–L5 stack and the mandatory length-controlled audit, rather than trusting any single control.

---

## 7. One-line summary for the team

Keep recall as a **floor**, add usefulness as a **lift**; measure the lift *extrinsically* (answer→frozen-solver→hidden-test) as the rigorous signal and via an *evidence-anchored, length-controlled binary rubric reported as a separate vector* as the cheap interim/monitor; the immediate experiment is a **dual-rubric re-judge of the existing vault (both arms, full answer text) with a length-controlled audit** — sweet-search is only "under-credited" if parity-on-correctness holds, usefulness favours sweet, and that gap survives length-matching.
