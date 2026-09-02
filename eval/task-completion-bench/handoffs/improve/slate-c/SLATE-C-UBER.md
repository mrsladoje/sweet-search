# SLATE C — UBER: canonical continuation document (2026-09-02)

**Status:** analysis only. `$0` spent. No rollout launched. Nothing under `results/` written.
HO2 (the frozen held-out set) never opened. No grading log content reproduced.
**Inputs:** `slate-c/BRIEF.md`, `slate-c/register/DEAD-LEVER-REGISTER.md` (123 rows), eight
forensics and six research reports, `slate-c/candidates/DEDUP.md` (27 raw candidates, 15 kept),
and 45 adversarial verification reports under `slate-c/verify/`.
**Predecessors:** `SLATE-A-UBER.md` and `SLATE-B-UBER.md`; this file does not repeat them.
**Revision:** 2026-09-02, after the completeness critic (`slate-c/CRITIC.md`, 19 gaps). Every gap
and its disposition is listed in the final section. The headline verdict did not change.
**Tags:** `[M]` measured with a named script, `[C]` read from code or a deployed binary,
`[W]` web with URL, `[I]` inferred with the arithmetic shown.

---

## 0. Executive verdict

**No admissible combination on the record reaches at-most-native cost on all three harnesses
at equal-or-better solves.** Fifteen candidates entered adversarial verification. Zero survived
as a cost or solve lever. Six more were dropped at dedup by their own `$0` falsifiers. What
remains is measurement repair and product correctness with no benchmark claim.

### 0.1 The arithmetic, per harness (fresh pool 2026-08-26/27, 66 rollouts per cell)

| harness | native $/rollout | sweet $/rollout | cost sweet must cut | solves sweet must add | largest surviving sweet-only cost mechanism | reaches the bar? |
|---|---:|---:|---:|---:|---|---|
| codex | 0.012287 | 0.012330 | −$0.000043 (−0.35% of the sweet cell) | +2 of 66 (39 → 41) | none live. The cost gap is small: a sub-0.5% hygiene item could close it if one were live (the §4.3 bundle hunt is +$0.000059 per pooled codex rollout, larger than the gap, but it is booked at zero for its own reason). The "no" rests on the solve column. | **no** on solves: +2 of 66 needed and no solve lever survived |
| opencode | 0.008968 | 0.009265 | −$0.000297 (−3.2% of the sweet cell, published ledger; see the ledger note below) | 0 (41 = 41) | register A4 structured surface, owner-excluded and unbenchmarked. Requests: it can at best make sweet batch like native, so request parity is its ceiling. Cost, `verify/c02-mechanism.md` §5 verbatim: vehicle (b) custom structured tools nets "−0.4% to −4.5%" of the sweet cell, "landing sweet between +2.9% and −1.2% against native"; vehicle (a) plugin intercept "is exactly parity". The top of that range clears the bar `[I: 0.009265 × 0.955 = $0.008848 against native $0.008968, −1.34%]`; the bottom misses it; the realised fraction is unknown. | **no** without an owner decision; with one, the range spans a miss and a small unbenchmarked win |
| claude-code | 0.021558 (lower bound) | 0.020727 | already −3.9% on this ledger | +3 of 66 (40 → 43) | none; the −3.9% rests on one bench artefact and one price-vector counterfactual (§0.2) | **no** |

Cells `[M BRIEF.md §1; rows.json of fp-codex-tab-20260826, fp-opencode-tab-20260826 +
rp-oc-tab-20260827, fp-claudecode-tab-20260826]`. Cut and solve columns `[I]`. Opencode ceiling
`[M verify/c02-mechanism.md §5]`.

**Ledger basis of this table.** The codex and opencode cells are on the published ledger, which
charges the 1.25× cache-write surcharge on claude-code only: `ideal-cost.mjs` multiplies a
`cacheWrite` field by 1.25, `claude-code-accounting.mjs` is the only module that supplies it, and
the codex and opencode runners emit no such field `[C ideal-cost.mjs:95; claude-code-accounting.mjs;
codex-task-runner.mjs and opencode-task-runner.mjs, zero occurrences of cacheWrite]`. Charging the
surcharge on all three harnesses (register G17's open half) moves opencode +3.31% → +2.52% and codex
+0.35% → +0.06% `[M register G17]`. On that consistent ledger the cut sweet must make on opencode
is about 2.5% of the sweet cell, not 3.2% `[I: 2.52 / 102.52]`. Item §4.1 asks the owner to choose
one basis; until then every cross-harness cost table must say which ledger it uses. This table
uses the published one.

Two facts bound every row. First, sweet carries three fixed sweet-only terms, each measured
separately and printed separately here: the guide ($0.00042–0.00051, 2.6–4.5% of a rollout); the
gutter ($0.00030–0.00039, 2.0–3.7%); and requests after failed `ss-*` calls (2.4% / 2.2% / 1.9%
on codex / opencode / claude-code) `[M BRIEF.md §1.1; register E2]`. The third term is an upper
envelope, not removable spend, and the review panel rejected the zero-behavioural-risk framing
`[M register E2]`. Their sum, about 7–10% of a rollout, is therefore itself an upper envelope;
§4.7's no-summing rule applies to it. Second, the detection
bar is ±6 rollouts of 66 per harness; the paired minimum detectable solve effect at 80% power is
6.8 rollouts of 66 `[I from M verify/c05-measurability.md §6.1]`. No surviving item claims more
than 1 solve or 2% of a cell.

### 0.2 The claude-code "win" is not a win

Seven constructions of the claude-code delta exist on the one run. They span −8.8% (row-matched
inclusive) to +1.9% (every dollar spent) `[M verify/c14-measurability.md §2 R5]`. The published
−3.9% is the "dearest-3" convention on the run's own native total, $0.021558. The replay below
uses the same convention but rebuilds native at $0.021437 (−0.6%), while sweet's $0.020727
reproduces exactly `[M verify/c14-mechanism.md §7]`; that is why its ledger row reads −3.31% and
not −3.9%. Nobody in this slate rebuilt the published native cell from `rows.json` (§7 item 17).
On the path a real user pays, the sign flips:

| scenario, main thread plus sidechain, per rollout | row-matched | dearest-3 (published convention) |
|---|---:|---:|
| ledger as published (luna vector) | −8.81% | −3.31% |
| bootstrap interval around the ledger row `[M verify/c14-history.md §4; quoted per its §7 correction 6]` | [−33.1%, +29.1%] | not computed |
| per-token real-user path (API key): Opus 5 five-minute vector, subagents priced at the model they requested | −2.45% | +2.70% |
| the same, with the `pages` defect removed from both arms | **−0.18%** | **+5.00%** |
| subscription path: Opus 5 one-hour main thread, five-minute subagents at the requested model | −0.34% | +4.12% |
| subscription path with the `pages` defect removed from both arms | +2.23% | +6.69% |

`[M verify/c14-mechanism.md §5, c14_replay.py, 132 rows, 66 per arm]`. The all-22 main-only
construction reads −1.4% [−20.1%, +27.0%] `[M verify/c14-history.md §4]`. Every repricing row is
a point estimate inside an interval that spans −33% to +29%; no row here is a detection. Solves
are unchanged by construction (native 43/66, sweet 40/66). One bench artefact and one price-vector
counterfactual carry the published sign. The artefact: native wasted 1.39 requests per rollout on
`Read` calls with an empty `pages` argument (92 wholly wasted requests against sweet's 23) `[M]`.
The counterfactual: native asked for haiku on 19 of 33 subagents, but the runner pins all three
model slots (`ANTHROPIC_DEFAULT_SONNET/OPUS/HAIKU_MODEL`) to one OpenRouter slug, so every
subagent ran as luna and luna's rate is the true price of what ran `[C claude-code-task-runner.mjs:279-281;
M claude-subagents.md]`. Repricing those subagents at 0.2× is a real-user sensitivity, not a bill
correction `[M verify/c14-history.md row 3; verify/c14-mechanism.md §4]`. The native inclusive
cost is also a lower bound: 205 delegated requests carry no usage record and 28 of 66 native rows
are null `[M register G6]`.

### 0.3 Why no lever survived

The cost premium is pre-edit and lives on the ten tasks not solved everywhere. On the tasks both
arms solve 3 of 3 (twelve tasks on codex and opencode, eleven on claude-code; 72/72/66 rollouts),
sweet spends about the same number of requests as native (+0.14, +1.19, −0.03 per rollout). It
costs −3.4% (codex) and −3.7% (opencode) there. Its claude-code main thread is +2.1%
`[M forensics/phase-anatomy.md §2.1–2.3]`. The post-edit tail is equal or shorter in sweet on
every harness `[M forensics/verify-tail.md §2, 396 rollouts]`. The three structural drivers are
harness facts sweet cannot move inside the owner's scope (§3). The one sizable sweet-only cost
mechanism is a structured surface on opencode. It is owner-excluded; corrected, it gives request
parity at best and a cost anywhere from +2.9% to −1.2% against native, unbenchmarked (§8 item 1).

On solves, 136 of 180 canonical cells on the ten hard tasks lose. 72 (53%) are classed as locked
by hidden tests `[I on M forensics/wrongfix-facts.md §3]`. That class is an inference from the
solve matrix, the base tree, the issue text and the agents' own patches; in the source's words,
"Gold and hidden-test fields were counted, never read into this report". 34 (25%) share one
computable fact class, argument provenance along the call graph `[M same source, §3]`. The
certificate built for that class fires on 1 of 22 tasks at
its stated setting. That task never gave any agent a trustworthy test verdict. Even at a 100%
flip the certificate does not reach parity `[M verify/c05-measurability.md]`. No solve lever
survived.

### 0.4 What to do first

1. Repair the claude-code ledger disclosures and file the register corrections (§4.1, §4.6).
2. Fix the shared test-shim false `INFRA` label and add the row counters (§4.2). The
   trustworthy-baseline admission check is an owner decision (§8 item 10) and forward-only.
3. Ship the product-correctness fixes in §4.3–4.5 with no benchmark value claimed.
4. Take the owner decisions in §8. Only the A4 decision can change opencode's position as a
   lever; finishing G17 (§4.1) moves the measured opencode gap to +2.52% as a ledger fairness
   fix, not a lever.
5. Do not launch a paid run until the goldens are rebuilt and stamped (§6).

---

## 1. Standing position and what this slate adds

The standing position is `BRIEF.md` §1: sweet +0.3% codex, +3.3% opencode, −3.9% claude-code;
solves 120 against 125 of 198; nothing clears ±6. This slate adds nine measured facts.

1. **The premium is pre-edit, on hard tasks.** Verify is the only phase dearer for sweet on all
   three harnesses (+0.56, +0.86, +1.03 requests per rollout). Localize is shorter on opencode
   (−0.97) and claude-code (−0.79) `[M phase-anatomy.md §2]`.
2. **The opencode gap is a tool-family habit, not "one Bash call per request".** Inside the
   native arm, `read` sits in a multi-call request 84.5% of the time. `glob` sits there 90.1%,
   `grep` 75.2%, `bash` 37.3%. Sweet's `bash` sits at 36.1% `[M research/structured-vs-shell-parallelism.md
   §3, fp-opencode-tab-20260826]`. Opencode sweet emitted two or more Bash calls in one request
   119 times. The 08-28 claim "sweet does 4% more operations" inverts. A quote-blind segmenter
   split regex alternations. Sweet performs 7.6% fewer operations (23.79 against 25.74 per
   rollout) `[M forensics/opencode-calls-per-request.md §6]`. Only 7.4% of `ss-*` envelopes
   chain two operations `[M]`, not the 20.8% or 84% earlier documents record.
3. **Codex has exactly zero parallel headroom.** 2,406 tool calls in 2,406 tool-bearing
   requests, both arms `[M structured-vs-shell §2]`. The run's model string
   `openai/gpt-5.6-luna` never matched the codex catalogue slug. Codex therefore built requests
   without the parallel affordance and with the default truncation policy. The ~2,500-token cap
   is the unmatched-slug default, not a per-model policy `[M][C structured-vs-shell §5]`.
4. **The claude-code sign is carried by one bench artefact and one price counterfactual** (§0.2). The clean four-task no-delegation
   main-thread premium is +26.3%. One rollout carries 54% of it `[M forensics/claude-main-thread.md
   §2, 12 pairs]`. `ss-search` occupies the slot where native spawns an `Explore` subagent. Sweet
   opens with `ss-search`/`ss-grep` in 43 of 45 rollouts on the 15 native-delegating tasks. Native
   opens with `Agent` in 22 of its 28 delegating rollouts `[M forensics/claude-subagents.md §4]`.
5. **The read-before-edit gate binds on ten legacy model ids only.** The set is byte-identical in
   Claude Code 2.1.218 and 2.1.258. Opus 4.7/4.8/5, Sonnet 4.6/5 and Fable 5/5.1 are not gated
   `[C research/anthropic-model-product-path.md §1]`.
6. **The harness plan tool is a standalone billed request in all six cells.** 3.8–4.1 requests
   per rollout on codex and opencode, 1.9–2.1 on claude-code; 10.9–13.1% and 3.7% of a rollout;
   arm-symmetric `[M verify-tail.md §5]`.
7. **4 of 22 fresh-pool tasks never gave the agent a trustworthy test verdict** in at least one
   production cell. On accenture the cause is a shim regex false positive, not the network jail
   `[M][C verify/c15-mechanism.md]`.
8. **The loss taxonomy is classed** (§0.3). Localization is never the decider: the deciding code
   was on screen in 11 of 18 b2 cells and 18 of 18 moq cells `[M wrongfix-facts.md §2]`.
9. **External evidence.** The only published same-harness A/B of a structural code index wins on
   resolve (41.9% → 50.4%, p=0.003) and turns (36.2 → 28.3) with a null per-cell cost (p=0.73)
   `[W arXiv:2606.22417v1]`. It uses first-class tools with parallel dispatch on a multi-file pool.
   Our median agent patch is one file `[M cost-per-solve-leaderboards.md §6.3]`. Cost-per-solve
   ranks the weakest tool set first in 2 of 2 and 5 of 6 published groups `[W arXiv:2606.12344v1,
   2608.09802v1]`; "cost at parity" stays the right headline.

---

## 2. The per-harness gutter decision

**Keep `N<TAB>` on all three harnesses. The delimiter is not a lever.** This restates the owner
decision of 2026-08-28 and does not re-derive it.

Evidence: at 66 rollouts per cell all three forms land within 3 rollouts of each other on every
harness. Each harness ranks them differently. Every pairwise Fisher test gives p ≥ 0.72 against
the ±6 bar `[M FRESH-POOL-RESULTS.md §1, §5]`. The n=18 suggestion that favoured `N| ` on codex
and opencode reversed at n=66 `[M register C3]`. The gutter's token cost is $0.0003–0.0004 per
rollout; a −15% saving would need 5,232–5,310 numbered lines per rollout against 878 delivered
`[M register C4]`. Deleting the gutter is not better (121/198 against 120/198) `[M register C7]`.
Claude Code's `tengu_tab_read_sep` gate still defaults to false in 2.1.258, so C5's revival
condition is not met `[C harness-changelogs.md §3 N1]`.

Per-harness adaptations that DO have a real mechanism, with their disposition:

| harness | mechanism `[M]/[C]` | disposition after verification |
|---|---|---|
| codex | Tool output is cut to a fixed head (5,190 chars) plus tail (5,000 chars); 105 sweet cuts, 72 of them `&&` bundles a wrapper cannot see; `sufficient=` survived 33 of 33 cut packs; 0 of 480 edit calls anchored inside a cut `[M forensics/codex-cap-x-ss.md]` | Cap-aware renderer **DEAD**: best case −0.36% assumes nobody follows the pointer; the pointer is followed 23.6% (57/242), break-even 16.6%, so the design adds +0.15% to +0.24%. C9 → DEAD, C8 stands. c07 (layout) killed: the head already carries ~4,830 chars; the complete top-1 body exceeds 4,800 chars in 21 of 27 estimable cuts `[M verify/c07]`. |
| opencode | The harness's own `read`/`glob` descriptions and GPT system prompt tell the model to parallelize file reads and to avoid Bash for file operations `[C opencode 1.18.4 read.txt:12, glob.txt:6, gpt.txt:5-6, shell.txt:9]`; sweet pays +3.38 requests per rollout `[M]` | The only per-harness mechanism with a sizable ceiling. Vehicle is A4 (owner-excluded, unbenchmarked). Requests: parity with native at best. Cost: custom structured tools net −0.4% to −4.5% of the sweet cell, "landing sweet between +2.9% and −1.2% against native"; the plugin intercept "is exactly parity" `[M verify/c02-mechanism.md §5, quoted]`. Owner decision, §8 item 1. |
| claude-code | (a) A Bash result above 30,000 chars is deleted and replaced by a 2,000-char stub; 0 of 94 stubs were opened; 15 `ss-*` deletion events in 7 of 198 sweet rollouts `[M verify/c11-mechanism.md]`. (b) Read-before-edit gate: 68 gated files in 56 of 66 sweet rollouts, tax 7.8–9.4% on a legacy model only `[M claude-main-thread.md §4]`. (c) Built-in `Explore` omits CLAUDE.md; guide-less `Explore` fails 14.0% of `ss-*` calls against 4.8% main thread `[M claude-subagents.md §2]`. (d) Worktree-isolated subagents scope `ss-grep --in <worktree>`: 45 zeros and 13 usage errors from 71 scoped calls, no hits `[M verify/c03-mechanism.md §3]`. | (a) Hygiene: a byte bound costs +0.4% to +0.8%; 15 of 17 agents recovered with one narrower call `[M]`. (b) A hint recovers at most half the tax; 0.0% on every fresh-pool cell; c13 killed. (c) c08 killed: exposure 24 of 255 delegating sweet rollouts (9.4%). (d) c03 killed as a bench lever (fair bound 1.3–2.0%, 0 solves); survives as product correctness, §4.5. |
| all three | Tab carry on tab-indented files: 7 of 132 codex and opencode rollouts against 0 of 265 under other forms (p=0.0004); 8 of 61 claude-code edits failed; 0 solves changed `[M register C10]` | Known defect, dead as a lever. `N:` is the only zero-ambiguity dense form (+0.71 token per line), parked with C5. |

---

## 3. Inversion: how native beats sweet now, and what sweet can answer

Written as before: "I am hired to make native beat sweet with the same traces."

| # | exploit native already uses | size `[M]` | can sweet answer it inside the owner's scope? |
|---|---|---|---|
| 1 | Parallel emission of structured tools on opencode | +3.38 requests per rollout, +10.2% | Only through A4 (owner-excluded). Prompting is dead four times (A1); the harness prompt already commands parallel Bash `[C]`. |
| 2 | Free truncation on codex: the cap deletes 35.1% of native's tool tokens against 10.6% of sweet's | native reads wide for free | No. Raising the cap is shared (C8); fitting under it is dead (C9). |
| 3 | Under-recorded delegation on claude-code | 205 requests with no usage; 28 of 66 native rows null; imputation +41% | Measurement only: disclose the lower bound and the convention (§4.1). |
| 4 | The `pages` defect flatters sweet | 1.39 wasted native requests per rollout; removal moves main-only −1.38% → +1.06% | Shared fix that lowers native's cost. Disclose; never book. |
| 5 | Subagents that asked for haiku ran as luna | The runner pins all three model slots to one slug `[C claude-code-task-runner.mjs:279-281]`, so luna's rate is the true price of what ran and the ledger is correct. Repricing at 0.2× (dearest-3 −3.31% → +2.14%) is a real-user sensitivity, not an exploit and not a bill correction `[M verify/c14-mechanism.md §4]`. | Nothing to answer on the bench. Disclose the sensitivity only in the labelled real-user rows (§0.2). |
| 6 | Sweet's fixed terms: guide, gutter, failed `ss-*` | 7–10% of a rollout | B2 closed; B3 is a user decision (§8); C4 closed. |
| 7 | Post-edit single-probe chains on claude-code | 2.21 probes per solved rollout against 1.03; 0 of 87 preceded a new-file edit | No. The driving paragraph is a shipped solve-positive lever (P2); reverting it is c04, killed. |
| 8 | Index exclusions: committed bundles and dot-config files | bundle hunt +4.7/+8.7/+6.0 requests on one task; `.eslintrc` hunt 16 requests in one rollout | Yes, as correctness. The bundle note gap is §4.3 and survives the shipped E1/E2 fix. Dot-config admission is a separate index-admission item, filed as an E1 extension in §4.6; §4.3 admits no file to the index. |
| 9 | Grinding wins on arm-universal wrong-fix tasks (aiohttp native, 125 calls) | 1 task | No. 53% of losses are hidden-test-locked. |
| 10 | Native narrows its reads on harder tasks | Epoch A −6.5/−17.8% became +0.3/+3.3% | No. A population fact; see the multi-file cohort question (§8). |

Sweet can answer only the correctness closures (row 8, part of row 4). Rows 1–3 need a vehicle the
owner has excluded or a shared setting with zero differential.

---

## 4. Ranked survivors

**GATED tier: none. MOONSHOT tier: none.** Every item below is SHARED-CORRECTNESS: a shared
measurement repair with zero head-to-head differential, or a sweet-only product fix whose
benchmark value is zero. None may be published as a sweet win. Ceilings are not additive (§4.7).

### 4.1 Claude-code ledger disclosures, the `pages` note for subagents, and cross-harness cache-write consistency (G17) — SHARED-CORRECTNESS

- **Mechanism.** State the construction beside every claude-code figure. Add one sensitivity row
  (five price vectors). Disclose the `pages` asymmetry. Deliver the existing
  `READ_PAGES_TOOL_NOTE` to subagents of both arms through `--append-subagent-system-prompt`
  (Claude Code ≥ 2.1.205; the box runs 2.1.218) `[W code.claude.com/docs/en/cli-reference]`.
  Second mechanism, cross-harness: the ledger charges the 1.25× cache-write surcharge on
  claude-code only, because only `claude-code-accounting.mjs` supplies a `cacheWrite` field; the
  codex and opencode runners emit none `[C ideal-cost.mjs:95; claude-code-accounting.mjs;
  codex-task-runner.mjs and opencode-task-runner.mjs, zero occurrences]`. Either apply the
  surcharge in all three runners, or print the inconsistency beside every cross-harness cost
  table. This is register G17's open half `[M verify/c14-history.md §2, §6 item 1]`.
- **Harnesses.** claude-code for the disclosures and the note; all three for the cache-write
  treatment. **Vehicle.** `harness/ideal-cost.mjs`, `claude-code-accounting.mjs`,
  `claude-code-task-runner.mjs`, `codex-task-runner.mjs`, `opencode-task-runner.mjs`; shared,
  zero differential.
- **Evidence.** Native `Read` calls failed on `pages` 159 of 690 (23.0%), sweet 23 of 51; wholly
  wasted requests 92 against 23 per 66 rollouts `[M verify/c14-mechanism.md §3]`. Inside subagents:
  native 22 wasted requests ($0.0186, 1.3% of the arm), sweet 9 `[M claude-subagents.md §3]`.
  Native asked for haiku on 19 of 33 subagents; all three model slots are pinned to one slug, so
  all were served as luna and billed at luna's rate; the subagent ledger is correct `[C
  claude-code-task-runner.mjs:279-281; M claude-subagents.md]`. OpenRouter lists luna's cache
  write at $0.25 against $0.20 input, exactly 1.25× `[W https://openrouter.ai/api/v1/models,
  fetched 2026-08-28, via verify/c14-history.md §2]`.
- **Ceiling.** Not a saving. Removing the wasted `pages` requests from both arms moves main-only
  −1.38% → +1.06% and inclusive dearest-3 −3.31% → −1.55% `[M]`. Finishing G17 on codex and
  opencode moves opencode +3.31% → +2.52% and codex +0.35% → +0.06% `[M register G17]`; that is
  a fairness fix in sweet's favour worth about a quarter of the 3.2 points opencode must find
  `[I: 0.79 / 3.2 = 0.25]`, and it is not a lever. The subagent repricing at 0.2× (dearest-3
  −3.31% → +2.14%) is a real-user sensitivity kept only in §0.2's labelled real-user rows; it is
  not a ledger defect and is not disclosed as one.
- **`$0` falsifier.** Done (`c14_replay.py`, 132 rows matched to $0.000002). For G17, a re-run
  of the ledger with the surcharge applied to the codex and opencode `turns/` usage; the register
  already holds the result. **Kill:** none.
- **Build.** One table row and two paragraphs; one runner flag; one accounting branch in two
  runners.
- **Refuter corrections adopted.** The claude-code ledger already charges cache writes at 1.25×
  `[C ideal-cost.mjs:95]`; G17's open half is codex and opencode. The +2.2% main-only baseline
  was a reconstruction; measured constructions span −1.4% to +1.6% `[M]`. Intervals belong beside
  every repricing figure (§0.2). The one-hour cache TTL applies to a subscription user within plan
  usage, who is metered against limits rather than invoiced per token `[W code.claude.com/docs/en/prompt-caching]`;
  say "plan-usage consumption", not "bill". Whether one-hour writes deplete a plan allowance faster
  is unresolved (§7 item 18).
- **Product-documentation rider, arm-universal, zero bench claim (research C-A5).** Sweet's
  claude-code documentation should recommend `promptCacheTtl: "5m"` (Claude Code ≥ 2.1.242; the
  bench ran 2.1.218, so the setting did not exist there). For a continuously working session on a
  subscription within plan usage, the one-hour write price is 16.0% of that path's main-thread
  consumption `[I research/anthropic-model-product-path.md C-A5, §4.5]`. It is not a slate lever,
  has zero head-to-head differential, and is listed so it is not mistaken for one.
- **needs_user_decision:** yes for the runner flag (it changes both arms' baseline) and for the
  cache-write treatment (it changes two harnesses' published cells); no for the disclosures.

### 4.2 Shim false `INFRA` label (shared correctness) and a trustworthy-baseline admission check (owner decision)

- **Mechanism.** `INFRA_ERROR_RE` in `harness/rt-condense-lib.mjs:46-47` contains the bare
  alternative `Could not resolve`. The accenture repository prints an application log line
  "Could not resolve ID of asset …" `[C][M]`. The shim then forces `status=INFRA`, zeroes the
  baseline diff, and prints a "NETWORK UNAVAILABLE" banner that tells the agent not to investigate.
  Fix (a), shared correctness: anchor the regex to package-manager forms. Fix (b), admission:
  refuse or label tasks whose clean-baseline classification is not `trustworthy=yes`. Fix (b) has
  two forms. The cheap form adds `rtTrustworthy` and `rtInfra` counters to `rows.json`, so an
  all-untrusted rollout stops being indistinguishable from an all-PASS one (`rows.json` today
  carries `rtLaunched`, `rtVerdicts`, `rtNoVerdict`, `rtEndedUnverified` and no verdict status)
  `[M verify/c15-measurability.md §8 item 9, field dump]`. The preflight form runs the shim's
  baseline classification in the jailed image at selection time. The preflight form conflicts
  with the documented contract of `select/task-gates.json`, which is METADATA-ONLY and
  OUTCOME-BLIND `[C select/task-gates.json:8]`, and is not affordable before the seeded draw over
  a pool of about 19,000 tasks `[C PLAN.md §6 row P6; M verify/c15-measurability.md §7]`.
- **Forward-only.** HO2 is frozen at denominator 199 (register G4). An admission filter applied
  retroactively to a frozen set would break that freeze. Any adoption applies only to pools
  recruited after it ships `[M verify/c15-measurability.md §7]`.
- **Harnesses.** all. **Vehicle.** shared shim and admission; zero differential.
- **Evidence.** accenture: 0 of 104 `run_tests` calls in 44 rollouts trustworthy; 100 `INFRA
  scope=full` (mocha exit 233/234, so the suite ran) and 4 targeted `FAIL` `[M verify/c15-mechanism.md
  §2]`. 21 of 44 accenture rollouts resolved blind. The per-cell census (every recorded verdict
  `trustworthy=no`, at least one verdict present) flags 4 of 22 fresh-pool tasks in at least one
  production cell: accenture, moq, spectator, mathnet. Only accenture is the shim mislabel
  (c15-mechanism; c15-measurability's table still attributes it to the jail); the other three have
  no usable baseline diff `[M verify/c15-measurability.md §3, untrusted-cell-census.sh, 18 runs;
  C rt-shim-runtime.mjs classifySuiteResult]`.
- **Ceiling.** Validity only. Removing accenture moves native 125/198 → 120/189 (canonical
  figures, brief §1) and sweet 115/195 → 111/187 (raw fresh-pool rows; the canonical sweet figure
  is 120/198 once the opencode repair pass is substituted, which this arithmetic does not do);
  the ±6 verdict does not change `[M]`. Applying the filter moves the cost comparison against
  sweet on a valid ledger (codex +0.35% → +2.08% or +0.89%; opencode +3.31% → +5.09% or +8.51%)
  and moves no solve verdict past ±6 `[M verify/c15-measurability.md §8 item 10]`.
- **`$0` falsifier.** The per-cell `trustworthy=no` census above, not a substring grep for
  `INFRA` (the substring form flags transient errors such as one dart rollout in
  `rb-claudecode-20260824`). Done for the fresh pool: 4 of 22. **Kill:** drop the admission item
  if fewer than 2 admitted tasks in a pool are all-untrusted across every rep of every arm
  `[M verify/c15-measurability.md §8 item 7]`; the current pool scores 4, so the item survives that
  bar on the corrected class, not on the `INFRA` class.
- **Build.** Regex fix: hours. Counters: hours. Preflight form: days and an owner decision.
  **Refuter corrections.** The jail (G18) is not on the causal path. The `INFRA`-only flag was
  killed by its own condition. File as a correction and extension of G13 (the fact: G13's repair
  claim that `trustworthy=no` was eliminated does not hold on the fresh pool) using the vehicle of
  G11 (the shipped blocklist plus `run-pilot.mjs` admission path), not G20 `[M verify/c15-measurability.md
  §8 item 6]`.
- **needs_user_decision:** no for the regex fix and the counters; **yes** for the admission check
  (§8 item 10).

### 4.3 Bundle "not indexed" note gap, `ss-semantic` fallback, `ss-read` on excluded files — SHARED-CORRECTNESS (sweet-only vehicle, zero benchmark claim)

- **Mechanism.** The shipped `excludedScopeNote` asks `admitsShape(rel)`, a path predicate. The
  indexer drops `dist/index.js` by content (bundler-banner rule) after 36b802e re-admits it by
  path. So `ss-grep --in dist/index.js` still prints a bare `(no matches)` after a golden rebuild
  `[C _ss-helpers.mjs:259-263; core/indexing/indexer-utils.js:440-486; M verify/c10-mechanism.md
  §4]`. `ss-semantic` on an excluded file returns a `[FALLBACK]` whole-file span (7 of 58 calls,
  five on `dist/index.js` 1–35000). `ss-read` returns any file from disk (13,396 tokens in one
  call) `[M phase-anatomy.md §6.5]`. Fix: the note consults the index's file table or a skip
  manifest. Extend it to the semantic fallback and the read path.
- **Harnesses.** all three. **Vehicle.** `eval/agent-read-workflows/bin/_ss-helpers.mjs`;
  sweet-only.
- **Evidence.** aws-actions sweet tails 71 requests against native 38, +$0.0153 over 9 sweet
  rollouts; native edited the bundle in 9 of 9, sweet in 3 of 9; all 18 rollouts solved `[M
  verify-tail.md §6]`. Rollout ids: `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0`
  (requests 12–19), `rp-oc-tab-20260827/.../sweet/r0` (requests 10–18),
  `fp-claudecode-tab-20260826/.../sweet/r1` (requests 7–21).
- **Ceiling.** The whole bundle hunt is +$0.000059 codex, +$0.000063 opencode, +$0.000110
  claude-code per pooled rollout (0.5–0.7%) `[M]`. Book zero: an honest note invites a probe.
- **`$0` falsifier.** Replay the 7 fallback calls, the 9 `ss-read dist/index.js` calls and the
  `--in dist/index.js` zeros against a rebuilt golden. **Kill:** any bare `(no matches)` or file
  body remains. Needs scratch write on a rebuilt golden.
- **Build.** Small. **Refuter corrections.** This is E1/E2's class, not c10's; the candidate's
  "≈12 requests per 66 rollouts" was 2.4× too many. **needs_user_decision:** no.

### 4.4 `ss-grep` false-zero paths and the `ss-find` line-span crash — SHARED-CORRECTNESS (sweet-only, zero claim)

- **Mechanism.** `pathSegments('.')` is empty, so `--in .` and `--in ./` reject every file
  `[C grep-output-shaping.js:17-19, 67-68]`. An absent scope path makes `excludedScopeNote` return
  null and the wrapper prints `(no matches)` `[C _ss-helpers.mjs:251, 380-381]`. The native
  literal extractor drops an alternation branch with no 3-character literal
  (`extractRegexLiteralClauses("_color|_.*,")` → `[["_color"]]`) `[M][C]`. `ss-find` crashes on
  an index without late-interaction line spans (2 calls, mathnet) `[M claude-main-thread.md §6.3]`.
  Fourth defect, guide against wrapper: the guide teaches `ss-trace <symbol> [callers|callees|impact]`
  `[C sweet-search-system-prompt.md:32]`, but `TRACE_USAGE` has no mode word and `cmdTrace` reads
  only the first positional, so `ss-trace foo callers` silently drops `callers`
  `[C _ss-helpers.mjs:939 TRACE_USAGE; 940-956 cmdTrace, positional read at 954]`. 27 pooled
  operations used the form `[M verify/c09-history.md §7; verify/c09-mechanism.md §5]`. Either
  implement the mode word or delete it from the guide. No request cost was measured for it; the
  27 calls ran as un-moded traces.
- **Harnesses.** all three. **Vehicle.** `core/search/grep-output-shaping.js`, `_ss-helpers.mjs`,
  the native extractor, and one guide line (the guidance block is owner-protected: deleting the
  line needs the owner, implementing the mode word does not); sweet-only.
- **Evidence.** 198 claude-code sweet rollouts (66 production plus 132 A/B forms): `--in .` 5 calls,
  4 with real hits; absent scope 10 of 11 calls; alternation 1 call (59 lines dropped, none holding
  the literal the agent sought) `[M verify/c10-mechanism.md §2]`. In 0 of 83 located false zeros
  did the agent state an absence and stop `[M c10_stop.py]`.
- **Ceiling.** 15 following requests per 198 rollouts, $0.000039 per rollout, 0.19% of the
  claude-code cell `[M]`. Book zero. Solves at stake: none.
- **`$0` falsifier.** Unit tests on `pathSegments`; replay with
  `scripts-claude-main-thread/ss-grep-nomatch-audit.mjs`. **Kill:** genuine false absences above
  one per 200 rollouts after the fixes.
- **Build.** 1–2 days. **Refuter corrections.** The guide half is dropped: the absence sentence is
  the winning p7 seed that closed a 4.73× no-match cost gap, and weakening it produced the recorded
  spiral `[M memory project_p7_gen2_postmortem.md]`. **needs_user_decision:** no.

### 4.5 Worktree sessions: `ss-*` has no index and reads the wrong tree — SHARED-CORRECTNESS (sweet-only, zero claim)

- **Mechanism.** `PROJECT_ROOT = SWEET_SEARCH_PROJECT_ROOT || cwd`; a linked git worktree has no
  `.sweet-search/`, so every `ss-*` call exits 2 `[C _ss-helpers.mjs:136-147, PROJECT_ROOT at
  138, exit(2) at 145; M reproduced with git worktree add]`. The desktop app gives every session its own worktree; `claude --worktree`
  and worktree-isolated subagents do the same `[W code.claude.com/docs/en/worktrees]`. The bench
  never saw it because the runner pins the root `[C agent-runner-shared.mjs:142]`. Under the pin,
  `ss-*` read the parent's uncommitted edits while `Read` saw the clean worktree; 6 of 22 subagent
  `ss-*` results echoed the parent's own edit `[M claude-subagents.md §6.1]`.
- **Required design (from the refuter).** Split the roots: index lookups go to the common
  directory's checkout; `ss-read`/`ss-semantic` file reads stay on the worktree cwd. Deny
  `.claude/worktrees/**` at index admission, because `.claude/` is allowlisted and worktree copies
  have been seen inside an index `[C config/search.js:379-395; M 04-resolution-claude-code.md:174]`.
  Do not strip the prefix silently.
- **Harnesses.** claude-code in the bench; any harness that runs inside a worktree.
- **Evidence.** 45 worktree-scoped zeros in 5 of 66 sweet rollouts; 43 of 45 patterns hit in the
  golden root once the prefix is stripped, 34 in a file the same subagent later read natively
  `[M verify/c03-mechanism.md §4]`. Rollout ids: `fp-claudecode-tab-20260826` sweet
  `asynkron__protoactor-dotnet-1909/rep1`, `bfgroup__b2-113/rep1`, `bfgroup__b2-113/rep2`,
  `bfgroup__b2-259/rep0`, `final-form__final-form-64/rep2` (subagent transcripts under
  `agent-state/<task>-sweet/claude-home/projects/*/*/subagents/`).
- **Ceiling.** Bench: at most 3.5% loose, 1.3–2.0% fair, claude-code only, 0 solves `[M
  verify/c03-mechanism.md §5]`. All five target rollouts carry `costRealizedUsd = null` and
  `sidechainAccountingComplete = false`; they contribute $0.00 of the $0.86226 the claude-code
  sweet cell priced, so the whole ceiling sits in imputed spend `[M verify/c03-measurability.md
  §2, §8 item 3]`. The 87 subagent `Read` calls belong to the guide-less-Explore mechanism and are
  not booked here. Real user: in a worktree session every `ss-*` call fails, but only for a user
  who has put `eval/agent-read-workflows/bin` on PATH themselves; the wrappers ship in the npm
  `files` list with no `bin` entry (§5.1 c12) `[C package.json]`. That population is unmeasured
  `[M verify/c03-measurability.md §8 item 10]`. Sweet delegated in 9 of 66 rollouts (13.6%) and
  native in 27 of 66 (40.9%), so a real user's exposure is bounded by the delegation rate, not by
  any larger figure `[M same, item 9]`.
- **`$0` falsifier.** Done for both halves (34 of 45 above the "half" bar). **Build.** Hours.
  **needs_user_decision:** no.

### 4.6 Register corrections that are not levers — SHARED-CORRECTNESS

File these in `register/DEAD-LEVER-REGISTER.md`.

| row | correction | source |
|---|---|---|
| D4a/D4b | The `pages` defect is alive: 154 of 176 failed native `Read` results are the `""` form the hook cannot reach; the note never reaches subagents | `[M phase-anatomy.md §6.3; claude-subagents.md §3]` |
| D6 / H1 | Measured: ten legacy ids only; current Anthropic models ungated; tax 7.8–9.4% on a legacy model; a hint recovers at most 4.2–4.7% | `[C][M claude-main-thread.md §4; verify/c13-mechanism.md]` |
| C9 | PARKED → DEAD (best case −0.36%; the follow-rate makes it +0.15% to +0.24%) | `[M codex-cap-x-ss.md §7]` |
| E13 | OPEN → DEAD for resolution (7 of 153 losses have the regression shape, on 2 wrong-location tasks; TDAD 31% → 29%) | `[M competitor-mechanisms.md §3.1; W arXiv:2603.17973v2]` |
| G16 / A1 | "4% more operations" and "84% chained" are segmenter artefacts; luna fresh pool: 7.6% fewer operations, 7.4% chained | `[M opencode-calls-per-request.md §6]` |
| G17 | Computed: the five-minute Anthropic vector moves the claude-code cell +0.04 to +0.68 points; one-hour +1.25 to +2.66 | `[M verify/c14-mechanism.md §2.2]` |
| G6 | Add the `Explore` count conflict (§7 item 9); 39.5% of native subagent requests carry no usage | `[M claude-subagents.md §3]` |
| A3 | Closure is backbone-scoped: fusion economics were fitted on retired Grok data | `[C agent-efficiency-2026.md §4.2]` |
| E1/E2 | Add the bundle note gap and the `ss-semantic`/`ss-read` uncovered paths (§4.3) | `[C][M verify/c10-mechanism.md §4]` |
| new B-row | Progressive disclosure of the guide as a skill: DEAD, 1.7–2.0× dearer than always-resident | `[I on M agent-efficiency-2026.md §6.2]` |
| G13 (correction and extension), vehicle G11 | Second shim-classification defect (§4.2); 4 of 22 tasks never trustworthy for the agent in at least one production cell; G13's repair claim that `trustworthy=no` was eliminated does not hold on the fresh pool; any admission filter built on it is forward-only and is never applied to HO2 | `[M verify/c15-mechanism.md; verify/c15-measurability.md §3, §7, §8 item 6]` |
| new G-row | Commit-history corpora dead by construction: goldens are one-commit repositories | `[M competitor-mechanisms.md §2.6]` |
| B18 | Revival condition met and re-killed: exposure 24 of 255 delegating sweet rollouts (9.4%); noise 6× the effect | `[M verify/c08]` |
| E3 | OPEN → CLOSED with a number: 7 of 1,251 sweet lexical `ss-*` calls (0.56%) were genuine stale-index zeros on the agent's own new code; 13 follow-up requests over 198 rollouts (0.07 per rollout, about 0.3%); the 5% revival bar is not met | `[M candidates/index-time-and-capabilities.md F5, census.py E, census2.py 3]` |
| E1 extension (new instance class) | Extensionless dot-config files are not admitted by `FILE_PATTERNS.include` `[C core/infrastructure/config/search.js:51-160]`. 94 dotfiles are absent across the 22 goldens (`.gitignore` 36, `.editorconfig` 9, `.gitattributes` 9, `.prettierrc` 7, `.eslintrc` 6, `.npmrc` 3, `.eslintignore` 3, `.babelrc` 2, `.flowconfig` 2 …). Native read one in 4 of 198 rollouts (`callstack`, 2 codex + 2 claude-code); sweet never did. Ceiling one task of 22: at most −$0.00019 per pooled claude-code rollout (−1.3%), zero on codex and opencode. Trace: `fp-claudecode-tab-20260826/callstack__react-native-paper-972/sweet/rep2` requests 18, 20, 21, 34. Same row, second fact: 83 `.md` and 30 `.json` fixtures under 30 bytes are absent from the path table (markup-it, accenture; both tasks dead in both arms); the rule that drops them was not located in code. Value is correctness of `ss-grep` on config files; no bench claim | `[M phase-anatomy.md §6.6, §7 S2, dotfile-census.py; index-time-and-capabilities.md F3, census2.py 4, census3.py B; I phase-anatomy.md §7 S2 ceiling]` |
| E2 (new hygiene items, 0% benchmark value) | §4.4: `pathSegments('.')` false zeros on `--in .`, the absent-scope `(no matches)`, the alternation-branch drop in the literal extractor, the `ss-find` line-span crash, and the `ss-trace` mode word the guide teaches and the wrapper ignores (27 pooled operations) | `[M verify/c10-mechanism.md §2; claude-main-thread.md §6.3; verify/c09-history.md §7; C _ss-helpers.mjs:939-956]` |
| E2 (new hygiene item, 0% benchmark value) | §4.5: `ss-*` in a linked git worktree exits 2 (no `.sweet-search/`) and, under the bench pin, reads the parent tree; fair bound 1.3–2.0% of the claude-code sweet cell, all of it in unpriced rollouts; ship refusal with a hint naming the main checkout, not silent redirection | `[C _ss-helpers.mjs:136-147; M verify/c03-mechanism.md §4-5; verify/c03-measurability.md §8 items 8, 11]` |
| E15 (new question) | Whether `.claude/worktrees/**` is index-admissible: `.claude/` is allowlisted and worktree copies have been seen inside an index; deny at admission | `[C config/search.js:379-395; M 04-resolution-claude-code.md:174; verify/c03-measurability.md §8 item 11]` |
| §0.2 | Correct the shipped-surface sentence: `package.json` v2.7.2 `bin` holds only `sweet-search` and `sweet-search-mcp`; `files` ships `ss-search/find/grep/semantic/trace/read` plus the three helpers; `ss-batch` is in neither `bin` nor `files`, so a real install never receives it. A2's "deployed, called 0×" describes the bench PATH, not the package | `[M node -e over package.json, 2026-09-02; DEDUP.md §7 item 1; verify/c12-measurability.md §3 item 2]` |
| G17 | Scope correction: the 1.25× cache-write surcharge is already charged on claude-code (`ideal-cost.mjs:95`; `cacheWrite` supplied by `claude-code-accounting.mjs`); the open half is codex and opencode, whose runners emit no cache-write field. Finishing it moves opencode +3.31% → +2.52% and codex +0.35% → +0.06%. The Anthropic-vector computation in the row above is a separate fact about the claude-code cell | `[C ideal-cost.mjs:95; codex- and opencode-task-runner.mjs; M verify/c14-history.md §2, §7 item 1]` |
| §12.4 item 25 | Four → two. The working-tree freshness census (E3) and the `run_tests` scope census (E13) were run at `$0` by `candidates/index-time-and-capabilities.md` (F5; F1 with `census.py A`, `census2.py 2`, `census4.py 3` over 396 rollouts) and consumed by DEDUP R21. The hygiene replay and the index-rebuild replay remain specified and unrun; both need a rebuilt golden | `[M candidates/index-time-and-capabilities.md F1, F5; DEDUP.md §5 R21]` |

### 4.7 Overlaps

Items 4.3, 4.4 and 4.5 draw on the same populations. The two `bfgroup__b2` tasks carry 41% /
94% / 63% of sweet's raw-shell fallback tokens by harness, and their root cause is the shipped
E1 index gap `[M native-capability-gaps.md §3.1]`. The 87 subagent `Read` calls were claimed by
both c03 and c08 and are counted nowhere here. Item 4.1 changes the baseline every other
claude-code number is read against. Nothing in this section may be summed.

---

## 5. Killed this round

Every kill names the fact that decides it. Nobody should regenerate these under another name.

### 5.1 The fifteen verified candidates

| id | candidate | killing fact |
|---|---|---|
| c01 | Remove the harness plan tool in the sweet arm via `ss init` config | Register B17's class (DEAD: shared harness config, zero differential once measured correctly). Native calls the plan tool more than sweet in all six cells (4.14 vs 3.92, 3.92 vs 3.79, 2.05 vs 1.91) `[M]`; applied fairly it moves codex +1.8% and opencode +5.4% the wrong way. Codex 0.152.0 (PR #41744) turns the tool off in both arms; at the 0.146.1 pin the prompt still names `update_plan` 9 times and an unregistered call is a billed error `[C]`. Doctrine (A10, D4a, F13, G7) forbids booking an arm asymmetry; solve risk unpriced. |
| c02 | Structured `ss-*` surface for opencode (plugin / custom tools / MCP) | IS register A4; its revival needs an owner decision AND the W0.c census, and only the first is argued. Plugin intercept is exactly parity. Custom tools: −4.5% dependency-strict minus about 3.1% schema cost = −0.4% to −4.5% of the sweet cell `[M verify/c02-mechanism.md §3-5]`. The headline −10.1% to −12.7% was 2.2–2.8× the honest bound; the moq pair is half dependent paging. Codex 0; claude-code unsupported. Owner decision (§8). |
| c03 | Worktree-aware `ss-*` as a cost lever | E2 (SHIPPED) already prices the scope-honesty class at 0.99% as correctness. The "127 ops, 8.7%" figure is the whole subagent fallback mass; 46 ops follow a worktree zero; fair bound 1.3–2.0%, 0 solves `[M verify/c03-mechanism.md §5]`. Survives as product correctness only (§4.5). |
| c04 | Delete the mapping-call paragraph, the subagent sentence, the `ss-semantic` lines; drop `ss-batch` | The mapping-call paragraph is the shipped P2 fix-surface lever (d309860): round 3 flipped a task with a 13-file patch, 6/10 vs 5/10 `[M analysis/fix-surface-p2-smoke-2026-07-07.md]`; both recorded rewordings went the wrong way (+12.7%, +220%, +183%). B2: deleting rules is a per-rule ablation never run. `tests/tooldoc-trim-gate.mjs` names all three passages `[M]`. The subagent sentence saves ~21 tokens. |
| c05 | Edit-triggered call-site binding certificate | B9b: "do not build the call-site-surfacing lever on n=1 task". The flagged face fires on 15 of 390 cells, one task; the raw signal fires on 45 of 390 across 4 tasks, and one ambiguity gate decides which `[M]`. 4 of 6 addressable losing cells are native. +2 of 198 sweet rollouts at a 100% flip; sweet still trails 40-41 and 41-43. The firing task never gave a trustworthy verdict (§4.2). Falsifier (a) is non-binding (1, 2, 1, 1 flagged functions against a bar of 5). |
| c06 | Runtime execution-path certificate | F5's gate excluded a runner fleet; L7 (08-28) ruled the runtime service is E10 "wearing different clothes", and E10 died live at +79%. 0 of 22 goldens carry installed dependencies; `dotnet` is absent from the jailed PATH `[M][C]`. Its falsifier passes for the wrong reason (images execute at build time). |
| c07 | Codex-only three-section output layout | Fourth kill of the family (R6, L4, census §8, codex-cap-x-ss §8). The complete top-1 body exceeds 4,800 chars in 21 of 27 estimable cuts (bar: more than 6 of 33) `[M c07-rank1b.py]`. The head already gets ~4,830 chars; fitting a complete body means the rank-1 cap falls ~40%, which is C9. 96% of rank headers already survive. |
| c08 | Guide inside claude-code's delegation path (`Explore.md`) | B18's exposure clause holds: 24 of 255 delegating sweet rollouts (9.4%). "38/44" is the Explore share across BOTH arms. A richer subagent context is +26% to +41% on a 5.35k–8.53k first request, the B11/B12/E10 inversion shape. 52% of failed-`ss-*` spend sat in subagents that already had the guide `[M]`. |
| c09 | Self-describing `ss-*` (`--help`, aliases), re-price the guide | PANEL-SYNTHESIS SS-N-3 already dispositioned it: ship as correctness, claim no benchmark value. `failUsage` already prints the full usage string `[C _ss-helpers.mjs:188-190]`; all 11 `--help` events received it `[M]`. Only `--help` exit 0 and `-E` inert are unbuilt. Its B3 claim fails (§8 item 2). |
| c10 | Absence honesty (code paths plus a conditioned guide sentence) | The sentence is p7 seed A, which closed the 4.73× no-match gap; compressing it produced the recorded spiral. 0 of 83 false zeros ended in a stated absence `[M]`. The code half survives as E2 hygiene (§4.3, §4.4). |
| c11 | Claude-code overflow guard (30,000-char delete threshold) | C9 on a second harness; bounding is a token purchase (+0.4% to +0.8%). 89% of events sit on the two b2 tasks whose index gap shipped after the runs; 15 of 17 agents recovered with one narrower call `[M verify/c11-mechanism.md]`. Header, verdict and top address already survive in 11 of 11 search stubs. Re-count on a post-fix run before building. |
| c12 | `bin` entries for the six wrappers plus an init-written allowlist | The wrappers are bench instrumentation (`_ss-env.sh` pins bench limits; `ss-trace` writes an ungated `<<SS_TRACE_META>>` trailer) `[C]`. `$DIR` uses `BASH_SOURCE` without `readlink`, so an npm symlink breaks all six `[M]`. The 10.1% ceiling has no measurement. The contact surface stays an owner decision (§8). |
| c13 | Read-before-edit hint gated by the session transcript | Both binaries already print the read-first sentence in the Edit description `[C]`; the bench measured its compliance at 68 un-read first edits in 56 of 66 rollouts. The hint removes one of two extra requests: 4.2–4.7%, not 7.8–9.4%; 0.0% on every fresh-pool cell `[M verify/c13-mechanism.md]`. |
| c14 | Claude-code headline sensitivity package | Item 1 retired: the write surcharge is already charged on claude-code (its open half is codex and opencode, §4.1); the +2.2% baseline was a reconstruction; the five-minute move (+0.68 pp) is inside its own ±1 kill band; the one-hour TTL concerns a subscription user's plan-usage consumption, not the bench's per-token path (kept as the C-A5 documentation rider in §4.1). Item 2 survives as a disclosure (§4.1). Item 3 is not a correction: all three model slots were pinned to one slug, so the subagent ledger is right; the repricing survives only as a labelled real-user sensitivity (§0.2). |
| c15 | Admission flag for `INFRA` tasks | `excludeFromAgentRuns` already exists (`run-pilot.mjs:215-226`; G13). The stated cause (jail blocks installs) is wrong: the suite ran offline; a shim regex mislabels an application log line. `INFRA` is confined to one task, so the flag's own kill fires. The `trustworthy` item survives (§4.2). |

### 5.2 Dropped at dedup by their own falsifiers

| raw | candidate | killing fact |
|---|---|---|
| R10 | definition-coherence face | 0 of 12 on the positive control; 1 of 390 irrelevant firing `[M coherence_face.py]` |
| R18 | `ss-read` unread-above line | net ≈0: upper bound 0.9–1.8% against ~0.4% payload; PARKED hygiene |
| R19 | `ss-read --outline` | 42% (71/168) of jump targets unnamed by the shipped trailer, bar 50%; p90 payload cancels the saving `[M]` |
| R20 | index-backed filename discovery | path-table recall under 95% on 20 of 22 goldens (median 87.9%); risks handing back an abstention worth up to 7.1/4.8/2.9% `[M]` |
| R21 | test-to-symbol map for `run_tests <pattern>` | shared vehicle, zero differential; ≤1.3% token prize; TDAD −2 pp `[C][M][W]` |
| R22 | Jam symbol extraction | 0 of 618 indexed `.jam` files carry an entity; both b2 tasks 0/3 everywhere; PARKED product work |

### 5.3 Research seeds that map onto register rows (do not re-file)

| seed | register row | note |
|---|---|---|
| `harness-changelogs` L-2, `claude --tools` trim ("2–3%") | B17 DEAD | the live request has a 24-tool roster; removable set 758 tokens = $0.0034 `[M]` |
| `harness-changelogs` L-4, guide as a skill | new B-row DEAD (§4.6) | 1.7–2.0× dearer than always-resident |
| `harness-changelogs` L-5, codex per-MCP-tool output limit | inside A4 | owner-excluded |
| `agent-efficiency` S2, precision-gated search→read prefetch | A3 CLOSED | break-even precision 32/38/25%; luna's precision unmeasured; reopening needs the owner |
| `agent-efficiency` S3, content-hash edit anchors | D1b OPEN, `new_tool: true` | ≈+10 pp claude-code only, a loss elsewhere; gutter cost estimated, not measured |
| `agent-efficiency` S4, repository-size stratification of the pool | no register row (G3 covers vacuity and naming screens, not size) | admission axis, arm-symmetric, statistical power not a lever; its `$0` count is unrun (§6 step 7); decision §8 item 8 |
| `competitor-mechanisms` seed 1, delegate to opencode's built-in `explore` | E10 shape | its median-run falsifier is unrun; E10 (+79% live) is the prior |
| `cost-per-solve` S-1 / S-2 / S-3 / S-4 / S-5 | A4 / E7 / E3 / scoring change / cohort question (§8) | none is a new lever |

---

## 6. `$0` work plan, in order, with stop rules

1. **Write the disclosures and register corrections** (§4.1 text, §4.6 rows). Stop rule: none.
2. **Fix the shim regex and add the `rtTrustworthy` / `rtInfra` row counters** (§4.2). Re-run
   `/tmp/wf-slatec/c15-mechanism/tally.mjs` over the 12 fresh-pool runs. Stop if accenture still
   classifies `INFRA`; the cause is then elsewhere. The admission check itself waits for the
   owner (§8 item 10) and is forward-only.
3. **Ship the product-correctness fixes** (§4.3, §4.4, §4.5) with unit tests. Claim no benchmark
   value. Stop rule per item: the named replay must return zero false zeros or file bodies.
4. **Rebuild and stamp the fresh-pool goldens on the box** (E1: every `fp-*` row still carries a
   2026-07-16 index; G9: goldens are unstamped). This box write needs the user's go (§8). Stop
   rule: if a rebuilt index still lacks `.jam` or `src/build/**` entities, no later step may run.
5. **Run the two golden-dependent `$0` replays** (register §12.4 item 25, corrected in §4.6):
   the hygiene replay and the index-rebuild replay. Each needs step 4. The other two falsifiers
   the register lists are done: the E3 working-tree freshness census closed at 7 of 1,251 sweet
   lexical calls (0.56%; 13 follow-up requests per 198 rollouts; under the 5% bar), and the
   `run_tests` scope census closed E13 `[M candidates/index-time-and-capabilities.md F5, F1]`.
6. **Post-fix recount of the claude-code deletion population** (c11 hygiene): drop it if fewer
   than 3 `ss-*` deletions per 198 sweet rollouts remain.
7. **Count candidate SWE-rebench repositories above 1,000 tracked files** (research seed S4;
   task metadata only; `$0`; unrun). Kill the repository-size axis of §8 item 8 if fewer than 30
   exist, because a stratified 22-task pool would then repeat repositories
   `[M research/agent-efficiency-2026.md §8 S4]`.
8. **Only if the owner reopens A4:** run falsifier F1 of `research/structured-vs-shell-parallelism.md`
   §8 (opencode phase split; scripts under `/tmp/wf-slatec/structparallel/`). Kill the branch if
   sweet's pre-edit `ss-*` companion rate is already ≥70% of native's pre-edit `read` rate.

**The single pre-registered paid run this slate would justify — not authorised here.** A clean
post-fix rebaseline. No lever is under test; every future lever needs a baseline that carries the
shipped fixes.

- Tasks: the 22 fresh-pool tasks plus the 5 controls (register G3c), 3 reps, 2 arms, 3 harnesses
  = 486 rollouts. Price: about $6 at the registered luna price, about $12 at today's listed price
  `[I from G5: $10.87 for 891 rollouts]`.
- Preconditions: steps 2–4 done; the `pages` note delivered to both arms' subagents or its absence
  disclosed; pins unchanged (codex 0.146.1, opencode 1.18.4, claude-code 2.1.218). A pin change is
  a shared change; never pool across it `[W harness-changelogs.md §6 T4, T7]`.
- Primary outcome: solved rollouts per cell against native, bar ±6 of 66. Secondary: cost per
  rollout on the realised, ideal and break-priced columns, under both conventions, with native's
  claude-code lower bound and null-row counts disclosed.
- Pre-registered expectation: no cell clears ±6 on solves; opencode stays +2% to +4% dearer;
  claude-code reads −2% to +3% by convention. Anything outside these bands is a finding about the
  fixes, not a lever.
- Stop rules: run the per-cell trustworthy-verdict census on the recruited pool BEFORE any
  admission filter from §4.2 is applied, and abort if it flags more than 4 of 27 tasks (applied
  after the filter, the rule could never fire); abort if any
  golden index predates 2026-08-28; abort the codex leg if `codex exec` authentication is dead
  (register §12.2).

---

## 7. Open questions and what could not be finished

From the forensics `could_not_finish` lists, the research reports, and the verifications.

1. **No solve-effect estimate exists** for any guide-clause seed. Only a paid smoke can give one,
   and the seeds are dead.
2. **Harness system prompts are not persisted** for opencode and claude-code; plan-tool
   encouragement is inferred, not read.
3. **The two golden-dependent `$0` replays** (hygiene replay, index-rebuild replay; register
   §12.4 item 25 as corrected in §4.6) need a rebuilt golden and were not run. `ss-grep` was never
   replayed live on the box; it would spawn daemons. The E3 and E13 censuses are done (§4.6).
4. **Whether the post-2026-08-28 index admits `dist/index.js`** was not verified; §4.3 rests on a
   code reading.
5. **`fixval-claude-code-20260828` has no `agent-state` on the box.** The brief's "+30.6% claude,
   inflated by delegation" is not supported by `rows.json`: `sidechainTurns` is 0 on all 36 rows
   `[M claude-subagents.md §1.1]`.
6. **Subagent system prompts are not written to transcripts.** Guide presence in general-purpose
   subagents is inferred from the +1,516-token first request.
7. **Substitution against friction cannot be separated at `$0`.** Only a paid guide ablation can
   (B3, §8).
8. **The opencode phase split (F1)** that decides whether the A4 ceiling is task-shape-limited was
   built but not classified. It is the most valuable remaining `$0` measurement if A4 reopens.
9. **A count conflict on `Explore`.** `research/agent-efficiency-2026.md` §3.4 reports 60 native
   and 12 sweet `Explore` launches with no transcript. `forensics/claude-subagents.md` finds 44
   `Agent` calls, 44 transcripts, 30 native and 8 sweet `Explore`, deduplicated by `tool_use.id`.
   This document adopts the forensics count. Do not cite 60/12 until the conflict is resolved.
10. **Whether `Bash` is in claude-code's 20,000-token result-clearing set** is unresolved. If not,
    `ss-*` results are never cleared while native `Read` results are `[C anthropic-model-product-path.md §3.3]`.
11. **Whether the provider bills luna cache writes at 1.25×** rests on one web page; the effect is
    under one point either way `[M verify/c14-mechanism.md §2.2]`.
12. **The moq consumer-dispatch claim** rests on code reading, not a runtime trace.
13. **Whether Anthropic models pick `isolation: worktree`** as often as luna did (44 of 44) is
    unknown; the desktop-app default does not depend on the model `[W]`.
14. **The `Read`-tool cap** is a constant 25,000 with an env override and a remote-config value,
    not a model profile `[C harness-changelogs.md §2.1]`; doc 06 §5.2 needs the correction.
15. **The pool is single-file and small.** Median agent patch 1 file; median golden 310 tracked
    files; 2 of 21 repositories reach 1,000 files, where the only published semantic-search A/B
    finds a material effect `[M][W agent-efficiency-2026.md §3.2]`. Seed S4's `$0` count of
    SWE-rebench candidate repositories above 1,000 tracked files is unevaluated (§6 step 7).
16. **The two epochs' codex cap difference** is unrecorded and cannot be probed on the read-only box.
17. **The published claude-code cell is not reproducible from `rows.json`.** Two attempts, two
    residuals. `verify/c14-mechanism.md` §7: the dearest-3 inclusive lower bound rebuilds native at
    $0.021437 against the published $0.021558 (−0.6%), probably a different measured-sidechain set
    in the runner; sweet's $0.020727 reproduces exactly. `research/structured-vs-shell-parallelism.md`
    §9: `rows.json` for `fp-claudecode-tab-20260826` gives `costRealizedUsd` $0.005853 native /
    $0.013065 sweet with `costSidechainUsd` zero, against the brief's $0.021558 / $0.020727; the
    accounting path that produces the published pair was not found. §0.2 and §4.1 therefore rest
    on a native cell nobody in this slate rebuilt. The −3.9% (published) and −3.31% (replay) are
    the same dearest-3 convention on two native totals that differ by that −0.6%.
18. **Whether one-hour cache writes deplete a subscription's plan allowance faster** is
    unresolved; the fetched page does not document it and it is not measurable at `$0`
    `[M verify/c14-mechanism.md §7]`. It decides whether the C-A5 documentation rider (§4.1) has
    a real-user effect beyond the per-token path.

---

## 8. User decisions needed

1. **Reopen register A4 for opencode only?** Requests: a structured surface can at best make
   sweet batch like native, so it cannot make sweet emit fewer requests than native; request parity
   is its ceiling. Cost, `verify/c02-mechanism.md` §5 verbatim: vehicle (b) custom structured tools
   nets "−0.4% to −4.5%" of the sweet cell, "landing sweet between +2.9% and −1.2% against native";
   vehicle (a) plugin intercept "is exactly parity". The bar is a 3.2% cut of the sweet cell; the
   top of the verifier's range clears it (−1.34% against native `[I: 0.009265 × 0.955 = $0.008848
   against $0.008968]`), the bottom does not, and the realised fraction is unknown. The vehicle is
   owner-excluded (2026-07-31), unbenchmarked and `new_tool: true`. It needs a bench preflight
   change. Codex gains nothing at the pin; claude-code has no supportable number. A "yes" adds the
   `$0` step 8 of §6 and a second, separate pre-registration, not written here.
2. **The tool guide (B3).** Two admissible `$0` readings of guide-taught syntax dependence exist,
   and they disagree. The literal reading is 33.92% on claude-code, 13.92% on codex and 11.42% on
   opencode (443 of 1,306, 135 of 970 and 90 of 788 operations). The wide reading, which
   reclassifies every form the shipped usage strings print as self-describing, is 0.69% / 1.24% /
   0.76%, all of it the `ss-trace` mode word the wrapper ignores `[M verify/c09-history.md §4, §7
   item 5; verify/c09-mechanism.md §5]`. The literal reading fires the pre-registered 20% kill
   line of the harness-conditional-guide seed (agent-efficiency S1) on claude-code; the wide
   reading misses that line by 16–29×. The census therefore cannot adjudicate B3. The guide costs
   about one request per rollout. It earns that back only on claude-code, where no-delegation is worth 7.5%
   `[I research/agent-efficiency-2026.md §6.3]`. The sweet arm shows no reasoning-token penalty
   (+0.35% on codex) `[M cost-per-solve-leaderboards.md §5.2]`. A harness-conditional guide (keep
   it on claude-code, drop it on codex and opencode) is measurable only by a paid ablation. Decide
   whether to authorise one.
3. **The plan-tool profile (c01).** The mechanism is real on opencode and claude-code
   `[M verify/c01-mechanism.md]`. Doctrine rows A10, D4a, F13 and G7 rule it a shared floor cut;
   codex 0.152.0 removes the codex leg. Only the owner can overrule doctrine. Not recommended.
4. **Contact surface for real users.** The bench wrappers are not product commands (c12). Whether
   real users get `ss-*` through packaged `bin` entries or through `init --mcp --no-cli` is an open
   product decision (memory `project_ss_tools_native_vs_eval_dispatch.md`).
5. **Rebuild and stamp the goldens on the box**, then decide whether the pre-registered rebaseline
   in §6 runs. Not authorised here.
6. **The `pages` note for subagents** via `--append-subagent-system-prompt`: a shared harness
   change that lowers native's cost and reopens the runner's recorded position.
7. **Harness pin policy.** Codex 0.152.0 disables `update_plan` for both arms; 0.150.0 stops
   loading `AGENTS.md` from untrusted projects, so the trust entry must be verified per run
   directory `[W harness-changelogs.md §6 T1, T7]`. Claude Code 2.1.232 makes subagent forking
   default, which makes native's delegation cheaper `[W T4]`. Never pool runs across a pin move.
8. **A multi-file cohort, and a repository-size axis.** Two distinct screens, both task metadata
   only, both arm-symmetric (statistical power, not levers). (a) Multi-file: the one published win
   for sweet's mechanism is on a multi-file pool; our median agent patch is one file and E14
   records about zero retrieval headroom. Decide whether the next paid cohort screens for
   multi-file reference patches `[M cost-per-solve-leaderboards.md §7 S-5]`. (b) Repository size:
   2 of 21 pool repositories exceed 1,000 tracked files (median golden 310); the only published
   semantic-search A/B finds its material effect above 1,000 files `[M][W agent-efficiency-2026.md
   §3.2, §8 S4]`. Decide whether to stratify by size; the `$0` count that gates it (kill if fewer
   than 30 candidate repositories exceed 1,000 files) is §6 step 7 and is unrun. Both screens
   change the population the headline describes.
9. **A tiny paid probe** ($0.10–0.20) of whether the residual `pages` failures shrink on a newer
   Claude Code (register §12.5 item 35). Paid, so it needs authorisation.
10. **The trustworthy-baseline admission check (§4.2).** The cheap form (row counters) needs no
    decision. The preflight form runs a suite in the jailed image at selection time, which breaks
    the METADATA-ONLY / OUTCOME-BLIND contract of `select/task-gates.json` and is unaffordable
    over the ~19,000-task seeded draw `[C select/task-gates.json:8; PLAN.md §6 row P6]`. Any form
    is forward-only: HO2 stays at denominator 199 and is never re-filtered. Decide whether to adopt
    the check for pools recruited from now on, and in which form. Kill line: fewer than 2
    all-untrusted admitted tasks in a pool.

---

## Appendix A. Evidence paths

- Box (read-only): `/root/sweet-search-private/eval/task-completion-bench/results/{fp-codex-tab-20260826,
  fp-opencode-tab-20260826, rp-oc-tab-20260827, fp-claudecode-tab-20260826}/` (`rows.json`,
  `agent-state/`, `<arm>/patches.json`, `<arm>/rep-N/patches.json`); the `none`/`pipe` forms;
  `rb-claudecode-20260824`; `/root/fresh-run/repair-tasks.txt`; goldens `/root/.ss-eval/golden/`;
  binaries `/root/.local/share/claude/versions/2.1.218`, opencode 1.18.4, codex 0.146.1.
  Scratch: `/tmp/wf-slatec/<agent>/`, one directory per forensics, research or verify agent.
- Local: `slate-c/forensics/*.md` with `scripts-*/data/`; `slate-c/research/*.md`;
  `slate-c/candidates/DEDUP.md`; `slate-c/verify/c01..c15-{history,measurability,mechanism}.md`
  with `scripts-*/`; `slate-c/register/DEAD-LEVER-REGISTER.md`.
- Key rollout ids: `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0`
  (`rollout-2026-08-26T23-09-22-01a04055-…`); `fp-claudecode-tab-20260826/callstack__react-native-paper-972/sweet/rep2`
  (37 requests, $0.020387); `rp-oc-tab-20260827/devlooped__moq-1262-sweet` rep 2
  (`session-1787859832153-1442751-bb37c5b1`); `fp-claudecode-tab-20260826/bfgroup__b2-113/sweet/rep2`
  subagent `agent-a41e46d3e2671aa14` (calls 41–50).
- Code read: `eval/agent-read-workflows/bin/_ss-helpers.mjs` (136-147, 188-190, 247-268, 380-381, 939-956);
  `core/search/grep-output-shaping.js` (17-19, 55-88); `core/indexing/indexer-utils.js` (440-486);
  `core/infrastructure/config/search.js` (379-395); `harness/rt-condense-lib.mjs` (46-47, 183, 209);
  `harness/rt-shim-runtime.mjs` (45-47, 125-127, 187-191); `harness/ideal-cost.mjs` (95);
  `harness/agent-runner-shared.mjs` (134-152); `harness/claude-code-task-runner.mjs` (42-92,
  268-282, 332-344); `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` (24, 46, 54-64).

## Appendix B. New measurement traps

1. A quote-blind shell segmenter splits `ss-grep "a|b|c"` into three operations and inverted the
   "4% more operations" claim `[M opencode-calls-per-request.md §6]`.
2. `stepsToFirstEdit` equals the call count on codex and opencode; rebuild phases from transcripts.
3. Opencode and claude-code transcripts store each tool result twice; de-duplicate verdicts
   against `rtLaunched` `[M verify/c15-mechanism.md §2]`.
4. A child session's `CLAUDE_CODE_SESSION_ID` names the parent orchestrator's transcript
   `[M verify/c13-mechanism.md §2]`.
5. Claude-code `none`/`pipe` runs have no native arm; `fp-opencode-tab` holds 30 superseded sweet
   rows; segment sweet by first sight of the edited path, not first read.

## Critic gaps and dispositions

`slate-c/CRITIC.md` (2026-09-02) listed 19 gaps: 3 blocking (B1–B3), 7 major (M4–M10), 9 minor
(m11–m19). Every one is dispositioned here. Each gap was checked against its cited source before
the edit; the source line or section is named in the edited text.

| gap | severity | disposition | where in this file |
|---|---|---|---|
| B1 opencode ceiling stated as "parity at best" | blocking | **Fixed.** c02-mechanism §5 quoted verbatim: vehicle (b) "−0.4% to −4.5% … landing sweet between +2.9% and −1.2% against native"; vehicle (a) "exactly parity". Request claim and cost claim are separate sentences. Owner-excluded and unbenchmarked status unchanged. Arithmetic shown: 0.009265 × 0.955 = $0.008848 = −1.34% against native `[I]` | §0.1 opencode row, §0.3, §2 opencode row, §8 item 1 |
| B2 §4.2 decision flag and inadmissible preflight form | blocking | **Fixed.** `needs_user_decision: yes` for the admission check; the METADATA-ONLY / OUTCOME-BLIND contract conflict and the ~19,000-task cost stated `[C task-gates.json:8; PLAN.md §6 P6]`; forward-only sentence protecting HO2's 199 added; falsifier replaced by the per-cell `trustworthy=no` census; kill adopted (fewer than 2 all-untrusted admitted tasks); tenth decision added | §0.4 item 2, §4.2, §4.6 G13/G11 row, §6 step 2, §8 item 10 |
| B3 subagent repricing called a bench artefact | blocking | **Fixed.** "One bench artefact and one price-vector counterfactual"; the runner pins all three model slots to one slug `[C claude-code-task-runner.mjs:279-281]`, so luna's rate is the true price; 0.2× is a real-user sensitivity; removed from §4.1's ledger-defect list; both intervals added to the §0.2 table (row-matched −8.8% [−33.1%, +29.1%]; all-22 main-only −1.4% [−20.1%, +27.0%]) | §0.2, §1 item 4, §3 row 5, §4.1, §5.1 c14 |
| M4 dot-config index admission never filed | major | **Fixed.** New §4.6 row as an E1 extension carrying the 94-dotfile census, the 4-of-198 native-read exposure, the −1.3% pooled claude-code ceiling `[I phase-anatomy §7 S2]`, the trace ids, and the tiny-fixture finding (83 `.md`, 30 `.json` under 30 bytes). §3 row 8 now points to §4.6, not §4.3 | §3 row 8, §4.6 |
| M5 E3 and E13 censuses scheduled as unrun | major | **Fixed.** §4.6 E3 row OPEN → CLOSED at 7 of 1,251 (0.56%), 13 follow-up requests per 198 rollouts; §6 step 5 reduced to the two golden-dependent replays; §4.6 row corrects register §12.4 item 25 from four to two and names `candidates/index-time-and-capabilities.md` F1/F5 and DEDUP R21; the register line itself was edited to match (see below) | §4.6, §6 step 5, §7 item 3 |
| M6 G17's codex/opencode half dropped | major | **Fixed.** §4.1 carries the cross-harness cache-write item (apply in all three runners or disclose beside every cross-harness table); §4.6 G17 row corrects the scope; §0.1 gains a ledger-basis note: the table is on the published ledger; the consistent ledger reads opencode +2.52% and codex +0.06% `[M register G17]` | §0.1 note, §0.4 item 4, §4.1, §4.6 |
| M7 §8 item 2 quotes the pre-reclassification guide-dependence figure both c09 lenses ordered deleted | major | **Fixed.** Replaced with the two admissible readings and per-harness values (literal 33.92 / 13.92 / 11.42%; wide 0.69 / 1.24 / 0.76%); literal fires S1's 20% kill on claude-code, wide misses by 16–29×. The deleted near-total figure no longer appears anywhere in this file `[M grep, 0 hits]` | §8 item 2 |
| M8 two survivors without register rows; three filing instructions missed | major | **Fixed.** §4.6 gains an E2 row for §4.4, an E2 row plus an E15 row for §4.5, and a §0.2 correction (`ss-batch` in neither `bin` nor `files`, re-verified with `node -e` over `package.json` on 2026-09-02 `[M]`) | §4.6 |
| M9 §4.5 real-user claim and dropped c03 corrections | major | **Fixed.** PATH condition and unmeasured population added; "$0.00 of the $0.86226 priced" disclosure beside the ceiling; delegation-rate bound (9/66 vs 27/66); citation corrected to `_ss-helpers.mjs` 136-147 in §4.5 and Appendix A. The unsourced "up to 54% of a claude-code cell wasted" was not in this file; the 54% in §1 item 4 is the sourced one-rollout fragility figure `[M claude-main-thread.md §2]` | §4.5, Appendix A |
| M10 published claude-code −3.9% not reproduced | major | **Fixed.** New §7 item 17 with both attempts and residuals (−0.6% native; rows.json $0.005853 / $0.013065 with zero sidechain); §0.2 now states that −3.9% and −3.31% are the same convention on two native totals differing by −0.6% | §0.2, §7 item 17 |
| m11 "twelve tasks" applied to claude-code | minor | **Fixed.** "twelve tasks on codex and opencode, eleven on claude-code (72/72/66 rollouts)" | §0.3 |
| m12 codex row's "under 0.5%" non-sequitur | minor | **Fixed.** Codex "no" rests on the solve column; a sub-0.5% item could close the 0.35% gap if one were live | §0.1 codex row |
| m13 `promptCacheTtl` retired on the corrected framing | minor | **Fixed.** "plan-usage consumption" wording; C-A5 restored as an arm-universal product-documentation rider with an explicit zero bench claim; plan-allowance depletion filed as §7 item 18; subscription-path rows (−0.34% / +4.12%; +2.23% / +6.69%) added to the §0.2 table | §0.2, §4.1, §5.1 c14, §7 item 18 |
| m14 `ss-trace` mode-word mismatch filed nowhere | minor | **Fixed.** Fourth wrapper defect in §4.4 with guide line 32 and `_ss-helpers.mjs` 939 / 940-956 (positional read at 954) `[C re-read]`; 27 pooled operations; included in the §4.6 E2 row | §4.4, §4.6 |
| m15 seed S4 repository-size stratification never dispositioned | minor | **Fixed.** Second, named axis in §8 item 8; §6 step 7 carries S4's `$0` count with its kill line (fewer than 30 repositories above 1,000 files); §5.3 row added; §7 item 15 marks the count unevaluated | §5.3, §6 step 7, §7 item 15, §8 item 8 |
| m16 wrong register vehicle (G20) and unreachable stop rule | minor | **Fixed.** Filed as G13 (fact) using G11 (vehicle); stop rule runs the census before the admission filter | §4.2, §4.6, §6 stop rules |
| m17 7–10% sums three envelopes | minor | **Fixed.** Three terms printed separately; the failed-call term carries E2's "upper envelope, not removable spend" qualifier; the sum is labelled an upper envelope under §4.7's rule | §0.1 |
| m18 §4.2 mixes two denominators | minor | **Fixed.** Native 125/198 → 120/189 canonical; sweet 115/195 → 111/187 on raw fresh-pool rows, with the canonical 120/198 named and the reason the bases differ stated | §4.2 |
| m19 53% tagged [M] | minor | **Fixed.** Tagged `[I on M]` with the source's derivation sentence ("Gold and hidden-test fields were counted, never read into this report") | §0.3 |

One edit outside this file: `register/DEAD-LEVER-REGISTER.md` §12.4 item 25 now reads two
falsifiers instead of four and names the document that closed the other two. No other register
row was edited; the remaining §4.6 rows stay filed as corrections to be applied.

Not changed, and why: no new candidate was added; every gap was closed with facts already
verified in `slate-c/verify/`, `slate-c/candidates/` or `slate-c/forensics/`, or with a code
re-read named in the text. Seed S4's repository count and the plan-allowance question are open,
not evaluated, and are listed as such in §7.
