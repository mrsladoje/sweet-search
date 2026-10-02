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
