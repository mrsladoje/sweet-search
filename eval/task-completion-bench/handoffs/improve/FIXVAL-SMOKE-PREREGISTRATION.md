# Fix-validation smoke — PRE-REGISTRATION

**Written and committed before launch.** Validates the index-coverage fix
(`36b802e`: Jam indexing + git-tracked `src/build` re-admission) and the `ss-*` wrapper
hygiene fixes, on the two tasks whose gold files were invisible on the fresh pool.

## 0. What this exists to confirm — and what would falsify it

On the fresh pool, `bfgroup__b2-113` and `bfgroup__b2-259` were dead in **every** sweet arm:
their gold fix files (`src/tools/stage.jam`, `src/build/property.jam`) were in no `ss-*`
result across all 18 sweet rollouts each, because `.jam` was unindexed and `src/build/` was
excluded. The fix indexes them. This run asks whether the model now **reaches** them, whether
reaching them **changes a solve**, and at **what cost** — with the shipped correctness fixes live.

**Falsifier:** if b2 sweet rollouts still return no `ss-*` hit on the gold file, the golden
ship or the code-sync failed and the run is void, not informative.

## 1. Setup (done before launch, all verified)

- **Code:** `36b802e` rsynced to `/root/sweet-search-private` (7 files; box was byte-identical
  to `HEAD~1` beforehand, so the sync adds only the fix).
- **Goldens:** `bfgroup__b2@371b47…` and `@7cf7bd…` rebuilt locally with the fix and shipped to
  the box (index only; working tree byte-identical, same commit SHA). Verified: 321 `.jam`
  files now in each index (was 0), gold files present. Fingerprint-compatible (the golden
  `config_fingerprint` encodes only the embedding pipeline, which is unchanged).
- **Ledger:** `/root/env-ledger/fixval-20260828` swept green for the 6 tasks ($0, no model).
- **Protected:** HO2 untouched. Only the 6-task ledger and the two b2 goldens were mutated.

## 2. Design

- **Tasks (6):** `bfgroup__b2-113`, `bfgroup__b2-259` (index fix); `aws-actions__configure-aws-credentials-42`
  (the "not indexed" hygiene message); controls `absinthe-graphql__absinthe-998`,
  `axelrod-python__axelrod-671`, `asynkron__protoactor-dotnet-1909` (solved-everywhere on the
  fresh pool; unaffected by the fix; harness-health guards).
- **Arms:** `native`, `sweet` (`N<TAB>`, the shipped default).
- **Reps:** 3. **Harnesses:** codex, opencode, claude-code — run separately.
- **Config (mirrors the fresh pool):** `MODEL=openai/gpt-5.6-luna`, `PROVIDER=openrouter`,
  `REASONING=medium`, `CONCURRENCY=1`, `MAX_TOOL_CALLS=60`, `AGENT_TIMEOUT_MS=1800000`.
- **Scale:** 6 × 2 × 3 × 3 = **108 rollouts, ≈ $2** (sidechain-inclusive; +~20% claude reruns).

## 3. Pre-registered outcomes

1. **Retrieval — primary (near-deterministic).** On each b2 sweet rollout, count rollouts where
   ≥1 `ss-*` call returns the gold file in its results. Fresh-pool baseline: **0 of 18** per task.
   **Bar: > 0**; the honest read is the fraction of the 6 b2 sweet rollouts (2 tasks × 3 reps) that reach it.
2. **Resolution — secondary (directional, no formal bar).** b2 solves, sweet vs native, vs the
   fresh-pool baseline (b2 dead in all sweet arms). Two tasks is underpowered; reported as a
   count, never as a significance claim.
3. **Hygiene.** aws-actions sweet: does it emit `(not indexed: …)` on a `dist/` scope and stop
   re-grepping the bundle? **Banner:** zero engine-load lines (`BinaryHNSW:`/`LateInteraction:`/
   `Loading local model:`) in any sweet tool output across all 108 rollouts.
4. **Controls.** Each control must solve **≥ 2/3 in both arms on each harness**. A control below
   that **voids that harness** (environment/harness fault), never the fix.
5. **Cost.** Per rollout, sweet vs native, sidechain-inclusive. Reported, not a bar.

## 4. Reading rules

- Grading runs after the last rollout; assert `resolved != null` on every row before reading solves.
- Claude-code cost is transcript-reconstructed, sidechain-inclusive; never summed from `rows.json`.
- The retrieval outcome is the point; a solve flip on 2 hard tasks is a bonus, not the claim.
- Do not tune anything to this result; it validates a shipped fix, it is not an optimisation loop.
