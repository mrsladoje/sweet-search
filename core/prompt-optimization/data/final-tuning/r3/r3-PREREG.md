# r3 — new code-retrieval benchmark: pre-registration

Written 2026-10-01 ~02:00, **before any scored agent run on r3**. Frozen file:
`r3/r3-probes.json`, **sha256 ba49df55e86087c113bb44676c909c3fe85c0b83a314d25e3e405e73311fc10a**
(`r3/MANIFEST.json` holds the id lists). Any change to the probes after this point creates a new
version and is disclosed.

## Construction (summary)

- 6 fresh public repos never used in development, r282 or the task bench (`r3/REPOS.md`):
  jj (Rust, 271k LOC), dgraph (Go, 265k), tortoise-orm (Python), typedoc (TypeScript),
  zipkin (Java), ocelot (C#). Pinned SHAs in `r3/repos.json`.
- 216 drafts (36 per repo; brief `r3/DRAFTING-BRIEF.md`) by Sonnet agents that read the code with
  plain tools (no sweet-search tools). Mix per repo: multi-hop 9, concept 8, enforcement 8,
  locate-explain 5, negative 6. Hard by human judgement, never sampled from product failures.
- Verification (`r3/verify-drafts.mjs`): two non-Claude models (gemini-3.8-flash; glm-5.3 for
  ocelot/jj and part of dgraph, deepseek-v4-pro for the rest) answered each positive question from
  the gold files and judged each gold fact. Kept only when both agreed (105/180 positives).
- Audit (`r3/AUDIT-BRIEF.md`): two Opus agents reviewed kept + negative + "rescue" questions (one
  verifier agreed); fixed 48 facts/queries, dropped 2. Final: **163** questions.
- Split: stratified by (repo, stratum), seed 42 → **held-out 103**, **dev 60** (dev-train 36,
  dev-validation 24).

## Cells and arms

Same runner as r282 (`scripts/retrieval-bench-282.mjs --probes r3/r3-probes.json`), same FRAME,
same product harness per cell, APFS clones per run, stable rules path (`SS_BENCH_STABLE_RULES_PATH=1`),
`SWEET_SEARCH_MAX_DAEMONS=8`, USD panel off (`SS_BENCH_NO_USD=1`), concurrency 3.
- Cells: codex-sol61-high, cc-opus55-medium (mandatory), cc-sonnet55-high and oc-sol61-high if the
  subscription allows. DeepSeek cell only if re-established on OpenRouter with its own baselines.
- Arms: native (stock harness), sweet 2.8.2 (all switches off), sweet champion (switches on).
- Codex / opencode: sweet vs champion **interleaved** in one run (`--interleave`); Claude Code: A-B-A
  or sequential with a fresh baseline in the same session window.

## Metrics

Primary (paired by question):
1. **Accuracy** — judge-panel median (deepseek-v4-flash via OpenRouter, gemini-3.1-flash-lite
   direct, MiniMax via OpenRouter), rows with < 3 judges re-scored.
2. **Cost** — tokens × list price, cache-aware, cache-write 1.25× basis (also reported at 2× for
   Claude Code: its 1h-TTL writes are billed 2×).
3. **Tool calls.**
Secondary: turns, file recall (share of `expectedFiles` basenames named in the answer), symbol recall
(share of `expectedSymbols` named), negative-question accuracy separately, wall time.

## Analysis

- Paired bootstrap stratified by stratum, B = 20000, seed 42, 95% percentile CI.
- Benjamini–Hochberg (q = 0.05) across cells × primary metrics of the final held-out comparison.
- **Held-out: aggregates only, run once at the end (Phase 7).** Dev: per-question reading allowed.
- Headroom check on dev before the held-out run: native accuracy target 60–85%; if ≥ 95% on dev,
  report that the set is too easy (do not edit the held-out questions).
- Grader consistency: re-score a dev sample of ≥ 40 rows a second time; report verdict flips.
- Escape audit: grep every trace for reads of the gold path (`final-tuning/r3/`) or of this repo;
  such a rollout is excluded and reported.

## Exclusions

Same as r282: a question counts only when both compared arms finished (exit 0, no runner error);
timeouts and errors reported per arm; account-level failures stop the cell.

## ADDENDUM — r3-hard (frozen 2026-10-01)

- **File:** `r3/r3-hard-probes.json`, sha256 `09b0ab9f9f8aabfeaf569a52e0acd810445617c1236c5967c2ec31953d70ea4d`;
  manifest `r3/MANIFEST-HARD.json`. The original r3 split is unchanged.
- **Source:** 6 r3 repos (group A, 24 drafted per repo) + 5 new repos in new languages
  (group B: okhttp Kotlin, sequel Ruby, composer PHP, drogon C++, grdb Swift; 14 drafted per repo).
  Pipeline: drafting (HARD-DRAFTING-BRIEF + ADDENDUM: cheapest route ≥ 4 dependent steps, no exposed
  constants) → 2-model fact flags → closed-book screen (2 non-Claude models, no code; drop if either names
  ≥ half the gold files AND symbols; negatives not screened) → Opus audit (HARD-AUDIT-BRIEF).
- **Counts:** 194 kept of 214 drafted (A 133 of 144, B 61 of 70); 20 dropped (the closed-book screen flagged 16, kept only if the auditor hardened them); 12 hardened.
  Strata: chain 52, completeness 42, cross-layer 31, decoy 28, condition 25, negative-decoy 16.
- **Split:** 50/50 stratified by repo × stratum, seed 42 → dev 97 (A 67, B 30), held-out 97 (A 66, B 31).
  Group A ≥ 2/3 of each half, so the result is not driven by the new languages.
- **Pilot:** 20 dev questions (seed 4242), native Claude Code + Opus 5.5 medium. Targets: 6–8 turns
  (median tool calls ≥ 6) and native accuracy 60–85%. If the pilot misses the target, report it; held-out
  questions are never edited.
- **Held-out:** aggregates only, run once at the end. Same metrics and analysis as above.
