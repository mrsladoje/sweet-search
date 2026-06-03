# Task-Completion Benchmark — does sweet-search improve real SWE task RESOLVE-RATE?

**Status:** DESIGN v2 (post brutal-honesty review; execution-model crux resolved). Pilot is *plumbing-first*.
**Owner:** solo (user) + Codex/Claude-Code-Web review.
**Date:** 2026-06-02.
**Sibling of:** `docs/SYSTEM_PROMPT_OPT_PLAN.md` (the P7 retrieval campaign). This is the *task-completion* successor: does the per-exploration retrieval edge measured in P7 **compound** into higher end-to-end task success?

> **v2 changelog (what the review caught):** (C1) ss-* is NOT a portable binary — it needs the whole sweet-search repo + native models + a *pre-built per-repo index* (61–524 MB) + a running server (verified in `eval/agent-read-workflows/bin/_ss-helpers.mjs`), so "drop ss-* as a container bundle" was false; **execution model is now §3, the central decision.** (C2) binary resolve-rate + ~2–5pp expected effect ⇒ headline needs **hundreds–low-thousands of tasks**, not "180 to match P7"; **pilot is plumbing, not signal.** (H1) cheap model × hard multilingual = floor effect ⇒ **pilot is Python-only.** (H2) multilingual ∧ post-cutoff is never jointly satisfied at pilot scale — disclosed, deferred to headline. (H3) SWE-agent's ACI ≠ rg+Read and M++ may not transfer to its prompt grammar — **pilot harness is a controlled DeepSeek edit loop we fully own.** (M1) index cold-start tax is one-sided — prebuild + prewarm parity. (M2) three different grading harnesses, not one. (M3) pin Python 3.12; no-model-coexistence + reap leaked daemons before any ss-* run.

---

## 0. Motivation & hypothesis

P7 measured M++ (sweet-search policy + `ss-*`) vs native rg+Read on **single-shot retrieval** (60-probe, 18-lang blind vault, 3-panel judge, paired ≥3 reps, bootstrap CIs, real harnesses): significantly fewer tool calls on both frontiers (−49% GPT-5.5/Codex, −18% Opus) at near-parity accuracy, no speed/cost penalty; benefit scales **inversely** with the host agent's native retrieval efficiency.

That is all *retrieval*. It does not show better retrieval → better **task completion**.

**H1 (directional, pre-registered):** In a multi-step task the agent explores *repeatedly*; sweet-search's per-exploration edge **compounds** → smaller/cleaner context → delayed compaction → maintained coherence → fewer wrong turns → **higher resolve-rate**. Single-shot P7 numbers are a **floor**; the benefit should *grow* with task difficulty/length.

**H0 (reported straight):** task success is model-coding-ability-bound, retrieval delta washes out (CI includes 0).

**Secondary:** H2 cross-harness law carries over (Δ larger on GPT-5.5 than Opus); H3 Δ grows with difficulty; **H4 bad/low-adoption retrieval can be net-negative** (SWE-ContextBench `2602.08316`, CodeRAG-Bench `2406.14497`).

**Novelty:** the full chain `retrieval → cleaner context → delayed compaction → fewer wrong turns → resolve-rate` is supported *in pieces* in 2026 literature but never traced end-to-end for a coding agent with a controlled with/without ablation + CIs.

---

## 1. Decisions locked (2026-06-02)

| Decision | Choice |
|---|---|
| Bench vs build | **Use existing**, multilingual breadth (Multi-SWE-bench `2504.02605`) + post-cutoff Python slice (SWE-bench-Live `2505.23419` / SWE-rebench `2505.20411`); defer custom build |
| Harness | **Both** — but split by phase: pilot = a controlled DeepSeek edit loop we own; headline adds SWE-agent (causal) + production CLIs (Claude Code/Codex, ecological) |
| Pilot model | **DeepSeek-V4-Pro** via `DEEPSEEK_API_KEY` (zshrc) |
| Primary metric | **Deterministic F2P∧P2P** (NOT the 3-panel judge) |
| Placement | `eval/task-completion-bench/` (DDD: new bench harnesses live in `eval/`) |
| **Pilot job** | **PLUMBING validation + escape=0, NOT a powered result** (see §7 power) |
| **Pilot scope** | **Python-only** (floor effect kills multilingual signal at cheap-model scale) |

---

## 2. The ablation (paired, same task/seed/harness/model)

Two arms; the *only* changed variable is the retrieval layer — the P7 vault design with task = edit+test.

- **NATIVE arm:** no `ss-*`; native policy ("use rg/grep/find + read files"); the harness's own file tools.
- **SWEET arm:** `ss-*` available (host runtime, §3) + `Mpp.md` (deployed M++ = `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`) injected; native search still available but redirected (~100% adoption on strong models; **DeepSeek adopts ~100% on bare-API but only ~40% in opencode** — P7 finding, so pilot harness ≠ opencode).

We measure the **ecological** question ("does adding sweet-search help"), so native search is not force-disabled. SWE-agent (headline) additionally supports the strict counterfactual (omit `tools/search`). Precedent for hold-everything-fixed-toggle-the-retriever: RepoGraph `2410.14684` (+2.0–2.66pp across 4 base systems — **effect sizes are small**, see §7), Agentless `2407.01489`, oracle-vs-BM25 `2310.06770`.

---

## 3. Execution model — THE crux (where ss-* runs vs where tests run)

`ss-*` is **not** a portable binary. `_ss-helpers.mjs` requires: (a) a pre-built `.sweet-search/codebase.db` per repo (else exit 2), (b) `import` of the whole `core/search/*` tree at a fixed relative path, (c) a model-loading server over a unix socket. So the SWEET arm needs the **sweet-search host runtime + a per-repo index**, which a fresh task Docker container does not have.

**Resolution — separate exploration from grading:**

| Concern | Where it runs | Why |
|---|---|---|
| Agent **explore + edit** (incl. ss-*) | **Host**, on an isolated checkout at `base_commit` | ss-* works natively here (proven in P7); index prebuilt off-clock |
| **Grading** (apply pred + test_patch, run F2P/P2P) | **Official bench harness** (Docker for SWE-bench/Multi-SWE; venv only where trivial) | gold patch + test_patch live *only here*, never on the host checkout the agent sees → the worst leak is structurally impossible |
| Agent **mid-loop test runs** | **explicit choice per phase** (see below) | the real knot; not assumed away |

**Mid-loop testing** (a coding agent must run tests to iterate; blind-edit → near-floor resolves → no signal):
- **Pilot (Python):** create the per-repo env on the host (venv from the SWE-bench-Live/Lite install spec) so the agent can `pytest` during its loop; final grade re-runs the same tests after applying `test_patch`. Cross-check a sample against the official Docker grade to confirm host==Docker verdicts.
- **Headline (multilingual):** agent runs tests via `docker exec` into the task image (toolchains live there); ss-* still runs host-side against the mounted checkout. (Engineering cost is real — this is the headline's main build item, not the pilot's.)

**ss-\* host runtime requirements (pilot):**
- Reap leaked sweet-search daemons + stale sockets first (no-model-coexistence rule; 19 sockets + a live `--serve`/maintainer observed 2026-06-02).
- Per task: checkout repo → `/tmp/ss-eval/<taskId>` (path-opaque, **outside our project tree** so the agent can't infer/escape to our gold files) → **prebuild the index off-clock** (`SWEET_SEARCH_PROJECT_ROOT=<checkout> node core/indexing/index-codebase-v21.js --full --sqlite-fast`) → **prewarm** the server → then run measured arms. Index build time/disk is charged to neither arm (off-clock), matching cc-batch's prewarm fix.

**Headline ss-\* in containers (deferred):** bundle Node + the sweet-search repo + **CPU-ORT INT8 models** (the Linux-safe path, `project_cpu_fallback_ort_int8`) into a derived image, or run ss-* host-side with the checkout bind-mounted and tests via `docker exec`. Decide at P3; do not block the pilot on it.

---

## 4. Harnesses

### Pilot — a controlled DeepSeek edit+test loop we own (`p7-api-task-runner`)
Why not SWE-agent for the pilot: its ACI (`search_file`/windowed `open`) is its *own* native retrieval (≠ rg+Read), and M++ was tuned for Claude/Codex/opencode grammars, not SWE-agent's ReAct format → a non-faithful sweet arm + a muddier native baseline (review H3). For a *plumbing* pilot we want full control and a faithful M++.
- Extend `core/prompt-optimization/sweep/p7-api-agent-runner.mjs` (today: Bash-read-only + Read) with **Write/`apply_patch` + a `run_tests` tool**, confined to the checkout; ss-on/off via the existing `allowSweetSearch` gate + `sweetSearchBinDir`.
- DeepSeek direct (`deepseek/deepseek-v4-pro`, key from env). Note `max_tokens ≥ 4096` for reasoning (`project_deepseek_max_tokens_reasoning`).
- Emits a unified diff (prediction) + trajectory + usage. Reuses the runner's cache-naive/realized accounting.

### Headline (later) — both, for two distinct claims
- **SWE-agent** (causal): `tools/search` omitted (native) vs a ss-* bundle + Mpp.md (sweet); strict counterfactual; multilingual; tests in-container.
- **Production CLIs** (ecological): Claude Code × Opus-4.8-xhigh (CLAUDE.md) + Codex × GPT-5.5-high (AGENTS.md), reusing `claude-runner.js`/`p7-codex-runner.mjs`. **opencode×DeepSeek is dropped** (≈40% adoption ⇒ no signal).

---

## 5. Task selection

- **Pilot (Python, plumbing):** ~15–25 Python tasks from **SWE-bench-Live** (post-cutoff; discloses DeepSeek-V4 cutoff) and/or SWE-bench Lite (cheap, well-trodden envs). Stratify by difficulty; include multi-file tasks (the compounding lever). Frozen into a **sealed manifest** (seed=42); never inspect per-task held-out results (`feedback_heldout_discipline_strict`).
- **Headline (later):** add Multi-SWE-bench multilingual strata + the post-cutoff Python slice, reported separately (multilingual and post-cutoff claims live in different cells — disclosed limitation).

**Honest scope of the pilot:** validates the pipeline (ingest → host explore/edit + ss-toggle → grade → metrics → escape=0) and surfaces gross direction; it is **underpowered for the real effect** (§7) and **multilingual/contamination claims are out of pilot scope**.

---

## 6. Grading (deterministic) — three adapters, not one

Each substrate has its own harness, image namespace, and prediction format:
- **SWE-bench / SWE-bench-Live:** `swebench.harness.run_evaluation` (Python 3.12 venv; Docker images). Live has its own image set.
- **Multi-SWE-bench:** the `multi-swe-bench` package (`mswebench`), per-language images.
- Predictions normalized to each harness's schema by a thin adapter; resolve = F2P all pass ∧ P2P all pass.

Report **pass@1 and pass^k** (reliability). Collateral damage (secondary): P2P regression rate; whole-suite regression on a subset (default harness only tests test-patch files — Epoch AI; `2503.15223`); patch locality (files/hunks/lines). Pilot may grade Python on the host venv **and** spot-check N against the official Docker grade to certify host==Docker.

macOS/arm64: Python images emulate acceptably (interpreted); compiled-toolchain langs (C/C++/Rust/Go) may lack arm64 images or break under qemu → **headline Docker grading likely needs a Linux/x86 box**, not this Mac. Pilot avoids this by being Python + host-venv.

---

## 7. Metrics & statistics

**Primary:** resolve-rate (F2P∧P2P); pass^k.

**Efficiency / exploration mediators:** tool calls; steps-to-first-edit (`ρ=+0.68` context-before-editing helps, `2604.02547`); redundant-read rate (novel, SWE-Effi token-snowball); tokens **cache-naive AND realized $**; SWE-Effi `2509.09853` **EuTB/EuCB/EuITB** + expensive-failure ratio + regression-normalized time `t=1.457+4.27e-5·inTok+5.0e-3·outTok`; peak context tokens; time-to-first-compaction; patch-fail-spiral rate (`ρ=−0.78` patch-on-step-1, `2604.02547`).

**Statistics:**
- Paired (same task/seed both arms); **McNemar / clustered paired bootstrap 95% CIs by repo** (Miller `2411.00640`).
- **Control for difficulty** before any length claim (length↔difficulty confound, `2604.02547`).
- **Power (the review's C2 — do this BEFORE the headline):** binary outcome, expected effect small. RepoGraph-class ≈ +2pp; if our compounding thesis holds expect larger, but plan for small. Rough McNemar sizing at baseline p≈0.25: detecting **+5pp at 80% power ≈ 600–900 tasks**; **+2pp is out of reach** at feasible N. ⇒ The headline N is set by a power calc on *pilot-observed discordance*, and we **pre-commit to possibly concluding "effect smaller than detectable at feasible N"** (a real result). "≥180 to match P7" is **retracted** (P7 was continuous metrics).
- ≥3 reps; **no optional stopping**; significant only if CI excludes 0; pass^k not just pass@1.
- Pre-registration frozen + git-tagged before headline (P7 `prereg/` pattern).

---

## 8. Scaffolding — `eval/task-completion-bench/`

```
eval/task-completion-bench/
  README.md
  PREREGISTRATION.md
  tasks/
    swelive-python.sealed.json     # pilot: frozen Python instance IDs (seed=42)
    ingest.mjs                     # bench JSON → our schema; writes sealed manifests
  env/
    reap-daemons.mjs               # reap leaked ss-* servers/sockets (no-coexistence)
    checkout.mjs                   # clone repo@base_commit → /tmp/ss-eval/<id> (isolated)
    build-index.mjs                # off-clock ss index prebuild + prewarm (parity)
    make-venv.mjs                  # per-repo Python venv from install spec (pilot grade)
  harness/
    api-task-runner.mjs            # DeepSeek edit+test loop (extends p7-api-agent-runner)
    swe-agent/ {native.yaml, sweet.yaml, bundles/sweet-search/}   # HEADLINE (later)
  grade/
    grade-swebench.mjs             # wraps swebench.run_evaluation (Live/Lite)
    grade-mswebench.mjs            # HEADLINE (later)
  audit/
    task-escape.mjs                # leakage guard (§9): future-ref git log, test/conftest, out-of-checkout paths
  stats/
    task-stats.mjs                 # resolve, pass^k, EuTB, mediators, McNemar + paired bootstrap
  results/
    <run-id>/{native,sweet}/rows.json
```

**Reuse map:**
| Need | Reuse |
|---|---|
| Agent loop base (Bash/Read + tool plumbing, cache-naive+realized usage) | `core/prompt-optimization/sweep/p7-api-agent-runner.mjs` |
| Policy injection (Mpp / native string, SS_BIN toggle, allowSweetSearch) | same + `scripts/oc-batch.mjs` patterns |
| ss-* CLIs + index build | `eval/agent-read-workflows/bin`, `core/indexing/index-codebase-v21.js` |
| Escape audit (`ABS`/`ANSWER`/`analyze`) | `scripts/audit-escape.mjs` |
| Paired bootstrap | `scripts/vault-stats.mjs` |
**Drop for this bench:** `resolveRepoCwd` nested repos (use isolated `/tmp` checkouts + Docker grade) and the 3-panel judge for the *primary* metric.

**Row schema:** `{ runId, taskId, source, lang, difficulty, arm(native|sweet), rep, model, harness, resolved, f2p, p2p, p2pRegressions, calls, stepsToFirstEdit, ss, nativeGrep, redundantReads, patchFiles, patchHunks, tokens, costNaiveUsd, costRealizedUsd, wallMs, normTimeS, peakContextTokens, escape, leak, exitCode, timedOut, gradeSource(host|docker) }`

---

## 9. Leakage guard

Docker grading **structurally** isolates the answer: per-instance image at `base_commit`; gold patch + `test_patch` applied only at grade time, outside the agent's host checkout → the answer files are simply **not on the filesystem the agent sees** (this kills the P7 nested-repo escape). Residual holes (research-confirmed): git-history leakage (`git log --all`/reflog/tags → future fix commit; SWE-bench #465/#471 → strip post-base refs + block in sandbox); conftest.py reward-hack (flag agent-created/edited test-collection hooks); answer-in-issue (~32% historically; treat as covariate); weak tests (`2503.15223`, SWE-ABS `2603.00520` → whole-suite on a subset for the headline). **Run `task-escape.mjs` on every trajectory; audit, don't assume** (P7: thin harnesses escaped, rich ones didn't).

---

## 10. Phased plan & checkpoints

- **P0 (no compute):** design + scaffolding code + sealed manifest + escape audit + stats. ← writing now.
- **P1 (mechanical smoke, minimal compute):** reap daemons; build the DeepSeek edit+test loop; validate the **whole pipeline on 2–3 tasks** end-to-end (checkout → index → ss on/off → edit → host grade → metrics → escape=0). Cheapest possible; proves plumbing.
- **P2 (cheap Python pilot):** DeepSeek-V4-Pro, ~15–25 Python tasks × 2 arms × 1 rep, concurrency=1. Plumbing + escape=0 + variance estimate for the power calc. **Not powered for the effect.**
- **P3 (decide):** aggregate-only read; **power calc → pre-register headline N**; solve the in-container ss-* (or host+docker-exec) question; Codex review.
- **P4 (headline, gated):** Opus + GPT-5.5 + SWE-agent, multilingual + post-cutoff, ≥3 reps, sealed manifest, prereg tag, likely on a Linux/x86 box.

**Hard checkpoints (ask first):** before P4 (frontier spend + large N) and before any multilingual Docker build. P1/P2 are cheap DeepSeek + host execution — proceed once daemons are reaped.

---

## 11. Risks & open questions
- **ss-* in containers** (headline) is unsolved engineering — host+`docker exec` vs bundled CPU-ORT image; decided at P3, not blocking pilot.
- **Underpowered headline** if the true effect is RepoGraph-class (+2pp) — pre-commit to reporting "below detectable" honestly.
- **Floor effect** — DeepSeek may resolve few tasks; pilot is plumbing, signal needs a capable model + solvable tasks.
- **Multilingual ∧ post-cutoff** never jointly covered until headline — disclosed limitation.
- **Host-grade ≠ Docker-grade** risk for Python envs → certify with a Docker spot-check sample.
- **Machine contention / no-coexistence** — reap leaked ss-* daemons before runs; arm64 emulation pushes headline Docker grading to a Linux box.
- **M++ prompt transfer** to SWE-agent grammar (headline) — validate adoption before trusting that arm.

---

## 12. Key citations
Benchmarks: SWE-bench `2310.06770`; Multi-SWE-bench `2504.02605`; SWE-PolyBench `2504.08703`; SWE-bench-Live `2505.23419`; SWE-rebench `2505.20411`; SWE-bench Pro `2509.16941`; SWE-Bench++ `2512.17419`. Ablation/retrieval: RepoGraph `2410.14684`; Agentless `2407.01489`; OrcaLoca `2502.00350`; LocAgent `2503.09089`; CodeRAG-Bench `2406.14497`; SWE-Search `2410.20285`. Metrics/stats: SWE-Effi `2509.09853`; HAL `2510.11977`; AI Agents That Matter `2407.01502`; SWE-ContextBench `2602.08316`; Beyond Resolution Rates `2604.02547`; Lost-in-the-Middle `2307.03172`; Miller Error Bars `2411.00640`; Are Solved Issues Really Solved `2503.15223`. Leakage: SWE-bench #465 / #471; SWE-ABS `2603.00520`. (2026-dated IDs lightly corroborated — verify before formal citation.)
