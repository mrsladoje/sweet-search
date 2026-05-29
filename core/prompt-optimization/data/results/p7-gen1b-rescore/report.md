# P7 gen-1b round-0 — RESCORE + noise diagnosis (2026-05-29)

**TL;DR:** the original gen-1b round-0 ranking was **measurement noise** (`repeats=1`), not signal. Under the new cache-naive dollar-cost scoring with the noise removed, the ranking is **inverted**: T3 (the gen-1 winner, which gen-1b called *worst*) is top-tier and on the deployable front; T8 (gen-1b's *winner*) is mid-pack. Realized spend for this rescore: **~$32, 1.4h wall**.

## Why the original ranking was wrong

- gen-1b round-0 ran **1 rep** per (probe, target) → 640 cells. On a saturated-accuracy slate, single-rep is dominated by GPT-5.5 run-to-run variance + transient API failures.
- **T3 is byte-identical to the gen-1 winner** (exact match vs `p7-gen1-20260526-v3/prompt-bank.jsonl` hash `0xb44adf7c5563cd99`; the earlier "hash mismatch" was a different hash fn, not a body difference).
- T3's five "failures" re-ran **15/15 = 1.0** (`t3-noise-diagnostic.json`, 5 probes × 3 reps, gpt5_5, conc 3). Mechanism:
  - `kotlin-002` was a **transient infra failure** (`calls=0, tokens=0` — agent never ran, retries exhausted → scored 0). Re-run: 24s, 4 ss-calls, perfect.
  - `cpp-004 / ruby-001 / js-008 / js-005` were **single-rep GPT-5.5 answer-sampling variance** (terse/early-stop one time; tools fired correctly every time). gen-1's multi-rep showed the same prompt scoring `[1]`/`[0,1]` on these.
- Cross-generation `finalScore` comparison is **invalid** (the identical prompt = 0.5265 in gen-1 vs "worst" in gen-1b ⇒ baseline/scoring/probe + reps artifact). gen-1b fully subsumes gen-1's lineage (T1–T4 evolved, T8 = pruned winner) + 3 hand-authored (T5/T6/T7).

## Method (rescore)

- **Full Sonnet** re-run: 8 seeds × 40 probes × 1 rep, conc 4, **empty-run retry** (a 0-token run is retried, never scored 0). Captures the full cache breakdown so cache-naive cost is exact.
- **GPT-5.5**: cost is recoverable from gen-1b (gross `input_tokens`) and the metric is cache-naive (epoch-independent), so the ~36 clean probes/seed are **reused**. The **9 noisy cells** are re-measured (median of reps): T3's 5 (from the diagnostic) + the 4 others (T4·ruby-002, T5·cpp-008, T5·ts-002, T8·js-009).
- Scoring: cache-naive dollars (`DEFAULTS.targetPrices`), accuracy decoupled from efficiency, Maximin across targets, native baseline `p7-native-baseline-dev-3panel.json`. See `docs/PHASE7.md` §3.7.1 amendment.

## Trustworthy ranking

| seed | accuracy | cost$ total | son | gpt | effF | finalScore | note |
|---|---|---|---|---|---|---|---|
| T2 | 0.998 | 0.235 | 0.213 | 0.258 | 0.340 | **0.340** | gen-1 lineage |
| T3 | **1.000** | 0.235 | 0.231 | 0.238 | 0.337 | **0.337** | = gen-1 winner; gen-1b called WORST |
| T1 | 0.995 | **0.230** | 0.235 | 0.225 | 0.314 | 0.314 | gen-1 lineage, cheapest |
| T4 | 0.979* | 0.239 | 0.234 | 0.244 | 0.319 | 0.311 | |
| T8 | 0.999 | 0.261 | 0.277 | 0.245 | 0.285 | **0.277** | gen-1b "WINNER" → mid-pack |
| T6 | 0.945* | 0.263 | 0.305 | 0.221 | 0.269 | 0.255 | hand-authored |
| T7 | 0.925* | 0.240 | 0.222 | 0.259 | 0.250 | 0.231 | hand-authored |
| T5 | 0.973 | **0.296** | **0.383** | 0.209 | 0.209 | 0.204 | router-minimal — Sonnet-expensive |

**2-D (accuracy, cost) reporting front: {T3, T1}.** Cost is cache-naive USD (the reproducible optimization metric, not realized spend).

## Caveats

- **Top tier {T2, T3, T1} is a statistical tie** (within ~8% finalScore; single-rep Sonnet cost noise ~±5% at seed level). Treat as co-leaders.
- `*` accuracy is **single-rep-understated** for T4/T6/T7 (new Sonnet sub-passes, mostly noise — T7 drew 3). True accuracy likely higher; they're efficiency-laggards regardless.
- GPT data reused from the gen-1b epoch (cache-naive → cache part OK; small model-drift caveat) except the 9 patched cells.

## Decisions / next steps

- **Seed the next evolutionary run from {T1, T2, T3}** (cheap + accurate top tier, all gen-1 lineage). Drop T5/T6/T7 (efficiency laggards; T5 notably Sonnet-expensive).
- **Measurement reliability is the real lever** (not the cost metric): future runs need **repeats ≥ 3 (median)** or adaptive (re-run only low cells) + **empty-run retry/exclude**. Do NOT "just lower concurrency" (doubles wall time, doesn't fix model-sampling noise).
- The **paper's headline number** needs one clean both-targets run at reps ≥ 3; this rescore is the diagnostic + directional seeding, not the publication figure.

## Artifacts

- `rescore-results.json` — 332 re-measured cells (320 Sonnet + 12 GPT patches), raw scores + token breakdown + judges.
- `rescore-ranking.json` — the computed 8-seed ranking.
- `t3-noise-diagnostic.json` — the 15-run T3 reproduction (5 probes × 3 reps) that proved the noise.
- `_driver-*.mjs` — as-run snapshots (paths hardcoded to the run environment): `t3-diag` (diagnostic), `rescore` (Sonnet + patches), `merge` (combine + rescore).
