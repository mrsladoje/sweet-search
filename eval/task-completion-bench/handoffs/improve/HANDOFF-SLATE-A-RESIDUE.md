# HANDOFF — the Slate A residue, run properly this time

**Written:** 2026-08-17. **Spend authorised:** up to roughly `$15` of model rollouts, itemised in §3.
**Deliverable:** `SLATE-A-RESIDUE-RESULTS.md` beside this file.
**Method:** the `/microsmoke` skill, invoked for real, on every paid step.

**Do not edit `SLATE-A-UBER.md` or `SLATE-B-UBER.md`.** They are the audit trail. Your findings go in
your own results document.

**Slate B is not your scope.** It is the session after yours.

Read §0 before anything else. It invalidates a method that produced six verdicts in this programme.

---

## 0. The lesson that reopens closed work

**On 2026-08-14 a replay-derived prediction was checked against a live A/B for the first time in this
programme. It inverted on all three harnesses.**

C-4 (whole-file-on-first-touch) was replayed over 102 rollouts, reproducing every harness's recorded
arm cost to 100.0%, and predicted **−1.60 / −2.08 / −4.72%**. Built, deployed and run as a paired
3-rep A/B on codex / opencode / claude-code, it measured **+4.78 / +19.79 / +11.72%**. Excluding the
one task that never solves, claude-code was **+41.3%**.

**The reason is now understood and it generalises.** A replay holds the agent's trajectory FIXED and
re-counts tokens along it. Live, the trajectory changes: an agent handed more context does **more
work**, not less. Claude-code made **105 edits with the gate on against 79 off**, and 23.6 calls
against 20.5. Every behavioural claim the replay rested on held — whole-file delivery went ~40% →
~69% on all three, re-reads fell 66% on codex and 43% on opencode — and the cost arithmetic still
inverted.

**So: a fixed-trajectory replay predicts BEHAVIOUR well and COST badly.** Use it to choose what to
build. Never use it to decide whether something ships.

### 0.1 Which Slate A verdicts this touches

| verdict | rests on | safe? |
|---|---|---|
| C-2 selective superset | a recorded solve loss on two harnesses | **safe** — observed fact |
| C-9 structural editing | a count of actual failed edits | **safe** — observed fact |
| C-1 anchor rendering | a paid A/B plus a 184-trial screen | **safe** — live |
| **C-3 causal coprocessor** | **a fixed-trajectory replay** | **SUSPECT — §3.A** |
| **R-1 turn-0 dossier** | **a fixed-trajectory replay** | **SUSPECT — §3.B** |

C-3 is the weakest of the two and is your first job. It is a context **reset** — the replay deletes
context and re-prices the same turn sequence. An agent whose context was just cut does not continue
the same trajectory. That is the single case where the fixed-trajectory assumption is most obviously
false, and it was killed at `+2.7% to +7.5%`, a margin the instrument cannot resolve anyway.

---

## 1. Environment — every trap that cost this session real time

Work through this list before you run anything. Each line below was a failure, not a precaution.

### 1.1 The three harness invocations, exactly

```bash
# shared
cd /root/sweet-search-private
source /root/.openrouter.env
export PATH=/root/.local/bin:/usr/bin:$PATH          # the `claude` CLI lives here, NOT on the default PATH
export DOCKER_HOST=unix:///var/run/docker.sock
export SR_EVAL_DIR=/root/swe-rebench-tools/SWE-rebench-V2
export TASKS_FILE=/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_luna_rotate20.json
export EGRESS_ALLOW=chatgpt.com,openai.com,openrouter.ai
export MODEL=openai/gpt-5.6-luna                      # FULL string; the bare id throws at the pricing guard
export REASONING=medium                               # NOT "standard" — the Responses API rejects it
export MAX_TOOL_CALLS=60 AGENT_TIMEOUT_MS=1800000
export CONCURRENCY=3                                  # fine on this box; see the /microsmoke skill

# codex — runs on the ChatGPT-Max subscription, flat rate
HARNESS=codex PROVIDER=openai CODEX_SUBSCRIPTION=1 ...

# opencode
HARNESS=opencode PROVIDER=openrouter ...

# claude-code  — the value is `claudecode`, ONE WORD
HARNESS=claudecode PROVIDER=openrouter ...
```

**`HARNESS=claude-code` is silently wrong.** `run-pilot.mjs:510` matches the exact string
`claudecode`; anything else falls through to the generic bare-API runner at line 532 and you measure
a completely different agent, with no error. A whole 6-cell run was lost to this. **Assert the
`harness` field in `rows.json` matches what you intended before reading any number.**

### 1.2 The environment ledger gate

`run-pilot.mjs` refuses to launch without a fresh gold-FULL verdict per task, and the harness has
changed since every existing ledger. Sweep first — it costs `$0` in model spend, ~25 minutes of
docker:

```bash
cat > /tmp/ids.jsonl <<EOF
{"instance_id":"<task-1>"}
...
EOF
node harness/env-ledger-sweep.mjs \
  --tasks select/.cache/tasks_full_luna_rotate20.json \
  --ids /tmp/ids.jsonl \
  --out results/<your-ledger>-$(date +%Y%m%d) --batch 3 --max-workers 2
export ENV_LEDGER=/root/.../results/<your-ledger>-YYYYMMDD/ledger.jsonl
```

A previous sweep is at `results/c4-ledger-20260814/ledger.jsonl` and covers
`dart-lang__http-1114`, `rstudio-education__gradethis-161`, `statamic__cms-9029`,
`redboltz__mqtt_cpp-466`, `epiforecasts__scoringutils-229` — reuse it if your slate is those five.

### 1.3 Always preflight at your intended concurrency, `$0`

```bash
PREFLIGHT_ONLY=1 CONCURRENCY=3 INSTANCES=<slate> ARMS=sweet HARNESS=<h> PROVIDER=<p> \
  node eval/task-completion-bench/harness/run-pilot.mjs
```

### 1.4 Exposure verification is NOT uniform across harnesses

- **codex** retains `agent-state/<task>-<arm>/codex-home/sessions/**/*.jsonl` — one file per rep.
- **opencode** retains `opencode-retained/*/attempt-1.stdout.ndjson` — it copies out deliberately.
- **claude-code retains NOTHING under isolation.** `claude-home` lives inside the jail's mount
  namespace and dies with it; its `trajectories/` carry no tool content either.

**If your lever needs claude-code exposure proof, add a copy-out before `teardownRunner`
(`claude-code-task-runner.mjs:435`), mirroring opencode's `opencode-retained/`.** Without it a
claude-code cell is unverifiable and, under the `/microsmoke` rule, unreadable — that is the
accidental-A/A shape.

### 1.5 Trace-parsing traps that each produced a wrong number

1. **`ss-read <file> <start>` is a SINGLE LINE**, not start-to-EOF (`_ss-helpers.mjs:523`). Reading
   it as start-to-EOF on 176 of 1000 recorded calls turned a real `−1.60%` into a spurious `−3.30%`.
2. **Reads chain with `&&`.** A regex like `/\bss-read\b([^\n|;&]*)/` **stops at `&`** and misses 55
   of 157 codex reads — 40 of 102 commands chain two or more.
3. **Pick the transcript whose replayed cost matches the row**, not the longest. Longest inflates the
   baseline 7–18% and pulls in retried sessions.
4. **codex tool output is an ARRAY** of `{type:'input_text', text}`, not a string. Pair calls to
   outputs by `call_id`.
5. **Reps share one `agent-state/<task>-<arm>` directory.** Iterate every session file or you analyse
   one rep in three.
6. **Never infer absence from `trajectories/`** — results truncate at 600 chars, inputs at 200.
7. **`report.json` is not authoritative. Score from `rows.json` `resolved`.**
8. **Check the `degenerate` flag before opening a cost outlier.**
9. **NEVER pool runs across a shipped fix.** `sb-claudecode-20260811` is **pre**-C-1 (15,205 `N| `
   gutter lines); `screen-v3-20260812` is **post**-C-1 (12,518 `N⇥`). Pooling them once invented a
   lever that was really an already-shipped win. **A census must state which build each run used.**

### 1.6 Box

`ssh root@167.233.69.121`. 8 CPUs, ~30 GB RAM, ~55 GB free. Another agent may use it. Do not launch
two `run-pilot` processes at once (git dubious-ownership bug). Restore anything you deploy — take a
backup first, as `/root/c4-deploy-backup-20260814/` did.

**The box tree and `HEAD` have diverged in BOTH directions.** It has daemon-cap work `HEAD` lacks;
`HEAD` has maintainer-supervision work it lacks. **Diff before you copy; patch surgically, never
overwrite.**

---

## 2. The instrument you already have

### 2.1 `/microsmoke` — invoke it, do not paraphrase it

Gate 0 `$0` exposure → Gate 1 diagnostics + controls → Gate 2 run → Gate 3 read solve flips not
aggregate cost → Gate 4 rotate → Gate 5 promote. The skill was corrected on 2026-08-14: concurrency
2–3 is fine on the Linux box, and it now records what actually bounds it.

### 2.2 The fixed control set

Five tasks resolve **2/2 in both arms on all three harnesses**:

```
epiforecasts__scoringutils-229   oceanparcels__parcels-617   ontodev__robot-710
redboltz__mqtt_cpp-466           statamic__cms-9029
```

Breaking one is a kill. **Note `ontodev__robot-710` is also the +257% cost outlier** — include it
only when your lever plausibly touches it.

**The blind spot, sized:** tasks that solve 1/2 are invisible to a non-inferiority check — 1 on
codex, 1 on opencode, **4 on claude-code**. On Claude that tail is nearly as large as the control
set, so a Claude-only solve lever is close to unmeasurable this way. Say so rather than imply
coverage you do not have.

### 2.3 The five-layer trace analyser — `phase1-scripts/d12-trace-behaviour-ab.mjs`

This is the thing that made the C-4 result legible, and it is the primary instrument for everything
below. It measures per tool call, so it has 10–100× more observations than the cost delta.

```
Layer 1 DELIVERY  did the tool output change?            <- if flat, the cell is INERT, stop
Layer 2 MECHANISM did the targeted behaviour change?     <- the causal claim
Layer 3 THRASH    read->read chains vs read->edit
Layer 4 EDITS     do edits land first time?
Layer 5 SHAPE     calls to first edit, total calls, tool mix
```

```bash
ssh root@167.233.69.121 'node -' < phase1-scripts/d12-trace-behaviour-ab.mjs <run-prefix> codex,opencode,claudecode
```

**Adapt Layers 1–2 to your lever.** For C-3 the mechanism layer is "does the agent re-derive facts it
already had before the reset"; for R-1 it is "does the agent skip its own localisation turns".

### 2.4 The other scripts

`d1` census + control set · `d2` C-4 mechanism census · `d3` proximal tokens + the naive-metric trap ·
`d4` post-fix failed-edit census with a four-shape gutter detector · `d5` anchor-failure split ·
`d6` marginal-cost pricing · `d7` whitespace origin · `d8` raw rendering · `d9` response surface ·
`d10` bootstrap + argmax identification · `d11` three-harness replay · `d12` trace A/B.
Reuse them. Read `phase1-scripts/README.md`.

---

## 3. The work, in order

Each item states the lever, the variations you must try before giving up, the pre-registered
proximal metric, and the kill line. **Filling in the six-step block from
`HANDOFF-EVIDENCE-DOCTRINE.md` §3.1 BEFORE each run is mandatory, and this time it is genuinely
pre-registration rather than the retrospective version the last session had to admit to.**

### A. C-3 — context reset, re-opened as a LIVE A/B. Do this first. ~`$3`

**Why.** Killed at `+2.7% to +7.5%` on solved rollouts by exactly the method §0 discredits, and it is
the lever whose trajectory assumption is most obviously violated — you cannot replay what an agent
does after its context is cut.

**The mechanism.** After the agent has localised the problem, hand a fresh session a typed handoff —
causal chain, source anchors, live uncertainties, a falsifying command, an edit constraint — instead
of the accumulated context.

**Do NOT stop at one shape. Sweep the shape of the mechanism, not one parameter.** At minimum:

| variation | what it tests |
|---|---|
| V1 reset at first edit | the original shape |
| V2 reset at first *successful* test run | later trigger, more evidence carried |
| V3 reset only when context exceeds N tokens | makes it a tail-lever, not a universal one |
| V4 handoff content: minimal / medium / full | the handoff size is the real parameter |
| V5 no reset, handoff appended | isolates "structured summary" from "context deletion" |

**V5 is the control that matters.** If appending the handoff without deleting anything captures the
benefit, the lever is a summary format, not a topology change, and it is far cheaper to build.

**Pre-register:** proximal metric = **count of facts re-derived after the reset that were present
before it** (measure from the trace: repeated searches/reads for the same symbol either side of the
boundary). Direction: down. **Cost is read but never judged** — the instrument cannot resolve under
about 10%.

**Kill line:** any control task drops below 2/2, **or** the re-derivation count does not fall on any
variation, **or** V5 matches the best reset variation (then it is a prompt/format change, and it goes
to Slate B's surface, not here).

**Use `breakPricedCostUsd`, not `idealCostUsd`.** Deleting or reordering context mid-conversation
invalidates the prompt-cache prefix; `idealCost` charges the re-send at the cache rate no matter what
happened and **scored a known-losing eviction lever at +7.7% saved when it actually lost 12.3%.**
This is written at `harness/ideal-cost.mjs:62`. **This single line is why C-3's replay may have been
wrong in the direction that matters — check whether the original gate used the right column.**

### B. R-1 — turn-0 dossier, re-checked. ~`$2`

**Why.** Also killed on a replay (`+0.41% to +1.82%`). Weaker case than C-3: it *adds* context, and
C-4 showed live that added context makes agents do more work — so its recorded loss probably
understates the damage. **Check it cheaply and expect to confirm the kill.**

**Variations:** dossier size (repo map only / map + top-5 files / map + files + symbols); and
delivery (tool-result-shaped vs system-prompt-shaped — the first is billed once and cached, the
second is re-sent every turn).

**Pre-register:** proximal metric = **number of retrieval calls before the first edit**. Direction:
down. **Kill line:** first-edit call count does not fall, or total billed input rises on every
variation.

**If it dies again, say so in one paragraph and move on.** Do not spend more than `$2` here.

### C. D-4 — the `pages` adapter is NOT fixed, and needs web research. `$0` to diagnose

**The state.** `installClaudeReadPagesNormalizer` is installed and **inert**.
`claude-code-task-runner.mjs:67-68` records why: Claude Code validates the tool schema **before** the
PreToolUse stage, so `pages: ""` (99 calls) and `pages: " "` (11 calls) die before a hook can observe
them. **110 rejected calls, ~7% of native's Claude cost, still inflating native.**

**This is the item most likely to be solved by reading rather than measuring.** §4 has the research
questions. Candidate fixes to evaluate:

1. a `tools.Read` **description or input-schema override** if the CLI exposes one;
2. a **settings.json `permissions` / tool-config** route that constrains the parameter;
3. a **newer Claude Code version** where the parameter or validation order changed — the box has
   2.1.218;
4. accept it is unfixable and **quantify + disclose** it as a standing bracket, as the run-directory
   tax already is.

**Whatever you conclude, it is a validity repair for the NATIVE arm and must never be booked as a
sweet win.**

### D. C-6 round 3 — a separate, blinded session. `$0`

**You cannot run this yourself.** This document, and everything in `handoffs/improve/`, names
answers.

The exercise is written, the narrowed claim is frozen and hashed
(`33c9e3aa3c161c9703322abe712a8586c5c4cfa28bfe86f1013eadb8200377d6`), the slate is drawn and sealed,
and it has **never been derived**. It is the only surviving Slate A candidate with a solve path.

**Your job is to launch it, not to do it:** start a fresh session, give it
`eval/task-completion-bench/handoffs/blinded/round3/HANDOFF-BLINDED-ROUND-3.md` and **nothing else**,
and score the reveal when it returns.

**Before handing it over, grep `MEMORY.md` and the brief itself for every task ID, repository name
and symbol in the exercise.** Blinding has broken three times already: a plan printing its own answer
key, `MEMORY.md`'s auto-loaded index naming a task's answer, and a brief quoting the deciding fact in
its own body. Assume a fourth channel exists.

### E. C-6's conversion screen — gated on D passing. ~`$1.25`

Every gate so far asks whether the obligation graph can be **derived**. **None asks whether handing an
agent a correct graph changes its patch.** That is the product question.

Paired design, 14 tasks × 2 arms × 2 reps = 56 rollouts, roughly `$1.25` on Luna. Graphs for 14 tasks
can be derived by hand at `$0`. **Pre-register the effect size and declare in advance that a null at
n=14 means "not detectable here", not "no effect".** Only 14 of 179 eligible tasks author a new source
module — about 8% addressable.

**Do not run this if round 3 fails.** Say the capability does not survive.

### F. Phase 4 — scope it, do not build it. `$0`

A fresh stratified task set was always Slate A's endpoint. **It now has a second and stronger reason:
§0 shows this corpus cannot validate a replay-derived prediction, so a live-validated task set is the
only way to check any of this.**

Deliver a **specification**, not a corpus: strata, target counts, a power analysis for the effect
sizes that actually matter (~5% cost, ~1 task solve), the preflight gate every task must pass, and
the seed/split policy. The development pool has **three new-module tasks left and round 3 spends all
three** — that constraint belongs in the spec.

### G. Two loose correctness items. `$0`

1. **`harness/golden-build.mjs` does not check that its `git checkout <base_commit>` succeeded.** When
   the commit is unreachable the checkout fails, the script proceeds, and the fresh-init captures the
   repository's **default branch** — a post-fix tree under a directory named for the base commit. A
   blinded gate handed that tree reads the answer out of its own working directory. **Every golden
   built before 2026-08-13 is unverified.** Add the `git rev-parse HEAD` check and a verification
   sweep.
2. **D-6 row-level telemetry.** The runner now forces a terminal test verdict, but no row column
   records *launched* versus *verdict delivered*. Add it so "the agent claimed success without a
   verdict" is a countable field rather than a transcript search.

---

## 4. Web research — specific questions, not general reading

**Do this before the paid runs on C and A.** Previous sessions looped on problems the documentation
answers. The standing rule is: **after 3 failed attempts, search the web.** Apply it earlier here.

**For D-4 (highest value):**
- Does Claude Code expose per-tool **input-schema or description overrides** via `settings.json`,
  `.claude/`, or a plugin/MCP surface? Search the Claude Code docs and changelog.
- **When was `pages` added to the `Read` tool, and did its validation order change after 2.1.218?**
  Check the Claude Code release notes for tool-schema changes.
- Is there a known issue for tool-input validation running before `PreToolUse`? The runner comment
  cites **Claude Code issue 36654** for a related gutter/padding problem — start there and look for
  siblings.
- The `claude-code-guide` agent type is available in this session and is the fastest route to
  authoritative answers about Claude Code hooks, settings and tool config. **Use it.**

**For A (C-3):**
- Prompt-cache **prefix invalidation** semantics for the providers in play. The whole C-3 economics
  question is whether a mid-conversation reset re-pays full input rate on the surviving suffix.
  Confirm against current provider documentation rather than the note at `ideal-cost.mjs:62`.
- Published work on **context compaction / handoff summarisation in agent loops** — whether anyone
  has measured re-derivation after a reset. This is a real research area; do not reinvent it.

**For F:** current practice on **power analysis for paired agent benchmarks** — how many tasks are
needed to detect a 5% cost difference given per-task cost heterogeneity of the kind recorded here
(one task at +257%).

Cite what you find in the results document with URLs.

---

## 5. Do not give up early

This is explicit because the last three sessions each killed something on one shape and had to be
corrected later.

- **Sweep the shape of a mechanism, not one parameter of it.** A `$0` second pass once reversed a
  verdict outright and restated two killing facts. Before you write DEAD, ask whether you tested the
  capability or one way of expressing it.
- **"Neutral on rotation" is NOT dead.** A lever that moves its proximal metric cleanly and merely
  fails to reproduce a cost win is *unproven*, not refuted. Keep the mechanism; re-smoke with more
  reps or a matched cap.
- **An inert cell is not a negative result.** If Layer 1 does not move, you measured nothing. Fix the
  trigger and re-run; do not record a null.
- **A confounded run is not evidence.** If a cap mismatched, a harness value was wrong, or exposure
  is unverifiable, say so in the log and trust only the uncontaminated dimension — usually solve
  flips.
- **When a result contradicts a prediction, find the mechanism before believing either.** The C-4
  inversion only became useful once the trace analysis showed *why* — the agent does more work with
  more context. A bare "it didn't work" would have been worth much less.

---

## 6. Standing constraints

- **Solve is the veto.** A saving that costs a reliable solve is dead regardless of size.
- **A lever is kept if it genuinely improves EITHER axis — 1% counts**, including a 1% improvement in
  the chance of a solve. "Does not do both" is not a kill. The 15% bar lives on the portfolio and the
  both-axes requirement on the publication claim.
- **Never sum ceilings.** A portfolio number comes from a joint replay of what is actually built.
- **HO2 is frozen.** Never run it, never inspect it. DEV-RET only.
- **Never use `ss-*` to develop sweet-search.** Native file tools only. Running `ss-*` as the system
  under test against a non-sweet-search corpus, with scripted assertions, is testing and is fine.
- **Any new ranking signal that detects structured-query patterns gates on `opts._isAgentFormat`.**
  Ungating has cost held-out MRR twice, once by 27.57 points.
- **No new tools.** The project owner ruled on 2026-08-14: improvements to existing tools only. The
  two largest wins in this whole programme were an accounting repair and a rendering fix, both to
  things that already existed.
- **Never route the Sol model through OpenRouter** — roughly 50× subscription cost.
- **The working tree is dirty** — roughly 30 files belong to concurrent daemon and maintainer work.
  Do not revert, stash or clean. To commit a file that mixes your work with theirs, stage by hunk:
  `git diff -U3 <file>`, filter, `git apply --cached`. Zero-context (`-U0 --unidiff-zero`) mis-places
  hunks and has done so in this repository.
- **Git:** solo project, commit direct to `main`, no feature branches, and **only when asked**.

---

## 7. Deliverable

`SLATE-A-RESIDUE-RESULTS.md`, containing:

1. **Per lever: the six-step block, filled in BEFORE the run**, then the census and tier, the proximal
   result, the conversion arithmetic, and the control-set result.
2. **Every variation you tried**, including the ones that did nothing. A lever killed on one shape is
   not killed.
3. **A verdict on C-3 and R-1** that explicitly states whether the replay-era kill survives.
4. **D-4: a fix, or a costed statement of why it cannot be fixed**, with the research you did.
5. **Round 3's score**, from the sealed reveal, with the leak check recorded.
6. **The Phase 4 specification.**
7. **Total spend**, itemised per cell, against the `$15` authorisation.
8. **What you did not do**, and where a number is softer than it looks. A partial result reported as
   clean is worse than an unrun one, because it looks like evidence and cannot be told apart later.

**Report faithfully.** This programme's most valuable results have been kills and corrections — a
lever that dies with a mechanism attached is worth more than one that ships on a number nobody
checked.
