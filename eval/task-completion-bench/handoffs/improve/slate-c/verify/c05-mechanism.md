# c05 — adversarial verify, MECHANISM lens

**Verdict: REFUTED on mechanism. Confidence 0.90.**

The candidate's numbers are right, and its mechanism is not. I re-derived every `[M]` figure it cites
(blind run 9 call sites / 2 flagged; census 15 of 390 cells, all one method on one task; graph 0 `#`
entities and 0 Elixir call edges; `run_tests` INFRA in every `accenture` cell; solve counts 39/41 and
40/43) and they hold. The mechanism has three links and two fail on the traces. **Link 2 — "the
computed binding was the missing item" — is false.** In all six losing cells the caller `fixKeys` and
its call into the shared method were in tool results before the guard edit; in five of six the exact
call expression and the `.filter` line were too `[M]`. Three of the six losers first patched *inside*
`fixKeys` by mistake and then deliberately moved the guard to the shared method `[M]`. All six say in
their own reasoning that they chose to treat an empty array as an omitted type `[M]`. The certificate
would restate code the agents had read and a decision they had made on purpose. **Link 3 — "the face is
selective" — fails the candidate's own pre-registered kill condition.** Falsifier (a), never run by the
candidate, fires: more than 5 flagged functions per repository on 9 of 22 goldens (broad form) and 6 of
22 (strict form), against a bar of "more than 4" `[M]`. In `accenture` itself 23 of 80 functions with
two or more callers carry a flag; the shared method is one of 23. The ceiling arithmetic is correct at
a 100% flip (2 sweet rollouts of 198: codex 39→40 against native 41, claude-code 40→41 against 43,
opencode 0) but the phrase "6 addressable losing cells" overstates the lever-reachable exposure three
times, "requests unchanged" is wrong on the success path, and the realistic flip rate has no measured
support once the fact is known to have been on screen and overridden. Revised ceiling: 0 to +1 sweet
rollout of 198, below parity on every harness, below the ±6 bar. Part B (graph coverage) is a real
correctness bug with a ceiling of 0 solves and 0 cost.

---

## 1. What I checked

| item | path or command |
|---|---|
| brief, draft register, canonical register rows A6, A13, B9, B9b, B11, B12, B19, D1a, D3, D4b, E7, E16, F9, P4, G18, G20 | `slate-c/BRIEF.md`, `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`, `slate-c/register/DEAD-LEVER-REGISTER.md` |
| candidate source, §§0–8 | `slate-c/candidates/resolution-computed-facts.md` |
| upstream seed §2.7, §3–§5 | `slate-c/forensics/wrongfix-facts.md` |
| sibling lenses (read; numbers below are mine) | `slate-c/verify/c05-history.md`, `slate-c/verify/c05-measurability.md` |
| candidate scripts and data | `slate-c/candidates/scripts-resolution-computed-facts/{binding_face.py, census_edited_functions.py, graph_cov.py, data/census-summary.txt, data/tasks-safe.tsv}` |
| blind run re-derived | box: `python3 binding_face.py <golden>/lib/index.js '#runMethod'` |
| rows, patches, census cross-check | box: `rows_check.py`, `patches_check.py`, `census_check.py` over `results/{fp-codex-tab,fp-opencode-tab,fp-claudecode-tab}-20260826`, `rp-oc-tab-20260827` |
| graph coverage re-derived | box: `sqlite3` read-only on `<golden>/.sweet-search/code-graph.db` for `accenture` and `absinthe` |
| INFRA census re-derived | box: `grep -rl "status=INFRA" agent-state/accenture__sfmc-devtools-1974-{native,sweet}` per run, subagents excluded |
| transcripts of the six losers and four solved twins | box: files listed in §4 |
| falsifier (a), all 22 goldens | box: `noise_sweep_all.py` (re-run; matches the earlier run line for line except one timeout position) |
| described trigger incl. "caller-divergent literal" | box: `divergent_literal.py` (8 goldens), `superset_rate.py` (390 cells) |
| `ss-trace` not-found path | `core/graph/structural-context.js:297–298` |
| harness runner facts | `harness/opencode-task-runner.mjs:69–77, 98`; `harness/claude-code-task-runner.mjs:59–85`; `harness/codex-task-runner.mjs:457–462` |

Box scratch: `/tmp/wf-slatec/c05-mechanism/`. Nothing written under `results/`. HO2 untouched. No
grading log opened. No hidden test name and no gold patch content read or reproduced; the only patch
text read is the agents' own recorded patches. Spend `$0`. Scripts and raw outputs are saved under
`slate-c/verify/scripts-c05-mechanism/` (`data/*-out.txt`, `data/noise-sweep-rerun.txt`,
`data/noise-accenture.txt`, `data/divergent-literal.txt`, `data/superset-rate.txt`).

## 2. The candidate's measured claims hold `[M]`

| claim | re-derived |
|---|---|
| blind run on `lib/index.js` `#runMethod` (def line 1670, 4 params): 9 call sites, 2 flagged | 9 sites at lines 738, 1425, 1437, 1448, 1460, 1472, 1484, 1568, 1642; flagged `replaceCbReference:1568` (`fallback-or`, `<-[]`, `.push`) and `fixKeys:1642` (`fallback-or`, `<-[]`, `.push`, `<-filter`) |
| census 390 cells; flagged face fires 15/390, all `accenture`, all `#runMethod` | 390 cells (codex 66+66, opencode 60 native + 66 sweet, claude 66+66); flagged 15, task counter `{accenture: 15}`, function counter `{#runMethod: 15}`; the 3 wrong-site cells edited `fixKeys` and are unflagged |
| 15 = 9 solved + 6 losers | solved: `c:s2`, `o:n0`, `o:n2`, `rp o:s2`, `cc:n0`, `cc:n1`, `cc:n2`, `cc:s0`, `cc:s2`; losers: `c:n0`, `c:n1`, `c:n2`, `c:s0`, `o:n1`, `cc:s1` |
| unflagged ≥2-callers form fires 48.6–56.1% of solved cells | census-summary solved rows 53.7 / 53.8 / 48.6 / 56.1 / 55.8 / 55.0% |
| graph: `accenture` 0 `#` entities, 0 edges into `runMethod`, 34 `#private` defs | entities 7,758; `calls` edges 5,546; entities named `#…` 0; entities named `*runMethod*` 0; 34 definitions by regex outside `node_modules`/`dist` |
| `absinthe` 2,651 entities, 0 call edges | 2,651 entities; relationships = `imports` 857, `implements` 1, `calls` 0 |
| `traceSymbol` returns `not_found` without an entity | `structural-context.js:297–298`: `findEntityCandidates(...)`, empty → `_empty(cleanSymbol, 'not_found')` `[C]`; the same-file caller fallback runs only after a target entity exists |
| `run_tests` INFRA in every `accenture` cell | files with a verdict / files with INFRA: codex native 3/3, sweet 3/3; opencode native 5/5, sweet 4/4 (fp) and 5/5 (rp); claude native 3/3, sweet 3/3; no other task in `fp-codex-tab` has an INFRA file |
| solves | codex sweet 39/66, native 41/66; claude sweet 40/66, native 43/66; opencode native 41/66, sweet 36/63 (fp) + 20/33 (rp) |

The relationships table stores `context_line` per edge `[M]` (columns: `source_id, target_id,
target_name, type, weight, context_line, full_import_path, is_static, is_wildcard`), as the candidate says.

## 3. Mechanism link 1 holds: the flagged fact is the right discriminator `[M]`

Read from the agents' own recorded patches (`<run>/<arm>/patches.json`, `rep-N/patches.json`):

- All six losers add a guard inside `#runMethod` that rejects an **empty array** as well as a missing
  value (shapes: `!x || (Array.isArray(x) ? !x.length : !Object.keys(x).length)` in `c:n0`, `c:n2`,
  `o:n1`; the two-branch equivalent in `c:n1`, `c:s0`; `!x || !Object.keys(x).length` in `cc:s1`).
  All six have `f2pFrac = 1` and `resolved = false` `[M rows.json]`.
- All nine solved cells leave the empty array alone: falsy-only (`if (!selectedTypes)`) in `cc:s0`,
  `cc:n0`, `cc:n2`, `cc:s2`, `o:n2`; scoped to the issue's method in `c:s2`, `cc:n1`, `o:n0`;
  `!selectedTypesArr && !selectedTypesObj` in `rp o:s2`. None contradicts the fact, so the candidate's
  "9/9 consistent" replay holds.
- Base tree `[C]`: `lib/index.js:1636–1637` sets `selectedTypesArr = selectedTypes.filter(type => type !== 'event')`,
  and `:1642–1647` passes `selectedTypesArr || selectedTypesObj` into `#runMethod`. That value is `[]`
  when the only requested type is the filtered one. The face flags exactly this site.

So the fact is true, computable blind, and separates solved from lost on this task.

## 4. Mechanism link 2 fails: the fact was on screen, and the losers overrode it on purpose `[M]`

Transcripts (rows carry `rolloutFile` for codex; claude by the `r<N>` slug; opencode by completed
tool-call count 41/30/28 matching `calls` 41/30/28):

| cell | file | `fixKeys` in tool results before the guard edit (hits) | exact call expression before edit | `.filter` line before edit |
|---|---|---|---|---|
| `c:n0` | `fp-codex-tab-20260826/…-native/…/rollout-2026-08-26T22-33-59-01a04035-….jsonl` | yes (27) | yes | yes |
| `c:n1` | `…/rollout-2026-08-26T22-36-07-01a04037-….jsonl` | yes (11) | yes | yes |
| `c:n2` | `…/rollout-2026-08-26T22-38-01-01a04039-….jsonl` | yes (9) | yes | yes |
| `c:s0` | `fp-codex-tab-20260826/…-sweet/…/rollout-2026-08-26T22-28-06-01a04030-….jsonl` | yes (13) | yes | yes |
| `o:n1` | `fp-opencode-tab-20260826/…-native/opencode-retained/session-1787754354348-1040662-3a09e376/attempt-1.stdout.ndjson` | yes (10) | after the edit only | never |
| `cc:s1` | `fp-claudecode-tab-20260826/…-sweet/claude-home/projects/-root--ss-eval-runs-r1-4/9a58975e-….jsonl` | yes (17) | yes | yes |

"Before the guard edit" means the first tool-result record containing the string precedes the first
edit call (codex: the `exec_command` carrying `*** Begin Patch`; claude: the first `Edit`; opencode:
the first `apply_patch` event). The four solved twins I checked (`c:s2`, `cc:s0`, `o:n0`, `o:n2`) saw
the same strings before their edit, so presence does not separate solved from lost.

The agents' own reasoning, tool results excluded (`agent_empty.py`, `agent_text.py`):

- `c:n1`, `c:n2`, `o:n1`: the **first patch landed inside `fixKeys`** (the anchor matched its identical
  local declarations). Each agent noticed ("the first patch matched … `fixKeys`, not the refresh
  dispatcher"), and **relocated the guard to `#runMethod` deliberately** ("applying the guard only inside
  the shared method dispatcher"). These three agents edited the caller's body and still rejected its
  empty argument.
- All six state the empty-array rejection as a design choice: "handles missing, empty-array, or
  empty-object type selections" (`c:n0`); "a guard to handle empty arrays" (`c:n1`); "also handles empty
  type arrays/maps" (`c:n2`); "`refresh` and other shared method calls now handle missing or empty types"
  (`c:s0`); "detect a missing or empty type selection" (`cc:s1`); "empty arrays/objects that represent an
  omitted type" (`o:n1`).

The candidate's mechanism is that a computed, stated binding changes a choice that a shown site did
not. On this task the binding is one inference from a line every loser had read, and the choice was
explicit. The hint ladder's flips came from certificates that computed something the agent could not
read off the page (state-space closure) or that named the fix; its rungs that restated visible facts
scored 0/5 (localization) and 0/6 (the "check the twin" clause). Nothing measured supports a flip rate
above those rungs for this face, and the candidate itself tags its rate `[I]`. The register's own
precedent is the same: B19's exposure check found "one cell ran the exact caller trace and still
failed"; A13 found that advertising a hint inside a tool result cost 20 of 84 calls.

What *was* missing in every losing cell is the visible sibling test: the two base-tree test lines that
exercise `fixKeys` with the filtered type reached tool results in 1 of 6 losers (`c:n0`, one line), and
`run_tests` returned INFRA in all 33+ `accenture` rollouts, so no agent could observe the test failing
`[M]`. That channel is the shared `run_tests` shim, which has zero differential (brief rule 6).

## 5. Mechanism link 3 fails: the face is not selective in function space `[M]`

The candidate's pre-registered falsifier (a) — run the face on every ≥2-caller function of all 22
goldens; kill if more than 5 flagged functions per repository on more than 4 of 22 — had never been run.
I ran it twice (the earlier run in `data/noise-sweep-22-goldens.txt`, my re-run in
`data/noise-sweep-rerun.txt`; identical except `mathnet` timed out 24 functions earlier):

| golden | ≥2-caller functions | flagged, broad (fallback / filtered / empty / keys-split) | flagged, strict (filter / empty only) |
|---|---:|---:|---:|
| absinthe | 316 | 45 | 10 |
| **accenture** | 80 | **23** | **12** |
| aiohttp | 123 | 5 | 2 |
| apigee registry | 279 | 4 | 1 |
| protoactor | 749 | 17 | 6 |
| b2-113 | 911 | 8 | 5 |
| b2-259 | 926 | 6 | 1 |
| moq | 375 | 14 | 1 |
| jts | 4,067 | 107 | 34 |
| mathnet (240 s timeout) | 2,997 | 209 | 118 |
| solhint | 127 | 16 | 11 |
| others (11 goldens) | 6–157 each | 0–4 | 0–3 |
| **goldens over 5** | | **9 of 22** | **6 of 22** |

Kill bar "more than 4 of 22": **fires on both forms.** In `accenture` the shared method is 1 of 23
flagged functions; the other 22 include a 60-caller logger helper with four flagged sites and a
162-caller cache lookup. Their flags are true statements about arrays initialised empty or derived from
`Object.keys`/`split`; they are irrelevant to any task that edits those functions.

The candidate JSON also lists **"a caller-divergent literal"** as a firing condition. Neither the census
nor the sweep measured it. On 8 goldens (`divergent_literal.py`):

| golden | ≥2-caller functions | divergent literal | divergent or possibly-empty | share |
|---|---:|---:|---:|---:|
| accenture | 80 | 9 | 26 | 32.5% |
| solhint | 127 | 18 | 30 | 23.6% |
| markup-it | 47 | 6 | 9 | 19.1% |
| aiohttp | 123 | 9 | 14 | 11.4% |
| tablib | 36 | 3 | 6 | 16.7% |
| awslabs | 9 | 2 | 2 | 22.2% |
| fastify-cors | 8 | 2 | 2 | 25.0% |
| final-form | 6 | 0 | 0 | 0% |

So the described face fires on roughly one in four to one in nine functions an agent might edit,
mostly with facts unrelated to the task. The operative rate the candidate reports — flagged given an
*edited* function — is 15/390 = 3.8% and stays 15/390 with the divergent-literal rule added
(`superset_rate.py`: the only edited ≥2-caller function with divergent literals is `#runMethod`). That
rate is an artifact of this pool's edits concentrating on about 60 functions, one of which is a
dispatcher; it is not a property of the face. Both numbers belong in the record.

## 6. Timing and vehicle: the hook could be seen, and the edit tool it needs is absent on codex `[M][C]`

- Every loser kept working after its final guard edit: codex native 5 / 3 / 2 calls (one `run_tests`
  each), `c:s0` 4 calls (three `run_tests` polls), `o:n1` 6 tool events (one `run_tests`), `cc:s1` 4
  requests `[M after_edit.py]`. A post-edit hook's text would therefore land before the final message.
  Acting on it needs at least one more edit call, so "requests unchanged" holds only if the certificate
  is ignored.
- Codex tool surface in the firing sweet loser `c:s0`: `exec_command` 14, `update_plan` 5,
  `write_stdin` 1; the patch is `apply_patch <<'PATCH'` inside `exec_command` `[M]`. A `PostToolUse`
  matcher has no edit tool to bind to on codex.
- Opencode: `harness/opencode-task-runner.mjs:74–76` throws `ambient OpenCode plugin detected` when the
  resolved config has any plugin; `:98` hard-codes `plugin: []` `[C]`. The `tool.execute.after` vehicle
  needs a bench-code change and breaks the shared preflight.
- Claude-code: `harness/claude-code-task-runner.mjs:59–85` records the program's only deployed hook as
  inert with complete separation `[C]`; a different hook stage, but no hook of this design has been
  observed to fire.

## 7. Ceiling arithmetic

- Correct at a 100% flip: the two sweet-reachable losers are `fp-codex-tab-20260826` sweet rep 0 and
  `fp-claudecode-tab-20260826` sweet rep 1. Codex 39→40 against native 41; claude-code 40→41 against
  native 43; opencode unchanged (its two sweet losers `rp o:s0`, `rp o:s1` are wrong-site, register
  D3). Differential 2 of 198 sweet rollouts, 1.0%, bar ±6.
- "6 addressable losing cells" overstates the lever-reachable exposure by 3×: four of the six are
  native cells the sweet-only vehicle never touches. Not an arithmetic error in the ceiling line, but the
  headline wording must change.
- "Realistic ~+1 `[I]`" has no measured support after §4: the fact was on screen and overridden. The
  nearest measured rungs for a restated visible fact are 0/5 and 0/6. Revised: **0 to +1 sweet rollout
  of 198**.
- Solves are not traded for cost (no cost saving is claimed; the fact rejects nothing). But the
  certificate also lands in 4 already-solved sweet cells (`c:s2`, `rp o:s2`, `cc:s0`, `cc:s2`) for 2
  losing ones, and the B12-class "more context, more work" risk on those is unmeasurable by replay.
- Cost of the certificate text itself: about 2 flagged lines for this method, well under the "<0.1%"
  claim `[I]`. Cost of a successful flip: one or more extra calls on the firing rollout (priced by the
  measurability lens at 4.9–7.5% of a rollout per call).

## 8. Part B (graph coverage) — a real bug, not a lever

Confirmed `[M]`: 34 JavaScript `#private` method definitions in `accenture`, 0 graph entities; 2,651
Elixir entities in `absinthe`, 0 `calls` edges. `ss-trace '#runMethod'` and `ss-trace runMethod` both
return `not_found` on this golden today `[M]+[C]`. Ceiling 0 solves, 0 cost. Ship as an E7 extension
after a retrieval-benchmark screen (graph expansion is not format-gated; measurability lens §6).

## 9. Corrections the synthesis must adopt

1. Replace "6 addressable losing cells" with "6 blanket-guard losing cells, 4 native and unreachable; the
   sweet-only vehicle reaches 2 of 198 sweet rollouts (1.0%)" `[M]`.
2. Replace the mechanism sentence "the sites were on screen in losing cells and the choice still went
   wrong" with the full fact: "the caller, its exact call expression and the `.filter` line were in tool
   results before the edit in 5 of 6 losers (6 of 6 for the caller); 3 of 6 had patched inside the
   caller and relocated the guard; all 6 chose to reject empty arrays in their own words" `[M]`. The
   candidate's own evidence for "native cannot match" is evidence that the certificate restates known
   code.
3. Record falsifier (a) as **run and failed**: broad form >5 flagged on 9 of 22 goldens, strict form on
   6 of 22, bar >4 `[M]`. Record the operative edited-function rate separately: 15/390 = 3.8%, unchanged
   by the divergent-literal rule on this pool's edits `[M]`.
4. Add the unmeasured trigger: the described face includes "caller-divergent literal", which flags 11–33%
   of ≥2-caller functions on 7 of 8 goldens measured `[M]`.
5. Delete "requests unchanged"; a flip needs at least one more edit call `[M timing]`.
6. Replace "realistic ~+1 `[I]`" with "0 to +1 sweet rollout of 198; no measured flip rate exists for a
   fact already on screen and deliberately overridden" `[M/I]`.
7. Keep the `accenture` INFRA item (all cells, every harness `[M]`) as a measurement item; the missing
   channel there was the shared `run_tests` signal, zero differential.
8. Keep Part B as a correctness bug with ceiling 0 solves, 0 cost; never count it toward the lever.
9. Vehicle facts: codex edits arrive inside `exec_command` heredocs (no edit tool to hook) `[M]`;
   opencode preflight rejects any plugin `[C]`.

## 10. What I could not finish

- I did not install or fire a hook on any pinned harness binary; that `$0` check remains open.
- The "before the edit" test is string presence in tool results, not proof the agent read the lines;
  the agents' own reasoning (§4) is the stronger evidence and covers 6 of 6 for the design choice and 3
  of 6 for editing inside the caller.
- The divergent-literal measurement covers 8 of 22 goldens (the four largest repositories were skipped
  for time); the per-repo figures are lower bounds on the described trigger's noise.
- `mathnet` timed out at 240 s in both sweeps; its counts are lower bounds.
- The opencode session-to-rep mapping rests on the completed-tool-call count (41/30/28 matching `calls`
  41/30/28) and cost ordering, not on a replayed cost equality.
- I did not open any grading log, any hidden-test material, or HO2.

## 11. Artifacts

- This report: `eval/task-completion-bench/handoffs/improve/slate-c/verify/c05-mechanism.md`
- Scripts: `slate-c/verify/scripts-c05-mechanism/{binding_face.py, rows_check.py, patches_check.py, census_check.py, after_edit.py, noise_sweep.py, noise_sweep_all.py, markers.py, agent_text.py, agent_empty.py, divergent_literal.py, superset_rate.py}`
- Outputs: `slate-c/verify/scripts-c05-mechanism/data/{rows-check-out.txt, patches-check-out.txt, census-check-out.txt, after-edit-out.txt, markers-out.txt, agent-empty-out.txt, noise-sweep-22-goldens.txt, noise-sweep-rerun.txt, noise-accenture.txt, divergent-literal.txt, superset-rate.txt}`
- Box scratch: `/tmp/wf-slatec/c05-mechanism/`
