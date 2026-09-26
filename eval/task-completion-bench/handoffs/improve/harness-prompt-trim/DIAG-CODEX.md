# Codex (Luna) harness trim — flip forensics, integrity, and a v3 edition (2026-09-26)

Scope: sweet arm only, Codex 0.146.1, `openai/gpt-5.6-luna`, reasoning medium, OpenRouter, Mac,
`SS_ISOLATION=0`. All tasks are dev tasks (DEV-RET and multilingual dev). No held-out-2 data was
read. Model spend: $0 (one local-proxy capture per mode, the proxy returns 400).

## 1. Conclusion

- **Neither lost solve was caused by a missing instruction alone.** Both losses start with a
  run_tests defect that hits both arms. The eslint loss is a new file that the agent did not
  `git add`. run_tests and the grader use `git diff HEAD`, so they never see that file. The zlint
  loss is a build failure that run_tests reports as "FAIL, introduced_failures=0, action=none",
  with the compiler error cut out of the output tail.
- **The second pass (mode 1) plausibly made the agent give up sooner when the verdict was red.**
  Finished on a red full run after a green baseline: mode 1 in 3 of 26 rollouts, as-now in 0 of
  32 (Fisher one-sided p = 0.08). After a FAIL verdict the next step was commentary: as-now 50%
  (23/46), mode 1 27% (12/44). The as-now zlint rollout made the SAME wrong edit as the lost
  mode-1 rollout. It wrote down that the FAIL looked like a harness fault, ran a targeted test,
  saw the compile error and recovered. The mode-1 rollout stopped. Mode 1 removed the commentary
  cadence, the "exhaust safe in-scope checks" persistence line and `update_plan`.
- **The trim wins are variance.** Graphql (trim 5/6 v as-now 1/4) turns on finding both
  validator sites. Pytask turns on guessing pytest's `__tracebackhide__(exc_info)` signature.
  Markup-it was solved once in 12 rollouts. No removed text explains any of them.
- **Integrity is clean.** Every one of 84 rollouts got the intended base prompt, byte for byte.
  AGENTS.md (frame + rules) is identical across arms. The only difference is
  `<environment_context>`, which mode 1 removes on purpose. Model, reasoning, CLI version,
  turn context, provider config and env hash match per task.
- **v3 is ready and verified at $0.** It is the first edition with three zero-risk deletions
  and with the commentary rules put back. The permissions message, `<environment_context>`,
  `update_plan` and the whole "Autonomy and persistence" section stay. Diet-only replay: about
  **−14% realized cost** v as-now. Mode 1 gives about −17%. The extra 3 points of mode 1 are
  exactly the cuts that carry the solve risk.
- **The confirm set could not answer the owner's question.** 7 of 10 confirm tasks were 0/4 in
  both arms. The "6/20 → 4/20" verdict rests on 2 flips on 2 tasks. As-now repeats disagree with
  each other at a similar rate. Section 6 gives a design that can.

## 2. Per-task solves, cost and turns (every rollout)

Cell = solves/rollouts — then per rollout: S solved / · not solved, realized $, turns.
v1 = first edition (a84b079). v2 = second pass (e9a888b, current mode `1`). v2+wait = `max-wait`.

### Round 1 — first edition (v1), smoke, 2026-09-25 18:04

| task | as-now | v1 |
|---|---|---|
| gitbookio__markup-it-56 | **0/2** — · $0.0322/33t, · $0.0306/18t | **1/2** — · $0.0156/17t, S $0.0206/18t |
| jensneuse__graphql-go-tools-174 | **1/2** — · $0.0325/29t, S $0.0334/32t | **1/2** — S $0.0191/20t, · $0.0133/14t |
| pytask-dev__pytask-210 | **0/2** — · $0.0087/7t, · $0.0090/7t | **0/2** — · $0.0104/9t, · $0.0092/7t |
| **total** | **1/6**, $0.146, 126 turns | **2/6**, $0.088 (−40%), 85 turns (−33%) |

### Round 2 — second pass (v2), smoke, 23:42; max-wait screen 03:01 (trim legs only, no own baseline)

| task | as-now | v2 | v2+wait |
|---|---|---|---|
| gitbookio__markup-it-56 | **0/2** — · $0.0251/21t, · $0.0318/22t | **0/2** — · $0.0146/16t, · $0.0179/17t | **0/2** — · $0.0241/20t, · $0.0240/21t |
| jensneuse__graphql-go-tools-174 | **0/2** — · $0.0127/14t, · $0.0199/22t | **2/2** — S $0.0265/23t, S $0.0240/20t | **2/2** — S $0.0290/30t, S $0.0248/21t |
| pytask-dev__pytask-210 | **0/2** — · $0.0077/7t, · $0.0063/6t | **1/2** — S $0.0076/6t, · $0.0108/9t | **1/2** — · $0.0078/7t, S $0.0085/8t |
| **total** | **0/6**, $0.104, 92 turns | **3/6**, $0.101 (−3%), 91 turns | **3/6**, $0.118, 107 turns |

### Confirm — second pass (v2), 10 new tasks, 2026-09-26 05:18

| task | as-now | v2 |
|---|---|---|
| dbader__node-datadog-metrics-73 | **0/2** — · $0.0072/7t, · $0.0063/7t | **0/2** — · $0.0049/6t, · $0.0061/10t |
| ember-cli__eslint-plugin-ember-551 | **2/2** — S $0.0313/31t, S $0.0328/34t | **1/2** — S $0.0343/37t, · $0.0475/42t |
| fastify__fastify-cors-285 | **0/2** — · $0.0127/13t, · $0.0180/16t | **0/2** — · $0.0121/12t, · $0.0117/16t |
| joshuakgoldberg__bingo-271 | **0/2** — · $0.0218/20t, · $0.0376/34t | **0/2** — · $0.0272/27t, · $0.0196/19t |
| maxgraph__maxgraph-365 | **0/2** — · $0.0083/10t, · $0.0073/9t | **0/2** — · $0.0077/11t, · $0.0056/9t |
| mwouts__jupytext-360 | **0/2** — · $0.0140/13t, · $0.0193/15t | **0/2** — · $0.0107/10t, · $0.0154/12t |
| rokucommunity__brighterscript-1050 | **0/2** — · $0.0293/26t, · $0.0174/17t | **0/2** — · $0.0171/16t, · $0.0189/17t |
| smooth-code__svgr-10 | **0/2** — · $0.0135/15t, · $0.0168/16t | **0/2** — · $0.0111/16t, · $0.0188/25t |
| superlistapp__super_editor-2516 | **2/2** — S $0.0212/14t, S $0.0143/10t | **2/2** — S $0.0147/14t, S $0.0152/12t |
| zmap__zlint-299 | **2/2** — S $0.0285/31t, S $0.0159/17t | **1/2** — · $0.0183/21t, S $0.0180/24t |
| **total** | **6/20**, $0.374, 355 turns | **4/20**, $0.335 (−10%), 356 turns |

Pooled: as-now 7/32. v1 2/6. v2 7/26. v2+wait 3/6.

## 3. Root cause of every flip

| flip | what the two sides did differently | class |
|---|---|---|
| **zlint-299, confirm: as-now 2/2 → v2 1/2** (v2 L2 lost) | v2 L2 guessed `c.IsPrecertificate()` (not in this zcrypto). Its check `go doc …` failed (`command not found: go`). run_tests then said `status=FAIL exit=2`, `introduced_failures=0 … trustworthy=yes`, `action=none`; the tail showed only passing `util` tests, not `lint_ct_sct_policy_count_unsatisfied.go:36:40: c.IsPrecertificate undefined`. The agent edited a comment, re-ran, got the same verdict, and finished: "`run_tests` reported no introduced test failures, but the overall harness verdict was `FAIL`". **As-now L1 made the identical wrong edit** and got the identical verdict twice. It wrote commentary ("appears to be a harness-level failure rather than a behavioral assertion"), ran `run_tests TestSCTCountPolicyUnsatisified`, saw the compile error, found `util.CtPoisonOID` + `util.IsExtInCert`, and passed. The other two solvers (as-now L4, v2 L3) found `CtPoisonOID` by search before editing. v2 L2 missed it because `ss-grep -i 'poison\|precert'` used `\|`, a literal pipe in Rust regex (the tool said so). | **harness-infra first** (contradictory FAIL verdict hides the build error), **plausibly trim-caused second** (no commentary and no targeted run after FAIL; v2 removed the commentary cadence and "When blocked, exhaust safe in-scope checks and alternatives"). The frame already says "You have NOT finished until … run_tests shows … PASSES", so the frame alone did not stop it. |
| **eslint-plugin-ember-551, confirm: as-now 2/2 → v2 1/2** (v2 L3 lost) | All 4 rollouts wrote the same files. The grader failed P2P `should have documentation for all rules`: the v2 L3 patch has no `docs/rules/no-classic-components.md`. The agent created it with `apply_patch` but never ran `git add` on it. run_tests and the grader both use `git diff HEAD`, which skips untracked files. All 4 rollouts found out by trial that run_tests only sees staged files ("this environment's runner is not including the untracked new file in its execution overlay"). The solvers staged every new file; v2 L3 staged 4 of 5. v2 L3 also trusted `run_tests tests/rule-setup.js` → `Tests: 1360 skipped` → `status=PASS scope=targeted`, a vacuous pass. v2 L2 **also** finished on a red full run (1 failure: its missing test file, which the hidden tests supply) and was solved by luck. As-now L1 and L4 used `update_plan` (3 calls each) and ended on a green full run. | **harness-infra** (untracked files invisible; zero-test targeted run reports PASS). **Plausibly trim-caused**: `update_plan` was removed, and the only two eslint rollouts that tracked a plan both finished green. |
| graphql-go-tools-174: as-now 1/4 → trim 5/6 (v1 1/2, v2 2/2, v2+wait 2/2) | Solving needs the `__typename` skip in BOTH `ValidateInterfaceObjectTypeField` and `fieldSelectionMergingVisitor.EnterField`. Every failure patched one site. The baseline suite is red in every rollout, so run_tests cannot tell a full fix from a half fix. No process difference tied to prompt text. | variance (Fisher one-sided p = 0.12) |
| pytask-210: as-now 0/4 → v2 1/2, v2+wait 1/2, v1 0/2 | The hidden test calls the callable with `exc_info`. Solvers passed `exc_info`; others passed `frame` or nothing. Solvers and failers used the same 3–4 calls (grep, read, edit, run_tests). It is a signature guess. | variance |
| markup-it-56: as-now 0/2 → v1 1/2 | 1 solve in 12 rollouts; an alternative fix (block tags stay raw HTML). | variance |
| max-wait v v2 | Same solves (3/6). +17% cost, +18% turns. | not a flip |

Supporting counts (all 84 rollouts, from the session logs):

| | as-now (32) | v1 (6) | v2 + v2+wait (32) |
|---|---|---|---|
| finished on a red full run after a green baseline | 0 | 0 | 3 (all confirm set) |
| next step after a FAIL verdict = commentary | 23/46 | 0/5 | 12/44 |
| next step after a FAIL verdict = final answer | 2/46 | 1/5 | 6/44 |
| rollouts that called `update_plan` | 4 (3 solved) | 0 (tool present) | 0 (tool removed) |
| commentary messages per rollout (confirm set) | 5.3 | — | 3.8 |

The FAIL events cluster within rollouts, so the per-event p-values overstate the evidence.
Treat these as a mechanism hint, not a finding.

## 4. Integrity check (all 84 rollouts, not a sample)

- **Base prompt:** `session_meta.base_instructions` equals, byte for byte: the 0.146.1 capture
  (sha256 `cbefa6b0…`, 17,730 chars) on every as-now rollout; the a84b079 luna file on every
  round-1 trim rollout (8,062 chars); the current luna file on every round-2, max-wait and
  confirm trim rollout (6,034 chars).
- **AGENTS.md (frame + rules):** identical text on both arms after masking the run dir and the
  date. The only difference is the `<environment_context>` block that mode 1 removes on purpose.
- **Developer messages:** as-now = permissions + skills catalogue; v1 = permissions only; v2 =
  none. As intended.
- **Tools:** the session log does not record tools, so I captured the current code at $0 (§5).
  The behaviour agrees: `update_plan` is called in 4/32 as-now rollouts and never in v2; goal
  tools, `request_user_input` and `tool_search` are called 0 times in 84 rollouts. On Luna,
  `tool_search` is absent from both arms' requests, so there is no delegation to keep or lose.
- **Model and settings:** every row: `openai/gpt-5.6-luna`, medium, codex-cli 0.146.1;
  turn_context identical (approval never, danger-full-access, personality pragmatic,
  collaboration default, multi_agent v1); `config.toml` hashes identical per task across legs;
  `envConfigHash` identical per task across arms; neutral run dirs (`r0-N`).
- **Drift and caveats:** no harness commit between legs of the same round touched the Codex
  path. Rounds used different code (v1 → v2), so compare within a round only. The max-wait legs
  had no own baseline. `SS_ISOLATION=0` on every rollout (disclosed in every log). No
  contamination found.

## 5. v3 edition

Principle: start from the first edition; add only cuts with no plausible role in correctness,
verification, persistence or reading test results; put back the one v1 cut that the flip
evidence implicates.

### Item list (luna source line numbers)

| item | v3 | why |
|---|---|---|
| L1 identity line | keep | frames the job |
| L3–22 Personality, Writing style, Technical communication | remove | tone of messages to a user; nothing about the work |
| L23–27 commentary/final channels | keep | defines how the turn ends |
| L29 "The user may send a new message while you are still working…" | **remove (new)** | no user writes during a headless run |
| L31 compaction rule | keep | long rollouts may compact; it says continue, do not restart |
| L35–37 commentary cadence ("start with a message in the `commentary` channel…") | **keep (restored from v1's cut)** | post-FAIL commentary fell 50% → 27% without it; the as-now zlint recovery ran through commentary |
| L39 "Do NOT put a final response … in the commentary channel" | keep | turn-ending protocol |
| L41 "Never praise your plan…" | remove | tone |
| L43–45 Final answer paragraph | keep | short; harmless |
| L47–58 Formatting rules; L60–74 Visualizations | remove | rendering in a client; the bench does not read the answer |
| L78 "reach first for `rg`" | remove | contradicts the ss-* rules (the reason for the trim) |
| L79 parallelize tool calls | keep | tool-neutral efficiency |
| L80 no `echo "===="` chaining | keep | changes command shape; effect unknown |
| L81 escaping caution | keep | command correctness |
| L82 "Avoid blocking sleep or wait calls longer than 60 seconds" | **remove (new)** | contradicts the frame's 300 s run_tests yield; wait calls were equal with and without it (60 v 60) |
| L83 "Never repurpose `$HOME`…" | **remove (new)** | verbatim duplicate of L124, which stays |
| L85–91 File editing constraints | keep | apply_patch, dirty worktree, no destructive git |
| L93–112 Autonomy and persistence (all, incl. request types, "exhaust safe in-scope checks", clarifying line, blocker line) | keep | persistence and scope; mode 1 cut 7 lines here and red-verdict stops rose |
| L114–131 Destructive Actions | keep | a workspace wipe loses the solve |
| L133–167 Using skills | remove | the catalogue is removed by config; dead text |
| `<permissions instructions>` (362 chars) | keep | ~90 tokens; its "Network access is enabled" contradicts the frame, but the frame is explicit and v1 kept it without harm |
| `<skills_instructions>` catalogue (~3,550 chars) | remove (`skills.include_instructions=false`) | image-gen and similar skills; never relevant |
| `<environment_context>` (cwd, shell, date) | keep | ~150 tokens; tells the agent its shell and cwd |
| `update_plan` tool | keep | 4/32 as-now rollouts used it, 3 solved, incl. both multi-file eslint solves |
| goal tools | remove (`features.goals=false`) | their own text says "do not infer goals from ordinary tasks"; 0 calls |
| `request_user_input` | remove | no user; 0 calls |
| `web_search="disabled"` | keep the key | no-op on Luna; keeps the key set equal to v1 |
| exec_command, write_stdin, apply_patch, wait, view_image | keep | core tools |

### Files (in this folder; nothing written to the repo)

- `codex-0.146.1-instructions-sweet-gpt-5.6-luna-v3.md` — the exact file (with licence header).
- `v3-all.diff` = `build.diff` + `runner.diff` + `tests.diff`. Checked: `git apply --check -p0`
  succeeds in `eval/task-completion-bench`. After applying, run
  `node harness/trim/build-codex-instructions.mjs` to write the v3 file (or copy it).
- `NOTICE-v3-addition.md` — the section to append to `harness/trim/NOTICE-codex.md`.
- Runner: new mode `v3` → `{ mode: 'instructions-v3+tools-v3', source: <v3 file>, config:
  CODEX_HARNESS_TRIM_V3_CONFIG }` (the first four keys). Luna only; other models throw.
  `codexHarnessTrimArgs` uses `trim.config || CODEX_HARNESS_TRIM_CONFIG`, so modes 0, 1 and
  max-wait produce byte-identical argv (existing tests pass unchanged).
- Tests: the existing suite (66 assertions) plus 23 v3 assertions — 89/89 pass in the prototype copy. The build
  `--check` reports all three files up to date.

### $0 capture of the current code (first request, same repo, same frame)

| request | total chars | harness-owned chars (all but AGENTS.md + issue) | ≈ tokens | base prompt | tools block |
|---|---|---|---|---|---|
| as-now | 49,778 | 37,014 | 9,250 | 17,730 | 14,751 |
| v1 (a84b079 capture) | 31,383 | 18,924 | 4,730 | 8,062 | 9,850 |
| **v3** | **31,027** | **18,613** | **4,650** | **7,789** | **9,850** |
| mode 1 (v2) | 27,476 | 15,357 | 3,840 | 6,034 | 9,323 |

Present in v3: permissions, environment_context, update_plan, "exhaust safe in-scope checks",
the commentary cadence, "Diagnose:". Absent: `rg` line, Personality, Formatting rules, Using
skills, skills catalogue, goal tools, request_user_input, the 60-second line, the mid-turn line,
"Never praise your plan". (≈ tokens = chars / 4; tiktoken is not installed.)

### Cost estimate v as-now

Replay of the 32 as-now rollouts with the Luna prices in `ideal-cost.mjs` (input $0.20/M,
cache read $0.02/M, cache write 1.25×), removing the harness-owned tokens from every request
(written once, then read every turn), behaviour unchanged:

| edition | tokens removed per request | realized cost v as-now |
|---|---|---|
| **v3** | ≈ 4,600 | **−14%** (confirm set −14.4%, all −13.9%) |
| v1 | ≈ 4,530 | −14% |
| mode 1 | ≈ 5,410 | −17% |

Observed: v1 −40% (6 rollouts), mode 1 −3% and −10%. Behaviour moves cost more than the diet
does, in either direction. Restoring commentary adds about 1.5 short messages per rollout
(≈ +$0.0001). Expect v3 near −14%; any behaviour gain is extra.

## 6. Validation A/B at the frozen-200 standard

What the data says about power: as-now repeats disagree with each other on 1–2 of 10 tasks.
A 2-solve gap at n = 20 is inside that noise. 7 of 10 confirm tasks never flipped (0/4 or 4/4 in
both arms), so they carried no information.

1. **Fix the both-arm defects first (§7), then never pool across the fix.** They create the
   exact failure modes that decided both flips.
2. **Pick movable tasks.** From dev (DEV-RET + multilingual dev), choose tasks with an as-now
   Luna-Codex solve rate between about 20% and 80% (existing box or Mac rows). Drop floor and
   ceiling tasks. Include at least 25% tasks whose gold patch adds a file and at least 25% whose
   baseline suite is red (the two situations behind the flips).
3. **Screen (Mac, one run-pilot):** 40 movable tasks × 3 reps × 2 arms = 240 rollouts,
   ≈ $4.5 at $0.019 per rollout, ≈ 10–12 h. Pass if v3 solves ≥ as-now − 3 AND the guard metrics
   are not worse: finished on a red run after a green baseline, final answer right after a
   FAIL verdict, new files missing from the patch, vacuous targeted PASS.
4. **Confirm (box):** 200 dev tasks × 2 reps × 2 arms = 800 rollouts, ≈ $15. Pre-register a
   non-inferiority test on the per-task paired solve rate: one-sided 95% lower bound of
   (v3 − as-now) ≥ −3 pp, cluster bootstrap by task. With a per-pair discordance near 15%, 400
   task-pairs give a 95% half-width near ±3.8 pp. A ±2 pp guarantee needs about 1,400
   task-pairs (≈ 2,900 rollouts, ≈ $55, several days of wall time).
5. **Interleave inside each task, not by leg.** For every task, run the two arms back to back,
   in a seeded random order that alternates first arm across tasks and reps. Leg-blocked A-B-B-A
   (as tonight) puts an hour between arms of the same task.
6. **Check integrity on every rollout automatically:** base-prompt hash per edition, AGENTS.md
   hash equal across arms, turn_context equal, neutral run ids. The scripts in this folder
   (`behav.py`, the checks in this report) do it in seconds.
7. Only then run the frozen 200, pre-registered, one rep per arm.

## 7. Both-arm harness defects found (owner, outside the trim)

1. **New files never reach run_tests or the grader unless the agent stages them.**
   `gitDiffPatch` (`agent-runner-shared.mjs:267`), the Codex runner (`codex-task-runner.mjs:899`)
   and the run_tests shim (`rt-shim-runtime.mjs:208`) all use `git diff HEAD`, which skips
   untracked files. 3 of 6 rollouts that created a file lost one from the graded patch
   (v2 eslint L3 — cost a solve; v2 svgr L3; as-now bingo L4). The frame says run_tests
   "reflects your live edits"; for new files it does not. Suggested fix: `git add -N` (intent to
   add) for untracked, non-excluded files before each diff, in all three places.
2. **Contradictory FAIL verdict on a build failure** (known): `status=FAIL exit=2`,
   `introduced_failures=0 trustworthy=yes`, `action=none`, and the compile error is not in the
   tail (zlint). These runs hold 25 verdicts with `exit=2` and `introduced_failures=0` (12 as-now, 13 trim); I did not check that each one is a build failure.
3. **A targeted run that matches no test reports PASS** (`Tests: 1360 skipped` →
   `status=PASS scope=targeted`, eslint v2 L3).
4. `ss-grep` accepted `'poison\|precert'` (literal pipe in Rust regex) and returned 0 matches
   with only a note. That cost the zlint v2 L2 rollout its search.

## 8. Files in this folder

`REPORT.md` (this file), `table.md`, `rows_all.json`, `behav.json`, `table.py`, `behav.py`,
`dump.py` (readable transcript from a session log), `zlint-L*.txt`, `eslint-L*.txt`,
`agents-*.md` (AGENTS.md per arm), `luna-base.md`, `v1-first-edition.md`, `v2-second-pass.md`,
`v3.md`, the v3 instruction file, `*.diff`, `NOTICE-v3-addition.md`, `cap/` (capture script and
the three captured requests), `proto/` (patched copy of harness/ and tests/; the rest symlinks).
