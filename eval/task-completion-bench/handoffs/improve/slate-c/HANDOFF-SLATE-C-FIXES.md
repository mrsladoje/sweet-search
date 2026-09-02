# HANDOFF — implement the Slate C fixes, then the multi-file smoke, then the frozen run

**Written:** 2026-09-02, after `SLATE-C-UBER.md` (same directory) and an owner review.
**Scope of this session:** implement every item in `SLATE-C-UBER.md` §4.1–§4.6 (the "ranked
survivors"), plus the two owner decisions below, plus the run preparation in §5 of this file.
**Spend:** `$0` until the smoke. No rollout is launched by this session. The smoke and the
frozen run are launched by the owner after the checklist in §8 is green.
**Nothing else.** No lever, no guide edit, no admission preflight form, no adaptive budgeting.

Read first, in this order: this file; `SLATE-C-UBER.md` §0.4, §4, §6, Appendix A and B;
`register/DEAD-LEVER-REGISTER.md` rows named below; the memory file
`project_read_gutter_tab_delimiter.md` (the gutter decision this session inherits).

---

## 0. Standing rules that bind this session

1. **Sequencing is the whole point.** The env ledger's fingerprint hashes the GENERATED ss-*
   shim (`harness/env-ledger.mjs`, "fingerprint version 4", `rt-shim-text.mjs →
   shimFingerprintSource()`). Every fix that touches the shim or the ss-* wrappers changes the
   ledger version. Therefore: **all shim-touching fixes land BEFORE the smoke; nothing
   shim-touching lands between the smoke and the frozen run.** If something must change after
   the smoke, the sequence restarts (re-sweep, re-smoke).
2. **Never pool runs across a shim change, a ledger version, or a harness pin move.** Pins for
   both runs: codex 0.146.1, opencode 1.18.4, claude-code 2.1.218.
3. **Held-out 2 (HO2, 199 tasks) is never opened per task and never re-filtered.** Any admission
   change is forward-only.
4. **No benchmark value is claimed for any fix here.** Every item is shared correctness or a
   sweet-only product fix with a `$0` falsifier. Ceilings are not additive (`SLATE-C-UBER.md` §4.7).
5. **Do not use ss-* tools to develop sweet-search.** Native tools only.
6. **Commit direct to `main`, no feature branches.** One commit per fix item, tests included,
   full `npx vitest run` green before the last commit (the full suite takes ~11 min; the six
   daemon/maintainer spawn files are load-flaky in the full run and pass in isolation —
   re-run those alone before calling a failure real).
7. Keep the format gate: any structural signal that reshapes retrieval stays on agent formats.
8. Prose in reports: conclusion first, one idea per sentence.

---

## 1. Already done in the previous session, UNCOMMITTED — commit first

Per-harness line-number gutter (owner decision 2026-09-02, supersedes "tab everywhere"):
claude-code `N<TAB>`, opencode `N:`, codex no gutter. Resolved cheapest-first: explicit
`SS_READ_GUTTER` (the three runners now pin it per harness, 0.04 ms) → env markers → process
ancestry (Linux /proc ~0.1 ms; macOS cached, first call ~6 ms then 0.55 ms).

Files: `core/search/gutter-form.js` (new), `core/search/search-read.js`,
`core/search/search-server.js`, `eval/agent-read-workflows/bin/_ss-helpers.mjs`,
`eval/task-completion-bench/harness/{codex,opencode,claude-code}-task-runner.mjs`,
`tests/search/gutter-form.test.js` (new), `tests/search/read-line-gutter.test.js`.
Tests: 46 pass in the two gutter files; lint clean. Commit this as its own commit
(`feat(read): per-harness gutter form, auto-detected; runners pin it`). It touches the shim, so
it is part of the pre-smoke batch.

---

## 2. Owner decisions already taken (relay; do not re-open)

| # | decision | consequence for this session |
|---|---|---|
| D1 | **Ledger basis = the 1.25× cache-write surcharge on ALL THREE harnesses.** Luna's cache-write price is 1.25× input regardless of harness (OpenRouter $0.25 vs $0.20); charging it on claude-code only was an accounting gap. | Implement §3 F1. Print the basis beside every cost figure. Expected effect on the fresh pool: opencode +3.31% → +2.52%, codex +0.35% → +0.06% (register G17) — reproduce those two numbers as the acceptance test. |
| D2 | **Send the empty-`pages` note to BOTH arms' subagents** via `--append-subagent-system-prompt`. It removes native wasting 1.39 requests per rollout on empty `Read` calls, which flattered sweet. | Implement §3 F2. Arm-symmetric by construction. Any later native improvement from it is a repair of our own defect, never a sweet regression. |
| D3 | Adaptive retrieval budgeting is **deferred past the frozen run.** | Do not build it. Only the `$0` census in §6.4 is pre-registered as an ANALYSIS on the smoke traces. |
| D4 | The smoke pool is the **multi-file, larger-repo stratum of the first held-out set (DEV-RET)**, 20 tasks, selected by metadata (§5.2), not a random 20. | Use `smoke-select.py`; the default 20 are in §5.2. |
| D5 | Admission: adopt only the cheap form (row counters, §3 F5). The preflight form is NOT adopted. HO2 stays at 199. | No preflight form. |
| D6 | Out of the frozen run: the opencode structured tool surface, any guide change, the plan-tool profile, the preflight form, the dotfile index admission (index-affecting, deferred). | Do not touch. |

Two owner decisions remain OPEN and are NOT for this session to take (flag them in the final
report): (a) whether to stamp name-lock and run a null-arm sweep over HO2's 7 vacuity flags as
a pre-declared validity repair before the frozen run; (b) whether to adopt `promptCacheTtl: "5m"`
as a product-documentation recommendation (`SLATE-C-UBER.md` §4.1 rider).

---

## 3. The fixes, in build order

Each item: what, where, acceptance, decision state. Code pointers are from
`SLATE-C-UBER.md` Appendix A; verify line numbers before editing (the gutter change above
shifted some lines in `_ss-helpers.mjs`).

### F1 — Cache-write surcharge on codex and opencode (D1) — ledger, shared, zero differential
- **Now:** `harness/ideal-cost.mjs:89-95` charges `cacheWrite × price.in × 1.25`, but only
  `harness/claude-code-accounting.mjs` supplies a `cacheWrite` field; the codex and opencode
  runners emit none (`turns = [{in, cached, cacheWrite?, out}]`).
- **Do:** have the codex and opencode runners emit `cacheWrite` per turn. Use the SAME
  convention the register used to compute G17 (read `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md`
  §2.1 and `slate-c/verify/c14-history.md` §2 and copy it; if the provider usage carries no
  cache-write field, the convention is "every uncached prompt token is a cache write", i.e.
  `cacheWrite = in − cached`, and that must be printed beside every table). Add a
  `ledgerBasis` label to every cost table the analyzers print
  (`cache-write-1.25x-all-harnesses`), and keep the old basis reproducible behind a flag for the
  disclosure row.
- **Accept:** re-run the cost analysis over the fresh-pool `turns/` usage
  (`results/fp-codex-tab-20260826`, `fp-opencode-tab-20260826` + `rp-oc-tab-20260827`) and
  reproduce opencode +2.52% and codex +0.06% against native. Unit test on `ideal-cost.mjs` with a
  synthetic turn set for all three runner shapes.
- **Decision:** taken (D1).

### F2 — Empty-`pages` note to subagents of both arms (D2) — harness, shared
- **Now:** `harness/claude-code-task-runner.mjs:42-60` `READ_PAGES_TOOL_NOTE` goes to the main
  thread only through ONE `--append-system-prompt` (last-value-wins; keep it one flag). Subagents
  never receive it: 154 of 176 failed native `Read` results are the `""` form; inside subagents
  native wasted 22 requests ($0.0186, 1.3% of the arm), sweet 9.
- **Do:** in `buildClaudeCliArgs`, add `--append-subagent-system-prompt READ_PAGES_TOOL_NOTE`
  for BOTH arms (byte-identical). Claude Code ≥ 2.1.205 supports it; the box runs 2.1.218.
- **Accept:** `$0`: the pinned binary accepts the flag (`claude --help`), a unit test on
  `buildClaudeCliArgs` asserts both arms carry it and that the main-thread flag is still emitted
  exactly once. After the smoke: subagent transcripts show no `Invalid pages parameter` on
  either arm (report the count per arm).
- **Trap:** the PreToolUse Read normalizer hook is INERT and must not be "fixed" (settled
  2026-08-13; comment in the runner).
- **Decision:** taken (D2).

### F3 — Claude-code ledger disclosures — reporting, shared
- **Do:** wherever a claude-code cost figure is printed (the cost analyzers used for
  `FRESH-POOL-RESULTS.md` / `REBASELINE-RESULTS.md`), print beside it: the construction
  (`dearest-3` vs row-matched), the native null-row count (28 of 66 on the fresh pool) and the
  lower-bound flag (205 delegated requests without usage), and the `pages` asymmetry (now
  repaired by F2). Add ONE sensitivity row with the five price vectors of `SLATE-C-UBER.md` §0.2,
  each with its bootstrap interval; label the subagent 0.2× repricing "real-user sensitivity",
  never "bill correction".
- **Accept:** the analyzer output for `fp-claudecode-tab-20260826` shows the rows; no number
  changes.
- **Decision:** none needed.

### F4 — Shim false `INFRA` label — grading correctness, shared
- **Now:** `harness/rt-condense-lib.mjs:46-47` `INFRA_ERROR_RE` contains the bare alternative
  `Could not resolve`. The accenture repo logs "Could not resolve ID of asset …"; the shim then
  forces `status=INFRA`, zeroes the baseline diff and prints a "NETWORK UNAVAILABLE" banner.
  0 of 104 `run_tests` calls in 44 accenture rollouts were trustworthy; 21 of 44 resolved blind.
- **Do:** anchor the alternative to package-manager and resolver forms (e.g. `Could not resolve
  host`, `Could not resolve dependencies`, `npm ERR! … Could not resolve`, `Could not resolve
  hostname`), keep the other network forms, and add fixtures for both directions.
- **Accept:** unit test: the accenture line is NOT infra; `Could not resolve host:
  registry.npmjs.org` IS. Re-run the tally of `slate-c/verify/c15-mechanism.md`
  (`/tmp/wf-slatec/c15-mechanism/tally.mjs` on the box, or a local port over the 12 fresh-pool
  runs). **Stop rule (uber §6 step 2):** if accenture still classifies `INFRA`, the cause is
  elsewhere — stop and report, do not widen the fix.
- **Decision:** none needed.

### F5 — `rtTrustworthy` / `rtInfra` row counters — measurement, shared
- **Now:** `rows.json` carries `rtLaunched, rtVerdicts, rtNoVerdict, rtEndedUnverified` and no
  verdict status, so an all-untrusted rollout is indistinguishable from an all-PASS one.
- **Do:** count per rollout the verdicts with `trustworthy=yes/no` and `status=INFRA`
  (`harness/rt-shim-runtime.mjs classifySuiteResult` is the source; transcripts store each tool
  result twice on opencode and claude-code — de-duplicate against `rtLaunched`, Appendix B
  trap 3). Emit both counters in all three runners' rows.
- **Accept:** a synthetic rollout with all-untrusted verdicts yields `rtTrustworthy=0,
  rtInfra=N`; the per-cell census script (`untrusted-cell-census.sh`) can be replaced by a
  one-line jq over `rows.json`.
- **Decision:** none needed (the preflight admission form is NOT adopted, D5).

### F6 — "not indexed" note gap; `ss-semantic` fallback; `ss-read` on excluded files — sweet-only
- **Now:** `_ss-helpers.mjs` `excludedScopeNote` asks `admitsShape(rel)`, a PATH predicate. The
  indexer drops `dist/index.js` by CONTENT (bundler-banner rule, `core/indexing/indexer-utils.js:440-486`)
  after the path rule re-admits it, so `ss-grep --in dist/index.js` prints a bare `(no matches)`.
  `ss-semantic` on an excluded file returns a whole-file `[FALLBACK]` span (7 of 58 calls, five on
  `dist/index.js` 1–35000). `ss-read` returns any file from disk (13,396 tokens in one call).
- **Do:** make the note consult the index's file table (or a skip manifest the indexer writes
  with the reason: bundle, minified, generated, gitattributes) so every excluded path prints
  `not indexed: <reason>` instead of `(no matches)`. Extend to `ss-semantic` (print the note, no
  whole-file fallback span for an excluded file) and `ss-read` (print the note and a one-line
  pointer to a native read; do not dump the body of a file the indexer refused by content).
- **Accept:** `$0` replay against a golden rebuilt with the 2026-08-28 index fixes: the 7
  fallback calls, the 9 `ss-read dist/index.js` calls and the `--in dist/index.js` zeros
  (rollout ids in `SLATE-C-UBER.md` §4.3). **Kill:** any bare `(no matches)` or file body
  remains. The replay needs the `aws-actions__configure-aws-credentials-42` golden rebuilt
  locally (Mac rebuild is fine for VALIDATION only, never for shipping).
- **Decision:** none needed.

### F7 — `ss-grep` false zeros — sweet-only
- **Now (three defects):** (a) `core/search/grep-output-shaping.js:17-19` `pathSegments('.')`
  is empty, so `--in .` and `--in ./` reject every file (5 calls, 4 with real hits); (b) an
  absent scope path makes `excludedScopeNote` return null and the wrapper prints `(no matches)`
  (10 of 11 calls); (c) the native literal extractor
  (`core/infrastructure/native-sparse-gram.js:308 extractRegexLiteralClauses`) drops an
  alternation branch with no 3-character literal (`_color|_.*,` → `[["_color"]]`, 59 lines
  dropped).
- **Do:** (a) treat `.`/`./` as whole-repo scope; (b) print `scope not found: <path>` and exit
  non-zero-but-informative rather than `(no matches)`; (c) when ANY alternation branch has no
  usable literal, the prefilter must not prefilter (full scan), with a unit test on the exact
  pattern.
- **Accept:** unit tests on `pathSegments` and the extractor; replay
  `slate-c/verify/scripts-claude-main-thread/ss-grep-nomatch-audit.mjs`. **Kill:** more than one
  genuine false absence per 200 rollouts after the fixes. Note: in 0 of 83 located false zeros
  did the agent state an absence and stop — the absence sentence in the guide stays (owner-protected).
- **Decision:** none needed.

### F8 — `ss-find` line-span crash — sweet-only
- **Now:** `ss-find` crashes on an index without late-interaction line spans (2 calls, mathnet).
- **Do:** guard the missing span table and fall back to chunk spans; unit test with a fixture
  index that lacks late-interaction spans.
- **Decision:** none needed.

### F9 — `ss-trace` mode word — sweet-only
- **Now:** the guide teaches `ss-trace <symbol> [callers|callees|impact]`
  (`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md:32`), but
  `_ss-helpers.mjs` `TRACE_USAGE`/`cmdTrace` read only the first positional, so `ss-trace foo
  callers` silently drops `callers` (27 pooled operations).
- **Do:** IMPLEMENT the mode word (restrict output to callers / callees / impact). Do NOT edit
  the guide (owner-protected guidance block).
- **Accept:** unit test per mode; `ss-trace foo callers` output contains only callers.
- **Decision:** none needed.

### F10 — Worktree sessions — sweet-only
- **Now:** `_ss-helpers.mjs:136-147` sets `PROJECT_ROOT = SWEET_SEARCH_PROJECT_ROOT || cwd`; a
  linked git worktree has no `.sweet-search/`, so every `ss-*` call exits 2. Under the bench pin
  (`agent-runner-shared.mjs:142`) the tools read the PARENT's uncommitted tree while `Read` saw
  the clean worktree: 45 worktree-scoped zeros in 5 of 66 sweet rollouts; 6 of 22 subagent
  `ss-*` results echoed the parent's own edit.
- **Do (the refuter's required design):** split the roots — index lookups go to the common
  directory's checkout, `ss-read`/`ss-semantic` file reads stay on the worktree cwd. When no
  index exists and the cwd is a linked worktree (`git rev-parse --git-common-dir` differs from
  `.git`), refuse with a hint naming the main checkout and the env override; never redirect
  silently. Deny `.claude/worktrees/**` at index admission
  (`core/infrastructure/config/search.js:379-395`; `.claude/` is allowlisted and worktree copies
  have been seen inside an index).
- **Accept:** reproduce with `git worktree add`; tests for the refusal text, the split roots,
  and the admission deny.
- **Decision:** none needed.

### F11 — Register corrections — documentation
- **Do:** file every row of the `SLATE-C-UBER.md` §4.6 table into
  `register/DEAD-LEVER-REGISTER.md` verbatim (D4a/D4b, D6/H1, C9, E13, G16/A1, G17 ×2, G6, A3,
  E1/E2, new B-row, G13/G11, new G-row, B18, E3, E1 extension, E2 ×2, E15, §0.2 shipped-surface
  sentence, §12.4 item 25). Add the gutter decision as a C3/C5 amendment: per-harness form,
  pinned in the runners, dead as a lever.
- **Decision:** none needed.

### Explicitly deferred (do not do)
- Dotfile admission (`FILE_PATTERNS.include` lacks extensionless dot-config files): index-affecting,
  would need golden rebuilds; register row only.
- Codex cap-fitting renderer (C9 DEAD), any guide change (B3), plan-tool profile (c01), opencode
  structured surface (A4), preflight admission form, adaptive budgeting (D3).

---

## 4. After the fixes: the ledger

1. All shim-touching fixes above (F6–F10 and the gutter) change the shim fingerprint. Name the
   new ledger version (`luna-<pool>-v5`), and re-sweep the green ledger for the SMOKE pool on the
   box (container time only, no model spend; ~4 min per heavy suite). The frozen run needs its
   own sweep on the same version.
2. Rule: **no run without a green ledger**, and re-sweep after any harness change.
3. Record in the run manifest: shim fingerprint, ledger version, the three pins, the ledger
   basis (D1), the gutter forms per harness, the `pages` note delivery (D2).

---

## 5. The smoke: 20 multi-file, larger-repo tasks from the first held-out set

### 5.1 Why this stratum
The fresh pool (22 tasks, median gold patch 1 file, median golden 310 tracked files, 2 of 21
repos above 1,000 files) and the rotation pool had ~zero retrieval headroom. The only published
same-harness win for a structural code index is on multi-file patches in repos above 1,000
files. The first held-out set is 74 of 200 multi-file after the gate and 38 of 200 repos above
1,000 files; it is DEV data (unrestricted inspection). The frozen set is representative of
SWE-rebench and is NOT re-drawn.

### 5.2 Selection (metadata-only, outcome-blind, reproducible)
Run `python3 handoffs/improve/slate-c/smoke-select.py` from `eval/task-completion-bench`, then
the name-lock census it prints. Screen: selection gate (F2P < 100, P2P ≥ 1) · gold patch touches
≥ 2 EXISTING source files, creates none · issue text names NO gold file · issue > 200 chars · no
vacuity marker · not name-locked (stamped against the vault goldens; 15 of 66 examined
candidates were locked, 22.7% — multi-file tasks are MORE often naming lotteries, so the stamp
is mandatory) · ≤ 1 task per repo · language spread. "Used before" is reported, not excluded.

Default 20 (gold source files / repo tracked files), all DEV-RET, all screened clean on 2026-09-02:

```
python  getmoto__moto-6716 (6/2053)   python-markdown__markdown-1294 (4/488)   mirumee__ariadne-codegen-223 (2/310)
java    projectlombok__lombok-3619 (5/2290)   squashql__squashql-295 (15/526)   eclipse-ee4j__yasson-395 (5/562)
rust    gleam-lang__gleam-3458 (2/2111)   rust-analyzer__rust-analyzer-2616 (6/952)   raphlinus__pulldown-cmark-754 (2/114)
ts      maxgraph__maxgraph-365 (2/784)   vazco__uniforms-787 (3/583)   firebase__firebase-tools-2933 (2/567)
        joshuakgoldberg__bingo-271 (10/379)   rokucommunity__brighterscript-1050 (4/248)
js      yargs__yargs-1422 (5/120)   singapore__renovate-1153 (2/255)   chaijs__chai-990 (3/65)
go      jensneuse__graphql-go-tools-174 (2/187)
csharp  sqlkata__querybuilder-557 (2/95)
dart    intel__rohd-458 (3/303)
```
Name-locked, exclude: `jsx-eslint__eslint-plugin-react-3385 sindresorhus__emittery-121
hdmf-dev__hdmf-752 knative__client-629 openrefine__openrefine-7247
testing-library__svelte-testing-library-404 eslint-community__eslint-plugin-promise-365
eslint__eslint-9905 painterqubits__unitful.jl-478 jimhester__lintr-562 chicio__id3tageditor-54
pointfreeco__swift-case-paths-90 samchungy__zod-openapi-330 dart-lang__http-1114
litestar-org__polyfactory-405`. Bigger dev-200 candidates exist (docker compose-9148 14 files,
serverless-12030 10 files, basedpyright-85 9 files, argo-3371, carbon-2801) but have no local
golden, so they are unstamped; stamping needs a base-tree checkout (a clone at `base_commit`).

If the owner's reviewer supplies a different screened list, use it, but re-run the same screen
on it and record any task that fails.

### 5.3 Goldens for the 20
- The first-held-out goldens were built 2026-07-16 (RunPod) and live in the Mac vault
  (`~/.ss-eval/vault/golden/<owner__repo>@<sha>`); the box copy is NOT durable — verify presence
  (`.sweet-search/codebase.db` + `.git`) before the run.
- Rebuild ONLY the goldens the 2026-08-28 index fixes change: repos with Jam files, git-tracked
  source under build-output directories, or committed bundles/minified files by content shape.
  This is the same rule the owner applied to the frozen set (18 of 267 rebuilt). Indexing happens
  on the owner's RunPod flow, never on the box; vault → `harness/golden-vault.sh push --verify`.
- Stamp each golden with the index build (engine version + index config hash) so the ledger can
  prove provenance (register G9).

### 5.4 Pre-registration of the smoke (write it as `SMOKE-MULTIFILE-PREREGISTRATION.md` before launch)
- Design: 20 tasks × 3 reps × 2 arms × 3 harnesses = 360 rollouts, luna model, pins unchanged.
  Price: about $4.5 at the registered luna price (scale from $10.87 for 891 rollouts).
- Primary outcome: solved rollouts per cell against native; bar ±6 of 60. Secondary: cost per
  rollout on realised, ideal and break-priced columns, under both conventions, ledger basis D1,
  native's claude-code lower bound and null-row counts disclosed.
- Pre-registered expectation: no cell clears ±6 on solves; if sweet cannot beat native on cost
  here, the retrieval-headroom story is dead for this population too.
- Stop rules: run the per-cell trustworthy-verdict census on the pool BEFORE any admission filter
  and abort if more than 4 of 20 tasks are flagged; abort if any golden that needed a rebuild
  still carries a pre-2026-08-28 index; abort the codex leg if `codex exec` authentication is
  dead on the box; abort if the green ledger is not on the new version.
- Blinding: DEV-RET is dev data; per-task inspection is allowed and expected.

---

## 6. After the smoke, before the frozen run

1. Read the smoke aggregates and per-task failures; fix ONLY harness/grader defects it exposes
   (those are shared correctness). Anything shim-touching restarts §4.
2. **Frozen run:** HO2 (199), identical shim, ledger version and pins; aggregate-only; the
   report prints the ledger basis, the construction labels and the F3 disclosures automatically.
   Pre-registration lives in `select/HELDOUT2_RULES.md` and `select/FAIRNESS.md`.
3. Open owner decision to flag before launch (§2): name-lock stamping and a null-arm sweep over
   the 7 vacuity flags as a pre-declared validity repair, reported as a secondary
   "discriminating subset" beside the 199 denominator.
4. **Adaptive budgeting `$0` census (D3), on the SMOKE traces only, analysis not lever:**
   per ss-* call, join the printed `confidence=`, margin (top-1 minus runner-up), tier, tokens
   returned and `sufficient=` with what the agent did next (a further read of the same file or
   not; solved or not). Report: does high confidence + high margin predict "no further read of
   the same file AND solved"? And on the repos above 1,000 files specifically, what is the
   trimmable surplus (returned tokens minus tokens the agent later anchored an edit or a test on,
   excluding documentation comments)? Build the running budget only if the signal predicts
   sufficiency AND that surplus on large repos is clearly above the 1.9% general-pool ceiling.
   Either way it is a lever for the run AFTER the frozen one.

---

## 7. Evidence, pointers, traps

- Box (read-only): `/root/sweet-search-private/eval/task-completion-bench/results/{fp-codex-tab-20260826,
  fp-opencode-tab-20260826, rp-oc-tab-20260827, fp-claudecode-tab-20260826}/`; goldens
  `/root/.ss-eval/golden/`; live ledger `/root/env-ledger/luna-rotate20-v4/ledger.jsonl`;
  scratch from the slate `/tmp/wf-slatec/<agent>/`.
- Local: `slate-c/forensics/*.md`, `slate-c/verify/c01..c15-*.md` with `scripts-*/`,
  `slate-c/register/DEAD-LEVER-REGISTER.md`, `slate-c/candidates/DEDUP.md`.
- Code: `_ss-helpers.mjs` (136-147, 188-190, 247-268, 380-381, 939-956 — shifted slightly by
  the gutter change), `core/search/grep-output-shaping.js` (17-19, 55-88),
  `core/indexing/indexer-utils.js` (440-486), `core/infrastructure/config/search.js` (379-395),
  `harness/rt-condense-lib.mjs` (46-47, 183, 209), `harness/rt-shim-runtime.mjs` (45-47,
  125-127, 187-191), `harness/ideal-cost.mjs` (89-95), `harness/agent-runner-shared.mjs`
  (134-152), `harness/claude-code-task-runner.mjs` (42-92, 268-290, 332-350),
  `core/infrastructure/native-sparse-gram.js` (308), `core/search/gutter-form.js`.
- Traps (Appendix B of the uber, plus this session's): a quote-blind shell segmenter splits
  `ss-grep "a|b|c"` into three operations; `stepsToFirstEdit` equals the call count on codex and
  opencode; opencode and claude-code transcripts store each tool result twice; a child session's
  `CLAUDE_CODE_SESSION_ID` names the parent transcript; claude-code `none`/`pipe` runs have no
  native arm; `pkill -f '<pattern>'` matches your own shell — use `pkill -f 'patter[n]'`; zsh does
  not word-split an unquoted `$VAR` (pass file lists literally); the vault has all 267 HO2
  goldens locally but only 40 of the dev-200 goldens.

---

## 8. Done-checklist (all must be true before the owner launches the smoke)

- [ ] Gutter commit landed; F1–F11 landed as separate commits with tests; `npx vitest run` green
      (daemon-spawn files re-run in isolation if they failed under load); `npm run lint` clean.
- [ ] F1 reproduces opencode +2.52% / codex +0.06% on the fresh-pool usage; every cost table prints
      its ledger basis.
- [ ] F2: `buildClaudeCliArgs` emits `--append-subagent-system-prompt` for both arms; 2.1.218
      accepts the flag.
- [ ] F4: accenture line not INFRA; tally re-run; F5 counters present in a synthetic row.
- [ ] F6/F7 `$0` replays return zero bare `(no matches)` and zero excluded-file bodies; F8/F9/F10
      unit tests green; register rows filed (F11).
- [ ] New ledger version named; green ledger swept for the 20 smoke tasks; manifest records shim
      fingerprint, pins, ledger basis, gutter forms, `pages` delivery.
- [ ] Goldens: presence verified on the box; the affected ones rebuilt on RunPod and stamped;
      none of the 20 carries a stale index.
- [ ] `SMOKE-MULTIFILE-PREREGISTRATION.md` written with the bars and stop rules of §5.4; the
      trustworthy-verdict census run on the 20 (≤ 4 flagged).
- [ ] Final report to the owner: what landed (commit per item), what was skipped and why, the
      two open decisions, and the exact launch command for the smoke.
