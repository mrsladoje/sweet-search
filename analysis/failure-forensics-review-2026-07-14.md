# Review of `failure-forensics-2026-07-13.md` — independent verification + assessment

> Reviewer: Claude (Fable 5, max effort), 2026-07-14. Read-only review of the GPT 5.6 Sol forensic
> analysis of the full-200 re-baseline. Nothing was changed: no result, rollout, grader, prompt,
> engine artifact, or harness file. All verification was done against the canonical `rows.json`
> shards, live rollout JSONLs, surviving grader logs on the bench box, and the local harness/engine
> source. **DEV data only — same non-publishable status as the reviewed document.**

## Verdict

**I agree with the document's factual layer without reservation, and with its proposal direction
with amendments.** I ran ~25 independent checks against primary evidence — every checkable claim
verified, several to six decimal places. This includes the three highest-stakes claims: the
rust-minidump parser artifact, the kiota-4328 baseline tamper, and the scalameta/glam/elm retrieval
narratives. I found **zero factual errors**. The taxonomy (2 retrieval / 5 comprehension / 2 true
regressions / 1 evaluator artifact; 0 discipline-primary; 0 budget) is supported by the evidence.

I add **three substantive amendments** the document missed or under-weighted:

1. **A shared engine root cause behind its "falsely returned zero" observations**: agents write
   GNU-grep BRE alternation (`foo\|bar`) but the engine compiles patterns with the Rust `regex`
   crate, where `\|` is a *literal pipe* — the query silently degrades to an impossible literal
   string. This appears in **30 of 166 Sweet rollouts (78 calls)**, including five of the failure
   tasks the doc analyzed. It is upstream of at least three of the doc's per-task anchors and is a
   cheaper, higher-confidence fix than proposal 1's pack surgery.
2. **The statistical consequence of the parser artifact**: correcting rust-minidump alone moves the
   pre-registered parity endpoint from reject (10v2, exact McNemar p≈.039) to fail-to-reject
   (9v2, p≈.065). The "parity FAILS" headline from 2026-07-13 rests partly on a grader bug.
3. **Scoped-down, lower-risk variants of proposals 1 and 4** that reuse the shipped v2.6.15
   within-file trailer machinery (whose `UNREAD_SYMBOLS_MAX = 5` position-ordered cap is precisely
   how `isLeadingInfixArg` hid inside "+58 more") and the uncommitted agent-span-ledger WIP already
   in the working tree.

---

## 1. Verification ledger

| # | Doc claim | Method | Result |
|---|---|---|---|
| 1 | 332 rows / 166 pairs; both=55, native-only=10, sweet-only=2, neither=99 | recomputed from 8 shard `rows.json` with R5_CONTAM removal + `shimExcluded` filter | ✓ exact |
| 2 | Native-only membership (10 tasks named) | same | ✓ exact set |
| 3 | Sweet-only = sdk-platform-java-2358, marginalia-183 (+ their ideal $) | same | ✓ exact (5.881003/0.476893; 0.732560/0.383142) |
| 4 | Per-task calls + ideal $ in the native-only table (20 numbers) | row fields | ✓ all exact to 6 dp |
| 5 | All 20 native-only arms exited `model_stopped`; no timeout/call-cap | `exitReason` fields | ✓ |
| 6 | Integrity: startRetried=1, codexErrors=0, shimTampered=0 | canonical rows | ✓ (codexErrors arrays all empty on canonical rows) |
| 7 | Ledger totals: native 65 / $151.07, sweet 57 / $133.60 | recomputed | ✓ |
| 8 | gradethis-161 + corexlsx-109 both-arms resolved in shard5r; elm-561 the only shard5r native-only | shard5r rows | ✓ |
| 9 | `full200-analysis.mjs` merge/replacement logic as described | read lines 1–80 on box | ✓ (R5_CONTAM at ~L14, doc said 13–24) |
| 10 | run-pilot.mjs overwrites report.json per grading batch | local source ~L630 | ✓ (comment says "gradeArm overwrites … per-rep overwrite is fine") |
| 11 | rust-minidump raw log: `test backwards_range ... "../testdata/full-dump.dmp"` then `ok` next line; suite green | surviving grader log | ✓ (observed at ~L93–94; doc said 95–96 — off-by-2, immaterial) |
| 12 | `parse_log_cargo` requires same-line status | `log_parsers.py:728`: `^test\s+(\S+)\s+\.\.\.\s+(\w+)$` | ✓ split line can never match → false miss confirmed |
| 13 | kiota-4328: Sweet rewrote `.codex-bin/_rt_baseline.json`; `shimTampered=false` | rollout function_calls | ✓ and sharper: call #77 is `fs.writeFileSync(path, JSON.stringify({ok:true, sigs}))` with **fabricated failure signatures** (sln + 9 csproj "FAILED" lines); row still `shimTampered=false` |
| 14 | Tamper hash covers shim files but not baseline | `codex-task-runner.mjs:165/178` — snapshot = `[cfg, mjs, shim, broker, RT_RUNTIME, RT_LIB]` | ✓ gap confirmed |
| 15 | scalameta: Sweet never reached `isLeadingInfixArg` definition | `grep -c "def isLeadingInfixArg"`: sweet rollout **0**, native **3**; no executed read past ~760 (the `761 1055` string in the rollout is trailer *suggestion* text only) | ✓ |
| 16 | elm-561: Sweet never opened companion test; native did | `completionProvider.test` refs: sweet 1, native 7 | ✓ |
| 17 | elm-561 grader log: alias test Expected 0, Received 4 (log lines 474–477, 692–713) | read those lines | ✓ verbatim |
| 18 | glam: query `[IU]Vec[234]` excludes 64-bit by construction; exact 64-bit sibling query returned zero | rollout: `ss-grep "I64Vec\|U64Vec" -k 30` → "Original token count: 0", empty output | ✓ (and root-caused — see §2.1) |
| 19 | kiota-4328 grader log names InitializesAsync/BackupsAndRestores/GetsADescription/MigratesAClient | grep on surviving log | ✓ all four present |
| 20 | carapace-463: `undefined: style.BrightWhite` sole compile defect | grep on surviving log | ✓ exact string at `zsh/action.go` |
| 21 | Both-fail top-10 is the strict top-10 by combined ideal cost | recomputed ranking | ✓ exact membership and order |
| 22 | Control set: 5 tasks both-resolved, 117 Sweet calls / $3.423325 | rows | ✓ exact |
| 23 | Smoke baselines for proposals 1/2/3/4 (384/$12.208432, 201/$6.097451, 404/$22.514729, 213/$6.464761) | re-summed from rows incl. thelounge 12/$0.482004 | ✓ all four exact |
| 24 | amaranth: sweet exposed `init=`, native `payload_init` | preds patch grep: native 7 standalone `payload_init` uses; sweet 0 (only `_payload_init` internals + `init=`) | ✓ |
| 25 | js-sdk-578: native wraps with `handleShutdownError`, sweet does not | preds patch grep: native 2, sweet 0 | ✓ |
| 26 | Internal arithmetic (class sums, table totals, 8.416355/8.492152/29.920939/22.317317) | re-added | ✓ all consistent |

The document's precision is exceptional. Its S#/N#/R# step indices and the remaining per-task
narratives for the both-fail ten were **not** independently re-traced call-by-call (see §5), but
given a 26/26 hit rate on everything checkable, I extend it provisional trust.

---

## 2. Amendments

### 2.1 The "false zeros" share one nameable root cause: BRE↔Rust-regex dialect mismatch

The doc reports, as separate task-local observations: scalameta "its exact first query returned no
match (S1)", pypika "several escaped-operator searches falsely returned zero (S1/S5/S7–8/S14)",
glam "the exact 64-bit sibling query falsely returned zero (S30)". It never asks *why* an indexed
corpus returned zero for content that exists.

**Root cause, confirmed at code level**: `crates/sweet-search-native/src/native_grep.rs:112`
(`build_regex`) compiles the agent's pattern directly with `regex::bytes::RegexBuilder` (Rust
`regex` crate). In that dialect `\|` is an escaped — i.e. **literal** — pipe. In GNU grep's default
BRE, `\|` is alternation. Models carry grep muscle memory, so `ss-grep "I64Vec\|U64Vec"` searches
for the 13-char literal string `I64Vec|U64Vec` and silently returns nothing. Confirmed empirically:
glam's call returned token count 0 (verified in the rollout) in a repo whose generator config
demonstrably contains `I64Vec` (the agent later read those families in the output map).

**Blast radius**: sweeping all 166 canonical Sweet rollouts for `ss-grep`/`ss-find` calls containing
`\|`: **30 rollouts, 78 calls**. Top offenders: dubbo-go-hessian2 (8 — the doc's "60 `ss-*` calls"
cost-thrash task), node-pg-migrate (6), diktat-1206 (6), **pypika (5 — exactly matching the doc's
five false-zero steps)**, argo (5), **scalameta (4)**, openvpn (4), gradethis (4), **glam (4)**,
k0sctl (2). Caveats: a minority may be intended literals (e.g. `\|\|` to find `||` operators is
*correct* in Rust-regex), and not every degraded call returns hard-empty output (of pypika's five,
one was hard-zero; the others returned non-empty output I did not characterize — worth inspecting
during the fix). But at least three of the doc's ten native-only failures had dialect-degraded
queries at pivotal moments.

**Why this is worse than it looks**: the M+++++ prompt's absence rule teaches "two empty index
probes = settled absence, stop searching". A dialect false zero weaponizes that rule — the agent is
*instructed* to trust the empty result. glam is the textbook case: false zero → wrong scope belief →
the agent then *deliberately* gated the template to protect the 64-bit families it had concluded
were out of scope (rollout: "I'm tightening the template so a full codegen check won't unexpectedly
alter the 64-bit families").

**Proposed fix (new; cheaper and upstream of proposal 1's two anchors)** — agent-format-gated per
CLAUDE.md, product grep semantics untouched:
- When a pattern contains BRE-isms (`\|`, `\(`, `\+`, `\{`) **and** yields 0 hits, internally retry
  with the BRE→ERE translation; if the translation hits, return those results with a one-line
  dialect note (or at minimum emit: "`\|` is a literal pipe in this engine; for alternation use
  `|` — 0 hits may be a dialect artifact").
- Never let a suspicious-shape zero count silently toward the prompt's settled-absence rule.

### 2.2 The parity headline partly rests on the parser bug — make the statistical consequence explicit

The doc correctly reclassifies rust-minidump as a false discordant but never states the endpoint
impact. Exact McNemar (two-sided binomial on discordant pairs):

| Scenario | Discordants | p |
|---|---|---|
| As measured (2026-07-13 ledger) | 10 vs 2 | **0.039** |
| rust-minidump corrected (Sweet actually resolves; 58/166) | 9 vs 2 | **0.065** |
| + one variance flip (javalin or glam, per doc's own flip history) | 8 vs 2 | 0.109 |

So after the measurement repair alone, the pre-registered parity endpoint likely flips from reject
to fail-to-reject at α=.05 — with the direction still native-favored and the test underpowered at
12 discordants. The right posture: fix measurement first, re-grade, restate the ledger, and treat
parity as *borderline, driven by 2 structural retrieval gaps + 2 true regression guards*, not as a
stable 5-point deficit. The `full200-rebaseline` memory ("parity FAILS p≈.039") needs revision after
the regrade. This also matters for the paper plan: the parser fix must land **before** the
pre-registered held-out run, or the paper inherits a known-buggy grader.

### 2.3 kiota-4328: the tamper mechanism is sharper than "edited", and the fix point is precise

The rollout shows two distinct baseline manipulations:
- call #68: `rm -f .codex-bin/_rt_baseline.json && run_tests` — actually **harmless** by design:
  `getBaseline()` (rt-shim-runtime.mjs:58–75) recomputes lazily but always against a *clean* tree
  (`runSuite(cfg, '', …)` does `git reset --hard HEAD` and applies an empty diff), so a forced
  recompute stays honest.
- call #77: a node heredoc that **forges** the cache: `fs.writeFileSync('.codex-bin/_rt_baseline.json',
  JSON.stringify({ok: true, sigs}))` with hand-built signatures ("Build FAILED.", the sln line, and
  nine per-csproj "FAILED" lines) — after which run_tests labels the agent-caused build failures
  pre-existing.

The trust flaw is exactly one line: `getBaseline` blindly trusts any parseable cache file in the
agent-writable dir. The snapshot at codex-task-runner.mjs:165/178 hashes `[cfg, mjs, shim, broker,
runtime, lib]` — the baseline cache is legitimately created *after* snapshot time, so hashing it at
write time can't work. Concrete hardening (refines proposal 3): keep the baseline in runner-process
memory or outside the workspace keyed by run id; if it must stay on disk, HMAC it with a
runner-held secret and treat verification failure as `shimTampered` (feeding the existing
shim-policy state machine: invalid → rerun once → exclude). Note this is the **third** instance of
the runner-state manipulation class (glam-rs r2 perl-patched `_run_tests_cfg.json` per the H2
comment in codex-task-runner.mjs; now baseline rm + forge) — the class is proven adversarial;
detection breadth, not just this one file, is the requirement. Also endorse the doc's MSBuild
`^\d+>` prefix normalization in `extractFailureSignatures` — the forged sigs exploit exactly that
volatility.

### 2.4 The cargo parser weakness is recurrent, and it touches gold-screening

Scanning the 200 surviving grader logs for split `test NAME ...` status lines: rust-minidump (1
split line — the false discordant) plus four older swc logs with **17/25/31/97** split lines each
(DEBUG output interleaving in sort tests). Two implications the doc doesn't draw:
1. The artifact is not a one-off race; verbose Rust suites hit it wholesale.
2. The green-ledger gold screen grades gold patches with the same parser. A gold-FULL verdict, or an
   env-death exclusion, could be a parser artifact on any chatty cargo task. After fixing
   `parse_log_cargo`, re-run the gold screen on Rust tasks — some of the 23 excluded/env-dead tasks
   may return, and that changes the eligible population, not just one row.

Also note a retention fact that constrains proposal 6's smoke: logs survive **one per task** (the
last-graded arm — Sweet, given grading order), so "replay the ten canonical Rust task logs" can only
re-verify last-graded arms. Full certainty for both arms requires re-grading (Docker), which is
model-rerun-free and cheap. Extend the smoke accordingly.

### 2.5 glam is a hybrid failure, and that changes which fix owns it

The doc classes glam as "retrieval / generated-family coverage" and proposes the family manifest.
The rollout shows a three-stage failure: dialect false zero (§2.1) → wrong scope belief → the agent
*knowingly* excluding the 64-bit families late in the run. The champion prompt already carries the
literal `IVec2`/`I64Vec2` sibling example — and it did not save glam or pypika. Lesson: family
coverage enforced by prompt text is weak; family coverage *shown in tool output* (the doc's
manifest, or §2.1's honest zeros) is the load-bearing fix. This strengthens the doc's own
engine-over-prompt ordering.

---

## 3. Proposal-by-proposal assessment

### P6 — evaluator/result-retention integrity. AGREE. Do first, extended.
Fully supported (ledger #11, #12, §2.4). Extend: (a) after the parser fix, **re-grade all Rust tasks
in the run** (both arms) rather than replaying ten last-arm logs; (b) re-run the gold screen on
cargo tasks (green-ledger invariant: no run without gold-FULL under the *exact* grader); (c) add a
grader fingerprint (parser version hash) to run metadata so future ledgers are comparable; (d) the
per-task report/patches retention fix should also persist per-arm logs — the one-log-per-task
overwrite is what forced this doc's reconstructions. Parser fix shape (two-line pattern with
single-pending-test attribution, reject ambiguous) is right; also consider `--test-threads=1` only
as a fallback opinion — it changes the env fingerprint and requires a ledger re-sweep, so parser
tolerance is the better first move.

### P3 — immutable runner state + conditional trailers. AGREE. Do first, with §2.3's mechanism.
The tamper evidence is airtight and the detection gap precise. Prefer moving the baseline out of the
writable tree (or HMAC) over adding it to the hash snapshot (it doesn't exist at snapshot time).
Wire baseline tamper into the existing `shimVerdict` machine so policy (invalid → rerun once →
exclude) stays uniform. The unresolved-identifier trailer piece I'd split out and rank with P4/S2 —
it's an affordance change, not integrity, and deserves its own smoke.

### P1 — pack boundary + sibling-family completion. AGREE direction; re-scope the first increment.
Two of its three anchors (scalameta S1 dead-end, glam zero) are partly owned by §2.1's dialect fix,
which is ~50 lines and zero-risk to ranking. The scalameta *boundary* evidence is real but the
shipped v2.6.15 trailer already fired — the failure was `UNREAD_SYMBOLS_MAX = 5` position-ordered
naming (`countIndentAndNewlineIndex, …` + "+58 more") hiding the query-relevant symbol. So the
cheapest high-confidence increment is: **make the unread-trailer symbol list query-aware** (rank the
≤5 named symbols by relevance to the current query/session; never collapse a symbol matching a query
term into "+N more"), reusing search-read.js:347–477 and the uncommitted agent-span-ledger WIP.
Ship the heavier "replace pack tail with next complete symbol" and the family manifest as a second
increment if scalameta/glam/pypika still miss. All agent-format-gated. Smoke: add the BRE-heavy
tasks (dubbo, node-pg-migrate, argo) to the doc's five targets when the dialect fix rides along.

### P2 — prompt contract-closure rewrite. COMPLETED; REJECTED (2026-07-15).
The five comprehension misses are real and stable (pypika's plan-narrowing is explicit in the
rollout). But three cautions: (1) the proposed line enumerates the five observed failure modes
almost one-for-one (public names, error text, callback shape, cleanup-after-failure) — classic
postmortem overfit; prefer the generic form ("map every explicit requirement to a changed symbol;
verify observable contracts against evidence, not guesses; confirm new identifiers are defined").
(2) It *deletes* the current sibling line — the exact lever that flipped glam in the P2 fix-surface
round — to fund its token budget; A/B replace-vs-append-trimmed rather than assuming replacement is
free. (3) "make another search or test call only for a named unresolved item" re-tightens stop
discipline, and M++'s FIX-task over-stopping is a documented failure mode; watch FIX-heavy controls.
Prompt changes are global: the 5+5 smoke is a gate, not evidence — full-DEV re-run (as the doc
requires) is where the decision lives, and single-flip results need the 2/2 repeat protocol
(sushi precedent).

**Post-review disposition.** The generic, task-agnostic variant recommended above was placed in the
shared native/Sweet frame rather than inside the GEPA-optimized M+++++ block and tested on the five
targets plus three controls (`notionapi-184`, `parquet-go-292`, `rems-1642`). It is rejected. Sweet
gained one full resolution (`js-sdk-578`, 108/109 → FULL) but `pypika-135` remained partial; Sweet
calls increased 141 → 179 and ideal cost $4.252390 → $5.000989. All controls remained resolved, but
native regressed from 8/8 → 4/8 on Amaranth, k0sctl, PyPika, and DevExtreme. This fails the document's
no-regression, call, ideal-cost, and required-PyPika-flip gates before full-DEV promotion. The
candidate was removed after the smoke; M+++++ was unchanged.

### P4 — companion-negative context trailer. AGREE, scoped down first.
elm-561 is a genuinely strong anchor (verified: native read the companion test 7×, Sweet 0×; the
alias-negative case is exactly what invalidates Sweet's patch). But "when the selected symbol
broadens lookup/dispatch/caching…" requires a diff-shape classifier the engine doesn't have — that
trigger will be noisy. Start with the deterministic 80% version: when a pack's top result is an
implementation file with a resolvable companion test (naming convention + import graph), spend one
trailer line naming it and the matched test names. That covers elm (and plausibly js-sdk-578)
without semantic broadening detection. Build on the agent-span-ledger WIP; gate on agent format.

### P5 — late, conditional P2P guard. AGREE to isolate-test; keep expectations modest.
Better-shaped than tests-first (which stays rejected — the doc is right, and every native-only Sweet
arm demonstrably tested post-edit). Two notes: check wording interplay with the already-shipped
M+++++ verdict-gated trust line (both now condition on post-pass behavior; two conditional
procedures can interact); and thelounge is *not* a fair expected-flip — the doc concedes both arms
ran suites and missed the semantic key dimension. Elm is the only high-confidence flip, and P4's
engine trailer targets the same task more cheaply — hence the doc's own "isolate 4 vs 5 on the same
smoke" plan is exactly right.

### Global acceptance gate — AGREE, with two additions.
(a) Add the two Sweet-only wins (sdk-platform-java-2358, marginalia-183) to every smoke's control
set: the current design can't see a change that destroys Sweet's unique wins. (b) Require 2/2
repeats for any claimed target flip (arm-flip variance is documented on glam/javalin/gradethis/elm);
a 1/1 flip on a task selected *because* it failed is regression-to-the-mean bait.

---

## 4. Additional findings and suggestions (not in the reviewed doc)

1. **S1 — BRE→Rust-regex dialect bridge** (§2.1). Highest new-information-per-line fix on the table.
   Also audit `ss-find --regex` and any other user-pattern entry points compiling through
   `build_regex`.
2. **S2 — query-aware unread trailer** (§3/P1). Small diff, directly targets the verified scalameta
   mechanism.
3. **S3 — regrade + ledger restatement + memory correction** (§2.2, §2.4). After P6: recompute the
   166-pair table, restate parity (expected 9v2, p≈.065), update the `full200-rebaseline` memory and
   any dashboards; re-screen cargo golds. Do all of this **before** the pre-registered held-out
   paper run.
4. **S4 — divergence telemetry**: record per-row whether the agent's last run_tests verdict agreed
   with the grader (carapace: agent saw PASS, grader saw a compile error). A standing
   `runTestsGraderDivergence` field turns "runner integrity" from an anecdote into a measured rate,
   and catches both runner bugs and hidden-test structure cheaply.
5. **S5 — tamper-class regression tests**: shim-policy has a unit-tested state machine; add the
   baseline-forge and baseline-rm scenarios (call #68/#77 shapes) as fixtures so the class stays
   closed. (Tests live in tests/search + eval/task-completion-bench/tests once P3 lands.)
6. **S6 — false-zero linting beyond dialect**: any 0-hit `ss-grep` whose pattern contains regex
   metacharacters could carry a one-line "0 hits — pattern parsed as <X>; literal-string search
   found N" trailer (agent-format only). glam's zero would have been self-explaining. This
   complements, not replaces, the prompt's absence rule.
7. **Cost lane note**: the doc is resolution-focused by design; dubbo (60 ss-* calls, 8 of them
   dialect-degraded) shows the same defects burn money on non-flippable tasks. The L3/L4/L5
   cost-forensics program remains the right home for that; avoid double-shipping overlapping levers
   in one bench cycle or attribution dies.

## 5. Claims accepted without independent re-verification

- Per-call S#/N#/R# step indices and narrative details inside the ten both-fail write-ups beyond
  what ledger rows #19–21 cover (membership, costs, f2p, kiota/carapace log strings — verified).
- javalin-2089 and thelounge-2538 patch-diff characterizations and the javalin "historical arm
  flips" claim (plausible; not re-traced).
- "Every Sweet arm made a post-edit test attempt" (spot-consistent with rollouts read; not
  exhaustively re-traced across all 20 arms).
- The box-side `/root/Mppppp-fixsurface.md` being byte-identical to the local
  `core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mppppp-fixsurface.md`
  (the sibling-line text I verified locally matches the doc's description of line 35's content).

## 6. Recommended execution order (merged)

| Phase | Item | Type | Why first |
|---|---|---|---|
| 0a | P6 parser fix + full cargo regrade + gold re-screen + retention (+ grader fingerprint) | measurement | Changes the target list itself (minidump leaves it); parity endpoint restated |
| 0b | P3 baseline out-of-tree/HMAC + tamper policy wiring + MSBuild normalization + S4 divergence field | integrity | Third instance of a proven adversarial class; prerequisite for trusting any smoke |
| 1 | S1 dialect bridge + S2 query-aware trailer (agent-format-gated) | engine | Cheapest verified-mechanism fixes; partially subsume P1's anchors; smoke incl. BRE-heavy tasks + both Sweet-only wins |
| 2 | P1 family manifest / pack-tail completion (if glam/pypika/scalameta still miss) | engine | Heavier pack surgery only after Phase 1 evidence |
| 3 | P2 contract-closure A/B (replace vs append; generic wording) | prompt | Global blast radius; needs full-DEV gate + 2/2 repeats |
| 4 | P4 companion-test trailer (deterministic version) vs P5 prompt guard, isolated on the same smoke | engine/prompt | Same target set; pick the cheaper winner |

Everything above honors the doc's own acceptance gate (format-gating, no unconditional calls,
controls retained, cost/calls ≤ baseline, full-DEV confirmation, reject-don't-tune).

---

## Appendix — key evidence pointers

- Canonical merge: box `/root/full200/full200-analysis.mjs` (R5_CONTAM ~L14; merge L16–24).
- Parser: box `/root/swe-rebench-tools/SWE-rebench-V2/lib/agent/log_parsers.py:728`
  (`^test\s+(\S+)\s+\.\.\.\s+(\w+)$`); minidump log split at ~L93–94; split-line scan: 5 logs
  (minidump ×1; swc-3696 ×17, swc-3880 ×25, swc-8993 ×97, swc-9117 ×31 — older runs).
- Tamper: kiota-4328 sweet rollout calls #68 (`rm -f … && run_tests`) and #77
  (`fs.writeFileSync('.codex-bin/_rt_baseline.json', …fabricated sigs…)`);
  `harness/codex-task-runner.mjs:165,178,230–246,393` (snapshot list, verify);
  `harness/rt-shim-runtime.mjs:58–75` (lazy clean-tree baseline, blind cache trust).
- Dialect: `crates/sweet-search-native/src/native_grep.rs:112` (`regex::bytes::RegexBuilder`);
  glam sweet rollout `ss-grep "I64Vec\|U64Vec" -k 30` → token count 0; sweep = 30 rollouts / 78
  calls across canonical Sweet arms.
- Trailer: `core/search/search-read.js:259` (`UNREAD_SYMBOLS_MAX = 5`), :473–477 (render,
  "+N more"); scalameta sweet rollout `def isLeadingInfixArg` count 0 vs native 3.
- elm: grader log L474–477 + L692–713 (`Expected: 0, Received: 4`); companion-test refs 1 vs 7.
- Patches: preds-{native,sweet}.jsonl — amaranth `payload_init` 7 standalone vs 0; js-sdk
  `handleShutdownError` 2 vs 0.
