# Phase 7 GEPA Scaffolding — Review & Fix Checklist

**Reviewed commit:** `a67a37a` (feat(prompt-opt): Phase 7 GEPA system-prompt-evolution scaffolding)
**Authoritative spec:** `docs/PHASE7.md`
**Method:** 7 parallel Opus 4.7 domain reviewers (read-only), each checking implementation against the PHASE7.md contract. Findings deduped + dependency-ordered here.
**Overall verdict:** **NO-GO until the blockers + money/validity majors below clear.** The scaffolding is sound, substantial, well-tested (623 passing unit tests, no fake/skipped tests), and secure (zero hardcoded secrets) — but it is not launch-ready.

## Why no money is at risk right now (and the fix window is free)

- The real probe sets are **not authored yet** (only `data/p7-smoke-probes.json` + the `author-probes.mjs` generator exist). You cannot start the real ~$470 run today.
- Pre-flight **fails closed** when probe files are missing (`p7-preflight-checks.mjs:408-422` → `p7-preflight.mjs:196-199`).
- Therefore every code fix below can land **inside the probe-authoring window at zero schedule cost.**

## Required sequence (do in this order)

1. Cross-cutting root-cause fixes (§1) — each clears multiple items.
2. Blockers B1–B6 (§2).
3. Money/validity majors M1–M13 (§3).
4. Plan-doc fixes D1–D4 (§5) — owner: plan author (already committed-against; small).
5. Operational verification O1–O5 (§6) — confirm model IDs/endpoints via pre-flight `/models`.
6. **Probe authoring hard-gate** (§7) — author → grep-verify every gold → `validate` → freeze → tag `prereg/p7-v1`.
7. Add spec-conformance regression tests (§8) — the existing 623 tests lock code *as-written*; they do NOT catch the spec deviations below.
8. Dry-run on smoke probes (~$1), then the pre-launch checklist (§9).

> **Critical meta-point for the implementer:** the 623 green tests assert the code **as written**, not the spec. Every blocker/major below currently *passes* its tests. For each fix, ALSO add/repair a test that asserts the spec behavior, or the regression silently returns.

---

## §1 Cross-cutting root-cause fixes (highest leverage — do first)

### CC1 — Thread real run-metadata + token usage out of `evaluateCandidate`
**Resolves: B2 (forensic metadata), M3 (token-bucket estimates), M8 (usage discarded).**
The direct runners already capture real usage (`raw.usage` at `judge-runner.js:419,579,709`; Gemini `raw.usage = json.usageMetadata` at `:496`), but `evaluateCandidate` (`gepa-evaluate.mjs:244-251`) returns only `{score, toolCalls, finalAnswerEmitted, usedReadOrGrep, trajectory, wallMs}` and drops everything else.
**Fix:** extend the return to carry `{ model_id, api_path, temperature, input_tokens, output_tokens, cache_read_tokens, retry_count, repo_commit, probe_hash, token_count_prompt }` (agent run + each judge call). Then (a) write them into the CONFIRM event (B2), and (b) pass measured `inTokens/outTokens` into `bucket.acquire` + a `bucket.reconcile(actualIn, actualOut)` after each call (M3/M8).

### CC2 — Wire winner-selection gates + reflection logging into the orchestrator
**Resolves: M13, and is the integration point for M9 (OOD gate); also closes the §4 steps 10–12 gap.**
`gepa.mjs` ends at TARE/Pareto. The §4 winner-selection block — per-target floor ≥0.5, model-family HOMP gate (≥0.7×), language-transfer/OOD gate (≥0.55), reasoning-mode HOMP (≥0.7×), correctness-weighted SCS gate (≥0.8 + 0.6 floor), length cap ≤2000, ship-file write, and **vault confirmation (open once)** — has no call site. `runReasoningHomp` / `computeScsReport` / the (missing) OOD gate / `runReflection` are all dangling.
**Fix:** add a post-convergence `selectWinner`/`finalizeRun` stage in `gepa.mjs` (or a `gepa-finalize.mjs`) that invokes all gates in §4 order, persists each gate result, appends the reflection report to `data/p7-decisions.md` per round, and performs the once-only vault open. Re-review the held-out-vs-dev plumbing when wired (the gate fns are correct; the risk is the caller passing the wrong set).

### CC3 — Shared retry/backoff wrapper for ALL direct API calls
**Resolves: B5 (no retry), and is where B6/M6 detection should live.**
A correct reference exists: `core/prompt-optimization/scripts/deepseek-client.mjs:81-189` (429 → 1/2/4/8/16s ladder honoring `Retry-After`; 5xx → 1 retry; 4xx → fatal). The P7 judge path does not use it.
**Fix:** route every direct runner (`runOpenAICompatible`, `runAnthropicDirect`, `runGeminiDirect`, `runDeepseekDirect`) through one wrapper modeled on `deepseek-client.classifyResponse` + `BACKOFF_LADDER_MS`. Inside it, classify `res.ok && parsed.text.trim()===''` as retryable `empty-text-200` (M6). Also gate **judge** calls through the token bucket (currently only the two agent targets are gated: `gepa-scoring.mjs:94`).

---

## §2 Blockers (must fix before any spend)

### B1 — Mid-round resume re-charges the entire interrupted round
`gepa.mjs:183-200` (resume), `:233-405` (loop), `:379` (`lastCompletedRound` checkpoint). `resumeState` returns `{lastRound, completedStepIds, paretoUpdates, mutationsByRound}` but only `lastRound` is used; `completedStepIds`/`stepId`/`mutationsByRound` have **zero references** in `gepa.mjs`. The per-step idempotency keys are built + unit-tested (`p7-persist.mjs:163-170`) but never consulted. A kill-9 during round-15 confirm (the ~80-run step) re-runs selection+mutation+screen+confirm for the whole round on resume — re-billing already-paid calls. Violates §7.4 "no re-spending."
**Fix:** before executing each screen/confirm/TARE/mutation step, compute its `stepId(event)` and skip the API call (replaying the persisted score from the trajectory row) if `rs.completedStepIds.has(sid)`. I.e. consume the `resumeState` output the code already builds.
**Test:** see B3.

### B2 — §7.4 forensic metadata absent from the CONFIRM event; `judge_panel` hardcoded AND wrong
`gepa.mjs:317-333`. Missing every §7.4/§D4 field (`probe_hash, model_id, api_path, temperature, tool_schema_version, repo_commit, input_tokens, output_tokens, cache_read_tokens, result_bytes, retry_count, wall_ms, expected_call_window, call_deviation_penalty, evidence_adequacy_penalty, token_count_prompt`). `judge_panel` is a hardcoded literal (`gepa.mjs:332`: `['deepseek-v4-flash','gemini-3.1-flash-lite','minimax-m2.7']`) while the evaluator's real panel (`gepa-evaluate.mjs:49-53`) uses `abab6.5s-chat` for MiniMax — so the logged panel is also inaccurate. A one-shot $470 run with no post-hoc debuggability.
**Fix:** via CC1, thread metadata into the CONFIRM event; log the real `JUDGE_PANEL` constant, not a literal.
**Test:** assert a CONFIRM row contains the full field set and the panel matches `JUDGE_PANEL`.

### B3 — No kill-9 mid-round recovery test (the one §7.4 step 6 mandates)
`p7-persist.test.js:255-311` only truncates a JSONL file (recovers N-1 rows). `p7-gepa.test.js:300-330` resume test stops at a **clean round boundary** (`maxRounds:2` → resume to 4), so it passes regardless of B1. The actual failure mode is untested → false confidence.
**Fix/Test:** add a test that throws inside `evaluateCandidate` partway through round 3's confirm, asserts the trajectory has partial round-3 rows but `pareto-current.json` shows `lastCompletedRound:2`, then resumes and asserts (a) **no probe in round 3 is evaluated twice** and (b) the final front equals a fresh run's. (Also add a spy asserting `fsyncSync` is actually invoked — currently verified by code-read only.)

### B4 — TARE adversarial paraphrases are 100% Sonnet (Anthropic) — single-family robustness
`gepa-mutate.mjs:103-121` (`generateAdversarialParaphrases`) hardcodes `model:'claude-sonnet-4-6'` for all K=3. Violates §2.1:51 and §C2:1497 ("TARE K=3 **must** include ≥1 non-Anthropic paraphrase"). Sonnet is also a *target*, so the entire $470 robustness signal measures only in-family invariance — exactly the failure §C2 exists to prevent.
**Fix:** rotate ≥1 of the 3 paraphrases through a non-Anthropic generator (deterministic structural OR Kimi K2.6 / GPT-5.5).
**Test:** assert the K=3 generator set contains ≥1 non-anthropic lineage.

### B5 — No 429 / retry / backoff on any direct runner
`runOpenAICompatible` (`judge-runner.js:673-721`), `runAnthropicDirect` (`:557-589`), `runGeminiDirect` (`:480-506`), `runDeepseekDirect` (`:399-424`) treat non-2xx as terminal `{isError:true}`. Judges run via `Promise.all` (`gepa-evaluate.mjs:102-115`) with no retry, and judge calls bypass the token bucket. Transient 429s over a multi-hour run become errored judges.
**Fix:** CC3.
**Test:** simulate a 429-then-200 and assert the wrapper retries and succeeds.

### B6 — All-judges-fail coerces the probe score to `0` (≡ "unanimously wrong")
`gepa-evaluate.mjs:110-114`: `const valid = verdicts.filter(...); if (valid.length === 0) return 0;`. A 0 here is indistinguishable from a real unanimous-wrong verdict; it feeds `maximinPerProbe` (`gepa-scoring.mjs:101`) and the Pareto front. With B5, a rate-limit blip on all 3 judges silently scores a good candidate 0 → corrupts selection.
**Fix:** when `valid.length === 0`, throw / mark the probe un-scored (retry or exclude), never coerce to 0.
**Test:** assert all-empty verdicts raise/exclude rather than returning 0.

---

## §3 Majors (fix before launch — money or result-validity impact)

### M1 — Pareto-update appended before the atomic checkpoint (orphan-on-crash)
`gepa.mjs:359` (append) precedes `:379` (atomic checkpoint). A kill between them records a pareto-update for round N that the checkpoint (N-1) doesn't reflect; resume trusts `ckpt.front` and ignores `rs.paretoUpdates` → orphaned row. Also `attemptParetoAdmission` (`gepa-pareto.mjs:92-99`) breaks on first incumbent passing the cap (order-dependent), so the recorded *displaced incumbent* can differ on re-run.
**Fix:** move the pareto-update append to **after** the atomic checkpoint, or fold the front into the checkpoint as the single source of truth and drop the separate JSONL pareto-update as authoritative.

### M2 — Token bucket is in-memory only; resume forgets in-flight tokens → Tier-1 429-storm
`p7-token-bucket.mjs:123` (`let entries = []`), `gepa-cli.mjs:110-113`. Never serialized/restored. On `--resume` a fresh bucket believes it has full budget and bursts `max_concurrent` immediately — the §7.7 "429-storm minute one" at Tier-1 GPT-5.5.
**Fix:** seed the bucket from recent trajectory timestamps on resume, or sleep one `WINDOW_MS` before the first post-resume call.

### M3 — Token bucket gates on static estimates; actuals never reconcile
`gepa-scoring.mjs:94-95` calls `acquire({target})` with no token counts → always charges `estIn=12_000/estOut=2_000` (`p7-token-bucket.mjs:114-115`); `entries.push` records the estimate (`:205`). Heavy multi-file probes under-count → under-throttle → 429s. (OpenAI bucket also only passed `rpm`+`itpm`, no `otpm` — `gepa-cli.mjs:112`; acceptable per §7.7 input-token binding but confirm GPT output never dominates.)
**Fix:** via CC1, pass measured tokens to `acquire` and add `reconcile`.

### M4 — TARE sharpness computed on `finalScore`, not joint Maximin
`gepa.mjs:344-347` evaluate callback returns `sc.finalScore`. §3.7.1 step 7 is explicit: sharpness uses Maximin (`max(joint_min) − min(joint_min)`), and `tare.mjs:102`'s own contract says "returns joint score." Folding EAS-factor + length-penalty variation into "sharpness" makes the `1−sharpness` Pareto objective measure composite-score brittleness, not answer brittleness.
**Fix:** return the candidate's joint Maximin aggregate (`min(score_sonnet, score_gpt5_5)` / weighted-Maximin task_score), not `finalScore`.

### M5 — Pareto front trims by lowest `finalScore` (collapses 2-objective → 1-objective)
`gepa-pareto.mjs:115-119` evicts the lowest-`finalScore` member when the front overflows, regardless of its `1−sharpness` value — so a Pareto-optimal robust-but-slightly-lower variant is dropped, degenerating the front toward top-6-by-finalScore.
**Fix:** trim by removing a *dominated* member / crowding-distance over the two objectives.

### M6 — `empty-text-200` not detected (DeepSeek/reasoning-model gotcha)
`runDeepseekDirect` returns `isError:false` on empty content (`judge-runner.js:416-420`); `parseDeepseekResponse` returns `''` for reasoning-only responses; `parseJudgeScore('')` → `null` (`gepa-evaluate.mjs:86`). MiniMax/MiMo/Qwen/Moonshot via `runOpenAICompatible` share this. (`buildDeepseekPayload` correctly sets `max_tokens:4096` — `judge-runner.js:438-442` — so the payload is fine; only the empty-detection is missing.) Per project memory `project_deepseek_max_tokens_reasoning`.
**Fix:** inside CC3, treat `res.ok && parsed.text.trim()===''` as `isError:true` (`error:'empty-text-200'`).

### M7 — Reasoning-HOMP runner adapters unwired + `runOpenAIDirect` reasoning-param mismatch
`p7-reasoning-homp.mjs:42-47` takes injected `runSonnetThinking`/`runGptReasoning`; no production wiring supplies them. `buildAnthropicPayload` handles extended-thinking correctly (`judge-runner.js:623-628`: forces `temperature:1`, lifts `max_tokens` above `budget_tokens`) but is only reachable if a caller passes `{thinking:8000}` — no call site. GPT-5.5 reasoning needs `buildGpt5ReasoningPayload` (`gepa-evaluate.mjs:263-274`: `temperature:1`, `max_completion_tokens`), but `runOpenAIDirect` uses `buildOpenAIPayload` (`max_tokens`, `temperature:0`); passing `reasoningEffort` (`judge-runner.js:775`) does **not** switch to `max_completion_tokens` → malformed reasoning call.
**Fix:** add two production adapters (Sonnet via `runAnthropicDirect({thinking:8000})`; GPT-5.5-reasoning via `buildGpt5ReasoningPayload` over `runOpenAICompatible` with a `useCompletionTokens` flag) and inject them in CC2's finalize stage. *(Post-convergence gate — can land just before §3.5.2 runs, but wire early to avoid a scramble.)*

### M8 — Token usage captured by runners but discarded before persistence
Root cause of B2 + M3. See **CC1**.

### M9 — OOD language-transfer gate (§3.5.1) is not implemented at all
Only thresholds exist (`p7-shared.mjs:80-81`: `oodMaximinGate:0.55`, `oodPerLanguageWeakSpot:0.4`) and a catalog (`author-probes.mjs:43-45`: `OOD_LANGUAGES`). No function runs the winner on MiMo+Sonnet+GPT-5.5 over 40 probes × 8 languages, computes per-target aggregate Maximin, gates ≥0.55 on **both** targets, emits a per-language scorecard, or tags the 5 regex-fallback languages. `author-probes.mjs:41` even references "the OOD scaffolding + tests" that don't exist. §3.7.1 step 10 hard ship constraint.
**Fix:** implement `p7-ood-gate.mjs` (sibling to `p7-reasoning-homp.mjs`): injected MiMo/Sonnet/GPT-5.5 runners; per-language Maximin aggregation; gate `min(maximin_sonnet, maximin_gpt) && both ≥ 0.55`; flag any language `< 0.4` as a documented weak spot; tag `regexFallback:true` on Dart/Elixir/Lua/Scala/Zig (chunker-confound). Wire into CC2.

### M10 — Pre-flight doesn't check the langtransfer / rotation / counter probe files
`checkProbeSets` (`p7-preflight-checks.mjs:409-413`) verifies only dev/held-out/vault — not `frozen/p7-langtransfer-probes.json`, `p7-rotation-pool.json`, or `frozen/p7-adversarial-counter-probes.json` (all in the prereg manifest, PHASE7.md:866). A run could pass pre-flight with OOD probes unauthored, then crash/skip the §3.5.1 gate.
**Fix:** add those three files to the `required` array in `checkProbeSets`.

### M11 — OP-5 pruner's pseudocode/fenced-block protection is prompt-only, not enforced
`op-pruner.mjs:33-34` (clause text), `:102` (validation guards only `[[token]]`). A model that flattens indentation / drops `elif` / mangles pseudocode while preserving all `[[token]]`s is **accepted and ships**. OP-5 fires every 3rd round from round 3, so AST-ified routing (from OP-3) can silently degrade. (Technically spec-compliant — the §3.2.1 validator only mandates `[[token]]` integrity — but fails the "enforced not prompted" bar; §10 risk row PHASE7.md:1469.)
**Fix:** extract fenced/```-delimited blocks and `# routing policy pseudocode` blocks from the source, assert byte-identical survival in the output before accepting, reject with a new `fenced-block-altered` reason.

### M12 — `stratifiedSplit` cannot produce vault=25 / rotation=13
`author-probes.mjs:245-275` takes a single global `{dev:4, heldout:3, vault:2}` and dumps the remainder into `rotation` → yields **vault=20, rotation=0** on the canonical inputs. But §5.8 wants vault=25 (2–3/lang) and §5.3 wants a separately-authored rotation pool of exactly 13 (10 standard + 3 `tier:deferred-pathology`), not a split remainder.
**Fix:** either (a) document `stratifiedSplit` as dev/held-out-only and author vault + rotation as standalone files, or (b) extend `perLanguage.vault` to a per-language map summing to 25 and drop `rotation` from this function so it isn't mistaken for the §5.3 pool.

### M13 — Winner-selection gates + reflection logging not wired into the orchestrator
See **CC2**. Without it, §4 steps 10–12 (gates, ship-file, vault confirmation) never execute and `runReflection` output is never persisted to `data/p7-decisions.md` (which `checkDecisionLog` at `p7-preflight-checks.mjs:468-477` expects to exist).

---

## §4 Minors (track; pre-run hygiene, non-blocking)

- **m1** — Verbose run-log uses bare `appendFileSync` (no fsync): `gepa.mjs:24,76`. Non-load-bearing (JSONL trajectory is the durable source). Add a comment so nobody promotes it into the hot path.
- **m2** — Seeding-resume single point of failure: `gepa.mjs:189,216-227` throws if `pareto-current.json` is lost even when the trajectory survives. Optionally reconstruct the front from `rs.paretoUpdates` + prompt bank instead of throwing.
- **m3** — TARE would-enter gate compares `finalScore`; §3.3 step 2 says `joint_task_score`. `gepa.mjs:341-342`. Internally consistent (only decides whether to *spend* TARE budget); low blast radius; align with M4.
- **m4** — Per-target aggregates (`score_sonnet`/`score_gpt5_5`, used by the 0.15 cap + floor) are unweighted means: `gepa-scoring.mjs:119-120`, while `task_score` uses hard-negative weights. Defensible per spec; flag only.
- **m5** — `selectParent` weights by `finalScore` not "per-probe wins": `gepa-pareto.mjs:147`. Proxy; docstring acknowledges. Affects exploration distribution only.
- **m6** — Dead `whitespace-norm` rejection reason: `p7-shared.mjs:132` lists it but the validator never emits it (whitespace is silently fixed per §3.2.1 check 2). Drop or document.
- **m7** — Pruner round-3 start is emergent from `SLOT3_CYCLE` ordering, not guarded: `gepa-pareto.mjs:159,166-169`. `runPruner({minTokens:120})` (`gepa-mutate.mjs:179`) is the real no-op safety. Add explicit `if (op==='pruner' && round<3)` fallback in `planSlots`.
- **m8** — True balanced-pair never constructed by wiring: `gepa-mutate.mjs:125-132`, `gepa-pareto.mjs:178-187`. The OP-2 operator handles it; orchestration only passes winner-vs-loser. In `findCrossoverPair`, also detect per-target balanced wins and pass both trajectories of one candidate.
- **m9** — `abbreviatePackages` corrupts file-path segments: `agent-query-degrader.mjs:73-79` regex turns `src/x.ts` → `src/ts`. Anchor to dotted-identifier contexts (`pkg.Class`) or exclude tokens containing `/`. (Only 3 bucket-C probes; bucket C doesn't gate.)
- **m10** — `splitFrontMatter` is LF-only + requires trailing newline: `variant-loader.mjs:179`. CRLF or trailing space throws. Normalize `\r\n`→`\n` and allow optional trailing whitespace.
- **m11** — `loadVariant` absolute paths bypass the `VARIANTS_DIR` sandbox: `variant-loader.mjs:187-195`. Not exploitable (callers pass `T1`…`T15`) but CLAUDE.md mandates path sanitization — assert the resolved path is inside `VARIANTS_DIR`.
- **m12** — SCS returns 0 if any component ≤ 0 (`scs.mjs:184`); SS cosine can be legitimately negative. Conservative/safe (a negative-SS prompt *should* fail) but the JSDoc claims SS ∈ [0,1]; note negative-SS hard-fails by design.
- **m13** — Anthropic tier check has no operator escape hatch: `p7-preflight-checks.mjs:171-176` accepts `allowTier1` but the orchestrator never plumbs a CLI flag for Anthropic (only `allowTier1Gpt5` for OpenAI). Fails closed (good) but a transient Anthropic outage hard-blocks with no override. Operator note.
- **m14** — `cosineSimilarity` duplicated (`embeddings.js:231` returns 0 on length mismatch vs `scs.mjs:34` throws). SCS uses its own; no impact. Consolidate for hygiene.
- **m15** — `p7-gepa.test.js:6` header comment "Everything is STUBBED" is imprecise (only external boundaries are stubbed; the GEPA driver is the real unit). Cosmetic.

---

## §5 Plan-doc fixes to `docs/PHASE7.md` (owner: plan author)

- **D1** — §3.6.1 line ~386 says "**30** dev queries" but the code requires **exactly 40** (`agent-query-degrader.mjs:40-44` `buildBuckets` throws otherwise). Change "30 dev queries" → "40 dev queries". *(Following the stale prose would `RangeError` the degrader at run time.)*
- **D2** — §1 (lines ~5 and ~1504) say "15 held-out probes; +$6" while the authoritative §3.5.2 body (lines ~346,351) and cost table (~1147) say "30 held-out / ~$12". Fix the §1 summary + the §11.x running-total note to 30/$12 (or mark them explicitly historical).
- **D3** — §3.6 line ~374 hardcodes the AC denominator as `/ 30`; the code correctly divides by `N` (probe count = 45) at `scs.mjs:102`. Fix the doc to `/ N`.
- **D4** — §5.0 "the 5 P6 anchor repos are NOT yet SHA-pinned" is **partly stale**: the probe reviewer found they *are* pinned in `eval/read-workflows/repo-manifest.json` (the `manifest.json`-declared source of truth). Verify those SHAs and update §5.0; ensure they carry into the `prereg/p7-v1` probe-repos manifest.

---

## §6 Operational verification before spend (confirm via pre-flight `/models`)

- **O1** — MiniMax model ID: code uses `abab6.5s-chat` (`judge-runner.js:823`, `gepa-evaluate.mjs:52`); spec §2.1/§7.4 name `minimax-m2.7`. Confirm the exact slug the account exposes (a wrong ID is a 4xx at run start).
- **O2** — MiniMax endpoint: `https://api.minimax.io/v1` + `/text/chatcompletion_v2` (`judge-runner.js:821,827`). Historically also `api.minimaxi.com`. Verify host + that the v2 path returns the OpenAI `choices[0].message.content` shape `parseOpenAIResponse` expects.
- **O3** — Moonshot `https://api.moonshot.ai/v1` (`:789-795`) + slug `kimi-k2.6`; DashScope `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (`:888-890`) + slug `qwen3.6-plus`. Confirm both.
- **O4** — `runOpenAIDirect`/`buildOpenAIPayload` default model is `gpt-4.1` (`judge-runner.js:741`); the agent path correctly sets `gpt-5.5-instant` (`gepa-evaluate.mjs:209`). Ensure no judge/gate path accidentally uses the `gpt-4.1` default for a production call.
- **O5** — Tiers: OpenAI ≥ Tier 2 (TPM) and Anthropic ≥ Tier 2 are required; the $50 OpenAI Tier-2 upgrade is operationally mandatory (§7.7). Pre-flight enforces this — run it and confirm green.

---

## §7 Probe-authoring hard-gate (prerequisite to ANY run)

All six probe files are absent (`data/frozen/` holds only `.gitkeep`):
`p7-dev-probes.json`, `frozen/p7-heldout-probes.json`, `p7-rotation-pool.json`, `frozen/p7-adversarial-counter-probes.json`, `frozen/p7-vault-probes.json`, `frozen/p7-langtransfer-probes.json`.

Required to author (after M12 is fixed):
- **Dev 40** (4/lang × 10 in-distribution langs), **held-out 30** (3/lang), **vault 25** (2–3/lang), **rotation 13** (10 standard + 3 `tier:deferred-pathology`), **adversarial-counter 10** (held-out, anti-P6-shape), **OOD language-transfer 40** (5 each × 8 OOD langs).
- Stratified by language, seed=42; global stratum 13/13/8/6 and difficulty 12/20/8; 7 trick probes (4 pathology + 3 distractor).
- **Gold integrity is the $470-critical discipline:** every `expectedFiles`/`expectedSymbols`/`expectedFacts` must be **grep-verified against the SHA-locked repo** — never fabricated. The smoke set already does this correctly (e.g. ripgrep `search_parallel`@160, gin `Abort`@207); the pathology/distractor templates correctly ship `TODO` golds with "verify by grep before committing" — honor that.
- Then `validate` (zod `ProbeSchema`) → write held-out/vault/langtransfer/counter under `frozen/` → commit + create the `prereg/p7-v1` tag (currently only `prereg/p7-v1-pre-probe` exists).

---

## §8 Testing requirements (the existing 623 tests are necessary but NOT sufficient)

Current suite: `npx vitest run $(ls tests/unit/prompt-optimization/p7-*.test.js)` → **623 passed / 0 failed / 0 skipped**, genuinely rigorous, no integrity anti-patterns. But it asserts code-as-written. For each fix above, add a regression test that asserts the **spec** behavior:
- B1/B3 — mid-round kill → no double-eval + front == fresh; fsync spy.
- B2 — CONFIRM event carries full forensic field set + real panel.
- B4 — TARE generator set includes ≥1 non-anthropic lineage.
- B5/M6 — 429-then-200 retried; empty-text-200 retried/excluded.
- B6 — all-empty verdicts raise/exclude, never 0.
- M4 — TARE sharpness computed on Maximin (feed divergent EAS/length, assert sharpness ignores them).
- M5 — front overflow evicts a dominated member, retains a robust lower-finalScore Pareto point.
- M9 — OOD gate aggregates per-language Maximin, gates 0.55 on both targets, flags <0.4, tags regex-fallback langs.
- M11 — pruner rejects a fenced-block/indentation mutation.

---

## §9 Pre-launch checklist (final gate — all must be ✅)

- [ ] CC1, CC2, CC3 landed
- [ ] B1–B6 fixed + regression tests added
- [ ] M1–M13 fixed (M7 may land just before §3.5.2 runs; everything else before launch)
- [ ] D1–D4 doc fixes applied
- [ ] O1–O5 model IDs/endpoints/tiers confirmed via pre-flight `/models`
- [ ] Probe sets authored, **all golds grep-verified**, validated, frozen, `prereg/p7-v1` tag created
- [ ] Full `p7-*` test suite green (existing 623 + new spec-conformance tests)
- [ ] Dry-run on smoke probes (3 probes × 1 round, ~$1) clean end-to-end, resume tested
- [ ] Pre-flight passes (fails closed verified)

---

## §10 Verified-correct (do NOT "fix" these — they match spec)

- **Primary scoring objective**: Maximin per-probe (`p7-shared.mjs:219-221`, `gepa-scoring.mjs:101`); dynamic hard-negative weighting with 2-round stability gate + 0.05 noise floor + [0.1,2.0] clip, from round 5 (`gepa-scoring.mjs:193-194`, `eas.mjs:188-192`); EAS per-stratum windows (`p7-shared.mjs:44-49`), 0.02 deviation + 0.10 evidence-adequacy penalties with no-match exemption, `min`-across-targets aggregation (`eas.mjs:63,66-69,124,129`); length penalty `0.05×tokens/1000` (`eas.mjs:147`); `final_score = task×ef − length` (`eas.mjs:166`).
- **0.15 admission cap** computed relative to the **displaced incumbent** (anti-utopia §C1), strict `>` so a 0.15 drop is admitted (`eas.mjs:241-245`, `gepa-pareto.mjs:91-110`) — tested with both correct and wrong baselines.
- **Round-11 rebaseline** runs before scoring new mutations; every incumbent carries a score for rotated-in probes (`gepa.mjs:239-263`).
- **Durability primitives**: real `fsync` (`p7-persist.mjs:63-72`), atomic tmp+rename+dir-fsync (`:91-116`), crash-tolerant reader (`:125-139`); TPM math binds on tokens (`p7-token-bucket.mjs:61-74`).
- **Token validator**: all 6 §3.2.1 checks present; cannot pass a corrupted prompt (`token-validator.mjs`).
- **OP-2/OP-3/OP-4**: target-tagging + balanced-pair + hard-negative hint; AST-ification labelling + generator rotation; OP-4 guaranteed back-mapping + domain-stripping.
- **SCS ship gate**: uses **cw_SCS** (not naive) with the 0.6 paraphrase-accuracy floor (`scs.mjs:202-204,217-219`); AC/SS/LS/harmonic-mean correct.
- **Reasoning-HOMP gate fn**: reads held-out (not dev), 0.7× both classes (`p7-reasoning-homp.mjs:53,66,82`) — correct *as a function* (needs CC2 wiring).
- **Pre-flight**: fails closed on missing probes + low tier; pricing self-test; env-only keys.
- **Embeddings**: Gemini Embedding 2, 768-dim, SCS-only, not reused by operators.
- **Security**: zero hardcoded secrets across the tree; all keys from env.
- **Probe catalog + gold discipline**: 10 in-dist + 8 OOD languages, all 18 on-disk paths resolve, SHA-locked; smoke golds grep-verified; templates ship verify-by-grep TODOs; degrader bucket math 28/24/3/3 = 58; all 15 variants load.
- **Test suite**: 623 real tests, no fakes/skips.
