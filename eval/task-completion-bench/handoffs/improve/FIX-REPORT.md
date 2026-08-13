# FIX-REPORT — the seven defects

**Executes:** [`HANDOFF-FIX-SWEET.md`](./HANDOFF-FIX-SWEET.md)
**Date:** 2026-08-12 — **Total model spend: `$0.346`**, all of it the item-1 delimiter A/B (§1.5),
run after an explicit GO. Every other item was settled at `$0`.
**Evidence box:** read-only for all analysis. For the item-1 A/B only, two source files were synced
(backed up first, restored after, md5-verified) and two new run directories were written. **No
existing file under `results/` was ever modified.** HO2 untouched.

---

## 0. Verdict

**All eight items are closed.** Four were built (items 1, 2, 3, 6), one is refuted (item 4), and
three were already shipped by the Phase-0 session and are verified here (items 5, 7, 8).

| item | status | what changed |
|---|---|---|
| 1 — read gutter corrupts edit anchors | **fixed and CONFIRMED LIVE** | `N\| ` → `N<TAB>`; A/B: 15.4% → 0.0% carried, p=0.0049, no regression |
| 2 — `--in` drops extra scopes | **confirmed and fixed** | `--in` repeatable; extras now a loud error |
| 3 — directory scopes rejected | **confirmed and fixed** | whole-segment matching; locking test updated |
| 4 — `ss-trace` same-file fallback | **REFUTED** | nothing to fix; claim does not survive the traces |
| 5 — YARP grader tripwire | already shipped (`ab4f252`) | verified, tests run |
| 6 — degeneration not quarantined | **built** | two-limb detector, row flag, three-view cost |
| 7 — sidechain spend off-ledger | already shipped (`ab4f252`) | verified, tests run |
| 8 — empty `pages` (honesty work) | already shipped (`ab4f252`) | verified byte-identical across arms |

**Six claims in the handoff turned out to be wrong**, collected in §10 with the evidence for each.
The three that change a decision: the pytask `ss-trace` premise (item 4) does not reproduce, the
degeneration direction (item 6) is inverted, and three items were already done.

---

## 1. Item 1 — the read gutter corrupts exact edit anchors

### 1.1 The mechanism is confirmed, by replay, at full census

I did not sample. I replayed **every** edit-anchor failure in all 204 rollouts. Method: reconstruct
each gutter-rendered read that preceded a failure, build two versions of it — the true source, and
the source as it appears when a model strips `N|` (4 chars) instead of `N| ` (5) — then test which
one the rejected anchor matches.

| harness / arm | edit calls | anchor failures | matched the off-by-one reconstruction | matched true source |
|---|---:|---:|---:|---:|
| claude-code / **sweet** | 141 | **20** | **14** (+1 by signature) | 1 |
| claude-code / native | 150 | 8 | 0 | — |
| codex / both | 0 | 0 | — | — |
| opencode / both | 116 | 0 | — | — |

The 14 confirmed cases match the off-by-one reconstruction and **do not** match the true source.
Per-line length delta is exactly `+1` on every line of every one. A worked example, verbatim:

```
ss-read RENDERED:      "59|       this.request,"
TRUE SOURCE:           "      this.request,"
ANCHOR MODEL SENT:     "       this.request,"      ← rejected
per-line delta:        [1, 1, 1]
```

The handoff's "20 sweet vs 7 native" is confirmed at 20 vs 8 (my failure regex is one broader). Its
"14 of 14 sampled pairs" is independently reproduced as 14 of 20 at full census.

**One correction to how the finding should be sized.** The 20 failures are not 20 independent
tasks. They concentrate:

| cell | failures | off-by-one |
|---|---:|---:|
| `dart-lang__http-1114` sweet r0 | 13 | **12** |
| `dashbitco__nimble_options-43` sweet r1 | 3 | 2 |
| three other cells | 4 | 0 |

Twelve of the fourteen are one rollout retrying the same corrupted anchor. Sizing: that task costs
sweet `$0.070560` against native's `$0.048098` across two reps — a `$0.022462` excess on one task,
**2.4× the entire claude-code arm gap of `$0.009493`**. That is the scale of the prize, not proof
that fixing the gutter closes the gap.

### 1.2 The delimiter I chose, and why

**`${n}<TAB>` — an unpadded line number followed by a single tab.**

The handoff says a `$0` replay cannot settle the remedy, "because you cannot know what a model will
strip from a delimiter it has never seen." **On this benchmark that premise does not hold: the model
has already been shown this exact delimiter, at scale, and never got it wrong.**

Claude Code's own `Read` renders `0<TAB>local fn = vim.fn`. Across the native arm that is **19,499
gutter lines in 653 read results** — comparable volume to sweet's 15,205 lines of `N| ` — with
**zero** whitespace-carry anchor failures. Same harness, same model, same tasks, opposite outcome.
Native's 8 failures are all unrelated: decoding garbage (`}ושר}]}`), a `replace_all` ambiguity, and
anchors that are simply absent from the file.

**The one real risk of a tab is refuted by the same evidence.** A tab-indented file renders as gutter
tab + content tabs, which could plausibly confuse a stripper. `joshuakgoldberg__bingo-274` reads
TAB-indented TypeScript (`5<TAB><TAB>const source = await intake(sourcePath);`) across 15 read
results, and its 4 exact-match edits **all succeeded**, with leading content tabs reproduced
verbatim:

```
"\tconst source = await getSource(sourcePath, ...);"     ← matched
```

The model strips the gutter tab and keeps the rest.

**Both documented traps are respected:**

1. **The gutter is not deleted.** It stays on by default. The `−16%` agent-cost lever is intact, and
   `N<TAB>` is one character *cheaper* per line than `N| `, never more expensive. (Byte cost, not
   token cost — token cost must be measured in the A/B, not assumed.)
2. **This is not `cat -n`.** `cat -n` pads the number into a fixed-width field (`%6d`), and that
   padded field is what was rejected for miscalibrating edit wrapping (Claude Code #36654). The
   number here stays unpadded, so prefix width still varies with digit count exactly as `N| ` did.
   A test asserts no rendered line begins with a space.
3. **Render-side only.** No edit matcher is touched — sweet does not own one.

**Correction to the handoff.** It states that "`SLATE-A-UBER.md` proposes exactly this remedy
[`cat -n` padding] without knowing it was already rejected." That is not what the slate says.
`SLATE-A-UBER.md:231` proposes "a tab-aligned gutter matching native Read, or a gutter-free body plus
line map" — the correct remedy. The strings `cat -n` and `padded` do not appear in that file. The
slate was right and the handoff mis-attributed a bad proposal to it.

### 1.3 What changed

| file | change |
|---|---|
| `core/search/search-read.js:567-591` | `GUTTER_DELIMITER = '\t'`; `numberCodeLines` renders `${n}\t${line}`; new `stripCodeLineNumbers` inverse |
| `core/search/search-read.js:510-515` | comment rewritten to record the delimiter evidence |
| `eval/agent-read-workflows/bin/_ss-helpers.mjs:578-590` | the CLI's **inlined duplicate** of the gutter arithmetic replaced by the shared `numberCodeLines` |
| `eval/agent-read-workflows/bin/_ss-helpers.mjs:547` | imports `numberCodeLines` |
| ~~`core/search/search-read.js:569-577`~~ | the `SS_READ_GUTTER=pipe\|tab` A/B switch existed only for the A/B in §1.5 and was **removed** in the review pass, so production cannot restore the defective render. Consequence: the A/B is no longer reproducible and Gate-4 rotation would need it temporarily re-added. |

The duplicate mattered. There were two implementations of the gutter — the shared helper (used by
the library, the daemon at `search-server.js:657` and `ss-semantic` at `search-read-semantic.js:881`)
and a hand-copy in the `ss-read` CLI that did not even consult `lineGutterEnabled`. Two renderers
that can drift is precisely the defect class that corrupts anchors, so they are now one.

**The format gate is unchanged and re-asserted by test.** `lineGutterEnabled` still returns false for
`benchmark`, `raw` and `json`, still honours explicit `lineNumbers`, and `SS_READ_LINENUMS=0` is
still the A/B off-switch.

### 1.4 Tests added

`tests/search/read-line-gutter.test.js` — 20 tests, none existed before. They cover the exact
round-trip (`strip(number(src)) === src`), tab-indented source, trailing-newline preservation, blank
lines, source lines that already contain tabs, the unpadded-number property, the format gate in both
directions, and the defect itself: *no rendered line has whitespace adjacent to the delimiter*.

### 1.5 The paid A/B — RUN, and the remedy is CONFIRMED

**Run 2026-08-12. Spend `$0.346`** (control `$0.167` + treatment `$0.179` realized). Below the
`$0.40` estimate. This is the only money spent in this session.

**Design.** Sweet arm only — the delimiter does not exist in native, so a native cell buys nothing.
claude-code only — codex and opencode produced zero anchor failures across 116 edit calls.
One build, one config fingerprint; the only variable is `SS_READ_GUTTER`.

- diagnostics `dart-lang__http-1114`, `dashbitco__nimble_options-43`
- controls `statamic__cms-9029`, `akinsho__nvim-bufferline.lua-173` (both sweet-solved)
- 4 tasks × 3 reps × 2 variants = 24 rollouts, `CONCURRENCY=1`, `MAX_TOOL_CALLS=80` matched
  (the recorded run peaked at 74 calls and no rollout ever hit a cap, so the cap cannot bind)
- ledger `/root/.ss-eval/ledger-postfix-20260807/` — pre-flight 4/4 gold-FULL under current config

**Gate 0 was passed twice, locally and on the box**, by rendering both variants through the real
`ss-read` CLI, and `SS_READ_GUTTER` was verified in the live pilot's `/proc/<pid>/environ` in both
cells. That closes the accidental-A/A failure the micro-smoke protocol exists to prevent.

**Result — the pre-registered primary endpoint.** Fraction of gutter-derived edit anchors that
carried the gutter's whitespace into the anchor, scored by the same replay classifier validated
against the 204 recorded rollouts:

| | control `N\| ` | treatment `N<TAB>` |
|---|---:|---:|
| gutter lines rendered | 6,134 | 6,036 |
| multi-line edit anchors | 60 | 77 |
| **gutter-derived anchors** (denominator) | **39** | **52** |
| reproduced the source exactly | 33 | **52** |
| **CARRIED gutter whitespace** | **6 (15.4%)** | **0 (0.0%)** |
| edit-anchor tool failures (secondary) | 10 | 4 |

**Fisher exact p = 0.0049** (one- and two-sided). Every one of the treatment's 52 gutter-derived
anchors reproduced the source byte-for-byte. Gutter exposure was matched within 1.6%.

**Controls intact — the other half of a win.** Solve status is identical in all 12 task×rep pairs;
`statamic__cms-9029` and `akinsho__nvim-bufferline.lua-173` are 3/3 in both cells. **Zero
regressions.** Total solve 6/12 in both.

**Cost is NOT a result here, and I am not claiming it.** Break-priced: control `$0.192791`,
treatment `$0.178239` (−7.5%). Realized runs the other way (control `$0.167`, treatment `$0.179`).
At n=4 tasks with identical solves, this column cannot resolve a difference, which is exactly why
the endpoint was pre-registered as anchor correctness. The comparison is further confounded because
the treatment attempted **28% more edit anchors** (77 vs 60) — it did more work, plausibly because
it was not thrashing on rejected anchors. Both readings are recorded; neither is a claim.

**Pre-registered falsification, and it did not fire.** The bar was: any treatment anchor carrying
gutter whitespace, or no drop in total anchor failures, reverts the change to `N| `. Treatment
carried zero and anchor failures fell 10 → 4.

**Box hygiene.** Two files were synced (`core/search/search-read.js`,
`eval/agent-read-workflows/bin/_ss-helpers.mjs`), both verified byte-identical to git HEAD before
being overwritten, both backed up to `/root/gutter-ab-backup-20260812/`. The box was **restored to
its pre-experiment state** afterwards, md5-verified on both files. `results/` was never mutated.

### 1.6 What remains unproven

- **Rotation (skill Gate 4).** The lever was smoked on the tasks it was designed against. It has
  not been re-smoked on 2–3 fresh DEV-RET tasks. By the skill's own rule that makes it *unproven on
  rotation*, not overfit-refuted — but it is the next step before an 18-task screen.
- **The other two harnesses.** codex and opencode showed zero anchor failures, so the lever is
  untested there. It should be solve- and cost-neutral for them, and that is an assumption.
- **Token cost of a tab versus `| `.** Measured in bytes only (one character cheaper). The
  model's tokenizer was not available, so the token-level effect is unmeasured.
- **The original design, for the record:**

Unproven: that the tab delimiter reduces sweet's anchor-failure rate **when ss-read is the source**.
The native evidence is a near-matched natural experiment, not a controlled one — native's `N<TAB>`
arrives through Claude Code's own `Read` tool, whereas `ss-read` arrives as Bash stdout. Same bytes,
different framing. This is strong evidence, not proof.

**The A/B I would run — described, not launched. It needs an explicit GO.**

- **Skill:** `/microsmoke`. Gate 0 ($0 exposure) is already passed: 20 exposed failures on the sweet
  arm, 14 with the confirmed signature.
- **Design:** one lever, two levels. `SS_READ_LINENUMS` stays on in both; the delimiter is the only
  variable. Arms: `N| ` (control, today's shipped bytes) vs `N<TAB>` (treatment).
- **Harness:** `claude-code` only. It is the only harness that produced a single anchor failure —
  codex and opencode produced zero across 116 edit calls, so they cannot move and would only buy noise.
- **Tasks:** `dart-lang__http-1114` and `dashbitco__nimble_options-43` — the two cells that actually
  carry the failures — plus 2 controls with gutter reads and zero anchor failures, to catch a
  regression the diagnostic tasks cannot show.
- **Invariants:** `REPS >= 2`, `CONCURRENCY=1`, `MAX_TOOL_CALLS` matched across arms, read
  `idealCost` (and the break-priced column), never realized.
- **Primary endpoint — pre-registered, and it is NOT cost:** count of edit-anchor failures whose
  rejected anchor matches the off-by-one reconstruction. Prediction: control > 0, treatment = 0.
- **Secondary:** total edit-anchor failures; solve flips; `idealCost`.
- **Falsification, fixed now:** if treatment produces **any** anchor failure carrying gutter
  whitespace, or if total anchor failures do not fall, the remedy is wrong and I revert to `N| `
  rather than tuning the delimiter again. A cost movement alone neither confirms nor refutes it —
  at n=4 tasks the cost column cannot resolve anything, and I will not read it as if it could.

---

## 2. Item 2 — `ss-grep --in` silently dropped extra scopes

**Confirmed exactly as documented.** `_ss-argparse.mjs`'s `parseValueFlag` consumes only the first
occurrence and leaves the rest in `args`, where the positional extractor discards them without a
word. The header then echoed back the single surviving scope, which made the loss look intended.

**Fix — multi-scope works, and silence is gone in every spelling:**

| file | change |
|---|---|
| `eval/agent-read-workflows/bin/_ss-argparse.mjs:160-191` | new `parseRepeatedValueFlag` (consumes every occurrence, de-duplicates) and `extraPositionals` |
| `eval/agent-read-workflows/bin/_ss-helpers.mjs:190-211` | `readRepeatedValueFlag`, `rejectExtraPositionals` |
| `eval/agent-read-workflows/bin/_ss-helpers.mjs:260-306` | `cmdGrep` takes a scope list; header prints **every** applied scope |
| `core/search/search-server.js:1073-1078` | server reads `getAll('fileFilter')`; length bound applied per value |
| `core/search/search-server.js:1622-1624` | `queryServer` appends one param per scope |

`--in` is repeatable: `ss-grep "keys" --in lib/a.ex --in test/a_test.exs`. A single value keeps the
old string wire format byte-for-byte, so one-scope calls are unchanged.

Any bare argument left after the pattern is now a usage error naming both plausible intents:

```
[ss] 1 argument(s) not consumed: "test/nimble_options_test.exs"
[ss] for several scopes repeat the flag: ss-grep "<regex>" --in A --in B
[ss] if this is part of the pattern, quote the whole pattern
```

**The alternative I rejected.** Making `--in` greedy (`--in A B`) would fix the observed spelling
with zero retry turns, but it silently breaks two other spellings: `ss-grep --in a b pat` makes `b`
the regex and `pat` a scope, and an unquoted multi-word pattern (`ss-grep def foo`) becomes a search
scoped to a directory that does not exist, returning a confident "(no matches)". That is the same
failure class I am removing. A usage error costs one cheap turn and is never wrong.

**Verified end-to-end** with no index and no model (a temp dir with an empty `codebase.db`), both
error paths exit 2 with the messages above.

**Tests:** 13 in `tests/unit/ss-argparse.test.js` — one file, several files, a directory scope,
de-duplication, the exact `nimble_options` spelling, multiple extras, malformed `--in` (missing
value, and a following flag), plus `--` sentinel and inert-flag interaction. Plus a wire test in
`tests/search/read-semantic-daemon-parity.integration.test.js` asserting both scopes cross the daemon
boundary.

**Known adjacent gap, deliberately not touched:** `ss-find`, `ss-search` and `ss-trace` also discard
extra positionals. Out of scope for this handoff, and `ss-semantic` genuinely takes two positionals,
so a blanket guard would break it.

---

## 3. Item 3 — `matchesGrepFileFilter` rejected directory scopes

**Confirmed.** `core/search/grep-output-shaping.js:25` required the filter to match the *end* of the
path, so `--in tests/testthat` matched nothing and printed "(no matches)" — indistinguishable from a
regex that genuinely misses. `tests/search/grep-output-shaping.test.js:51` asserted the bug.

**Fix:** matching is now on **whole path segments** — the filter's segments must appear as a
contiguous run of the target's segments (`core/search/grep-output-shaping.js:16-66`). This is a
strict superset of the old rule (which was the special case "run ends at the last segment"), so
nothing that matched before stops matching. It accepts every reasonable spelling:

| spelling | example | before | after |
|---|---|:--:|:--:|
| exact path | `tests/testthat/test_x.R` | ✓ | ✓ |
| trailing segments | `testthat/test_x.R`, `test_x.R` | ✓ | ✓ |
| directory from root | `tests`, `tests/testthat`, `tests/testthat/` | ✗ | **✓** |
| directory by name | `testthat` | ✗ | **✓** |
| partial segment | `test`, `x.R` | ✗ | ✗ |

The function also accepts an array of filters, which is what item 2 needed.

**The locking test now asserts the corrected behaviour** rather than being routed around
(`tests/search/grep-output-shaping.test.js:42-88`).

**Traversal safety.** A `..` segment is rejected outright, so an escape cannot be spelled. More
fundamentally: this is a pure post-filter over repo-relative paths the engine has already produced.
It can only ever *remove* results, never widen a read, so no scope can reach outside the repository
root. Both properties are asserted by test.

No format gate is needed — this is an explicit user-supplied filter, applied only when `--in` is
given, not a ranking signal that could fire on NL traffic.

### 3.1 Exposure — this is the largest defect in the set, and the handoff ranked it third

A `$0` census of every `ss-grep` invocation across all 204 rollouts:

| | count |
|---|---:|
| `ss-grep` invocations (sweet, all 3 harnesses) | 251 |
| … with `--in` | 31 |
| … with a **directory** scope | 11 |
| … of those, **returned zero matches** | **10 (91%)** |
| … with a multi-path `--in` (item 2) | **1 genuine** |

The recorded spellings, every one a reasonable question answered with silence:

```
--in test                                    (nimble_options)   0 matches
--in packages/bingo-handlebars/src           (bingo)            0 matches
--in pkgs/http/test                          (dart http)        0 matches
--in src/Kubernetes.Controller/Converters    (yarp)             0 matches
--in pkgs/http/lib                           (dart http)        0 matches
--in robot-core/src/test                     (robot)            0 matches
--in config                                  (statamic)         0 matches
--in /root/.ss-eval/runs/…/pkgs/http/lib/src (dart http)        0 matches   ← absolute
--in /root/.ss-eval/runs/…/agent-ae7cf969…   (dart http)        0 matches   ← absolute
```

**This item's mechanism is fully proven at `$0`, and needs no paid run.** There is no model in the
loop: a scope either matches a path or it does not. The "before" is measured from the transcripts
(10 of 11 returned zero); the "after" is asserted by unit test against those exact spellings.

**Note on item 2.** The `dashbitco__nimble_options-43` file the handoff says was lost to a dropped
`--in` scope was *also* reachable by `--in test`, a directory scope. Both routes to it were broken.
Item 3 rescues it independently of item 2. Item 2's own exposure is 1 call in 251.

### 3.2 The exposure census found a defect in the fix itself

Two of the eleven scopes are **absolute paths** — agents pasting back the path the harness gave
them. The first version of this fix still rejected those, because an absolute scope is *longer* than
the repo-relative path the engine emits, so no contiguous run can exist (`scope.length >
target.length → false`). It resolved 7 of 9.

Repaired at `core/search/grep-output-shaping.js:47-91`, now 9 of 9:

- **project root known** (threaded from `searcher.projectRoot` at `core/search/search-pattern.js:143-148`):
  strip the root, continue as a relative scope. An empty remainder means the agent scoped to the
  repo root, which every file satisfies.
- **root unknown**: anchor on the only unambiguous relation — some suffix of the scope must equal
  the target's leading segments, i.e. the scope names an ancestor directory of the file.
- **absolute scopes only.** Applying the ancestor rule to a relative scope would let `a/b/c` match
  an unrelated `c/d`. A test asserts it does not.

An honest remaining limit: with no project root available *and* a scope that is the bare repo root,
there is nothing to anchor on and the result stays `false`. That is no worse than before the fix,
and it is asserted by test rather than left undiscovered.

---

## 4. Item 4 — `ss-trace` same-file fallback: **REFUTED**

The handoff rates this "medium — mechanism unverified". It does not survive contact with the traces.

I pulled **all 21 `ss-trace` invocations** across every sweet rollout on all three harnesses.

**Cross-file tracing works, including on TypeScript:**

| cell | result |
|---|---|
| `joshuakgoldberg__bingo-274` (**TypeScript**) | `fan-in=2 fan-out=0`, cross-file callers *and* callees across 6 files in 4 packages. **No fallback.** |
| `apple__swift-nio-http2-145` (Swift) | `fan-in=21 fan-out=4` |
| `pytask-dev__pytask-210` (**Python**) | cross-file **callee** edges present (`traceback.py → capture.py:202`, `→ nodes.py:210`) |

So "falls back to a same-file scan on Python, Lua, TypeScript" is wrong for TypeScript outright, and
wrong for Python's callee direction.

**The pytask fallback fired, and it was correct.** Every pytask invocation traced
`_is_internal_or_hidden_traceback_frame` — a module-private helper whose only caller genuinely is
`_filter_internal_traceback_frames` in the *same file*, at `traceback.py:81`, call site line 90.
There are no cross-file callers to find. `ss-trace` returned the one real caller and said so.

**The handoff's premise about the prize is therefore unsupported.** It argues that repaired
cross-file tracing would surface callers in `report.py`, `build.py` and `graph.py` carrying the
`sys.exc_info()` flows, and that this "may be a solve flip on two harnesses". But the agent never
asked for those callers — it asked about a private helper. Cross-file tracing was not what stood
between the sweet arm and that contract.

**The fallback is already not silent.** `core/graph/structural-context-format.js:7-11` renders it on
line 2 or 3 of the output, above all content, in two distinguished forms:

```
note: callers below come from a same-file source scan (no stored cross-file edges).
no stored call edges for this symbol — map its sites with one broad ss-grep of the symbol stem instead.
```

**No change made.** There is no defect here to fix.

### 4.1 The *prize* is also unreachable — closed at the goal, not just the mechanism (2026-08-13)

The refutation above kills the stated mechanism. It does not by itself kill the **goal**, which was
a solve flip driven by the `exc_info` discriminator (every patch passing `exc_info` resolved, every
patch passing `()` or a bare frame failed). That gap was fair criticism, so it was closed properly.

**Step 1 — the agent already saw `exc_info`, in every rollout.** Counting occurrences of the string
inside *tool results* across all four pytask rollouts of `screen-v3`:

| rollout | `exc_info` seen in tool output |
|---|---:|
| native r0 / r1 | 4 / 4 |
| sweet r0 / r1 | 5 / 3 |

It was on screen 100% of the time, in both arms. **This is not a retrieval failure.** The arms then
diverged on signature design, not on evidence: native emitted `traceback_hide()` with no argument,
sweet emitted `is_hidden(exc_info)`.

**Step 2 — the convention is not in the corpus.** Every mention of `__tracebackhide__` in the
repository at the base commit `30227332`:

| location | form documented |
|---|---|
| `src/_pytask/traceback.py:70` | ``__tracebackhide__ = True`` — boolean only |
| `src/_pytask/traceback.py:73` | read as a plain boolean |
| `tests/test_traceback.py:11` | parametrized over `[True, False]` — boolean only |
| `docs/source/changes.rst:122` | boolean only |

**No callsite anywhere passes an argument to a hide predicate.** The rule that the callable receives
`exc_info` comes from *pytest's* convention, which is external to this repository.

**Conclusion: no retrieval tool can surface what the index does not contain.** Sweet did search for
it — `ss-search "callable __tracebackhide__ predicate frame"` — and correctly found nothing, then
got the signature right from model prior anyway. The 4-of-4 versus 0-of-8 split is a model-knowledge
split, not a tool split.

**Item 4 is closed at both levels.** It is not a retrieval lever, and it never was one.

**One unrelated observation, recorded not fixed:** pytask's "critical paths" claims
`_is_internal_or_hidden_traceback_frame → getvalue@capture.py:202`, but that function calls only
`f_locals.get`, `Path` and `any`. An unqualified `.get(` appears to have resolved to a same-named
definition elsewhere. That is callee-resolution imprecision, a different issue from this item, and
out of scope.

---

## 5. Item 5 — YARP grader tripwire: already shipped, verified

Shipped in commit `ab4f252` before this session. Verified, not re-implemented.

- `harness/upstream-patches/eval.py:341` reports `n_test_results` — the count its own log parser
  recovered.
- `harness/evaluator-runtime.mjs:299-305` refuses to score any item with zero: the row becomes
  `NO-TEST-EVIDENCE` with `f2pFrac: null` rather than a fabricated `f2pFrac=0`.
- `harness/evaluator-runtime.mjs:263` passes `--reapply-install-seds`, the missing flag that was the
  root cause; `tests/evaluator-integrity.mjs` fails if it is ever dropped again.
- The two evidence-free causes are separated rather than merged (task-wide grader defect vs. a
  patch that broke the build), so a broken build never flatters the arm that broke it.

`node tests/evaluator-integrity.mjs` passes, and prints the tripwire firing on its fixture.

**Regrade:** completed on a copy at `results/phase0-regrade-20260812/`, never mutating `results/` in
place. It found a second defect the handoff did not anticipate: grading the *same gold patch* eight
times fails the `PASS_TO_PASS` gate four times, on eleven timing-heavy proxy tests unrelated to the
patch. `dotnet__yarp-2825` therefore still cannot carry a solve number — for a new reason. Details in
[`PHASE-0-RESULTS.md`](./PHASE-0-RESULTS.md) §2.

---

## 6. Item 6 — decoding degeneration: built, and **the direction is the opposite of what the handoff expected**

### 6.1 The mechanism is not what the handoff describes

The handoff attributes the pytask cost to "rejected edit payloads of roughly 127,666 bytes". The
**cost** numbers reproduce exactly — sweet r0 `$0.046363`, sibling r1 `$0.006595`, excess `$0.039768`
— but the mechanism does not. **No single tool payload in any claude-code rollout exceeds 20KB.**

The real shape:

| pytask sweet | tool calls | tool-input bytes | assistant text | thinking | **output tokens billed** |
|---|---:|---:|---:|---:|---:|
| rep 0 | 14 | 8,158 | 753 | 2,580 | **67,698** |
| rep 1 | 11 | 2,225 | 1,261 | 1,748 | 3,076 |

rep 0 was billed **22× the output tokens** of its sibling while retaining barely more text. The
pathology is generation that was produced, paid for, and discarded — invisible to any scan of
retained payloads. That is why the detector needs two limbs.

### 6.2 The direction: it is not on sweet's side

The handoff says "the one large measured instance is on sweet's side, and removing it helps sweet."
**Settled, and it is false.** The billed-vs-retained ratio across all 68 claude-code rollouts:
median 1.11, p90 1.71, p95 2.06 — then **nothing at all** until 8.27 and 20.62. Exactly two outliers,
**one per arm, on the same task**:

| rollout | output tokens | ratio | break-priced |
|---|---:|---:|---:|
| `pytask-dev__pytask-210` **sweet** r0 | 67,698 | 20.6× | `$0.046363` |
| `pytask-dev__pytask-210` **native** r1 | 43,971 | 8.3× | `$0.037624` |

The content limb is likewise native-leaning: 4 native cells, 2 sweet. Running the detector over all
68 rollouts flags **2 — one per arm, on the same task** — removing `$0.037624` of native spend and
`$0.046363` of sweet spend.

*(Updated 2026-08-12 after review: the foreign-script signal was demoted to audit-only, because
non-Latin identifiers, literals and comments are valid source in many languages and a false
positive would delete real billed work from one arm's ledger. Only control bytes, runaway
repetition and the accounting limb now fire a verdict. This dropped the flag count from 8 to 2 and
made the result cleaner, not weaker. It also means the content limb has **zero** confirmed positives
on real data — the two flags are both accounting.)*

**Effect on the published number:**

| view | native | sweet | delta |
|---|---:|---:|---:|
| raw | `$0.398435` | `$0.407928` | sweet **+2.38%** |
| excluding the 2 flagged rollouts | `$0.360811` | `$0.361565` | sweet **+0.21%** |

The gap nearly vanishes, but sweet does **not** win. The raw view is the headline; the exclusion is
a post-hoc sensitivity and is labelled as one.

> **Update 2026-08-13 — on the later `screen-v3` run the detector fires five times, not two, and
> it leans the other way: 4 native, 1 sweet**, with billed-to-retained ratios from 6.95 to 37.74.
> Excluding them moves that run's gap from −25.46% to −12.01%, because four of the five removals
> come out of native's column. The pathology is therefore confirmed arm-universal across two runs,
> but **which arm draws the blow-ups is chance, and it is large enough to set the headline.** One of
> the five, `ontodev__robot-710` sweet rep0, had been mis-reported as a sweet-search regression;
> see [`RESULTS-2026-08-13.md`](./RESULTS-2026-08-13.md) §2.1.

### 6.3 What was built

**`harness/degeneration.mjs`** — a pure, arm-blind detector with two independent limbs:

1. **Content** — foreign script welded into structural positions, control bytes, or a runaway
   repeated substring. Fires on the payload *before the tool runs and it reaches disk*.
2. **Accounting** — billed output tokens far exceeding what the transcript retained.

The accounting threshold is `4.0`, chosen to sit **inside the empty gap** between p95 = 2.06 and the
first outlier at 8.27. It is not a percentile cut fitted to the data; it separates two populations
that do not overlap.

**The false-positive guard matters more than the detector.** A naive foreign-script count flags a
legitimate i18n table (`greeting: "こんにちは、世界"`), and a false positive silently deletes real spend
from one arm's ledger. So `stripLiterals` removes string literals and comments before counting: real
degeneration welds foreign characters into structural positions (`}ояолдлошуоуор`), while i18n keeps
them inside quotes. A single quote counts as a delimiter only when it opens at a non-word position,
so an apostrophe in prose ("Let's", "modules'}") never swallows a degenerate tail — which is exactly
the shape the real payloads take. Garbage *inside* a literal is a deliberate false negative: that is
the safe way to be wrong.

| file | change |
|---|---|
| `harness/degeneration.mjs` | new — `payloadSignals`, `stripLiterals`, `contentDegeneration`, `accountingDegeneration`, `classifyRollout` |
| `harness/claude-code-task-runner.mjs:75-121` | stream parser collects `payloads`, `retainedOutputChars`, `billedOutputTokens` |
| `harness/claude-code-task-runner.mjs:396-404` | `classifyRollout` runs per rollout and logs when it fires |
| `harness/claude-code-task-runner.mjs:458` | `degenerate` + structured `degeneration` recorded on the row |
| `harness/analyze-run.mjs:166-216` | three-view publication: raw, flagged (named and priced), excluded |

The analyzer prints all three, labels the removed spend per arm, and states in its own output that
removed spend is not a saving for either arm. Rows from before this change print
"not collected — raw view only" rather than silently reporting zero degeneration.

### 6.4 Tests

`tests/degeneration.mjs` — 41 assertions. Every positive fixture is a **verbatim** payload from the
2026-08-11 run (pulled from the box, not invented), including both nimble_options descriptions in
full. Negatives cover plain Dart, tab-indented TypeScript, an i18n table, a long varying switch body,
and empty/null input. The accounting limb is pinned to both measured outliers *and* to the
next-worst rollout in the entire run (ratio 2.48), which must not flag. One test asserts the property
the whole item rests on: identical input yields an identical verdict, because the detector never sees
the arm.

### 6.5 Unproven

The detector is validated retrospectively against the 68 claude-code rollouts. It has never run live,
and the "before it reaches the filesystem" path in particular is exercised only by unit test — a live
run is needed to confirm it fires in-flight. It is also claude-code-only: codex and opencode produced
zero degeneration across 136 rollouts, so their runners are not instrumented.

---

## 7. Item 7 — claude-code subagent spend: already shipped, verified

Shipped in `ab4f252`. Verified, not re-implemented.

`harness/claude-code-task-runner.mjs:205-215` (`sidechainTurnSets`) reads each delegated transcript
at `<session-id>/subagents/agent-*.jsonl`; `addSidechainCosts` (`:223-238`) sums each subagent as its
own growing prefix — **including `breakPricedCostUsd`**, which is what the handoff asks for — and
retains `…MainOnlyUsd` columns beside the totals.

Retaining the main-only columns is what makes the pre-registered bar checkable from the same row
rather than from a separate derivation. That bar was met: **68 of 68 rows reproduce their published
main-only cost within 0.5%**. My own independent recomputation reproduces the arm totals exactly —
native `$0.398435`, sweet `$0.407928`, gap `$0.009493` — matching the handoff's scoreboard to the
last digit.

`node tests/claude-code-cost.mjs` passes, including "breakPriced is summed per context, not
recomputed over a merged sequence" and "no subagents leaves every column byte-identical".

Effect, from [`PHASE-0-RESULTS.md`](./PHASE-0-RESULTS.md) §3: claude-code moves from `+2.4%`
(sweet worse) to `−9.4%` (sweet cheaper). The paired interval still crosses zero (`p = 0.39`), so
this is a corrected point estimate, not a demonstrated win — and it was fixed because the accounting
was wrong, not because it improves a comparison.

---

## 8. Item 8 — the empty `pages` parameter (honesty work): already shipped, verified

Shipped in `ab4f252`. `READ_PAGES_TOOL_NOTE` is defined at
`harness/claude-code-task-runner.mjs:28-31` and appended at `:367` **unconditionally, before** the
sweet-only system override — so both arms receive the byte-identical string. A test asserts it
carries no retrieval or strategy content, so it cannot quietly become an unmeasured prompt lever.

Confirmed as reported: 68 native and 6 sweet Read calls died on `Invalid pages parameter: ""`.

**This will improve NATIVE's claude-code cost by an estimated 2–4% on the next run.** It is the
repair of our own harness-adapter defect, which had been inflating native's cost. When that number
moves it must not be described as a sweet regression.

> **Update 2026-08-13 — the `PreToolUse` normalizer added later is proven inert.**
> Claude Code validates tool arguments against the schema *before* the hook stage, so an invalid
> `pages` value never reaches a hook. Measured across all 32 native sessions: the hook ran on 189
> Read calls, **0** of which needed it, and did not run on 110 calls, **all** of which needed it and
> were rejected. A second invalid spelling — `pages: " "`, 11 calls — was also found. Full analysis
> and the three withdrawn claims are in
> [`RESULTS-2026-08-13.md`](./RESULTS-2026-08-13.md) §5. The prompt-level note in this section is
> unaffected and remains the only working lever; it is what makes 189 of 299 calls valid.

---

## 9. Files changed

**Product (sweet-search):**

```
core/search/grep-output-shaping.js          item 3 + array scopes
core/search/search-read.js                  item 1 — gutter delimiter + inverse
core/search/search-server.js                item 2 — multi-value fileFilter, both directions
eval/agent-read-workflows/bin/_ss-argparse.mjs   item 2 — repeated flag, extras
eval/agent-read-workflows/bin/_ss-helpers.mjs    items 1+2 — shared renderer, scope list, guard
```

**Benchmark:**

```
eval/task-completion-bench/harness/degeneration.mjs              item 6 — new
eval/task-completion-bench/harness/claude-code-task-runner.mjs   item 6 — collect + flag
eval/task-completion-bench/harness/analyze-run.mjs               item 6 — three views
```

**Tests:**

```
tests/search/read-line-gutter.test.js                 new, 20 tests (none existed)
tests/search/grep-output-shaping.test.js              locking test corrected, +3 groups
tests/unit/ss-argparse.test.js                        +13 tests
tests/search/read-semantic-daemon-parity.integration.test.js   +1 wire test
eval/task-completion-bench/tests/degeneration.mjs     new, 41 assertions
```

**Test results.** `tests/search` + `tests/unit/ss-argparse` — 1,352 passed, 7 skipped. The 27 test
files importing any changed core module — 490 passed, 12 skipped. Bench suite — 28 of 30 pass;
`baseline-dryrun.mjs` and `turnfix-cohorts.mjs` fail, and both were **proven pre-existing** by
stashing my two modified harness files and re-running (they fail identically without my changes).
`baseline-dryrun` fails on an unset golden-checkout path, an environment gap, not code.

Nothing was committed. The pre-existing dirty working tree was left untouched.

**Two notes on the working tree.**

*Concurrent edits, not mine.* Between 18:23 and 18:31 another process added a
`. "$DIR/_ss-env.sh"` source line to every `ss-*` shell wrapper and created
`eval/agent-read-workflows/bin/_ss-env.sh`. I did not make those edits and did not revert them.
My own changes were re-verified intact afterwards, including the `ss-grep` error paths end-to-end.

*One flaky test run.* Of four full runs of `tests/search` + `tests/unit/ss-argparse`, three were
clean at 1,384 passed and one — executed under heavy load immediately after a native-inference test
sweep — reported 11 failures across 3 files. The three subsequent runs were clean and the failure
names were not captured, so this is recorded as observed flakiness under contention rather than
proven-clean. The 1,384 figure reconciles exactly with the pre-change baseline: 1,352 + 32 new tests.

---

## 10. Corrections to the handoff, collected

1. **Items 5, 7 and 8 were already shipped** in commit `ab4f252` before this session began. The
   handoff presents all three as work to do. They are verified here instead.
2. **Item 4 does not reproduce.** Cross-file tracing works on TypeScript and Swift, and Python has
   cross-file callee edges. The one Python fallback was correct — the agent traced a private helper
   that genuinely has no cross-file callers. The fallback is already announced in the output.
3. **Item 6's direction is inverted.** The degeneration pathology is not sweet-leaning. Its two worst
   instances are one per arm on the same task, the content limb is 4-native / 2-sweet, and quarantine
   removes slightly *more* sweet spend than native spend. It remains worth doing — it is a validity
   repair — but nobody should expect it to help sweet.
4. **Item 6's stated mechanism is wrong.** No payload approaches 127,666 bytes; the pathology is a
   22× billed-vs-retained output-token discrepancy. A payload-content detector alone would miss it
   entirely.
5. **Item 1's slate attribution is wrong.** `SLATE-A-UBER.md` does not propose `cat -n` padding; it
   proposes the tab-aligned gutter, which is what I implemented.
6. **Item 1's `$0` ceiling was too pessimistic.** The handoff says a replay cannot speak to the
   remedy. It can, partially: the model was shown `N<TAB>` 19,499 times on the native arm of this
   same benchmark, including over tab-indented source, with zero whitespace-carry failures. That is
   not proof, but it is far better than the coin flip the handoff assumed. A live A/B is still
   required and is designed in §1.5.

---

## 11. Spend

**`$0.346`**, entirely the item-1 delimiter A/B in §1.5 (control `$0.167` + treatment `$0.179`),
authorised by an explicit GO and below the `$0.40` estimate. Pre-flight spent nothing.

Every other item was settled at `$0`. Analysis scripts were copied to `/tmp` on the box and run
there; two source files were synced for the A/B, backed up first and restored afterwards
(md5-verified). **No file under `results/` was ever modified** — the A/B wrote two new run
directories, `gutter-ab-control-20260812` and `gutter-ab-treat-20260812`. HO2 was neither run nor
inspected. No `ss-*` command was used to develop sweet-search.

---

## 12. The 16-task screen — superseded by RESULTS-2026-08-13.md

> **The `-25.46%` below is UNCORRECTED.** A `pages` harness tax of `$0.054326` falls on
> native alone (110 wasted Read calls; sweet 0). Removing it gives **−15.85%, p = 0.335**.
> See [`RESULTS-2026-08-13.md`](./RESULTS-2026-08-13.md) for the corrected result.

### 12.0 (original, uncorrected)

**Run:** `screen-v3-20260812`. 16 tasks x 2 arms x 2 reps = 64 rollouts, claude-code,
`gpt-5.6-luna`, `CONCURRENCY=1`, `MAX_TOOL_CALLS=80`, ledger v3 (16/16 gold-FULL).
**Spend ~`$1.00`** (transcript-derived; the runner wrote no provider receipt).

**Task set.** 18 minus `litestar-org__polyfactory-405` (pre-existing agent-run exclusion) minus
`dotnet__yarp-2825`, which the v3 gold re-sweep classified `env-broken-nonnet`. Its failure names
`HttpForwarderTests.RequestConnectTimedOut` — one of the eleven timing-heavy flaky tests recorded in
[`PHASE-0-RESULTS.md`](./PHASE-0-RESULTS.md) §2.3. The ledger now refuses it automatically instead
of scoring it as a fake zero.

### 12.1 Result

| | native | sweet | delta |
|---|---:|---:|---:|
| cost, main-only `idealCost` | `$0.237842` | `$0.177282` | sweet **−25.46%** |
| cost, + recoverable delegated floor | `$0.269497` | `$0.189331` | sweet **−29.75%** |
| tasks solved (any rep) | **9/16** | **9/16** | tie |
| task x rep resolved | 16/32 | 15/32 | native +1 |
| mean tool calls per rollout | 35.7 | **19.9** | sweet −44% |

Paired bootstrap on per-task means, 20,000 resamples: **−25.46%, 95% CI [−46.4%, +6.0%], p = 0.099.**
Both-solved stratum (n=8): −21.33%, CI [−48.3%, +35.6%], p = 0.353.

**The interval crosses zero. This is a direction, not a demonstrated win.** At n=16 the cost column
still cannot resolve a difference, exactly as it could not at n=17.

Solve is a genuine tie: 9 tasks each, with one disagreement in each direction
(`jashkenas__underscore-2757` to native, `teleporthq__teleport-code-generators-291` to sweet).
**The "cheaper AND solves more" goal is therefore still unmet** — this is cheaper AND level.

### 12.2 Why main-only is the headline, and why it is conservative

Claude Code's subagent transcripts are partly usage-zeroed by the OpenRouter Anthropic skin — 6 of
13 and 3 of 11 assistant messages carried no usage in any copy on the two audited transcripts. The
delegated portion of a rollout therefore cannot be fully priced, and the runner correctly refuses to
publish an inclusive figure it cannot support.

That refusal is arm-asymmetric: **12 native rollouts had delegated contexts against 4 sweet**, so
28 of 64 rollouts would have carried a null headline cost. Any comparison conditioned on
"both arms priced" drops native's delegating — and most expensive — cells. An interim table built
that way read **−42.4%**; it is an artifact of selection and must never be published.

The repair is to price **main-only for all 64 rollouts uniformly**, recomputed from the retained
per-request transcripts. No rollout is dropped and both arms are treated identically.

Main-only excludes more from native than from sweet (12 delegating rollouts versus 4), so it
**understates sweet's advantage**. Adding the recoverable delegated spend as a floor moves the gap
from −25.46% to −29.75%; the true figure is at least that, because the floor omits the zeroed
portion.

### 12.3 Three tasks where sweet cost more — two are accounting artifacts

| task | main-only | + delegated floor |
|---|---:|---:|
| `ontodev__robot-710` | +206.7% | **+103.9%** |
| `akinsho__nvim-bufferline.lua-173` | +24.6% | +1.8% |
| `dart-lang__http-1114` | +20.3% | +1.6% |

Two of the three collapse to roughly neutral once native's delegated spend is counted — they were
artifacts of excluding it. **`ontodev__robot-710` is a real sweet regression** and survives at
+104%. It is the single worst cell in the screen and is the obvious next thing to trace.

### 12.4 What this screen does NOT show

It compares **sweet against native under the new code**. It is not an old-code-versus-new-code
design, so **it cannot attribute the cost gap to the seven fixes.** The fixes may account for all,
some or none of it.

It is likewise not comparable to the published 2026-08-11 scoreboard (`+2.38%` on claude-code).
Three things changed together — the product fixes, the cache-write premium, and transcript-superset
pricing — and the task set lost `yarp`. The swing from `+2.38%` to `−25.46%` is suggestive and
**not attributable**. The internal sweet-versus-native comparison within this run is clean, because
both arms are priced identically under one build; the cross-run comparison is not.
