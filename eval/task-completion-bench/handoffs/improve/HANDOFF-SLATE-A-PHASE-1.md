# HANDOFF — run Slate A's Phase-1 gates (2 through 10)

**Written:** 2026-08-13, at the end of the fix-sweet implementation session.
**Your job:** run the nine remaining deterministic `$0` gates in
[`SLATE-A-UBER.md`](./SLATE-A-UBER.md) §8 Phase 1, and let most candidates die.
**Not your job:** the big cohort run, Slate B's W0 gates, or building anything.
**Deliverable:** `eval/task-completion-bench/handoffs/improve/PHASE-1-RESULTS.md`.

---

## 0. Read this first — the shape of the mistake to avoid

The previous session did excellent work on one gate and then **jumped straight to
proposing a $7 cohort run**, skipping the other nine. The user caught it. The reasoning
that makes the run wrong is worth internalising, because it applies to every decision here:

> The publication bar is **sweet ≥15% cheaper AND strictly more task solves on every
> harness**. Solve is the veto dimension. Solve is currently **tied**. A bigger cohort buys
> precision on a cost gap that is already directionally known and, on the honest accounting,
> sits at **−13.4%** — below the bar. It cannot change GO/NO-GO.

**Nothing here costs money. If a step seems to need a rollout, you have misread the gate.**

The second failure mode from that session, which cost real money once and nearly published
three wrong numbers, is **closing a question after one attempt**. Three conclusions were
reversed within the same session by simply looking again. See §5.

---

## 1. Status — where things actually stand

### Slate A Phase 0 — COMPLETE

| step | status |
|---|---|
| D-1 grader tripwire + regrade 12 YARP patches | done (`ab4f252`); grader now also inside the ledger fingerprint (`7562b42`) |
| D-2 inclusive sidechain pricing, reproduce main-only | done — 68/68 rows within 0.5% |
| D-4 empty `pages` adapter fix | **not fixed — proven unfixable at that layer.** Measured and subtracted instead (§5.1) |
| D-5 publish OpenCode with/without the empty task | done, both views |
| rebuild digest, selector oracle, resolved-rep counts, ceilings | done — see [`PHASE-0-RESULTS.md`](./PHASE-0-RESULTS.md) |

### Slate A Phase 1 — 1 of 10 gates run

| # | gate | status |
|---|---|---|
| 1 | **C-1** gutter/anchor replay + byte-match proof | **PASSED, then shipped.** Went far beyond the gate — paid A/B and a 16-task screen. See §4.1 |
| 2 | **C-4** whole-file token replay incl. carrying cost | not run |
| 3 | **C-2** leave-one-task-and-repo-out routing | not run — **and currently blocked, see §3** |
| 4 | **C-3** context-reset simulation with exact pricing | not run — **same blocker** |
| 5 | **C-9** structural-address coverage over the 20 failed edits | not run — **evidence base likely consumed by C-1, see §4.5** |
| 6 | **C-5** dependency/spec corpus audit across all 17 issues | partially started, see §4.6 |
| 7 | **C-6** blinded bingo obligation-graph exercise | not run |
| 8 | **C-7** locked-contract discrimination over stored patches | not run |
| 9 | **C-8** blinded referee selection over the stored pool | not run |
| 10 | **R-1** turn-0 dossier localization + token-carry replay | not run |

### Shipped this session (three commits, all pushed to `main`)

| commit | contents |
|---|---|
| `116ca2b` | **product:** tab read gutter (C-1/D-3), whole-segment `--in` directory scopes, multi-scope `--in` wire |
| `7562b42` | **measurement:** cache-write premium, transcript-superset accounting, grader in the ledger fingerprint, empty-patch fail-closed grading, `harness/degeneration.mjs`, the cost pre-registration |
| `12402a9` | item 2 verified live at `$0`; projection of the next run under the retry rule |

---

## 2. Hard constraints

- **Spend:** `$0`. No agent rollouts. No paid A/B. Every Phase-1 gate is deterministic replay
  over artifacts that already exist. If you think a gate needs a model, re-read it.
- **HO2 is frozen.** Never run it, never inspect per-query results from it. DEV-RET only.
- **The evidence box:** `ssh root@167.233.69.121`.
  - **Do not** launch pilots, spend money, or mutate `results/`.
  - **You may** copy files in both directions freely (`scp`, `rsync`, or piping a script to
    `node -` over ssh, which is how the last session ran all its analyses without writing
    anything to the host). Syncing code up to run an analysis against the artifacts is fine.
  - Another agent may be using the host. Abort if `df /` shows under 12G available
    (last check: **55G free**).
  - Never run two pilots concurrently — it triggers a git uid-501 dubious-ownership bug.
- **Format gating.** Any new ranking signal that detects structured-query patterns must be
  gated on `opts._isAgentFormat`. Ungated, this class of change cost −0.07pp on GCSN held-out
  MRR once, and −27.57pp on GCSN dev MRR a second time.
- **Never use `ss-*` to develop sweet-search.** Native file tools only. Exception: running
  `ss-*` as the *system under test* against a non-sweet-search corpus, with scripted
  assertions, is testing rather than dogfooding — that is how item 2 was verified.
- **Working tree is dirty.** Roughly 30 modified and untracked files belong to concurrent
  daemon-cap / RSS / maintainer work. Do not revert, stash, or clean them. If you must commit
  a file that mixes your work with theirs, stage by hunk — `git diff -U3 <file>`, filter the
  hunks, `git apply --cached`. Zero-context (`-U0` + `--unidiff-zero`) mis-places hunks; it
  was tried and had to be redone.
- **Git.** Solo project, commit direct to `main`, no feature branches. Commit only when asked.
- **Never route the Sol model through OpenRouter** — metered at roughly 50× subscription cost.

---

## 3. The blocker you will hit on gates 3 and 4

**The sidechain-inclusive cost columns are unusable, and both C-2 and C-3 are specified
against them.**

`idealCostUsd` and `costRealizedUsd` are **null wherever a delegated transcript is
usage-zeroed**: 12 of 32 native rollouts and 4 of 32 sweet on `screen-v3`. Summing them drops
three quarters of native's delegating — and most expensive — rollouts against an eighth of
sweet's. That is selection bias on exactly the rows that matter.

- **C-2's kill line** reads "…while remaining cheaper **with sidechains included**."
- **C-3's whole thesis** is that delegated work is cheaper, priced honestly.

Neither is computable today. **You have three options; pick one and say which you picked:**

1. **Repair sidechain pricing first** (recover usage for zeroed subagent messages, or price
   them by a documented imputation). This is the highest-value accounting work outstanding and
   it unblocks both gates. It is `$0` — the transcripts already exist.
2. **Run gates 3 and 4 on the main-only column** and state explicitly that the result is
   conservative for native and generous to sweet, so a *pass* is weak evidence and a *fail*
   is strong evidence.
3. **Defer gates 3 and 4**, run 2 / 5 / 6 / 7 / 8 / 9 / 10, and hand the blocker on.

Option 1 is recommended. Do not silently use the null-bearing column.

---

## 4. Per-gate starting notes

Each of these saves you re-deriving something already known.

### 4.1 Gate 1 — C-1, already passed and shipped

Recorded so you do not redo it. `${n}| ` → `${n}<TAB>` in `core/search/search-read.js`.
Census: 15,205 sweet gutter lines → 20 anchor failures, 14 of them off-by-one whitespace;
native's own tab gutter over 19,499 lines → zero. Paid A/B: **15.4% → 0.0%** carried-whitespace
anchors, 52 trials, p = 0.0049. Independent screen: **0 of 184**.

Three traps, all live: do **not** delete the gutter (validated −16% agent-cost lever); do
**not** pad the number (`cat -n` style was separately rejected for miscalibrating edit
wrapping); do **not** re-inline the gutter in the CLI — both call sites now share
`numberCodeLines`, with `stripCodeLineNumbers` as the inverse.

### 4.2 Gate 2 — C-4, whole-file on first touch

**Not run. Probably the best value-per-hour gate here**, because its kill line is sharp and
its evidence is already counted.

Known: collapsible repeat calls are Codex 34, OpenCode 26, Claude 34. Line volume is
**4,723 nibbled versus 5,529 whole-file on Codex** (whole-file worse on raw lines), but
**4,481 versus 4,126 on Claude** (whole-file better, because spans overlap).

The gate is **token-level, not call-level**. Count a later call as removed only when its
content was subsequently used *and* already present in the whole-file response, and charge
the cost of carrying the extra lines through **every later request**. That carrying cost is
what killed the naive estimate. **Kill if replayed billed cost does not fall ≥5% on Codex.**

### 4.3 Gate 3 — C-2, selective superset routing

See §3 first. The Phase-0 work recomputed the *oracle ceiling* — that is **not** the gate. The
gate is a **deployable predictor** evaluated leave-one-task-and-repo-out, using only features
available before the first edit, and never task identity. Recorded ceiling: Codex −11.9%,
OpenCode −16.9%, Claude −6.2%, each 10/17 against native's 9/17. Recompute after D-1/D-2.

### 4.4 Gate 4 — C-3, ephemeral causal coprocessor

See §3 first. The existence proof is one rep: `oceanparcels` Claude native, main `$0.004547`
plus roughly `$0.001071` sidechain = `$0.005618`, still 25.5% below sweet's `$0.007543`, both
solved. One rep is not a harness result. The gate requires ≥15% net saving on exposed cells
and **zero** causal errors on solved controls.

### 4.5 Gate 5 — C-9, structural edit addressing

**Re-census before running this gate.** C-9's evidence base was "the 20 observed failed
edits" — and C-1 has since eliminated the whitespace-carry class entirely (0 of 184 in the
screen). The residual is now only stale-address and wrong-path failures, which may be too few
to clear the ≥90% addressability bar or to justify the build. **Establish the post-C-1 failed-edit
count first.** If it is small, say so and kill the candidate cheaply.

### 4.6 Gate 6 — C-5, dependency/spec corpus audit

**Partially started. Three findings to build on:**

1. **The `pytask` answer is not in the repository, but is in the environment.** Every mention
   of `__tracebackhide__` at base commit `30227332` documents the boolean form only —
   `traceback.py:70` and `:73`, `tests/test_traceback.py:11`, `docs/source/changes.rst:122`.
   No callsite passes an argument. The `exc_info` convention comes from *pytest*, whose
   installed source the slate records as containing
   `tbh(None if self._excinfo is None else self._excinfo)` in `_pytest/_code/code.py`.
   **This is the strongest single piece of evidence for C-5 in the whole corpus.**
2. **The agent already saw `exc_info` in tool output in 100% of rollouts** (4, 4, 5, 3 across
   the four `screen-v3` pytask rollouts, both arms). So the failure is *not* retrieval of what
   exists — it is that the deciding fact lives outside the indexed corpus. Do not confuse the two.
3. **Trigger frequency is low: 4%.** Of 105 sweet transcripts across all three original runs,
   4 name a dependency-shaped external contract *and* an explicit blind spot — `mransan`
   (codex), `pytask` (opencode), `dart-http` and `underscore` (claude). Low, but `pytask` is
   in it, and `pytask` is the task giving native its only task-level lead on two harnesses.

**Blocker:** the pinned image `swerebenchv2/pytask-dev-pytask:210-3022733` is **not on the
box** (`docker images` shows nothing matching; per-task `rmi` GC removes them). Verifying that
pytest's source is inspectable offline at index time needs an image pull first.

### 4.7 Gates 7–10 — C-6, C-7, C-8, R-1

Untouched. Each has its blinding protocol written into `SLATE-A-UBER.md` §5 — **follow it
exactly**. The recurring failure mode is deriving the answer after glimpsing gold and then
calling it a prediction. C-6's `bingo` golden checkout is **not** local (see §6).

---

## 5. Conclusions this session reversed — do not re-derive, do not re-break

Three closed items were reopened under a methodology challenge and **all three flipped**. Two
had already reached the headline.

### 5.1 The `pages` `PreToolUse` hook is architecturally inert

Correlating every hook invocation against every Read outcome across all 32 native sessions:

| | Read calls | needed normalizing | rejected |
|---|---:|---:|---:|
| hook **ran** | 189 | **0** | **0** |
| hook **did not run** | 110 | **110** | **110** |

Complete separation. Claude Code validates tool arguments against the schema **before** the
`PreToolUse` stage, so `pages: ""` (99 calls) and `pages: " "` (11) die before a hook sees
them. **No hook can ever fix this.** Two earlier claims are withdrawn: the "33.9% activation
race" (no race; also a wrong denominator) and "`--settings` refuted" (void — both sides
measured a quantity that was 0). The tax is measured and subtracted instead. The only layer
upstream is the network transport, and `egress-guard.mjs` deliberately never terminates TLS;
that property closed the hole where 13 of native's 16 discordant wins were ground-truth-assisted,
and it is not traded for a cost correction.

### 5.2 Item 4 (`ss-trace` same-file fallback) is closed at both levels

The mechanism was refuted by a full census of all 21 `ss-trace` invocations — cross-file
tracing works, including on TypeScript, and the one `pytask` fallback was **correct** (the
traced symbol is a module-private helper whose only caller genuinely is in the same file).
The *goal* was then closed separately: see §4.6 items 1 and 2.

**Caveat for Slate B:** SLATE-B's D5 claims same-file fallback on Python, Lua and TypeScript,
and names missing callers in `report.py` / `build.py` / `graph.py` carrying
`sys.exc_info()` flows. Those are a **different symbol** from the one the census covered.
**That specific caller-direction question is still open** and is P1's prerequisite.

### 5.3 `ontodev__robot-710` is not a sweet regression

It was published as "the worst cell, a real regression, the single clearest thing to
investigate next". Wrong.

| robot-710 | billed output | billed ÷ retained | cost | flagged |
|---|---:|---:|---:|:--:|
| native rep0 / rep1 | 3,467 / 2,961 | 0.52 / 0.37 | `$0.009564` / `$0.009527` | no |
| **sweet rep0** | **68,842** | **13.29** | **`$0.051330`** | **YES** |
| sweet rep1 | 1,602 | 1.32 | **`$0.007216`** | no |

Sweet's normal behaviour is **24% cheaper than native** there. The entire +247% is one
decoding blow-up. **Check the `degenerate` flag on a row before opening its trace.**

---

## 6. Evidence access

### On the box — the 204-rollout corpus

Base: `/root/sweet-search-private/eval/task-completion-bench/results/<RUN_ID>/`, where
`RUN_ID` ∈ `sb-codex-20260811`, `sb-opencode-20260811`, `sb-claudecode-20260811`.
Each is 17 tasks × 2 arms × 2 reps = 68 rollouts.

Plus `screen-v3-20260812` — the post-fix 16-task claude-code screen, 64 rollouts, which is
where every number in [`RESULTS-2026-08-13.md`](./RESULTS-2026-08-13.md) comes from.

| artifact | path |
|---|---|
| per-rep aggregate | `<RUN_ID>/rows.json` — has `taskId`, `arm`, `rep`, every cost column, `degenerate`, `degeneration` |
| final patches | `<RUN_ID>/preds-<arm>.jsonl` — untruncated `model_patch` |
| claude raw transcripts | `agent-state/<task>-<arm>/claude-home/projects/<slug>/<sessionId>.jsonl` |
| claude sidechains | `.../<sessionId>/subagents/agent-*.jsonl` |
| codex raw | `agent-state/<task>-<arm>/codex-home/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| opencode raw | `agent-state/<task>-<arm>/opencode-retained/session-*/attempt-1.stdout.ndjson` |
| turn prices | `<RUN_ID>/turns/<task>-<arm>.jsonl` |
| grader output | `<RUN_ID>/<arm>/logs/<task>_log.txt` |
| gold / task record | `select/.cache/tasks_full_luna_rotate20.json` — **box only, not local** |

**Never infer absence from `trajectories/`** — results truncate at 600 characters and inputs
at 200. Use `/root/dump-trace.mjs` (local copy beside this file) or read the raw JSONL.

**How to run an analysis without writing to the host:**
```bash
ssh root@167.233.69.121 'node -' < your-script.mjs
```
This is how every census in this session was done. Copying files either direction is also
permitted; only `results/` mutation and pilot launches are forbidden.

### Locally on the Mac

- **76 golden checkouts** in `~/.ss-eval/golden/`, including `pytask-dev__pytask@30227332…`,
  `jashkenas__underscore@4bd6f69b…`, `apple__swift-nio-http2@3d0b3826…`,
  `dart-lang__http@5c75da6e…`, `dotnet__yarp@7c46ec2c…`, `Codeception__CodeceptJS@9ed81962…`,
  `statamic__cms@ce8e8098…`, `redboltz__mqtt_cpp@f48e140b…`.
- **Not local** — `bingo`, `nimble_options`, `bufferline`, `parcels`, `ocaml-protoc`,
  `scoringutils`, `teleport`, `gradethis`, `robot`. Gate 7 (C-6, `bingo`) needs one of these,
  so pull it from the box or re-materialise it.
- `select/.cache/` locally holds only the **held-out** task files. The rotate-20 gold is box-only.
- Indexing a corpus locally works and is fast:
  `SWEET_SEARCH_PROJECT_ROOT=<repo> node core/indexing/index-codebase-v21.js --full --sqlite-fast --verbose --concurrency=1`
  (always `--verbose --concurrency=1`; **never** `--max-old-space-size`).

---

## 7. The cost definition is pre-registered — treat it as binding

Full text in [`RESULTS-2026-08-13.md`](./RESULTS-2026-08-13.md) §9. It exists because one
screen's headline moved **−15.85% → −25.46% → −19.51%** with no new rollouts, purely by
re-choosing how to count. Summary:

1. **Cost column: `idealCostMainOnlyUsd`** — the only column non-null at 32/32 in both arms.
   **Never sum a column across arms without checking its null rate in both.**
2. **The `pages` tax is `$0.035160`**, one extra assistant round trip per rejection, removed
   from native only. Charging the issuing turn and charging the retry turn agree to 0.2%;
   charging both double-counts. The older `$0.054326` is retired.
3. **Degenerate rollouts are RETRIED — never priced, never excluded.** On `screen-v3` the
   detector fired 5 times, **4 native and 1 sweet**, and that split alone is worth **15.6
   points** of headline.
4. **No cost figure ships as a single number** without its sensitivity beside it.

Current honest position: **−19.51% with degenerates priced, −3.96% with them excluded,
projected −13.41% under the retry rule.** Solve **tied 9/16**. Tool calls **−38.3%**, which is
the only efficiency claim needing no accounting caveat.

---

## 8. Traps

1. **One attempt is not a refutation.** Three conclusions flipped this session on a second
   look. Before writing "refuted", ask: did I try variants, do I understand *why* it failed,
   and did I test the strongest competing hypothesis?
2. **Gate 0 before any spend.** A `--settings` change was deployed with no exposure proof,
   judged on one run, and written off — and the diagnosis was wrong. Cost `$0.051` and a wrong
   entry in the source comments. The correct answer took twenty minutes and `$0`.
3. **Do not soften a gate after seeing its result.** Candidates that miss their pre-registered
   bar go to the discard log.
4. **Check the `degenerate` flag before reading a cost outlier's trace.** See §5.3.
5. **Selection bias hides in null columns.** It was caught twice this session in two different
   columns. Count non-null rows per arm before summing anything.
6. **Call-count reduction is a proxy, not a cost result.** Replay billed token mass.
7. **Shared FRAME text has zero differential.** A mechanism whose advantage reaches both arms
   is not a sweet win.
8. **Do not add candidate ceilings together.** §7 of `SLATE-A-UBER.md` lists the overlaps.

---

## 9. Deliverable

`eval/task-completion-bench/handoffs/improve/PHASE-1-RESULTS.md`, containing per gate:

- the pre-registered bar, quoted from `SLATE-A-UBER.md` **before** you report the result;
- what you actually measured, with the script or command that produced it;
- **PASS / FAIL / BLOCKED**, and for FAIL the specific number that missed the bar;
- for BLOCKED, exactly what unblocks it.

Then a short section naming which candidates survive into Phase 2, and which go to the discard
log with their killing fact — so a later session cannot regenerate them under a new name.

**Do not implement any surviving candidate in this session.** Phase 2 is a separate decision,
and Slate B's W0 gates come before the cohort run either way.
