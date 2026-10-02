# Trace analysis — ss-grep full hit line (A/B "fl"), 2026-10-02

Arm A = matched word only (`SS_FIX_GREP_FULLLINE=0`). Arm B = full source line (default).
11 r3-hard DEV questions × 2 reps × 2 harnesses = 88 rollouts. I looked at every tool call.
Read-only analysis. No model calls.

## Conclusion

**The mechanism works as intended, but it is a small effect. Accept it.** It does not cause a
defect or an accuracy loss. Full lines save calls and reads when the agent can plan its reads
from the grep lines (clear cases: Codex drogon-06 r1, Codex ocelot-04 r1, Claude Code composer-06 r1,
Claude Code typedoc-02 r2). Full lines do not remove most scoped re-greps. Those come from the
`(+N more in this file)` cap and from the GRDB symlink-loop copies, not from the missing line text.
Full lines make broad greps (100+ hits) about 2× larger. That is the one real cost (Codex okhttp-06 r1).

The large cost swings mostly come from different query choices, not from the output format.
Treat the aggregate numbers (Codex −8%, Opus −3.4%) as "on par, slightly better".

Contamination: none. No agent sent `-i` or `(?i)` to ss-grep in any directory. One automatic
case-insensitive retry ran inside the 19:20–19:26 window. It was a true zero (checked with `rg -i`).

Defects found: 1 real defect in `--in` scoping (unanchored path match). It also confirms the known
stale GRDB index (symlink loop). The full-line code itself showed no wrong output.

## 1. Did the full line replace follow-up calls?

Counts per arm. "Captured" greps are those whose output is in the capture. Claude Code calls made
through `bash` (`cd …; ss-read …`) have no captured output (15 of 79 A greps, 13 of 77 B greps).
The follow-up window is the next 2 calls after the grep.

| Metric | CC A | CC B | Codex A | Codex B |
|---|---:|---:|---:|---:|
| Agent calls (sum of 22 rollouts) | 105 | 99 | 152 | 139 |
| ss-grep calls | 79 | 77 | 58 | 45 |
| ss-grep output, captured, tokens (≈chars/4) | 33.2k | 40.1k | 33.6k | 54.7k |
| Mean tokens per captured grep | 518 | 627 (+21%) | 589 | 1,216 (+106%) |
| Greps followed by a scoped drill-in (`--in` a file from its hits) | 13 / 64 | 11 / 64 | 1 / 57 | 0 / 45 |
| Greps followed by a re-grep of the same term | 11 | 12 | 3 | 3 |
| Greps followed by a read whose range covers a shown hit | 52 | 52 | 49 | 39 |
| Greps followed by a hit-anchored read (start ≤40 lines before a hit, span ≤80) | 39 | 39 | 39 | 30 |
| ss-read calls | 152 | 122 (−20%) | 249 | 218 (−12%) |
| Wide reads (>150 lines) | 11 | 10 | 25 | 18 |

What the counts say:
- **Per grep, the agents act the same.** The share of greps followed by a drill-in, a covering
  read or an anchored read does not change.
- **The saving is in volume.** Claude Code makes 30 fewer reads. Codex makes 13 fewer greps,
  31 fewer reads and 7 fewer wide reads.
- **Codex trades tokens.** It gets about +21k grep tokens and −19k read tokens (read output 755k → 679k chars).
  So the Codex cost saving comes from fewer turns, not from fewer tokens.
- **Same query, same repo: full lines cost 1.06–1.89× (median 1.57×).** 12 identical grep commands
  ran in both arms. Example: `"archived" -k 30` is 797 chars (A) and 1,295 chars (B).

Why drill-ins stay: of 14 drill-ins in CC B, 8 target a file whose needed hits were hidden behind
`(+N more in this file)`. Example: CC B composer-06 r1. The line `GitHubDriver.php:47: private $isArchived = false; (+3 more in this file)`
hides line 192, so the agent ran `ss-grep "isArchived" --in …/GitHubDriver.php`. The other drill-ins
search a new term in a known file (drogon-10: `cxx_val_start --in create_view.cc`). A full line cannot
replace those.

Clear cases where the full line removed work:
- **Codex ocelot-04 r1 (−49%, 10 → 6 calls).** The B grep showed
  `HeaderTests.cs:84: route.DownstreamHeaderTransform.Add("Location", "{DownstreamBaseUrl}, {BaseUrl}");`
  and `Placeholders.cs:37: { "{DownstreamBaseUrl}", GetDownstreamBaseUrl },`. B went straight to
  targeted reads. A saw only `DownstreamHeaderTransform` and read 190 lines of `acceptance/Transformations/HeaderTests.cs`
  (10k chars) to learn the setting format.
- **Codex drogon-06 r1 (−58%, 5 → 3 calls).** B's two greps showed every `isHeadMethod` call site and
  the `renderHeaderForHeadMethod` lines. B issued all 13 reads in 2 batches. A needed a third grep
  (`renderHeaderForHeadMethod`) and two more read batches. Part of this is pattern choice: B's regex
  included `HeadMethod`.
- **CC composer-06 r1.** After `"archived"`, A ran 3 drill-ins (GitHub, GitLab, Forgejo drivers).
  B ran 1, because the full lines already showed `if (!isset($composer['abandoned']) && !empty($this->project['archived']))`.
- **CC typedoc-02 r2 (−23%, 5 → 3 calls).** B's `getReflectionClasses|tsd-is- --in src/lib/output` showed
  `DefaultTheme.tsx:348: classes.add("tsd-is-inherited");`. B read 338–390 next. A needed an extra
  `tsd-is- --in DefaultTheme.tsx` drill-in first.

## 2. Where full lines hurt

- **Broad greps double in size.** Codex B ran 7 greps with 100+ hits: 122k chars, 56% of all Codex B grep
  output. Codex A ran 5 such greps: 52.6k chars. Worst case: Codex okhttp-06 r1 B,
  `forWebSocket|[Ww]eb[Ss]ocket -k 250` → 676 matches, 29.6k chars. The visible lines start with 7 `import`
  lines and KDoc comments. The agent then re-grepped (`…|[Ww]eb [Ss]ocket -k 150`, 16.2k chars, mostly comments).
  A's comparable broad grep (725 matches) was 15.3k chars.
- **Most extra text is low-value.** In B hit lines: test files 26% (CC) and 34% (Codex); comment lines 7% and 10%;
  import lines 0.3% and 5%. Examples: typedoc i18n help strings in 6 locales (CC typedoc-09 r2,
  Codex typedoc-02 r1); typedoc renderer spec JSON (`GH3007.DOMClass.json`, Codex typedoc-02 r2);
  dgraph e2e test handlers (`graphql/e2e/custom_logic/cmd/main.go`, 8.8k chars, Codex dgraph-09 r1).
- **Near-identical lines.** GRDB symlink copies print the same line once per nested copy (see defect D2).
- **No misreads.** No agent misread a full line. No `…` cut hid a needed part. 13 (CC) and 25 (Codex) lines
  were cut with `…`. They were long JSON test bodies, option help texts and generated gRPC stubs.
- **Possible under-reading (watch item, not proven).** In two CC B rollouts the agent read less and missed facts.
  drogon-06 r1: 7 short reads at the hits, then stop; it missed `sendResponses` and the `HttpControllersRouter`
  CORS branch (score 0.80 → 0.60). typedoc-09 r1: no read of `converter.ts`; it missed the
  `convertExports` deferral (0.82 → 0.60). Other pairs go the other way (jj-11 r1 0.70 → 1.00,
  grdb-02 r1 0.65 → 0.90, dgraph-09 r1 0.70 → 0.90). The aggregate score is +2.1 pts.

## 3. Paired per-question table

Calls, cost ($), score, ss-grep count, ss-grep output tokens (captured only), ss-read count. A/B.
CC grep and read tokens are lower bounds where calls ran through `bash` (output not captured).

| H | Question | Rep | Calls | Cost | Δcost | Score | Greps | Grep tok | Reads |
|---|---|---|---|---|---:|---|---|---|---|
| cx | dgraph-09 | r1 | 7/5 | .125/.076 | −39% | .65/.80 | 3/2 | 1024/2485 | 15/6 |
| cx | dgraph-09 | r2 | 7/8 | .084/.098 | +17% | .70/.65 | 3/2 | 181/415 | 12/8 |
| cx | jj-11 | r1 | 6/5 | .089/.083 | −7% | 1.0/1.0 | 6/3 | 1811/2904 | 12/16 |
| cx | jj-11 | r2 | 6/5 | .090/.075 | −16% | 1.0/1.0 | 3/2 | 2411/5510 | 18/13 |
| cx | ocelot-04 | r1 | 10/6 | .094/.048 | **−49%** | .85/.95 | 4/3 | 666/918 | 7/6 |
| cx | ocelot-04 | r2 | 8/5 | .068/.051 | −26% | .73/.90 | 4/2 | 761/522 | 8/3 |
| cx | typedoc-02 | r1 | 9/7 | .097/.092 | −5% | .95/.85 | 5/3 | 1197/1466 | 15/14 |
| cx | typedoc-02 | r2 | 6/8 | .067/.143 | **+114%** | .60/.80 | 2/4 | 463/1935 | 9/13 |
| cx | typedoc-09 | r1 | 10/8 | .137/.118 | −14% | .90/.90 | 5/3 | 2184/2328 | 28/27 |
| cx | typedoc-09 | r2 | 8/10 | .112/.119 | +6% | 1.0/.80 | 3/4 | 1958/3562 | 24/28 |
| cx | composer-06 | r1 | 6/4 | .073/.050 | −31% | .85/.70 | 3/2 | 1588/2915 | 5/4 |
| cx | composer-06 | r2 | 5/6 | .102/.108 | +6% | .75/.80 | 1/2 | 199/3420 | 5/8 |
| cx | drogon-06 | r1 | 5/3 | .123/.051 | **−58%** | .90/.97 | 3/2 | 815/1574 | 22/13 |
| cx | drogon-06 | r2 | 5/5 | .090/.074 | −18% | .95/.97 | 3/3 | 3834/4003 | 18/16 |
| cx | drogon-10 | r1 | 4/3 | .041/.053 | +28% | 1.0/.90 | 0/0 | 0/0 | 3/3 |
| cx | drogon-10 | r2 | 7/7 | .076/.099 | +31% | 1.0/.88 | 1/0 | 340/0 | 2/2 |
| cx | grdb-02 | r1 | 6/7 | .121/.059 | **−51%** | .70/.80 | 1/0 | 2884/0 | 3/4 |
| cx | grdb-02 | r2 | 6/5 | .095/.104 | +10% | .90/.90 | 1/0 | 18/0 | 3/2 |
| cx | grdb-03 | r1 | 8/8 | .102/.113 | +11% | .80/.90 | 1/1 | 2140/2157 | 4/3 |
| cx | grdb-03 | r2 | 10/8 | .148/.091 | −39% | .78/.80 | 0/1 | 0/15 | 2/3 |
| cx | okhttp-06 | r1 | 6/8 | .068/.152 | **+124%** | .85/.95 | 3/3 | 4061/11913 | 14/14 |
| cx | okhttp-06 | r2 | 7/8 | .113/.085 | −25% | .95/.90 | 3/3 | 5055/6697 | 20/12 |
| cc | dgraph-09 | r1 | 5/4 | .133/.119 | −11% | .70/.90 | 3/4 | 266/645 | 5/4 |
| cc | dgraph-09 | r2 | 4/5 | .134/.136 | +1% | .75/.75 | 2/3 | 182/868 | 7/4 |
| cc | jj-11 | r1 | 4/3 | .136/.146 | +7% | .70/1.0 | 5/2 | 1076/1030 | 4/4 |
| cc | jj-11 | r2 | 5/6 | .154/.151 | −2% | .40/.60 | 5/6 | 856/1466 | 8/6 |
| cc | ocelot-04 | r1 | 4/2 | .124/.114 | −8% | 1.0/.90 | 2/2 | 405/506 | 0/0 |
| cc | ocelot-04 | r2 | 4/4 | .126/.133 | +6% | .96/.95 | 3/2 | 586/833 | 4/4 |
| cc | typedoc-02 | r1 | 4/4 | .134/.158 | +18% | .70/.80 | 3/5 | 609/1089 | 5/7 |
| cc | typedoc-02 | r2 | 5/3 | .172/.133 | −23% | .83/.75 | 5/3 | 598/1480 | 10/6 |
| cc | typedoc-09 | r1 | 6/4 | .174/.135 | −22% | .82/.60 | 5/3 | 1711/948 | 13/9 |
| cc | typedoc-09 | r2 | 7/7 | .173/.214 | **+24%** | .90/.90 | 3/7 | 1292/2954 | 16/15 |
| cc | composer-06 | r1 | 5/4 | .122/.118 | −3% | .85/.80 | 5/3 | 944/1385 | 7/6 |
| cc | composer-06 | r2 | 4/4 | .105/.110 | +5% | .70/.75 | 3/3 | 449/601 | 5/5 |
| cc | drogon-06 | r1 | 5/4 | .167/.117 | **−30%** | .80/.60 | 4/2 | 596/1254 | 18/7 |
| cc | drogon-06 | r2 | 5/5 | .173/.166 | −4% | .85/.70 | 4/4 | 910/1960 | 17/12 |
| cc | drogon-10 | r1 | 4/5 | .092/.098 | +7% | 1.0/.95 | 3/3 | 356/868 | 4/2 |
| cc | drogon-10 | r2 | 3/5 | .075/.086 | +15% | .88/.97 | 4/3 | 376/694 | 2/2 |
| cc | grdb-02 | r1 | 6/5 | .212/.234 | +11% | .65/.90 | 3/4 | 5044/7324 | 4/4 |
| cc | grdb-02 | r2 | 6/5 | .241/.225 | −7% | .60/.75 | 5/4 | 6917/7437 | 4/5 |
| cc | grdb-03 | r1 | 7/6 | .253/.183 | **−27%** | .90/.73 | 4/5 | 5450/1298 | 5/6 |
| cc | grdb-03 | r2 | 6/8 | .228/.260 | +14% | .90/.94 | 4/6 | 4164/4239 | 4/6 |
| cc | okhttp-06 | r1 | 3/3 | .117/.097 | −17% | .40/.25 | 3/1 | 190/274 | 5/4 |
| cc | okhttp-06 | r2 | 3/3 | .106/.101 | −5% | .35/.50 | 1/2 | 190/949 | 5/4 |

The biggest swings, explained from the trace:
- **cx okhttp-06 r1, +124%.** B opened with ss-search, then the 676-hit broad grep (29.6k chars) and a second
  broad re-grep (16.2k chars). A started with the narrow `forWebSocket` (8 hits). Query choice plus full-line bloat.
  B's extra text was imports, comments and tests. B scored higher (0.95 vs 0.85).
- **cx typedoc-02 r2, +114%.** B made 2 more calls and 4 more reads. A stopped early and missed the
  inheritance flag in `ImplementsPlugin` (0.60 vs 0.80). The extra cost bought completeness. The format is a minor factor.
- **cx drogon-06 r1, −58%; cx ocelot-04 r1, −49%.** The mechanism working (see section 1).
- **cx grdb-02 r1, −51%.** A ran `databaseWillCommit -k 25` (495 matches, 11.5k chars, mostly symlink copies).
  B used no grep at all (trace, semantic, find). Not the format.
- **cx dgraph-09 r1, −39%.** A made an extra ss-semantic call and an extra read batch. B's full lines showed that
  zero registers only `grpc.UnaryInterceptor(audit.AuditRequestGRPC)`. B still ran an 8.8k-char broad
  `http\.(Handle|HandleFunc)` grep (test handlers). Weak attribution.
- **cx grdb-03 r2, −39%.** Neither arm used a useful grep (B: one zero-hit `AGENTS\.md`). Not the format.
- **cx drogon-10 r1/r2, +28%/+31%.** B ran no grep. Not the format.
- **cc drogon-06 r1, −30%.** B read 7 short hit-anchored ranges and stopped. Cheaper, but it missed 2 places (score −0.20).
- **cc grdb-03 r1, −27%.** A's second grep (`struct ForeignKeyRequest|func fetchForeignKeyMapping|ambiguous -k 15`)
  matched 627 lines in 231 files (11.7k chars, symlink copies). B chose a narrower regex. Not the format.
- **cc typedoc-09 r2, +24%.** B ran 7 greps instead of 3. One returned i18n help strings in 6 languages.
  Cost came from more calls, not from line length.

## 4. Contamination check (prefilter edit live 19:20–19:26)

- Agent-sent case-insensitive ss-grep calls (`-i`, `(?i)`, `--ignore-case`): **0 in every directory**,
  including cc B-r2 and A-r2. Every `-i` in the commands belongs to a shell `grep` after a pipe.
- ss-grep retries a zero-hit case-sensitive grep case-insensitively (`_ss-helpers.mjs:585`). So zero-hit greps
  also reach the case-insensitive prefilter. 7 zero-hit greps exist in all 88 rollouts. 1 ran inside the window:
  cc B-r2 grdb-02 at 19:23:52–19:24:15, `SQLITE_CONSTRAINT_COMMITHOOK|commitHook|willCommit --in GRDB/Core/Database+Statements.swift`.
  `rg -i` on that file finds nothing, so the zero is true.
- The other 6 zero-hit greps are outside the window. All are true zeros (checked with `rg -i`).
- One retry returned case-insensitive hits: Codex r2 arm A ocelot-04 at 19:43. That is outside the window.
- Rollouts that overlap the window: cc B-r2 (8), Codex r1 (3 B, 2 A).
- **No result depended on the edit.**

## 5. Product defects in ss-* output

**D1 — `--in <path>` matches the path anywhere, not from the repo root (real defect).**
`matchesGrepFileFilter` (`core/search/grep-output-shaping.js:122-126`) slides a relative scope along the
whole path. So `--in GRDB/Core/TransactionObserver.swift` also matches the 32 nested copies
`Tests/CustomSQLite/GRDB/…/GRDB/Core/TransactionObserver.swift`. Evidence:
- `ss-grep "databaseWillCommit|commitHook|…" --in GRDB/Core/TransactionObserver.swift -k 60`
  → header `1716 total match(es) … (scope: --in GRDB/Core/TransactionObserver.swift)`. The real file shows about 50 of them before the copies start.
  The agent sees a "+1656 more" note for a single file. (cc A/B r1/r2 grdb-02)
- `ss-grep "func joinExpression\(leftAlias" --in GRDB/QueryInterface/SQL/SQLRelation.swift` → 33 matches,
  6.3k–7.5k chars, to find 1 line. (cc grdb-03, all 4 rollouts)

Proposed fix: when the relative scope names an existing repo-relative file or directory, match it from the
repo root only. Keep the sliding match as a fallback for scopes that do not exist at the root.

**D2 — GRDB index still contains the symlink loop (known, confounder for both arms).**
GRDB greps show paths up to about 300 chars (`Tests/CustomSQLite/GRDB/` repeated about 10 times). The same hit prints
once per copy. Example: `databaseWillCommit\(\)|…` → 4,026 matches across 66 files, 22.4k chars. The no-follow
fix (cfd18b77) is in this branch. The eval index was not rebuilt (no reindex until tuning ends). It inflates
GRDB cost in both arms and hides the real file under "+N more". D1 makes it worse.

**D3 — Misleading regex note on a correct pattern (minor).**
`ss-grep "statementDidFail\(" --in GRDB/Core/Database.swift` → 0 matches plus
`regex note: Rust syntax uses unescaped operators (\(); escaped forms match punctuation. The original pattern was used unchanged.`
The pattern is correct and the zero is true. The note suggests a problem with the escape. (cc B-r1 grdb-02)

**Not defects:**
- Full-line windows: the match stayed visible in every case but one. In that case (dgraph-09 cc B-r2,
  `func (.*)?(…|UnaryServerInterceptor)\b`) the regex match itself is longer than 140 chars. The cut hides
  the tail (`grpc.UnaryServerIntercep…`). The function name at the start stays visible. No harm.
- No wrong hits. A first pass flagged lines that seemed not to match the regex. They came from piped greps
  (`| grep …`) that lose their header, so the capture joins them to the previous output. That was an analysis
  artifact, not a product bug.

## Method notes

- Data: `captures/<arm>.<id>.json` (`calls[]` with command and output length; `rawResponse` = joined
  outputs of the `ss` calls) and `runs.jsonl`. I split outputs by call length, then by `# ss-<tool>` headers.
- Claude Code `bash`-kind calls (`cd …; ss-read …`) are not in `rawResponse`. Their commands are known, but their
  outputs are not. 28 CC greps and 81 CC reads are affected, in both arms.
- "Drill-in" = a later grep with `--in` whose target is a file from the earlier grep's hits, within the next 2 calls.
- Scripts are in my scratchpad (`parse.py`, `metrics.py`, `final.py`). They are not part of the repo.
