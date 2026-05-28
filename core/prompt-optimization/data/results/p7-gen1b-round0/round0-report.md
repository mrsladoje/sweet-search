# P7 gen-1b round-0 ablation — post-run report

- **Run id**: `p7-gen1b-round0`
- **Start / end**: 2026-05-28T13:46:27Z → 2026-05-28T19:05:55Z
- **Wall**: 5 h 19 m 28 s
- **Spend**: $46.54 (OpenRouter total_usage 264.687 → 311.227)
- **Pre-topup budget headroom at exit**: $3.77 (within original $50.31 budget; the mid-run topup to $355 was a precaution, not strictly required)
- **Exit**: `GEPA complete: 1 round(s), front=2, stopped=max-rounds — winner: T8 final=0.430`
- **Hard-stop conditions tripped**: none (AllJudgesFailedError=0, missing-measurement=1, round-11=0)

## 1. Round-0 measured front (all 8 seeds reconstructed from trajectory)

Sorted by joint mean task score = `min(score_sonnet, score_gpt5_5)`. Only T8 was admitted to the durable pareto front (see §1.1 for why); for the other 7, `finalScore` was computed during evaluation but is not persisted in `pareto-current.json`. Per-target raw scores and token totals come directly from 640 SEED events in `gepa-trajectory.jsonl`.

| TID | hash | source_id | task_son | task_gpt5_5 | joint(min) | tokens_son | tokens_gpt5_5 | calls_son | calls_gpt5_5 | front? | finalScore |
|-----|------|-----------|---------:|------------:|-----------:|-----------:|--------------:|----------:|-------------:|:------:|-----------:|
| **T8** | `0x0a07d83504e451d8` | pruner-placeholder-joint-best | **1.000** | 0.985 | **0.985** | **75,167** | 1,754,484 | **348** | 219 | ✅ | **0.4297** |
| T2 | `0x53f8a0f707141e25` | T2-r1-reflective-r3-reflective-r6-pruner | 1.000 | 0.998 | 0.998 | 79,319 | 1,906,532 | 394 | 227 | ❌ | n/a |
| T1 | `0x9b99587f0b0db9a7` | T2-r1-reflective | 1.000 | 0.995 | 0.995 | 79,794 | 1,644,802 | 396 | 217 | ❌ | n/a |
| T6 | `0x931d9c97e9bc9ea0` | no-match-fast | 1.000 | 0.995 | 0.995 | 84,812 | 1,599,488 | 543 | 244 | ❌ | n/a |
| T4 | `0x8a5b03ae012beaab` | T2-r1-reflective-r8-trajectory-crossover | 1.000 | 0.979 | 0.979 | 74,607 | 1,792,497 | 355 | 223 | ❌ | n/a |
| T7 | `0xfb2c890b60452b75` | trace-first-flow | 0.953 | 1.000 | 0.953 | 97,203 | 1,887,189 | 632 | 266 | ❌ | n/a |
| T5 | `0xbd963c90431665da` | router-minimal | 0.975 | 0.948 | 0.948 | 106,396 | 1,519,118 | 685 | 252 | ❌ | n/a |
| T3 | `0x57d1d3600aaf18a8` | T2-r1-reflective-r3-reflective-r7-trajectory-crossover | 1.000 | 0.895 | 0.895 | 84,105 | 1,490,431 | 415 | 198 | ❌ | n/a |

**Front-only fields (T8 from `pareto-current.json`)**: tokenCount_prompt=963, sharpnessScore=1.0 (TARE placeholder; no adversarial run fired), efficiencyFactor=0.884, lengthPenalty=0.04815, nativeRelative.factor: sonnet=0.4778, gpt5_5=0.5844, joint=0.4778.

**Round-1 mutation that also reached the front**: `0xc00e3cb7` (persona-pivot on T8) — finalScore=0.3829, sonnet=0.999, gpt5_5=0.982, tokenCount=1015. Two reflective mutations (`0x87737111`, `0xb0ec5ab2`) were rejected at SCREEN with screen-final 0.031 and 0.034 — no CONFIRM events emitted for either.

### 1.1 Why only 1 of 8 seeds was admitted (structural finding)

`buildFrontFrom` (gepa-pareto.mjs:220) filters to **non-dominated** candidates on (`finalScore`, `sharpnessScore`), then sorts by `finalScore` and slices to `frontSize=6`. The dominance relation is:

```
dominates(a, b) ≡ fa ≥ fb ∧ sa ≥ sb ∧ (fa > fb ∨ sa > sb)
```

For freshly-seeded candidates, **sharpnessScore is the 1.0 placeholder for everyone** (TARE only fires after admission). With sharpness tied at 1.0 across all seeds, the dominance relation collapses to "strictly higher finalScore" — so whichever seed has the maximum finalScore strictly dominates every other seed, and the seeded front collapses to a singleton. This is by-design behaviour of the operator, not a bug, but **the success criterion of "8 distinct front members" was unreachable from the start** given how `dominates` is defined.

The 7 dominated seeds **were fully measured** (640 SEED events; per-(probe, target) raw scores, tokens, tool calls all persisted) — only their composite `finalScore`s aren't on disk. Reconstructing those would require running the `taskScore × efficiencyFactor − lengthPenalty` pipeline against the native-baseline file; out of scope for this report.

## 2. Delta vs gen-1 (joint_best = 0.5265)

| TID | source_id | finalScore | vs 0.5265 |
|-----|-----------|-----------:|-----------|
| T8 | pruner-placeholder-joint-best | 0.4297 | **UNDERPERFORMED** (−0.097) |
| T1 | T2-r1-reflective (gen-1 parent, prior 0.3981) | < 0.4297 | UNDERPERFORMED |
| T2 | T2-r1-reflective-r3-reflective-r6-pruner | < 0.4297 | UNDERPERFORMED |
| T3 | T2-r1-reflective-r3-reflective-r7-trajectory-crossover *(= gen-1 joint_best lineage)* | < 0.4297 | UNDERPERFORMED |
| T4 | T2-r1-reflective-r8-trajectory-crossover | < 0.4297 | UNDERPERFORMED |
| T5 | router-minimal *(hand seed, no prior)* | < 0.4297 | UNDERPERFORMED |
| T6 | no-match-fast *(hand seed, no prior)* | < 0.4297 | UNDERPERFORMED |
| T7 | trace-first-flow *(hand seed, no prior)* | < 0.4297 | UNDERPERFORMED |

**Headline**: every gen-1b candidate underperformed the gen-1 joint_best of 0.5265. T8 was the strongest of the slate at 0.4297 — a **−0.097pp drop vs gen-1**. Round-1 mutations on T8 (1 admitted at 0.3829) made it worse, not better.

Of particular note:
- **T3** carries the exact `source_id` of the gen-1 joint_best (`T2-r1-reflective-r3-reflective-r7-trajectory-crossover`) but landed at the **lowest** joint task score (0.895) of the slate — gpt5_5 dropped 10pp vs T2. Either the prompt-text in T3 is not byte-identical to the gen-1 winner, or measurement noise / native-baseline shift drove the gap. Worth a sanity-check before any next-gen plan that assumes T3 is "the proven winner."
- **T5/T6/T7** (hand seeds with no prior measurement) all underperformed the genealogical seeds T1/T2/T4 on task accuracy. T5 (router-minimal) and T7 (trace-first-flow) showed real accuracy regressions, not just efficiency tradeoffs.
- **T8** (pruner-placeholder, no prior measurement) won. Its win is **token-efficiency driven**, not accuracy-driven: T2 has higher gpt5_5 accuracy (0.998 vs 0.985) but T8 uses fewer tokens on sonnet (75K vs 79K) and similar on gpt5_5 — the efficiency factor × length penalty combination pushed T8 ahead in finalScore.

## 3. T8 distinct-hash verification

| | expected (launch spec) | actual |
|---|---|---|
| T3 hash | `0xb44adf7c5563cd99` | `0x57d1d3600aaf18a8` |
| T8 hash | `0xa4603636d90013ff` *(post-D2-fix)* | `0x0a07d83504e451d8` |
| distinct (T8 ≠ T3)? | yes | **yes** ✓ |
| T8 collided with T3? | no | **no** ✓ |

**T8 was distinctly hashed, not dedup-collided with T3** — the structural concern behind the D2 fix is resolved. However, **neither T3 nor T8's actual hashes match the values quoted in the launch spec**. This either means (a) the launch spec hashes were stale or from a different prompt-bank snapshot, or (b) the T3/T8 prompt text in `p7-gen1b-normalized/` has changed since the spec was written. The `_kind: mutation` event for T8 (`{"round":0,"source_op":"seed","new_prompt_hash":"0x0a07d83504e451d8","parent_hash":null}`) is the canonical record.

## 4. Per-target weaknesses

T8 (the only seed with full `nativeRelative` measurement on disk) has factor 0.478 on sonnet and 0.584 on gpt5_5 — **both above the 0.30 threshold**. The persona-pivot mutation `0xc00e3cb7` has 0.434 sonnet and 0.566 gpt5_5 — same story, both above.

The other 6 seeds (admitted to neither front) lack a persisted `nativeRelative.factor`. Substituting the observable raw task score as a proxy: no seed × target combination drops below 0.30 on raw task score either (the lowest cell is T3.gpt5_5 = 0.895).

**No per-target weakness signal at the 0.30 threshold** — but the trajectory does show real failure clusters worth highlighting for the follow-up chat:

| seed × target | probes where score < 1.0 |
|---|---|
| T3.gpt5_5 (0.895) | cpp-004=0, js-005=0.5, js-008=0.3, kotlin-002=0, ruby-001=0 (5 probes failed/severely partial) |
| T5.sonnet (0.975) | kotlin-009=0 |
| T5.gpt5_5 (0.948) | cpp-008=0, java-004=0.9, ts-002=0 |
| T6.gpt5_5 (0.995) | java-004=0.9 |
| T7.sonnet (0.953) | kotlin-009=0.1, rust-010=0 |
| T8.gpt5_5 (0.985) | js-009=0.4 |

T3's gpt5_5 cluster is the most concerning given T3 carries the gen-1 joint_best lineage.

## 5. Cost + wall

| metric | value |
|---|---|
| wall time | 5 h 19 m 28 s |
| spend | $46.54 |
| per-seed avg | $5.82 (from $46.54 / 8 seeds) |
| per-seed wall avg | ~37 min (seeds-only phase ended at 16:42, 2h56m from start) |
| OpenRouter start / end / topup | total_usage 264.687 → 311.227; total_credits raised 315 → 355 mid-run |
| pre-topup margin at exit | $3.77 remaining of the original $50.31 budget |
| peak ss-* child count observed | 5 (concurrency cap was 6) |
| missing-measurement count | 1 (gpt5_5.kotlin-002) |

Vs the launch-spec projection of "~45-90 min, ~$15-25": actuals ran **~5× longer and ~2× more expensive**. The cost overrun was less than the 4-5× I projected at the 1h09m poll because the per-seed cost dropped from $6.62 → $5.82 as later seeds completed (likely warmer prompt-cache hit rates on Anthropic for the later seeds).

## 6. Anomalies

1. **Front-size collapse to 1 (structural)**: as documented in §1.1 — the `dominates` relation in `gepa-pareto.mjs` collapses any equal-sharpness seed slate to a singleton on the highest finalScore.
2. **All 8 seeds underperformed gen-1**: see §2.
3. **2 of 3 round-1 mutations rejected at screen** (`0x87737111` reflective screen-final=0.031, `0xb0ec5ab2` reflective screen-final=0.034). The persona-pivot mutation (`0xc00e3cb7` screen-final=0.040) passed screen and confirmed at finalScore 0.383, still **below T8 seed's 0.430**. Mutations regressed the front, did not improve it.
4. **1 missing-measurement warning**: `nativeRelativeScore: missing measurement for gpt5_5.kotlin-002 (tokens=null) — falling back to baseline (neutral efficiency desirability)`. Single occurrence; ≪ 10-per-seed-phase hard-stop threshold. Likely a single-trajectory token-accounting glitch.
5. **T3 hash deviation from launch spec**: see §3.
6. **No rejection events** in the trajectory (`_kind: "mutation-rejection"` count = 0). The 2 reflective screen rejections were silent — they passed mutation generation but failed screen, which doesn't emit a `MUTATION_REJECTION` event.
7. **No `tare-adversarial` events**: TARE never fired this run. With front-size = 1 → 2 throughout, the adversarial probe-selection step (which needs front diversity) didn't have material to work on.

## 7. Flags called out in the launch spec

- **Plan deviation `--rounds 0` → `--rounds 1`**: pareto-current.json is only written inside the round loop at `gepa.mjs:427`. With 0 rounds the loop body is skipped and no checkpoint is durable. Switched to `--rounds 1` per the launch-spec contingency. **Cost of the surplus mutation round**: 3 mutations + 1 confirm = roughly $6-10 (1 full confirm seed-equivalent ≈ $6, plus 3 screen passes ≈ $1-3). Without `--rounds 1`, no pareto-current.json would exist.
- **frontSize=6 default vs slate size 8**: irrelevant in the end — front collapsed to 1 by Pareto dominance (see §1.1), so frontSize was never the binding constraint. The "may evict 2 weakest seeds" framing from launch underestimated the issue.
- **Wall / cost vs spec projection**: actuals ~5× wall, ~2× cost; explained in §5.
- **`--allow-unverified-seeds` flag**: used per the launch spec for round-0; should not be re-used for any future run.

## Recommendation for the follow-up chat

The strongest result from this run is **negative** — the gen-1b restart slate, viewed through the joint(sonnet, gpt5_5) probe set with the current `dominates` definition, is a regression vs gen-1's joint_best. Three things worth deciding before launching evolutionary rounds:

1. **Verify T3's prompt text** matches the gen-1 winner byte-for-byte (the hash mismatch in §3 + the 10pp gpt5_5 accuracy drop in §2 are suggestive that it does not).
2. **Decide whether to seed evolutionary rounds from T8 alone, from gen-1's actual joint_best, or from a mixed slate** — running operators on T8 produced one admission below its parent and two screen rejections, which is not a productive starting position.
3. **Consider relaxing the seed-phase dominance relation** (e.g., use the per-target score vector as the dominance objective during seeding) to preserve slate diversity into round 1, since the current behaviour throws away 7/8 of the measured seeds before mutations ever see them.

The 640 SEED events in `gepa-trajectory.jsonl` are the durable artifact — every probe × target measurement for every seed is recoverable. The follow-up chat can re-rank the seeds under a different dominance relation without re-running.
