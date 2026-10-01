# Native search and read calls made by the sweet arm: forensic reading

Group `native-fallback`. Scope: every call with class `native-read` or `native-search` in the 1141 rollouts (dossiers class != 'ss'). Labels: `native-fallback.labels.jsonl` (same folder, 111 rows). Extra label fields: `variant`, `class`, `reason`, `legitFallback`, `costVsSs`, `unitOutputChars`, `turnsRemaining`, `solved`.

## Conclusion

1. Most native calls are not forced. Only about 12% of Opus native calls (340 of 2759) are legitimate fallbacks: test logs, dependencies, and checks right after an edit. In the shipped Opus arm they carry about 3% of the measured native tokens.
2. The main native cost is file reading, not search. In the shipped Opus arm (140 rollouts), 57% of file reads are native (384 native vs 295 `ss-read`). Only 19% of greps are native (90 vs 384 `ss-grep`).
3. Opus splits reads by the rules text. The rules call `ss-read` "a narrow range". So Opus sends ranges to `ss-read` (255 ranged calls) and whole files to `cat` (220 calls) or to `Read`. Only 40 whole-file reads use `ss-read`.
4. `ss-read` is not cheaper than `cat` or `sed`. For the same lines it adds fence, header, gutter and "unread above/below" lines. That is 18% of Opus `ss-read` characters (section 5). The rule "a raw read never beats ss-*" is false for reads. Agents are right on cost.
5. `ss-grep` cannot show a body. 19% of Opus native greps use `-A` or `-B`. That is a locate-plus-read in one call. The ss route needs two calls and one more turn.
6. One native pattern is harmful. `grep -rn <token> .` from the repo root matches the `.sweet-search/` index (a 50 MB database and JSON files). Claude Code then shows a 2 KB preview and the real hits are lost. It happened in 4 Opus rollouts of one task (ids in 6.4).
7. Weighted by tokens, the biggest single item is whole-file reads of large files. In single-call native Opus reads, 10% of calls (at least 8k chars) carry 59% of the characters. All 23 are `Read` of one 800-line file, to patch about 10 scattered sites.
8. My 111 hand labels: useful yes 62, partly 29, no 18, harmful 2. Legit fallback: yes 25, partly 46, no 40.

## 1. How I sampled

- Population: 3421 native calls (Opus 2759, gpt-5.6-luna 662 in Claude Code, opencode and Codex). The dossier file has no output or before/after text for native calls. So I rebuilt each call from the raw session with `fx_lib` and `build_dossiers` code (read-only). I read the unit output, the text before and after, and the previous and next calls.
- Sample 1 (91 calls, Python `random`, seed 42): quota per harness and command, round-robin over the 13 tasks. Opus: cat 14, sed 12, grep 14, ls 6, Read 4, head 3, find 3, tail 1, git-ls-files 1. Claude Code luna: 6 main-thread plus 7 sub-agent calls. opencode: read 8, glob 5, ls, grep, rg 1 each. Codex: 4.
- Sample 2 (20 calls, seed 4242): extra Opus calls from the shipped variants only (`product+batch-read6`, `read6fs`, `base-2.8.2`, `V1`, `V1b`), because sample 1 drew mostly stock `baseline` rows.
- Mix of the 111: Opus 78, luna 33. Shipped variants 26, stock `baseline` 48, other trims 37. Solved and unsolved both appear. The quotas are not proportional to the population, so my rates are raw, not weighted.
- Population shares and token numbers come from a script over the same rebuilt data (reason classifier by command, flags, and earlier calls). They are estimates, not hand labels.
- I did not open HO2 or held-out files. No ss-* tool, agent, or paid call was run.

## 2. Usefulness (n = 111)

| group | n | yes | partly | no | harmful |
|---|---|---|---|---|---|
| all | 111 | 62 (56%) | 29 (26%) | 18 (16%) | 2 (2%) |
| Opus 5.5 | 78 | 47 | 21 | 9 | 1 |
| gpt-5.6-luna | 33 | 15 | 8 | 9 | 1 |
| shipped variants only | 26 | 15 | 7 | 3 | 1 |

"Yes" means the call fed an edit or a decision. Most native reads are useful. The question is cost and route, not value.

The two harmful calls: a 1200-line `Read` of `yarn.lock` (51.7k chars, resident for 26 turns), and the recursive grep that hit the index (6.4).

## 3. Why the agent used a native call (hand labels, and population share for Opus)

| reason | sample n | Opus population share | legit? | what the agent needed |
|---|---|---|---|---|
| R1 read right after an ss hit | 19 | 26% | no (16 of 19) | code body after `ss-grep` gave file:line only |
| R14 read of a file ss did not surface | 16 | 13% | mostly no | known path, sibling or test file, "copy-pattern" reads |
| R12 `grep -n` lookup | 10 | 15% | partly | one symbol line in a known file |
| R4 listing (`ls`, `glob`, `git ls-files`) | 11 | 14% | partly | repo layout, find sibling files; no ss lister exists |
| R2 orientation before any ss call | 5 | 7% | partly | first-turn pack on a tiny repo |
| R11 config or doc file | 9 | 7% | partly | package.json, README, CHANGELOG, pubspec |
| R7 test or scratch output | 1 | 7% | yes | test logs, background task files |
| R3 `grep -A/-B` body view | 2 | 4% | no | locate plus read in one call |
| R6 dependency, vendor, lock, outside repo | 13 | 3% | yes (12 of 13) | `node_modules`, `vendor/`, `yarn.lock`, `find /` |
| R5 own edit just made | 11 | 2% | yes | verify a file or lines the agent just wrote |
| R13 re-read or next window | 5 | 2% | partly | window stepping, or re-read of lines already in context |
| R10 sub-agent without rules | 6 | n/a (luna only) | no | see 6.5 |
| R9 / R8 | 3 | n/a | R9 no, R8 yes | a Claude Code `Read` defect; one ss server fault |

Why not `ss-*`, from the text and next actions. These are my readings:

- Habit and idiom. Opus writes `sed -n a,bp` and `cat` without comment. In the stock `baseline` arm 99% of Opus reads are native (642 native vs 8 `ss-read`). Source comments in `scripts/install-claude-lean-harness.js` say Claude Code in bypass mode steers the model to "read files with cat, head, or sed -n". The product turns this off. The shipped arm still reads 57% natively, so the steer is not the only cause.
- The rules text. "`ss-read` - a narrow range" reads as "not for whole files".
- Packing. The shipped prompt says to pack independent steps into one turn. Opus packs `cat a b c; ls x; grep ...`. `ss-read` takes one file per call. 25% of Opus `cat` calls name more than one file (214 of 842). Only 15 units mix `cat` with `ss-read`.
- Cost. A narrow native read is cheaper (section 5). Reasoning on cost, the agent chooses right.
- Missing features. `-A`, several ranges, directory listing, dependency files (section 4).
- Few cases of ss failure. One rollout in 1141 had an ss server error ("Could not locate the bindings file"). The agent said so and fell back to `glob` and `rg` (id in labels, idx 76).

## 4. Legitimate fallbacks and product gaps

Legitimate (no ss alternative, or the rules allow it):
- R5, own edit seconds old: `head -9 f` after `sed -i`, `grep` for symbols just written, `glob` of a new file. 11 labels, all fine.
- R7, test logs and `/tmp` files: `cat .../tasks/<id>.output`. Fine.
- R6, dependencies: `ls node_modules` probes, vendored Go packages (`ss-read vendor/...` is refused with "not indexed"). The answer lives there in at least two tasks (vendored `zcrypto`, `h2x` plugins). Then native is the only route.

Product gaps (ss can and should close them):
- Whole-file and multi-file reads (R1, R2, R14). Gap: wording, multi-file `ss-read`, cost of `ss-read`.
- Body view next to a grep hit (R3 and part of R1). Gap: no context option in `ss-grep`.
- Directory listing (R4). Gap: no lister. Value is low: median native `ls` output is 36 to 117 tokens and it is usually packed in a turn that exists anyway.
- Dependency and lock files (R6). The rules say "the index covers every file". That is false for `vendor/`, `node_modules`, lock files and dot files. Result: dead `ss-read` calls (8 refusals, each followed by a native call) and `find /` scans.
- Bare file names in monorepos. `ss-read pubspec.yaml` fails with ENOENT when the file is in a sub-package (seen in 2 other rollouts); agent then uses `sed`.

## 5. Was native cheaper or dearer than the ss route?

| need | native cost | ss route | verdict |
|---|---|---|---|
| 10-40 line range after a hit | `sed -n`: code only | `ss-read`: header, fence, gutter, unread-above/below lines. 20-35% extra in my 4 measured examples; 18% pooled for Opus (header 2.7%, fence 0.7%, gutter 7.9%, notes 6.6%) | native cheaper |
| whole file | `cat`: code only | header, fence, gutter, about 10% extra | native cheaper |
| several files or windows in one turn | 1 call | 1 call per file or range | native cheaper in calls (4 windows: 1 call vs 4) |
| one symbol line in a known file | `grep -n f`: 60-100 chars | `ss-grep --in`: header plus path on every line. Path is 47% of Opus `ss-grep` characters | native cheaper for 1-3 hits |
| definition body (`grep -A 10`) | 1 call | `ss-grep` plus `ss-read` (2 calls, 1 extra turn that re-reads the whole context) | native cheaper in turns |
| search a concept, trace callers | n/a | `ss-search`, `ss-trace` | ss wins, but Opus rarely needs it on these small repos |
| re-read of lines already shown | full price | `ss-read` omits "unchanged" rereads | ss cheaper, but the omission never fired for Opus (0 of 739 calls; 46 of 4609 for luna) |

Measured native mass (Opus). In the shipped arm, units with only native reads carry 22.8% of amplified tool-output tokens, and native-only packs 20.9%. Units with only ss calls carry 30.5%. In all Opus runs, native-read is 16.3% of amplified tokens and `ss-read` is 20.1% (STATS section A). By reason, in the shipped arm (1.45M measured amplified tokens): R1 68%, R14 9%, R4 6%, R2 5%, R11 4%, R12 3%, R7 2%, R6 1%.

Waste in my 111 calls: 160k of 336k unit-output characters (48% pooled). Three calls give 79k: the lock file (50k), the 29k whole-file `Read`, and a re-read of `AGENTS.md` (9k). Without them the waste is 33%. The median call wastes 30%. By command: `cat` 48%, `Read` 76%, `sed` 25%, `grep` 12%, `ls` 27%, `glob` 73% (long absolute paths).

Parts used and ignored. Used: file text 57 calls, grep lines 16, listings 12, probe or error text 15. Ignored (counts of named leftovers): license headers 4, text already in context 4, duplicate lines 2, test bodies 3, unused lower half of a file 3.

## 6. Recurring patterns

### 6.1 Whole-file `cat` after an `ss-grep` hit (R1)
The agent gets file:line, then reads the whole file. Opus: 164 `cat` calls plus 56 multi-file `cat` calls, against 40 whole-file `ss-read`.
- `hc-claudecode-20260929-0320-L3/zmap__zlint-299/r0#2`: `cat lints/lint_ct_sct_policy_count_unsatisfied.go`, packed with an `ss-grep`. It then edits. 800 chars of licence header came along.
- `hsmoke-claudecode-20260926-0031-L4/pytask-dev__pytask-210/r0#1`: `cat src/_pytask/traceback.py` after one `ss-grep`; edit follows.
- Agent says nothing about the choice. I read it as idiom plus the "narrow range" wording.

### 6.2 Locate-plus-read in one native call
`grep -n X f -A N`, or several `sed` windows in one Bash call.
- `hsmoke-claudecode-20260926-0031-L1/jensneuse__graphql-go-tools-174/r0#24`: `grep -n "ObjectTypeDefinition struct" -A 10 pkg/ast/ast.go`. The ss route needs two calls, with 19 turns still to run.
- `tg-20261001-0440-L5/superlistapp__super_editor-2516/r0#4`: four `sed` windows of one file in one call, then a `perl` replace.
- `tg-20261001-0657-v2-L1/superlistapp__super_editor-2516/r0#1`: `Read` of 700 lines (29k chars) after one `ss-grep` that listed about 10 sites. The agent needed bodies at all sites. This one call wastes about 20k chars. This is the biggest per-call item in the sample.

### 6.3 Over-reading (copy-pattern and call-chain crawls)
- `hc-claudecode-20260929-2343-L3/joshuakgoldberg__bingo-271/r0#4` and `hc-claudecode-20260929-1820-L2/.../bingo-271/r0#4`: adjacent windows `1,60p` and `60,180p`, then four more CLI files. Unsolved. The rules name `ss-trace` for flows; the agent crawled by hand.
- `hc-opencode-20260929-1804-L2/smooth-code__svgr-10/r0#20`: third sibling plugin read. The rules cap copy-pattern reads at two.
- `tg-20261001-0440-L3/smooth-code__svgr-10/r0#26`: `sed -n 30,60p src/index.js` for lines that a `cat src/index.js` showed two turns earlier.

### 6.4 `.sweet-search/` in native recursive greps (harmful)
`grep -rn "<token>" --exclude-dir=node_modules .` matches `.sweet-search/codebase-late-interaction.db` (50.9 MB of the 51.1 MB output) and the JSON index files.
- `tg-20261001-0657-v2-L1/ember-cli__eslint-plugin-ember-551/r0#8`: "Output too large (48.7MB)". The model sees a 2 KB preview of the whole Bash result. The README and `lib/index.js` hits never arrive. Next turn it runs `cat lib/index.js` again.
- Same cause in `hc-claudecode-20260929-0138-L1/...ember-551/r0#6`, `...2343-L1/...r0#4`, `...0930-0022-L1/...r0#4`.
- Claude Code's own Grep tool (ripgrep) skips ignored files. Shell `grep -r` does not.

### 6.5 Sub-agents without the rules (luna in Claude Code, 2026-09-25/26 baseline runs)
121 of 190 luna native calls (64%) sit in sub-agent threads. Two of 12 side threads used no ss tool at all (84 and 29 calls). Others searched the disk for the tools: `command -v ss-find ss-grep ss-cat ss-ls ss-rg`, `find . -name 'sweet-search.md'`. One sub-agent ran `find /Users/admin/Projects ...` outside the sandbox (`hsmoke-claudecode-luna-20260925-2153-L4/gitbookio__markup-it-56/r0@side:aa7b666b#73`). Evidence is from the stock `baseline` arm. The shipped product replaces the `general-purpose` and `Plan` agents; I did not check that replacement here.

### 6.6 Dead calls for absent dependencies and lock files
- `find /` runs: 14 in Opus (13 rollouts), 8 hit the 120 s timeout. Example `tg-20261001-0657-v2-L6/joshuakgoldberg__bingo-271/r0#14`, `tg-20261001-0657-v2-L7/smooth-code__svgr-10/r0#8`. The checkout has no `node_modules`; `run_tests` installs them elsewhere. One codex agent wrote: "The dependency is not present in the checkout (it is injected only inside run_tests)".
- `Read yarn.lock` with limit 1200 (id `hsmoke-claudecode-luna-20260926-1525-L2/smooth-code__svgr-10/r0@side:a87d3a9a#27`): 13k tokens re-read for 26 turns, then not cited.
- `ss-read vendor/...` refused, then native `rg` works (`hc-opencode-20260929-1734-L3/zmap__zlint-299/r0#16`, solved). Here native is correct and ss could have done it.
- Claude Code luna: 43 of 125 native `Read` calls (34%, 22 rollouts) fail with "Invalid pages parameter". The runner notes a hook for this. Check it is on in the shipped path.
- opencode: 6 reads of `AGENTS.md` (9.4k chars, resident for up to 26 turns), about 195k amplified tokens. The file is normally already in the instructions.

## 7. Does the agent understand the tools?

- For native calls the question is "why not ss". In 70 of 111 labels the agent used the right tool for the need. In 23 it did not (mostly R6 dead calls, `find /`, hand crawls). In 15 I cannot tell, and 3 are partly right.
- Misuse seen: re-running an ss hit as raw grep in the same call (2 labels, idx 29 and 36; rules forbid it); `find /` and home-wide `glob` for absent packages; re-reading lines already in context (4 labels); reading `AGENTS.md`; `ss-grep --in` errors hidden by `2>/dev/null`.
- Opus does not use `ss-read` whole-file and does not use `ss-search` (35 calls in 492 rollouts). On these small repos `ss-grep` plus a direct read is the cheapest chain, and Opus found it.

## 8. Proposals, ranked by expected tokens saved times frequency

General wording only. No fix names a task, repo, or symbol.

1. Make `ss-read` as cheap as `sed` for ranges. Remove the fence and the "unread above/below" lines for ranges under about 40 lines, or add a quiet flag; make the gutter off where the harness does not need exact anchors. Expected: 18% of `ss-read` characters, which is 20% of Opus amplified tool tokens, so about 3.6% of all tool-output tokens. It also removes the cost reason for native reads. Frequency: every `ss-read` (1.5-2 per rollout). Risk: the gutter was added for exact edit anchors (Claude Code Edit). Test edit exactness on the dev split first. The "unread" lines help navigation; measure before removing.
2. Add context lines and multi-range to the read path. `ss-grep -A/-B/-C N` with the path printed once per file; `ss-read` taking several files or ranges (`ss-read a.js b.js:10-40`). Expected: removes the `grep -A` chains (19% of native greps) and the packed `cat`/`sed` windows (R1, R2, R14: 46% of Opus native calls). Saves one call and one turn per chain, and about 25% of the characters of 4 separate `ss-read` calls. Frequency: about 1 chain per rollout. Risk: low for accuracy. More lines per `ss-grep` hit can raise output; keep the default at 0.
3. Rules wording (needs the normal rules gate before shipping):
   - Change "`ss-read <file> [start] [end]` - a narrow range" to "a file or a range".
   - Replace "the index covers every file" with a true statement: "dependency, vendor, lock, build and dot paths are not indexed; read them with your own tools, narrowly: grep for the one package, never read a whole lock file".
   - Add "If a dependency directory is missing, say so and work from the repository. Do not scan the filesystem (`find /`)".
   Expected: removes dead `ss-read` calls and `find /` scans (14 in Opus, 8 timeouts). Frequency: about 1 in 10 rollouts on dependency-heavy tasks. Tokens are small; wall-clock and turns are not. Risk: more native reads if the first line is read as permission; pair with proposal 1 so ss is not dearer.
4. Keep `.sweet-search/` out of the working tree (cache dir) or make shell `grep -r` skip it. Expected tokens: small (4 of 136 stock Opus rollouts), but each case loses the real hits and costs a re-read. Risk: none for accuracy; needs an index-location migration and a check of the incremental path.
5. `ss-grep --in <file>`: print the path once, no header for one file. Expected: 2-3x smaller than now for 1-3 hits; closes R12 (15% of Opus native calls). Risk: none.
6. Sub-agents: confirm that the shipped `general-purpose` and `Plan` agent files carry the rules and that `ss-*` is on the PATH inside worktrees. Evidence is from the stock arm only, so verify before spending effort.
7. Lister (`ss-ls`): last. R4 is 14% of Opus native calls but about 6% of measured native tokens and the calls are packed with others. Do not build it for tokens.
8. Do not try to remove legitimate fallbacks (R5, R6, R7). They are 12% of calls and 3% of mass.

## 9. Caveats

- 13 tasks, dev pool only. Task effects are large: one task gives all 23 big `Read` calls.
- Rates are from 111 hand labels with unequal quotas. Population shares and token numbers are script estimates (about +/- a few points).
- Token mass for compound Bash units is split evenly across native segments; units that also hold `ss`, test, or edit output are excluded from the mass table.
- The stock `baseline` arm is 48 of my 111 labels; shipped variants are 26. Shipped-only usefulness is 15 yes, 7 partly, 3 no, 1 harmful.
- I cannot see Opus reasoning (empty), so "why" is read from text and next actions.
