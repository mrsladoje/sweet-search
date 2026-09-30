# FINAL_TUNING — last product-tuning pass after the 2.8.2 retrieval matrix

Written 2026-09-30, while the r282 retrieval matrix was running. Owner-approved scope; see
§11 for the decisions that are still open.

**Goal:** make sweet-search cheaper per answered question and per solved task, at equal or better
accuracy and resolution. Every change must be justified by measured waste in the traces, not by
intuition.

**Order:** (1) freeze the r282 numbers, (2) analyze the r282 traces, (3) analyze a small
task-completion sample the same way, (4) pick levers, (5) ablate on dev data, (6) build the new,
harder retrieval benchmark, (7) confirm the winners on held-out data.

---

## 0. Data status — what may be looked at, and when

| Data | Status now | Status after step 1 |
|---|---|---|
| r282 retrieval pool (vault 60 + held-out 30 + OOD 40 = 130 questions) | Held-out: aggregates only | **DEV.** Per-question traces may be read. |
| Task bench dev-200 (`select/tasks_multilingual.jsonl`) | Dev | Dev |
| Task bench DEV-RET (`select/tasks_heldout.jsonl`, 200; reclassified 2026-07-31) | Dev | Dev |
| Task bench turnfix sets (`tasks_turnfix_{discovery20,expand32,confirm28}.jsonl`) | Dev (subsets of the above) | Dev |
| Task bench HO2 (`select/tasks_heldout2.jsonl`, denominator 199) | **Frozen paper set** | **Frozen. Not used in this plan.** |
| New retrieval benchmark (§8) | Does not exist | Its held-out 40% is the only untouched retrieval set |

Rule: the r282 numbers become DEV only **after** the final r282 report (all 5 cells, BH-FDR) is
written and committed. From that moment, no r282 figure may be published as a held-out result
for any version other than 2.8.2.

---

## 1. Step 1 — freeze r282

- Wait for all 5 cells: oc-dsflash41, oc-sol61-high, codex-sol61-high, cc-sonnet55-high,
  cc-opus55-medium.
- Run `--report` for each cell. Apply BH-FDR across 5 cells × 4 primary metrics as
  pre-registered in `r282-PREREG.md`.
- Write `r282-RESULTS.md` (aggregates only, with n, seed, CI, and the corrected q-values).
- Commit it. Only then open the per-question traces.
- Copy the harness session stores out of `~/.ss-eval/r282/` into one archive (they are not in
  git, and a re-run of a cell overwrites them). See §2.1.

---

## 2. Step 2 — trace analysis of r282 (no new runs)

### 2.1 Sources

| Harness | Summary per rollout | Full session |
|---|---|---|
| all | `results/r282-<cell>/runs.jsonl` (usage, cost, calls, toolKinds, USD metrics) and `captures/<arm>.<id>.json` (answer, full tool output text, command per call) | — |
| opencode | — | `~/.ss-eval/r282/<cell>/oc-data-{native,sweet}/opencode.db` (SQLite: `session`, `message`, `part`; part types `step-start`, `step-finish`, `tool`, `text`, `reasoning`, `patch`) |
| Codex | — | `rollout-*.jsonl` in the private `CODEX_HOME` under `~/.ss-eval/r282/<cell>/` |
| Claude Code | — | session `.jsonl` under `~/.ss-eval/r282/<cell>/claude-home-<arm>/projects/`, **including sidechain (subagent) transcripts** |

**First task: build a join table** `rollout → session` for every rollout. Keys: cell, arm, cwd
(clone path), start time, and the question text in the first user message (the FRAME + question
is unique per question). A rollout that does not join exactly one session is an error, not a
skip.

Output: one normalized file per cell, `r282-<cell>/trace.jsonl`, one record per **request**
(model call) with: rollout id, arm, request index, input tokens (uncached / cache-read /
cache-write), output tokens, reasoning tokens, the tool calls it emitted (name, argument
tokens), and for each tool call the result tokens.

### 2.2 Definitions (fixed before any number is looked at)

- **Turn** = one model request (one assistant response). Parallel tool calls inside one response
  are one turn, many calls. Claude Code: count unique assistant `message.id`, main thread and
  sidechains separately. opencode: `step-start` parts. Codex: `token_count` events with a
  non-zero delta.
- **Tool call** = one tool invocation, either arm.
- **Tool name.** Sweet arm: the basename of the executable (`ss-search`, `ss-read`, `ss-grep`,
  `ss-find`, `ss-semantic`, `ss-trace`). Match the **basename**, not the first `ss-` substring:
  the tool path contains `.ss-eval`, which a naive regex reads as a tool (seen in the DeepSeek
  cell). Native arm: the harness tool (`Read`, `Grep`, `Glob`, `Bash`, `read`, `grep`, `glob`,
  `shell`, `apply_patch`, …), and for shell calls the first command word (`rg`, `grep`, `cat`,
  `sed`, `find`, `ls`, `head`, …). Sweet arms also make native calls (DeepSeek sweet: `bash` 18,
  native grep 13) — they are counted under their native name in the sweet arm.
- **Fixed prefix** = system prompt + tool definitions + harness-injected context (rules,
  AGENTS/CLAUDE files, environment block), measured in tokens from the first request.
- **Reasoning tokens** — see §2.7 for the per-harness source.
- **Cost** = tokens × list price, cache-write 1.25× basis, sidechain-inclusive (same as r282).
  Codex: `output_tokens` already contains reasoning; never add `reasoning_output_tokens` again
  (fixed 7079bfb).

### 2.3 Per-tool share of calls and cost (owner point 4)

For each cell and arm, a table:

| Tool | % of calls | % of turns that use it | Result tokens per call (median, p90) | % of result tokens | **% of cost** |
|---|---|---|---|---|---|

**Cost attribution per tool call** (reconciles to the total cost):

- *Argument cost:* the call's argument tokens × output price, in the request that emitted it.
- *Result cost:* the result's tokens enter the next request as **uncached** input (or as a
  cache write on Anthropic), then as **cache reads** in every later request of the rollout. So:
  `result_tokens × (first_price + cache_read_price × later_requests)`.
- *Non-tool buckets:* fixed prefix (first write + all reads), reasoning, final answer text,
  frame/question, and harness overhead (e.g. todo, summaries).
- The buckets must sum to the recorded rollout cost within 2%. A larger residual means a
  parsing error; stop and fix it before reading any number.

Example of the wanted read-out: "ss-search = 10% of calls but 50% of cost; ss-grep = 50% of
calls but 20% of cost".

Both arms get the same table. Native gets it per native tool (owner point 2): how often it calls
`grep`/`rg`/`Read`/`cat`, how big the arguments are, how much each returns, and what that costs.

### 2.4 Turns vs calls (owner point 3)

Per cell and arm: turns per question, calls per question, calls per turn (parallelism), and the
paired sweet − native difference for each, with the stratified bootstrap (B=20000, seed 42).
Cost scales with turns (each turn re-reads the context), so a cut in calls that does not cut
turns may save nothing.

### 2.5 Where the money goes — prefix vs output budget

Per cell and arm:

- fixed prefix size in tokens (sweet vs native), and its share of cost;
- cache hit ratio per request position (request 1, 2, 3, …);
- **cache stability check:** does the sweet prefix stay byte-identical across requests and
  across rollouts? Anything dynamic early in the prefix (date, cwd, index status, random ids)
  breaks provider caching. Hypothesis to test first: on DeepSeek, sweet costs +55% at cached
  prices but only +5% at naive prices, so sweet input is cached less — either the prefix is
  unstable or the tool results are large and new.
- result tokens delivered per sweet-search call vs how much of it the final answer uses (the
  USD metric's `content` component). If most returned code is never cited, an adaptive or
  smaller budget is a lever (§4).
- metadata overhead: the share of each sweet-search result that is header, scores, line gutters,
  path repetition, or hints, versus code. Measured by parsing the result format.

### 2.6 What happens after each tool (per-tool success rate)

For every tool call, classify the **next** action of the agent:

| Next action | Label |
|---|---|
| Reads / opens a file or symbol that the result returned | **hit → drill-down** |
| Gives the final answer (no more calls) | **hit → sufficient** |
| Calls the same tool again with a reformulated query | **miss → retry** |
| Calls a different sweet-search tool for the same need | **miss → switch** |
| Falls back to a native tool (grep, cat, Read) | **miss → fallback** |
| Reads something not in the result | **ignored** |

Report per tool: calls, % hit, % miss, % ignored, and the cost of the miss chains (the calls and
tokens between a miss and the next hit). The same classification runs on native tools (a `grep`
followed by another `grep` is also a retry), so both arms get a comparable "search efficiency".

Rule-based classification first (path overlap between result and next call). A judge model
labels only the rows the rules cannot place, and those rows are counted and reported.

### 2.7 Reasoning tokens (owner point 5)

| Harness / model | Count available | Text available |
|---|---|---|
| opencode + DeepSeek V4.1 Flash | yes (`step-finish.tokens.reasoning`) | **full raw reasoning** |
| opencode + GPT-6.1 Sol | yes | summaries only, sparse (~80 chars) |
| Codex + GPT-6.1 Sol | yes (`reasoning_output_tokens`, already inside `output_tokens`) | **none** (summary empty, content encrypted) |
| Claude Code + Sonnet / Opus 5.5 | **no separate count** — `output_tokens` includes thinking | thinking blocks (to be checked when the cells finish) |

Per cell and arm: reasoning tokens per question, per turn, and **after which tool** they are
spent (reasoning in request *n* is attributed to the tool results that request *n* reads). This
answers "where does the agent think more — after an ss-* result or after a native result". For
Claude Code, estimate thinking = output − (visible text + tool-use tokens) and label it as an
estimate.

For DeepSeek only (full text available): sample reasoning after **miss** events and tag why the
agent was not satisfied (wrong file, too much text, truncated, unsure of completeness, …). This
is qualitative and allowed only because r282 is DEV after step 1.

### 2.8 Where does sweet win or lose — per stratum

All tables above, split by set (vault / held-out / OOD) and by question type if the probe files
carry it. Known pattern to explain: OOD is the best set for sweet in both finished cells
(DeepSeek: accuracy +2.9 points, calls −21%; Sol opencode: calls −36%, wall −15%, cost −5%).

### 2.9 Deliverable

`r282-TRACE-ANALYSIS.md`: one section per question above, per cell, plus a ranked list of
**waste items** with their measured cost share. Each waste item names the lever it suggests.

---

## 3. Step 3 — the same analysis on the task-completion bench

Retrieval questions are short; tasks are long and include editing and testing. Tuning only on
retrieval can make tasks worse. So the analysis in §2 also runs on task-completion rollouts.

### 3.1 Sample

- **12 tasks per model × harness cell**, the same 5 cells as r282, both arms → 5 × 12 × 2 =
  **120 rollouts**.
- Tasks come **only** from the dev pools (dev-200 + DEV-RET = the 400). **Never HO2.**
- Selection, in this order (cheapest filter first, see `project_control_replacement`):
  vacuity pre-screen → name-lock → blocklist → `excludeFromAgentRuns` → F2P/P2P gate →
  historical solve rate between 20% and 80% (tasks that always pass or always fail carry no
  solve signal) → stratified by language → seed 42.
- Use the **same 12 tasks in every cell** so harnesses can be compared.

### 3.2 Prerequisites (hard gates)

- **Green ledger** for these 12 tasks under the exact harness versions (claude 2.1.281,
  codex 0.159.2, opencode 1.18.4), network policy and images of this run. No green ledger → no
  run.
- Escape audit active in all three CLI runners (it is, via `escape-audit.mjs`) and **egress
  locked down**; a rollout that reads gold or fetches a fix is excluded and reported.
- Codex cost basis after 7079bfb. Claude Code cost sidechain-inclusive.

### 3.3 What 12 tasks can and cannot show

The micro-smoke noise floor applies: per-rollout cost log-SD ≈ 0.16–0.20, so one cell of ~12
tasks detects only a cost effect of ~25% or more, and solve rates carry almost no signal at
this size. So:

- **Use these 120 rollouts for diagnosis** (§2 tables: per-tool share, turns, reasoning,
  follow-up rates, prefix cost), not for decisions.
- **Resolution guard** for any shipped change is a separate, larger check (§7).

---

## 4. Step 4 — candidate levers (chosen from the data, not from this list)

Each lever needs a waste item from §2/§3 that it targets, with a measured cost share large
enough to exceed the noise floor.

| Lever | Targets | Evidence needed first |
|---|---|---|
| **Shorter sweet harness prompt** (same tools) | fixed prefix | prefix share of cost is large; prefix is uncached often |
| **Cache-stable prefix** (move dynamic text to the end) | cache misses | §2.5 stability check fails |
| **Adaptive output budget** (smaller default, grow on demand) | result tokens | most delivered code is never cited |
| **Less metadata** in ss-* results (headers, scores, gutters, hints) | result tokens | metadata share is large |
| **Drop or merge tools** (e.g. ss-semantic, ss-trace, ss-find) | tool-definition tokens, miss chains | low call share, low hit rate, high miss cost |
| **Parallel-call guidance** (more calls per turn) | turns | turns barely drop while calls drop |
| **Stop guidance** (answer once sufficient) | extra turns after a hit | "hit → sufficient" rows followed by more calls |

Observed call mix in the sweet arm so far (only for sizing the tool-pruning question):

| Cell | ss-read | ss-search | ss-grep | ss-semantic | ss-trace | ss-find |
|---|---|---|---|---|---|---|
| Sol, opencode | 138 | 94 | 88 | 34 | 21 | 21 |
| Sol, Codex (partial) | 70 | 58 | 51 | 24 | 14 | 14 |
| DeepSeek, opencode | 87 | 109 | 265 | 7 | 1 | 14 |

(The DeepSeek row undercounts: 148 calls were misparsed as `ss-eval` by the path-substring bug in
§2.2.)

**Dropped idea:** a third arm with the sweet harness prompt but no ss-* tools. The sweet prompt
removes the stock grep/retrieval guidance and is written for ss-* tools, so without them it is a
broken configuration and measures nothing useful. The cost of the prompt is measured by
attribution instead (§2.3, §2.5), and a prompt change is tested as a *shorter prompt with the
same tools*.

---

## 5. Step 5 — ablations on dev data

### 5.1 Variants

Only the variants that §4 justifies. Expected shape (to be confirmed by the data):

- **Tool subsets**, e.g. {ss-search, ss-read, ss-grep}; {ss-search, ss-read, ss-find};
  current full set as the control. The prompt text changes only where it names a removed tool.
- **Output budget** variants (e.g. current vs −30% vs adaptive).
- **Prompt length** variants (same tools).
- Metadata-trim variant.

### 5.2 Protocol

- **Screen on the cheap cell first:** opencode + DeepSeek V4.1 Flash on the r282 pool (now
  dev): 260 rollouts ≈ 50 minutes, < $1. Concurrency 3 on this Mac.
- Compute the per-question cost SD from r282 first and state the **minimum detectable effect**
  for 130 paired questions before each screen. Do not screen a variant whose expected effect is
  below it; use mechanism metrics (turns, result tokens, prefix tokens) for small effects.
- **Confirm** only the screen winners on one subscription cell (Sol opencode or Codex, then one
  Claude Code cell), and on the 12-task task-completion sample (§3) for diagnosis.
- Run one variant at a time against the same control, same clones, same frame, same judges.

### 5.3 Decision rule for a screen (fixed before the run)

A variant passes to confirmation if, on dev:
- cost per question drops with the 95% CI below 0 **or** the mechanism metric it targets drops
  clearly and the cost moves in the same direction;
- accuracy is non-inferior: the lower CI bound of the difference is above −2 points;
- no new failure mode appears in the task-completion diagnosis (e.g. more wrong-file edits,
  more native fallbacks).

---

## 6. Step 6 — the new retrieval benchmark

The r282 pool is at its ceiling (accuracy ≈ 97% in every finished cell), so it can show cost
differences but never an accuracy gain. After this plan it is also DEV. A new benchmark is
required before any claim about the tuned version.

### 6.1 Requirements

- **Harder questions** — target native accuracy of 60–80%, so both directions are measurable:
  - multi-hop tracing across files (caller → callee → config);
  - concept questions without an obvious identifier to grep for;
  - "where is X handled / enforced / validated" across layers;
  - negative questions (the thing does not exist) at a fixed share;
  - larger repos (≥ 100k LOC) as well as mid-size ones.
- **Fresh public repos** never used in development or in r282; multiple languages, stratified.
- **Ground truth** per question: file path(s) + symbol(s), written and checked without looking at
  any sweet-search or native agent output.
- **Split 60/40 dev / held-out**, stratified by language and question type, **seed 42**. Held-out
  is aggregates only, run at milestones only.
- Pre-register metrics, judges, and analysis before the first run (same as r282-PREREG).
- Indexed with the standard config (`--sqlite-fast --verbose --concurrency=1`), one repo at a
  time.

### 6.2 Size

~150 questions → 90 dev / 60 held-out. Final size follows from a power calculation using the
r282 per-question SDs.

---

## 7. Step 7 — confirmation

- **Retrieval:** the tuned version vs 2.8.2 (and vs native) on the new benchmark's **held-out**
  split, all 5 cells, aggregates only.
- **Task completion (resolution guard):** a larger dev check on the non-frozen 400 pool —
  large enough to bound a resolution drop (sized from the noise floor; the turnfix confirm28 /
  expand32 sets are candidates) — with green ledger and egress lockdown.
- HO2 stays untouched unless the owner decides to spend it on a release claim.

---

## 8. Instrumentation changes for all new runs

- **Codex:** set `model_reasoning_summary = "detailed"` in both arms so reasoning text is
  readable. It is a harness setting, so it must be identical across arms, and it is a change
  from r282 — never pool across it.
- Persist the rollout → session join key (session id) in `runs.jsonl` at run time.
- Archive the harness session stores per run into the results folder (compressed).
- Record the fixed-prefix token count per rollout.

---

## 9. Budget and time (estimates)

| Step | Runs | Time | Cash |
|---|---|---|---|
| 2 trace analysis | none | 1–2 days of analysis | judge calls for unplaced follow-ups only |
| 3 task sample | 120 task rollouts | ~1 day on the box, incl. ledger | subscriptions + DeepSeek, a few $ |
| 5 screens | ~260 rollouts per variant on DeepSeek | ~50 min per variant | < $1 per variant + judges |
| 5 confirms | 260 per variant per subscription cell | 1–2 h per cell | subscription limits |
| 6 new benchmark build | question authoring + indexing | several days | judge / authoring calls |
| 7 confirmation | 5 cells × new held-out + task guard | ~1 day | subscriptions + a few $ |

Paid or subscription runs are prepared, then launched only on the owner's explicit go.

---

## 10. Known caveats carried into the analysis

- r282 native and sweet arms differ by the **whole product** (prompt + tools); per-tool cost
  attribution explains the difference, it does not isolate causes experimentally.
- Codex reasoning is not readable in r282; only counts.
- Claude Code has no separate thinking-token count.
- The DeepSeek sweet arm also uses native `bash` and grep — those calls stay in the sweet arm's
  totals.
- opencode `patch` parts in the sweet arm list only `.sweet-search/` maintainer files (lock, log,
  query stats); no agent edited a repository file.
- The per-set results are secondary and uncorrected; only the pooled BH-FDR result is primary.

---

## 11. Open decisions for the owner

1. Which 12 tasks (after the filters in §3.1) — proposal to be shown before any run.
2. Size of the task-completion resolution guard in §7.
3. Whether HO2 is spent at the end of this plan or kept for a later release.
4. The repos and question mix for the new benchmark (§6).
