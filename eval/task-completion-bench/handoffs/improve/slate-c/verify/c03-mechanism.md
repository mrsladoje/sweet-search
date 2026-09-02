# c03 verification, mechanism lens: worktree-aware `ss-*`

Date 2026-09-02. Verifier: workflow agent `c03-mechanism`. Cost $0 (trace reading on the
evidence box, code reading, one synthetic-repository reproduction, a filesystem grep replay
against the goldens). Scratch on the box: `/tmp/wf-slatec/c03-mechanism/`. Scripts and
outputs are copied to `slate-c/verify/scripts-c03-mechanism/`.

Tags: `[M]` measured (script named), `[C]` read from code, `[W]` web with URL, `[I]` inferred.

## 0. Verdict

The mechanism is real and both kill conditions fail to fire, so c03 survives, but its cost
ceiling is refuted and must be replaced. Half (1) is confirmed: from a linked git worktree,
`ss-grep` exits 2 with `[ss-*] no Sweet Search index at <worktree>/.sweet-search/codebase.db`
`[M]`, and Claude Code puts every desktop-app session and every `--worktree` session in such a
worktree `[W]`. Half (2) is confirmed: exactly 45 worktree-scoped `ss-grep`/`ss-find` calls in
5 sweet subagents returned zero `[M]`, the code path explains why `[C]`, and 43 of the 45
patterns hit in the golden root once the worktree prefix is stripped, 34 of them in a file the
same subagent later read natively `[M]`. The ceiling arithmetic is wrong. The "127 native ops,
184,470 tokens, 8.7% of the cell" figure is the whole subagent native-retrieval mass of the
sweet arm, not the part the worktree zeros caused. 64 of those ops sit in five subagents that
never scoped a call to a worktree, 11 more precede the first zero, and only 46 ops (about
81,000 tokens, 3.5% of the cell) follow a worktree zero `[M]`. Of those 46, 40 are `Read` calls
by `Explore` subagents that made zero `ss-read` calls in their whole life, so they belong to
the guide-less-Explore mechanism (candidate c08), not to worktree scoping. Only one subagent
(`final-form__final-form-64/rep2`) abandoned `ss-*` after its zeros; the other four kept
getting unscoped `ss-*` hits. The bench ceiling on claude-code is therefore at most 3.5% loose,
about 1.3 to 2.0% fair, and zero on codex and opencode. The real-user "54% of a cell" figure
describes a session that runs entirely inside a worktree, where sweet-search delivers nothing;
it is not an extra cost. Book c03 as a real-user correctness fix with two design additions,
not as a cost lever.

## 1. What I checked

- Local code: `eval/agent-read-workflows/bin/_ss-helpers.mjs` lines 136 to 147, 235 to 259,
  338 to 382; `_ss-argparse.mjs`; `_ss-env.sh`; `ss-grep`; `core/search/grep-output-shaping.js`
  `matchesGrepFileFilter` and `pathSegments`; `core/search/search-pattern.js` 138 to 200;
  `core/search/search-read.js` 142 to 156 and 394 to 405; `core/infrastructure/config/search.js`
  360 to 400; `harness/agent-runner-shared.mjs` 134 to 152; `harness/claude-code-task-runner.mjs`
  (grep for cwd and rundir).
- Documents: `BRIEF.md`, `DEAD-LEVER-REGISTER-DRAFT.md`, `register/DEAD-LEVER-REGISTER.md`,
  `forensics/claude-subagents.md`, `forensics/native-capability-gaps.md` (§3.1, §3.2, §7 S1),
  `forensics/scripts-native-capability-gaps/data/analysis-extras.txt`, `candidates/DEDUP.md` c03,
  `candidates/cost-structural.md` §4.3, `candidates/real-user-product.md` §1.4 and RU-3,
  `harness-gutter-cost-20260828/04-resolution-claude-code.md` line 174.
- Box (read-only): `results/fp-claudecode-tab-20260826/rows.json`; all 11 sweet subagent
  transcripts under `agent-state/*-sweet/claude-home/projects/*/*/subagents/agent-*.jsonl`; all
  main transcripts of the tab run for the `Agent` census; the pre-classified corpus
  `/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz` and `events-claude-code.jsonl.gz`;
  the run log `/root/fresh-run/fp-claudecode-tab-20260826.log` for the task-to-golden map; goldens
  `/root/.ss-eval/golden/{asynkron__protoactor-dotnet@3a998bc9…, bfgroup__b2@371b47af…,
  bfgroup__b2@7cf7bdab…, final-form__final-form@449955e7…}`.
- Web: `https://code.claude.com/docs/en/sub-agents`, `https://code.claude.com/docs/en/worktrees`.
- Scripts: `c03_verify.py` (corpus pass), `c03_raw.py` (raw transcript pass), `c03_replay.py`
  (golden replay and call sequences). Outputs in `scripts-c03-mechanism/data/`.

## 2. Half (1): `ss-*` exits 2 inside a git worktree

Code `[C]`: `_ss-helpers.mjs:138` sets `PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd()`.
Lines 140 to 146 test `existsSync(<root>/.sweet-search/codebase.db)` and call `process.exit(2)`.
The guard runs at module top level before any subcommand. `_ss-env.sh` sets four other
variables and never sets the project root `[C]`. No script under `scripts/` that a real user
runs at `init` sets it either; the setters are bench and batch scripts only
(`agent-runner-shared.mjs:142`, `cc-batch.mjs`, `usd-capture-*.mjs`, `smoke-test.js`) `[M grep]`.

Reproduction `[M]`: a synthetic repository with a committed file and a placeholder
`.sweet-search/codebase.db`, then `git worktree add`. The linked worktree contains `.git`,
`.gitignore`, `a.txt` and no `.sweet-search/`. `git rev-parse --git-common-dir` from inside the
worktree prints the main checkout's `.git`. Running `bash eval/agent-read-workflows/bin/ss-grep foo`
from the worktree with the variable unset exits 2 and prints
`[ss-*] no Sweet Search index at <worktree>/.sweet-search/codebase.db`. Kill condition (1) is
not met: the wrapper does not resolve a worktree today.

Who hits it `[W]`: the worktrees page says the desktop app gives "every new session ... its own
worktree automatically", `claude --worktree <name>` creates `.claude/worktrees/<name>/`, and
subagents run in a worktree when the model passes `isolation: "worktree"` or a custom agent's
frontmatter sets it. The sub-agents page confirms `isolation` is a frontmatter field and a
per-call parameter; it is not a default. In the bench, the backbone chose it on 44 of 44 `Agent`
calls in the tab run: 33 native (Explore 30, general-purpose 3) and 11 sweet (Explore 8,
general-purpose 3) `[M` Agent tool_use census over the main transcripts, deduplicated by block
id`]`. Whether Anthropic models choose it as often is not measurable here.

Bench masking `[M]`: zero occurrences of "no Sweet Search index" in any sweet-arm tool output
of the tab run (1,971 calls), because the runner exports `SWEET_SEARCH_PROJECT_ROOT = rundir`
`[C agent-runner-shared.mjs:142]`. The candidate's statement is correct.

Two design facts the candidate must absorb:

1. Redirecting `PROJECT_ROOT` to the common directory would make `ss-read` and `ss-semantic`
   read the main checkout's files, not the worktree's. `search-read.js` `_resolvePath` resolves
   a relative path against `projectRoot` (`:149-152`), and `readFile` takes
   `req.projectRoot || process.cwd()` (`:403-404`); the wrapper passes `projectRoot: PROJECT_ROOT`
   (`_ss-helpers.mjs:627`) `[C]`. In a worktree session the agent edits the worktree, so anchors
   read from the main checkout can be wrong. This is the same two-views hazard the bench already
   recorded under the pin (6 of 22 subagent `ss-*` results echoing the parent's edits, claude-subagents
   §6.1; not re-verified here). The fix must split the roots: index root = common directory's
   checkout, read root = cwd. A header line alone does not remove wrong file content.
2. Worktree copies are indexable. `.claude/` is on `AGENTIC_GITIGNORE_ALLOWLIST`
   (`config/search.js:379-395`) `[C]`, which re-admits `.claude/` even when `.gitignore` lists it,
   and the docs tell users to gitignore `.claude/worktrees/` `[W]`. The 08-28 forensics saw
   `ss-grep` return a `.jam` path four times "inside a `.claude/worktrees/` copy"
   (`04-resolution-claude-code.md:174`) `[M prior]`. So after a subagent spawns, the maintainer can
   index a second copy of the repository under the main checkout, and the main session's
   `ss-search` ranking sees duplicates. The fix must also deny `.claude/worktrees/**` at admission.
   The scope rewrite in half (2) is then the query-side half of the same fix.

## 3. Half (2): worktree-scoped `--in` returns zero in the bench

Code path `[C]`: `cmdGrep` passes `--in` values (and absorbed positional paths that exist on
disk, `_ss-helpers.mjs:235-238`) as `fileFilter`. `matchesGrepFileFilter` takes an absolute
scope only if its segments start with the project root's segments, strips the root, and then
requires the repo-relative indexed path to start with the remainder
(`grep-output-shaping.js:55-88`). For `--in /root/.ss-eval/runs/r2-54/.claude/worktrees/agent-a41e46d3e2671aa14`
the remainder is `.claude/worktrees/agent-a41e…`, so only indexed files under that prefix
can match. Zero is therefore "worktree copy not in the index", exactly as the candidate says.
The shipped `(not indexed: …)` hint cannot fire because the admission policy admits `.claude/`
`[C]`. An absolute scope elsewhere under the root does work by the same code; no sweet-arm call
in the run used one, so this has no trace test `[M c03_verify (1b)]`.

Counts `[M c03_raw.py]`, tab run, 11 sweet subagent transcripts, 490 calls, deduplicated by
`tool_use.id`:

| subagent (task, rep, agent) | type | ss calls | worktree-scoped | zero | usage | other |
|---|---|---:|---:|---:|---:|---:|
| protoactor-1909 r1 `a3d311866bfc0b7cb` | Explore | 18 | 6 | 5 | 1 | 0 |
| b2-113 r1 `abd536db90e42b25d` | Explore | 51 | 13 | 12 | 1 | 0 |
| b2-113 r2 `a41e46d3e2671aa14` | Explore | 43 | 8 | 5 | 3 | 0 |
| b2-259 r0 `a04ad28e63dd30186` | Explore | 61 | 30 | 12 | 6 | 12 |
| final-form-64 r2 `a38e681945774a613` | Explore | 16 | 14 | 11 | 2 | 1 |
| the other 6 subagents (awslabs r0, r2; b2-259 r0 two general-purpose; b2-259 r1; fastify r0) | — | 150 | 0 | 0 | 0 | 0 |
| total | | 339 | 71 | 45 | 13 | 13 |

The 45 zeros match the candidate exactly. Usage errors are 13 here against 12 in the source
(one classification difference). The 13 "other" calls are `ss-find` calls whose first
positional was the worktree path itself, so the wrapper took the path as the query and searched
unscoped; their headers read `# ss-find: ColGrep 6 for "<worktree path>" …` `[M]`. They are not
zeros and were rightly left out of the source's 57. 44 of the 71 scoped calls named the worktree
root; 27 named a subpath under it `[M]`.

Denominators: 5 of 66 sweet rollouts (7.6%) and 5 of 11 sweet subagents carried any worktree
zero. The candidate's "44/44" is the tab run only; the none and pipe forms hold 9 and 7 more
sweet subagents that nobody has examined.

## 4. Kill condition (2): golden replay of the 45 zero patterns

Method `[M c03_replay.py]`: for each zero call, take the pattern as typed (`-F` becomes
`grep -F`, else `grep -E`; `-i`, `-w` and a leading `(?i)` are honoured; `ss-find` uses its
`--regex`), strip the worktree prefix, and run `grep -rIl` over the task's golden checkout
(subpath kept when the call scoped one; `.git`, `.sweet-search`, `node_modules`, `dist`
excluded). No index and no daemon are involved. Task-to-golden map read from the run log
(`[golden]` line before each `###` task header): b2-113 → `bfgroup__b2@371b47af…`,
b2-259 → `bfgroup__b2@7cf7bdab…`, protoactor → `@3a998bc9…`, final-form → `@449955e7…`.

| subagent | zero calls | pattern hits in golden | hit in a file the subagent later `Read` | hits only in `.jam` or `src/build` (pre-E1 blind) |
|---|---:|---:|---:|---:|
| protoactor r1 | 5 | 5 | 4 | 0 |
| b2-113 r1 | 12 | 12 | 7 | 5 |
| b2-113 r2 | 5 | 5 | 4 | 1 |
| b2-259 r0 | 12 | 12 | 10 | 0 |
| final-form r2 | 11 | 9 | 9 | 0 |
| total | 45 | 43 (96%) | 34 (76%) | 6 |

Reading: 34 of 45 (76%) return a line in a file the same subagent later found natively, above
the pre-registered "half" bar, so the rewrite is not killed. With the pre-E1 index, 6 of the 43
hits would still have been blind (`.jam` and `src/build`), so 37 of 45 (82%) would have
returned then. Every scoped subpath named by a call exists in the golden (25 of 25) `[M]`.

## 5. Ceiling: what the traces attribute to the worktree zeros

Source claim: 127 native retrieval ops, 184,470 tokens, 91 sole-native requests in 7 rollouts,
priced at $0.001809 per sweet rollout = 8.7% of the $0.020727 cell; "about 3% realistic" after
removing the b2 share. The pricing arithmetic reproduces: 184,470 × $0.301/M + 91 × $0.000702,
over 66 rollouts, is $0.001809 = 8.73% `[M]`. The attribution does not.

Raw-transcript recount `[M c03_raw.py]`, native retrieval ops in the 11 sweet subagents (Read,
Bash grep/rg, find/ls): 121 ops, 673,857 characters of input plus output. At the corpus
calibration of 3.54 characters per o200k token (2,631,005 side characters against 743,399 side
tokens `[M]`) that is about 190,400 tokens, within 4% of the source's 184,470, so the total is
the same population.

| subset | ops | characters | tokens (÷3.54) | requests (0.72 per op, the source's 91/127) | $ per rollout | % of cell |
|---|---:|---:|---:|---:|---:|---:|
| all subagent native retrieval (source's population) | 121 | 673,857 | 190,400 | 87 | 0.001791 | 8.6 |
| in subagents with no worktree-scoped call at all (awslabs r0, r2; b2-259 r0 general-purpose ×2; b2-259 r1) | 64 | 306,922 | 86,700 | 46 | — | — |
| in the 5 affected subagents, before their first worktree zero | 11 | 78,570 | 22,200 | 8 | — | — |
| after the first worktree zero, 5 subagents (loose upper bound) | 46 | 288,365 | 81,478 | 33 | 0.000722 | 3.5 |
| within 3 calls after a zero | 16 | 99,373 | 28,078 | 11 | 0.000250 | 1.2 |
| the one subagent that abandoned `ss-*` after zeros (final-form r2) | 15 | 121,924 | 34,450 | 11 | 0.000271 | 1.3 |
| plus the 8 unscoped reruns that got hits (requests only) | 8 | — | — | 8 | 0.000085 | 0.4 |

Call sequences `[M c03_replay.py]`, Z = worktree zero or usage error, S = other `ss-*` hit,
s = other `ss-*` zero or error, R = native Read, G = native grep, F = find/ls:

- protoactor r1: `GGGFRG.RsssZZSZSSSZRRRZ.ZS.SSSS.` — 7 of its 10 native ops precede the first Z.
- b2-113 r1: `.FssZZZFZZZSSSSZZSSSSSSSSSSSSSSSSSSSSSSSZSSFZSSSRSRZSSZS.ZRRR..` — 36 unscoped hits after the zeros; the 5 Reads come after those hits.
- b2-113 r2: `.sssZZZZZZZZSSssssSSSRRRRRRRRssSsRssS.SSSRSSssRRRGssssRssGRRRsS.RS` — 14 unscoped hits; all 18 Reads follow a hit.
- b2-259 r0 Explore: `sZSZZSZZZZZZSSSZZZRSSSZSZSZSSZZZSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS.` — 42 unscoped hits, 1 Read.
- final-form r2: `.sssZZZZZZZRRRRRRZZ.RZZZZRRGRRR..GR.` — 0 unscoped hits; 13 Reads and 2 greps after the zeros.

`ss-read` count in the five affected subagents: 0, 0, 0, 0, 0 `[M]`. These `Explore` subagents
read with native `Read` from their first call, before and after any zero. A correct scoped
result would have replaced `(no matches)` with hits; it would not have turned their Reads into
`ss-read`. That conversion is candidate c08's mechanism (guide-carrying `Explore`), and the two
candidates must not both book the same 87 Reads.

Revised bench ceiling, claude-code sweet cell: at most 3.5% as a loose upper bound (every
native op after a worktree zero), about 1.3 to 2.0% as a fair upper bound (the one clean
fallback plus the wasted reruns and listings), and less as a realistic saving because a hit
result costs more output tokens than `(no matches)` and the b2 tasks (3 of the 5 affected
rollouts) are dead in every cell. Codex and opencode: 0 for half (2) (no delegation in 264
rollouts `[M claude-subagents F9]`) and 0 for half (1) in the bench (the pin). The candidate's
"8.7% upper bound" is 2.5 times the mechanism-consistent bound; its "about 3% realistic" is 1.5
to 2.3 times the fair figure.

Solves `[M rows.json]`: protoactor sweet 3/3 and native 3/3; final-form sweet 3/3 and native
3/3; b2-113 sweet 0/3, native 1/3; b2-259 0/3 both arms. The five affected rollouts are on tasks
solved in every rep or failed in every rep by the sweet arm; 0 solves can move. The two-views
hazard is the only solve risk and it is a design constraint (section 2), not a measured loss.

## 6. Real-user ceiling: relabel the 54%

The "16.04 Bash envelopes per rollout × $0.00070 = $0.0112 = 54%" figure is the share of a
claude-code sweet rollout's spend that is Bash envelopes `[M perm.py, cited]`. It describes a
session run entirely inside a worktree (desktop-app default, `claude --worktree`, a human
`git worktree add`). In such a session every `ss-*` call exits 2 at once, the agent falls back
to native tools after one or two failures, and sweet-search delivers nothing. The right wording
is "100% of sweet-search's value is lost in that session; the extra cost is one or two failed
requests" `[I]`. For the scenario the bench evidences (worktree-isolated subagents), only
subagent `ss-*` calls fail: 317 calls in 11 subagents over 66 rollouts = 4.8 per rollout; if
every one failed at one request that is 16% of the cell as an absolute bound, and two failed
calls per subagent before falling back is 1.1% `[I from M counts]`. Codex and opencode users
hit half (1) only if they run inside a worktree themselves.

## 7. Corrections the synthesis must adopt

1. Replace "127 native ops (184,470 tokens) in 7 rollouts" with: 121 to 127 native retrieval
   ops in 8 subagent-bearing rollouts; 64 of them in subagents with no worktree-scoped call; 46
   ops (about 81,000 tokens) follow a worktree zero in 5 rollouts; only 1 subagent abandoned
   `ss-*` after its zeros.
2. Replace "8.7% upper bound, about 3% realistic" with "at most 3.5% loose, 1.3 to 2.0% fair,
   claude-code only; 0% codex and opencode; 0 solves". Do not book the 87 subagent Reads here
   and in c08 both; they are c08's.
3. Keep "45 zero" (verified exactly); state "13 usage errors" or "12 to 13"; note 13 further
   `ss-find` calls took the worktree path as the query and returned unscoped hits.
4. Relabel the real-user "54%" as the share of spend that would be worthless in a session run
   entirely inside a worktree (desktop app by default `[W]`), not as an extra cost; give the
   subagent-scenario bound separately (4.8 subagent `ss-*` calls per rollout; 1.1% at two failed
   calls per subagent).
5. Add two design requirements to the mechanism: (a) split the roots — index lookups go to the
   common directory's checkout, `ss-read`/`ss-semantic` file reads stay on the worktree cwd,
   otherwise the two-views hazard is shipped to every worktree user; (b) deny `.claude/worktrees/**`
   at index admission, because `.claude/` is allowlisted and worktree copies have already been
   seen inside an index.
6. State the denominators: 44/44 is the tab run's `Agent` calls (33 native, 11 sweet); the 45
   zeros are 5 of 66 sweet rollouts and 5 of 11 sweet subagents; the none and pipe forms (16
   more sweet subagents) are unexamined.
7. Kill condition (2) result: 34 of 45 patterns (76%) return a line in a file the subagent later
   read natively; 43 of 45 (96%) hit somewhere in the golden root; 6 of the 43 only in files the
   pre-E1 index did not cover.
8. Book c03 as a product-correctness fix whose benchmark cost effect cannot clear the ±6 rollout
   bar, and rank it accordingly; its real-user value is that sweet stops being strictly worse than
   native in worktree sessions.

## 8. What I could not finish, and traps

- `tiktoken` is not installed on the box, so tokens are characters divided by 3.54, calibrated on
  the corpus totals; requests are 0.72 per op from the source's own ratio. Both are approximations
  of the right order; the source's 184,470 reproduces within 4%.
- I did not re-verify the "6 of 22 results echoed the parent's edits" two-views count; it is cited
  from claude-subagents §6.1.
- I did not examine the `fp-claudecode-none` and `-pipe` sweet subagents (16 transcripts).
- Whether Anthropic models pick `isolation: worktree` for subagents as often as the bench's
  backbone did is unknown; the docs make it opt-in. The desktop-app default is documented and
  does not depend on the model.
- Trap: a placeholder `codebase.db` passes the guard. My control run with the variable pointed at
  the synthetic main checkout returned `0 total match(es)` and started a local daemon and
  maintainer (pids 59696, 59697, 02:56 today); both were stopped and the synthetic repositories
  removed. Do not run the guard-pass control on a machine that must stay quiet; the worktree case
  alone (exit 2 before any engine work) is enough for the falsifier.
- Trap: the corpus records attach subagent calls to the parent transcript path, so a rollout with
  three subagents (b2-259 r0) appears as one sequence there; use the raw `subagents/agent-*.jsonl`
  files for per-subagent ordering.
- Trap: `ss-find` output starts with `# ss-find: ColGrep N …`, not `N total match(es)`; a zero/hit
  classifier that only knows the `ss-grep` header misfiles it.

## Appendix A. Exact paths and commands

- Rollouts (all `fp-claudecode-tab-20260826`, sweet): `asynkron__protoactor-dotnet-1909/rep1`
  (`…/-root--ss-eval-runs-r1-28/2b6fd5e0-…/subagents/agent-a3d311866bfc0b7cb.jsonl`),
  `bfgroup__b2-113/rep1` (`…/r1-53/47129fb0-…/subagents/agent-abd536db90e42b25d.jsonl`),
  `bfgroup__b2-113/rep2` (`…/r2-54/565a2ec6-…/subagents/agent-a41e46d3e2671aa14.jsonl`),
  `bfgroup__b2-259/rep0` (`…/r0-52/dd934da6-…/subagents/agent-{a04ad28e63dd30186,a8d5f1d037a62e83b,a914bc3d20e9a67cc}.jsonl`),
  `final-form__final-form-64/rep2` (`…/r2-89/271d31a9-…/subagents/agent-a38e681945774a613.jsonl`);
  unaffected: `awslabs__aws-embedded-metrics-node-21/rep0,rep2`, `bfgroup__b2-259/rep1`,
  `fastify__fastify-cors-285/rep0`.
- Box commands: `python3 /tmp/wf-slatec/c03-mechanism/c03_verify.py`, `… c03_raw.py`,
  `… c03_replay.py`; outputs `c03_verify.out`, `c03_raw.out`, `c03_replay.out`,
  `replay.json`, `replay-details.json` (copied to `scripts-c03-mechanism/data/`).
- Agent census one-liner: over `agent-state/*/claude-home/projects/*/*.jsonl` (main only), count
  `tool_use` blocks named `Agent`, deduplicated by id, grouped by `input.isolation`,
  `input.subagent_type`, `input.run_in_background`.
- Local reproduction: synthetic repo in the scratchpad, `git worktree add`, then
  `env -u SWEET_SEARCH_PROJECT_ROOT bash eval/agent-read-workflows/bin/ss-grep foo` from the
  worktree → exit 2 with the "no Sweet Search index" message.
