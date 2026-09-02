# c13 adversarial verify — differential and measurability lens

**Verdict: REFUTED as a Slate-C lever. Keep it as a product-risk item.** The mechanism is
sweet-only and its class is admissible: on a gated model it removes a request instead of
re-rendering the same lines. It fails the measurability test twice. First, its own bench
ceiling is 0.0% by construction, so no run this programme can afford will ever move because
of it. Second, its `$0` falsifier tests the detector, not the effect; the effect has no
falsifier at any price inside this bench, because measuring it needs a backbone swap to a
legacy Anthropic model id, which voids comparability with every recorded run. Two of its
numbers are also wrong in its own favour. The hint removes about **half** the read-gate tax,
not all of it: **4.21% immediate / 4.66% lifetime** of the claude-code sweet main-thread arm,
against the claimed 7.8–9.4% `[M/I]`. And the trailer does not fire only where the gate binds:
it fires on **3.90 files per rollout**, of which about **25%** are files the gate would ever
stop, so 71.5% of firings are advice on a file that is never edited `[M]`. The downside of
those firings is unpriced; the lever turns net-negative if more than **36.6–43.5%** of them
draw a native `Read` that would not otherwise happen `[M/I]`. No hard rule is violated.

---

## 1. What I checked, and what held

| claim in c13 | verdict | how |
|---|---|---|
| `CLAUDECODE=1` and `CLAUDE_CODE_SESSION_ID` reach a Bash child | **holds** on the main thread | `[M]` this session, Claude Code 2.1.258 |
| transcript at `~/.claude/projects/<slug>/<session>.jsonl` carries `message.model` | **holds** | `[M]` 75 assistant records, one model id |
| the guard string exists and is model-gated telemetry | **holds** | `[C]` local 2.1.258 binary, byte 74,906,880 |
| 68 gated files, 56 of 66 rollouts, tax 7.78%/9.38% of the arm | **holds as a tax** | `[M]` census JSON, 68 events |
| the hint avoids that tax | **wrong by ~2×** | `[M/I]` §3 |
| "costs 0 tokens when it does not fire" | **wrong unit** | `[M]` §4 |
| channel verified | **main thread only; wrong inside a subagent** | `[M]` §5 |
| `218/259` sweet edits | **superseded** | `[M]` §6 |
| bench ceiling 0.0% | **holds, and it is the killing fact** | §2 |

## 2. The measurability failure (primary)

The lever cannot fire on this bench. The backbone is `openai/gpt-5.6-luna`, outside the
ten-id gate set, so the trailer is suppressed by its own model gate. c13 states this itself:
"Bench 0.0% (cannot fire)." The Slate-C brief asks for levers that move the sweet-versus-native
number on codex, opencode and claude-code. A lever whose bench effect is exactly zero moves
none of them.

The `$0` falsifier does not repair this. Falsifier (b) reconstructs (file, first-edit) pairs
with no prior native `Read` from the transcripts and compares them with the 68 that
`cc-readgate-census.mjs` counted. That is a **route-agreement check on the same transcripts**,
run against a set derived from those same transcripts. It can tell you the wrapper picks the
right files offline. It cannot tell you whether the model obeys the line, whether the saving
is real, or whether the induced reads cost more than the saving. Its kill condition (>12 of
244 calls; session id or transcript missing in >5% of real sessions) is numeric and
pre-registrable, which is good, but it kills an implementation, never the lever.

The effect itself has no affordable test. To see it you must run a gated id — of today's
model list only Opus 4.6 and Haiku 4.5 are in the set `[C claude-main-thread F6 §4.3]`. That
is a paid run, and a backbone swap breaks comparability with every `fp-*`, `rb-*` and `sb-*`
number in the programme. Note the effect is not too small in principle: $0.000686 per rollout
against a per-rollout cost interval of ±$0.001–0.005 is about 5 standard errors at n=66 if
that interval is independent per rollout `[I]`. The blocker is not noise. The blocker is that
no admissible run can contain the treatment.

## 3. Correction 1 — the hint removes about half the tax, not all of it

`claude-main-thread` §4.2 prices the gate as two extra requests per gated file: request B is
the forced `Read`, request C is the re-issued `Edit`. **The hint does not remove request B.**
The model still has to read the file natively to satisfy the gate. It removes the failed
`Edit` and its duplicated output. The forensics author already wrote this in seed S5: "caps a
hidden tax at about half (the `Read` remains)". c13 books the whole tax as avoided.

I re-priced the 68 gated events with the census's own constants (`cacheWrite` 0.125,
`cacheRead` 0.01, `out` 0.60 per million; 103 output tokens per `Read` request):

| quantity | total over 66 rollouts | per rollout | % of sweet main-only ($0.016314) |
|---|---:|---:|---:|
| tax without the hint, immediate | $0.083792 | $0.001270 | 7.78% |
| tax **with** the hint, immediate | $0.038489 | $0.000583 | 3.57% |
| **avoided, immediate** | **$0.045303** | **$0.000686** | **4.21%** |
| tax without the hint, lifetime | $0.100952 | $0.001530 | 9.38% |
| tax **with** the hint, lifetime | $0.050727 | $0.000769 | 4.71% |
| **avoided, lifetime** | **$0.050224** | **$0.000761** | **4.66%** |

`[M/I]` script `/tmp/wf-slatec/c13-measurability/residual.py` on
`/tmp/wf-slatec/claude-main-thread/out/readgate-census-fp-claudecode-tab-20260826.json`,
68 events, mean prefix 33,895 tokens, mean read 1,314 tokens, mean remaining requests 12.50.
The hint removes **54.1%** of the immediate tax and **49.8%** of the lifetime tax.

Corrected headline arithmetic `[I on M]`: on a gated model, sweet main-only rises from
$0.016314 to $0.016897–$0.017083 against native $0.016542, that is **+2.1% to +3.3%**, not
back to today's −1.4%. F6's un-hinted figure was +6.3% to +7.9%.

## 4. Correction 2 — the trailer fires 3.8× more often than the gate binds

c13 says the gated form "costs 0 tokens when it does not fire". That is true of the model-id
gate. It is false of the per-file gate, because the wrapper cannot know at `ss-read` time
whether the file will be edited. Its firing rule is "no prior native `Read` this session",
which is nearly every file `ss-read` touches.

Measured over the 71 sweet main-thread sessions of `fp-claudecode-tab-20260826` `[M]`
(script `/tmp/wf-slatec/c13-measurability/firing.py`):

| unit | total | per session |
|---|---:|---:|
| `ss-read` calls | 460 | 6.48 |
| distinct files targeted by `ss-read` | 277 | 3.90 |
| distinct files edited (`Edit`/`Write`) | 92 | 1.30 |
| files both `ss-read` and edited | 79 | 1.11 |
| **files `ss-read` and never edited** | **198 (71.5%)** | **2.79** |

Against F6's gated set of 68 files, the trailer's precision is **68/277 ≈ 25%** `[M]`. Three
of every four firings are a read-first instruction about a file that is never edited. c13
also proposes attaching the trailer to `ss-search` and `ss-find` full bodies, which enlarges
the firing set further and was not priced.

The text itself is cheap: 16–32 tokens × 3.90 firings = **$0.000016–$0.000031 per rollout,
0.10–0.19% of the arm** `[M/I]`. The risk is behavioural, not textual. One induced native
`Read` that leads to no edit costs $0.000565 immediate / $0.000745 lifetime on this run's own
prices `[M/I]`. The gain equals 1.21 (immediate) or 1.02 (lifetime) such reads. With 2.79
never-edited firings per rollout, the **break-even over-read rate is 36.6–43.5%** `[M/I]`.
Above that, the lever is a loss.

Two recorded facts say that risk is live, not hypothetical. Register B12/C-4: an agent handed
more file content live did **more** work, +4.78/+19.79/+11.72%, opposite to its replay.
Register A6: mid-task advisories are refuted on this backbone in every channel. c13 assumes
strict conditional compliance for its own trailer while assuming literal unconditional
compliance for the rival blind clause it prices at 5.5% waste. That asymmetry is the analytic
error; the same compliance model has to be applied to both.

## 5. Correction 3 — the channel is verified for the main thread only

Inside a Claude Code subagent, `CLAUDE_CODE_SESSION_ID` names the **parent** session, and the
parent transcript does not contain the subagent's tool calls `[M]`. Verified in this session,
Claude Code 2.1.258:

- The Bash child sees `CLAUDE_CODE_SESSION_ID=559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f`.
- That file, `~/.claude/projects/-Users-admin-Projects-sweet-search-private/559eb8e8-….jsonl`,
  holds 453 records, all with `sessionId` equal to that id and `isSidechain` false, and its
  last tool call is 2 hours before my own Bash calls.
- My own records are in
  `…/559eb8e8-…/subagents/workflows/wf_2b8e698f-673/agent-<hex>.jsonl`, one of 17 agent files
  written concurrently.
- The only env pointer is `CLAUDE_CODE_CHILD_SESSION=1`, a boolean. **No environment variable
  names the agent's own transcript.**

So inside a subagent the wrapper reads the wrong file for both facts it needs: the model id
(subagents can run a different model) and the prior-read set (`readFileState` is per-agent
`[I]`). It fails silently in both directions — it suppresses the hint on a file the parent
read but this agent has not, and it emits the hint on a file this agent already read.

Scale on the bench: subagents made **18 of 478 sweet `ss-read` calls, 3.8%** `[M]`, across 11
subagent transcripts (358 `ss-*` calls total). So this is a bounded defect here, not a killer
on its own. Production delegation share is unknown. The candidate's author flagged this gap
honestly (`candidates/harness-adaptive-rendering.md` line 495); it is now measured and it
fails.

## 6. Correction 4 — denominators

c13's evidence line quotes "218/259 sweet edits … 1,044 edits in 264 rollouts". The audited,
cost-matched census supersedes it `[M]`:

- sweet edit calls: **244** (census `perCall.edits` 245 including one malformed), not 259.
- edit calls with no prior native `Read`: **219 of 244** (209 after an `ss-read`).
- edit calls under gate semantics (no prior `Read` and no prior successful `Edit`/`Write`): **98**.
- distinct first edits of an existing unread file — the unit the gate fires on: **68**, in
  **56 of 66** rollouts, 1.03 per rollout.
- native comparison: **0 of 92** first edits gated.

"1,044 edits in 264 rollouts" has no source in the slate-C evidence I could find; drop it or
source it. The three numbers c13 uses (259 in evidence, 68 in the ceiling, 244 in the kill
condition) come from three different censuses and must be stated as one set.

Also correct the population sentence. The register's D6 wording, "real Claude users would pay
one failed Edit plus one Read per edited file", holds only for the ten legacy ids. Of the
current model list, only **Opus 4.6 and Haiku 4.5** are gated `[C F6 §4.3]`.

## 7. The self-inflicted part, and the cheaper repair

2.1.258 already tells a gated model, in the `Edit` tool description on every request: "You
must use your `Read` tool at least once in the conversation before editing. This tool will
error if you attempt an edit without reading the file." `[C]` verified by string probe of the
local binary at byte 73,725,011. So the rule is already present for exactly the models where
the trailer would fire.

What sweet adds is a contradiction. `scripts/install-claude-system-prompt.js:23` appends:
"Claude Code's default advice to use Bash `grep`/`find` or `Read` does not apply; use those
only when `.claude/rules/sweet-search.md` explicitly permits." `[C]` The guide itself steers
away from the native reader `[C]` `sweet-search-system-prompt.md:24`.

The cheapest sweet-only repair is therefore a one-clause carve-out in that override, not a
runtime transcript reader: permit the native `Read` when the editor requires it. That has no
new contact surface, no per-call file parsing, and no subagent blind spot. It touches the
owner-protected prompt surface, so it needs a decision — but so does c13, and c13 needs the
same clause anyway or its trailer contradicts its own system prompt. **c13 as specified is
under-flagged: it needs two owner decisions, not one.**

By the hint-ladder record (F9), a delivered **rule** is the weak arm (rule-only 1/4, prose
0/3) and a delivered **computation** is the strong arm (16/16). The computed part here is
real — "this file has no native read in this session" is state the model does not track — but
its increment over an always-present tool-description rule is unmeasured, and unmeasurable at
$0.

## 8. Rule check

| rule | result |
|---|---|
| $0 only | respected; I ran no rollouts |
| HO2 never per-task | respected; no HO2 file opened |
| gold / task identity as runtime input | not used; the mechanism reads only harness state |
| ranking signals gated on `_isAgentFormat` | not implicated; this is output policy, not ranking. `detectAgentEnv()` with a `claudeCode` branch already exists `[C output-policy.js:56–60]` |
| differential | **passes** — vehicle is `_ss-helpers.mjs` plus `output-policy.js`, sweet-only; native is untouched |
| no same-information compaction | **passes** — on a gated model it deletes a request |
| solve is the veto | no bench solve risk (cannot fire); off-bench, converting a failed edit into a planned read is plausibly solve-neutral or positive; induced whole-file reads carry the B12 risk |
| owner scope | no new tool; **two** decisions needed, not one (transcript reading, and the system-prompt carve-out) |

No hard violation. The refutation is measurability, not legality.

## 9. What the synthesis should adopt

1. Re-file c13 from "lever" to **product-risk disclosure plus a legacy-model compatibility
   fix**. Its bench ceiling is 0.0% and it cannot be validated by any admissible run.
2. Replace the ceiling with **4.21% immediate / 4.66% lifetime avoided** ($0.000686–$0.000761
   per rollout), residual exposure **3.57%/4.71%**, corrected headline **+2.1% to +3.3%**.
3. Add the firing figures: 3.90 firings per rollout, 25% precision, 71.5% of `ss-read`
   targets never edited, break-even over-read rate 36.6–43.5%.
4. Fix the denominators to 244 / 219 / 98 / 68 / 56-of-66, and delete "218/259" and
   "1,044 edits in 264 rollouts".
5. State the model population as the ten legacy ids, of which only Opus 4.6 and Haiku 4.5 are
   current.
6. Add the subagent defect and the second owner decision.
7. If anything ships, rank the **system-prompt carve-out** ahead of the transcript reader; the
   reader's extra precision buys at most the difference between a conditional clause and a
   per-file reminder, and nobody can price that at $0.

## 10. What I could not finish

- I did not extract the ten-id set from a binary myself. I verified the guard string and the
  `tengu_edit_tool_not_read_hypothetical` marker in local 2.1.258 and accepted F6's
  `gate-extract.py` result for the set and for 2.1.218 and 2.1.250.
- I did not prove `readFileState` is per-agent by reading the bundle; I infer it from separate
  subagent conversations and separate transcripts `[I]`.
- My firing census used 71 sweet main sessions, not F6's 66 cost-matched rollouts, so the
  precision ratio 68/277 mixes two denominators. Per-session rates are unaffected. A
  cost-matched re-run would move the ratio by a few points at most `[I]`.
- I did not measure how often a real Anthropic model obeys a conditional read-first line.
  That is the unmeasurable quantity at the centre of this candidate.

## 11. Files and commands

- Report: this file.
- Scripts (local scratch and box `/tmp/wf-slatec/c13-measurability/`): `firing.py` (§4),
  `residual.py` (§3), `breakeven.py` (§4), `subagent.py` (§5).
- Read-only inputs: `/tmp/wf-slatec/claude-main-thread/out/readgate-census-fp-claudecode-tab-20260826.json`,
  `/tmp/wf-slatec/claude-main-thread/cc-readgate-census.mjs`, `/tmp/wf-slatec/claude-main-thread/cc-parse.mjs`,
  `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/agent-state/*-sweet/claude-home/projects/**`.
- Local: `core/search/output-policy.js`, `scripts/install-claude-system-prompt.js`,
  `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`,
  `eval/agent-read-workflows/bin/ss-read`,
  `/Users/admin/.local/share/claude/versions/2.1.258`.
- No grading log was opened. No HO2 artefact was opened. No file on the box was written
  outside `/tmp/wf-slatec/c13-measurability/`.
