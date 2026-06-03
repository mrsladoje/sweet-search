# Metric Forge — Phase 4 IMPLEMENT report: the `USD` tool-response usefulness metric

**Author:** metric-implementer (Opus), 2026-06-03. Implements
`core/prompt-optimization/data/metric-forge/final-spec.md` (the Phase-3 hardened
spec). Status: **metric implemented + unit-tested (incl. all red-team gaming
cases) + capture path built + end-to-end PILOT run on 3 probes proves the whole
path.** No commits. No fake data — the pilot numbers below are from real
DeepSeek-V4-Pro agent runs + a real disjoint-family judge panel (DeepSeek-direct
+ Gemini-direct).

---

## 1. Files changed / added

| File | Change | Lines |
|---|---|---|
| `core/prompt-optimization/sweep/usd-metric.mjs` | **NEW** — the whole metric: rubric (§9.2 verbatim), `stripChrome`/`artifactFilter`→`R_judge` (§5d), `snapSpan`+`balancedNodeRange`+`computeDensity` (the §5a DIV-4 programmatic numerator), `densityMultiplier`/`composeUSD` (§2 shaper), `groundingPrecheck` (§3), `scoreNoMatch` (§3.1), `aggregatePanel`/`scoreUSD` (§4/§7.2), `caliperMatchedDelta`+`pairedBootstrapCI` (§5b headline), `usdPanelScore`+`parseUsdVerdict`+`buildUsdJudgePrompt` (§9.1/§9.2 judge wiring), `computeRubricHash` (§9.5). | ~470 |
| `tests/unit/prompt-optimization/usd-metric.test.js` | **NEW** — 39 unit tests incl. all §13 required-green gaming cases (G1–G9). | ~470 |
| `scripts/usd-capture-pilot.mjs` | **NEW** — capture+score pilot: runs BOTH arms, persists raw tool outputs verbatim (§7.1), scores with the USD panel (§7.2), reports the §5b caliper-matched paired Δ. | ~210 |
| `core/prompt-optimization/sweep/p7-api-agent-runner.mjs` | **EDIT** — opt-in `req.captureToolResults`: attaches each tool call's verbatim RESULT (`{isError,content}`) onto the `tc` so the metric can score the tool RESPONSES (not the final answer). Default off ⇒ byte-identical frozen baselines (verified: existing 42 `p7-evaluate` tests still green). | +2 |

**How to run.**
- Unit tests: `npx vitest run tests/unit/prompt-optimization/usd-metric.test.js`
- Pilot: `PILOT_IDS="cpp-001,cpp-006,csharp-002" RUN_ID="pilot-run1" node scripts/usd-capture-pilot.mjs`
  (uses `DEEPSEEK_API_KEY` + `GEMINI_API_KEY`; DeepSeek always direct; conc=1; reaps `cli.js --serve`/`index-maintainer` between probes).

**Design choices honoring the spec + the environment:**
- **DIV-4 numerator is programmatic (the crux).** `snapSpan` bounds the density numerator by the answering node, not by judge citation. To avoid the OOM risk the vitest config flags (loading 18 tree-sitter grammars), `balancedNodeRange` is a dependency-light brace/indent-balanced node finder — this is the spec §5a clause-(b) AST *approximation* and it also covers the 5 OOD grammars via the same path (spec residual risk B11). Gold C^G line ranges, when present, cap the node length (clause a); the line-level floor is clause (c).
- **C^G not yet annotated on the vault** (the probes ship `expectedFiles/Symbols/Facts` but not `{file,startLine,endLine}` gold spans). The metric degrades gracefully to the clause-(c) line-level floor + symbol/fact anchoring. **The C^G annotation on all 60 (spec §6) is the remaining gating input before the powered run.**
- **2-judge disjoint panel for the pilot** (`deepseek-api` + `google-api`): `MINIMAX_API_KEY` (the 3rd default panelist) is unset on this box. Both are non-Claude, disjoint families — honors "no Claude-family sole judge" + the budget feedback (route batch judging through DeepSeek/Gemini direct). The powered run restores the 3-panel once minimax is keyed.

---

## 2. Unit-test results (39/39 green, incl. every gaming case)

`npx vitest run tests/unit/prompt-optimization/usd-metric.test.js` → **39 passed**.
Combined with the existing `p7-evaluate.test.js` (42) → **81 passed** (the runner
edit is non-breaking).

The §13 required-green gaming assertions (each maps to a §10 guarantee):

| Guarantee | Assertion proven |
|---|---|
| **G1 verbosity never rewarded** | Appending a 60-line irrelevant real block to a correct compact response **drops USD by ≥0.30** (`compact.USD − padded.USD ≥ 0.30`); a padded response with purity docked scores **0** and loses to the compact one. |
| **G2 terse native not penalized** | A terse-correct native answer (`hwy/...:380:#define HWY_NAMESPACE N_AVX3`) gets `purity_ratio ≥ 0.85` and `USD > 0.9` — NOT docked for being short. |
| **G3 gap survives length-matching or is dropped** | Disjoint-token-support synthetic arms ⇒ `lengthMatchable:false`, `deltas:{}`, claim withheld (no extrapolation). Overlapping support ⇒ matched paired Δ with a paired-bootstrap CI is returned. |
| **G4 symmetric** | Byte-identical content (ss-chrome-wrapped vs bare native) ⇒ `purity_ratio` within 0.15; ss chrome NEVER enters `used_tokens` (stripped before judging); native code NEVER dropped by `artifactFilter`. |
| **G5 format can't buy score** | `stripChrome` removes route-meta/confidence/rank#/tier-label/score but KEEPS the `path:line` locator + code; idempotent; no-op on the native arm. |
| **G6 under-answering penalized** | A truncated capture (D2=0 truncation-marker, D5=0 gold-not-covered) has lower `content` AND lower USD than the full one. |
| **G7 citation can't be spoofed (the B1 crux)** | A 1000-line whole-file dump cited whole **snaps to the answering node** (`snapped.length < rJudge.length/5`, `<10` lines); the dump's `purity_ratio < 0.2` and it **does NOT beat** a 3-line terse answer. A v:1 with a non-substring span is demoted to 0 at aggregation. |
| **G8 no-match can't be context-bombed** | A terse "no match found" keeps `USD ≈ 1`; a 15k-token dump on a no-match probe collapses `USD < 0.05`; a confident false-positive code block naming the fabricated symbol ⇒ `g=0`, `USD=0`. |
| **G9 no mid-run drift** | Any edit to φ/α/τ/θ_floor changes `rubricHash`. |

Plus structural unit tests for `balancedNodeRange`, `snapSpan`, `computeDensity`,
`groundingPrecheck`, `parseUsdVerdict`, `medianBinary`, `pairedBootstrapCI`.

---

## 3. PILOT — real end-to-end run (N=3, run-id `pilot-run1`)

Probes: `cpp-001` (literal-lookup), `cpp-006` (multi-file-flow), `csharp-002`
(literal-lookup). Agent = DeepSeek-V4-Pro bare-API direct (reasoning=high),
conc=1. Both arms captured verbatim + scored. `rubricHash=0x46dea0229bdd7370`.

### 3.1 Per-probe scores

| probe.arm | g | content | content_noD3 | C (purity) | purity_ratio | tot/used tok | USD |
|---|---|---|---|---|---|---|---|
| cpp-001.ss | **0** | 0.40 | 0.50 | 0 | 0.011 | 918/9 | 0.000 |
| cpp-001.native | 1 | 1.00 | 1.00 | 0 | 0.011 | 1307/14 | 0.000 |
| cpp-006.ss | **0** | 0.60 | 0.50 | 0 | 0.003 | 3649/12 | 0.000 |
| cpp-006.native | 1 | 0.60 | 0.50 | 0 | 0.051 | 942/48 | 0.000 |
| csharp-002.ss | 1 | 0.60 | 0.75 | 0 | 0.033 | 969/32 | 0.000 |
| csharp-002.native | 1 | 0.60 | 0.75 | **1** | 0.044 | 567/14 | **0.151** |

### 3.2 Aggregate + headline (§5b caliper-matched paired Δ on common support)

- per-arm mean USD: **ss 0.000**, **native 0.050**; mean `content_noD3`: ss 0.583, native 0.750; mean tokens: ss 1845, native 938.
- common support: ssSupportFrac 0.67, natSupportFrac 0.33 → **length-matchable** (2 matched pairs).
- matched paired Δ (ss − native): `content_noD3` +0.125 CI [0, 0.25]; `content` −0.10 CI [−0.20, 0]; `USD` 0 CI [0,0]. **All CIs include 0 → no significant ss edge at N=3** (expected: N=3 has no power; the headline is the N=60 powered run).

### 3.3 Honest findings the pilot surfaced (the point of a pilot)

1. **The whole path works.** Both arms' raw tool outputs are persisted verbatim
   (`captures/pilot-run1/*.{ss,native}.json`), scored, and the §5b
   caliper-matcher + paired-bootstrap CI + common-support gate all run on real
   data and produce the §7.2/§7.3 objects.

2. **The symmetric grounding floor fires and native legitimately WINS it.** On
   cpp-001 and cpp-006, ss-search returned the **wrong region** (e.g. for
   "where is HWY_NAMESPACE set to N_AVX3" it returned `targets.cc` namespace
   `x86`, not `set_macros-inl.h`), so `g=0` zeroed ss while native (readGoldRecall
   1.00) got `g=1`. This is the anti-strawman / symmetric behavior the spec
   demands and it proves the metric can **refute** the ss-favorable thesis — it
   is not rigged for ss.

3. **`signal_purity` (C) collapses to 0 on 5/6 episode-level responses — a real,
   pre-commit-worthy issue, NOT tuned away.** The hard multiplicative gate
   `USD_raw = g·C·content` then zeroes USD for everything except one probe. C is
   genuine judge behavior: an episode is the concatenation of multiple tool
   calls (incl. full-file reads), so "essentially all of the response is
   on-target" (the C=1 bar) is almost never met by either arm at episode
   granularity. **This is the metric behaving exactly per spec**, but it means at
   episode granularity USD is dominated by the C-gate. Two principled responses
   (for the designer/user, NOT a silent tune):
   - the spec's own **§5c padding-reliability-probe calibration of (φ,α) and the
     C-gate is the mandated gate before the powered run** — run it on the
     24-probe dev subset; if the C multiplicative gate can't be made to
     discriminate (vs collapse-to-0), the spec's **DIV-2 fallback** (report USD
     with AND without the purity term) applies; and
   - the **`content_noD3` and the §5b matched Δ on it** (which are NOT C-gated)
     already carry usable signal and are the spec's designated density headline —
     so the C-collapse does not destroy the comparison, it just argues for
     reporting `content_noD3` (and possibly a softened/additive C in v2) as the
     load-bearing density claim.

4. **`purity_ratio` is uniformly low (0.003–0.051)** because `R` is the full
   episode (including 1300+-token full-file reads) while the snapped answer node
   is ~10–50 tokens. For native this is arguably *correct* (reading a whole file
   to find a one-line answer is low-density), but the magnitude shows the
   balanced-node snap is conservative and the **(φ,α) calibration matters** — at
   `pr≈0.04` the shaper multiplier is ≈0.25 (the floor), so the density term is
   pinned at the floor for nearly all real responses. The §5c probe must confirm
   the shaper still *discriminates* padded-vs-clean at realistic `pr` ranges, or
   the shaper is demoted to analysis-only per DIV-2.

**None of these is fixed by tuning to the pilot** (held-out discipline, and N=3
is unpowered). They are reported as the pilot's job: surface the calibration
work the spec already mandates (§5c, §6 C^G annotation) before the $-powered
60-probe run.

---

## 4. Honest verdict (at pilot scale — NOT a publishable claim)

- **Does the implemented metric run end-to-end on real data?** Yes — capture
  (verbatim, both arms) → strip/filter → disjoint-panel judge → programmatic
  AST/gold-snapped density → composed USD → caliper-matched paired Δ with CI +
  common-support gate. All §7 artifacts are produced.
- **Is it hard to game / symmetric / length-controlled?** Yes, proven by the 39
  unit tests including the B1 whole-file-cite crux, the ≥0.30 padding drop, the
  terse-native-not-penalized case, the byte-identical-symmetry case, the
  disjoint-support claim-withheld case, and the no-match context-bomb case.
- **Does ss carry significantly more signal at matched size?** **Not
  established at N=3 (no power, all CIs include 0); and on this slate the
  grounding floor + content actually favored NATIVE** (ss returned wrong regions
  on 2/3). This is the correct, non-rigged behavior — the powered N=60 run +
  Layer-B downstream validation is what decides the thesis.
- **Blocking inputs for the powered run (Phase 5):** (a) annotate C^G on all 60
  (spec §6); (b) run the §5c (φ,α)/C-gate reliability-probe calibration on the
  24-probe dev subset and decide DIV-2 (in-scalar vs analysis-only purity); (c)
  key minimax (or pick a 3rd non-Claude family) to restore the full 3-panel; (d)
  pre-register N/reps/params/falsifier + git-tag the prereg before spending.

**Artifacts:** captures `core/prompt-optimization/data/metric-forge/captures/pilot-run1/`,
scores `…/scores/pilot-run1/`, summary `…/pilot-summary-pilot-run1.json`.
