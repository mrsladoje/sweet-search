# FINAL TUNING — autonomous overnight hill-climb (handoff)

Written 2026-09-30 by the session that ran r282. Owner: asleep while this runs. **You run
without asking for permission.** The owner's authorization and its limits are in §2. Everything
else follows the repo rules (`CLAUDE.md`) and the owner's memory
(`~/.claude/projects/-Users-admin-Projects-sweet-search-private/memory/MEMORY.md`).

Companion files in this folder:
- `STATE.md` — the loop's single source of truth. Read it first on every wake-up; update it
  before you sleep.
- `LOOP-PROMPT.md` — the exact `/loop` prompt the owner starts you with.

Background documents (read once, at the start):
- `core/prompt-optimization/data/FINAL_TUNING.md` — the plan this handoff executes. §2 = the
  trace analysis spec.
- `core/prompt-optimization/data/r282-RESULTS.md` — the baseline numbers (2.8.2).
- `core/prompt-optimization/data/r282-PREREG.md` — how r282 was run.
- Eval-hill-climbing guidance: claude.dev blog, "Automating eval design and hillclimbing with
  Claude" (2026-09-28, https://claude.dev/blog/automating-eval-design-and-hillclimbing/).
  The rules from it that bind you are restated in §5.

---

## 1. Goal

**Make sweet-search cheaper per answered question and per solved task, at equal retrieval
accuracy and equal task resolution.** The owner's specific hypotheses (test them, do not
assume them):

1. **ss-search is too fat.** Does the agent need the full code of result #2 and #3 in most
   cases? Could ranks 2..n return path + symbol + signature only, with code on demand
   (ss-read)? Could metadata (scores, headers, gutters, hints) shrink?
2. **Some tools can go.** ss-semantic, ss-find and ss-trace are rarely used (on Sol ~20% of
   ss-* calls together). Dropping them shortens the tool definitions and the sweet rules, and
   may focus the model.
3. **The sweet rules / harness prompt costs too much** as a fixed prefix, or breaks caching.

The r282 facts you start from:
- Accuracy is equal to native in all 5 cells (95–98%, ceiling).
- Billed cost vs native: Sonnet/CC −0.7%, **Opus/CC +22%**, Codex/Sol −10.5%,
  opencode/Sol +6.8%, **opencode/DeepSeek +55%**.
- Cost is decided by caching, not by the amount of work: without the cache discount, the sweet
  arm sends −24% (Sonnet) … +10% (Codex) of the native input.
- Useful content drops in Claude Code only (−21% Sonnet, −37% Opus, both significant).
- The OOD set favours sweet in every cell (calls −20..−36%).

**Target:** the best variant is cheaper than 2.8.2-sweet in every cell and not worse than native
on cost in any cell, with accuracy and task resolution non-inferior. **Opus/Claude Code is the
priority cell** (worst cost, most-used by the owner).

---

## 2. Authorization (owner, 2026-09-30) and hard limits

The owner said: *"make this run autonomously while I sleep as a loop without stopping for my
permissions or anything."* This **overrides** the memory rule "never launch paid runs
unapproved" **for this plan only**, within these limits:

| Resource | Limit |
|---|---|
| Cash (DeepSeek agent runs + all judges + OpenRouter) | **$40 total** for the night. Track it in `STATE.md` after every run. Stop spending cash at $40. |
| ChatGPT subscription (Codex / opencode Sol) | Allowed. On a usage-limit stop: sleep (ScheduleWakeup ≤ 3600 s) and resume. |
| Claude subscription (Claude Code Sonnet/Opus cells) | Allowed but **scarce**: this loop session itself runs on the same Max plan. Use Claude Code cells only for confirmation of finalists (§6.4), never for broad screens. Never two Claude Code cells at once. On a usage-limit stop: sleep and resume. |
| Subagents | Sonnet by default (see §9). Opus only for the hardest reasoning. **Never Fable.** |

**Never, under any circumstance:**
- publish to npm, push a tag, create a GitHub release, or change `README.md`;
- merge into `main` or push to `main` (product changes live on branch `final-tuning`, §3);
- touch HO2 (`eval/task-completion-bench/select/tasks_heldout2*.jsonl`) or any held-out split
  per-query (§5);
- edit `~/.claude`, `~/.codex`, `~/.config/opencode` or the owner's auth files (the runners'
  refresh-token write-back is the only allowed write);
- kill processes you did not start — except orphan `sweet-search-maintainer` processes created
  by your own runs (see memory `ops-orphans-hub`). Leave the 5-day-old `_rt_broker.mjs` alone
  (the owner decides);
- run `npm install` / `npm ci` / full `vitest` in the main checkout while a bench runs (memory
  `no-tests-during-bench`). Use the worktree and targeted test files only.

---

## 3. Workspace and code rules

- **All product changes go to branch `final-tuning`** in a git worktree:
  `git worktree add ../sweet-search-final-tuning -b final-tuning` (from `main` at the
  commit that holds this handoff). Commit every accepted and every rejected variant (rejected
  variants as env-switchable code or as a note — never delete evidence). Push the branch.
- **Variants must be switchable by environment variable, default OFF = byte-identical to
  2.8.2.** Pattern: `SS_VARIANT_<NAME>=1`. The r282 control must stay reproducible from the
  same tree with all switches off.
- **The bench must run the variant's code, not main's.** `scripts/retrieval-bench-282.mjs`
  resolves `REPO` and `SS_BIN = <REPO>/eval/agent-read-workflows/bin` from its own location, and
  the ss-* wrappers load `core/` from there (memory `ss-dispatch`: ss-* tracks the WORKING TREE).
  So run the runner **from the worktree**. Verify once with a sentinel: a variant switch that
  adds a marker line to ss-search output must appear in a smoke capture.
- The product harness text (init prompts, rules) is installed from the task-bench helpers — make
  sure those also resolve from the worktree when a variant changes rules or tool lists.
- **No index-format changes.** Variants change query-time behaviour, output shaping, tool
  lists and prompt/rules text only. An index change would force a serial reindex of 18+ repos
  (`--sqlite-fast --verbose --concurrency=1`, one repo per machine) — only if a lever clearly
  needs it, and then logged in `STATE.md` first.
- Follow the repo's ranking-signal rules (`CLAUDE.md`): any new ranking/demotion signal is
  gated on agent format.
- Commit messages end with the co-author line from the session's system reminder.

---

## 4. Phases (do them in order; each has an exit gate)

### Phase 0 — setup and inventory (no spend)

1. Create the worktree and branch (§3). Record commit hashes in `STATE.md`.
2. Extract the session archive if needed: `core/prompt-optimization/data/results/r282-sessions-20260930.tgz`
   (the live stores are still under `~/.ss-eval/r282/`).
3. **Build `TRIED-LEVERS.md`**: every product / prompt / output lever tried before, with the
   outcome and the evidence path. Sources: the memory directory (start with the hubs:
   `project_agent_mode_history_hub`, `project_p7_gepa_history_hub`, `project_grep_history_hub`,
   `project_phase6_ss_tool_audits_hub`, `project_budget_sweep_smoke_2026_06_10`,
   `project_harness_hillclimb_result`, `project_harness_trim_smoke`, `project_turnfix_program`,
   and every file marked DEAD / NO-GO / REJECTED / REFUTED in `MEMORY.md`), the handoff folders under
   `eval/task-completion-bench/handoffs/`, and `git log --oneline` (grep for "lever", "trim",
   "budget", "variant", "revert"). One Sonnet agent (high effort) may do the sweep; you review.
   **You must not re-run a lever that is in this file unless the new variant differs in a
   stated, mechanism-level way.**

   Known already (verify details in the sources):
   - **Flat output-budget cuts are tried.** 2026-06 budget sweep: ss-search preview budget
     4k → 3k shipped (53ad493). Below 3k, **Opus compensates** (calls +0.3..+0.8, savings erased);
     Codex breaks at 2k; DeepSeek tolerates 2k. `tier2.5k` with auto-tier escalation was
     **refuted on all 4 models**. So "leaner ss-search" must be a **shape** change (e.g. code for
     rank 1 only, signatures for ranks 2..n, less metadata), **not** another uniform budget cut.
   - Harness hill-climb (2026-09-26/27): generic "batch your calls" wording is dead (+7..+60%);
     ss-find / regex-alternation lines are dead; stacking lines on a champion is dead; Claude Code
     wording wins on rotation A were overfit (lost on B). Shipped: Codex pallyt, opencode
     todoall, Claude Code max-batch.
   - Task-bench levers dead or no-go: thrash levers, eviction, type-definition inlining,
     completeness card (lever 4), clause candidates, sibling line (gate 2), tests-first,
     checkpoint-on-green. See the respective memory files.
4. Compute the **noise floor** for retrieval screens from r282 `runs.jsonl`: per-question SD of
   the sweet arm's cost, calls, accuracy per cell, and the paired MDE (80% power) for
   n = 78 (train) and n = 52 (validation). Write it to `STATE.md`.

**Exit gate:** worktree works (sentinel seen), `TRIED-LEVERS.md` committed, noise floor recorded.

### Phase 1 — deep trace analysis of r282 (no spend except a few judge calls)

Execute `FINAL_TUNING.md` §2 in full, for **all 5 cells, both arms**, plus these owner
requirements:

- **Native is measured with the same rigour**: every native tool (Read, Grep, Glob, Bash + first
  command word, read/grep/glob in opencode, shell in Codex), argument size, result size, cost.
- **Turns and calls** both, per arm; calls per turn.
- **Per-tool share table**: % of calls vs % of cost (e.g. "ss-search 10% of calls, 50% of cost"),
  for both arms. Cost attribution per `FINAL_TUNING.md` §2.3; buckets must reconcile to the
  recorded cost within 2%.
- **Reasoning tokens**, sweet vs native, and after which tool they are spent.
- **Follow-up after each tool** (hit → drill-down / sufficient, miss → retry / switch / fallback,
  ignored) = the per-tool success rate.
- **Cache forensics first** (it decides the bill): prefix size, cache-read / cache-write /
  uncached per request position, prefix byte-stability across requests and rollouts, per harness.
  Explain Opus +22% (naive input −2% but billed +22%) and DeepSeek +55% (naive +5%).
- **Rank usage in ss-search**: for each ss-search result list, which ranks does the agent later
  read, cite, or use in the final answer? This answers "do we need code for #2 and #3".
- **Metadata share** of every ss-* result (header, scores, gutters, hints, paths vs code).
- **Fixed prefix cost** of the sweet rules and each ss-* tool definition, in tokens and in $.
- **Useful-content drop in Claude Code**: find the mechanism.
- Tool-name parsing: use the executable **basename** (`.ss-eval` in the path fooled a naive
  regex; 148 DeepSeek calls were misread).

Structure: one normaliser per harness (opencode SQLite, Codex rollout JSONL, Claude Code session
JSONL incl. sidechains) → a common `trace.jsonl` per cell (FINAL_TUNING §2.1). Suitable for 3
parallel Sonnet agents (high effort), one per harness; then you (or one Opus-high agent) write the
synthesis. Validate each normaliser on 3 rollouts by hand before trusting it.

Deliverable: `core/prompt-optimization/data/r282-TRACE-ANALYSIS.md` with all tables and a
**ranked waste list** (each item: measured $ share per cell, the lever it suggests, and whether
that lever is in `TRIED-LEVERS.md`).

The r282 pool is DEV now (`r282-RESULTS.md` is committed), so per-question reading is allowed.

**Exit gate:** reconciliation within 2% in every cell; ranked waste list committed.

### Phase 2 — lever proposals (no spend)

Write `LEVERS.md`: candidate variants, each with (a) the waste item it targets and its measured
share, (b) the expected effect vs the Phase-0 MDE, (c) the mechanism metric that must move
(tokens delivered, turns, cache-write tokens, prefix tokens…), (d) risk to accuracy and to task
resolution, (e) proof it is not in `TRIED-LEVERS.md`. Drop any candidate whose expected effect is
below the MDE and that has no clear mechanism metric.

Expected families (only if the data supports them): rank-shaped ss-search output; metadata
trim; tool pruning (ss-semantic / ss-find / ss-trace) with the rules text shortened to match;
cache-stable prefix (dynamic text moved to the end); shorter sweet rules with the same tools;
stop/sufficiency guidance. **One change per variant.**

**Exit gate:** ≥ 3 candidates with a mechanism and an MDE-clearing expected effect.

### Phase 3 — retrieval screens on r282 (dev)

Split the 130 r282 questions **once** into **train 78 / validation 52**, stratified by set
(vault / held-out / OOD) and language, seed 42. Record the split file and its sha256 in `STATE.md`.
You may read train traces and failures; you read **only aggregates** of validation.

For each candidate (one at a time, §5 rules):
1. **Screen cell = opencode + DeepSeek V4.1 Flash** (cash, ~$0.3 per 78 rollouts + judges) and
   **Codex + Sol** (subscription). Run only the **sweet arm** with the variant ON, on train.
   Compare to a **fresh sweet-baseline re-run** (variant OFF) on the same questions — never to the
   r282 rows alone (time drift, provider drift). Re-use one baseline re-run per cell for several
   variants on the same night if the code is unchanged.
2. **Test-retest first:** before the first variant, run the baseline twice on train in the
   DeepSeek cell. The difference between the two runs is your real noise. A variant must beat
   it clearly.
3. If train passes (§6.2), run the same on **validation** (aggregate only).
4. If both pass, confirm on **Opus / Claude Code** (train + validation, sweet arm only, plus a
   fresh baseline) — the priority cell. Then Sonnet / Claude Code and opencode / Sol if the
   subscription budget allows.

Runner: `CELL=<cell> node scripts/retrieval-bench-282.mjs --conc 3 --arms sweet --ids <comma-separated train or validation ids>`
from the worktree, with a distinct results dir per variant (add `--tag <variant>` or a
`RESULTS_TAG` env if it does not exist yet — commit that runner change first).

### Phase 4 — task-completion micro-smoke (resolution guard)

Use the Mac micro-smoke machinery from the harness hill-climb (it is known to work on this Mac):
`eval/task-completion-bench/handoffs/improve/harness-prompt-trim/` — read `NIGHT-PLAN.md`,
`HILLCLIMB.md`, `CONFIRM10.md` and its `scripts/`; memory `harness-trim-smoke` has the Mac
recipe (`eval/task-completion-bench/handoffs/improve/harness-prompt-trim/scripts/mac-smoke.sh`, colima, `TMPDIR` under `$HOME`, `SS_ISOLATION=0`, ORT INT8,
pinned CLIs under `~/.ss-eval/bin-*`, images via that folder's `scripts/host_pull.py`).

- Tasks: **rotation A (4) + rotation B (6)** from that hill-climb — DEV tasks from the 400,
  already imaged on this Mac. Never HO2.
- **Green ledger first** (memory `green-ledger`): a product change changes the harness
  fingerprint → re-sweep the 10 tasks gold-only (no model spend) before any rollout. This is
  authorized.
- Cells: **Opus / Claude Code (priority)**, Codex / Sol, opencode / DeepSeek. Arms: shipped
  2.8.2 sweet vs champion variant (sweet only; native is not needed for a guard).
- Guard passes if: solves champion ≥ solves baseline in every cell (owner: "on par, or a bit
  better on Opus"), cost not higher than baseline beyond the micro-smoke noise floor (memory
  `microsmoke-noise-floor`: one cell ≈ 30–57% MDE — so cost here is direction only), and no new
  failure mode in the traces (wrong-file edits, more native fallbacks, degenerate loops).
- A failed guard sends the variant back to Phase 2 with the trace evidence.

### Phase 5 — build the new retrieval benchmark

The r282 pool is at ceiling and is now dev. Build **r3 (new benchmark)** following the blog's
eval-design rules (§5) and `FINAL_TUNING.md` §6:

- **Size: ≥ 100 held-out questions** (owner requirement) **+ 40–60 dev**. Split stratified by
  language and question type, **seed 42**, frozen with sha256 in a manifest before any agent
  run.
- **Headroom:** native accuracy with a flagship (Opus/Claude Code, Sol/Codex) must be well
  below 100% — target 60–85%. If a pilot on dev shows ≥ 95%, the questions are too easy; fix the
  design, not the grader.
- **Production alignment:** questions of the kind agents actually need during real coding
  tasks. Good sources: the retrieval needs visible in task-bench DEV trajectories (what did
  agents search for before their first edit?), multi-hop tracing (caller → callee → config),
  concept questions without a greppable identifier, "where is X enforced/validated", and a fixed
  share of negative questions (thing does not exist). Hard because a human judges them hard —
  **not** sampled from where the current product fails (no failure fingerprints).
- **Repos:** fresh public repos never used in development, r282, or the task bench; several
  languages; include large repos (≥ 100k LOC). Index serially with the standard flags; pkill
  leaked maintainers between repos.
- **Grader:** gold = file path(s) + symbol(s) + a short list of **checkable claims** per question
  (not a 1–5 scale). Programmatic check for file/symbol recall where possible, judge panel
  (deepseek-v4-flash direct, gemini-3.1-flash-lite direct, MiniMax via OpenRouter; median) on
  the claims. **Grader consistency check:** score a sample twice; report verdict flips. **Read a
  sample of scored transcripts before trusting the grader.**
- **Answer isolation:** gold files live outside every clone and outside any path the agent is
  told about; the escape audit (grep traces for reads of the gold path) runs on every result.
- Low variance: unambiguous questions two independent Sonnet agents answer identically from the
  gold code; drop the ones they disagree on (before the split).
- Pre-register (`r3-PREREG.md`) before the first scored run.
- Suitable for a small workflow: question drafting by Sonnet (medium effort) agents per repo,
  verification by different Sonnet (high) agents, final audit by one Opus (high) agent.

**Baseline:** run 2.8.2 sweet vs native on r3 **dev** (all screen cells) and on r3 **held-out**
once (aggregate only), to have the 2.8.2 reference.

### Phase 6 — continue the climb on r3 dev

Same loop as Phase 3, with r3 dev split into train / validation (e.g. 60/40, seed 42). The r3
held-out is evaluated **only at the end** (Phase 7), aggregate only.

### Phase 7 — final evaluation and morning report

- Champion vs 2.8.2 sweet vs native on **r3 held-out**, all cells the budget allows (Opus/CC
  mandatory), aggregate only, bootstrap CI + BH-FDR.
- Task guard (Phase 4) re-run on the final champion if it changed after Phase 4.
- Write `MORNING-REPORT.md` (§8). Update the memory (one project file + `MEMORY.md` line).

---

## 5. Hill-climbing rules (from the claude.dev post + our history)

1. **Train / test separation.** Read only train failures when you propose a change. Validation
   and held-out are aggregates only. If train improves and validation stays flat → overfit →
   **revert**.
2. **One change per round**, aimed at the root cause of a measured waste item, big enough to
   show above noise. Do not reword a line and hope.
3. **Keep a patch only if both train and validation improve** (cost down) **with accuracy
   non-inferior** on both. Revert on any regression.
4. **Prompt integrity:** never paste failing-question content, repo names, symbols or answers
   into prompts, rules or tool descriptions. General wording only; it must also make sense for
   repos without tests, interactive use and non-coding questions.
5. **Answer isolation:** agents must never be able to reach gold answers (§4 Phase 5).
6. **Noise check before climbing:** measure test-retest noise; do not test changes whose
   expected effect is below it.
7. **Stop** a climb when the score stalls for 2–3 rounds or no candidate's expected effect clears
   the noise. Then do failure analysis: sort remaining train failures by cause (ambiguous
   question, harness error, variance) and write it down.
8. **Lock the best-on-validation version** at the end, report with confidence intervals.
9. Never pool runs across a shipped fix or a harness-version change (memory rules).

---

## 6. Metrics and decision rules

### 6.1 Metrics (same definitions as r282)

- Primary: **cost per question** (tokens × list price, cache-aware, cache-write 1.25×,
  sidechain-inclusive; Codex `out = output_tokens`), **accuracy** (judge median), **calls**,
  **turns**.
- Mechanism: delivered ss-* tokens, prefix tokens, cache-write / cache-read / uncached tokens,
  reasoning tokens.
- Secondary: useful content (USD `content`), wall time.

### 6.2 Screen pass rule (train, then validation)

Pass if all hold:
- cost Δ vs fresh baseline < 0 with the paired bootstrap 95% CI below 0, **or** (if n is too
  small) the targeted mechanism metric drops with CI below 0 **and** cost moves the same way by
  more than the test-retest difference;
- accuracy Δ lower CI bound > −0.02 (non-inferiority, 2 points);
- calls and turns do not rise significantly (compensation check — the 2026-06 lesson).

### 6.3 Cross-cell rule

A variant that helps one cell and hurts another beyond noise is **not** a champion. Harness-
specific variants are allowed only if the product can switch them per harness (it can: per-CLI
init files) — then the rule applies per harness.

### 6.4 Confirmation

Opus / Claude Code confirmation (train + validation) is mandatory before a variant enters the
Phase-4 task guard.

---

## 7. Loop mechanics

- Start: owner runs `claude --dangerously-skip-permissions` in the repo root and pastes the
  `/loop` command from `LOOP-PROMPT.md`.
- **Every wake-up:** read `STATE.md` → check runs in flight (`pgrep -fl retrieval-bench`, log
  tails) → do the next step → update `STATE.md` (phase, step, runs in flight with log paths,
  spend, decisions with evidence paths) → commit + push the branch → `ScheduleWakeup`.
- Long runs: launch detached (`nohup … &` + `disown`), log to a file, and sleep. Delay: the
  expected remaining run time (60–3600 s). Do not poll in short loops.
- Never run two bench cells on the same harness at once; at most one Claude Code cell at a time;
  retrieval cells at concurrency 3.
- If something is broken (infra error, auth, judge down): fix it if it is yours; else record it in
  `STATE.md`, skip to independent work (analysis, benchmark building), and retry later.
- If blocked on a decision that truly belongs to the owner: record it under "Owner decisions" in
  `STATE.md`, pick the conservative option, and continue.
- **End** when Phase 7 is done, or the cash limit is hit and no free work is left, or it is 09:00
  local time — whichever comes first. Then write `MORNING-REPORT.md` and stop the loop
  (`ScheduleWakeup` with `stop: true`).

---

## 8. Morning report (`MORNING-REPORT.md`)

Conclusion first, STE style (memory `reply-style`), sweet vs native in every table. Contents:
1. One-paragraph verdict: champion (or none), its effect per cell vs 2.8.2 and vs native.
2. Trace-analysis headlines (cache, per-tool share, rank usage, reasoning).
3. Every variant tried: hypothesis, mechanism metric, train / validation result, keep / revert.
4. Task guard results per cell (solves, cost direction).
5. r3 benchmark: design, sizes, headroom achieved, grader consistency, 2.8.2 baseline.
6. Final held-out result (aggregate, CI, BH-FDR) if reached.
7. Spend: cash, subscription cells run.
8. Open owner decisions and recommended next steps (e.g. which switches to make default in a
   release — the owner decides; nothing is released).

---

## 9. Subagents and workflows

- The owner allows parallel agents and the Workflow tool **when they save real time**, not by
  default. Keep a workflow under 10 agents.
- Models: **Sonnet, medium effort** for benchmark question drafting and routine extraction;
  **Sonnet, high effort** for parsers, trace analysis, lever design; **Opus, high effort** only for
  the hardest synthesis or an adversarial review of a champion. **Never Fable.**
- Every agent prompt must carry the held-out rule (§5.1) and the "do not touch" list (§2).
- Verify agent output yourself before it drives a decision (read a sample, re-run a number).

---

## 10. Useful facts and gotchas

- Pinned CLIs: `~/.ss-eval/bin-claude-2.1.281`, `bin-codex-0.159.2`, `bin-opencode-1.18.4`.
  Claude token: `~/.ss-eval/claude-sub.env`. Codex auth: `~/.codex/auth.json` (runner copies +
  writes back). opencode ChatGPT OAuth: `~/.local/share/opencode/auth.json` (runner seeds +
  writes back).
- Clones: `~/.ss-eval/r282-repos/<cell>/` (APFS copy-on-write; the runner creates them). Running
  outside clones leaks the repo's own `AGENTS.md` into agents (proven).
- opencode start-up check sometimes reports "database is locked" at concurrency 3; the retry
  recovers — not an error.
- `.git` drift warnings (`.git/opencode`, pack mtimes) are harmless.
- Judges: DeepSeek direct (never via OpenRouter), Gemini direct, MiniMax via OpenRouter. Check the
  DeepSeek balance before a long night (it ran dry once, 2026-06-13, and silently dropped a judge —
  the runner now records `judgesOk`; reject rows with < 3 judges or re-score them).
- r282 per-question sweet costs: DeepSeek ≈ $0.002, Sol ≈ $0.026–0.029, Sonnet ≈ $0.042,
  Opus ≈ $0.065. Rollout time ≈ 8–40 s. A 78-question sweet-only screen takes ~10–30 min.
- BH / bootstrap script: `scripts/retrieval-bench-282-bh.mjs`.
