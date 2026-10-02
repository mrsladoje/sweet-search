# Rules v2 micro-smoke — trace analysis (2026-10-02)

Read-only analysis of every tool call in all 88 rollouts. No model calls.
Arm A = rules v1 (`SS_FIX_RULES_V2=0`), arm B = rules v2. 11 r3-hard DEV questions × 2 reps per arm per harness.

## Conclusion

1. **The Opus score drop has no single cause in the traces. No v2 line explains it alone.** Each lost point comes from a different search miss. Rep-to-rep noise inside one arm (mean gap 0.17) is 3× the arm gap (0.05).
2. **But one behaviour change is real and may cost a little recall: v2 makes both agents scope their greps early.** Scoped greps (`--in` or `-g`): Opus 33% → 72%, Codex 2% → 71%. Scoped *first* grep: Opus 0/22 → 10/22, Codex 0/20 → 12/22. Three of the four worst Opus B rollouts start with a scoped grep. The effect on score is not proven (n = 10 vs 12). The flag line is the likely trigger.
3. **The "full line" statement did not make Opus read less.** Lines read with `ss-read`: A 5360, B 5201 (−3%). `ss-read` segments: 118 vs 121. Answer length: 2470 vs 2464 chars. Codex B read 32% more lines.
4. **The file-name line is almost unused by Opus and misused by Codex.** Opus: 2 `find -name` calls (both followed by a banned raw `cat`). Codex: 17 of 22 B rollouts run `rg --files -g 'AGENTS.md'`. 0 of 22 A rollouts do. It finds nothing and makes 5 tool calls exit with an error.
5. **Codex cost +9.9% is cache, not behaviour.** Total input −3%, output −10%, reasoning −27%. Uncached input +25% (23.0k → 28.8k per rollout). Cold first requests: A 3/22, B 6/22. Later-turn cache miss: 7.8% → 9.9%. The runner logged a cache-fairness warning for this run.
6. **Two engine defects found, both arms, unrelated to v2:** `ss-grep` follows a symlink loop in GRDB, and `ss-search` crashes on GRDB (`socket hang up`).

**Keep:** the `-g` / `-g '!'` part of the flag line, and the full-line statement. **Change:** remove the Codex `rg --files` harness line, or say "file names in this repository" so it does not trigger the AGENTS.md hunt. **Retest:** the flag line with a hint to start broad (see Recommendation).

## 1. Opus score drop (0.809 → 0.757)

### Per question (mean of 2 reps)

| question | stratum | A | B | B−A | rep gap A | rep gap B |
|---|---|---|---|---|---|---|
| dgraph-09 | completeness | 0.815 | 0.650 | −0.165 | 0.13 | 0.20 |
| drogon-06 | completeness | 0.870 | 0.760 | −0.110 | 0.18 | 0.12 |
| jj-11 | completeness | 0.850 | 0.750 | −0.100 | 0.30 | 0.50 |
| typedoc-02 | chain | 0.775 | 0.700 | −0.075 | 0.35 | 0.00 |
| drogon-10 | cross-layer | 0.925 | 0.850 | −0.075 | 0.15 | 0.30 |
| composer-06 | completeness | 0.780 | 0.725 | −0.055 | 0.36 | 0.25 |
| ocelot-04 | chain | 0.950 | 0.900 | −0.050 | 0.10 | 0.00 |
| grdb-03 | chain | 0.845 | 0.812 | −0.032 | 0.09 | 0.12 |
| typedoc-09 | completeness | 0.850 | 0.825 | −0.025 | 0.00 | 0.15 |
| okhttp-06 | completeness | 0.475 | 0.450 | −0.025 | 0.15 | 0.20 |
| grdb-02 | chain | 0.760 | 0.900 | +0.140 | 0.12 | 0.00 |

- 10 of 11 questions are lower in B. This is the strongest argument against pure noise.
- Most deltas are small next to the rep gap.
- Completeness questions lose more (mean −0.080) than chain or cross-layer questions (−0.018). This matches a recall problem.
- Missing judges do not explain it. DeepSeek dropped on 7 rows (5 A, 2 B). On the 16 pairs with all 3 judges, the drop is the same (0.778 → 0.733).
- Run order was ABBA (A-r1 20:05, B-r1 20:14, B-r2 20:23, A-r2 20:36). There are no errors or timeouts.

### The big B losses, from trace and answer (fact check against expectedFacts)

| rollout | score | what is missing | cause in the trace | v2 line involved? |
|---|---|---|---|---|
| dgraph B-r2 | 0.55 (A 0.75/0.88) | worker gRPC server has no interceptor; auditor turns on only after the health check | First grep `--in ee/audit`: wrong path, scope error. Then it used `ss-search` and read only `interceptor.go` 97–130. It never grepped `grpc.NewServer` or read `worker.go`. 4 calls, then it stopped. | Partly. The flag line made `--in` the first move. The wrong path cost one call. Stopping early is the real loss. |
| jj B-r1 | 0.50 (B-r2 1.0) | `snapshot_working_copy`, `finish_transaction` | It read `cli_util.rs` 1370–1420, 1530–1560, 3060–3100 and 740–770, but never 2086–2167 or 2342–2390. A-r1 has the same miss (0.70). | No. B-r2 found both with `-g 'cli/src/**'` greps and scored 1.0. |
| drogon-10 B-r2 | 0.70 (B-r1 1.0) | `parseLine` by name; the `{% %}` form | It read `create_view.cc` 25–140 and missed the placeholder branch at 149–165. The grep `'"\{%"|"%\}"'` quoted the regex wrong and got 0 hits. | Weak. The first grep was `-g '*.cc'` on a guessed literal. The real loss is the quoting error. |
| drogon-06 B-r1, B-r2 | 0.82, 0.70 (A 0.78/0.96) | the CORS `GET,HEAD,` line in HttpControllersRouter; `renderHeaderForHeadMethod` | Neither B regex matched upper-case `HEAD` in `"GET,HEAD,"` (`\bHead\b`, `"HEAD"`). A-r1 and A-r2 found it with `HEAD\b`. The `-g '!**/*Client*'` exclusions removed only decoys. | No. The regex choice caused it. The `-g` exclusions were correct. |
| composer B-r1 | 0.60 (A 0.96/0.60) | ForgejoDriver; the "manifest value wins" fact | First grep `"archived" --in src/Composer/Repository/Vcs` is case-sensitive, so it misses Forgejo's `isArchived`. It never broadened. Codex B-r1 has the **same** miss (0.80 → 0.45). | Partly. The early `--in` narrowed the search. `-i` was in the flag line but neither agent used it. A also grepped "archived" first, but broad, and then broadened again. |
| okhttp B-r1 | 0.35 (A 0.55/0.40) | `upgradeToSocket` / `useAsSocket` facts | 2 calls only: one grep, then three reads. A-r2 does the same (0.40). | No. It is the same shallow behaviour in both arms. |

### Did B stop earlier, read less, or trust grep lines?

- **Calls:** fewer (4.64 → 4.18). B packs more commands into one call: ss-read segments 118 → 121.
- **Reading:** the same (5360 vs 5201 ranged lines). There is no sign that the full-line statement replaced reads.
- **Context flags:** `-A/-B/-C` went from 1 to 16 uses. They were used together with reads, not in place of reads. Rollouts that used them did not score lower (grdb-02 B with `-C 6`: 0.90 vs A 0.70/0.82).
- **Scoping:** see the table below. Mean delta vs the A mean: rollouts with a scoped first grep −0.076 (n = 10), broad first grep −0.032 (n = 12). The worst B rollouts: dgraph r2, drogon-10 r2, composer r1 and drogon-06 r2 start scoped; jj r1 starts broad.

**Verdict for Opus:** mostly noise. There is one plausible small real effect: earlier, narrower greps lose recall on completeness questions. If that effect is real, the flag line causes it (`--in` / `-g` as a first move). The file-name line and the full-line statement do not appear in any loss.

## 2. Usage of the new affordances

ss-grep segments, counted per command inside batched calls:

| | Opus A | Opus B | Codex A | Codex B |
|---|---|---|---|---|
| ss-grep segments | 81 | 71 | 62 | 83 |
| `--in` | 27 | 34 | 1 | 50 |
| `-g '<glob>'` (include) | 0 | 14 | 0 | 6 |
| `-g '!<glob>'` (exclude) | 0 | 17 | 0 | 20 |
| `-A/-B/-C N` | 1 | 16 | 0 | 7 |
| `-i` | 0 | 0 | 0 | 2 (plus one inline `(?i)`) |
| `-w` | 0 | 0 | 0 | 0 |
| scoped greps (`--in` or `-g`) | 33% | 72% | 2% | 71% |
| first grep scoped | 0/22 | 10/22 | 0/20 | 12/22 |
| `\| grep -v` / `\| head` pipes | 9 | 0 | 3 | 2 |
| `rg --files` | 0 | 0 | 0 | 21 (17 for AGENTS.md) |
| `find -name` | 0 | 2 | 0 | 0 |
| `ls` | 0 | 0 | 0 | 1 |
| raw `cat` (banned) | 0 | 2 | 0 | 0 |
| ss-find / ss-trace / ss-semantic | 2 / 0 / 0 | 0 / 0 / 0 | 16 / 16 / 26 | 0 / 8 / 17 |

Was each affordance useful?

- **`-g '!<glob>'` is useful.** It removed test, example and decoy files cleanly: drogon-06 `-g '!lib/src/HttpClientImpl.cc'` (the gold notes name it a decoy), typedoc-09 `-g '!src/test/**' -g '!**/locales/**'`. It replaced all 9 Opus `| grep -v tests` pipes. In every case I checked, the `-g` filters worked as the header line shows.
- **`-g '<glob>'` include is useful when the agent picks the right tree.** jj B-r2 `-g 'cli/src/**' -g 'lib/src/**'` found the two functions that B-r1 and A-r1 missed.
- **`--in` as a first move is risky.** It caused the dgraph wrong path (the error message is clear, but the call was lost). It also put composer on a narrow case-sensitive path in both harnesses.
- **`-A/-B/-C` is neutral.** It is used next to reads and shows no harm.
- **`-i` and `-w` are almost unused.** The composer miss is exactly the case that `-i` fixes, but no agent used it there.
- **Opus file-name search:** 2 calls, the same in both typedoc-02 B reps: `find src/frontend -name 'Filter*'` and then `cat src/frontend/typedoc/components/Filter.ts`. `cat` is still banned. A found the same file with `ss-grep "class Fil…"`. The calls were neutral for finding the file, and they broke a rule.
- **Codex file-name search is mostly waste.** 17 of 22 B rollouts look for `AGENTS.md`. The likely cause is the restored stock line. Codex's stock prompt makes AGENTS.md files important, so the agent looks for them as soon as it has a file-name tool. The output is empty, so the cost in tokens is small. But `rg` exits 1 on no match, so 5 batched calls show an error (jj ×2, okhttp, typedoc-09, drogon-10, grdb-02). The useful uses: ocelot `rg --files -g '*BaseUrlFinder*'` recovered from a wrong `ss-read src/Infrastructure/BaseUrlFinder.cs` and found a gold file. dgraph `-g '*audit*'` confirmed the audit files. There were 3 standalone `rg --files` calls (grdb-03 ×2, jj ×1). These are the 0.14 native searches per question.
- **Codex tool mix changed:** ss-find 16 → 0, ss-trace 16 → 8. The extra power of ss-grep replaced them. The Codex score did not suffer (+1.8%, not significant).

## 3. Codex cost: +9.9% realized, −3.1% naive

The cause is cache variance, not behaviour.

| per rollout (mean) | A | B |
|---|---|---|
| input tokens | 236,982 | 230,134 (−3%) |
| cached input | 213,940 | 201,338 |
| uncached input | 23,042 | 28,796 (+25%) |
| cache hit | 90.3% | 87.5% |
| first request uncached | 5,853 | 7,539 |
| first request cold (cache read 0) | 3/22 | 6/22 |
| later turns uncached | 17,189 | 21,257 (miss 7.8% → 9.9%) |
| output / reasoning | 1,812 / 684 | 1,639 / 502 |

- The v2 prompt is about 150 tokens longer (first request 15,628 → 15,713). Each arm warms its own prefix, so the prefix difference itself is small.
- The extra cost is concentrated in 5 rollouts with mid-rollout cache loss: composer r1/r2 (hit 63% and 56%), grdb-02 r1/r2, and jj r2 (57%). A small prompt change at the start cannot cause misses on later turns of the same rollout. Provider routing can.
- The runner logged this: "cache fairness WARNING … sweetB 1/3 cold, reads [0,8192,14464]; sweet 0/3 cold, reads [11904,11904,11904]".
- Behaviour is equal or slightly cheaper: −3% input, −10% output, calls −0.7%.

## 4. Defects in outputs

1. **`ss-grep` follows a symlink loop (both arms, GRDB, high cost).** `Tests/CustomSQLite/GRDB -> ../..` is a git-tracked symlink. `ss-grep` hits repeat through it at least 3 levels deep, for example `Tests/CustomSQLite/GRDB/Tests/CustomSQLite/GRDB/GRDB/QueryInterface/SQL/Table.swift`. `ss-grep "hasMany" -g '*.swift'` reports 15,444 matches across 1,155 files. There are 4,814 such path mentions in the GRDB outputs of this run. Opus's first GRDB-02 grep returned 16–21k chars. This is likely the "every git-visible file for grep" path from commit d013b492, or the unindexed-file walker. The index side already has no-follow (code-graph fixes). The grep walker needs the same rule. This is a bug, so fix it now.
2. **`ss-search` crashes on GRDB (Codex, both arms, 5 calls in 4 rollouts).** The output shows `[AutoStart] Server startup timeout, using cold start` and then `[ss-*] crash: Error: socket hang up`. It happened in grdb-03 A-r1, A-r2 and B-r1, and in grdb-02 B r1 and r2. Opus GRDB runs used no `ss-search`, so they did not hit it. Cause not verified. The symlink loop above is a candidate (the cold start walks the tree).
3. **The Codex AGENTS.md hunt makes batched calls exit 1** (see section 2). It is not an engine bug, but it is a v2 side effect.
4. **Raw `cat` after `find`** in Opus typedoc-02 B (both reps). It is a rule violation under both v1 and v2. It appeared only after `find` was allowed.
5. The scope error message for a wrong `--in` path is good: "scope not found: ee/audit — nothing was searched under that path. This is NOT an absence of matches." No change needed.

## Recommendation

| v2 line | keep? | reason |
|---|---|---|
| full-line statement (`file:line: <full line>`) | **keep** | It is true now and causes no read reduction in either harness. |
| flag line: `-g '<glob>'` / `-g '!<glob>'` | **keep** | It is the most useful new affordance. It removed decoys and replaced `\| grep -v` pipes. |
| flag line: `--in`, `-A/-B/-C`, `-i`, `-w` | keep, add a hint | Add "start broad; scope only after a broad hit" to the line. Early `--in` is the one plausible loss mechanism. `-i` is unused, so keep it only if it costs nothing. |
| rules file-name line (`rg --files` / `find` / `ls`) | keep for now, low value | Opus used it twice and then broke the `cat` ban. It helped Codex find a gold file once. |
| Codex harness line `rg --files -g` | **drop or reword** | It triggers the AGENTS.md hunt in 17/22 rollouts and causes 5 exit-1 calls. |
| Claude Code `find` line + override sentence | neutral | Opus barely used it. |

Before any decision on the Opus drop, rerun Opus with 2 more reps per arm. Do this after the symlink fix, because GRDB outputs are inflated in both arms now. Read the result as: drop still present → test the "start broad" hint; drop gone → it was noise.
