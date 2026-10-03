# diet1 trace analysis (A = p7-final rules, B = rules-diet1 + SS_VARIANT_GREP_BROAD=50:60)

Scope: every call of all 88 rollouts (Codex GPT-6.1 Sol high: 44, interleaved; Claude Code Opus 5.5 medium: 44, ABBA).
DEV set, 11 r3-hard probes, 2 reps per arm. No absence probe is in this set (all `expectedNoMatch: false`).

## Bottom line

- Most score differences between paired rollouts are judge noise on near-identical answers. Example: Codex composer-06 r1
  A 0.90 / B 0.65 with the same three drivers, the same isset rule and the same fallback; CC grdb-02 r1 A 0.725 / B 1.0
  with the same chain. Only one paired score gain links to extra B work (CC drogon-06 r1, below).
- Change 2 is the only change with a strong, consistent behaviour shift that costs calls: CC agents stop using `-A/-B/-C`
  (16 grep commands in A, 0 in B) and replace the context with separate `ss-read` calls.
- Change 1 has a clear Codex side effect: workspace-orientation shell (`pwd; ls -a; find .. -name AGENTS.md`) in 8/22 B
  rollouts vs 1/22 A. It is cheap (about 350 chars, sometimes 1 call) but it is a raw-shell regression.
- Change 7 saves very little (about 256 chars per broad grep) and caused no re-grep, extra read or misread.
- CC wall-time doubling is infrastructure: a cold-daemon window in the B-r2 run. Model time is equal.

## Per-change evidence

### 1. Raw-tool rationale removed
- No code-search raw `grep`/`cat`/`rg` in either arm, both harnesses. No pipe of `ss-*` into native `grep`/`head` in any rollout.
- Codex orientation shell: AGENTS.md lookups in B 8/22 rollouts (composer r1, drogon-10 r1, grdb-02 r1, jj r1, typedoc-02 r1,
  grdb-03 r2, okhttp r2, typedoc-09 r2) vs A 1/22 (drogon-06 r1). `ls -a` 8 vs 1; `rg --files -g AGENTS.md` once (composer B r1).
  Standalone bash calls for this: typedoc-02 B r1 #1, typedoc-09 B r1 #1 / B r2 #1, grdb-02 B r1 #2, grdb-03 B r1 #1, B r2 #1/#2/#4.
- CC: zero raw shell in both arms.
- Verdict: revert (restore "the index covers every file … never beats it"); the effect is small but one-directional.

### 2. ss-grep flag line removed
| | Codex A | Codex B | CC A | CC B |
|---|---|---|---|---|
| ss-grep subcommands | 65 | 55 | 66 | 66 |
| with `-g '!…'` | 10 | 14 | 26 | 22 |
| with positive `-g` | 5 | 7 | 0 | 14 |
| with `--in` | 14 | 4 | 23 | 4 |
| `-i` / `(?i)` | 3 | 0 | 1 | 1 |
| `-w` | 0 | 0 | 0 | 0 |
| `-A/-B/-C` | 0 | 0 | 16 | 0 |
| first grep scoped (pos `-g`/`--in`) | 1/21 | 0/22 | 3/22 | 1/22 |
- B agents still exclude with `-g '!…'` and still scope: they swap `--in` for positive `-g` globs
  (CC composer B r1 `-g 'src/Composer/Repository/Vcs/{GitHub,GitLab,Forgejo}Driver.php'` worked). The tool's own
  footer `see the rest: ss-grep "<regex>" --in <file>` keeps `--in` alive (B used it 8 times).
- "Start broad" removal: no effect. Both arms open broad (unscoped or `!glob` only) in about 95% of rollouts.
- `-i` loss is neutral: Codex B writes `[Ww]eb[Ss]ocket` instead of `-i 'websocket'` (okhttp).
- Context flags (CC only): in the 10 pairs where A used `-A/-B/-C`, B used +7 calls. Example typedoc-09 r1:
  A #4 `ss-grep "deferConversion\(|finalizeDeferredConversion\(\)|function isDirectExport" --in src/lib/converter -A 14`
  gets three bodies in one call (5 calls total, 0.95). B r1 reads the same code in pieces over 9 calls and reads
  `symbols.ts 150 260`, which skips `_convertSymbolNow` (lines 109-125, a CRITICAL fact) → 0.70.
  grdb-02 r2: A `ss-grep "func statementDidFail" -A 30` vs B grep + separate read. typedoc-02 r1: A `-A 3 --in src/frontend`
  vs B one more grep/read round.
- Verdict: revert the context and `--in` parts. Keep "Start broad" cut.

### 3. Language-shaped query advice removed
- Codex interrogative `ss-search` queries: A 4 (3 TypeScript, 1 Rust), B 0. Mean length 9 words in both. Search count 27 vs 26.
- Effect on results cannot be read: 2 of the 3 A TypeScript questions hit the warm-server refusal (defect 1). CC almost never
  uses `ss-search` (A 2, B 1).
- Verdict: keep cut (no evidence of harm; phrasing changed, outcome not measurable here).

### 4. "Prefer callees over impact" removed
- Codex trace mode: A callees 8 / callers 4 / bare 3; B callees 0 / callers 4 / bare 14 / impact 1. Traces 15 → 19.
- Mean trace output 788 → 1173 chars (+49%); about +330 chars per rollout. No score link (dgraph B r2 bare traces of
  AuditRequestHttp/GRPC/WebSockets: 0.6 vs A 0.7, same facts).
- The set has no Python/Ruby trace and the PHP probe used no trace, so the rule's target case is untested.
- Verdict: unclear; behaviour clearly shifts to bare traces. Revert (6 words) unless a Python/Ruby probe shows no harm.

### 5. "main multi-file cost trap" → "do not chase them"
- Reads of files outside the gold file list: CC 19/114 → 28/122; Codex 73/230 (32%) → 77/206 (37%). The files are the same
  set in both arms (typedoc ProjectReflection/context/moduleReflection, drogon HttpRequestImpl.cc). No new hop pattern.
- Verdict: keep cut (weak, not decisive).

### 6. Absence rationale shortened
- No probe in this set expects a negative. No agent stated a negative or ran a third synonym. Untested.
- Verdict: unclear; keep A text until an absence probe is in the smoke set.

### 7. Broad-grep 60-char window
- 18 B ss-grep blocks had ≥50 matches (13 Codex, 5 CC). Truncated lines per block 0-34. Estimated saving vs the 140-char
  window: 4,607 chars total, about 256 chars per broad grep (4.4% of a 5.8k-char block), about 105 chars per B rollout.
- The window centres on the match (`… the call is entirely complete. This is used for WebSockets`), so the hit stays visible.
- Later reads that cover a truncated line are reads that the A pair also made (typedoc-09 moduleReflection.tsx 76-100 and
  DefaultTheme.tsx 175-192 in both arms). The only `--in` re-grep after a broad grep (dgraph B r1 #3) follows the per-file cap
  (`(+15 more in this file)`), not the window. One repeated grep (`ss-grep "hasMany" -k 12` at grdb-03 B r2 #6 and #9) follows
  a daemon crash, not the window.
- Verdict: keep (harmless), but the saving is too small to matter. The per-file cap is the real size control.

## Claude Code: +16% calls (87 → 101)
| probe | A calls | B calls | Δscore (sum of 2 reps) | cause |
|---|---|---|---|---|
| typedoc-02 | 6 | 10 | −0.16 | no `-A` context; extra grep/read rounds (B r2 6 calls) |
| typedoc-09 | 11 | 15 | −0.15 | no `-A` context; B r1 9 calls, missed `_convertSymbolNow` |
| drogon-06 | 6 | 9 | +0.45 | B r1 #4-#5 grep `"HEAD|HEAD"|HEAD,` + read router → found CORS and `OPTIONS *` sites that A r1 (0.55) missed: real gain |
| drogon-10 | 8 | 10 | +0.20 | B both reps grep `'"\{%'` → 0 matches (source has `"\\{%`): wasted; answers same as A |
| grdb-02 | 7 | 9 | +0.42 | B r1 extra `ss-semantic` + grep; answers equal to A → judge noise |
| others | 49 | 48 | +0.24 | noise |
- About half the extra calls come from the missing context flags; one pair (drogon-06 r1) turned extra calls into facts;
  the rest are wasted or neutral. The +6.5% score is mostly noise: 3 of the 5 gains are on equivalent answers.

## Claude Code: wall time +93%
- Transcript timing split (tool_use → tool_result): model time A 491 s, B 506 s (+3%).
- B-r2 first `ss-*` call took 48-110 s in 9/11 rollouts (688 s of the run's 1,018 s). Other tool time B 90 s vs A 79 s.
  Without first-call latency B is +7%.
- Cause: B-r2 started 14:15:55, but its "warming 8 ss-* servers" phase ran to 14:26:01 (B-r1 took 1.5 min, A-r2 4 min). The same
  window has the Codex r1 typedoc rollouts (14:15-14:29) that got "warm server is not ready" and ran 465-716 s. The reaper
  stopped 33-34 daemon/maintainer processes per run. This is machine/daemon contention, not prompt work.

## Defects seen in ss-* output
1. Benchmark wrapper refuses search: `[ss-search] warm server is not ready; refusing cold direct search in benchmark wrapper`
   (Codex r1 typedoc-02 A #2, B #2/#14; typedoc-09 A #3/#19, B #2). Agents then ran `ps -eo …` (49k-177k chars of output)
   and the rollouts took 465-716 s. Both typedoc r1 pairs are contaminated.
2. Daemon crash mid-run: `[ss-*] crash: Error: Sweet Search daemon closed the connection before answering /search`
   (Codex r2 grdb-02 A #1, B #1; grdb-03 B #5). One call returned empty output (grdb-03 B r2 #3); the agent switched to
   `/bin/zsh -c`, ran `ps -axo …` (182k chars) and repeated `ss-grep "hasMany"`.
3. Symlink loop in the GRDB index: `Tests/CustomSQLite/GRDB -> ../..`. Every grdb `ss-trace` lists recursive alternatives
   `Tests/CustomSQLite/GRDB/Tests/CustomSQLite/GRDB/…/TransactionObserver.swift:354`. The eval index predates the no-follow fix
   (reindex owed). ss-grep counts look unaffected.
4. Missing caller edge: `ss-trace statementDidFail callers` → `## callers (0)` for TransactionObserver.swift:354, but
   Database+Statements.swift:496 calls it as `try observationBroker?.statementDidFail(statement)` (Swift optional-chained call).
   The agent fell back to a manual read (grdb-02 Codex B r2 #10-#11).
5. Ambiguous trace picks a thin wrapper: `getReflectionClasses` resolves to DefaultTheme.tsx:98-101 (method wrapper) not the
   function at :340; `convertSymbol` resolves to converter.ts:382-388 with fan-out=0. Confusing but recoverable.
6. Not defects: `ss-read … ENOENT` on guessed paths (settings.tsx, DatabaseObservationBroker.swift) gave a correct
   "locate it first" hint; `ss-grep '"\{%'` 0 matches is correct for the source text `"\\{%`.

## Recommendation
Ship B minus changes 1, 2 (context and `--in` parts) and 4. Next variant "diet2" = B plus:
- raw-tool line: restore the clause "the index covers every file, so a raw scan never beats it";
- usage line: `ss-grep "<regex>" [-k N] [-g '<glob>'|-g '!<glob>'|--in <path>] [-A/-C N]`;
- restore "Prefer callees over impact (especially Python/Ruby/PHP)";
- keep cuts 3, 5, "Start broad", and the 50:60 window; keep the absence rationale (6) until an absence probe is in the set.
Before the next A/B: fix the warm-server refusal and the daemon crash, and do not run two cells while one is in its warm-up
phase. Add one absence probe and one Python or Ruby trace probe to the smoke set.
