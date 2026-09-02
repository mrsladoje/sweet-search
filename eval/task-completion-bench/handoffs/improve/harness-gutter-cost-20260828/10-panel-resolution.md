# Panel review — lane p3: levers, fairness and run design (2026-08-28)

**Object.** `09-synthesis-draft.md` and its evidence files `01`–`08`. Role: refute. Default verdict when I could
not verify a claim myself is *weakened*.
**Method.** Read-only over the box (`/tmp/fp-inv/p3/`), the local repo, the discard logs (`SLATE-A-UBER.md` §9,
`SLATE-B-UBER.md` §8), every prior gate result in `handoffs/improve/`, the `lever3-eviction` and turnfix handoffs,
and the memory notes that state the fairness rules. Two new scripts: `scripts/p3-power.py` (local; output
`logs/p3-power.txt`) and `scripts/p3-ops-per-envelope.mjs` (box copy `/tmp/fp-inv/p3/`; output
`logs/p3-ops-per-envelope.txt`). Tags: **[M]** measured (script and numbers named) · **[C]** read from source, a
binary or a contract · **[I]** inferred · **[W]** web source.

Plain glosses for names used below: "the guide" = the sweet-search tool guide appended to `AGENTS.md`/`CLAUDE.md`
(the M± text); "TAB/NONE/PIPE" = the three `ss-read` line-number forms; "epoch A/B/C" = the 2026-08-11,
2026-08-24/25 and 2026-08-26/27 runs; "the bar" = the pre-registered ≥ 6 solved rollouts of 66.

---

## 0. Verdict

**The draft's measurements mostly hold. Its lever list and its next run do not.** Three findings decide it:

1. **The guide-shrink lever (C2, the proposed next run) is not new and is outside user-authorised scope.**
   [C] `handoffs/lever3-eviction/PREAMBLE-TRIM-GATE.md` (2026-08-10) measured the same +1,457 tokens (4.1% of the
   sweet arm), trimmed the tool docs at `$0`, netted 23 tokens (0.07%), and ruled that a material saving means
   "deleting ~25 of 30 rules — a solve-safety question needing per-rule ablation, not a trim". The user's
   authorised scope that day was "split the 1457 tokens; the guidance block is NOT trimmed". The draft's
   "nobody has removed it" is wrong, and a hand-written 200-token replacement breaks the standing rule that the
   guide is used verbatim and changes only through the prompt process (`project_mpm_delivery_via_memory_file`).
2. **The proposed run cannot answer its own bars.** [M] `p3-power.py`: 16–17 of the 22 tasks are solved in every
   arm or dead in every arm, so the resolution bar rides on 15–18 rollouts per harness. A treatment that loses one
   solve in four on those tasks crosses the bar only 8–19% of the time; halving them, 40–50%. Bar 2's thresholds
   (Δturns ≤ +1.0, Δoutput ≤ +10%) sit inside the spread of the three sweet forms, which are the same treatment:
   turns differ by 1.3 (opencode) and 1.8 (claude-code); claude-code output differs by 36%. The run would be
   decided by noise on two of three harnesses.
3. **The run design misses four preconditions.** [M][C] No control task ran in the fresh pool (0 hits for the five
   fixed controls in all 12 pilot logs); `rows.json` records no harness version or API path while a harness-side
   change is the draft's own explanation of the codex flip; the index fix R1 is inert unless the b2 goldens are
   rebuilt (`idxSource: golden-cache`, goldens dated 2026-07-16); and the ledger fingerprint hashes only the
   `run_tests` shim text, so "re-swept green" gates neither the wrapper fixes nor the index change.

The delimiter conclusions (keep `N<TAB>`, nothing ships) survive this review. The `$0` hygiene and index fixes
survive as correctness work. Everything the draft wants to buy with money is either closed on record, below the
detection floor, or not the question the user asked.

---

## 1. Verdicts on the twenty claims

| # | verdict | what I re-derived or re-read |
|---|---|---|
| 1 | **upheld** | [M] arithmetic: 878 delivered lines × 1.341 tok/line = 1,177 ≈ 1,163 gutter tokens (`03` §2.1); 1,163 × $0.10/M = $0.000116 ingest and ≈16 re-sends × $0.01/M = $0.000186 resident, both as printed. Ratio to the earlier estimates is 2.3–3.3×, not "2.5–4×". Token counts not re-tokenised by me. |
| 2 | **upheld** | [M] 0.000217/0.000424 = 51%; 0.000217/0.000302 = 72%. The +0.93 tokens/line ties two independent measurements: delivered blocks (`03`) and golden files (`GUTTER-MECHANISM` §5.4). |
| 3 | **upheld** | [M] Fisher re-derived: 8/61 vs 0/62 → p = 0.0029; 6/144 vs 0/195 → p = 0.0055. Bytes quoted in `04-claude-code` §2.1 and §3.3. 0 solves changed (moq 0/3 in every arm). |
| 4 | **upheld** | [M] Fisher re-derived: opencode rollouts-with-failure 0/66 vs 6/66 → p = 0.028. 3,911 + 3,885 = 7,796 anchor lines (`01` §2.1). [C] both seeks trim whitespace, so a carried space cannot fail them. |
| 5 | **weakened** | Not re-run. `logs/synth-readgate.txt` prints `shareEditsWithPriorRead 0.15` (85% without), consistent with 218/259. The gate string is [C] from the mechanism report, not re-read by me. |
| 6 | **weakened** | The cap is measured twice (2,459/2,511 tokens; 10,212–10,216 B). "Version effect" is [I]: epoch A ran on the OpenAI path (`custom_tool_call`), B/C on OpenRouter (`function_call`) — the envelope change can follow the transport path, not the version, and `rows.json` records neither. The replay is static; the draft itself calls +11.5% an upper bound. |
| 7 | **weakened** | [M] `p3-ops-per-envelope`: envelopes per step 1.546 native vs 1.106 sweet reproduce exactly, but **operations** per step are 1.683 vs 1.450 and sweet performs 28.6 operations per rollout against native's 27.5. The requests accounting (19.70 vs 16.32 steps, +3.38) stands; the "parallel vs serial" mechanism is the envelope-count artefact `TURN_PACKING_FINAL.md` §1.1 already settled. |
| 8 | **upheld** | [M] `degenReran` re-counted on the box: sweet 5/4/2 (TAB/NONE/PIPE), native 1; `rb-claudecode` 0/1; codex and opencode 0. The three price conventions are `02` §9.1's; not re-priced here. |
| 9 | **weakened** | Not re-derived. `02` §3.3 says 28 native delegating rollouts in epoch C, `03` §4 says 27. The +6.8% subset is post-hoc (`03` §10 says so). Direction across epochs is consistent. |
| 10 | **weakened** | [M] 1,457 tokens re-derived (`tiktoken o200k_base`, frontmatter stripped; the file says 1,307). Cost arithmetic ties. But the number is not new — `PREAMBLE-TRIM-GATE.md` (2026-08-10) records "measured 1457 in the live preamble diff" — and "larger than the whole observed gap on every harness" is false on claude-code inclusive (gap $0.001847 vs guide $0.000530); `06` §7.5 says it only for the main-only column. |
| 11 | **weakened** | [M] Per-rollout figures tie to `logs/synth-*wasted.txt` ($0.000294 / $0.000204 / $0.000373). "Zero behavioural risk" is overstated: a positional-path scope, an `-F` fallback and a not-indexed message all change what the agent does next. The saving prices a whole reacting request, an upper bound when the failed call sits inside a chained envelope (codex chains 40 of 102 reads with `&&`). |
| 12 | **weakened** | Not re-run. `logs/synth-statesum2.txt`: standalone `<state_summary>` turns 0.02 per rollout, 0.05% of the cell — consistent. The disposition is not new: the GEPA gen-3 codex challenge already recorded "`<state_summary>` not removable" (`project_p7_gepa_history_hub`). |
| 13 | **upheld** | [M] steps 19.70 vs 16.32 re-derived on the graded transcripts (+20.7%); envelopes 21.8 vs 25.2. The operation count adds that sweet does 4% **more** operations than native on opencode, so "13% fewer calls" is an envelope artefact there — which strengthens "does not pay". |
| 14 | **upheld** | [C] `ideal-cost.mjs` `costFromTurns` multiplies `cacheWrite` by 1.25 and `turnsFromRollout` emits `{in, cached, out}` only; `opencode-task-runner.mjs:160` folds `cache.write` into `in`; `claude-code-accounting.mjs:103` emits `cacheWrite`. |
| 15 | **upheld** | [M] Box: 321 `.jam` files on disk (16 under `src/build/`), `src/tools/stage.jam` present, `codebase.db` `vectors` 2,484 rows with 0 `.jam` and 0 `src/build/`. [C] `search.js:188` `'**/build/**'`; no `.jam` include glob. The +1/66 ceiling rests on native's one solve per harness (three single rollouts). |
| 16 | **upheld** | [M] codex leave-one-out re-derived: (22 × 0.000043 − 0.009396)/21 = −$0.000402 = −3.3% of $0.012287. Opencode not re-derived. 49/69 and 50/131 read from `04`. |
| 17 | **weakened** | Arithmetic ties (3.62 × 13,661 ≈ 49.4k; 7.32 × 7,345 ≈ 53.8k; +8.8%). But the native **median** output also fell (p50 3,236 → 2,625 B, `02` §3.1), which a ~10 kB cap cannot cause. Part of the per-call fall is not the cap. |
| 18 | **upheld** | Rates from `04-claude-code` §5.3. Flatness re-derived: rollouts-with-failure 18 vs 16 → p = 0.84; 17 vs 15 → p = 0.84 (the draft's 0.69 uses `03`'s 19 vs 16 census). All flat. |
| 19 | **upheld** | [M] Re-summed `costRealizedUsd` on the box: codex $3.2797, opencode $3.2274 (incl. repair pass and deleted rows). FRESH-POOL §1's twelve cells re-sum to $10.877. The claude $5.25 reconstruction not re-derived. |
| 20 | **upheld** | `03` §5 intervals re-read. [M] `p3-power.py` adds the resolution side: task-bootstrap null spread 1–2.6 rollouts, false-kill ≤ 1% per harness, power 8–19% against a 25% relative loss on the discriminating tasks. No affordable run ranks the forms. |

---

## 2. Every lever, against the record

### 2.1 Cost levers

**C1 — `ss-*` hygiene package.** Not in either discard log [C]. New instance, known class: the BRE `\|` bug is on
record since 2026-07-14 (`project_failure_forensics_review_2026_07_14`) and its hint shipped without a retry.
Numbers tie to the logs [M]. Two corrections: (a) "zero behavioural risk" is wrong — accepting a positional path,
falling back to `-F`, and printing `not indexed` each change the agent's next action, which is the point; call it
low risk and keep the `$0` replay falsifier. (b) The `scopedNoMatch` class overlaps C3/R2 — 49 of the 69 scoped
empty results on claude-code are the two b2 tasks — so C1 and C3 must not be summed. Disposition: **ship as
correctness, no A/B needed** — the draft says this and is right.

**C2 — shrink the guide to a tool list.** **Already gated and dropped.** [C] `PREAMBLE-TRIM-GATE.md`, 2026-08-10:
"+1457 tokens = 4.1% of the sweet arm's ideal spend"; tool-doc trim at `$0` netted 23 tokens (0.07%), ceiling 74
(0.21%), "two orders of magnitude below the detection floor (±37%)"; "realising a material share would mean
deleting rules, not rewording them — roughly 25 of the 30 — a solve-safety question, not a cost question … a
per-rule ablation programme, not a trim". Authorised scope that day: "**the guidance block is NOT trimmed**".
`project_eviction_nogo_cachebreak_gate`: "cost story has NO remaining context-side levers." The draft's
discard-log check looked only at the two slate logs and missed this. Its "sweet-min" arm is exactly the
"delete ~25 of 30 rules" option, hand-authored. Fairness: the guide is produced by the prompt-optimisation
process and used verbatim; every addition since (stop discipline, verdict-gated trust +46 tokens, fix-surface +87
tokens) shipped on a measured smoke (`project_mpp_shipped_2_5_3`, `project_mppppp_conditional_trust_candidate`,
`project_p2_fix_surface_candidate`). A hand-written replacement discards them untested. The only admissible
vehicle is the prompt process with a length term — its scoring already carries `length_penalty` and a dual Pareto
[C] frontmatter, `project_p7_gepa_history_hub`. **Disposition: closed as proposed; re-open only through the prompt
process, and only after the per-rule ablation the gate asked for.**

**C3 — "not indexed" plus `.jam`/git-aware excludes as a cost lever.** Same mechanism as R1/R2 (below). The turn
excess on b2 is real [M] and the stop-rule family is dead on record (`project_thrash_levers_nogo_no_doomed_tail`),
so the upstream fix is the right shape. Ceiling is two tasks of 22; it moves the pool mean, not the product.

**C4 — parallel-friendly `ss-*` calls on opencode.** **Closed in every form the draft names.** [C]
`TURN_PACKING_FINAL.md` §0: "ss-batch free-argument batching — CLOSED on Grok-4.5; 3/4 traps under hardened guard;
dependent args require executor substitution; re-screen per backbone allowed (~$0.80)"; "prose packing prompts —
CLOSED, no new spend without a qualitatively new MECHANISM"; "mid-task advisory — 3-for-3 channel-deaf".
`TURN_FIX_PLAN.md`: "Scope decision (user, 2026-07-31): the MCP surface is out of this program." The draft calls
MCP delivery "not closed"; the user closed it. [M] The ceiling is also half what the draft says: at the operation
level sweet runs 1.450 ops per step against native's 1.683 (`p3-ops-per-envelope`); packing sweet's 28.6 ops at
native's rate saves 2.7 steps ≈ $0.00088 (−9.5%), not $0.0018 (−20%). And `ss-batch` was called 0 times in 198
luna rollouts without a prompt nudge, and the nudge is closed. **Disposition: dead; the `$0` census would size a
prize no admissible mechanism can collect.**

**C5 — payload budgeting by lifetime.** Admissible only as "different lines", as the draft says. Overlaps the
shipped span expansion (C-4, `resolveSpanExpansion`, `project_evidence_doctrine_applied`) and the pointer tier
(`project_type_definition_inlining_nogo`: 79% of pointer rows ignored). Sol 15's manifest form has a real `$0`
falsifier; keep it at `$0`. Not new as a class; new as a form.

**"Dead by measurement" list.** Agreed on all five, with one addition: the `<state_summary>` disposition was already
on record from the GEPA gen-3 codex challenge ("not removable").

### 2.2 Resolution levers

**R1 — index `.jam`; exclude `build/`… only when git does not track them.** Verified on the box and in source [M][C]
(§1, claim 15). Two corrections to the draft's provenance: (a) the extension-coverage audit
(`project_taskbench_extension_coverage_audit`, 2026-07-02) **did** test the directory deny list — its gate was
`admitsShape = FILE_PATTERNS.include && !buildPathFilter deny` — and judged `build/`/`target/`/`vendor/`
exclusions "legit", while flagging `**/thirdparty/**` as an over-exclusion; the class was known. b2 was outside
its 200-task pool, so the instance is new. The draft's "tested extensions, never directory exclusions" is wrong.
(b) The same memory records: "the allowlist fix is INERT for the bench unless goldens are REINDEXED." The three b2
goldens were built 2026-07-16 [M] and every fresh-pool row carries `idxSource: golden-cache` [M]. The draft's run
ships R1 without a golden rebuild, so R1 would be inert in that run. Ranking gate: discovery-only, exempt, correct.
Ceiling: native 1/3 on each harness — three single rollouts. **Disposition: ship as correctness; rebuild the b2
goldens (and any repo with tracked source under an excluded name) on the box before any run.**

**R2 — say "not indexed".** New [C] (`_ss-helpers.mjs:324/374/474/771` print `(no matches)` only). Ranking-neutral.
Keep, with C1.

**R3 — report where an edit's anchor is ambiguous.** **Belongs to the dead "evidence presence" family.** [M]
`04-opencode` §2.1: every losing rollout on `accenture-1974` ran `git diff` and read `@@ -1593` — the harness
already told them where the hunk landed — and 5 of 6 stopped; one acted. On codex native also landed at 1593
first and repaired by reading the same diff. The trailer adds information the agent already had; that is the
exact shape SLATE-A §9.7 ("evidence presence does not force the correct choice") and the completeness-card death
record. The task's arm direction also flips by harness: codex sweet 3/9 vs native 0/3, opencode 4/9 vs 2/3,
claude 6/9 vs 3/3. Ceiling ≤ 1 rollout, existence proof n = 1. **Disposition: keep the `$0` count as a
measurement; do not build.**

**R4 — condenser stop.** One rollout in 264; bug report. Agreed.

**R5 — guide shrink as a resolution question.** Falls with C2.

### 2.3 The §4.2 gutter designs

These contradict the draft's own verdict ("do not spend on the gutter again"). Every kill line ("solves −6",
"`ss-read` calls up by > 0.5") needs a paid run, and the GUTTER-AB lesson is that a shared render change must be
measured on every harness it reaches — three harnesses per design. Rank 2, "header-only", is the NONE arm, already
run at 198 rollouts per form, listed as a new design. Rank 4 (indent-aware delimiter) is the only one with a
mechanism, and the draft prices it at 0 rollouts saved. **Disposition: delete the table or move it to an appendix
of untested ideas with no falsifier that costs money.**

### 2.4 The §5.3 rejections

All twelve rejections stand, and the killing facts are the right ones. One inconsistency: Sol 13 is rejected
because "a new tool changes the cached prefix"; C4's MCP form would add tool schemas to the same prefix and is
kept as "not closed". Apply the same rule.

---

## 3. Fairness rules

| rule | draft | verdict |
|---|---|---|
| sweet-only vs shared FRAME (shared = zero differential) | C1, C3, C5, R1–R3 sweet-only; codex cap correctly left shared; R4 harness-owned | **pass**, except C4-MCP (out of scope by user decision) |
| no benchmark-specific text in the guide | sweet-min would be a general tool list | pass on generality; **fail on vehicle** — the guide is verbatim and changes only through the prompt process |
| guide changes only through prompt optimisation | sweet-min is hand-authored | **fail** (§2.1 C2) |
| ranking signals gated on `opts._isAgentFormat` | R1 is discovery-only; R2/R3/C1 are messages, not ranking | **pass** |
| held-out discipline; HO2 frozen; no per-query held-out inspection | pool is DEV-retired; HO2 untouched | **pass**; bar 6 is vacuous (the run is not on held-out) |
| never pool runs across a shipped fix | "cheaper variant" pools native from the fresh pool | **fail** — see §4.4 |
| price all requests incl. sidechains and retries (SLATE-A §4.3) | bar 5 prices claude-code per graded transcript | pass, but publish the every-dollar-spent convention beside it (claim 8) |
| call-count reduction is a proxy, not a cost result (SLATE-A §4.3) | draft §2.4 says so | pass; my operation count shows the proxy is wrong in sign on opencode (+4% operations) |

---

## 4. The proposed next run

### 4.1 Power — the bar rides on five or six tasks

[M] `p3-power.py`, from the three solve matrices in `04`. Discriminating tasks (not solved everywhere, not dead
everywhere): codex 6, opencode 5, claude-code 5. Task-bootstrap spread of the difference between two sweet forms
(the same treatment): SD 1.0–2.6 rollouts; P(|Δ| ≥ 6) 0.6–16%. Parametric on the pooled per-task rates:

| harness | P(false kill) under the null | expected loss if the discriminating tasks lose 1 solve in 4 | P(bar crossed) then | if they lose half | P(bar crossed) then |
|---|---:|---:|---:|---:|---:|
| codex | 0.8% | −3.7 | 19% | −5.5 | 50% |
| opencode | 0.3% | −2.8 | 9% | −5.0 | 40% |
| claude-code | 0.1% | −2.8 | 8% | −5.0 | 41% |

Family-wise false kill across three harnesses ≈ 1.2%. So the bar is safe against a false kill and nearly blind to a
real loss short of catastrophe. A 6-rollout drop (40/66 → 34/66) is Fisher p = 0.38. The draft's sentence "a
66-rollout cell *can* answer at the pre-registered solve bar" should read "can detect only a loss that halves the
solve rate on the five tasks that can move".

### 4.2 Bar 2 sits inside the noise of the same treatment

[M] `03` §3 table, three sweet forms = one treatment for behaviour: turns 19.6/19.4/19.8 (codex), 19.7/18.9/18.4
(opencode, spread 1.3), 23.4/23.2/21.6 (claude-code, spread 1.8); output tokens 5,524/5,676/5,728 (codex, 3.7%),
3,645/3,647/3,479 (opencode, 4.8%), 7,669/8,161/6,009 (claude-code, **36%**). Bar 2 voids the saving if Δturns >
+1.0 or Δoutput > +10%. Two of three harnesses already exceed one threshold between forms that differ by a
delimiter. The arithmetic saving would be "banked" or "voided" by a coin flip. The CLAUSE-SCREEN measured the same
thing from the other side: +378 tokens of clauses cost +0.6%, −0.2% — "absorbed by slightly shorter trajectories".

### 4.3 Controls

[M] `/root/fresh-run/pool.txt` holds the 22 tasks and no control; the five fixed controls (`scoringutils`,
`parcels`, `robot`, `zlint`, `dot-prop`) appear 0 times in all 12 pilot logs. The pre-registration's "no control
regression" clause was never operationalised. The draft's bar 3 uses "the 11 solved-everywhere tasks", which are
outcome-selected and differ per harness (intersection 9). `CONTROL-REPLACEMENT-RESULTS.md` warns that
"always solves in both arms" is 25% a filter for undiscriminating tasks. Add the five fixed controls (5 × 3 arms ×
3 reps × 3 harnesses = 135 rollouts, ≈ $1.5).

### 4.4 Harness version and the "cheaper variant"

[M] `rows.json` has no harness-version or API-path field (keys checked: `model, harness, envConfigHash, packingTreatment, …`).
Box today: codex-cli 0.146.1, opencode 1.18.4, claude 2.1.218. The draft's own claim 6 says a harness-side change
moved codex cost by ~16% of a rollout between epochs; epoch A also ran on a different API path
(`custom_tool_call` vs `function_call`). Pooling the fresh-pool native arm into a later run (the "$5.7 variant")
therefore repeats exactly the confound the draft diagnosed, and the record already names the trap ("never pool
runs across a shipped fix", `project_evidence_doctrine_applied`). Pin and record `codex --version`,
`opencode --version`, `claude --version` and the provider path per row; never pool arms across dates.

### 4.5 Goldens and the ledger

[C] `project_ledger_fingerprint_v4`: the fingerprint hashes the generated `run_tests` shim text only. The C1
wrapper fixes and the R1 index change do not touch it, so the ledger will read green with no re-sweep — the draft's
"the hygiene fixes force a re-sweep" is wrong in mechanism (harmless). What the ledger does not cover is the sweet
index: R1 needs the b2 goldens rebuilt on the box (hours of CPU; `project_taskbench_extension_coverage_audit`
records the build recipe and that mac-built goldens are degraded). Budget it, or R1 is inert.

### 4.6 Blinding

The 22 tasks are now written up in prose with gold files and failure modes (`04-*`), so the pool is burned for
any blinded work (`project_blinded_pool_burned_by_turnfix` rules). The R1 fix targets two of its tasks and the C1
fixes were derived from its failures. A re-run on it can re-test, not "replicate parity". Any replication claim
needs a fresh, unburned pool (CLAUDE.md dev/held-out discipline) with the five controls.

### 4.7 Cost and the objective

$8.5 at the registered price is consistent with the cell totals I re-summed (codex $0.81, opencode $0.60,
claude-code ≈ $1.17–1.42 per 66) — but it omits the controls (+$1.5), the degeneration re-runs (13 of 396
claude-code rollouts last time) and the golden rebuilds. The user's objective is highest resolution at lowest cost.
The run buys a ≤ 4% cost lever it cannot measure (the draft says ±4% needs ~130 tasks), a resolution bar it can
only cross on catastrophe, and it re-opens a gate the user scoped. **Recommendation: spend nothing on the guide.
Ship C1 + R1 + R2 as correctness with their `$0` falsifiers, rebuild the affected goldens, record harness versions,
and re-baseline sweet vs native once on a fresh pool with the five controls — that is the run that answers the
question, and it costs about the same.**

---

## 5. Per-task verdicts that rest on one rollout

| harness | task | the single rollout | what the draft builds on it |
|---|---|---|---|
| codex | `awslabs-21` TAB rep2 | a 1 ms timestamp flake, P2P failed, f2p = 1 | the only "discordant" codex task; by majority it is not discordant once the flake is excluded |
| codex | `jts-622` NONE rep2 | wrong-fix after a 90-line read | none |
| all three | `b2-113` native rep0 (codex, opencode) / rep2 (claude) | native's only solve per harness | the "+1 of 66 per harness" ceiling of R1 |
| opencode | `accenture-1974` PIPE rep2 | read `@@ -1593`, moved the hunk, solved | R3's existence proof (n = 1); 5 of 6 losers saw the same line and stopped |
| opencode | `apigee-961` PIPE rep1 | three failed `ss-grep` calls then the wrong `list.go` | the clearest ss-* defect → loss coincidence; [I] not [M] |
| opencode | `b2-259` PIPE rep2 | ungraded row (`f2pFrac` null) | PIPE is 38/65, not 38/66; the draft's ninth trap is right |
| claude-code | `aiohttp-8038` native rep1 | 125 calls, 36 edits, 2 subagents, 539 s | native's only solve; an effort outlier, not a retrieval win |
| claude-code | `nmt-192` TAB rep0 | four calls, empty patch, ends on `<state_summary>` | R4; one in 264 |
| claude-code | `accenture-1974` PIPE rep1 | wrong file chosen at call 5; 4 anchor failures after | the one PIPE carry with a cost; not the loss |

Every arm difference in the run is a sum of such single events. The draft mostly says so; §5.2 should say it once,
at the top.

---

## 6. New findings the draft missed

1. **C2 was gated and dropped on 2026-08-10** (`PREAMBLE-TRIM-GATE.md`; `project_eviction_nogo_cachebreak_gate`),
   with the guidance block excluded from scope by the user. The draft's discard check covered only SLATE-A §9 and
   SLATE-B §8. The 1,457-token figure dates from that gate.
2. **The next run has no power for its bars** (§4.1–4.2): false kill ≤ 1%, power 8–19% against a one-in-four loss
   on the discriminating tasks; bar 2 inside same-treatment spread on two harnesses.
3. **No control task ran in the fresh pool**; the pre-registration's control clause was vacuous; the draft's controls
   are outcome-selected.
4. **Harness version and API path are not recorded per row**, while a harness-side change is the draft's explanation
   of the codex flip; the "cheaper variant" pools across that confound.
5. **R1 is inert without a golden rebuild**; the ledger fingerprint covers neither the wrappers nor the index.
6. **C4's ceiling halves at the operation level** [M] (1.683 vs 1.450 ops per step; sweet 28.6 vs native 27.5 ops
   per rollout; ≈ $0.00088, −9.5% at best) and every mechanism to collect it is closed (`ss-batch` 3/4 traps; prose
   packing; advisory; MCP out of scope). Claim 7's "serial" reading and the "13% fewer calls" efficiency claim are
   envelope-count artefacts on opencode.
7. **The extension audit did test the directory deny list** and judged `build/` exclusions legitimate; b2 was
   outside its pool. Correct the draft's provenance sentence.
8. **R3 is the "evidence presence" family** (SLATE-A §9.7; completeness card): the losers had the hunk position in
   their own `git diff` and stopped.
9. **The sweet-min arm removes the doctrine behind both measured sweet wins** — delegation suppression on claude-code
   (−7.7%, the whole claude cost win; the guide carries the "no raw scan / stop searching / subagent" rules) and
   the fewer-calls efficiency — and bar 2 has no Δdelegation term. It also discards the shipped stop-discipline
   (pylint 0/3 → fixed) and fix-surface (glam flipped) edits untested.
10. **§4.2 contradicts the verdict**: five gutter designs whose kill lines need paid three-harness runs, one of
    which is the already-measured NONE arm.
11. **Claim 10's last clause is false on claude-code** (inclusive gap −8.8% > guide 2.5%); `06` §7.5 restricts it to
    the main-only column.
12. **Opencode "sweet TAB 0 failed edits" (claim 4) is a p = 0.028 event in one cell of nine**; the draft cites it as
    a reason to keep TAB on opencode. At nine cells, one p ≈ 0.03 result is expected under the null; keep TAB for
    the reasons in §4.1 of the draft, not for this.

---

## 7. What I could not finish

- I did not re-price any claude-code rollout (claims 8's three conventions and 9's delegation dollars are taken from
  `02`/`03`), and I did not re-tokenise the delivered blocks (claim 1's token count).
- The codex cap's cause — version or API path — needs the epoch-A `session_meta` and the codex-rs source for both
  paths; the box rules forbid a smoke.
- The parametric power model lowers rates only on tasks with 0 < p < 1; a treatment that breaks an
  all-solved task would show more loss than modelled. The task-bootstrap band already carries that variance.
- I did not run the `$0` falsifiers for C1/R1/R2 (replaying recorded commands against fixed wrappers, re-indexing
  a b2 golden); they need write access to a scratch golden, which is outside this lane.

## Appendix — artifacts

| file | what |
|---|---|
| `scripts/p3-power.py` → `logs/p3-power.txt` | task-bootstrap null spread and parametric power of the ≥ 6 bar, from the three solve matrices |
| `scripts/p3-ops-per-envelope.mjs` → `logs/p3-ops-per-envelope.txt` (box copy `/tmp/fp-inv/p3/`) | opencode operations vs envelopes per step, both arms, graded transcripts via `rows.json` |
| box one-liners (this file §4.3–4.5, §1 claims 8, 15, 19) | control ids in pilot logs; `rows.json` keys and treatment fields; `degenReran` counts; realized sums; `.jam` rows in the b2 golden `codebase.db` |
| local one-liners | `tiktoken` count of the guide; Fisher exact re-derivations; `search.js` / `_ss-helpers.mjs` / `ideal-cost.mjs` / runner source reads |
