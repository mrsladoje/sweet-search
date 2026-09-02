# Slate C — candidates, lens "harness-adaptive rendering" (2026-09-02)

## 0. Verdict

**Each of the three harnesses destroys an over-long tool result by a different rule, and
sweet renders the same output to all three.** The rules are now measured, not assumed:
codex keeps a fixed **first 5,190 characters plus last 5,000 characters** and deletes the
middle free of charge; claude-code deletes the **whole** result above about 30,000
characters and hands back a 2,000-character stub with a file path that **no agent ever
opened, 0 of 66 times, in either arm**; opencode head-truncates and writes the rest to a
file, and it almost never fires on `ss-*`. Sweet is already 18.2% leaner than native in
delivered tool bytes on codex and 14.5% leaner on opencode, but **17.1% heavier on the
claude-code main thread**, which is the harness with the highest re-send multiplier.

Four candidates survive. The strongest is a **codex-only output layout** that puts the
complete top-ranked body inside the surviving head and the manifest inside the surviving
tail, because the deleted middle is free and today the cut lands inside the top-1 body in
25 of 33 cut packs. The other three are a **precisely gated claude-code read-before-edit
hint** built on a detection channel nobody has used (the live session transcript), a
**claude-code overflow guard**, and an **honest rendered-size budget** without which no
per-harness budget can be built.

Two families in this lens are dead and I killed them with `$0` screens of my own, not with
argument. **The per-harness delimiter is settled: keep `N<TAB>` everywhere** (register C3
DEAD at n=66, Fisher p >= 0.72; owner decision 2026-08-28). And a claude-code payload trim
fails on solve risk: clamping the pack's rank tail would remove the first sight of the file
the agent went on to edit in **14 of 68 cases (20.6%)**.

Every number below is tagged `[M]` measured, `[C]` read from code, `[W]` web, `[I]` inferred.
Scripts live on the evidence box under `/tmp/wf-slatec/harness-adaptive-rendering/`; nothing
was written under `results/`.

---

## 1. The three overflow rules, measured

### 1.1 Codex: a deterministic head-and-tail window, middle deleted free

`[M]` `/tmp/wf-slatec/harness-adaptive-rendering/codex-cut.py` over every
`function_call_output` in `fp-codex-tab-20260826` (132 rollout files, 66 per arm). 105
truncated sweet envelopes carried an `ss-*` command; 238 truncated native envelopes. That
reproduces `12-truncation-census.md` and `forensics/codex-cap-x-ss.md` F1 exactly, so the
instrument is sound.

New fact — the cut geometry is a constant:

| quantity | median | p10 | p90 | max |
|---|---:|---:|---:|---:|
| characters kept before the marker | 5,190 | 5,178 | 5,191 | 5,191 |
| characters kept after the marker | 4,997 | 4,957 | 5,001 | 5,001 |
| characters actually delivered | 10,203 | 10,156 | 10,207 | 10,208 |

`[M]` So codex delivers a fixed window of about 10,200 characters (about 2,550 tokens),
whatever the original size. Deleted mass: 108,679 tokens over 105 sweet cuts = **1,647
tokens per sweet rollout**, against 610,123 tokens over 238 native cuts = **9,244 tokens per
native rollout**. Those tokens never reach the model and are never billed `[M]`, which is
the same fact register G15 recorded as "the cap deletes 35.1% of native's tool tokens".

### 1.2 Claude-code: the whole result is deleted, and nobody ever reads it back

`[C]` Claude Code 2.1.218 replaces an over-size tool result with
`<persisted-output>Output too large (N). Full output saved to: <path>. Preview (first
2.0KB): ...</persisted-output>`. `[M]` `cc-persist2.py` over four claude-code runs:

| run | persisted results, native | persisted, sweet | of sweet, produced by an `ss-*` command |
|---|---:|---:|---:|
| `fp-claudecode-tab-20260826` | 34 | 16 | **4** |
| `fp-claudecode-none-20260826` | 0 | 12 | 10 |
| `fp-claudecode-pipe-20260826` | 0 | 4 | 2 |
| `rb-claudecode-20260824` | 26 | 2 | 2 |

`[M]` The smallest persisted result was 29.5 KB and the largest `ss-*` result delivered
inline was 28,896 characters, so on this build the threshold sits at about **30,000
characters** — `BASH_MAX_OUTPUT_LENGTH` itself, not the 32-50 KB band inferred from a
2.1.257 session in `research/anthropic-model-product-path.md` section 3.2. That report's
mechanism is confirmed; its threshold is corrected for the benchmark build.

`[M]` **Recovery is zero.** `cc-recover.py` found **0 tool-use inputs referencing a
`tool-results/` path** across all four runs, in either arm. The whole result is simply lost.

`[M]` Native's 34 deletions in the TAB run came from 26 `grep`, 3 `find`, 2 `pwd`, 2 `git`
and 1 `rg` call. Native cannot shape those outputs; sweet can shape its own.

The failure compounds. In `fp-claudecode-none-20260826`, task `bfgroup__b2-259`, sweet, run
directory `r2-38`, subagent session `26998406-a8e3-4e66-b48c-5a629598a91a`, seven
consecutive `ss-find` results were deleted. The agent answered each deletion by **widening**:
`-k 200` then `-k 200 --full` then `-k 300 --xl` then `-k 300 --xl` then `-k 500 --full`
then `-k 500 --full`, each one deleted in turn, and then reported to its parent that
"`ss-*` searches find only tests, no configure module" `[M cc-after.py]`. A size failure was
read as an absence.

`[M]` The surviving 2,000-character preview does contain sweet's own header, for example
`# ss-find: ColGrep 200 for ".jam" /jam$|\.jam/ budget=8000 used=1726 subMode=agent_full`
— so the head of an `ss-*` result is the one part that always reaches the model.

### 1.3 Opencode: head truncation to a file, and it barely touches `ss-*`

`[C]` opencode 1.18.4 carries a `Truncate.limits` service with `tool_output.max_lines` and
`tool_output.max_bytes`, and emits `... output truncated; full content saved to <path> ...`;
its Bash description tells the model to Read that file. `[M]` `oc-trunc2.py` over the
retained NDJSON traces:

| arm | truncated results |
|---|---|
| native `read` / `grep` / `glob` | 295 / 61 / 40 = **396 of 993 structured retrieval results (40%)** |
| sweet `ss-*` through Bash | **4 of 1,100** (all `ss-read dist/index.js` on `aws-actions__configure-aws-credentials-42`, `rp-oc-tab-20260827`) |

`[M]` Largest untruncated `ss-*` result 25,379 characters (`fp-opencode-tab`), 26,208
(`none`). So opencode's ceiling is far above sweet's working range.

### 1.4 The asymmetry this creates

`[M]` Delivered tool-result bytes per rollout, main thread only, same definition on all
three harnesses (`bytes-per-rollout.py`, plus the codex pass in the same file):

| harness | native | sweet | sweet vs native |
|---|---:|---:|---:|
| codex | 70,128 | 57,344 | **−18.2%** |
| opencode | 72,133 | 61,705 | **−14.5%** |
| claude-code (main thread) | 60,918 | 71,305 | **+17.1%** |

The codex figure reproduces the brief's "sweet returns 18% fewer total tool bytes", which
validates the instrument on a known quantity.

`[I]` The reason is that on codex and opencode the harness enforces byte discipline on
native's own tools — a hard 10,200-character window, and a 40% truncation rate on
opencode's `read`/`grep`/`glob` — while on claude-code the harness does not: native `Read`
is model-windowed and averages 2,990 bytes with a median of 1,757, and the Bash ceiling sits
at 30,000. Sweet uses one payload policy on all three.

Per-tool, claude-code main thread, per rollout (n=66) `[M]`:

| arm | tool | calls | bytes | mean bytes/call |
|---|---|---:|---:|---:|
| native | `Read` | 10.74 | 32,115 | 2,990 |
| native | Bash (grep/cat/sed) | 8.85 | 25,810 | 2,917 |
| sweet | `ss-read` | 4.62 | 25,235 | 5,461 |
| sweet | `ss-search` | 2.70 | 17,830 | 6,611 |
| sweet | Bash (native fallback) | 4.41 | 13,857 | 3,143 |
| sweet | `ss-find` | 0.86 | 5,935 | 6,872 |
| sweet | `ss-grep` | 4.48 | 3,911 | 872 |

---

## 2. What I killed at `$0` (do not re-propose)

### 2.1 The delimiter — settled, restated as required

`N<TAB>` stays on all three harnesses. Register C3 is DEAD: at n=66 per cell all three forms
land within 3 of 66 rollouts on every harness, every harness ranks them differently, and
every pairwise Fisher test gives p >= 0.72 against a +/-6 bar. The owner decided this on
2026-08-28. **The per-harness delimiter is not a lever and I propose nothing that touches it.**

Register C5 (new gutter designs, including indent-aware) is PARKED, and its revival
condition is claude-code's tab-separator gate flipping on by default. `[C]`
`research/harness-changelogs.md` F7 read the current binary: `tengu_tab_read_sep` still
defaults to false in 2.1.218 and 2.1.258. The condition has not fired. Not proposed.

### 2.2 A claude-code payload trim — fails solve risk at `$0`

The +17.1% byte excess is real, and the obvious lever is to trim it. Three of my own `$0`
screens say do not.

`[M]` `anchor-pos.py`, `fp-claudecode-tab-20260826`, sweet, main thread: for 116 `Edit`
calls I located the anchor line inside the `ss-read` span that had delivered it. The anchor
sits at median position **0.487** of the delivered span; **45.7% of anchors are past the
half-way point** and **16.4% are in the last quarter**; the median delivered span is 90
lines. Ranges are the agent's own request, and cutting their tail removes the anchor
outright in nearly half of cases.

`[M]` `pack-bytes-by-rank.py` and `pack-lifetime2.py`, same cell, 247 packs, 3,370 blocks.
A lower-rank block counts as used only if its file is later an `Edit`/`Read` target or is
named in a later command:

| rank | blocks | share of pack bytes | used later |
|---|---:|---:|---:|
| 1 | 242 | 47.5% | 37.6% |
| 2 | 231 | 15.4% | 35.1% |
| 3 | 226 | 9.5% | 31.4% |
| 4 | 223 | 2.0% | 25.1% |
| 5 | 215 | 2.0% | 19.5% |
| 6+ | 2,233 | 23.6% | 12.4% |

Register B13 (payload budgeting by lifetime) is PARKED with exactly this `$0` screen unrun
and a kill line of 20%. Counted by blocks it passes (rank >= 2 used 16.8%). Counted by
**bytes** it fails: 72.4% of the pack mass is in ranks 1-3, which are used 31-38% of the
time, and the ranks that are rarely used are already pointer-sized (mean 169 bytes at rank
6+). There is no cheap mass to demote.

`[M]` `rank-of-edited.py`: of 92 files the sweet arm edited on the claude-code main thread,
68 had appeared in a pack, and **14 of those 68 (20.6%) first appeared at rank 6 or lower**
(`aio-libs__aiohttp-8038` client.py at rank 7 and 9, `hotmeteor__spectator-181`
ResponseValidator.php at rank 11 and 13, `protofire__solhint-224` index.js at rank 13, and
nine more). Clamping `-k` on claude-code would have deleted the first sight of the edited
file in one case in five. Solve is the veto. **Dead.**

### 2.3 Turning the parked no-range read window on for claude-code — no population

`[C]` `_ss-helpers.mjs` carries `READ_WINDOW` (`SS_READ_WINDOW`), a default cap for
`ss-read` with no range, parked default-OFF since 2026-07-09 with the note "the mechanism
works (−39% delivered read tokens) and is accuracy-safe" but "the pool is too small". A
harness-conditioned default-on looked attractive. `[M]` `noRange.py`: whole-file no-range
`ss-read` results on the claude-code main thread number **0 of 448** in the TAB run and 5 of
489 and 5 of 441 in the other two forms, all on files under 105 lines. The exposure is
essentially zero on the main thread; the two large whole-file reads I found were inside
subagents. **Not worth a harness gate.**

### 2.4 A codex output *budget* — already priced dead

Register C9 is PARKED and `forensics/codex-cap-x-ss.md` closed it: fitting `ss-*` under
2,400 tokens with a continuation span has a best case of −0.36% of the codex sweet cell and
turns cost-positive above a 9.5% pointer-follow rate, while the measured follow rate is
23.6%. That report returned an empty candidate list. **I do not re-propose a codex budget.**
Candidate C-1 below changes the layout, not the budget, and adds no continuation demand.

---

## 3. Candidates

### C-1 — Codex-only output layout that survives the fixed head-and-tail cut

**What changes, for which harness.** When `detectAgentEnv()` reports codex (any `CODEX_*`
key, `core/search/output-policy.js`), `ss-search`, `ss-find`, `ss-read` and `ss-trace` render
in three sections instead of one stream:

1. a **head section capped at about 4,800 characters** holding the complete top-ranked body
   (or, for `ss-read`, the requested span up to that size);
2. a **middle section** with everything else, in today's order;
3. a **tail section capped at about 4,600 characters** holding the compact manifest of every
   rank (`#N file:start-end [symbol]`), the `sufficient=` verdict, the route and confidence
   line, and the exact continue command.

Under the cap nothing changes: the model receives the whole output. Over the cap the
harness's own cut removes the middle, which is free, and the model receives a complete
top-1 body plus a complete manifest instead of half a body and a partial list. On
claude-code and opencode the layout is unchanged, because their overflow rules are
different (whole-result deletion, and head truncation).

**Why native cannot match it.** Codex applies the same cut to native's `sed`, `rg` and `cat`
output, and native cannot re-order what those tools print. Only the producer of the text can
lay it out to survive the cut, and on the sweet arm sweet is that producer.

**Evidence.** `[M]` cut geometry, section 1.1 (105 sweet cuts, head 5,190 / tail 5,000 /
delivered 10,203 characters, all p10-p90 within 14 characters). `[M]`
`forensics/codex-cap-x-ss.md` F5: in 33 truncated `ss-search` packs the cut begins inside the
rank-1 full body **25 times**, the rank-2 header is lost 8 times, and the rank-1 header is
never lost. F4: of 49 headed `ss-read` cuts the continue trailer survived 26 (53.1%), and
survival collapses to 1 of 19 when the cut eats a block boundary; the 31 resolved gaps hold
1,900 lines, 22 of them containing at least one definition line, 163 definition lines in
total. F6: 33 of the 105 cuts are single-command envelopes, 72 are `&&` bundles, in which the
head belongs to the first command and the tail to the last, so the layout still governs both
ends. Exhibit rollouts: `fp-codex-tab-20260826`,
`accenture__sfmc-devtools-1974/sweet/rep0 rollout-2026-08-26T22-28-06-01a04030` call 5 and
`.../sweet/rep1 rollout-2026-08-26T22-30-34-01a04032` call 1.

**Ceiling, per harness.** Codex: delivered tokens are unchanged, because the window is fixed
at about 2,550 tokens either way, so the cost effect runs entirely through requests avoided.
`[M]` `codex-cap-x-ss` F7 counted 18 unique truncation-attributable follow-up requests in the
sweet arm, 0.273 per rollout, $0.01125 across the cell = **1.38% of the codex sweet cell
($0.012330 per rollout)**. `[I]` Removing half of them is **−0.7% of the codex cell**,
−0.14 requests per rollout. Correctness: 163 lost definition lines and 25 half-delivered
top-1 bodies per 66 rollouts become zero. Opencode and claude-code: **0.0%**, by construction.
Solves: `[M]` 0 of 480 codex edit calls ever anchored on a line that only a truncation had
hidden, so the class has never cost a solve; the change can only add content the model was
already meant to have.

**Vehicle.** `core/search/output-policy.js` (harness gate) plus the renderers in
`core/search/search-server.js`, `core/search/search-read.js` and the `ss-*` wrappers.
**Sweet-only**: native never passes through this code.

**`$0` falsifier.** Replay every one of the 105 truncated sweet envelopes offline: re-lay the
recorded original text under the proposed three-section rule, apply the measured
5,190/marker/5,000 cut, and check two properties — (a) is the top-1 body complete in the
head, (b) is every rank's `file:start-end` present in the tail. The original text is
recoverable for the 33 single-command cuts from the delivered head plus tail plus the
recorded original token count; for the bundles it is recoverable only for the first and last
command. **Kill condition:** if the complete top-1 body does not fit in 4,800 characters in
more than 20% of the 33 addressable cuts, the layout cannot deliver its main promise and the
candidate dies.

**Build cost.** Medium. One harness gate, one section-ordering pass in the pack renderer, one
in `ss-read`. Days, not weeks. No index change, no new tool, no ranking signal (so the
`opts._isAgentFormat` gating rule does not apply, and GCSN cannot move).

**Register check.** Nearest rows are **C9** (fit under codex's cap, PARKED — a *budget*; this
is a *layout* and removes nothing the model receives), **C8** (raise the cap, CLOSED — a
shared harness setting; this changes no setting) and **C11** (`ss-search` truncation silently
drops a whole middle rank, PARKED — this is C11's symptom, and C11's own `$0` screen is
unrunnable because the dropped content was never delivered and cannot be recovered from a
trace). None of the three records the cut geometry, and none proposes reordering.

`new_tool: false`. `needs_user_decision`: none — it touches no owner decision.
**Solve risk: low.** The model receives a superset of today's surviving content. The residual
risk is that a re-ordered tail reads as a different contract; mitigate by keeping rank order
inside the head and middle and adding the manifest only at the end.

---

### C-2 — Read-before-edit hint on claude-code, gated by the live session transcript

**What changes, for which harness.** On claude-code only, `ss-read` (and `ss-search`/`ss-find`
when they return a full body) appends **one line** naming the native `Read` call that would
satisfy Claude Code's `Edit` precondition for the span just returned — but only when both of
these are true at run time:

1. the **active model id is in the gate set**, and
2. the file has **not already been read natively** in this session.

Both are readable at zero token cost. `[C]` Claude Code 2.1.218 spawns Bash children with
`{...oe, CLAUDE_PROJECT_DIR: Rl(), CLAUDE_CODE_SESSION_ID: xt(), CLAUDECODE: "1", ...t.env}`.
`[M]` Verified live on this machine inside a Claude Code session: `CLAUDECODE=1` and
`CLAUDE_CODE_SESSION_ID=559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f` are both visible to a Bash
child. `[M]` The session transcript at
`~/.claude/projects/<cwd-slug>/<session-id>.jsonl` exists and is being appended **during**
the session (1,875,293 bytes mid-session), every assistant record carries
`message.model` (here `claude-fable-5-1`), and every `Read` tool use carries
`input.file_path`. A single glob on `~/.claude/projects/*/$CLAUDE_CODE_SESSION_ID.jsonl`
finds it without reconstructing the slug. When it fails the wrapper prints nothing.

**Why this is needed at all.** `[C]` The `Edit` guard throws `File has not been read yet.
Read it first before writing to it.` only when the model id is in a hard-coded ten-id set
(`claude-opus-4-6`, `claude-haiku-4-5`, `claude-opus-4-5/4-1/4-0`, `claude-sonnet-4-5/4-0`,
`claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku`), unchanged from 2.1.218 to
2.1.258 `[C` sibling reports `claude-main-thread` F5 and `anthropic-model-product-path` F1`]`.
`[C]` `readFileState` is written only by the `Read`, `Edit`/`Write` and memory-loading paths
in the binary, so no Bash subprocess and no `ss-*` output can satisfy the precondition. The
only remedy is to make the model issue one native `Read`.

**Why native cannot match it — and the honest framing.** Native never needs this: its `Read`
*is* the thing that satisfies the gate. This candidate removes a **sweet-only penalty**; it
does not create a sweet advantage. It is a product-correctness item.

**Evidence and ceiling.** `[M]` On the benchmark the ceiling is **exactly zero**: the
backbone was `openai/gpt-5.6-luna`, outside the gate set, so 218 of 259 sweet edits with only
an `ss-read` before them produced no error across 1,044 edit calls in 264 rollouts (register
H1). `[M]` Where the gate binds, `claude-main-thread` F6 priced it on this run's own
requests: 68 gated existing files across 56 of 66 rollouts, one failed `Edit` plus one `Read`
each, **$0.00127 to $0.00153 per rollout = 7.8% to 9.4% of the claude-code sweet main-thread
arm**. `[I]` A blind guide clause (sibling seed C-A1) buys the same protection but pays it on
every model: at 1.03 gated-or-not first edits per rollout, one unnecessary `Read` costs about
one request ($0.00070) plus about 1,314 tokens resident ($0.00040) = **$0.00113 per rollout,
5.5% of the claude-code sweet rollout**, on every current Anthropic model, where the gate is
off. Precision is the whole value: the transcript-gated form costs **0 tokens** when it does
not fire.

**Vehicle.** `core/search/output-policy.js` (a new `claudeCodeSession()` reader) plus one
trailer line in `eval/agent-read-workflows/bin/_ss-helpers.mjs`. **Sweet-only.** Not the tool
guide, so the owner's guidance-block decision is untouched.

**`$0` falsifier.** Two parts, both static. (a) Confirm the channel on a real Claude Code
install: `CLAUDE_CODE_SESSION_ID` set, transcript found by glob, `message.model` present,
`Read` file paths present. **Done, all four hold** `[M]`, this machine, 2.1.257. (b) Replay
`fp-claudecode-tab-20260826` sweet: reconstruct, from each transcript alone, the set of
(file, first-edit) pairs with no prior native `Read`, and compare with the 68 gated files
`claude-main-thread` F6 counted by a different route. **Kill condition:** if the
transcript-derived set differs from the independently counted set by more than 5% of the 244
sweet edit calls, the detection is unreliable and the candidate dies. Second kill: if
`CLAUDE_CODE_SESSION_ID` is absent, or the transcript is missing, in more than 5% of a sample
of real sessions.

**Build cost.** Small. One reader with a hard timeout, a fail-open path, and one trailer line.

**Register check.** **H1** records the risk as UNMEASURED with the revival condition "a `$0`
price plus a small check on a real Anthropic model"; the price now exists and the channel is
verified. **C-A1** in `research/anthropic-model-product-path.md` is the blind guide-clause
version; this one is runtime-gated and costs nothing when the gate is off. **P1/F8** kill
general engineering clauses in the guide — this is not a reasoning rule and not in the guide;
it is a computed harness-protocol fact attached to one tool result, the same class as the
shipped `pages` note (D4a). **B2/B3** concern guide length and are untouched.

`new_tool: false`. **`needs_user_decision: true`** — an `ss-*` wrapper would read the user's
own Claude Code session transcript from disk. That is a new contact surface, of the same kind
the owner has ruled on before, even though the file belongs to the user and never leaves the
machine. **Solve risk: none on the bench (it cannot fire); on a gated model it converts a
failed edit into a planned read.**

---

### C-3 — Claude-code overflow guard: never cross the delete threshold, and put the recovery in the first 2,000 characters

**What changes, for which harness.** On claude-code only, `ss-*` bounds its own rendered
output to a safe margin below the harness's persistence threshold (about 30,000 characters
on 2.1.218; treat the value as configuration, since a server-side per-tool override exists
`[C` `tengu_velvet_ibis``]`). When the natural output would cross it, the wrapper returns a
bounded result whose **first 2,000 characters** carry the header, the confidence and
sufficiency line, the top-ranked address, and the exact narrowing command — because the first
2,000 characters are the only part that survives a deletion. On codex and opencode nothing
changes.

**Why native cannot match it.** Native's over-size results are `grep -R` and `find` dumps
(26 of its 34 deletions in the TAB run), and native has no way to shape them. Sweet owns its
own renderer, so this is a place where sweet can be strictly better than native.

**Evidence.** Section 1.2. `[M]` 4 `ss-*` deletions in 66 sweet TAB rollouts, 16 across 198
sweet rollouts in the three gutter forms, 2 more in `rb-claudecode-20260824`. `[M]` 0 of 66
persisted results were ever read back, in either arm, in any run. `[M]` The escalation chain
in `fp-claudecode-none-20260826` `bfgroup__b2-259` sweet `r2-38` (seven deletions, `-k` rising
200 to 500, then a false absence report). `[M]` Main-thread exhibits:
`fp-claudecode-tab-20260826` `devlooped__moq-1262` sweet rep 0 (30.6 KB, a four-command
`ss-search && ss-read && ...` envelope) and `aws-actions__configure-aws-credentials-42` sweet
rep 1 (`ss-read dist/index.js 34500 35000`, 71.1 KB).

**Ceiling.** `[I]` The cost sign is subtle and I state it against my own interest: the
harness's deletion currently **saves** sweet tokens, because a 540-token stub replaces a
7,500-20,000-token result. Emitting a bounded 7,000-token result instead **adds** about
6,500 tokens at $0.301 per million resident on claude-code = $0.00196 per event; at 0.061
events per rollout that is **+$0.00012 per rollout, +0.6% of the claude-code sweet rollout**.
Against that, the observed chains spent 4 to 7 further `ss-*` requests at about $0.00070
each. **The honest claim is correctness, not cost**: a bounded, addressable result instead of
a stub the agent never opens, and no more size failures read as absence. Codex 0%,
opencode 0%.

**Vehicle.** `core/search/output-policy.js` plus `_ss-helpers.mjs`. **Sweet-only.**

**`$0` falsifier.** Replay the 16 recorded over-threshold `ss-*` invocations against the
proposed renderer offline and check that (a) every one lands under the threshold, and (b) the
first 2,000 characters contain the header, the sufficiency verdict, the top address and a
narrowing command. **Kill condition:** if fewer than 12 of the 16 pass both, or if the
population on a post-fix run falls below 3 events per 198 sweet rollouts, this is hygiene
with no measurable effect and belongs in the E2 package rather than in a slate.

**Build cost.** Small: a byte ceiling and a re-ordered preamble.

**Register check.** Nearest are **C9** and **C8** (codex's cap) — a different harness with
opposite semantics: codex cuts the middle and keeps both ends, claude-code deletes
everything and hands back a path. **E2** shipped the `ss-*` hygiene package, and this is the
same class but an uncovered path; **C11** is the codex analogue of the same information loss.
No row covers claude-code result persistence.

`new_tool: false`. `needs_user_decision`: none. **Solve risk: low**, but real in one
direction — a bounded result is less content than an unbounded one, and register B12 measured
that changing how much context an agent gets moves cost in unexpected directions. The guard
should bound only when the alternative is total deletion.

---

### C-4 — Make the declared token budget equal the rendered size (prerequisite, not a lever)

**What changes.** `ss-search`, `ss-find` and `ss-read` print `budget=N used=M`, and `M` is
computed inside the packer rather than over the bytes actually written. `[M]`
`budget-vs-bytes.py` over 293 headered `ss-*` results in `fp-claudecode-tab-20260826` sweet:
the ratio of estimated rendered tokens to the declared `used` is a median of **1.54** for
`ss-search`, **1.54** for `ss-find`, **1.46** for `ss-grep` and **2.86** for `ss-read`. The
sharpest exhibit is a header reading `budget=8000 used=1726` on a result of **33,200
characters** (about 8,300 tokens) — `fp-claudecode-none-20260826`, `bfgroup__b2-259`, sweet,
`r2-38`. The fix is to account the rendered stream and to make the auto-tier's 4k/8k/12k tiers
bound what the agent is actually billed for.

**Why it belongs in this lens.** Every per-harness budget in C-1 and C-3 is stated in
characters that reach the model. Today sweet's own number is wrong by 1.5 to 2.9 times, so a
harness-conditioned budget built on it would miss by the same factor. It is also why the XL
escalation can produce a result the harness then deletes.

**Ceiling.** `[I]` None claimed as a lever. Honouring the declared budget would shrink packs
by about a third, but section 2.2 shows the mass sits in ranks the agent uses 31-38% of the
time, so the saving is not admissible on its own. Book this as correctness.

**Vehicle.** `core/search/search-server.js` packing accounting plus the wrapper headers.
**Sweet-only.**

**`$0` falsifier.** Re-run `budget-vs-bytes.py` against the fixed renderer on the recorded
queries. **Kill condition:** if the corrected ratio does not land inside 1.0 to 1.15 for all
four tools, the accounting is still not the thing the harness bills and the fix is
incomplete.

**Build cost.** Small.

**Register check.** No row covers it. **B13** and **B14** both presuppose a budget that means
something; the auto-tier itself is recorded only in a memory note. **B7** (result diet) is the
banned class and this is not it: nothing is re-rendered more densely, the reported number is
corrected.

`new_tool: false`. `needs_user_decision`: none. **Solve risk: low but not zero** — if the
tiers begin to bind honestly, packs get smaller, and that is the direction section 2.2 warns
about. Ship the accounting first and change the tier values only with evidence.

---

## 4. What I could not finish

- I did not replay the 105 codex cuts under the proposed C-1 layout. The falsifier is
  specified and needs the recorded head plus tail plus the original token count; for the 72
  bundle cuts only the first and last command are recoverable.
- I did not run C-11's own screen (does the model later re-query for a symbol only a dropped
  rank held). The dropped rank's content was never delivered, so it is not recoverable from a
  trace at `$0`; it would need `ss-search` re-run on the goldens, which spawns daemons on a
  read-only box.
- The claude-code persistence threshold is inferred from observed sizes (smallest persisted
  29.5 KB, largest inline 28,896 characters) rather than read from the 2.1.218 bundle, and a
  server-side per-tool override exists, so a user's threshold can differ.
- Opencode's `tool_output.max_lines` and `max_bytes` defaults were not resolved from the
  minified binary; the conclusion that opencode barely truncates `ss-*` rests on the observed
  4 events in 1,100 calls, not on the constant.
- For C-2 I verified the transcript channel on Claude Code 2.1.257 on this machine, not on
  2.1.218 on the evidence box, and I did not verify it inside a subagent's own transcript
  (`CLAUDE_CODE_SESSION_ID` there points at the parent session).
- The subagent share of the claude-code byte and persistence figures is reported separately
  but not priced; register G6 applies.
- I did not examine HO2, and I opened no grading log.
