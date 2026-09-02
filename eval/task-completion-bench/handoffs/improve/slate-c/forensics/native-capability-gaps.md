# Native capability gaps — what the sweet arm still does with raw shell (forensics, slate C)

Date 2026-09-02. Author: workflow agent `native-capability-gaps`. Evidence: the three
production-form fresh-pool runs on the evidence box (read-only), 22 tasks × 3 reps × 2 arms per
harness, 396 rollouts, 10,942 tool calls. Every number below is tagged: [M] measured (script
named), [C] read from code, [I] inferred, [W] web.

## 0. Verdict

The sweet arm almost never falls back to raw shell for retrieval, and where it does the cause
is not a missing flag. Across 198 sweet rollouts the agents performed 269 retrieval operations
(grep, read, glob, list) with raw shell or harness tools against 3,064 with `ss-*` tools [M]. On
codex that fallback is 44 operations in 16 rollouts and costs at most 2.3% of the sweet cost per
rollout; on opencode it is 44 operations in 15 rollouts and at most 5.3%, of which 94% of the
tokens sit in the two `bfgroup__b2` tasks whose gold files lived in the then-unindexed
`src/build/` (fixed 2026-08-28, register E1) [M][I]. Claude-code is the exception: 181 fallback
operations in 25 rollouts, worth up to 12.2% of the sweet cost per rollout, and 127 of those
operations (184,470 tokens, 8.7% of cost) happen inside the 9 rollouts that delegated to a
subagent [M][I]. The subagent mechanism is new to the record: Claude Code runs `Agent()` with
`isolation: "worktree"`, the subagent scopes `ss-grep --in <its worktree path>`, and every one of
those 45 scoped calls returned zero matches because the index covers the repo root, not the
worktree copy; the subagent then used `find`, `grep -R` and native `Read` [M]. Two of those
subagents later re-ran the same patterns unscoped and got hits (12 patterns) [M]. The
"same pattern through raw grep after ss-grep" violation the guide forbids happened 14 times in
198 rollouts; `ss-grep` had returned zero in 10 of them, and 3 of the 4 hit-cases targeted
`dist/index.js`, a build artifact the index excludes on purpose [M]. No fallback in any harness
asked for a grep feature `ss-grep` lacks except two `-C` context requests and one `--include`
filter [M]. The largest coverable gap that is not an index-coverage bug is filename discovery
(`rg --files`, `glob`, `find -name`, `find -type f`): 74 operations across the three harnesses (65 glob + 9 listing), no `ss-*`
equivalent exists, and the product's planned `files` command was never built [M][C]. Solve
rates are unchanged by any of this; every number here is a cost-side upper bound.

## 1. Data and method

Runs [M]: `fp-codex-tab-20260826` (132 rows), `fp-claudecode-tab-20260826` (132 rows),
`fp-opencode-tab-20260826` (129 rows) plus `rp-oc-tab-20260827` (33 sweet rows) for the 11
opencode repair tasks, composed as `e4-opencode-lib.py` does: native from the `fp` run, sweet
from `fp` for the 11 non-repair tasks and from `rp` for the 11 repair tasks. Result: 66 + 66
canonical rollouts per harness. Pool and repair lists: `/root/fresh-run/pool.txt`,
`/root/fresh-run/repair-tasks.txt`.

Transcript mapping [M]: codex by `rows.json.rolloutFile`; opencode by
`openCodeRawAttempts[0].stdout`; claude-code by the `-root--ss-eval-runs-r<rep>-N/` project slug.
Six claude cell-reps hold two main transcripts; the one whose request count equals the row's
`idealTurns` was taken (69/69, 12/12, 38/38, 23/23), and for the two null-cost rows the one whose
call count is nearest `rows.calls` (`fastify-cors-285 sweet rep0`, `solhint-224 native rep2`).
Subagent transcripts (`subagents/agent-*.jsonl`) are included and flagged `side`.

Scripts (all under
`eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-native-capability-gaps/`):

| script | what it does |
|---|---|
| `extract-events.py` (ran on the box, output `/tmp/wf-slatec/native-capability-gaps/events-*.jsonl.gz`) | one record per tool call: input, delivered output, exit/error, request index; codex `function_call` pairs, opencode `tool_use` parts deduped by callID keeping the last state, claude blocks deduped by `tool_use.id` |
| `shellsplit.py` | quote-aware split into statements (`&&`, `\|\|`, `;`, newline) and pipeline stages (`\|`), heredoc bodies removed |
| `classify_calls.py` | capability per statement, pipeline reduction (`cat f \| grep p` = grep of f; `find \| grep` = glob; `find \| xargs grep` = grep over a glob set), o200k_base tokens of input and output per call |
| `report_gaps.py` | census per harness×arm, sweet-arm fallback ranking with attribution, same-pattern and same-file census, prices |
| `analysis_extras.py` | main-vs-subagent split, per-task split, subagent `ss-*` invocation audit, tag validation, read-before-edit, native feature shares, first-call census |
| `data/` | `report-out.md`, `analysis-extras.txt`, `gaps-summary.json`, `same-pattern-cases.jsonl`, `same-file-cases.jsonl`, `gap-examples.jsonl` |

The classified corpus is `calls-classified.jsonl.gz` (8.1 MB) in the local scratchpad and at
`/tmp/wf-slatec/native-capability-gaps/` on the box.

Capability vocabulary: `grep.literal` / `grep.regex` (content search; literal = `-F` or no
unescaped regex metacharacter), `search.semantic` (`ss-search`, `ss-find` query),
`read.range` / `read.whole`, `glob` (filename discovery), `list` (directory enumeration),
`git.history` / `git.state` / `git.other`, `test`, `build`, `runtime` (`python -c`, `node -e`,
heredoc scripts), `deps` (package queries, dependency-path reads), `symbol` (`ss-trace`), `edit`,
`plan`, `poll`, `delegate`, `web`, `misc`. `via` = `ss` (an `ss-*` wrapper) or `native` (shell or
harness tool). A call's tokens are split evenly across its substantive statements.

Prices [I]: per ingested token (0.10 + 0.01 × re-send factor)/M with the brief's factors (codex
sweet 15.9, opencode 15.0, claude 20.1 re-sends per ingested token) → $0.259/M, $0.250/M,
$0.301/M. Per request = Σ`costRealizedUsd` / Σ`idealTurns` over priced rollouts: codex sweet
$0.000629, opencode sweet $0.000470, claude sweet $0.000702 (57 priced rollouts; the 9 with
subagents carry null cost). "Sole-native request" = a request whose substantive operations are
all native retrieval; pricing it whole is an upper bound because some request would have been
spent anyway. The claude denominator is the brief's $0.020727 per rollout, not my $0.015127 mean
over priced rollouts, because the null-cost rollouts are the delegating ones.

## 2. What the native arm does (capability census) [M `report_gaps.py`]

Per rollout means; token share is of the arm's total tool tokens (input + output, o200k_base).

| capability | codex native (n=66) | opencode native (n=66) | claude-code native (n=66) |
|---|---|---|---|
| read range | 13.06/rollout, 40.5% (`sed -n` 786, `nl` 70) | 9.03, 52.4% (`read` tool, always offset+limit) | 18.92, 49.5% (`Read` tool 1,245, main 690 + subagent 555) |
| read whole file | 2.35, 8.0% (`cat` 155) | 0 | 0.02 |
| regex grep | 4.20, 17.5% (`rg` 277) | 3.06, 15.2% (`grep` tool 202) | 4.14, 18.2% (Bash `grep` 241, `rg` 32; the `Grep` tool was never called) |
| literal grep | 0.59, 1.5% | 0.58, 1.5% | 2.30, 4.7% |
| filename glob | 1.89, 5.3% (`rg --files` 120) | 1.62, 5.3% (`glob` tool 107) | 0.65, 2.6% (`find -name` 24, `find \| grep` 18) |
| directory listing | 0.17, 0.6% | 0.50, 3.6% (`glob **/*` 32) | 1.50, 4.7% (`find -maxdepth -type f` 94) |
| git log/blame/show | 0.03, 0.1% | 0.03, 0.0% | 0.79, 0.6% (`log` 39, `show` 8, `blame` 1) |
| git status/diff | 2.42, 3.7% | 2.33, 1.7% | 3.12, 1.9% |
| test run | 3.02, 13.6% (all `run_tests`) | 2.71, 13.4% | 3.14, 10.0% |
| build/lint/check | 0.03 (`node --check`) | 0 | 0.06 (`gofmt`, lint) |
| runtime probe | 0.12, 0.3% (`node -e` regex probes) | 0.14, 0.2% (`node -e`, all in markup-it) | 0.52, 0.6% (`node -e` 20, `python3` 13) |
| dependency inspection | 0 | 0 | 0 (1 `ls node_modules`) |
| symbol lookup | 0 as a tool; 79 of 316 greps used a definition-shaped pattern (`def x`, `class x`, `func (`) | 42 of 240 | 75 of 425 |
| edit | 1.98 (`apply_patch` heredocs) | 1.77 (`apply_patch` tool) | 4.73 (`Edit` 304) |
| plan / delegate | 4.14 `update_plan` | 3.92 `todowrite` | 2.11 plan + 1.45 delegate (`Agent` 31, `SendMessage` 65) |
| total retrieval ops/rollout | 22.3 | 14.8 | 27.5 |

Shapes of the native calls that matter for any `ss-*` equivalence [M `analysis_extras.py` G]:

- Reads are windows, not files. Codex `sed -n 'a,bp'` spans: p50 131 lines, p90 260, max 700.
  Opencode `read` limit: p50 160, p90 260, max 520. Claude `Read` limit: p50 170, p90 1,000.
  No native arm ever used an open-ended (`N,$p`, `tail -n +N`) or suffix (`tail -n N`) read.
  `ss-read`'s deliberate lack of start-to-EOF is therefore not a gap in practice.
- Greps use alternation (codex 274/316 = 87%, claude 348/425 = 82%; opencode's tool has no
  alternation use), a type filter (codex 135/316 = 43% via `-g`, opencode 240/240 via the
  tool's `include` parameter chosen by the agent — `*.cs` 45, `*.py` 42, `*.js` 29, `*.jam` 23,
  `*` 10 — claude 64/425 = 15% via `--include`), and a `\| head -N` cap (codex 167/316 = 53%,
  claude 236/425 = 56%). Context lines are rare (codex 14/316 = 4%, claude 5/425 = 1%,
  opencode 0); files-only 1–3 per harness; count/invert 0. `ss-grep` already supports
  alternation (Rust regex); the BRE `\|` form is the only alternation defect (register E2/D6).
- Filename discovery is a real native habit: codex runs `rg --files [-g glob] \| head` 1.9 times
  per rollout, opencode `glob` 2.1, claude `find … -type f \| sort \| head` 2.2 (glob + list).
  Claude native's first tool call is a directory listing in 11 of 66 rollouts; codex and
  opencode always start with a plan call.

## 3. What the sweet arm still does with raw shell or harness tools [M `report_gaps.py`]

Sweet-arm `ss-*` use per rollout for scale [M]: codex `ss-read` 8.6, `ss-grep` 3.3, `ss-search`
1.9, `ss-semantic` 0.7, `ss-find` 0.4, `ss-trace` 0.2; opencode `ss-read` 6.7, `ss-grep` 3.0,
`ss-search` 1.5, `ss-find` 0.5, `ss-trace` 0.1; claude `ss-grep` 7.0, `ss-read` 6.5,
`ss-search` 3.0, `ss-find` 2.9, `ss-trace` 0.2. Native retrieval ops per sweet rollout: codex
0.7, opencode 0.7, claude-code 2.7 (of which 1.9 inside subagents).

### 3.1 Ranked by attributed tokens, per harness

Attribution [M]: `after-ss-failure` = within the two previous calls an `ss-*` call failed
(zero matches, usage error, crash, ENOENT, empty); `feature-absent` = the operation used a
capability or target `ss-*` cannot serve (glob, listing, git, an index-excluded `build-path`,
`-C` context, a type filter); `plain-fallback` = `ss-*` could have done the same thing.

**codex sweet** (n=66; $/request 0.000629; $/ingested token 0.259/M)

| capability | ops | rollouts | tokens | token $/rollout | sole-native requests | request $/rollout | attribution | programs |
|---|---:|---:|---:|---:|---:|---:|---|---|
| glob | 20 | 13 | 5,838 | 0.000023 | 13 | 0.000124 | absent 18, after-failure 2 | `rg --files` 18, `git ls-files` 2 |
| read range | 13 | 4 | 5,280 | 0.000021 | 10 | 0.000095 | plain 7, build-path 4, numbered (`nl`) 2 | `sed -n` 11, `nl` 2 |
| regex grep | 8 | 4 | 2,628 | 0.000010 | 8 | 0.000076 | plain 4, build-path 3, after-failure 1 | `rg` 8 |
| literal grep | 3 | 2 | 1,169 | 0.000005 | 2 | 0.000019 | build-path 3, `-C` context 2 | `rg` 3 |
| (git status/diff, arm-universal) | 120 | 50 | 22,204 | — | 57 | — | — | `git` |
| **retrieval total** | **44** | **16** | **14,914** | **0.000059** | **23** | **0.000219** | **sum $0.000278 = 2.3% of $0.012330** | |

**opencode sweet** (n=66; $/request 0.000470; $/ingested token 0.250/M)

| capability | ops | rollouts | tokens | token $/rollout | sole-native requests | request $/rollout | attribution | programs |
|---|---:|---:|---:|---:|---:|---:|---|---|
| read range | 18 | 5 | 44,428 | 0.000168 | 18 | 0.000128 | build-path 9, plain 6, after-failure 3 | `read` tool 18 |
| glob | 24 | 13 | 3,948 | 0.000015 | 24 | 0.000171 | absent 13, after-failure 11 | `glob` tool 22, `git ls-files` 2 |
| grep | 2 | 2 | 189 | 0.000001 | 2 | 0.000014 | after-failure 1, build-path 1 | `grep` tool 1, `rg` 1 |
| **retrieval total** | **44** | **15** | **48,566** | **0.000184** | **43** | **0.000306** | **sum $0.000490 = 5.3% of $0.009265** | |

**claude-code sweet** (n=66; $/request 0.000702; $/ingested token 0.301/M)

| capability | ops | rollouts | tokens | token $/rollout | sole-native requests | request $/rollout | attribution | programs |
|---|---:|---:|---:|---:|---:|---:|---|---|
| read range | 138 | 23 | 153,444 | 0.000700 | 114 | 0.001212 | plain 73, after-failure 37, build-path 28 | `Read` tool 138 (main 51, subagent 87) |
| regex grep | 13 | 6 | 38,278 | 0.000175 | 13 | 0.000138 | plain 12, after-failure 1 | Bash `grep -RInE` 13 (all subagent) |
| glob | 21 | 10 | 17,734 | 0.000081 | 20 | 0.000213 | absent 19, after-failure 2 | `find -name` 18, `git ls-files` 2, `ls` 1 (subagent 18) |
| list | 9 | 6 | 13,184 | 0.000060 | 8 | 0.000085 | absent 8, after-failure 1 | `find -maxdepth -type f` 8, `ls -la` 1 (all subagent) |
| (git status/diff) | 77 | 43 | 14,642 | — | 52 | — | — | `git` |
| (runtime probes) | 20 | 7 | 5,198 | — | 20 | — | — | `node -` 12, `python3 -` 8 |
| **retrieval total, main thread** | **54** | **20** | **38,170** | **0.000174** | **51** | **0.000542** | **sum $0.000716 = 3.5% of $0.020727** | |
| **retrieval total, subagents** | **127** | **7** | **184,470** | **0.000841** | **91** | **0.000967** | **sum $0.001809 = 8.7%** | |

Per-task concentration [M `analysis_extras.py` B]: the two `bfgroup__b2` tasks carry 41% of
codex's fallback tokens, 94% of opencode's, 63% of claude-code's. Their gold files lived under
`src/build/` and in `.jam` files, which the index excluded until 36b802e / fb9f936 (register
E1). The remaining fallback mass on codex is spread over 6 tasks (moq 13%, fastify 9%, solhint
9%, aws-actions 7%); on claude-code over final-form (16%), protoactor (10%), aws-embedded-
metrics (6%).

### 3.2 The claude-code subagent mechanism (new)

[M `analysis_extras.py` A, C; `data/analysis-extras.txt`]

- Sweet delegated with `Agent()` 11 times in 9 rollouts (6 task-cells); every call carried
  `"isolation": "worktree"` (6 `Explore`/haiku, 2 `Explore`/sonnet, 3 `general-purpose`/sonnet).
  Native delegated 31 times in 27 rollouts, also all worktree-isolated.
- The subagent's cwd is `/root/.ss-eval/runs/r<rep>-N/.claude/worktrees/agent-<id>`. It found
  the wrappers on PATH (`command -v ss-grep` resolved), but still probed for them (32
  `command -v` calls, `find /usr/local/bin /usr/bin -name 'ss-*'`, `compgen -c | grep ^ss-`) and
  then invoked them by absolute path 212 times against 127 bare invocations.
- 57 `ss-grep`/`ss-find` calls were scoped `--in <worktree path>`: 45 returned `0 total
  match(es)` and 12 were usage errors; none returned a hit. The index covers the repo root; the
  worktree copy did not exist when the index was built, and the pre-08-28 wrapper printed plain
  `(no matches)`, so the subagent could not tell "absent" from "unsearchable". In
  `bfgroup__b2-259/sweet/rep0` and `bfgroup__b2-113/sweet/rep2` the subagent later re-ran the
  same patterns unscoped and got hits for 5 and 7 patterns. Quoted sequence
  (`fp-claudecode-tab-20260826`, `bfgroup__b2-113/sweet/rep2`, subagent calls 41–50):
  `…/bin/ss-grep -F 'boost-install' --in /root/.ss-eval/runs/r2-54/.claude/worktrees/agent-a41e46d3e2671aa14` →
  `0 total match(es)`; `… 'install' --in <worktree>` → 0; `… 'build' --in <worktree>` → 0; then
  `…/bin/ss-grep -F install -k 100` → `198 total match(es) across 29 files`.
- After the zero results the subagents did the retrieval natively: 87 `Read`, 13 `grep -RInE`,
  18 `find -name`, 9 `find -maxdepth -type f`, 184,470 tokens in 7 rollouts. The five rollouts
  with worktree-scoped zeros are `asynkron__protoactor-dotnet-1909/rep1`, `bfgroup__b2-113/rep1`,
  `bfgroup__b2-113/rep2`, `bfgroup__b2-259/rep0`, `final-form__final-form-64/rep2`.
- Subagents also hit the usage surface harder than the main thread: 36 of 329 subagent `ss-*`
  calls (10.9%) were usage errors against 12 of 779 (1.5%) on the main thread. The forms were
  `ss-grep -h` / `--help` (rejected as an unknown option), `-E` (rejected; ERE is already the
  engine's syntax), `-n <pat> <path>` (positional path, since accepted by 36b802e), and
  `ss-find --in` (register, opencode L3/L4).
- Prior record: `04-resolution-claude-code.md` §2 noted that `ss-grep` returned a `.jam` path
  four times "inside a `.claude/worktrees/` copy, not the index" — that is the maintainer having
  indexed a worktree copy in some rollouts. So the worktree behaves two ways: sometimes it is
  silently outside the index (this report), sometimes it is a duplicate inside it (08-28). Neither
  was booked as a mechanism or a lever. `.claude/` is on the index ALLOWLIST
  (`core/infrastructure/config/search.js:379`, agentic paths kept indexable), not a deny list [C],
  so the shipped `(not indexed: …)` hint would not fire for a worktree scope either.

### 3.3 Main-thread claude-code `Read` fallbacks

[M `analysis_extras.py` F] 51 native `Read` calls on the main thread in 18 rollouts (37,834
tokens). 23 of the 51 were followed within 3 calls by an `Edit` of the same file; the sweet
arm's 245 `Edit` calls were preceded by an `ss-read` only in 199 cases, by a native `Read` in
37, by nothing in 9. Native's 690 `Read` calls were followed by an `Edit` in 94 cases. The 18
identical consecutive `Read` pairs in the sweet arm (e.g. `locationtech__jts-622/sweet/rep0`
main calls 4–7, `Read WKBWriter.java 340 15` four times) are edit-retry re-reads, not tool
failures (`err=False`). This is the register's D6 surface (read-before-edit) seen from the
luna side: the habit survives even when the gate is off.

## 4. Top gaps: flag on an existing tool, rendering change, or new tool?

| # | gap | evidence [M] | covered by an existing `ss-*` tool with a flag or rendering change? | new tool needed? |
|---|---|---|---|---|
| G1 | Worktree-scoped subagent searches return silent zero (claude-code only) | 45 zero + 12 usage of 57 worktree-scoped calls, 5 rollouts; 12 patterns later hit unscoped; 127 native ops, 184k tokens downstream | **Yes, behaviour change on `ss-grep`/`ss-find`/`ss-trace` `--in`:** when a scope path lies under `<repo>/.claude/worktrees/<agent>/`, strip that prefix and search the repo-root path, and say so in the banner. `ss-read` needs nothing (it reads the disk). Sweet-only vehicle (the wrapper). | no |
| G2 | Filename discovery / directory listing has no `ss-*` equivalent | codex 18 `rg --files`, opencode 22 `glob`, claude 18 `find -name` + 9 `find -type f`; native does it 1.9 / 2.1 / 2.2 times per rollout | **Partly:** an `ss-grep --files <glob>` mode (mirror of `rg --files -g`) would cover the glob half from the existing index's path table; enumeration (`**/*`, `-maxdepth 2`) is a listing the guide forbids and native pays 3.6–4.7% of its tool tokens for. The product plan's `sweet-search files` (basename trigrams) was never built: `core/cli.js` dispatches `batch index init prewarm-vocab read read-semantic rebuild reconcile trace`, no `files` [C]. | as a flag: no; as `ss-files`: yes (`new_tool`, `needs_user_decision`) |
| G3 | Index-excluded targets (`dist/index.js`, `src/build/**`, `.jam`) | codex 10 build-path ops, opencode 22, claude 28 read + 1 grep; 3 of the 4 same-pattern hit-cases target `dist/index.js` | `src/build`/`.jam`: **shipped** (E1). `dist/` bundles: excluded on purpose; the shipped `(not indexed…)` hint (E2, post-dates these runs) now names the exclusion. A `--raw` passthrough on `ss-grep` for an excluded scope is possible but the honest bound is 3 rollouts of `aws-actions`, all solved anyway. | no |
| G4 | Grep muscle-memory flags rejected | subagent usage errors 10.6% of `ss-*` calls: `-E`, `-h`, `--help`; main thread `-n <pat> <path>` (shipped), `ss-find --in` (recorded) | **Yes, argparse:** treat `-E`/`--extended-regexp` as inert (already the engine syntax), answer `-h`/`--help` with usage and exit 0. Extends register E2 / opencode L4. | no |
| G5 | Context lines `-C N` | 2 codex fallbacks (`rg -n -F -C 8 … dist/index.js`); native uses `-C` in 4% / 0% / 1% of greps | A `-C/-A/-B` flag on `ss-grep` is trivial but the demand is ≤2 ops in 198 rollouts; not a cost lever. | no |
| G6 | Type / glob filter on grep | native 43% (codex), 100% (opencode `include`), 15% (claude) of greps; sweet fell back for it once | `--in` covers paths; a `-g <glob>`/`--type` flag would match native habit. Sweet agents lived without it (1 fallback), so the cost ceiling is ~0; it is a usability item. | no |
| G7 | Numbered read via `nl -ba … \| sed -n` | 2 codex ops | `ss-read` already numbers lines; the agent used `nl` after an `ss-read` had shown the same file (`fastify-cors-285/sweet/rep2` calls 7, 11). Habit, not a gap. | no |
| G8 | Git history, git state, runtime probes, dependency inspection | git state 1.2–2.5 per sweet rollout on every harness (native 2.3–3.1); history ≤0.09 sweet; runtime 0.08–0.30; deps 0 | Arm-universal work with no `ss-*` role. Dependency inspection is absent in BOTH arms on this pool (0 dependency-path reads, 0 package queries beyond `--version`), so the E5 `ss-deps` motivation is not visible here. | no |

## 5. Same-pattern re-grep census (the rule the guide forbids)

[M `report_gaps.py`; `data/same-pattern-cases.jsonl`] Method: every raw content grep in a
sweet rollout (shell `grep`/`rg`/`git grep` or the harness grep tool) was compared with every
earlier `ss-grep`/`ss-find --regex` pattern in the same thread after normalising quotes, BRE
`\|`, escapes and anchors. `exact` = identical after normalisation, `loose` = one pattern is a
substring of the other.

| harness | raw content greps in sweet arm | already run through `ss-grep`/`ss-find` | rollouts | `ss-*` result at that moment | raw grep's added feature |
|---|---:|---|---:|---|---|
| codex | 11 | 2 exact + 2 loose = 4 | 3 | hits 2, zero 2 | `-C 8` on `dist/index.js` (1); `dist/`/`src/build` scope (2); broader alternation over `src test` (1) |
| opencode | 2 | 2 exact | 2 | hits 1, zero 1 | `dist/index.js` scope (1); `--include` on `src/build/virtual_target.py` after a zero (1) |
| claude-code | 13 (all in subagents) | 8 loose | 3 | zero 8 | broader alternations after worktree-scoped zeros (`build`, `configuration|config`, `submitFailed`) |
| **total** | **26** | **14** | **8 of 198** | **zero 10, hits 4** | |

Reading: the sweet arm re-ran an `ss-grep` HIT as raw grep 4 times in 198 rollouts. Three of the
four targeted `dist/index.js` (`aws-actions__configure-aws-credentials-42`, codex rep1 call 19
with `-C 8`, opencode rep2 call 25, and codex rep1 call 20 as a follow-up) because the index
excludes `dist/` by design and the agent needed the bundled copy; the fourth
(`bfgroup__b2-259` codex rep0 call 21) widened a 6-hit `ss-grep "check-target-builds"` to a
three-way alternation over `src test`. The other 10 followed a zero, where a raw scan is what
the guide's own "edit too recent" exception implies. Codex's ~2,500-token output cap truncated
none of the 14 `ss-*` results involved. The 12 raw greps with no prior `ss-*` pattern are
test-log greps (`rg "Failed|FAIL|Error" /tmp/runtests.out`, moq) and first-turn subagent
sweeps.

Same-file re-read [M; `data/same-file-cases.jsonl`]: a native read of a file an earlier `ss-read`
in the same thread had shown happened 34 times: claude-code 24 (17 after a successful `ss-read`,
narrower window before an `Edit`; 7 after `ss-read … ENOENT` in `bfgroup__b2-259/sweet/rep0`
where the subagent then guessed five more wrong paths with `Read`), codex 6 (all after a
successful `ss-read`, 3 of them `sed -n '1,120p'` of a file `ss-read` had shown 20 lines of),
opencode 4 (all `b2` `src/build` continuation reads).

## 6. Register check and novelty

| finding | nearest register entry | novelty |
|---|---|---|
| Sweet fallback to raw retrieval is 0.7 ops/rollout on codex and opencode, 2.7 on claude-code; ≤2.3% / ≤5.3% / ≤12.2% of sweet cost as an upper bound | `04-resolution-codex.md` §3 (39 fallback events in 18/198 rollouts, pre-fix) and `04-resolution-opencode.md` §3.4 (85 harness-native calls within 2 steps of an `ss-*` call; 133 harness tool calls vs native 975) counted fallbacks but not by capability, tokens, requests, or price | **extends** |
| Claude-code subagents scope `ss-grep --in` to their worktree and get silent zeros; 45/57 zero, 127 downstream native ops, 8.7% of sweet cost | `04-resolution-claude-code.md` §2 saw `.jam` hits inside a `.claude/worktrees/` copy (the duplicate-index face of the same isolation); register F15 rejects *more* delegation for sweet; nothing books worktree scoping as a mechanism | **new** |
| Filename discovery / listing has no `ss-*` equivalent; native does it ~2 ops/rollout on every harness; sweet still does it 0.3 ops/rollout | `04-resolution-opencode.md` §3.4 one sentence ("what the `glob` calls buy is filename discovery — which `ss-find` does not cover"); read-tools plan `sweet-search files` planned, not built | **extends** (cross-harness, priced) |
| Same-pattern re-grep after an `ss-grep` hit: 4 of 198 rollouts, 3 explained by `dist/` exclusion | register B10 ("0 duplicate `ss-*` calls; 3% repeat-hit share") measured `ss-*`→`ss-*` repeats, not `ss-*`→raw | **new measurement, null result** |
| Native `-C`, `-l`, `-c`, `-v`, open-ended/suffix reads are rare or absent; `ss-grep`/`ss-read` flag gaps are not what drives fallback | nothing on the register claims otherwise; C9 (codex continue span) and B14 are about payload, not flags | **new, negative** |
| Grep muscle-memory rejections `-E`, `-h`, `--help` | E2 hygiene shipped (positional path, regex crash, ENOENT, empty body, banner); opencode L4 "accept the grep-shaped invocations the model actually types" | **extends** |
| `src/build`, `.jam`, `dist/` index exclusion drives 41% / 94% / 63% of fallback tokens | E1 SHIPPED; `04-*` D1/D9/L1 | **already-recorded** |
| Main-thread `Read` before `Edit` on claude-code (37 of 245 sweet edits had a native `Read`; 199 relied on `ss-read` only) | D6 unmeasured product risk (218/259 edits without a native `Read`) | **already-recorded** (independent count agrees) |
| Sweet native `git status/diff` 1.2–2.5 per rollout | `SLATE-A` §9.8 "git self-state arm-similar" | **already-recorded** |

## 7. Candidate seeds (mechanisms not on the register)

**S1 — Worktree scope rewrite for `ss-grep` / `ss-find` / `ss-trace` `--in`.**
Mechanism: in the wrapper, when a scope path resolves under `<repo>/.claude/worktrees/<agent>/`,
rewrite it to the repo-root-relative path, search the index, and print the rewrite in the
banner; when the index has no entities for a scope that exists on disk, say so instead of
`(no matches)` (the shipped hint does this only for excluded scopes). Harness: claude-code only
(the only harness that delegates; codex and opencode spawned no subagents in 132 rollouts each).
Vehicle: sweet-only wrapper code; zero differential leak. Trace evidence:
`fp-claudecode-tab-20260826` sweet `asynkron__protoactor-dotnet-1909/rep1`, `bfgroup__b2-113/rep1`,
`bfgroup__b2-113/rep2`, `bfgroup__b2-259/rep0`, `final-form__final-form-64/rep2` (subagent
transcripts under `agent-state/<task>-sweet/claude-home/projects/*/<session>/subagents/`).
Ceiling [I]: the subagent fallback mass is $0.001809 per sweet rollout (8.7%); the part that a
correct scope could have replaced is the 45 zero calls plus the native reads and greps that
followed, but 63% of those tokens are `b2` (index-blind on `.jam` at the time) so a realistic
ceiling is a third of 8.7% ≈ 3% of claude-code sweet cost, and 0% on the other harnesses.
Solve: expected neutral (`b2` stays dead in both arms; final-form and protoactor solved). $0
falsifier: replay the 45 worktree-scoped zero patterns against the fresh `b2`, `final-form`
and `protoactor` goldens with the prefix stripped; kill if fewer than half return the line the
same subagent later found with `grep -R` or `Read`. Build cost: small (path prefix check in
`absorbPositionalPaths`/`--in` handling, `_ss-helpers.mjs`). Register: nearest F15 (rejected
"more delegation"); this does not add delegation, it stops the existing delegation from going
blind. `new_tool: false`, `needs_user_decision: false`.

**S2 — Filename discovery as a mode on an existing tool (`ss-grep --files <glob>`).**
Mechanism: answer `rg --files -g <glob>` / `glob <pattern>` / `find -name <glob>` from the
index's path table (basenames, no content scan) so the guide's "no `find`/`ls` enumeration"
rule has a sanctioned outlet. Harnesses: all three (codex 18 ops, opencode 22, claude 18 +
9 listings in the sweet arm; native 120 / 139 / 137). Vehicle: wrapper flag; sweet-only.
Ceiling [I]: sweet spends $0.000147 (1.2%) codex, $0.000186 (2.0%) opencode, $0.000439
(2.1%) claude on native glob/list tokens plus requests; a mode can only shave the request-shape, not
remove the need, so the honest ceiling is under 1% on every harness — a hygiene item, not a
cost lever. The larger value is enabling the first-turn orientation listing native buys
(11/66 claude native rollouts open with one) without a raw scan; its resolution value is
unmeasured. $0 falsifier: replay the 74 recorded sweet-arm glob/list commands against the
goldens' index path tables and count exact-set matches; kill under 80%. Register: opencode §3.4
observation, read-tools plan (`sweet-search files`, not built). As a flag `new_tool: false`; as
`ss-files` `new_tool: true`; `needs_user_decision: true` (owner rule "improve existing tools").

**S3 — Accept `-E`, `-h`, `--help` (usage with exit 0) in `ss-grep`/`ss-find`.** Mechanism:
argparse inert-flag list + help path. Harness: all; most visible in claude-code subagents (29
usage errors by absolute-path invocations). Vehicle: wrapper; sweet-only. Ceiling: ≤0.2% (each
rejected call is one request ≈ $0.0005–0.0007). $0 falsifier: re-parse the 48 recorded usage
errors with the new rules; kill if fewer than 30 become valid. Extends E2. `new_tool: false`.

No candidate here changes which files an agent edits; all three are cost/hygiene seeds with
solve expected neutral. Nothing in this census supports a "sweet beats native" cost lever above
the ±6-rollout bar by itself.

## 8. Traps met (so the next agent does not repeat them)

1. `rows.calls` excludes `update_plan`/`todowrite`; my codex main-thread call counts exceed it
   by exactly those. Claude `rows.calls` includes subagent calls.
2. Six claude cell-reps hold two main transcripts; match by `idealTurns` (request count), not
   by size or recency.
3. Nine claude-code sweet rollouts have null `costRealizedUsd` (incomplete sidechain
   accounting); they are the delegating rollouts, so a mean over priced rows understates the
   arm ($0.0151 vs the brief's $0.0207). Use the brief's per-rollout mean as the denominator.
4. Splitting shell commands on `|` without quote awareness invents programs from regex
   alternations (`class`, `struct`, `include` appeared as "commands"); use `shellsplit.py`.
5. Regex alternation is NOT an `ss-grep` gap (Rust regex); only BRE `\|` is. My first pass
   booked 274 native greps as "feature-absent" for it — corrected.
6. The fresh-pool runs (08-26/27) predate the hygiene fixes of 08-28 (positional path,
   `(not indexed…)`, banner suppression, `.jam`/`src/build` indexing). Every "after-ss-failure"
   count here is pre-fix.
7. `.claude/` sits on the index ALLOWLIST, not a deny list; a worktree copy may be indexed
   (duplicate, 08-28 observation) or not (silent zero, this report) depending on maintainer
   timing. Do not assume one behaviour.
8. Claude `Read` with `pages: ""` still errors inside subagents (4 of 16 first subagent calls in
   `awslabs__aws-embedded-metrics-node-21/sweet/rep0`); the runner hook recovers the main thread
   (register D4), the subagent retries by hand.
9. Codex wraps every output; banners inside truncated envelopes can be cut, so `ss-*` outcome
   counts are lower bounds (08-28: 10.1% unmatched banners).
10. `multi-record` claude requests: dedupe blocks by `tool_use.id`, never whole records.

## 9. What I could not finish

- Sidechain requests were priced with the blended main-thread $/request ($0.000702); subagent
  contexts are smaller and cheaper per request, so the 8.7% is an upper bound with unknown slack.
- The $0 replay falsifiers for S1–S3 were specified but not run (they need the goldens on the
  box; a couple of hours of read-only work).
- The same-pattern census matched within one thread only; a main-thread `ss-grep` followed by a
  subagent raw grep on the same pattern was not counted.
- `fixval-*` and `rb-*` runs were not analysed (task scope was the three production fresh-pool
  runs).
- Opencode `state.output` was taken as what the model saw; the tool's own truncation
  (`metadata.truncated`) was recorded but not subtracted.
- Solve-side effects of any seed are asserted neutral from the arm-universal loss taxonomy, not
  measured.
