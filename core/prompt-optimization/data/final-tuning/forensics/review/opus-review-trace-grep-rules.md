# Adversarial review — ss-trace, ss-grep and rules changes (A4, A5, A6, B5, B7, B8)

Reviewer: Opus 5.5 (independent). Date: 2026-10-01. Read-only review; no code, runs or paid calls.

## Conclusion

Test three changes as they are: A4, the case-insensitive half of A5, and A6. Revise B7 and the
literal-retry half of A5 before any test. Split B5: keep the exact-token half as a rules-variant
candidate only, and reject "file or range" for now. Leave B8 unbuilt. Keep ss-trace and ss-semantic.

The changes are correct in direction, but the evidence for their value is weak on the target models:

- The forensic task data is 58% gpt-5.6-luna by rollouts (668 of 1,160). Opus has almost no exposure to these defects. Sonnet, Sol and DeepSeek have zero task-run rows.
- Opus made 6 ss-trace calls in 492 rollouts, 0 regex parse errors in 1,166 ss-grep calls, and 0 bracket errors.
- Each change saves at most about 1% of cost. That is below the noise floor, so HANDOFF rule 6 forbids a live A/B per change. Decide each one with a $0 replay, then guard it inside a bundle.

Two defects in the implementation can cause harm:

1. **A5 literal retry gives a false "no matches".** 18 of the 49 recorded parse errors (37%) are alternations. The retry searches the whole alternation as one literal string, so it finds nothing.
2. **B7 counts mode removes line numbers that agents use.** After 100 of 259 flood calls (39%), the next calls include a narrow read of a listed hit line. In 26 calls (10%) that line is not the first hit of its file, so counts mode removes it.

| Change | Verdict | Evidence strength | Main risk | Test that decides it |
|---|---|---|---|---|
| A4 ss-trace compact + resolution | **SHIP-TO-TEST** (own sub-switch) | format: strong; frequency of the fixed defects: weak (one task) | caller bodies gone on flow questions; wrong pick on common names | $0 replay of the 138 recorded calls + Phase-6 trace dev probes |
| A5a regex error → literal retry | **REVISE** | mechanism strong; Luna-only (2.1% of calls), Opus 0 | false "no matches" on 37% of parse errors | $0 replay of the 49 recorded patterns: false-zero count must be 0 |
| A5b zero hits → case-insensitive retry | **SHIP-TO-TEST** | moderate ($0 replay below) | absence answers on negative questions | r3 dev: negative-question accuracy reported separately |
| A6 rules bug fixes | **SHIP-TO-TEST** (with the next rules variant) | bracket bug: strong mechanism, small frequency | the proposed `callers\|callees\|impact` form is itself a shell pipe | $0 shell check of every rules example; normal rules gate |
| B5a exact token → ss-grep (not ss-find) | **REVISE** (rules-variant candidate only) | weak | one extra turn per lookup; owner-protected block | inside a rules variant, interleaved, on a cell that uses ss-find |
| B5b ss-read "file or range" | **REJECT for now** | weak, and its precondition was dropped | more whole-file reads through a dearer reader | none until ss-read overhead is removed |
| B7 ss-grep order / counts / text column | **REVISE** (ship the text-column part) | moderate | lost hit lines (counts mode); hidden test files when files > k | $0 replay of recorded greps: next-read lines still visible |
| B8 ss-grep -A/-B/-C | **NEED-DATA** (not built) | weak (≈0.1 call per Opus rollout) | context floods | $0 exposure count of grep→read chains first |
| ss-trace | **KEEP, change** (A4, A6) | — | removal breaks the shipped fix-surface paragraph | — |
| ss-semantic | **KEEP, unchanged** | r282: Sol uses it in 9% of calls | — | per-tool ablation only if the owner asks |

## What I checked

- All files named in the brief. I also checked the implementation diff `final-tuning...ft-fixes`, `agent-output-fixes.js`, `cmdGrep` and `cmdTrace` in `_ss-helpers.mjs`, `grep-output-shaping.js`, and the new unit tests.
- I read 19 real ss-trace calls (1–2 per task, seed 7) and 18 real ss-grep calls (zero-hit, parse-error, flood and test-heavy strata, seed 11) in `dossiers.jsonl`. For each call I also read the text before it and the next four calls. I also read samples from the two `*.labels.jsonl` files. The labels agree with the reports.
- I ran three $0 checks over all recorded calls:
  1. Zero-hit greps replayed with `rg -i` on the task checkouts in `~/.ss-eval/golden`.
  2. Line use after flood greps.
  3. Parse-error pattern shapes.
- I used only the r3 composition counts, not per-question data. I did not open HO2 or any held-out data.

## A4 — ss-trace: requested section only, one row per caller, no cue lines, no META on stdout; prefer the non-test definition; fall back from a wrong `--in`

**Verdict: SHIP-TO-TEST, as its own sub-switch inside SS_FIX_A.**

Is the problem real?
- Format waste: yes, strong. In the 56 labelled calls, no agent quoted an `answer checklist`, `answer cues`, `critical paths` or META line. Some outputs are very large: `FieldDefinition callers` printed 25,065 chars, and the agent then ran ss-grep anyway. On gin, the implementation cuts ss-trace output by 77%.
- Resolution defects: real but rare outside one task. 42 of the 44 "test mock picked" calls come from one task, so the other tasks have only 2 such calls.
- The wrong-`--in` fallback helps less than SYNTHESIS says ("44 + 14 dead calls become real results"). I listed the 16 not-found calls:
  - 5 are the class `IndexedGetExpression`. The fallback finds the class, but callers mode still returns 0, because the index stores no `new X` edges.
  - 2 are an import alias and 1 is a qualified name (`util.X`). 3 are file or rule names. The fallback cannot find any of these 6.
  - Only `FieldDefinition` (2 calls) and possibly `deserialize` (1 call) get real rows. That is about 3 calls in 138.
- Frequency on the target models is low:
  - Task runs: 6 Opus calls in 492 rollouts. Luna used ss-trace in 127 of 668 rollouts.
  - r282 retrieval runs: ss-trace is under 1% of calls in every cell.
  - The value is at most about 1% of tool tokens. A live A/B cannot measure it.

Risk:
- No caller bodies. Flow and multi-hop questions (r3 has 9 multi-hop questions per repo) need one more `ss-read` per caller. I checked the one "yes" case that used a caller body (pytask, Codex). That agent had already read the whole file, so it lost nothing. Retrieval questions still have no data.
- Repo-wide fallback on a common name can pick an unrelated definition. The `note:` line names the file, so the agent can see this. Low risk.
- META now goes to stderr. Then `scripts/retrieval-bench-282.mjs` `ssDelivered()` counts trace output as chars/4. The delivered-token metric changes between arms, but cost in USD does not. State this in any table.

Does the implementation match the proposal? Mostly. Three gaps:
1. There is no `--full` flag for bodies (swarm proposal 3).
2. There is no call-site line per caller. The swarm proposed a one-line snippet at the call site. It costs about 80 chars and keeps the evidence for "how is X called".
3. Class targets are not handled (swarm proposal 7). This is out of A4 scope, but it is the main reason for wrong-`--in` dead ends.

No unit test covers the wrapper-level fallback or the mock preference.

Test that decides it ($0):
1. Replay the 138 recorded calls (same symbol, mode and `--in`) on the golden checkouts with the old and the new renderer. Pass: every in-repo caller or callee row in the old requested section is also in the new output. Then check each resolution change (mock → real definition, wrong `--in` → fallback) by hand.
2. Run the Phase-6 trace probes on the dev split only. Pass: callers and callees R@5 do not fall.
3. Then let A4 ride in the bundle-A guard run. No separate live run.

## A5a — ss-grep regex parse error → retry as literal

**Verdict: REVISE.**

Is the problem real?
- Yes for Luna: 49 of 2,290 calls (2.1%) crash with a Node stack trace. Opus had 0 crashes in 1,166 calls.
- The fix is right for the common case. Examples: `options('`, `indexedGet(`, `isLayer(`.

Risk: the fix can hide intent. 18 of the 49 parse errors are multi-branch alternations, and only one branch is broken. Examples:
- `pipe_notebook|Command '{}' exited|had no output|stderr`
- `type Transformation\|Transform(data`
- `runModeSetup\({\|runModeTransition\({`

The implementation escapes the whole pattern, so it searches for the literal text `pipe_notebook|Command '{}' exited|...`. That returns 0. The case-insensitive retry then also returns 0. The agent sees a note plus `(no matches)`. Under the rules' absence protocol ("two empty probes settle absence"), a clean zero is worse than a crash. A crash at least tells the agent that the regex failed.

Required revision:
1. Repair per branch. Split on top-level `|` (treat `\|` as `|`, as the existing BRE→ERE shim does). Keep the branches that compile. Escape only the branches that do not compile.
2. If the retry still finds nothing, print "the regex did not parse and the literal text has no match — escape `(`, `{` or `[` and run again". Do not print a plain `(no matches)`.
3. Apply the same repair to ss-find `--regex`. A5 covers only ss-grep today.
4. Add unit tests for an alternation with one broken branch.

Test that decides it ($0): replay the 49 recorded patterns on the golden checkouts. Pass: 0 false zeros. A false zero is a pattern where some branch has hits but the output says no matches.

## A5b — ss-grep zero hits → one case-insensitive retry

**Verdict: SHIP-TO-TEST.**

Is the problem real?
- Zero-hit calls are 9.4% of Opus greps and 17% of Luna greps.
- My replay: I ran each recorded zero-hit pattern with `rg -i` on the task checkout. I kept the 243 calls where plain `rg` also finds nothing, so the replay matches the index.
  - 220 of 243 stay at zero (90.5%).
  - 23 get 1–30 hits.
  - None get 50 or more hits.
- Most of the 23 are the intended identifier in another case:
  - 12 calls: `CTPoison` → `CtPoison…`.
  - 1 call: `precertificate` → 15 hits.
  - 2 Opus calls: `createRerunSuggestion|rerun` → `Rerun` in the target logger.
- A few look like noise: `Literal`, `JSON.stringify`. The case-sensitive zero stays visible in the note line.

Risk:
- An absence answer can flip into a weak "presence". The rate is low (≤ 9.5% of zero-hit calls) and the output says so in one line.
- It costs one more engine call on each zero-hit call. That adds latency only.

Side finding (new, not in SYNTHESIS): `(no matches)` does not mean "absent from the repository".
- In 227 of the 470 zero-hit calls that I could replay, plain `rg` finds the pattern. All of those hits are in files that the index does not cover: vendored code, Markdown, lock files and certificate fixtures.
- In the zlint task, the answer was in such a vendored file.
- The rules say "the index covers every file", and the absence protocol relies on that. This is a false-absence risk that exists today, independent of A5.
- Proposal for the owner: on zero hits, print one line that says which kinds of paths the index does not search. Also correct the rules sentence. This is the same fix as native-fallback proposal 3.

Test that decides it:
- The $0 replay above is enough for the mechanism.
- In the bundle-A guard on r3 dev, report negative-question accuracy separately, as r3-PREREG requires. Reject the change if negative accuracy falls by more than the noise.

## A6 — rules bug fixes

**Verdict: SHIP-TO-TEST, with the next rules variant.** No live run alone, because the effect is below the noise.

Fix 1 — the bracketed usage line.
- The bug is real. Six calls copied `[callees]` from the usage line. zsh rejected them before ss-trace started (`no matches found: [callees]`). In one call the output was empty. All six were Luna. Opus had 0.
- Use plain examples, for example `ss-trace <symbol> callers --in <defining file>`. Then say "mode word: callers, callees or impact".
- Do **not** use the form `callers|callees|impact` from the swarm report. An agent that copies it runs a shell pipe.
- Fix the same line in two more places: `TRACE_USAGE` in `_ss-helpers.mjs` (shown on usage errors) and `README.md`. Agents copy usage strings.

Fix 2 — "ss-find --regex matches file content".
- The bug is real but small. 28 of 335 ss-find calls (8%) used a regex shaped like a path, and all were Luna.
- ss-grep has the same failure: content-grep for a path returned 0 with no hint.
- Write one sentence for both tools: "regexes match file content, not paths".

Fix 3 — sufficiency sentence.
- No edit is needed now. The owner decision keeps `# sufficient=YES` under SS_FIX_A. The current sentence "On `sufficient=YES`, trust…" matches that output.
- Item 1 of "What the rules text must change" in `FIXES-IMPL.md` is out of date. Apply it only together with `SS_FIX_DROP_SUFFICIENCY=1`.

Prompt integrity (HANDOFF §5 rule 4): passes. The wording names no task, repository or symbol. It also makes sense for repositories without tests.

Implementation: no rules file on `ft-fixes` or `final-tuning` contains A6 yet. It exists only as text in SYNTHESIS and FIXES-IMPL.

Test that decides it:
1. $0: run every command example in the rules, under zsh with `nomatch` and under bash with `failglob`, against a stub. Pass: no glob errors and no pipes.
2. Run the normal rules gate. The p7 front-matter scores become stale after any edit.

## B5 — rules routing

### B5a — exact token → ss-grep plus a narrow ss-read, and remove "or `ss-find` `\b<symbol>\b`"

**Verdict: REVISE.** Test it only inside a rules variant, not alone.

- Is the problem real? For Luna, yes. 68 of 335 ss-find calls were single-identifier lookups, with a median output of 4.5k chars. Opus made 4 ss-find calls in 492 rollouts.
- In r282, ss-find is 2–6% of calls and 1.8–3.2% of cost. Even the full 16% cut is about 0.3–0.5% of cost. That is below the noise floor.
- Risk 1: one more turn per lookup. ss-grep shows only the matched fragment, so a read follows about 55% of the time. 7 of the 11 "yes" ss-find calls were exact-token calls that delivered the edited code in one call. On Claude Code a turn re-reads the whole context, so one extra turn can cost more than about 900 tokens of saved output.
- Risk 2: the accuracy loss of removing three tools (−1.9 pt on Codex) included the removal of ss-find from the rules. B5a is much narrower, but it points the same way.
- Support: lever 4.18 found that adding "prefer ss-find" lines raised cost by 13–15%.
- The exact-token bullet is in the owner-protected guidance block, so B5a needs the owner's approval.
- Test: put B5a in a rules variant together with A6. Run it interleaved on a cell that uses ss-find (Codex/Sol or opencode/DeepSeek). Check accuracy non-inferiority, and check calls and turns, not only characters.

### B5b — ss-read "a file or a range" instead of "a narrow range"

**Verdict: REJECT for now.**

- The native-fallback reader made this change conditional on one thing: making ss-read as cheap as `cat` ("pair with proposal 1 so ss is not dearer").
- The owner dropped that condition: ss-read does not change.
- For the same lines, ss-read costs 10–18% more than `cat` or `sed`. The cost comes from the header, fence, gutter and unread notes.
- The new wording can also push models that now read ranges toward whole-file reads. Lever 2.3 showed that more context made agents do more work (+5% to +20% cost).
- Reopen B5b only if ss-read drops that overhead for whole-file reads.

## B7 — ss-grep: source before tests, per-file counts at ≥ 50 hits, no repeated text column

**Verdict: REVISE.** Ship the text-column part as it is.

1. **Drop the repeated text column.** Ship it.
   - No information is lost, because the header already shows the pattern.
   - 77% of outputs carry one single fragment. The cut is 12.5% of ss-grep tokens.
2. **Source before tests.**
   - When the files fit in `-k`, this is a pure reorder.
   - When there are more than `k` files, the code now fetches up to 100 files. Files beyond `k` get no line at all. They appear only in the `# +N more file(s) … e.g.` tail, which names three files. Source comes first, so these hidden files are mostly test files.
   - The swarm proposal said: "keep a budget of 30% of `-k` for tests". The implementation has no such quota.
   - Agents opened a test file in 13% of reads after test-heavy outputs. They read tests to learn the expected behaviour (for example `ss-read test/preflight.test.js`).
   - Add the quota.
3. **Counts mode at ≥ 50 hits.**
   - My check covered 259 flood calls (Opus 31, Luna 228). After 100 of them (39%), a read of 150 lines or fewer that covers a listed hit line follows within 3 calls.
   - In 26 calls (10%), the read covers only lines that are not the first hit of their file. Counts mode keeps only the first hit, so it removes those lines.
   - Example: `fastify\.options|hideOptionsRoute|preflight` gave 74 hits in 5 files. The agent read `index.js 45-90`, which follows from hits at lines 48, 55 and 75. Counts mode would show only `index.js:13 (13 matches)`.
   - Revise counts mode:
     - Print a short line list per file, for example `index.js (13): 13,19,48,55,69,70,74,75,77,…`, capped at about 12 lines per file.
     - Turn counts mode on only when the hits also cover more files than `k`.
   - With this change most of the saving stays, and the lines that agents read stay visible.
4. **Fetch 100 files instead of `k`.** Measure ss-grep latency (p50 and p95) before you ship it.

The fix does not cover the "definition first" part of swarm finding P3. It also does not cover the "explicit scope first" part.

Test that decides it ($0): replay the 3,462 recorded patterns on the golden checkouts with the old and the new renderer. Measure three things:
- (a) characters;
- (b) the share of next-read target lines that are still visible (new must be at least 95% of old);
- (c) the share of next-read test files that are still named.

Then run B7 in the B-bundle guard with the r3 dev split.

## B8 — ss-grep -A/-B/-C (not built)

**Verdict: NEED-DATA.**

- Opus uses native `grep -A/-B` in 19% of its native greps. In the shipped arm that is about 17 calls in 140 rollouts, so about 0.1 per rollout. Luna has no count.
- Multi-range ss-read was the other half of this proposal. The owner dropped it (ss-read does not change).
- Risk: context lines on a flood can be very large.
- Next step: count, for $0, how many recorded grep→read chains a context option would have merged into one call.
- If you build it: set the default to 0, cap the total context lines (for example 60), and refuse when there are more than about 10 hits. Test it as its own switch.

## Keep, change or remove ss-trace and ss-semantic

**Keep both.** Change ss-trace output (A4) and its usage line (A6). Leave ss-semantic as it is.

Evidence from the removal run (variant V2, `SS_VARIANT_PRUNE3`):
- It cost Codex −1.9 pt on retrieval accuracy [−3.8, −0.1] (78 interleaved pairs). The cost change was not significant (−5%).
- Per STATE 10:25, that run had ss-find crashing in 7–8 rollouts. Only the baseline arm contained ss-find, so the crash hurt only the baseline arm.
- The clean Codex re-run shows that the crash lowered accuracy: sweet versus native moved from −4.9 pt to −0.4 pt.
- So the bug made the baseline worse. The true loss from removal is probably equal to or larger than −1.9 pt. The rejection stands.
- The CI upper bound is −0.1, and a single run cannot show which of the three tools carried the accuracy.

Evidence per tool:
- ss-trace is under 1% of calls in every r282 cell. It is 0.2–1.5% of amplified task tokens, and Opus used it in 1.2% of rollouts. Removing it saves nothing that a test can measure.
- The shipped fix-surface paragraph (lever 4.10) names ss-trace, so removal also means a rewrite of a shipped lever.
- ss-semantic is 9% of calls for Sol in both r282 Sol cells. It is the only tool that fetches a method body from a description in a large file. 38% of its sampled calls were useful.
- DeepSeek V2 showed −10% to −17% cost with accuracy within ±1 pt. That run was sequential, and the Codex test-retest showed that sequential runs drift. Treat it as a hint only.

If the owner still wants to remove a tool, follow TRIED-LEVERS (c):
- One tool at a time, interleaved, ss-semantic first.
- Rewrite the rules text to match, and change nothing else.

## Cross-cutting issues

1. **SS_FIX_A is one switch over A1–A5.** A3 ("already shown above") is not loss-free (subagent and compaction risk). A5 changes search behaviour. If the bundle regresses, nobody can see the cause. Give A3, A4 and A5 their own off-switches inside the bundle. Then a failed guard can be split up with $0 replays.
2. **Bench and product differ.** The bench prints through `_ss-helpers.mjs`. The Rust CLI and the MCP server print their own output. Before you publish or ship any result, port the changes and run a byte-parity test between the wrapper and the shipped CLI, with each switch on.
3. **Model coverage.** The task-run forensics have no Sonnet, Sol or DeepSeek rows. Most "frequent" defects (brackets, parse errors, path regexes, exact-token ss-find) are Luna behaviour. The r282 retrieval cells are the only data on the target models. In those cells ss-trace is rare, and ss-find and ss-grep floods are small cost items.
4. **Unit-test gaps** in `tests/search/agent-output-fixes.test.js`:
   - an alternation with one broken branch;
   - the wrong-`--in` fallback;
   - mock preference through `cmdTrace`;
   - test files hidden when there are more files than `k`;
   - case-insensitive retry with `-w` and `-F`.
5. **Statements in SYNTHESIS to correct:**
   - "44 trace calls on test mocks": 42 of them are one task.
   - "A5 … fewer wasted calls": that holds only after the alternation fix.
   - Bundle A is called "no information … removed". That is not true for B7 counts mode, which is in the B bundle, and it is not certain for A3.
