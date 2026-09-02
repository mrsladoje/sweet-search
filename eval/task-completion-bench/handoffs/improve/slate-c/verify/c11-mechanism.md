# c11 — Claude-code overflow guard — adversarial verify, MECHANISM lens (2026-09-02)

## Verdict

**Refuted as a slate lever; confirmed as hygiene.** The harness half of the mechanism is real
and I reproduced every count: Claude Code 2.1.218 deletes a Bash result above 30,000
characters, leaves a ~2,100-character stub with a file path, and no agent opened that path in
0 of 94 events across four runs (0 of 66 in the three fresh-pool runs). The harm half is not
shown. The flagship exhibit (`bfgroup__b2-259`, sweet, `r2-38`) is an index-coverage artifact,
not a size failure read as absence: all ten deleted `ss-find` outputs on the two b2 tasks
contain zero lines under `src/build/` and zero `configure.jam` lines, because the index of
2026-08-26 did not hold `.jam` files or `src/build/` (register E1, fixed 2026-08-28). The
subagent's "finds only tests" report was true of what `ss-*` could return. Its parent had
ordered it to use `ss-*` only, and the parent itself reached `src/build/configure.jam` with a
native `ls`. The seven deletions were not consecutive; they sit at subagent calls 16, 22, 30,
31, 41 and 51 of 53. Across all 17 genuine `ss-*` deletion events the typical reaction is one
narrower call, not a 4–7 request chain. No deletion coincided with a solve the full output
could have changed. The cost arithmetic (+0.6% on claude-code sweet) is right within 30%, but
its offsetting term (avoided escalation requests) has no support, so the honest ceiling is
+0.4% to +0.8% cost for zero measured solve effect. The candidate's own kill clause then
applies: "hygiene with no measurable effect; belongs in the E2 package, not in a slate."

Confidence in the refutation: 0.8. The residual 0.2 is the un-run offline renderer replay
and the unknown post-index-fix population.

## 1. What the candidate claims

1. Above ~30,000 characters claude-code 2.1.218 replaces a Bash result with a 2,000-character
   preview plus a path that no agent opened (0/66 events, four runs).
2. Deletions cause escalation chains (`-k 200 → 300 → 500`, "seven consecutive") that end in
   a false absence report; two main-thread exhibits (moq-1262, configure-aws-credentials-42).
3. Ceiling: +0.6% cost on claude-code (bounded ~7,000-token result replaces a ~540-token
   stub; 0.061 events/rollout) against escalation chains of 4–7 requests; correctness, not cost.
4. Falsifier: replay 16 over-threshold `ss-*` invocations against the proposed renderer.

## 2. What I opened

- Box, read-only: `results/fp-claudecode-{tab,none,pipe}-20260826/agent-state/**/*.jsonl`,
  `results/rb-claudecode-20260824/agent-state/**/*.jsonl`, the four runs' `rows.json`, and the
  persisted files themselves under
  `agent-state/<task>-sweet/claude-home/projects/<slug>/<session>/tool-results/*.txt`.
- Cited scripts: `/tmp/wf-slatec/harness-adaptive-rendering/{cc-persist2,cc-recover,cc-after,cc-prev}.py`
  (read, not re-run). My own scripts and outputs: `/tmp/wf-slatec/c11-mechanism/` on the box,
  copied to `verify/scripts-c11-mechanism/` here (`persist_census.py`, `recover.py`, `after.py`,
  `persist_census.out`, `recover.out`).
- Local: `candidates/harness-adaptive-rendering.md` §1.2 and C-3, `candidates/DEDUP.md` c11
  entry, `research/anthropic-model-product-path.md` §3.2 and C-A2, `core/search/output-policy.js`
  (`detectAgentEnv`, line 60), `eval/agent-read-workflows/bin/ss-find` header, and the
  Claude Code 2.1.258 bundle at `/Users/admin/.local/share/claude/versions/2.1.258` (strings).
- I did not open HO2, any `HELDOUT2*` list, or any grading log. A local grep for the task id
  listed held-out files; I did not open them.

## 3. Findings

### 3.1 Harness mechanism — CONFIRMED

- [M `persist_census.py`] Unique `tool_use_id` events with `<persisted-output>`:
  TAB 50 (native 34 / sweet 16; `ss-*` 4), NONE 12 (sweet only; `ss-*` 10 by the candidate's
  regex, 9 genuine, see 3.5), PIPE 4 (sweet only; `ss-*` 2), RB 28 (native 26 / sweet 2;
  `ss-*` 2). Total 94; fresh-pool total 66. This reproduces the candidate's table exactly.
- [M] Every record in the four runs carries `version: 2.1.218`.
- [M] Smallest persisted result 30,208 bytes (TAB); largest inline `ss-*` result 28,896
  characters (TAB, subagent). The threshold therefore sits between 28,896 and 30,208.
- [C 2.1.258 bundle] `jcn=30000` is the `BASH_MAX_OUTPUT_LENGTH` default (`Gbe()` clamps an
  env override to at most `Bcn=150000`); persistence threshold `D8e()` =
  `min(tool maxResultSizeChars, aJ=50000)` with a per-tool server override keyed
  `tengu_velvet_ibis`; preview `pNe=2000`. For Bash that is 30,000 characters. Read from
  2.1.258, one build newer than the box; the observed band on 2.1.218 agrees.
- [M] Stub length 1,963–2,227 characters across 94 events, so ~500–560 tokens; the
  candidate's "~540-token stub" holds.
- [M `recover.py`] 95 transcript lines mention `tool-results` — all are the stubs
  themselves. 0 `tool_use` inputs (any tool) and 0 assistant texts reference such a path, in
  any of the four runs, either arm. "Recovery is zero" holds, with denominator 94, not 66.
- [M, live] During this verification Claude Code 2.1.258 persisted my own 36.7 KB Bash result
  with the same stub format. The mechanism is present in the current build.
- [M] Native's 34 TAB deletions: grep 26, find 3, pwd 2, git 2, rg 1. Matches the candidate.

### 3.2 Harm mechanism — REFUTED for the flagship exhibit

Rollout: `fp-claudecode-none-20260826`, `bfgroup__b2-259`, sweet, project dir
`-root--ss-eval-runs-r2-38`, session `26998406-a8e3-4e66-b48c-5a629598a91a` (this is the
main session id, not a subagent id), subagent `agent-ac81ac4efebab094f`.

- [M `after.py`] Seven `ss-find` results were deleted: one on the main thread (call 20 of
  55) and six in the subagent (calls 16, 22, 30, 31, 41, 51 of 53). Only 30→31 are adjacent.
  "Seven consecutive" is wrong; the deletions are interleaved with dozens of non-deleted
  `ss-grep`, `ss-ls` and `ss-find` calls.
- [M] The parent's brief to the subagent reads: "Find the source implementation of
  Boost.Build configure.check-target-builds ... using ss-* search commands only ... Do not
  modify files." 51 of the subagent's 53 tool uses are `ss-*` Bash calls. The grind is the
  confinement, not the deletion.
- [M] The deleted outputs themselves (files still on disk under `tool-results/`): across all
  seven, `configure.jam` occurrences = 0, `src/build/` occurrences = 0. Top paths are
  `src/engine/*.cpp`, `src/engine/build.sh` and `test/*.py`. The same holds for the three
  other b2-259 `ss-find` deletions (TAB r0-52 ×2, PIPE r0-26): 0 and 0. The index on
  2026-08-26 held no `.jam` files and nothing under `src/build/` (register E1; memory
  `index-hygiene-fixes-0828`). So "ss-* searches find only tests, no configure module
  source" was a correct statement about the index. Deletion hid nothing relevant.
- [M] The main thread reached the target with a native shell listing (`ls src/build | head
  -100`, main call 32 of 55) and its final message reports an edit in
  `src/build/configure.jam`. The absence report did not block the parent. The task is
  0/3 in every fresh-pool cell (brief §1.2), so no solve was at stake.
- [M] In the TAB and PIPE b2-259 subagents, the calls after a deletion were narrower
  `ss-grep --in ...` calls followed by a native `Read` of the `.jam` file; both final reports
  name `src/build/configure.jam` or `src/build/targets.jam`. Deletion did not block
  localization there either.

### 3.3 What agents did after each genuine `ss-*` deletion (17 events)

| run | task, arm, thread | tool deleted (chars) | next call | rollout solved |
|---|---|---|---|---|
| TAB | b2-259 sweet sub r0-52 | ss-find -k 200 (31,412) | ss-grep --in one file -k 100 | no (task 0/3 everywhere) |
| TAB | b2-259 sweet sub r0-52 | ss-find -k 200 (38,884) | ss-grep -k 100; later native Read of configure.jam | no |
| TAB | moq-1262 sweet main rep0 | ss-search && ss-read 1–300 envelope (31,272) | ss-read 36–210 (narrower) | no (task 0/3 in claude cells) |
| TAB | aws-credentials-42 sweet main rep1 | ss-read dist/index.js 34500–35000 (72,835) | ss-grep --in dist/index.js -k 20, then done | **yes** |
| NONE | b2-259 sweet main r2-38 | ss-find -k 200 (33,903) | ss-grep --in src -k 500 (not deleted) | no |
| NONE | b2-259 sweet sub r2-38 ×6 | ss-find -k 200/200/300/300/500/500 (32,969–73,580) | ss-ls, ss-find, ss-grep; last → report to parent | no |
| NONE | b2-113 sweet sub r2-30 | ss-read whole file (34,403) | ss-read another file; ss-search narrower | no (sweet 0/3; native 1/3 TAB) |
| NONE | b2-113 sweet sub r2-30 | ss-read whole file (61,410) | ss-search --in that file -k 30; located the function | no |
| PIPE | b2-259 sweet sub r0-26 | ss-find -k 200 (35,721) | ss-find regex \.jam$; ss-read a configure.jam | no |
| PIPE | b2-113 sweet sub r2-28 | ss-find --full -k 200 (31,655) | ss-search --full -k 50; native Read | no |
| RB | apple-145 sweet main rep2 | ss-read 680–735 && ss-trace (39,544) | ss-read 697–750 (narrower) → run_tests → Edit | no (sweet 0/3, native 1/3) |
| RB | apple-145 sweet main rep1 | ss-trace impact (34,531) | ss-read 180–430 → Edit | no |

[M `after.py`] In 15 of 17 events the next call is narrower or moves on. The two exceptions
(`ss-grep --in src -k 500`; the r2-38 `-k` climb) are in the index-gap rollouts. The only
rollout in this table that solved (aws rep1) solved after the deletion with one narrower
call. In no event did the full output hold what the agent later needed and lacked.

### 3.4 Front-loading is already true for search outputs

[M `after.py`, first 2,000 characters of the 17 persisted files] All 11 `ss-find`/`ss-search`
outputs start with the header line, a `# confidence=... sufficient=...` line, and the `## #1
<path:lines>` top address inside the first 2,000 characters (11/11). None carries a
"narrowing command" (0/11). The 6 `ss-read`/`ss-trace` outputs carry the header (6/6) and no
`sufficient=` line (0/6), which is expected for reads. So of the candidate's four required
head items, three already survive a deletion for search outputs; the new content is the
narrowing hint and, for reads, a continue span. The candidate's `[M]` "the head always reaches
the model" is correct.

### 3.5 Denominator and attribution corrections

- "0 of 66 events, four runs" mixes two denominators. Fresh-pool (three runs) = 66; four runs
  = 94. Both are 0 recoveries. [M]
- The NONE and PIPE runs have **no native arm** (`rows.json` native n=0; 0 native agent-state
  dirs). The table cells "persisted native 0 / 0" are absent data, not measurements. [M]
- The NONE `ss-*` count of 10 includes one native envelope: `command -v ss-find || true; ...
  grep -RInE ...` (`bfgroup__b2-113`, r1-27, 81,942 chars). Its output is a `grep -R` dump, no
  `ss-*` header. Genuine `ss-*` deletions: TAB 4, NONE 9, PIPE 2 = **15 of 198** fresh-pool
  sweet rollouts (not 16), **17** with RB (not 18). The falsifier denominator is 15 or 17. [M]
- Rollouts touched: TAB 3/66 (4.5%), NONE 2/66, PIPE 2/66, RB 2/39. 5 of the 7 fresh-pool
  rollouts are the two b2 tasks whose index gap is now fixed; the post-fix population is
  unknown. [M]
- `26998406-...` is the main session id of rep 2, not a subagent session; the six-deletion
  chain is in `agent-ac81ac4efebab094f`, and the seventh deletion is on the main thread. [M]
- Sizes in the stub are KiB: "29.5 KB" = 30,208 bytes. [M]

### 3.6 Ceiling arithmetic

- Events per TAB sweet rollout: 4/66 = 0.0606. Matches 0.061. [M]
- Resident price $0.301/M = $0.10 ingest + 20.1 re-sends × $0.01 (brief §1.1). [I, from brief]
  Two of the four TAB events are in subagents with shorter lifetimes, so this over-prices them;
  the direction is conservative.
- Delta per event: bounded ~7,000 tokens − ~540-token stub ≈ 6,500 tokens × $0.301/M =
  $0.00196. Per rollout: × 0.0606 = $0.000119. Against the brief's claude-code sweet
  $0.020727 that is **+0.57%**; against the `rows.json` non-null mean $0.015127 (57 of 66
  rows; subagent rollouts carry null cost) it is **+0.79%**. Both within 30% of the stated
  +0.6%. [M/I]
- The offset "escalation chains of 4–7 requests at ≈$0.00070" is not supported (3.2–3.3).
  The measured post-deletion recovery is one narrower call: 0.0606 × $0.00070 = $0.00004 per
  rollout = 0.2%, and only if the bounded result removes that call every time. Net ceiling:
  **+0.4% to +0.8% cost, 0 solves at stake** in 237 sweet rollouts (198 fresh-pool + 39 RB).
- Solve veto: no deletion event coincided with a lost solve that the deleted content could
  have prevented (3.3). No solve risk shown either; B12's warning (context size moves cost
  unpredictably) stands untested.
- Codex / opencode 0.0%: correct by construction (CLAUDECODE-gated). [C output-policy.js:60]

## 4. Corrections the synthesis must adopt

1. Replace "seven consecutive ss-find results were deleted ... a size failure was read as an
   absence" with: seven deletions interleaved across a 53-call subagent that its parent had
   confined to `ss-*` tools; the deleted outputs held no `src/build/` or `configure.jam`
   lines because of the 2026-08-26 index gap (E1, since fixed); the absence report was true
   of the index; the parent found the file with a native `ls`.
2. Drop "escalation chains of 4–7 requests" from the ceiling. Measured recovery is one
   narrower call in 15/17 events.
3. Denominators: 0/94 recoveries across four runs (0/66 fresh-pool); genuine `ss-*` deletions
   15/198 fresh-pool sweet rollouts (7 rollouts), 17 with RB; the falsifier replays 15 (or 17),
   not 16.
4. The NONE and PIPE runs have no native arm; remove the "native 0" cells or mark them "not run".
5. `26998406-...` is a main session id; the chain lives in subagent `agent-ac81ac4efebab094f`.
6. Book the item as E2-class hygiene (a CLAUDECODE-gated byte bound plus a narrowing hint /
   continue span in the head), not a slate lever. Its cost is +0.4% to +0.8% on claude-code
   sweet with zero measured solve effect; it never makes sweet cheaper.
7. Note that header, `sufficient=` line and top address already sit in the first 2,000
   characters of every deleted search output (11/11); only the narrowing hint is new.
8. Threshold wording: 30,000 characters is the Bash `BASH_MAX_OUTPUT_LENGTH` default
   (`min(30000, 50000)`), env-overridable up to 150,000 and server-overridable per tool.

## 5. Revised ceiling

Claude-code only. Cost **+0.4% to +0.8%** of the claude-code sweet rollout (+$0.00008 to
+$0.00012 per rollout at 0.061 events per rollout), **0 solves at stake** in 237 sweet
rollouts. Codex 0.0%, opencode 0.0%. Correctness hygiene, not a lever. Post-index-fix event
population unknown.

## 6. What I could not finish

- I did not build or replay the proposed renderer; the falsifier stands un-run. The 17
  deleted outputs are on disk and can be replayed at $0 when a renderer exists.
- I did not price the two subagent events with their own re-send multiplier.
- I did not measure the post-index-fix population (`fixval-claude-code-20260828` has no
  agent-state directory on the box; the cited scripts silently skip it too).
- I read the threshold from the 2.1.258 bundle, not the 2.1.218 binary on the box.

## 7. Evidence checked (paths)

- `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/{rows.json,agent-state/**}`
- `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-none-20260826/{rows.json,agent-state/**}`
  incl. `agent-state/bfgroup__b2-259-sweet/claude-home/projects/-root--ss-eval-runs-r2-38/26998406-a8e3-4e66-b48c-5a629598a91a.jsonl`,
  `.../26998406-.../subagents/agent-ac81ac4efebab094f.jsonl`, `.../26998406-.../tool-results/{bvnjqpr2a,bmqf3q3x6,b682526kx,b5o3sm0pq,b9l0mrkpc,busk21ljx,bj8imustj}.txt`
- `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-pipe-20260826/{rows.json,agent-state/**}`
- `/root/sweet-search-private/eval/task-completion-bench/results/rb-claudecode-20260824/{rows.json,agent-state/**}`
- `/tmp/wf-slatec/harness-adaptive-rendering/{cc-persist2,cc-recover,cc-after,cc-prev}.py` (read)
- `/tmp/wf-slatec/c11-mechanism/{persist_census.py,recover.py,after.py,*.out,persist_events.json}` (mine)
- `/Users/admin/.local/share/claude/versions/2.1.258` (strings: `jcn=30000`, `aJ=50000`, `pNe=2000`, `tengu_velvet_ibis`)
- `core/search/output-policy.js:56-60`; `eval/agent-read-workflows/bin/ss-find:1-8`
- `slate-c/candidates/harness-adaptive-rendering.md`, `slate-c/candidates/DEDUP.md` (c11), `slate-c/research/anthropic-model-product-path.md` (§3.2, C-A2)
