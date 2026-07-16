# NOVEL_BENCH_PLAN — the three benches that close the paper's causal chain

**Status:** plan pre-registered 2026-07-16, before any of the three benches ran.
**Context.** The paper already has four bench families (README §Benchmarks):
① agent-in-the-loop code-retrieval (Phase 7: 11 model×harness cells, usefulness
composite, FDR-controlled), ② task-completion (held-out 200 frozen, prereg in
`eval/task-completion-bench/select/HELDOUT_PREREGISTRATION.md`), ③ paper-type IR
(GCSN 86.6 / CoSQA 65.5 / M2CRB 54.0 / AdvTest 51.4 — to be re-run on the current
engine before publication), ④ engine speed. The gap a reviewer will name: ③ and ②
measure **different query populations**, so "retrieval is good AND tasks got cheaper"
is juxtaposition, not a link. These three benches turn it into a measured chain:

> public IR → **(A)** retrieval quality on real agent queries → **(B)** controlled
> degradation of that quality → effect on task cost/solve → **(C)** positioning
> against a real competitor tool.

Shared rules for all three: pre-registered here before running; dev-derived data
only where marked DEV; held-out trajectories are NEVER per-task inspected
([[heldout-discipline]]); every LLM-judge call captures USD; negative results
publish alongside positive ones.

---

## A. Trajectory-Replay Retrieval (TRR) — *the bridge* — DO FIRST

**Claim it supports:** sweet-search's IR advantage holds on the query distribution
real agents emit mid-task (which is NOT GCSN-shaped — the format-gating regressions
proved the two distributions behave differently).

**Why it's quick:** zero new agent rollouts. Inputs already exist:
dev-200 task-bench trajectories (sweet-arm rollouts log every `ss-*` call with its
query + the index state via golden cache), and the Phase 7 judging stack
(3-judge panel, paired bootstrap, BH-FDR) is built and validated.

**Method.**
1. **Harvest (DEV trajectories only):** parse dev-200 sweet-arm rollouts; extract
   every `ss-search` / `ss-find` / `ss-grep` query with `{task_id, repo,
   base_commit, turn_index, tool, query, regex?}`. Keep the golden cache key so
   replay hits the exact index state the agent saw.
2. **Dedup & sample:** exact-dedup, then near-dedup (existing SimHash/MinHash
   infra); stratify the judging sample by tool type × language × turn position
   (early=explore vs late=verify), target ~1,500–2,500 judged queries.
3. **Pooled relevance judgments:** for each query, pool top-10 candidates from
   each system variant (sweet full pipeline; BM25/lexical-only; bi-encoder-only;
   competitor from bench C when available) against the same golden index corpus.
   Judge pooled candidates blind-to-system with the Phase 7 3-judge panel
   (graded relevance 0–3); metric-forge protocol for judge validation
   (agreement, adversarial probes) applies.
4. **Metrics:** nDCG@10 / MRR@10 per system on the pooled judgments; plus
   sufficiency-trailer calibration (P(sufficient=YES ∧ top-1 relevant)).
5. **The link (mediation):** per-task mean retrieval quality (sweet arm) vs that
   task's paired outcome (idealCost delta, solve flip). Report Spearman + a
   simple mediation decomposition. DEV only — this is mechanism, not headline.

**Stats:** query-level paired bootstrap (cluster by task — queries within a task
are correlated), BH-FDR across the metric family. Splits: judge-set drawn 60/40
dev/held-out-style within DEV trajectories per the standing methodology.
**Effort:** ~2–3 days (harvester ~1 day; judging run ~1 day, flash-tier judges,
est. low tens of $). **Artifact:** `eval/trr/` with frozen query set + judgments
(reusable by B and C).

## B. Dose-Response Ablation (DRA) — *correlation → causation*

**Claim it supports:** task-level gains are CAUSED by retrieval quality — degrade
retrieval in controlled steps and cost/solve degrade monotonically.

**Method.**
1. **Degradation knobs** (env-gated in the ss tool dispatch layer, e.g.
   `SS_ABLATE=`): `shuffle3` (random permutation of top-3), `shuffle10`,
   `norerank` (late-interaction rerank off), `notrailer` (sufficiency trailer
   stripped). Knobs live in the eval shim layer, NOT the product engine; product
   ships untouched ([[keep-search-modes]]).
2. **Arms:** stock sweet + 3 degradation levels (shuffle3 → shuffle10 →
   norerank+shuffle10), paired on the same tasks. Control arm already exists
   from prior dev runs.
3. **Population:** 60-task stratified seeded subset of DEV-200 (never held-out
   — this is mechanism). One backbone (mimo). ≈240 rollouts total.
4. **Metrics:** solve rate, cache-normalized idealCost, tool calls, and TRR-style
   retrieval quality of each arm's queries (from A's judge pool) — giving the
   x-axis (measured retrieval quality) and y-axis (task outcome) of the
   dose-response curve.
5. **Pre-registered prediction:** monotone degradation (test: Jonckheere–Terpstra
   / Page trend, α=.05). If NON-monotone, publish that too — it bounds how much
   retrieval quality matters vs prompt discipline.

**Gotchas:** each `SS_ABLATE` value is a new config fingerprint → each arm needs
its own env-ledger sweep before counting ([[green-ledger]]). Verify the knob
bites via a 3-task smoke with logged rank orders before the batch.
**Effort:** ~1–2 days code + smoke; rollout cost ≈ 1.2× one dev-200 single-arm run.

## C. Competitor Third Arm (CTA) — *positioning, subset only*

**Claim it supports:** the gains are vs the best available alternative, not just
vs raw grep — answers "why not just use tool X?"

**Method.**
1. **Competitor selection (pre-registered rule, not vibes):** from the verified
   competitor table ([[competitor-facts]], re-verify first), pick the ONE tool
   that (a) claims semantic/agentic code search, (b) has the largest adoption,
   (c) integrates as MCP/CLI into the same harness. Pin its version + config;
   use vendor-recommended defaults and prompt; disclose everything. (Candidates
   as of the table: embedding-RAG MCP à la claude-context/Zilliz, or LSP-agent
   à la Serena — decide by rule (a)–(c) at kickoff, then freeze.)
2. **Population:** 60-task seeded, language-stratified subset of the HELD-OUT 200
   (subset rule: proportional to held-out quotas, seed 20260716, frozen before
   any held-out outcomes exist). Competitor arm runs on the same task workspaces
   and preflight gates as the other two arms.
3. **Fairness protocol:** competitor index prebuilt in the prep phase exactly as
   sweet's golden is (index build time excluded for BOTH; disclosed); same
   network lockdown; same turn/budget caps; if the competitor needs network
   (cloud embeddings), that's a disclosed protocol difference, not a
   disqualifier.
4. **Arms & analysis:** 3-way paired on the subset (control / sweet / competitor),
   one backbone (Sonnet 5 or mimo — freeze at kickoff). Same metrics + stats as
   the main bench. Report sweet-vs-competitor AND competitor-vs-control.
5. **Honesty rule:** if the competitor beats us on any metric, it publishes.
   Selection rule (a)–(c) exists precisely so we can't be accused of picking a
   weak opponent.

**Effort:** ~2–4 days wiring (MCP integration, competitor prep-warm, ledger
sweep) + 120 rollouts (subset × 2 new-ish arms; control pairs reuse the main run
where task overlap allows).

---

## Order & dependencies

1. **A first** — no rollouts, unblocks B's x-axis and C's judge pool; its query
   set freezes before B/C run.
2. **B second** — needs A's judging pool + the ablate shim; dev-only.
3. **C third** — heaviest wiring; its held-out subset must be frozen before the
   main held-out runs start (so the 60 tasks' 3rd arm runs alongside, not after,
   avoiding any re-run-after-peeking accusation).

Paper figure this buys: one panel per link — (③ public IR) → (A: agentic-query
IR) → (B: dose-response curve) → (②: held-out efficiency-at-parity) → (C:
competitor bar). That chain, FDR-controlled end to end, is the novelty claim
stated so it survives review.
