# OBSERVATIONS.md loop — state (started 2026-10-02)

Owner request: implement every OBSERVATIONS.md entry; each must pass a micro-smoke A/B (few reps); on-par but
mechanistically sound → integrate. Owner answers (2026-10-02): chunker = build + GCSN dev MRR on a temp index,
NO reindex, no A/B until end-of-tuning reindex; A/B models = Claude Code + Opus 5.5 medium (Max plan) and
Codex + GPT-6.1 Sol high (ChatGPT plan); own worktree (this one, branch obs-loop) — a Cursor agent edits main.
No back-compat code, no migrations (hard rule).

## Design
- Retrieval A/B: r3-hard DEV, 11 questions (smoke-ids.txt: highest ss-grep use + the 4 replay diagnostics),
  REPS=2. Codex interleaved (ab.sh cx), Claude Code ABBA sequential (ab.sh cc). Read with analyze.mjs.
- Gutter: task-bench micro-smoke, Claude Code + Opus, TAB vs NONE, 3 tasks x 2 reps (gutter-smoke.sh, prep agent).

## Items
| # | Entry | Status |
|---|---|---|
| 1 | ss-grep full hit line (SS_FIX_GREP_FULLLINE=0 = old) | implementing (agent impl-grep-fullline, this worktree) |
| 2+3 | rules flag line + file-name search + harness prompt halves (SS_FIX_RULES_V2=0 = old) | implementing (agent, own worktree; merge into obs-loop) |
| 4 | ss-read gutter NONE vs TAB on Claude Code | prep (agent prep-gutter); after 1-3 land |
| 5 | chunker C/D (namespace, export macro) | implementing (agent, own worktree), GCSN dev MRR |
| 6 | chunker large-function split | same agent as 5 |

## Log
- 2026-10-02: item 1 committed d2ec22bd. A/B launched: `ab.sh cx fl` (Codex, sweet=FULLLINE=0, sweetB=1, 2 reps)
  and `ab.sh cc fl` (Opus, A=FULLLINE=0, B=1, ABBA, 2 reps). Reviewer agent review-fullline running in parallel.
- review-fullline: 1 real defect (trailing-ws/CRLF match outside window) + 2 cosmetic; fixed e9562e93 (edge cases only; applied mid-run, affects >140-char lines only). Exposure gate OK in captures (sweet=matched word, sweetB=full line).
- Items 2+3 committed 88041ff9 (branch worktree-agent-aafc3a9bf8336cd52), merged into NEW worktree
  ../sweet-search-obs-rules (branch obs-rules = obs-loop + rules) so the rules A/B does not disturb the gutter smoke
  that runs from obs-loop. Exposure OK (old arm hashes 7e282d1b/fc84825e = shipped). Codex rules A/B queued after
  Codex fl (`ab.sh cx rules`, from obs-rules). Claude Code rules A/B: launch MANUALLY from obs-rules after the gutter
  smoke ends (`ab.sh cc rules "SS_FIX_RULES_V2=0" "SS_FIX_RULES_V2=1" 2`). Reviewer review-rules running.
- Gutter: prep-gutter swept/preflighted/launched (tasks jupytext-360, brighterscript-1050, bingo-271; ABBA 4 legs);
  waits for Claude Code fl A/B. Agent will analyze traces.
- review-rules: 4 confirmed defects. Worst = ENGINE bug: `ss-grep <w> -i -w` → 0 hits (wrong literal prefilter from
  `(?i)\b(?:w)\b`). Codex rules A/B wrapper CANCELLED until fixed. Engine fix → impl-grep-fullline on obs-loop
  (lands mid fl-A/B; affects only -i -w calls, rare while rules do not advertise them; noted as minor contamination).
  Rules fixes (CC find contradiction, opencode tool text, MCP, exposure labels, wording, task-row rulesV2 stamp,
  v2 golden pin) → rules agent on its branch; then re-merge into obs-rules and re-run exposure before the A/B.
- 19:20-19:26 an uncommitted prefilter edit was live in obs-loop (impl agent, reverted). Affects only -i/(?i) grep prefilters in fl-B-r2 / fl-r2 rollouts that loaded it; symmetric for Codex interleave. Engine fix goes to a scratch branch → merged into obs-rules now, obs-loop after the gutter smoke.
- fl interim (Codex 12 pairs, CC rep1 11 pairs): calls −15%/−17% (CI<0 both), naive$ −19%/−16% (CI<0), cost −14%/−9% (ns), score +3.2%/−1.1% (ns). Engine fix cea202f2 (obs-iw-fix) merged into obs-rules; Codex rules A/B queued (scratchpad q-cx-rules.sh waits for fl-r2 END).
- fl FINAL (22 pairs each): Codex cost −8.0% [−21.3, +7.7], calls −8.6% [−18.3, +0.7], score +1.7%; Opus cost −3.4% [−7.5, +0.4],
  calls −5.7%, score +2.1%. On par or better, no accuracy loss → candidate ACCEPT pending trace analysis (agent trace-fl → TRACES-fl.md).
- Rules A/B: Codex started 19:52 (obs-rules-r1/r2); Claude Code queued (obs-rules-A/B-r1/r2) from obs-rules. Gutter chain waits for both.
- review-prefilter: cea202f2 unsound for \< \> (NEW) and {start|end} (old) on the rg -F prefilter path (globs / no gram index); gram path safe. Fix → impl agent on obs-iw-fix only. Rules A/B (running on obs-rules with cea202f2) exposed only if agents type \< or {..} — check captures.
- fl ACCEPTED (traces: mechanism works; fewer reads/wide reads; cost = +grep tokens on 100+-hit greps vs −read tokens; no misreads; no contamination). New defects D1 (--in sliding segment match) + D3 (false regex note) → impl agent on obs-iw-fix. Watch item: broad greps (100+ hits) ~2x chars in B.
- obs-iw-fix FINAL 22fc83e1 (cea202f2 -i -w extractor; 44b1cdd4 \<\> {..} per-consumer sets; b06308bc --in root-anchored; ed7f2be5 no false regex note; aefc99b3 fixed-string literal + non-ASCII cut; 22fc83e1 fixed-string case from option only). Re-review: 0 unsound on rg/gram/ascii. Merge into obs-loop after gutter smoke.
- rules FINAL (22 pairs): Opus score −6.4% [−11.0, −0.6] SIG, calls −9.8%, cost −1.5%; Codex score +1.8% ns, cost +9.9% ns, naive −3.1%. Trace analysis trace-rules running → TRACES-rules.md (obs-rules). Gutter: told prep-gutter to stop waiting for load<16 (other sessions keep load 50-75).
- TRACES-rules: Opus drop mostly noise; plausible real effect = flag line → early scoped greps (0/22→10/22). Keep -g '!', full-line statement. Codex rg --files line → useless AGENTS.md lookups (17/22) → drop. → rules v3 (agent aafc…). Defects: GRDB symlink loop in ss-grep output (stale index? query-time?) + ss-search 'Server startup timeout' on GRDB → agent inv-grdb (branch obs-grdb-fix from obs-iw-fix). Plan: v3 A/B (both cells, 2 reps) after v3 + obs-iw-fix merged into obs-rules.
- rules v3 6ddefc24 + obs-iw-fix merged into obs-rules (93133a98); tests 139/139; exposure OK (Codex model instr identical both arms; dev instr 94de14f9 vs fc84825e). Codex v3 A/B `ab.sh cx rules3` launched. Claude Code v3 A/B: after the gutter smoke (Max plan, one CC job at a time).
- Chunker C/D/E DONE 940fda49 (branch worktree-agent-a3a0bc19136a17c02): GCSN dev MRR@10 86.48 → 86.57 (3600 q, seed 42). Bumps CHUNKING_VERSION 1→2 → merge ONLY with the end-of-tuning reindex. Reviewer review-chunker launched.
- inv-grdb 93f93155 (branch obs-grdb-fix from obs-iw-fix): query-time symlink-alias guard in generateRegexMatches (GRDB hasMany 15,444/1,155 files → 468/35); daemon /search 30 s socket cap removed (ss-search 'socket hang up' cause). Loop paths come only from stale eval index. Killed our orphan GRDB maintainer pid 32908 (obs-rules-r1 clone). Merge obs-grdb-fix into obs-rules before CC v3, into obs-loop after gutter.
- OPS: retrieval-bench-282 leaves 3-4 sweet-search-maintainers per finished clone tag alive (orphans, ppid 1). Reaped 45 from finished obs-fl/obs-rules tags 21:27 (59 → 14). Bench defect to fix: reap per-clone maintainers at run end. Note zsh: kill $P with newline list fails silently — use xargs.
- Codex v3 (22 pairs): score +8.9% [−0.1, +24.4], cost −3.6%, calls −4.8%, no AGENTS.md lookups. obs-grdb-fix merged into obs-rules. CC v3 queued after gutter L4 (scratchpad q-cc-rules3.sh).
- Chunker review fixes 305056a1: lost text 0, id collisions 0, names kept via additionalSymbols; GCSN dev 86.53 (base 86.48; ruby −0.7 = ~4/600 q). Re-review running (incl. do tools read additionalSymbols?).
- GUTTER DONE (12 rollouts, CC Opus, 3 tasks ABBA): 0 edit failures / 0 unread errors / 0 mis-anchors both arms; NONE 16 vs 24 ss-reads, ideal $ 0.242 vs 0.264 (−8%, n=6 noise); exposure OK. ACCEPT NONE for Claude Code → impl agent changes default on obs-loop. obs-grdb-fix (incl. obs-iw-fix) merged into obs-loop ce79e8df.
- Chunker re-review 305056a1: 0 lost chars (~3.4k files), 0 id dups, all labels present (labels shown come from graph; additionalSymbols only in embedding text — OK). 2 defects left (Go header grows to 2000 cap; struct EXPORT Fwd; entity) → chunker agent.
- Gutter NONE default for Claude Code: d4191021 (README line reverted; owner to decide README text).
- RULES v3 ACCEPTED. Claude Code (22 pairs): score −2.3% [−8.2, +3.9], cost −5.1%, ss tokens −16% (sig). Codex: score +3.6% excluding one garbled arm-A answer (+8.9% raw), cost −3.6%. Traces (TRACES-rules3.md): no loss traced to a v3 line; -g '!' replaced all native pipes; raw cat 0.
- Combined branch obs-loop 71bad163 (= gutter + rules v3 + all ss-grep/GRDB fixes), tests search/agent-tools/init 2230 pass (2 load flakes pass alone). Pushed origin/obs-loop and origin/obs-chunker. NOT merged to main: Cursor agent has uncommitted edits in 5 overlapping files (10 small hunks). Plan: when Cursor commits, merge obs-loop on top, resolve, test, push main.
