# NOVEL_BENCH_PLAN v2 — the definitive randomized in-loop retrieval paper

**Changelog / audit trail.**
- v1 pre-registered 2026-07-16 (three benches A/B/C closing the causal chain);
  amended 2026-07-17 (citation-strategy + reviewer-hardening). Neither version's
  benches ever ran.
- **v2 supersedes v1 on 2026-07-22, still pre-run**, after two independent
  external reviews (GPT-5.6 "Sol", two rounds; Claude verification of every
  load-bearing claim). v1's A/B/C are reframed as Studies 1–3; the deadline
  optimization is dropped. Goal restated: build the paper people working on
  agentic code search are forced to cite — not the fastest publishable win.
- Nothing here is confirmatory pre-registration. The frozen, uneditable
  registration happens on **OSF before any confirmatory rollout** (see
  §Discipline). This file is the working protocol that feeds it.

## The paper's identity

Central contribution — NOT sweet-search:

> **A causal map of how repository retrieval changes adaptive coding-agent
> behavior, efficiency, and repair outcomes**, built on a community-grade
> benchmark of real intermediate search episodes and a randomized in-loop
> retrieval experiment.

Working title (safe, pre-results):
*"Causal Effects of Repository Retrieval on Coding Agents: A Randomized
In-Loop Study."*
If the DEV trade-off reproduces on untouched data:
*"When Better Search Makes Coding Agents Worse: A Randomized Study of
Retrieval Quality, Cost, and Repair Success."*

The paper stays important whether retrieval helps, hurts, plateaus, or varies
by model. sweet-search is the instrument, not the headline. Legacy GCSN-style
IR results, Phase-7 composites, and engine-speed numbers move to supporting
validation / appendix — no kitchen-sink system paper.

## What our own data actually says (DEV — motivates hypotheses, NEVER publishable)

Full-200 rebaseline 2026-07-13, corrected per
`analysis/failure-forensics-review-2026-07-14.md` §2.2:
- Resolution: native 65/166 vs sweet **58/166** (rust-minidump reclassified —
  parser artifact, not agent failure); discordants 9 vs 2, exact McNemar
  **p≈.065** — borderline, native-favored, underpowered at 12 discordants.
- Cost: both-solved idealCost sweet **−20.1%** (bootstrap CI [−0.266, −0.052]).
- Honest reading: **a cost–success trade-off, not "better retrieval → better
  outcomes."** This is the hypothesis generator for Studies 2–3 (especially the
  premature-commitment hypothesis). It becomes a paper conclusion ONLY if
  untouched confirmatory data reproduces it.

## Related work & the surviving novelty claim (verified 2026-07-22)

All entries below were independently verified to exist and say what we claim;
re-verify and extend in a **living related-work audit** (weekly sweep; full
systematic review immediately before submission — this space moves weekly).

- **ContextBench** (arXiv 2602.05892) — 1,136 tasks, 8 languages, human gold
  contexts; scores context *accumulated during* trajectories (recall/precision/
  efficiency). Public leaderboard.
- **SWE-Explore** (arXiv 2606.07297) — 848 issues, 203 repos; line-level ground
  truth distilled from solving trajectories; **includes a controlled
  restricted-context experiment** (each explorer's output fed to a fixed agent,
  repair measured). So we must NEVER claim "nobody has causally tested whether
  retrieval affects repair."
- **CORE-Bench** (arXiv 2606.11864) — 180K-query agentic code-retrieval
  benchmark from SWE-bench instances; curated queries, stops at nDCG.
- **ToolRet** (arXiv 2503.01763) — retrieval quality vs task pass rate for tool
  retrieval; observational.
- Adjacent, cite: SWE-bench-Live, "Saving SWE-Bench" (query mutation),
  Claw-SWE-Bench (harness+cost axes), SWE-Pruner (2601.16746), SWE-Pruner Pro
  (2607.18213), CodeScout (2603.17829).

**The narrowed, defensible novelty claim:**

> Randomized perturbation of retrieval results **inside a live, adaptive,
> multi-turn coding-agent trajectory** — while the agent is actively querying,
> reacting, reformulating, editing, and testing — with interface, result
> budget, formatting, and latency held constant.

SWE-Explore manipulates a fixed context-selection output *before* repair; we
manipulate search quality *while* the agent adapts. Distinct and real — but
"first" still requires the pre-submission systematic review to confirm.

Second claim: the benchmark's reusable unit. ContextBench scores accumulated
context; SWE-Explore's retrieval request is the issue. Ours is the **adaptive
intermediate search episode** — what agents actually ask *after seeing earlier
evidence*, with the exact index state they saw.

---

## Study 1 — Community-grade trajectory search-episode benchmark (infrastructure, not headline)

**Unit:** the intermediate search episode:
`{task, repo, commit, index state (golden cache key), turn position, preceding
agent context, tool + query (+regex), returned candidates, subsequent agent
actions}`.

**Composition requirements (citation-grade, not case-study-grade):**
- Episodes from **multiple host models (≥3 backbones)** and **multiple tool
  conditions**: sweet-arm `ss-*`, native `grep`/`rg` episodes from the same
  paired rollouts (free — already logged), and ≥1 independent external tool's
  episodes. Kills the endogeneity objection structurally, not by stratum
  footnote alone.
- Tool-semantics strata preserved: natural-language search, identifier lookup,
  regex, path lookup.
- Scale target: **thousands of trajectories, tens of thousands of episodes**;
  dev-200-derived episodes are the retrospective seed, new rollouts extend.
- **Repo-disjoint train/dev/test partitions** (split by repository/task, never
  by query). Plus a genuinely untouched external test set on fresh repos,
  collected AFTER the protocol freeze.
- **Honesty label:** dev-200-derived portions are *retrospective benchmark
  construction* (trajectories predate this plan). Stated plainly in the paper.

**Labels — two separate dimensions per judged episode:**
1. **Query relevance** — did the result answer the search intent? (graded 0–3)
2. **Trajectory utility** — was the result subsequently read, referenced,
   edited around, or otherwise used? (partially automatable from the logged
   subsequent actions; audited by hand)

**Judging protocol:**
- Judges see the issue + bounded prior-agent context (a bare query like
  "handler cache" is unjudgeable without it), still blind to system.
- **Presentation normalization:** every pooled candidate reduced to bare
  `(file, span, code text)` in one uniform template; trailers, rank markers,
  and tool-specific packaging stripped. Format must not leak system identity.
- **Human ground truth:** a substantial stratified subset double-annotated by
  two independent blinded human experts with adjudication; report
  inter-annotator agreement AND LLM-judge-vs-human error. The 3-judge LLM
  panel (Phase 7 stack, metric-forge validation) scales the rest, calibrated
  against the human subset. LLM-only qrels are NOT acceptable as sole ground
  truth for the flagship.
- Pooled top-10 per system per query; query-level paired bootstrap clustered
  by task; BH-FDR across the metric family (multiplicity control only — FDR
  does not make anything causal).

**Offline baselines (same protocol, broad):** strong lexical (BM25/rg),
current dense embedders, late-interaction, graph/LSP (Serena-class), hybrid,
and agentic-explorer baselines. This absorbs v1's "why not tool X" duty
cheaply and is what third parties will compare against.

**Release (the citation engine):**
- Neutral, memorable, non-sweet-branded name (tension with [[branding]]
  resolved in favor of adoption; decided at release).
- TREC-style qrels + JSONL/BEIR-style data + one-command evaluation container
  + cheap starter split.
- **Published baseline outputs** so a new retriever can be evaluated without
  rerunning agents.
- Code referenced as repo URL + immutable commit + coordinates wherever
  possible; avoid redistributing third-party source. **License/provenance
  manifest + dataset card** mandatory; drop or hash-reference spans from
  non-permissive repos.
- HuggingFace dataset card linking the paper; **Zenodo archive with concept
  DOI + version DOIs**; public baseline table accepting third-party
  submissions.

## Study 2 — Randomized in-loop retrieval experiment (the crown)

**Design: dose-response via presentation-invariant corruption.** Doses:
1. Clean ranking (stock).
2. Mild: top-1 replaced with a plausible same-repository distractor.
3. Moderate: several top results replaced with distractors.
4. Severe: strong same-repository distractor injection.

Every arm preserves: identical result count; closely matched token count and
formatting; **identical trailers/metadata**; matched latency; same retriever,
agent prompt, tool names, and affordances. `norerank` is EXCLUDED (impure —
changes computation and latency); `notrailer` moves to Study 3. Distractors
drawn same-repo so they're plausible, generation rule pre-registered.

**Randomization & inference:**
- Task-level **blocked randomization** (block on repo/language/difficulty);
  repo-clustered uncertainty.
- **Unit of causal inference = assigned dose (intent-to-treat)**, never
  measured retrieval quality — degraded agents emit new, treatment-dependent
  queries that no frozen qrel set covers.
- After ALL rollouts freeze: sample actual episodes from every arm,
  blind-judge under the Study 1 rubric. Yields (1) first-stage manipulation
  check (assigned corruption actually reduced relevance), (2) ITT effects,
  (3) descriptive mechanism linking measured quality to behavior. **No causal
  mediation analysis** unless its assumptions can genuinely be defended.

**Joint outcome analysis (the collider-safe package):**
- Solve-rate risk difference — unconditional, ITT.
- Cache-normalized idealCost ([[ideal-cache-cost]]) — unconditional, ITT.
- Prioritized paired outcome hierarchy: **resolution first, partial test
  progress (f2pFrac) second, cost third**.
- Cost-effectiveness / Pareto curves over assumed dollar values of a
  successful repair.
- Cost among both-solved pairs ONLY as clearly-labeled descriptive robustness
  — conditioning on post-treatment solve status is a collider, never a causal
  estimand.
- Dose trend: Jonckheere–Terpstra / Page on the primary ITT outcomes;
  non-monotone results publish with equal prominence.

**Power — no arbitrary n:** DEV data is used ONLY to estimate nuisance
parameters and variance. Then a formal power calculation sizes an untouched
confirmatory population. If a meaningful solve-rate effect needs 500–1,000
tasks, that is the price of the definitive paper (SWE-rebench V1+V2 pool +
held-out reserve exist; budget accordingly). Multiple stochastic replicates on
a powered subset. **≥3 materially different backbones**; report heterogeneity
by model, language, difficulty, and query phase.

**Operational gotchas (carried from v1):** corruption shim lives in the eval
dispatch layer (`SS_ABLATE`-style env gate), product engine untouched
([[keep-search-modes]]). Each shim value is a new config fingerprint → own
env-ledger sweep before counting ([[green-ledger]]). 3-task smoke with logged
rank orders + read-tracking must verify each dose actually changes what the
agent READS before any batch. Never two concurrent run-pilots
([[dubious-ownership-bug]]).

## Study 3 — Retrieval interface and stopping behavior

Tests the deeper hypothesis the DEV trade-off suggests:

> Good retrieval may reduce exploration cost while inducing **premature
> commitment or misplaced confidence**.

**Arms (same ranking throughout — interface only):**
- Sufficiency trailer present vs absent.
- Packaged spans vs normalized bare spans.
- Calibrated vs deliberately miscalibrated confidence/sufficiency signal.

**Behavioral outcome battery:** time to first relevant file; time to first
edit; unique files/symbols inspected; query reformulation count; repeated
reads and search loops; context tokens consumed; breadth before first edit;
tests executed; premature stopping; final resolution and cost.

If relevance (Study 2), packaging, and confidence signals affect agents
through different pathways, that finding alone outranks "hybrid search beats
grep." Plugs directly into the existing sufficiency-trailer calibration work
([[sufficiency-verdict]]).

## External systems (formerly bench C — narrowed)

Broad offline comparison lives in Study 1's baselines. In-loop competitor
arms: **≥2 serious external systems** — one genuinely semantic local system +
one symbolic/local-navigation system (Serena is LSP/symbol, no embeddings —
it is NOT the nearest semantic competitor; README §competitor table) — or
narrow the claim to "best eligible fully local alternative." Selection rule
retained and pre-registered: (a) claims semantic/agentic code search,
(b) largest adoption, (c) MCP/CLI integration into the same harness,
(d) **runs fully local under `--network none` + hosts-block** — rationale
stated up front: a lockdown-incompatible arm is not comparable, so cloud-RAG
tools are excluded BY RULE, not post-hoc. Fairness: competitor index prebuilt
in prep phase as sweet's golden is; build time excluded for all; same caps.
Power the comparison before spending held-out tasks. If a competitor beats us
on any metric, it publishes.

## Scale & discipline (the definitive-paper bar)

- ≥3 materially different backbone models; ≥2 task distributions, one fresh
  and repository-disjoint; multiple stochastic replicates on a powered subset.
- Human annotation + adjudication (Study 1); judge-vs-human error reported.
- Task-level blocked randomization; repo-clustered uncertainty everywhere.
- **External pre-registration (OSF, frozen and uneditable) before any
  confirmatory execution** — one registration per study; DEV pilots may run
  first but confirmatory populations stay untouched until registration.
- Held-out discipline unchanged ([[heldout-discipline]]); USD captured every
  run ([[usd-capture]]); green-ledger invariant on every arm.
- Full negative and heterogeneous results publish, by model, language,
  difficulty, and query phase.
- Living related-work audit: weekly sweep + systematic review at submission.

## Venue

No deadline-chasing — quality gates the timeline, not the reverse.
- **FSE 2027** (full-paper deadline Fri **2026-10-02**, verified): target ONLY
  if confirmatory results are complete ~1 month prior with zero scope cuts.
- Otherwise **NeurIPS 2027 Evaluations & Datasets** (track renamed from
  Datasets & Benchmarks; 2026 cycle closed May 6–7, verified). E&D requires
  accessible code/data at submission — Study 1's release plan satisfies this.
- Slipping a cycle beats publishing the weak version.

## Order & dependencies

1. **Freeze this protocol → OSF registrations** (Study 1 rubric + Study 2
   design/power plan + Study 3 arms). Everything confirmatory waits on this.
2. **Study 1 retrospective seed:** harvester over dev-200 sweet+native
   episodes; judging pipeline (normalization, human subset, panel
   calibration); repo-disjoint splits. Feeds Study 2's variance estimates and
   distractor pools.
3. **Study 2 pilot (DEV only):** corruption shim + dose smoke + read-tracking
   verification → nuisance/variance estimation → formal power calc → sized,
   OSF-registered confirmatory run on untouched population, ≥3 backbones.
4. **Study 3** alongside/after Study 2 (shares shim + harness + judging
   infra).
5. **Study 1 scale-out** (new rollouts, external-tool episodes, fresh-repo
   test set) proceeds in parallel with 2–3; benchmark release cut only after
   the fresh test set exists.
6. Systematic literature review → write → submit at whichever venue gate the
   results honestly clear.

Paper figure the chain buys: Study 1 (agentic-episode IR, humans + panel) →
Study 2 (ITT dose-response on solve/cost/behavior) → Study 3 (interface
pathways) → held-out task-completion confirmation. Each link measured, each
randomized where causality is claimed, everything released.
