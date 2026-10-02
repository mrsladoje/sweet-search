# Handoff: three bench defects found in the OBSERVATIONS loop (2026-10-02)

You fix three defects in the benchmark harnesses. None of them is in the product. Each one wasted
machine time or hid data in the 2026-10-02 A/B runs. Read `CLAUDE.md` and the owner's memory index
first. Work on `main` in a separate git worktree (another agent may have uncommitted work in the main
checkout). Commit each fix separately and push to `main`.

Hard rules for this work:
- No paid model runs. Every check here is $0: unit tests, replays of existing rows and captures, or a
  dry run.
- No reindex of `eval/repos/*` and no daemons on them. Use temp copies (`cp -c`).
- Before vitest or `npm install`, run `pgrep -fl "run-pilot|retrieval-bench"`. If a bench runs, set
  `SWEET_SEARCH_RUNTIME_DIR` to a private dir and run only targeted test files.
- No back-compat code (nobody uses the product).

---

## 1. `scripts/retrieval-bench-282.mjs` leaves index maintainers alive after a run

**What happens.** Every run (`--tag`) makes APFS clones under `~/.ss-eval/r282-repos/<cell>-<tag>/`
and starts ss-* daemons on them. After the run ends, 3–4 `sweet-search-maintainer` processes per
clone set stay alive (parent pid 1). On 2026-10-02, 59 maintainers were alive after 8 finished runs;
45 of them belonged to finished tags. They kept the load average at 40–75 on the Mac, which slowed
the next runs and made one gold grade time out.

**Worst case.** The r3-grdb eval index is stale (symlink loop, built before the no-follow fix
cfd18b77). Each new clone's maintainer starts to retire about 17,000 loop entries and rewrites a
~600 MB HNSW. It never finishes inside a run, and the next clone starts again.

**How to find the owner of a maintainer.** Its process title does not show the project root. Use
`lsof -p <pid> | grep -oE "r282-repos/[^/]+"` (the open `.sweet-search/*.db` files).

**Expected fix.** At the end of each phase (and in the SIGINT/SIGTERM cleanup), stop every daemon and
maintainer whose project root is one of this run's clone dirs. The task bench already does this for
its run dirs (`reapRunDir` in `eval/task-completion-bench/harness/run-pilot.mjs`, matched by
`SWEET_SEARCH_PROJECT_ROOT` in the process environment on Linux). On macOS there is no
`/proc/<pid>/environ`; match by open files (`lsof`) or have the daemon write its pid into the clone
(`.sweet-search/`), whichever is exact. Never kill a process whose root is not this run's clone.

**Check ($0).** Use only the existing warm-up path: start the warm-up daemons on one temp clone,
call the new cleanup, and assert that no `sweet-search-maintainer` or daemon is left for that clone
while processes of other roots stay alive. Add a unit test for the root-matching function.

## 2. Every `bingo-271` rollout is flagged DEGENERATE on the first attempt

**What happens.** In the gutter smoke (stamp `20261002-2055`, Claude Code + Opus 5.5, product
harness), all 4 rollouts of `joshuakgoldberg__bingo-271` were flagged
`DEGENERATE (output-visibility-mismatch)` on the first attempt, in both arms (gutter tab and none).
`run-pilot.mjs` (~line 764) then re-ran each one, and the rows score the re-run. This doubled the
wall time of every leg (24–30 min) and the subscription use for that task. The other two tasks
(`jupytext-360`, `brighterscript-1050`) were never flagged.

**Evidence.** Log: `~/.ss-eval/obs-loop-logs/gutter-20261002-2055.log` (search `DEGENERATE`).
Rows and transcripts: the run dirs named in that log (`results/gs-20261002-2055-L1` … `-L4` in the
`eval/task-completion-bench` folder of the worktree `/Users/admin/Projects/sweet-search-obs`, or
`main` after merge).

**What to find out.** Where `output-visibility-mismatch` is computed (search the harness for the
reason string), what it compares, and why bingo trips it every time. Likely candidates: a task whose
test output or agent output is very large or contains control characters, or a check that compares
the transcript with the stream and miscounts for this repository. Decide whether the check is right
(the first attempts really were broken) or a false positive. Fix the check if it is wrong; if the
attempts were really broken, find the cause in the harness.

**Check.** Re-run the degeneration check offline on the saved first-attempt transcripts of all 4
bingo rollouts and on the 8 clean rollouts of the other tasks: bingo must not be flagged unless the
transcript is really broken, and the clean ones must stay clean.

## 3. Claude Code captures lose the output of ss-* calls made inside a shell command

**What happens.** In `scripts/retrieval-bench-282.mjs`, `captures/<arm>.<id>.json` stores each call's
`kind`, `command`, `isError` and `textChars`, but not its text. The text survives only in
`rawResponse`, which `responseFor()` (~line 275) builds from calls with `kind === 'ss'` (and
`nativeRead`). When Claude Code runs an ss-* tool inside a compound shell command
(`cd <dir>; ss-grep …`, `cd …; ss-read …`), the call is classified as `bash`, so its output is in
neither place. In the 2026-10-02 full-line A/B this hid 28 ss-grep and 81 ss-read outputs (both
arms), so the trace analysis could count those calls but not judge their output
(`core/prompt-optimization/data/obs-loop/TRACES-fl.md`, "Method notes").

**Expected fix.**
1. Store each call's full text in the capture (`calls[].text`), not only its length. The owner's
   rule: persist raw responses (memory `usd-capture`). Check the capture size stays reasonable
   (gzip if needed).
2. Classify a shell command whose words include an ss-* tool (after `cd …;`, `&&`, `|`, env
   assignments) as `ss` for the tool counts, the same way the trace normaliser does
   (`core/prompt-optimization/data/final-tuning/trace/normalize-claude.mjs`, `classifyBash`).
   Keep the original command text. Check the same gap in the task-bench Claude Code runner
   (`parseClaudeStream`, `eval/task-completion-bench/harness/claude-code-task-runner.mjs` ~line 451)
   and in the Codex / opencode parsers.
3. Make sure the metrics that use `ssCalls`, `ssDeliveredTokens` and the USD content metric do not
   change meaning silently: record a field (for example `captureVersion: 2`) so rows before and after
   the fix are never pooled.

**Check.** Unit test with a recorded Claude Code stream that holds a `cd …; ss-grep …` call: the
capture must hold its output and count it as an ss call. Re-parse one existing run (for example
`core/prompt-optimization/data/results/r282-cc-opus55-medium-obs-fl-B-r1`) if its raw stream is
still on disk, and report how many calls change class.

---

## Already fixed (do not redo)
- `env-ledger-sweep` skipped ids that already had a verdict, so a re-grade never ran (21da6bfb).
- The gutter-smoke driver lost its leg counter between legs (33b5af61).

## Report back
Per defect: cause (with file:line), fix, the check you ran and its numbers, and the commit hash. Short
plain sentences.
