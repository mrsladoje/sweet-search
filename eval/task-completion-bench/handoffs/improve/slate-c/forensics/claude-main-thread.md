# Forensics: claude-code main thread, no-delegation task-cells (fp-claudecode-tab-20260826)

Agent: `claude-main-thread` (slate C, 2026-09-02). Read-only over the evidence box. No rollout was launched. Nothing under `results/` was written. Scratch on the box: `/tmp/wf-slatec/claude-main-thread/`. Scripts and machine outputs are beside this file in `scripts-claude-main-thread/` (`out/` holds every JSON and log). The full request-by-request tables for all 24 rollouts are in `claude-main-thread-timelines.md` next to this file.

Tags: **[M]** measured (script named), **[C]** read from code or a deployed binary, **[I]** inferred, **[W]** web or bundled reference.

---

## 0. Verdict

**The +26% main-thread premium is real, but it is not a retrieval premium.** [M] On the four task-cells where neither arm delegated, sweet spends $0.010057 per rollout against native's $0.007963 (+26.3%, 12 rollouts per arm, all 24 solved). Sweet returns the same tool bytes as native (25.2 kB against 25.3 kB of retrieval results). It needs 2.8 more requests to do so (16.3 against 13.5), it emits 52% more output tokens (3,428 against 2,253), and it carries a 1,570-token guide in every request. Those three facts explain the whole gap. Named waste is small: one failed edit in 12 rollouts, no true "ss-read then Read" re-reads (the four candidates were `pages` errors), and 11 failed `ss-*` calls whose following requests cost at most 19% of the gap.

**Three things the standing record gets wrong.**

1. **The gap is fragile.** One sweet rollout (`callstack__react-native-paper-972` rep 2, 37 requests, $0.020387) carries 54% of the total sweet-minus-native dollars across the 12 pairs. Without that pair the premium is +13.0%. Two of the four tasks (jts, mathnet) sit at +5.7% and +4.6% [M].
2. **The measured +26% flatters sweet.** The D-4 `pages` defect (register D4, marked FIXED) is alive in this run: 159 of 690 native `Read` calls (23%) died on `Invalid pages parameter`, in all 66 native rollouts, costing 6.8% of the native arm; sweet lost 1.0%. On the four focus tasks native wasted 12.4% of its spend on it, sweet 3.2%. With that waste removed from both arms the premium is **+39.6%** [M].
3. **The read-before-edit gate binds on fewer models than the record says, and it is still a 7.8–9.4% tax where it binds.** [C][M] On the bench binary (2.1.218) the `Edit` gate fires only for ten model ids: `claude-opus-4-6`, `claude-haiku-4-5`, `claude-opus-4-5`, `-4-1`, `-4-0`, `claude-sonnet-4-5`, `-4-0`, `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku`. The same ten ids gate the newest binary I could open (2.1.258, 2026-09-02). Opus 4.7, 4.8, 5, Sonnet 4.6, 5, and Fable 5/5.1 are not gated. For a gated model, 68 sweet files in 56 of 66 rollouts would each cost one failed `Edit` plus one `Read`: +$0.00127 (immediate) to +$0.00153 (lifetime) per rollout, 7.8–9.4% of the sweet arm, priced with this run's own requests. The tool guide never mentions the precondition; it tells the model not to use native `Read` at all.

**One new product defect class was found on the way.** `ss-grep` returns "(no matches)" in three situations where matches exist or the answer is not a negative: an alternation whose second branch has no 3-character literal (`_color|_.*,`: the native literal extractor keeps only `_color`; 59 matching lines in indexed files were dropped) [C][M]; any `--in .` or `--in ./` scope (`pathSegments('.')` is empty, so the filter rejects every file; 5 of 5 such calls in 198 rollouts answered zero) [C][M]; and a scope path that does not exist (11 calls; the wrapper prints "(no matches)" instead of an error) [C][M]. The guide treats two empty probes as settled absence, so these are correctness hazards, not cost levers.

---

## 1. Scope check: the four task-cells

Method: for every task in `fp-claudecode-tab-20260826`, count subagent transcript files (`claude-home/projects/<slug>/<session>/subagents/*.jsonl`) and `Task`/`Agent` tool calls in the main transcripts, both arms [M `cc-sidebyside.mjs` section 0].

| task | native mains / subagents / Task calls | sweet mains / subagents / Task calls |
|---|---|---|
| `callstack__react-native-paper-972` | 3 / 0 / 0 | 3 / 0 / 0 |
| `jazzband__tablib-454` | 3 / 0 / 0 | 3 / 0 / 0 |
| `locationtech__jts-622` | 3 / 0 / 0 | 3 / 0 / 0 |
| `mathnet__mathnet-numerics-1072` | 3 / 0 / 0 | 3 / 0 / 0 |

Exactly four tasks are clean, the same four `logs/p1-conventions.txt` named on 2026-08-28. Fifteen tasks had one arm delegate (native in 12, sweet in 3: `asynkron__protoactor-dotnet-1909`, `fastify__fastify-cors-285`, `final-form__final-form-64`); three had both. All 24 rollouts were matched to their `rows.json` row by replayed realized cost within $0.000002 (no "largest file" selection) [M]. Every rollout resolved. The lifetime-attribution identity (section 3) closes to 7e-18 dollars on every rollout [M].

Headline reproduction [M `out/sidebyside-summary.txt` A]: native $0.007963, sweet $0.010057, Δ $0.002094 = +26.29%. This equals the 08-28 figure to the dollar.

---

## 2. Side-by-side, per task

Mean per rollout over 3 reps. "in" = tool-result bytes returned to the model. All 24 rollouts resolved [M].

| task | native $ / req / out tok / in kB | sweet $ / req / out tok / in kB | Δ$ |
|---|---|---|---:|
| callstack | 0.008125 / 14.0 / 2,667 / 30.8 | 0.012355 / 22.3 / 4,236 / 41.5 | **+52.0%** |
| tablib | 0.006345 / 9.7 / 1,768 / 34.7 | 0.009621 / 14.7 / 3,941 / 36.8 | **+51.6%** |
| jts | 0.006173 / 12.0 / 1,073 / 23.7 | 0.006526 / 11.0 / 1,186 / 26.2 | +5.7% |
| mathnet | 0.011209 / 18.3 / 3,504 / 51.8 | 0.011725 / 17.3 / 4,350 / 50.2 | +4.6% |

Per rollout (realized main-only $, requests) [M]:

| task | rep | native | sweet |
|---|---|---|---|
| callstack | 0 | 0.008972 / 16 | 0.010115 / 19 |
| callstack | 1 | 0.008608 / 16 | 0.006563 / 11 |
| callstack | 2 | 0.006797 / 10 | **0.020387 / 37** |
| tablib | 0 | 0.006628 / 10 | 0.009707 / 13 |
| tablib | 1 | 0.006697 / 10 | 0.009148 / 15 |
| tablib | 2 | 0.005712 / 9 | 0.010009 / 16 |
| jts | 0 | 0.007380 / 14 | 0.006692 / 11 |
| jts | 1 | 0.006319 / 13 | 0.006174 / 10 |
| jts | 2 | 0.004820 / 9 | 0.006713 / 12 |
| mathnet | 0 | 0.010894 / 17 | 0.009640 / 15 |
| mathnet | 1 | 0.011017 / 17 | 0.012145 / 18 |
| mathnet | 2 | 0.011714 / 21 | 0.013388 / 19 |

Fragility [M, arithmetic on the table]: the sum of the 12 pair deltas is $0.025128. The callstack rep-2 pair alone is $0.013590 (54.1%). Dropping that pair gives $0.001049 per rollout over 11 pairs, +13.0% on a native base of $0.008069. Sweet is cheaper in 4 of 12 pairs.

### 2.1 Two exemplar timelines (condensed)

**callstack rep 2 — the outlier.** Native (10 requests, $0.006797): `find`+`run_tests` in one request, three parallel `Read`s in one request (one `pages` failure, then a 11.9 kB re-read), one `grep -R`, `Edit`, `run_tests`, `git diff`+`grep .eslintrc`, `Read .eslintrc`, one more `grep`, final. Sweet (37 requests, $0.020387): `TaskCreate`, `run_tests`, `ss-grep Searchbar`, `ss-read` 240 lines, three `ss-grep`/`ss-search` probes, `ss-read` Appbar, **Edit at request 9 (the fix)**, then requests 10–28 hunt a lint convention for an unused destructured prop (`_color`, `no-unused-vars`, `argsIgnorePattern`, eslint config): 9 `ss-grep`, 5 `ss-read`, 2 `ss-search`, 4 of which answered "(no matches)" (one a genuine false negative, section 6.2), then three edits at 29–31 that add and revert the same rename, `run_tests`, two more probes, `TaskUpdate`, final. Native asked the same lint question with two `grep -R` calls and one `Read .eslintrc` [M `claude-main-thread-timelines.md`].

**tablib rep 0 — a typical +46% pair.** Native (10 requests, $0.006628): `run_tests`, `grep -R "def [lr]push"`, three failed `Read`s (`pages`), one 30.9 kB `Read`, `Edit`, `Read` of the test file, `run_tests`, final (665 output tokens). Sweet (13 requests, $0.009707): `run_tests`, `ss-search`, `ss-trace Row` (18.1 kB), `ss-grep`, `ss-read` 45 lines, `Edit`, `run_tests`, `ss-read` test file, `ss-find` for the test names, `git diff` (946 output tokens of reasoning), a second `Edit` that rewrites the docstring, `run_tests`, final (1,076 output tokens). Sweet found the fix with 4.6 kB fewer retrieval bytes but spent 3 more requests and 2.4× the output tokens [M].

---

## 3. Attribution of the $0.002094 gap

### 3.1 By token kind (realized, per rollout) [M `out/sidebyside-summary.txt` A]

| component | native | sweet | Δ | Δ$ | share of gap |
|---|---:|---:|---:|---:|---:|
| output tokens × $0.60/M | 2,253 | 3,428 | +1,175 | +0.000705 | 34% |
| new (ingest) tokens × $0.10/M | 28,068 | 30,913 | +2,845 | +0.000284 | 14% |
| re-sent (resident) tokens × $0.01/M | 293,047 | 395,839 | +102,792 | +0.001028 | 49% |
| cache-write surcharge | 0.000874 | 0.000950 | | +0.000076 | 4% |
| **total** | 0.007963 | 0.010057 | | **+0.002093** | |

Resident split [I, arithmetic]: native's mean prefix is 21,707 tokens per request, sweet's 24,240. The 2.83 extra requests at sweet's prefix are 68,600 tokens ($0.000686, 67% of the resident Δ). The larger prefix over native's 13.5 requests is 34,200 tokens ($0.000342, 33%). Requests are the multiplier, as the brief says.

### 3.2 By what the request did (ideal, lifetime-attributed) [M `out/sidebyside-summary.txt` C]

Each request is charged its own output, the new tokens it caused in the next request, and the re-send of those tokens for the rest of the rollout. The class deltas sum exactly to the ideal Δ of $0.002018.

| class | native n / $ | sweet n / $ | Δ$ | note |
|---|---|---|---:|---|
| preamble (turn-1 input) | 17,372 tok / 0.003910 | 18,942 tok / 0.004803 | **+0.000893** | +1,570 tokens is the guide plus the 60-token system override; the rest is the base preamble re-sent 2.8 more times |
| retrieval: `ss-search` + `ss-read` + `Read` (sweet) vs `Read` + shell + parallel-Read (native) | 7.17 / 0.001927 | 8.50 / 0.002406 | **+0.000479** | same bytes (25.3 vs 25.2 kB), more requests; sweet's retrieval requests emit 1,527 output tokens vs native's 981 |
| `run_tests` | 1.92 / 0.000486 | 2.67 / 0.000865 | **+0.000380** | sweet runs the suite 0.75 more times and thinks 134 vs 77 tokens per test request |
| edit + failed edit | 2.00 / 0.000399 | 2.17 / 0.000551 | +0.000151 | sweet emits 375 vs 283 output tokens per edit request; one failed edit |
| task list (`TaskCreate`/`TaskUpdate`) | 0.67 / 0.000048 | 1.33 / 0.000177 | +0.000129 | sweet updates its task list twice as often |
| git | 0.75 / 0.000132 | 0.67 / 0.000145 | +0.000013 | |
| final answer | 1.00 / 0.000188 | 1.00 / 0.000159 | −0.000029 | |
| **sum** | | | **+0.002016** | ideal Δ = 0.002018 |

### 3.3 The named mechanisms the task asked for (per rollout, realized) [M]

| mechanism | evidence | Δ$ / rollout | share of gap |
|---|---|---:|---:|
| **Guide re-send** | first-turn input 18,942 vs 17,372 = 1,570 tokens; price 1,570 × (0.125 + 0.01 × 15.33)/1e6 | +0.000437 | 21% |
| **More requests re-sending the base preamble** | 17,372 × 2.83 × 0.01/1e6 | +0.000492 | 23% |
| **Longer reasoning** | +1,175 output tokens; visible chars 8,387 vs 6,148 (≈ +560 tokens); hidden reasoning ≈ 1,331 vs 716 tokens; sweet emits more on every shared class (edit 375 vs 283, test 134 vs 77, git 318 vs 237, TaskUpdate 278 vs 97 per request) | +0.000705 | 34% |
| **Verification tail** (requests after the last successful edit) | sweet 4.17 req / $0.002116 vs native 3.42 / $0.001552; two sweet rollouts carry it: mathnet r0 (10 requests, $0.005245: 5 `ss-search`, 2 `run_tests`, 2 `git` after the fix passed), tablib r1 (8 requests, $0.004234: 4 `ss-read`, 1 `ss-search`); native's worst is mathnet r2 (7, $0.003712) | +0.000564 | 27% |
| **`ss-*` failures** | 11 calls in 12 rollouts: 2 regex crashes (`[[:space:]]`+`{` under Rust regex; `ss-find` on an index without line spans), 9 zero-match answers (4 true negatives, 1 genuine false negative, 3 scoped to a file that does not exist, 1 true negative on jts); the next request after each | ≤ +0.000399 | ≤ 19% (upper envelope) |
| **D-4 `pages` errors** (shared harness defect) | sweet 9 failed `Read` requests / $0.003810 (3.2% of its 4-task spend); native 29 / $0.011840 (12.4%) | native −0.000987, sweet −0.000317 | flatters sweet by 0.000670; clean premium **+39.6%** |
| **`ss-read` then native `Read` of the same file** | 4 events, all in jts r0, all `Invalid pages parameter` errors (123 bytes each) — no real re-read happened | +0.000117 | subsumed in D-4 |
| **Failed edits and retries** | 1 of 25 sweet edit calls (`string-not-found`, mathnet r1, $0.000763 + $0.000508 retry); native 0 of 24 | +0.000048 | 2% |
| **Task-list tool** | 16 vs 8 calls over 12 rollouts | +0.000129 | 6% |
| **Parallel tool emission** | native 1.04 calls per request with 1.17 multi-call requests per rollout (parallel `Read`s); sweet 0.94, none — one Bash `ss-*` per request | inside "more requests" | — |

Shares overlap by construction (the guide is part of every request's prefix; reasoning is inside every class). The exact, non-overlapping decompositions are 3.1 and 3.2.

---

## 4. Read-before-edit census, whole run

Script: `cc-readgate-census.mjs` (rows matched by replayed cost, 132 of 132) [M `out/readgate-census-fp-claudecode-tab-20260826.json`].

### 4.1 Counts

| unit | native | sweet TAB |
|---|---:|---:|
| edit calls (`Edit`+`Write`) | 307 (+1 malformed) | 244 (+1 malformed) |
| calls with no prior native `Read` of the file (ignoring edit refresh; the 08-28 unit) | 12 (all "nothing": new files, wrong paths, malformed) | **219** (209 after an `ss-read`, 10 nothing) |
| calls with no prior `Read` and no prior successful `Edit`/`Write` of the file (gate semantics) | 4 | 98 (92 `ss-read`, 6 nothing) |
| distinct (rollout, file) first edits | 92 | 81 |
| first edits of an existing file with no prior `Read` = **files the gate would stop** | **0** | **68** (66 after `ss-read`, 2 nothing) |
| rollouts with at least one such file | 0 / 66 | **56 / 66** (1.03 files per rollout) |
| `Write` to an existing un-read file (gated for every model on 2.1.218) | 0 (3 of 6 Writes hit existing files, all previously read or written) | 0 (all 4 Writes created new files) |
| gate errors observed | 0 | 0 |
| native `Read` after an `ss-read` of the same file | 0 | 16 (of 51 sweet `Read` calls; 23 of the 51 were `pages` errors) |

The 08-28 figure (218 of 259, 205 after `ss-read`) used the largest transcript per rep; the cost-matched transcripts give 219 of 244. The three sweet cells with extra sessions (`aio-libs`, `fastify`, `protofire`) explain the denominator [I].

### 4.2 The counterfactual tax, priced with this run

Per gated file: request B = a `Read` of the file; request C = the same `Edit` re-issued. Inputs: the observed edit request's prefix and output; the native arm's observed `Read` result bytes for the same path in the same task (68 of 68 files had one; mean 1,314 tokens); 4.37 bytes per token (median of 299 native single-`Read` requests, p25 3.82, p75 4.96); 103 output tokens per `Read` request (median, n = 406) [M].

`B = 0.01 × (prefix + out_A + 15) + 0.60 × 103`; `C = 0.125 × readTok + 0.01 × (prefix + out_A + 15 + 103) + 0.60 × out_A`; lifetime adds `0.01 × (readTok + out_A + 118) × remaining requests` (all per million tokens).

| estimate | total (66 rollouts) | per rollout | % of sweet main-only ($1.076701) |
|---|---:|---:|---:|
| immediate (B + C) | $0.083792 | $0.001270 | **7.8%** |
| lifetime (+ re-send of the Read result) | $0.100951 | $0.001530 | **9.4%** |
| 2 × mean request price ($0.000704) | $0.095769 | $0.001451 | 8.9% |
| NONE / PIPE runs, whole-file Read from the golden (upper bound; 76 / 72 gated files, 4,916 / 4,759 tokens) | | $0.001907 / $0.001816 immediate | 12.3% / 12.1% (lifetime 16.4% / 15.9%) |

Effect on the headline [I, arithmetic]: sweet TAB main-only $0.016314 + $0.00127–0.00153 = $0.01758–0.01784 against native $0.016542 → +6.3% to +7.9% (today −1.4%). Inclusive of native's subagent spend, sweet's −3.9% becomes +2.0% to +3.3%. On the four no-delegation tasks the +26% would become roughly +36% to +38%.

Native pays nothing: it always `Read`s before it edits (92 of 92 first edits) [M].

### 4.3 What the deployed binaries do [C]

Extractor: `gate-extract.py` (run on the box for 2.1.218, locally for 2.1.250 and 2.1.258; outputs in `out/` are the terminal captures in this report's session).

| binary | `Edit` gate | `Write` gate | prompt |
|---|---|---|---|
| **2.1.218** (box, `/root/.local/share/claude/versions/2.1.218`, the bench binary) | `MSy`: no prior read → `if(!rji(model) && !readNotAutoAllowed()) return false; throw "File has not been read yet"`. `rji(e) = grg.has(oa(e))`; `grg` = the ten ids above; `oa` strips only a `[1m]` suffix | `NSy`: existing file, no prior read → throw unless feature flag `tengu_velvet_mallet_<model>` (default off) → **model-independent** | `Edit` description has no read-first sentence |
| **2.1.250** (local, 2026-08-28) | `(servedCall \|\| !ZOe(model)) && !readNotAutoAllowed() → skip`; `ZOe = C.has(model)`, same ten ids | now model-gated the same way; a partial-view read does not count for `Write` | — |
| **2.1.258** (local, newest, 2026-09-02) | `MYr`: `preReadGuard = mYe(model, remoteCall) = N.has(tn(model))`, same ten ids | `FRo`: gated by `preReadGuard`, and always for a file outside the working directory [I from the prompt text] | for gated models: "You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file." For others (remote-config `preReadLineDropped`): "If the file is outside the working directory, you must use your Read tool to read it before editing." |

All three binaries log `tengu_edit_tool_not_read_hypothetical` / `tengu_write_tool_not_read_hypothetical` with `guardSkipped` and a model bucket: Anthropic measures what the relaxed gate would have done [C]. Whether dated ids such as `claude-sonnet-4-5-20250929` match the undated set entries is unknown; `oa`/`tn` do not strip dates [I]. `readNotAutoAllowed()` was false in the bench (`bypassPermissions`); I did not verify it for the default permission mode, though `Read` needs no approval there either [I].

Against the current model list [W bundled `claude-api` reference, cached 2026-06-24]: of Fable 5.1, Fable 5, Opus 5, Opus 4.8, 4.7, 4.6, Sonnet 5, 4.6, Haiku 4.5, only **Opus 4.6 and Haiku 4.5** are gated. The register's D6 sentence "on any Anthropic model all 218 edits would throw" is too strong; it holds for the ten legacy ids.

### 4.4 What the sweet arm is told [C]

- Guide (`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`, delivered verbatim as `.claude/rules/sweet-search.md` by `claude-code-task-runner.mjs` and by `scripts/write-claude-rules.js` in production): "Reach for raw `grep`/`find`/`cat`/`ls` or the native reader only for an edit too recent to be reconciled (seconds old) — otherwise the index covers every file, so a raw scan only re-confirms an `ss-*` result at higher cost, never beats it." Editing: "apply the edit with your normal file-editing tool". Nothing about a read precondition.
- System override (`scripts/install-claude-system-prompt.js`, appended with `--append-system-prompt`; in production the `sweet-search` output style): "Claude Code's default advice to use Bash `grep`/`find` or `Read` does not apply; use those only when `.claude/rules/sweet-search.md` explicitly permits."
- Frame (both arms, `codex-task-runner.mjs` `FRAME_OPEN`): "(1) find and read the code relevant to the issue" — tool-agnostic.

So the sweet arm is steered away from native `Read`, and on a gated model Claude Code's own `Edit` prompt (2.1.258) says the opposite. The guide does not address `Read` before `Edit`. On the ten gated ids every first edit of an `ss-read` file fails once.

---

## 5. Shared-defect correction: D-4 `pages` is not fixed

Register D4 says "FIXED both arms (PreToolUse normalizer hook + prompt note recover 189/299)". The runner itself says the hook is inert and only the prompt note works. In this run [M, `Read` results matching `Invalid pages parameter`]:

| arm | `Read` calls | failed on `pages` | rollouts hit | failed-request $ | % of arm main-only | streaks of 2+ | ended unrecovered |
|---|---:|---:|---:|---:|---:|---:|---:|
| native | 690 | **159 (23.0%)** | 66 / 66 | $0.074321 ($0.001126 / rollout) | **6.81%** | 15 | 5 |
| sweet | 51 | 23 (45.1%) | 18 / 66 | $0.010814 ($0.000164 / rollout) | 1.00% | 3 | 7 |

It is a shared harness-adapter defect with a 5.8-point arm-asymmetric effect that lowers native's apparent efficiency. Every claude-code cost comparison in `FRESH-POOL-RESULTS.md` and the 08-28 analysis carries it undisclosed (no mention found by grep). It is not a lever: fixing it makes native cheaper.

---

## 6. `ss-*` failures across all 198 claude-code sweet rollouts

Script: `ss-grep-nomatch-audit.mjs` (every single-invocation `ss-grep` that answered zero is replayed as `grep -E` over the task's golden checkout with the same flags and scope) [M `out/ss-grep-nomatch-audit-*.json`].

### 6.1 Zero-match answers

| run | single `ss-grep` calls | zero answers | true negative | scope missing | grep could not parse (BRE) | candidates → not indexed at run time (E1/E2) / genuine / mixed |
|---|---:|---:|---:|---:|---:|---|
| TAB | 241 | 87 (36%) | 47 | 9 | 2 | 29 → 27 / **2** / 0 |
| NONE | 233 | 75 (32%) | 48 | 1 | 2 | 24 → 20 / 0 / 4 |
| PIPE | 218 | 57 (26%) | 37 | 1 | 1 | 18 → 17 / 0 / 1 |

"Not indexed at run time" = the hits are in `.jam`, `src/build/`, `dist/index.js` bundles, `docs/`, `README`, `CHANGELOG`, `.json`, `.yaml` — register E1 (index coverage, fixed 36b802e/fb9f936 after this run) and E2's "(not indexed …)" note. Their following requests cost $0.0385 over 198 rollouts ($0.000195 per rollout, ~1.2% of the arm, upper envelope) [M].

### 6.2 Genuine misses and their mechanisms

1. **Alternation with a literal-free branch.** `ss-grep "_color|_.*," --in src/components -k 30` → "(no matches)"; `grep -E` finds 59 lines in 12 indexed files (`Menu.js`, `Snackbar.js`, `BottomNavigation.js`, …) [M]. Mechanism [C]: the native literal extractor `extractRegexLiteralClauses("_color|_.*,")` returns `{"clauses":[["_color"]]}` — the branch `_.*,` has no 3-character literal and is dropped instead of making the pattern unfilterable. The gram prefilter then admits only files containing `_color`. The JS heuristic in `search-pattern-prefilter.js` handles the same case correctly ("Alternation means neither side is universally required … return empty"). `_.*,` alone returns no clauses and would have scanned everything. Observed 1 in 198 rollouts.
2. **`--in .` and `--in ./` match nothing.** `grep-output-shaping.js` `pathSegments('.')` drops `.` and `''`, so the scope has zero segments and `matchesGrepFileFilter` returns false for every file (verified by calling the function: `["src/tools/stage.py","."] → false`, `"/root/x" → true`) [C]. All 5 `--in .` calls in the three runs answered zero; 4 of them had hits in indexed Python files (`src/tools/stage.py`, `test/configure.py`) [M].
3. **Scope path that does not exist → "(no matches)".** `excludedScopeNote` returns null when the path is absent, so the wrapper prints "(no matches)" [C]. 11 calls in 198 rollouts, e.g. three probes of `src/Numerics/Complex.cs` in mathnet (the golden has `Complex32.cs` and `ComplexExtensions.cs`) [M].

### 6.3 Crashes

| message | TAB | NONE | PIPE | register |
|---|---:|---:|---:|---|
| `ripgrep failed (code 2): regex parse error` (unescaped `(`, `{`, POSIX `[[:space:]]`) | 11 | 8 | 13 | E2 regex-dialect hint, shipped 36b802e after the run |
| `Pattern search requires a late interaction index with line spans. Re-index with late interaction enabled.` (`ss-find`, mathnet only) | 1 | 1 | 0 | **not recorded** |

The following request after a crash costs about $0.0005; 32 crashes over 198 rollouts is ≈ $0.00008 per rollout (0.5%) [M][I].

---

## 7. Register check and novelty

| finding | nearest register entry | verdict |
|---|---|---|
| +26.3% on the 4 clean tasks | 08-28 §2.2 (recorded) | already recorded; **extended** with the composition, the one-rollout fragility (54%), and the D-4 correction (+39.6%) |
| guide = 1,570 tokens, 21% of the gap | B2 CLOSED | already recorded; number extended to this subset |
| more requests, one `ss-*` call per request vs parallel `Read`s | opencode driver in the brief; A4 (MCP) OWNER-EXCLUDED | extends: measured on claude-code (1.04 vs 0.94 calls/request) |
| longer reasoning (+52% output on the same action classes) | 08-28 "verbosity"; B3 drop-the-guide PROPOSED | extends; supports B3's $0 question (induced reasoning may cost more than the guide's own tokens) [I] |
| post-green search tails | A7 (no doomed tail), A8 (checkpoint-on-green), A6/A11 (advisories dead) | extends: on claude-code sweet the tail is search, not edit; prompt remedies are dead; not a seed |
| D-4 `pages` alive: 23% of native `Read` calls | D4 FIXED | **corrects** D4; measurement disclosure item, zero-differential vehicle |
| read gate binds on ten legacy ids only; tax 7.8–9.4% | D6 UNMEASURED | **extends** D6 with the model set, the price, and the guide conflict |
| `ss-grep` alternation prefilter false negative | E2 hygiene (regex crash), D7/D6 BRE `\|` | **new** mechanism (ERE alternation, native extractor) |
| `--in .` matches nothing | E2 ("positional path as `--in`") | **new** |
| `--in <absent path>` prints "(no matches)" | E2 ENOENT hint (ss-read only) | extends E2 |
| `ss-find` crash without LI line spans | — | **new** defect |
| zero-match answers from index coverage | E1/E2 SHIPPED | already recorded; priced |

---

## 8. Candidate seeds (mechanisms not on the register)

All are product correctness fixes with a sweet-only vehicle (`ss-*` wrappers or the search engine). None makes sweet cheaper than native; each removes a wrong "absence" answer that the guide tells the model to trust.

| seed | mechanism | harnesses | ceiling | `$0` falsifier / kill | build | flags |
|---|---|---|---|---|---|---|
| S1 `ss-grep` alternation prefilter | when any alternation branch yields no ≥3-char literal, return no clauses (full scan) or fall back to the JS heuristic | all three | correctness; cost ≤0.1% (1 event / 198 rollouts) | replay every zero-match `ss-grep` in fp/rb/fixval against goldens with `grep -E`; kill if <1 genuine miss per 200 rollouts remains after the fix | small (native addon or a JS guard) | `new_tool: false` |
| S2 `--in .` scope | treat `.`/`./` as unscoped in `matchesGrepFileFilter` or the wrapper | all three | correctness; 5 calls / 198 rollouts | unit test + replay | trivial | `new_tool: false` |
| S3 `--in <absent path>` | print `[ss-grep] error: scope not found` instead of "(no matches)" | all three | 11 calls / 198 rollouts | replay | trivial | `new_tool: false`; extends E2 |
| S4 `ss-find` without LI line spans | fall back to `ss-grep` semantics or fail with an actionable message; check why the mathnet index lacks spans (13 segments) | all three | 2 calls, 1 task | inspect the golden's index build log | small–medium | `new_tool: false` |
| S5 claude-code read-gate compatibility | on the ten gated model ids, tell the model to `Read` the target span once before its first `Edit` (saves the failed `Edit`, keeps the `Read`); or disclose the +7.8–9.4% as a known cost on legacy models | claude-code only | caps a hidden tax at about half (the `Read` remains); zero for Opus 4.7+/Sonnet 4.6+/5/Fable | the price is computed above; a live check needs one gated-model rollout ($) | guide text | `new_tool: false`, **`needs_user_decision: true`** (guide is owner-protected; the clause would be wasted on non-gated models and the guide cannot see the model id) |

Not a seed but required for publication: disclose the D-4 asymmetry (native 6.8% vs sweet 1.0% of arm) in every claude-code cost table.

---

## 9. Measurement traps met in this pass

1. "Largest transcript per rep" vs cost-matched: 259 vs 244 sweet edit calls; use cost matching (all 132 rows matched within $2e-6).
2. A `Read` result of 123–124 bytes is a D-4 `pages` error, not a read; "Read after ss-read" counts must exclude them (the 16 in both censuses include 4 such errors).
3. "Prior native Read" has two units: per call ignoring edit refresh (219 / 244) and per file at the gate (68 / 81 first edits). A successful `Edit`/`Write` refreshes Claude Code's read state, so only the first edit of a file can trip the gate.
4. `grep -n` on a single file prints no filename; a classifier that reads the file list must special-case single-file scopes.
5. `.vault-manifest.sha256` in the goldens produces spurious `grep` hits (bench artifact).
6. macOS `grep` here is `ugrep` with complexity limits; extract binary strings with Python. macOS has no `timeout`.
7. NaN serialises to `null` in JSON summaries for runs without a native arm (NONE, PIPE).
8. Two jts goldens exist (`516fafa…`, `948f5ef…`); the run used `516fafa…` (its `WKBWriter.java` has no `isEmpty`, matching every native `Read` of the file).
9. Hidden reasoning tokens are redacted in transcripts; "hidden reasoning ≈ output − visible chars / 4" is an estimate [I].

## 10. What I could not finish

- I did not run `ss-grep` on the box against the goldens; that would spawn sweet-search daemons on the evidence machine. The three `ss-grep` mechanisms are pinned by code reading and by calling the pure functions locally (`extractRegexLiteralClauses`, `matchesGrepFileFilter`).
- I did not verify that `src/tools/*.py` and `test/configure.py` were in the b2 run-time index; the coverage classification of the 71 zero-match candidates uses file-type and path rules [I].
- `readNotAutoAllowed()` for real users in the default permission mode is inferred, not traced (`xEs`/`CJ` bodies unread).
- The remote-config default for `preReadLineDropped` (whether 2.1.258 shows the read-first sentence for a given model) is not observable offline.
- The gate tax for NONE/PIPE uses whole-file golden sizes because those runs have no native arm; it is an upper bound.

## 11. Files

- Report: this file. Full timelines (24 rollouts, 382 request rows): `claude-main-thread-timelines.md`.
- Scripts (`scripts-claude-main-thread/`): `cc-parse.mjs` (parser, cost matching), `cc-sidebyside.mjs` (sections 1–3), `cc-readgate-census.mjs` (section 4), `ss-grep-nomatch-audit.mjs` (section 6), `gate-extract.py` (section 4.3).
- Outputs (`scripts-claude-main-thread/out/`): `sidebyside.json`, `sidebyside-summary.txt`, `sidebyside-stdout.txt`, `timelines.md`, `readgate-census-fp-claudecode-{tab,none,pipe}-20260826.json` + stdout logs, `ss-grep-nomatch-audit-fp-claudecode-{tab,none,pipe}-20260826.json` + `.txt`.
- Box scratch: `/tmp/wf-slatec/claude-main-thread/` (same files).
- Binaries read: `/root/.local/share/claude/versions/2.1.218` (box); `/Users/admin/.local/share/claude/versions/{2.1.250,2.1.258}` (local).
