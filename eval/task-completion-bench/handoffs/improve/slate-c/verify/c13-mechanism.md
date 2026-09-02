# c13 — Read-before-edit hint on claude-code, gated by the live session transcript (revives H1) — MECHANISM verification

Date 2026-09-02. Lens: mechanism and ceiling arithmetic. Run inspected: `fp-claudecode-tab-20260826` (22 tasks × 3 reps × 2 arms = 132 rows). Box scratch: `/tmp/wf-slatec/c13-mechanism/`. Local scratch: `.../scratchpad/c13/`. No HO2 task was opened. No grading log was opened. No product or bench code was edited. $0 spent.

## 1. Verdict

**Refuted as a Slate C lever. Confidence 0.70.** The mechanism is real on the main thread and the gate count reproduces exactly (68 gated files in 56 of 66 rollouts). But the candidate books the whole read-gate tax (7.8–9.4%) as "avoided". The hint can remove only the failed `Edit` request. The native `Read` stays. The achievable saving is **4.2–4.7% of the claude-code sweet main-thread cell** ($0.00069–0.00076 per rollout), which is 1.85–2.01× below the claim, and it applies to **0.0% of every fresh-pool cell** (the bench backbone is outside the gate set). The "[M] verified live" channel evidence was read from the **parent orchestrator's transcript**, not from the checking session's own, and the same misattribution applies to my session. The hint would fire on 95.4% of `ss-read` calls and only 24% of hinted files are ever edited; about one over-complied `Read` per rollout cancels the whole saving. The product fact behind H1/D6 is confirmed and is now measured. It belongs in the register as product hygiene with a small ceiling, not as a cost lever.

## 2. What the mechanism claims, and what holds

| claim in the candidate | status | evidence |
|---|---|---|
| `Edit` throws "File has not been read yet" only for a hard-coded ten-id set, unchanged 2.1.218 → 2.1.258 | **holds** [C] | 2.1.258 offset 162414803: `let U=n.readFileState.get(_); if(!U\|\|U.isPartialView){ ... ke=!mYe(me,n.remoteCall)&&CJ(...)`; offset 159196151 area: `N = new Set([...10 ids...]); mYe(e,n) = N.has(tn(e))`; `tn` strips only `[1m]`. Same set confirmed in 2.1.218 by `research/anthropic-model-product-path.md` §1.2. |
| `readFileState` is written only by `Read`/`Edit`/`Write`/memory paths | **holds** [C] | 14 writers enumerated in `research/anthropic-model-product-path.md` §2; my binary scan found the same classes (`Read` resume rebuild at 163599085, `Edit`/`Write` success, nested-memory seeding at 165747198, artifact publish at 175573639, sed fast path at 165018181). |
| A `Read` of "the span just returned" satisfies the gate | **holds with one edge** [C] | The rebuild writer stores `offset: F.offset??1, limit: F.limit` and sets `isPartialView` only when `toolUseResult.file.truncatedByTokenCap===true` (or a system-reminder-prefixed result). A ranged `Read` that is not truncated by the token cap satisfies `!U\|\|U.isPartialView`. A `Read` truncated by the cap does not. |
| `CLAUDECODE=1` and `CLAUDE_CODE_SESSION_ID` are visible to a Bash child | **holds** [M] | This session: `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID=559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f`, also `CLAUDE_CODE_CHILD_SESSION=1`, `AI_AGENT=claude-code_2-1-257_agent`, `CLAUDE_EFFORT`, `CLAUDE_PID`. |
| The glob `~/.claude/projects/*/$CLAUDE_CODE_SESSION_ID.jsonl` finds **the session's own** transcript | **holds for a top-level session only; misattributed in the candidate** [M] | The glob resolved to `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/559eb8e8-….jsonl` (2,125,931 bytes). That file is the **parent orchestrator's** transcript: 0 hits for my distinctive command strings (`c13-mechanism`, `cc-readgate-census`), its 49 tool uses are the orchestrator's (memory reads, `ls`, `grep`), its 4 `Read` calls target `tool-results/*.txt`, and my own `Read` of `BRIEF.md` is absent. My own transcript is `…/559eb8e8-…/subagents/workflows/wf_2b8e698f-673/agent-a47f6bd7587beb7b6.jsonl` (473,787 bytes; found only by content grep; no env var carries the agent id). The candidate quotes the same session id and "1,875,293 bytes mid-session": its author was also a child of this orchestrator and verified the parent's transcript. |
| Every assistant record carries `message.model` | **holds** [M] | Box, 2.1.218 transcripts: 4,075 sweet assistant records all `"model":"openai/gpt-5.6-luna"`; 3,918 native. My transcript: `claude-fable-5-1` ×39. Runtime ids are aliases, not dated snapshots (research doc §1.3 [M]). |
| Records are on disk when the wrapper runs (freshness) | **holds** [M, new] | I grepped my own transcript for a marker string that appeared only in the Bash command that was executing at that moment. Count = 1. The `tool_use` record is flushed before the child process runs. |
| "Fail open" is possible in a subagent | **cannot be targeted** [C][M] | 2.1.258 offset 161571825, `OOe(e)`, builds the Bash child env `{CLAUDECODE:"1", CLAUDE_CODE_SESSION_ID:e.sessionId, CLAUDE_CODE_CHILD_SESSION:"1", CLAUDE_PID, AI_AGENT (source==="agent"), CLAUDE_EFFORT}`. `AI_AGENT` is set in my env, so this is the Bash env. The child marker is set for **every** Bash child, main thread included, so a wrapper cannot tell a subagent's Bash child from the main thread's, and no env var names the agent. Inside a subagent the wrapper would read the parent's transcript and miss the subagent's own `Read` calls. Magnitude on this run is negligible: 11 sweet subagent transcripts hold Bash 385, `ss-*` 339, **`ss-read` 16, `Read` 87, `Edit`/`Write` 0** [M box]. |

## 3. Independent reconstruction of the gate set (candidate falsifier b)

Script: `/tmp/wf-slatec/c13-mechanism/wrapper-view.mjs` (box; copy in local scratch). It reads each main transcript alone, in record order, and tracks successful `Read` paths, successful `Edit`/`Write` paths, `ss-read` paths from Bash commands, and first `Edit` of a file with no prior `Read` and no prior successful edit. It does not use rows, cost matching, or the census parser. Outputs: `/tmp/wf-slatec/c13-mechanism/wrapper-view-fp-claudecode-tab-20260826-{sweet,native}.json`.

| unit | census F6 (66 cost-matched) | mine, 71 sweet main transcripts | mine, minus the 5 sessions with no row |
|---|---:|---:|---:|
| gated first `Edit` of an existing un-read file | **68** (66 after `ss-read`, 2 nothing) | 76 (74 / 2) | **68 (66 / 2)** |
| rollouts with ≥ 1 gated file | **56 / 66** | 60 / 71 | **56 / 66** |
| sweet `Read` calls | 51 | 56 | **51** |
| edit calls | 244 (+1 malformed) | 284 | **244** |
| first edits (distinct rollout, file) | 81 | 92 | **81** |
| gate errors observed | 0 | 0 | 0 |
| native control: gated first edits | 0 of 92 | 0 of 94 (67 transcripts) | — |

The five extra sessions are `aio-libs__aiohttp-8038` `4d458300`/`6aba98e9`, `fastify__fastify-cors-285` `14462bd2`, `protofire__solhint-224` `46db02ec`/`3e9be42b`; their request counts do not match any census row and the remaining three per cell match the census request counts exactly. **Difference between the transcript-derived set and the census: 0 of 244 edit calls.** The candidate's kill condition (a) is not triggered. Parse cost: 22.05 MB of transcripts in 106 ms (about 5 ms per MB), so a per-call transcript read is cheap.

Hint firing on the 66-row subset [M]:

| quantity | value | per rollout |
|---|---:|---:|
| main-thread `ss-read` calls | 411 | 6.2 |
| calls whose file had no prior `Read`/edit → hint fires (gated model) | **392 (95.4%)** | 5.94 |
| distinct hinted (rollout, file) pairs | 283 | 4.29 |
| hinted files later edited (precision) | **68 (24.0%)** | 1.03 |
| hinted files never edited | 215 | **3.26** |
| gated files that had been hinted (recall) | 66 of 68 (97.1%) | — |

## 4. Ceiling arithmetic

Source re-read: `forensics/scripts-claude-main-thread/out/readgate-census-fp-claudecode-tab-20260826.json` (events, per-event `prefix`, `out`, `remaining`, `taxImmediate`, `taxLifetime`). Re-derived filter (`firstEditOfFile && tool !== 'Write' && exists !== false && !priorReadMain`) gives 68 events in 56 rollouts [M]. Re-summed tax: immediate **$0.083792** = $0.001270 per rollout = **7.78%** of the sweet main-only cell $1.076701; lifetime **$0.100951** = $0.001530 = **9.38%** [M]. The candidate's tax numbers are right.

The candidate's error is the word "avoided". On a gated model without the hint the sequence is: request A = failed `Edit`; B = `Read`; C = `Edit` re-issued. Tax = B + C. With the hint and full compliance the sequence is B′ = `Read`, C′ = `Edit`. The `Read` and its ingest, its cache write, and its lifetime re-send all remain. Saving = A + (B − B′) + (C − C′) = 0.01·prefix + 0.60·out_A + 0.02·(out_A + 15 − h) per million tokens, with h ≈ 15 hint tokens. Summed over the 68 events [M]:

| estimate | total (66 rollouts) | per rollout | % of sweet main-only |
|---|---:|---:|---:|
| tax, immediate (census) | $0.083792 | $0.001270 | 7.78% |
| tax, lifetime (census) | $0.100951 | $0.001530 | 9.38% |
| **saving the hint can reach, immediate** | **$0.045283** | **$0.000686** | **4.21%** |
| **saving the hint can reach, lifetime** | **$0.050204** | **$0.000761** | **4.66%** |
| claimed ÷ achievable | | | **1.85× / 2.01×** |

Median gated-edit prefix 28,159 tokens, median output 391.5 tokens, median remaining requests 9; mean failed-`Edit` request $0.000655 against the cell's mean request $0.000704 [M]. The candidate's own source already said this: `forensics/claude-main-thread.md` row S5, "caps a hidden tax at about half (the `Read` remains)".

Over-compliance [I, arithmetic on this run's numbers]: one `Read` of a hinted file that is never edited costs about $0.0006–0.0007 (a request at 0.01·prefix + 0.60·103 output, plus 0.10·1,314 tokens ingest, plus 0.01·1,314·9 residency). With 3.26 never-edited hinted files per rollout available, **1.0–1.2 over-complied `Read` calls per rollout erase the saving**. The candidate does not price this. The D4a `pages` note shows what a one-line tool note achieves on this backbone: 63% compliance.

Effect on the fresh-pool cells [M]: none. The backbone `openai/gpt-5.6-luna` is outside the set; 0 gate errors in 1,529 sweet and 1,604 native requests. No cost or solve number in the brief §1 moves.

## 5. What remains unverifiable at $0

- Whether a gated Anthropic model under the sweet guide and the appended system override ("Claude Code's default advice to use … `Read` does not apply") skips `Read` at luna's rate. On 2.1.258 the `Edit` description for gated models says "You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file." The bench binary 2.1.218 had no such sentence. The 68-file exposure is an upper bound with an unknown discount. Only Opus 4.6 and Haiku 4.5 among current models are in the set (plus Sonnet 4.5 and older).
- The env-var → own-transcript mapping in a **top-level** session. I ran as a child. The inference rests on (i) the 2.1.218 main transcripts on the box, which hold every `Read` record, and (ii) the freshness probe on my own subagent transcript, which uses the same writer.
- The second and third partial-view conditions in the rebuild writer (`v.has(tool_use_id)`, the system-reminder prefix) — not resolved. The live `Read` writer in 2.1.258 was not located by my regex.

## 6. Corrections the synthesis must adopt

1. **Ceiling.** Replace "7.8–9.4% of the claude-code sweet main thread avoided" with: "tax 7.8–9.4% on a gated legacy model; the hint can recover at most **4.2–4.7% ($0.00069–0.00076 per rollout)** because the `Read` half stays; **0.0% on every fresh-pool cell**; net can be negative at ≥ 1 over-complied `Read` per rollout."
2. **Live evidence.** Replace "[M] verified live in Claude Code 2.1.257 … transcript 1,875,293 bytes mid-session" with: "verified from a child session that read the **parent orchestrator's** transcript (same session id 559eb8e8). New [M]: a session's `tool_use` record is on disk before its Bash child runs. A subagent's Bash child cannot find its own transcript: `CLAUDE_CODE_CHILD_SESSION=1` is set for every Bash child (2.1.258 `OOe`) and no env var names the agent."
3. **Precision.** Add: the hint fires on 95.4% of main-thread `ss-read` calls; 24.0% of hinted files are later edited; 3.26 never-edited hinted files per rollout.
4. **Falsifier (b).** Done: transcript-derived gate set = 68 = census; difference 0 of 244; kill condition (a) not triggered.
5. **Wording of [M H1].** "218 of 259 sweet edits had no prior native `Read` (205 of them after an `ss-read`)" is the largest-transcript unit from 08-28; the cost-matched unit is 219 of 244 (209 after `ss-read`). The gate binds per file: 68 of 81 first edits, not per call.
6. **Register.** Book as H1/D6 **MEASURED product hygiene** (exposure 68 files in 56 of 66 rollouts; tax $0.00127–0.00153; recoverable ≤ $0.00069–0.00076 per rollout; gated legacy models only), not as a Slate C lever. `needs_user_decision` stays (wrapper reads the user's transcript). Solve: no bench exposure; unmeasured on gated models.

## 7. Denominators and paths

- Cells: 66 rollouts per arm (22 tasks × 3 reps). Sweet main transcripts: 71 (5 without a row). Sweet edit calls 244 (+1 malformed); first edits 81; main-thread `ss-read` calls 411. Sweet subagent transcripts 11.
- Box run: `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/` (`rows.json`, `agent-state/<task>-sweet/claude-home/projects/<slug>/<session>.jsonl`, `…/subagents/agent-*.jsonl`). Example sessions opened by content: `jazzband__tablib-454-sweet` `a545c185…` (model field, cwd), `awslabs__aws-embedded-metrics-node-21-sweet` `f6d0427f…/subagents/agent-a0d415047c0776a3e.jsonl` (record keys).
- Binaries: `/Users/admin/.local/share/claude/versions/2.1.258` (offsets 159186170, 161571825, 162414803, 163599085, 163982642, 163985143, 165747198). 2.1.218 facts taken from the sibling reports.
- Census source: `eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-claude-main-thread/{cc-readgate-census.mjs,out/readgate-census-fp-claudecode-tab-20260826.json}`; text `forensics/claude-main-thread.md` §4; candidate text `candidates/harness-adaptive-rendering.md` C-2; gate research `research/anthropic-model-product-path.md` §1–2.
- My scripts and outputs: box `/tmp/wf-slatec/c13-mechanism/wrapper-view.mjs`, `wrapper-view-fp-claudecode-tab-20260826-{sweet,native}.json`; local scratch `…/scratchpad/c13/` (same script, `census-rollouts-sweet.json`).
