# SLATE C — brief for every workflow agent (2026-09-02)

> **Superseded in part by [`SLATE-C-UBER.md`](./SLATE-C-UBER.md) (2026-09-02).** This brief was the
> workflow's input. Two of its claims were corrected by the run and must not be quoted from here:
> (1) the claude-code read-before-edit gate binds only on 10 legacy Anthropic model ids (no current
> model), so it is not a general real-user risk; (2) the D-4 `pages` defect is NOT fixed in the
> fresh pool (23% of native Read calls still die on it, flattering sweet). The canonical register is
> `register/DEAD-LEVER-REGISTER.md` (123 rows), not the draft.

Read this whole file before doing anything. It is the shared context for a multi-agent
workflow whose job is to find **new** levers that make the sweet arm (sweet-search `ss-*`
tools + tool guide) **at most as expensive as native on each of the three harnesses
(codex, opencode, claude-code) while solving at least as many tasks**. Two earlier slates
and roughly fifty gated levers already exist. Your work is only valuable where it is
**not already on the record**. Read `DEAD-LEVER-REGISTER-DRAFT.md` next to this file.

## 0. Hard rules (violating any of these voids your output)

1. **`$0` only.** No model rollouts, no paid smokes, no benchmark launches. Trace reading,
   replays, static analysis, web research, and arithmetic only.
2. **The evidence box is read-only.** `ssh root@167.233.69.121`. Never write under
   `/root/sweet-search-private/eval/task-completion-bench/results/`. Scratch goes under
   `/tmp/wf-slatec/<your-agent-name>/` on the box, or in your local scratchpad.
3. **Do not edit product code or bench code.** This workflow produces analysis and a plan.
4. **HO2 (frozen held-out, 199 tasks) is never opened per-task.** Do not read `HELDOUT2*`
   task lists or any `ho2-*` run per-query. DEV pools (rotate20 / `sb-*`, fresh pool
   `fp-*`, `rb-*`, `fixval-*`) are open.
5. **Grading logs contain hidden-test expectations.** `results/<run>/<arm>/logs/*.txt` and
   `rep-N/logs`. Read them only to classify a *recorded* outcome; never use them to
   derive what an agent "should have known", and never print hidden test names or gold
   patch content into your report. Describe the class of missing fact abstractly.
6. **Differential rule.** A change delivered through the shared FRAME (benchmark prompt),
   the shared `run_tests` shim, or any shared harness setting reaches both arms and has
   **zero head-to-head differential**. Such a change may still be a product fix; it can
   never be a "sweet beats native" lever. State the vehicle for every candidate.
7. **No same-information compaction.** Rendering the same lines smaller is a banned class
   (`SLATE-A-UBER` §9 item 6, `SLATE-B-UBER` §8). A payload lever is admissible only if
   it changes *which* lines or *which requests* happen.
8. **Ranking signals must be gated on `opts._isAgentFormat`** (see repo `CLAUDE.md`).
   Retrieval-quality benchmarks (GCSN etc.) must not move.
9. **Solve is the veto.** A cost saving that costs a solve is a loss. Report both.
10. **No task identity, gold, or hidden tests as runtime inputs** for any proposed mechanism.
11. **Owner scope rule (2026-08-14): "no new tools, only improve existing ones."** You MAY
    propose a new tool, but you must flag `new_tool: true` and `needs_user_decision`.
12. **Owner decisions already taken:** MCP arm scoped out for the turnfix program
    (2026-07-31, Bash/CLI only); the tool guide's guidance block is not to be trimmed;
    `N<TAB>` gutter kept on all harnesses (2026-08-28). You may argue to reopen one, but
    label it `needs_user_decision` and give the evidence that changed.

## 1. Where things stand (the numbers you are trying to move)

All harnesses ran the same backbone, `openai/gpt-5.6-luna` via OpenRouter (registered price
$0.10 in / $0.01 cached / $0.60 out per million; listed price today is double, ratios
unchanged). Native arm = harness's own tools + benchmark frame. Sweet arm = same + `ss-*`
CLI wrappers on PATH + the 1,457-token tool guide (called "M±" in older docs) delivered via
`AGENTS.md` (codex, opencode) or `.claude/rules/sweet-search.md` + appended system prompt
(claude-code).

**Fresh pool, 2026-08-26/27** (22 unselected DEV tasks × 3 reps = 66 rollouts per cell;
production form is `TAB`):

| harness | native solved | native $/rollout | sweet TAB solved | sweet TAB $/rollout | sweet vs native |
|---|---:|---:|---:|---:|---:|
| codex | 41/66 | 0.012287 | 39/66 | 0.012330 | +0.3% |
| opencode | 41/66 | 0.008968 | 41/66 | 0.009265 | +3.3% |
| claude-code | 43/66 | 0.021558 (lower bound) | 40/66 | 0.020727 | −3.9% |

Totals: native 125/198, sweet 120/198. No difference clears the pre-registered bar of ±6
rollouts. The claude-code "win" is entirely native's subagent spend; on the 4 tasks where
neither arm delegated, sweet's main thread is **+26% dearer**. Claude-code native cost is a
lower bound (205 delegated requests carry no usage record).

**Fix-validation smoke 2026-08-28** (6 tasks × 3 reps, after index-coverage fix): sweet
dearer +6.5% codex / +11.9% opencode / +30.6% claude-code (small n; claude inflated by
delegation). Retrieval fix delivered (gold `.jam` files now reached), resolution unchanged.

**Epoch A (2026-08-11, 17 rotate20 tasks, pre-gutter-fix)** was the last time sweet looked
clearly cheaper: −6.5% codex, −17.8% opencode, +2.4% claude main-only. That lead was
pool-dependent (native narrows its own reads on harder tasks) and partly a codex harness
change (a ~2,500-token tool-output cap now deletes 35% of native's tool tokens for free).

### 1.1 Cost anatomy (fresh pool, per rollout)

`cost = 0.10·INGEST + 0.01·ΣPREFIX + 0.60·OUTPUT` per million tokens.

| cell | INGEST share | re-sent prefix share | OUTPUT share | re-sends per ingested token |
|---|---:|---:|---:|---:|
| codex sweet | 28% | 45% | 27% | 15.9 |
| codex native | 29% | 42% | 28% | 14.3 |
| opencode sweet | 31% | 46% | 24% | 15.0 |
| opencode native | 34% | 42% | 24% | 12.4 |
| claude-code sweet | 22% | 44% | 18% (+15% sidechain) | 20.1 |
| claude-code native | 19% | 40% | 20% (+21% sidechain) | 21.4 |

A token that enters context is billed 2.2–3.1× its sticker price. **Requests (turns) are
the multiplier.** Cache hit is 99.3–100% of re-sent tokens; no rollout ever compacted
(largest context 100k of a 1.05M window), so compaction/eviction is untestable here.

**Sweet-only constant terms on every harness:** tool guide $0.00042–0.00051 (2.6–4.5%);
gutter $0.00030–0.00039 (2.0–3.7%); requests reacting to failed `ss-*` calls ≤ ~2%
(upper envelope). Sweet must earn back ~7–10% before it can be cheaper.

**Per-harness drivers of the sweet − native delta:**
- **codex:** the harness caps tool output at ~2,500 tokens middle-out (`…N tokens
  truncated…`); native hits it 3.6×/rollout and loses 35% of its tool tokens for free,
  sweet 11%. Sweet returns 18% fewer total tool bytes but the same number of requests.
- **opencode:** native issues **1.55 tool calls per request vs sweet 1.11** (structured
  `read`/`grep`/`glob` are emitted in parallel; a Bash `ss-*` call is one per request), so
  sweet pays **+3.4 requests = +10.2%**. Sweet does 4% MORE operations; "fewer calls" was an
  envelope count. Within the native arm: `calls/request ≈ 0.48 + 2.32 × structured-share`.
- **claude-code:** native delegates in 15/22 task-cells, sweet in 6/22. Native `Read` 19.4
  calls/rollout (10.45 main + 8.94 in subagents) at 3.1 kB vs `ss-read` 4.6 calls at 5.3 kB.
  Failed-edit retries cost 4–11% of a claude-code cell; a W0-P7 whole-episode measure put
  claude sweet's failed-edit turns at 13.4% of the arm (28/32 mechanically addressable:
  20 string-not-found, 6 wrong-path, 2 degenerate). Like-for-like anchor-failure rates at
  n=66: native 7.4%, TAB 5.9%, NONE 4.4%, PIPE 4.4%.
- **claude-code product risk (unmeasured):** Claude Code 2.1.218's `Edit` requires a prior
  native `Read` ("File has not been read yet") but the deployed binary skips the check
  unless the model id is in a hardcoded Anthropic set. The bench ran luna, so 218/259
  sweet edits with only an `ss-read` before them never errored. **Real Claude users of
  sweet-search would pay one failed Edit + one Read per edited file.**

### 1.2 Resolution anatomy

- Losses are **wrong-fix, arm-universal (~65%)**: the agent satisfies the visible tests
  and misses the hidden assertion `test_patch` adds. Only ~30% of losses (wrong-location +
  incompleteness) are retrieval-differentiable at all. Localization is not the bottleneck;
  agents reach the right file in most failures.
- **Delivered computed facts DO flip tasks** (hint ladder, 2026-08-18): `apple` 0/3 → 16/16
  on the literal output of a frozen static state-space checker; `codeception` 0/3 → 2/4 on
  one runtime fact (enumerability); `dashbitco` 0/3 → 2/4 on a coherence certificate.
  Placebo 0/4, prose rules 0/3, "check the twin" clause 0/6, localization-only 0. **The
  value is the computation, not the rule.** But each checker generalizes to ~1 file in
  152,270. Finding computations that generalize is the open resolution problem.
- Some tasks are **naming lotteries** (hidden tests import an identifier the reference
  patch invented): `bingo`, `dart`. No tool can win them. `name-lock-census.mjs` flags them.
- A 20×-priced backbone unaided scored 0/10 on the five hard targets.
- Fresh-pool dead-everywhere tasks (0/3 in every cell): `bfgroup__b2-259`,
  `fastify__fastify-cors-285`, `gitbookio__markup-it-56`, `hotmeteor__spectator-181`,
  `protofire__solhint-224`, `devlooped__moq-1262` (moq 1/3 on codex only). Discordant:
  `accenture__sfmc-devtools-1974` (edit landed in the wrong method; ambiguous anchor),
  `awslabs__aws-embedded-metrics-node-21` (wrong layer), `aio-libs__aiohttp-8038` (native
  won by grinding, 125 calls), `bfgroup__b2-113` (index gap, now fixed), `celestiaorg__nmt-192`
  (one premature stop), `apigee__registry-961`, `locationtech__jts-622` (single reps).

### 1.3 The gutter question (settled; do not re-derive)

`ss-read`/`ss-search`/`ss-semantic` number code lines `N<TAB>`. A 6-task A/B (n=18/cell,
2026-08-25) suggested `N| ` for codex/opencode and `N<TAB>` for claude-code. The 891-rollout
fresh-pool confirmation (n=66/cell) showed all three forms within 3 rollouts of each other
on every harness, each harness ranking them differently, Fisher p ≥ 0.72 against a
pre-registered bar of ±6. **Verdict: keep `N<TAB>` everywhere; per-harness delimiter is
not a lever.** Real per-harness *mechanisms* that remain: (a) the tab carry on tab-indented
files fails claude-code `Edit` (8/61 edits in 3 tab-indented tasks; 0 solves changed) while
codex/opencode silently write one extra tab; `N:` is the only zero-ambiguity dense form
(+0.71 tok/line over tab); (b) codex's ~2,500-token output cap truncates ss outputs
middle-out; a deferred `$0` idea is to fit `ss-read`/`ss-search` under ~2,400 tokens on
codex with an addressable "continue" span (~2%, correctness not cost). Harness detection
already exists in production: `core/search/output-policy.js` `detectAgentEnv()` (codex via
any `CODEX_*` env key, claude-code via `CLAUDECODE`, opencode via `OPENCODE`), currently
used only to suppress decoration.

## 2. Evidence locations

### 2.1 Local repo (`/Users/admin/Projects/sweet-search-private`)

- Slates and results: `eval/task-completion-bench/handoffs/improve/` — `SLATE-A-UBER.md`,
  `SLATE-B-UBER.md`, `SLATE-A-CLOSE-RESULTS.md`, `SLATE-A-RESIDUE-RESULTS.md`,
  `PHASE-0-RESULTS.md`, `PHASE-0-B-RESULTS.md`, `PHASE-1-RESULTS.md`, `W0-P1..P7-GATE-RESULTS.md`,
  `P2-RESIDUE-GATE-RESULTS.md`, `HINT-LADDER-RESULTS.md`, `CLAUSE-SCREEN-RESULTS.md`,
  `GUTTER-AB-RESULTS.md`, `GUTTER-MECHANISM-INVESTIGATION.md`, `FRESH-POOL-RESULTS.md`,
  `REBASELINE-RESULTS.md`, `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` (canonical, §5 =
  most recent lever list, §5.3 rejected, §5.4 Sol's 22 claims), `INDEX-HYGIENE-RESEARCH-2026-08-28.md`,
  `FIX-REPORT.md`, `HANDOFF-CRUSH-NATIVE.md`, `PANEL-SYNTHESIS.md`, `EVIDENCE-DIGEST.md`.
- 08-28 panel evidence: `handoffs/improve/harness-gutter-cost-20260828/` — `01-edit-mechanisms.md`,
  `02-cost-decomposition.md`, `03-gutter-form-cost.md`, `04-resolution-{codex,opencode,claude-code}.md`
  (per-task forensics, tool health, product-defect lists), `05-research-editing-interfaces.md`,
  `06-research-cost-mechanics.md`, `07-research-resolution-levers.md` (L1–L11 ranked levers,
  §9 open questions), `08-sol-ideation.md`, `10-panel-*.md`, `12-truncation-census.md`,
  `scripts/`, `logs/`, `data/`.
- Turn-economy program: `eval/task-completion-bench/TURN_FIX_PLAN.md`, `TURN_PACKING_FINAL.md`,
  `EDIT_THRASHING.md`, `TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md`, `TURN-ECONOMY-2026-07-30.md`,
  `OVERNIGHT-LOOP-2026-08-07.md`, `PLAN.md`; `handoffs/lever2-checkpoint/`, `lever3-eviction/`
  (`GATE0-RESULTS.md`, `PREAMBLE-TRIM-GATE.md`), `lever4-completeness/`, `lever-thrash/`.
- Grok-era forensics: `eval/task-completion-bench/FORENSICS-heldout200-grok-opencode-*.md`.
- `$0` tools: `eval/task-completion-bench/stats/*.mjs` (`resend-census`, `poll-census`,
  `thrash-census`, `loss-taxonomy`, `search-read-replay`, `edit-thrash-replay`,
  `eviction-grid-replay`, `w0b-fusion-economics`), `handoffs/improve/phase1-scripts/`.
- Product code: wrappers `eval/agent-read-workflows/bin/{ss-search,ss-read,ss-grep,ss-find,ss-semantic,ss-trace,ss-batch,_ss-helpers.mjs,_ss-argparse.mjs,_ss-env.sh}`;
  gutter `core/search/search-read.js` (`numberCodeLines`, `GUTTER_DELIMITER`,
  `lineGutterEnabled`, `spanExpandEnabled` — default OFF); harness detection
  `core/search/output-policy.js`; agent pack rendering `core/search/search-server.js`,
  `core/search/context-expander.js`; tool guide
  `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` (+ `-mcp.md` variant);
  init `scripts/inject-agent-instructions.js`.
- Bench runners: `eval/task-completion-bench/harness/{agent-runner-shared,codex-task-runner,opencode-task-runner,claude-code-task-runner}.mjs`,
  `ideal-cost.mjs`, `claude-code-accounting.mjs`.
- Memory notes (project history, one fact per file):
  `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/memory/project_*.md`.

### 2.2 Evidence box (`ssh root@167.233.69.121`, read-only)

Runs under `/root/sweet-search-private/eval/task-completion-bench/results/`:
- **Fresh pool (primary):** `fp-{codex,opencode,claudecode}-{tab,none,pipe}-20260826`
  (each: 22 tasks × 3 reps × 2 arms = 132 rows; the `tab` runs are the production form);
  `rp-oc-{tab,none,pipe}-20260827` (opencode repair pass).
- **Fix-validation smoke:** `fixval-{codex,opencode,claude-code}-20260828` (6 tasks × 2 arms × 3 reps).
- **Rebaseline (13 rotate20 tasks, 3 reps):** `rb-codex-20260825`, `rb-opencode-20260824`,
  `rb-claudecode-20260824` (claude native cost null on 20/39 rows — do not sum).
- **Epoch A (slates' base, pre-gutter-fix `N| `):** `sb-{codex,opencode,claudecode}-20260811`.
- Gutter A/B: `gab-*`, `gx-*` (2026-08-25). Hint ladder: `bd-*`, `bv-*`, `cf-*`, `cs-*`.

Layout per run: `rows.json` (one row per task×arm×rep; fields include `taskId, arm, rep,
harness, model, calls, ss, nativeGrep, toolCounts, patchHunks, stepsToFirstEdit, usage,
idealTurns, sidechainTurns, costRealizedUsd, idealCostUsd, breakPricedCostUsd,
costSidechainUsd, sidechainAccountingComplete, resolved, f2pFrac, gradeable, turnsFile,
finalAssistantText`), `preds-<arm>.jsonl` (full `model_patch`), `turns/<task>-<arm>.jsonl`
(per-request `{t,in,cached,out}`; **written once per task×arm so rep 1 overwrites rep 0 —
rebuild per-rep usage from the raw trace**), `agent-state/<task>-<arm>/` (raw transcripts:
codex `codex-home/sessions/**/rollout-*.jsonl`; opencode `opencode-retained/*/attempt-1.stdout.ndjson`
or `opencode-data/opencode.db`; claude `claude-home/projects/<slug>/<session>.jsonl` +
`.../subagents/agent-*.jsonl`), `<arm>/logs/`, `<arm>/rep-N/`, `rt-dedup/`, `trajectories/`
(**truncated at 600 chars — never use for absence claims**).

Reader: `/root/dump-trace.mjs` (`node dump-trace.mjs <task> <arm> --harness H --rep N
[--tools-only] [--subagents] [--max-result N]`). **Its `RUNS` map is hardcoded to the
`sb-*-20260811` runs.** For `fp-*`/`fixval-*`/`rb-*`, copy it to `/tmp/wf-slatec/<you>/`
and edit `RUNS`, or read the raw files directly.

Known measurement traps (each has cost a wrong claim before):
- Codex stores tool output double-escaped (literal `\n`, `→`); codex `exec` is async
  ("Script running with cell ID N", real stdout arrives on a later `wait`); codex packs
  `apply_patch` inside `exec_command` heredocs so `toolCounts.edit` reads 0 — use a
  non-empty `model_patch` as the edit ground truth.
- Claude transcripts write one request as ~2.46 records sharing `message.id`; take the
  usage-bearing record per id. Sidechain (`isSidechain:true`) requests are billed and are
  arm-asymmetric. `--permission-mode dontAsk` suppresses CLAUDE.md loading; the runner uses
  `bypassPermissions`.
- Opencode's editor is `apply_patch` (4-pass seek from a moving line index), not `edit`.
- Match a transcript to its row by replayed cost, never "the longest" file.
- `run-pilot` PROGRESS `predOk` means "non-empty patch", not solved. Read `resolved`.
- Never pool runs across a shipped fix (e.g. `sb-*` is pre-gutter-fix, `fp-*` is post).
- A fixed-trajectory replay gets the *direction* of a context change right about as often
  as not and never the size (C-4: replay −2.8%, live +4.8/+19.8/+11.7%).

## 3. Output conventions

- Write your full report as Markdown under
  `eval/task-completion-bench/handoffs/improve/slate-c/<phase>/<your-file>.md` with a
  one-paragraph verdict first, then evidence with exact paths, rollout ids, and numbers.
  Tag every number `[M]` measured (say with what), `[C]` read from code, `[W]` web with URL,
  `[I]` inferred.
- Return the structured summary the workflow asks for. Keep it under ~2,000 words; the
  file holds the rest.
- Prose style for reports: conclusion first, one idea per sentence, plain words, no
  internal codenames without a gloss on first use, say what a number means.
- Every candidate lever must state: mechanism; harnesses affected; vehicle and whether it
  is sweet-only; trace evidence (rollout ids); ceiling per harness with the arithmetic;
  the cheapest `$0` falsifier and its pre-registered kill condition; build cost;
  register check (which recorded lever it is nearest to and why it is different);
  `new_tool` and `needs_user_decision` flags.
