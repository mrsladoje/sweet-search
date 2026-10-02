# Rules v3 micro-smoke — trace analysis (2026-10-02)

Read-only analysis of every tool call in all 88 rollouts. No model calls.
Arm A = old rules (`SS_FIX_RULES_V2=0`), arm B = v3 text (commit 6ddefc24). 11 r3-hard DEV questions × 2 reps per arm per harness.
Codex ran 21:06–21:43. Opus ran 22:30–23:01, after the symlink fix (93f93155) was merged at 21:59.

## Conclusion

1. **Ship v3.** No Opus loss in the traces comes from a v3 line. The two biggest Opus drops (dgraph, composer) have the same facts in A and B. The gap is judge variance.
2. **"Start broad" did not reduce narrow first greps on Opus. It changed what the scoping is.** Narrow first grep (`--in` or a path include): v2 6/22, v3 5/22. Exclude-only or file-type first grep: v2 4/22, v3 14/22. Truly broad: v2 12/22, v3 3/22. Exclusions removed only noise. They never hid a gold file.
3. **On Codex, v3 restored broad first greps.** Narrow first grep: v2 10/22, v3 2/22 (A 0/20).
4. **The Codex score gain is mostly one broken A answer.** Codex A jj-11 r2 returned a garbled draft (520 chars, score 0.1). Without that pair: +3.6%, not +8.9%.
5. **The banned `cat` is gone.** v2 had 2 raw `cat` calls. v3 has 0. The one `find` call was followed by `ss-read`.
6. **The AGENTS.md hunt on Codex is smaller but not gone.** v2: 17/22 B rollouts. v3: 10/22 B, 2/22 A.
7. **One new tool defect:** `ss-semantic` rejects `-k`, and 2 Codex calls failed on it.

## 1. First-grep scoping rate

The first `ss-grep` command in each rollout, per arm. "Narrow" = `--in <path>` or a `-g` path include. "Filter" = `-g '!…'` excludes only, or a file-type include (`*.swift`, `src/**`).

| | Opus A | Opus B v2 | **Opus B v3** | Codex A | Codex B v2 | **Codex B v3** |
|---|---|---|---|---|---|---|
| narrow (`--in` / path `-g`) | 0 | 6 | **5** | 0 | 10 | **2** |
| filter only (excludes / file type) | 0 | 4 | **14** | 0 | 2 | **1** |
| broad | 22 | 12 | **3** | 20 | 10 | **19** |
| any scope (v2 report's definition) | 0/22 | 10/22 | **19/22** | 0/20 | 12/22 | **3/22** |

All `ss-grep` commands, not only the first: scoped Opus A 23%, B 85%; Codex A 9%, B 36%.

The five narrow Opus first greps in v3:

| rollout | first grep | result | score B vs A |
|---|---|---|---|
| dgraph-09 B-r1, B-r2 | `ls ee/audit; ss-grep … --in ee/audit` | wrong path, call exits with an error, one call lost. v2 B-r2 did the same. The model expects an older dgraph layout. | 0.70 / 0.80 vs 0.90 / 0.85, same facts (see section 2) |
| drogon-10 B-r1, B-r2 | `--in drogon_ctl/create_view.cc`, `--in drogon_ctl` | correct file at once | 0.90 / 1.00 vs 0.85 / 0.90 |
| grdb-02 B-r2 | `--in GRDB/Core/Database.swift` | 331 chars, then it broadened on the next call | 0.80 vs 0.60 |

The narrow-first loss mechanism from v2 (composer, case-sensitive grep in one folder) did not appear.

## 2. Opus questions that lost points in B

Mean of 2 reps. The rep gap is the difference between the 2 reps of one arm.

| question | A | B | B−A | rep gap A | rep gap B |
|---|---|---|---|---|---|
| jj-11 | 0.750 | 0.600 | −0.150 | 0.30 | 0.00 |
| dgraph-09 | 0.875 | 0.750 | −0.125 | 0.05 | 0.10 |
| composer-06 | 0.850 | 0.750 | −0.100 | 0.00 | 0.00 |
| typedoc-09 | 0.925 | 0.865 | −0.060 | 0.05 | 0.03 |
| grdb-03 | 0.787 | 0.750 | −0.037 | 0.18 | 0.30 |
| okhttp-06 | 0.450 | 0.450 | 0.000 | 0.00 | 0.20 |
| ocelot-04 | 0.885 | 0.887 | +0.002 | 0.07 | 0.03 |
| drogon-06 | 0.725 | 0.750 | +0.025 | 0.15 | 0.20 |
| drogon-10 | 0.875 | 0.950 | +0.075 | 0.05 | 0.10 |
| typedoc-02 | 0.675 | 0.750 | +0.075 | 0.15 | 0.10 |
| grdb-02 | 0.725 | 0.825 | +0.100 | 0.25 | 0.05 |

5 questions down, 5 up, 1 level (v2: 10 of 11 down).

Cause of each loss, from the trace and the answer (facts checked against expectedFacts):

| rollout | B vs A | what is missing | cause in the trace | v3 line involved? |
|---|---|---|---|---|
| jj-11 B-r2 | 0.60 vs 0.90 | `snapshot_working_copy`, `finish_transaction` | It never read `cli_util.rs` 2086–2167 or 2342–2390. Its second grep for `.check_out(` was `--in lib/src`. Its `--in cli_util.rs` grep used a prose pattern (`working copy.*immutable`) that matches no code. A-r2 found both with `\.new_commit\(` in `cli_util.rs`. A-r1 and B-r1 have the same miss with no narrow scope (both 0.60). | Partly. The narrow second grep is a scope choice, but the same miss happens without it. |
| dgraph-09 B-r1, B-r2 | 0.70 / 0.80 vs 0.90 / 0.85 | nothing extra. All four answers have the same 4 facts and all four miss the "auditor on after health check" fact. | First call lost on the wrong path `ee/audit`. The other calls are the same as in A. | No. The score gap is judge variance on equal answers. |
| composer-06 B-r1, B-r2 | 0.75 / 0.75 vs 0.85 / 0.85 | nothing extra. All four answers name GitHub, GitLab (authentication) and Forgejo, the `isset` rule and the `gitDriver` fallback. All four miss `ArrayLoader` and the GitHub API-off case. | B used 3 calls, A used 4–5. The facts are the same. B-r1 also says that Bitbucket has no such mapping. | No. Judge variance. |
| typedoc-09 B-r1 | 0.85 vs 0.95 | the deferral of exports named `default` | It read `symbols.ts` 95–160, 935–1030 and `converter.ts` 590–625. It did not read the sort or the `default` branch (`symbols.ts` 194–204). Its first grep only excluded `**/test/**`. B-r2 found the fact (0.88). | No. Read-window choice. |
| grdb-03 B-r1 | 0.60 vs 0.70 | the `joinExpression` call path from the SQL generator | It stopped after 4 calls. It read `SQLRelation.swift` 870–920 only. A-r1 also read 825–858. Its first grep was broad. B-r2 scored 0.90 (A-r2 0.875). | No. Early stop. |
| drogon-06 B-r1 | 0.65 vs 0.80 | CORS `GET,HEAD,` in HttpControllersRouter; `renderHeaderForHeadMethod` | `Head\b` is case-sensitive and does not match `HEAD`. A-r1 found the CORS line with `"HEAD\|HEAD"`. This is the same miss as in v2. `-i` was not used. B-r2 scored 0.85 (A-r2 0.65). | No. Regex case. The `-g '!**/HttpClient*'` exclusions were correct. |
| okhttp-06 B-r1 | 0.35 vs 0.45 | `upgradeToSocket` / `useAsSocket` facts | 3 calls, the same shallow pattern as both A reps. All 4 rollouts miss these facts. | No. |

**Verdict for Opus:** −2.3% (95% CI −8.2 to +3.9) is noise. Two of the three largest drops have identical facts in A and B. One loss (jj B-r2) has a narrow grep in it, but A-r1 has the same miss without one.

## 3. Use and usefulness of the flags and file-name tools

Counted per command inside batched calls.

| | Opus A | Opus B | Codex A | Codex B |
|---|---|---|---|---|
| `ss-grep` commands | 75 | 61 | 58 | 69 |
| `--in` | 17 | 22 | 5 | 13 |
| `-g '!<glob>'` (globs / commands) | 0 / 0 | 41 / 27 | 0 / 0 | 25 / 10 |
| `-g '<glob>'` include (globs / commands) | 0 / 0 | 6 / 6 | 0 / 0 | 11 / 7 |
| `-A/-B/-C` | 0 | 5 | 0 | 2 |
| `-i` | 0 | 0 | 0 | 1 |
| `-w` | 0 | 0 | 0 | 0 |
| native `grep` / `head` / `awk` pipes | 9 / 2 / 1 | 0 / 0 / 0 | 0 | 0 |
| `find` | 0 | 1 | 0 | 2 (both AGENTS.md) |
| `ls` | 0 | 3 | 0 | 5 |
| `rg --files` | 0 | 0 | 0 | 8 (all AGENTS.md) |
| raw `cat` (banned) | 0 | 0 | 0 | 0 |

- **`-g '!<glob>'` is useful.** Opus used it in 27 of 61 greps. It replaced all 12 native pipes from A (`| grep -v tests`, `| head`, `| awk`). Typical uses: drogon-06 `-g '!**/HttpClient*'` (the gold notes name the client a decoy), typedoc `-g '!src/test/**'`, jj `-g '!**/tests/**'`. No exclusion hid a gold file. Opus ss tokens fell 16% (CI −28 to −5), which agrees with less test and decoy noise.
- **`-g '<glob>'` include is useful when the tree is right.** Codex jj B-r1 `-g 'cli/src/**' -g 'lib/src/**'` scored 1.0. Opus used it mostly as a file-type filter (`*.swift`, `src/**`).
- **`--in` is neutral to useful.** The only waste is the dgraph `ee/audit` guess (2 calls). The "scope not found" message is clear, and the agent recovers on the next call.
- **`-A/-B/-C` is neutral.** It was used next to reads, not in place of them.
- **`-i` and `-w` are almost unused.** The one `-i` call (Codex drogon-06 B-r1, `ss-grep 'head' -i --in lib`) returned 20k chars of `header`/`headers` noise, as the question notes predict. drogon-06 Opus B-r1 is a case that `-i` (or `HEAD`) fixes, but Opus did not use it.
- **File-name search:** Opus B used it 4 times. `ls src/frontend/typedoc/components` and `find src/frontend -name 'Filter*'` (typedoc-02) were each followed by `ss-read`, as v3 says. The other 2 were the wrong-path `ls ee/audit` (dgraph). Codex used it only for orientation and the AGENTS.md hunt.

## 4. AGENTS.md lookups on Codex

| | v2 B | v3 A | v3 B |
|---|---|---|---|
| rollouts that look for AGENTS.md | 17/22 | 2/22 | 10/22 |
| how | `rg --files -g 'AGENTS.md'` | `ss-grep "AGENTS\.md"` | 8 × `rg --files -g 'AGENTS.md'`, 2 × `find .. -name AGENTS.md` |
| calls that exit 1 because of it | 5 | 0 | 1 (typedoc-02 r1, `rg` last in the batch) |

- The harness line is gone, so the hunt is down by 41%. The rules file-name line still names `rg --files`, and Codex's stock prompt makes AGENTS.md files important. A also looks twice, so part of it is stock behaviour.
- The cost is small. The output is empty and the call is batched with real work. Only 1 call in v3 shows an error.
- Optional fix: remove `rg --files` from the rules file-name line (keep `find -name` and `ls`). Do not block the ship on it.

## 5. Defects in outputs

1. **`ss-semantic` rejects `-k` (new, Codex B, 2 calls).** drogon-10 r1 and composer r2 passed `-k 5` / `-k 2`. The tool printed `Usage: ss-semantic <file> "<question>" [--max-tokens N]`, and the batched call exited with an error. Agents carry `-k` over from the other `ss-*` tools. Fix: accept `-k` as a no-op or map it to a span count. This is a tool bug, so fix it now.
2. **The symlink loop is present only in the Codex outputs, both arms.** GRDB outputs show `Tests/CustomSQLite/GRDB/Tests/CustomSQLite/GRDB/…` paths (up to 547 mentions in one rollout). The Codex runs (21:06–21:43) were before the fix was merged (21:59). The Opus GRDB runs (after the merge) show 0 loop paths. The fix works. The Codex GRDB numbers are inflated in both arms.
3. **`ss-search` crash `socket hang up`, 1 call** (Codex A r2 grdb-02, before the fix). Opus did not use `ss-search` on GRDB.
4. **Codex A jj-11 r2: garbled final answer.** The answer is 520 chars of draft notes ("… five bullet each clear function match expected. Use duplicate same file grouping …"). The trace before it is complete (7 calls, all correct files). This is a model output defect, not a tool defect. It accounts for most of the Codex score gain.
5. **Opus wall time +54% is a stall, not behaviour.** Three B-r1 rollouts (okhttp, ocelot, typedoc-02) started within 18 s of each other. They ran 98–143 s with 2–4 calls. All other rollouts ran 14–53 s. The cause is not verified (API latency or the daemon). Cost does not change.
6. **Wrong-path guess `ee/audit` in dgraph** (Opus B, both reps, and v2 B-r2). The scope error message is correct. No change needed.

## 6. Verdict

**Ship v3.**

| v3 line | decision | reason |
|---|---|---|
| flag line, `-g '!<glob>'` first | keep | It is the most used new flag. It removed decoys and test noise and replaced all native pipes. Opus ss tokens −16%. |
| "Start broad; scope only after a broad grep shows where" | keep | Codex narrow first greps went from 10/22 to 2/22. Opus narrow first greps did not change (5/22), but none of them caused a loss. |
| `-i -w -A/-B/-C` | keep | They cost almost nothing. `-i` and `-w` are almost unused. |
| "read what you find with `ss-read`, not `cat`" | keep | Raw `cat` went from 2 to 0. |
| no Codex harness line | keep | The AGENTS.md hunt fell from 17/22 to 10/22. |
| `rg --files` in the rules file-name line | optional change | It is the likely trigger for the remaining Codex AGENTS.md hunt. |

Numbers to quote: Opus score −2.3% (CI −8.2 to +3.9), cost −5.1%. Codex score +3.6% without the broken A answer (+8.9% with it), cost −3.6%. All CIs cross 0 except Opus ss tokens.
