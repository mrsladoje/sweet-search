# SESSION B UBER — resolution-first domination slate and later execution plan

> **Phase 0 has since been executed — see [`PHASE-0-B-RESULTS.md`](./PHASE-0-B-RESULTS.md)
> (2026-08-17, `$0`).** Four tasks are now blocked from admission because they cannot measure
> anything, so **every cost figure in §0 and every `17`-task denominator below is superseded.**
> On the admissible 13 the deltas are codex `−9.4%`, opencode `−15.3%`, claude-code **`−0.3%`** —
> the claude-code advantage was carried almost entirely by the blocked tasks. Solve counts are
> unchanged (codex 7 vs 8; opencode and claude-code 7 vs 7).
> **D1** is closed by REMOVAL, not repair: the deflake was attempted and gold still fails its own
> gate in 3 of 8 fresh runs, so **Q1 (§5) is dead, not quarantined**. **D2** is committed but not
> yet deployed. **D3** now has the retry rule §6 declared. **D4**, **D5** and **D7** were already
> closed by Slate A. Read that document before acting on any number below.

This document is the curated synthesis of [`SLATE-B.md`](./SLATE-B.md) and [`SLATE-B-FABLE.md`](./SLATE-B-FABLE.md). It preserves every reusable candidate, supporting mechanism, defect, falsifier, and later-plan suggestion from both files while removing duplication and correcting factual inconsistencies. The source documents remain unchanged.
This synthesis was produced at `$0`. No rollout, benchmark, build, test suite, remote mutation, commit, or push was performed. `HO2` remains frozen. Nothing below authorizes implementation or spend; later paid work requires an explicit user `GO` after the stated zero-cost gates pass.
## 0. Executive verdict

The combined finding is:
> **The current solve frontier is not code localization. It is evidence closure after localization.**
In the decisive traces, both arms usually reach the owning file and relevant symbol quickly. The remaining decision is then one the repository, visible tests, or current sweet tools cannot reliably adjudicate: an installed dependency's callback contract, a mirrored state transition, a new public module that does not yet exist, JavaScript property enumerability, a nested-layout boundary, or whether a newly red exact-string assertion is stale. The model guesses. Hidden grading then rewards whichever guess matched the missing contract.
The strongest immediate resolution program is installed-dependency contract closure: expose the pinned pytest implementation through sweet, repair missing cross-file trace edges, and fall back to a behavior probe when source is ambiguous. On the current data, pytask is the task that gives native its only task-level advantage on both opencode and claude-code. A robust sweet flip there gives sweet the solve lead on all three harnesses.
The strongest cost program remains architectural: move alternative-patch generation, execution, and rejection into a local forge after the paid model has localized the problem. Smaller Fable cost ideas—anchored edits and pre-API impact previews—are retained as forge components and cheap probes, but are not promoted as standalone wins because their individual ceilings are only about 2–5%, below the handoff's approximately 15% measurement bar.
**Current line to beat:** The uncorrected all-17, two-rep break-priced ledger is:

| Harness | Native cost | Sweet cost | Cost delta | Native tasks | Sweet tasks |
|---|---:|---:|---:|---:|---:|
| codex | $0.289332 | $0.270644 | sweet −6.5% | 9/17 | 10/17 |
| opencode | $0.270888 | $0.222779 | sweet −17.8% | 9/17 | 9/17 |
| claude-code | $0.398435 | $0.407928 | sweet +2.4% | 9/17 | 9/17 |
Claude-code's main ledger omits subagent tokens. Adding those measured tokens back gives native approximately `$0.43639` and sweet `$0.42322`, making sweet about 3.0% cheaper. That is the honest scoreboard correction, but it is **not** a product cost lever. Product domination should still seek a robust cost move rather than depend on an accounting repair or a `$0.009493` noisy raw gap. The raw Claude gap is not statistically distinguishable from zero: per-task SD `$0.003567`, SE `$0.000865`, approximate 95% interval `−$0.0264` to `+$0.0359`, sign-flip `p≈0.79`; rep 0 and rep 1 even reverse sign. This supports the 15% materiality bar, not permission to ignore cost.
The two non-additive paths to domination are therefore:
1. **Resolution:** Program P1 flips pytask robustly on opencode and claude-code. Sweet becomes 10/17 versus native 9/17 on all three harnesses while retaining codex's existing lead.
2. **Cost:** corrected total-cost accounting already has sweet cheaper on all three; Program P7 is the retained product path to a measurable 15%+ reduction with solve preservation.
## Operational evidence contract

This section makes the Uber document sufficient for a later forensic or planning session. It does not authorize a rollout. The evidence box is `root@167.233.69.121`; access is read-only. Never launch a pilot, spend money, or mutate `results/`. Another agent may be using the host.
Remote base: `/root/sweet-search-private/eval/task-completion-bench/results/<RUN_ID>/`, where `RUN_ID` is one of `sb-codex-20260811`, `sb-opencode-20260811`, or `sb-claudecode-20260811`. Each run has `17 tasks × 2 arms × 2 reps = 68` rollouts; total `204`.
Access inventory—expected output is `68, 68, 68, 14, 104`:
```bash
ssh root@167.233.69.121 'cd /root/sweet-search-private/eval/task-completion-bench/results
 ls sb-codex-20260811/agent-state/*/codex-home/sessions/*/*/*/rollout-*.jsonl | wc -l
 ls sb-opencode-20260811/agent-state/*/opencode-retained/*/attempt-1.stdout.ndjson | wc -l
 ls sb-claudecode-20260811/agent-state/*/claude-home/projects/*/*.jsonl | wc -l
 ls sb-claudecode-20260811/agent-state/*/claude-home/projects/*/*/subagents/*.jsonl | wc -l
 ls sb-*/[ns]*/logs/*_log.txt | wc -l'
```
Use `/root/dump-trace.mjs` (local copy: `eval/task-completion-bench/handoffs/improve/dump-trace.mjs`) rather than hand-parsing schemas. Its default `--max-result 0` renders every message and untruncated tool result:
```bash
ssh root@167.233.69.121
cd /root
node dump-trace.mjs --list
node dump-trace.mjs dashbitco__nimble_options-43 sweet --harness codex
node dump-trace.mjs dart-lang__http-1114 sweet --harness claude-code --tools-only --max-result 800
node dump-trace.mjs dart-lang__http-1114 native --harness claude-code --subagents
node dump-trace.mjs joshuakgoldberg__bingo-274 sweet --harness opencode --rep 0
```
Flags: `--harness codex|opencode|claude-code`, `--rep N`, `--max-result N`, `--tools-only`, `--subagents`, and `--list`.

| Evidence | Exact location/use |
|---|---|
| codex raw | `agent-state/<task>-<arm>/codex-home/sessions/YYYY/MM/DD/rollout-*.jsonl`; command text is inside `custom_tool_call.input`; reasoning is encrypted |
| opencode raw | `agent-state/<task>-<arm>/opencode-retained/session-*/attempt-1.stdout.ndjson`; alternate SQLite is `opencode-data/opencode.db` |
| claude raw | `agent-state/<task>-<arm>/claude-home/projects/<slug>/<sessionId>.jsonl`; dedupe blocks by tool-use/result ID, not growing streamed records |
| Claude sidechains | `.../<sessionId>/subagents/agent-*.jsonl`; excluded from the main cost ledger unless D7 is applied |
| per-rep aggregate | `<RUN_ID>/rows.json`; includes outcome, calls, usage, cost, gradeability, and absolute `rolloutFile` |
| final patches | `<RUN_ID>/preds-<arm>.jsonl` → full untruncated `model_patch` |
| turn prices | `<RUN_ID>/turns/<task>-<arm>.jsonl` → `{t,in,cached,out}` and `meta.price` |
| grader output | `<RUN_ID>/<arm>/logs/<task>_log.txt` and `<arm>/rep-1/logs/...` |
| repeat-test audit | `<RUN_ID>/rt-dedup/<task>-<arm>.jsonl` |
| condensed trajectories | `<RUN_ID>/trajectories/`; results truncate at 600 characters and inputs at 200, so never infer absence from them |
| gold/task record | `select/.cache/tasks_full_luna_rotate20.json`; `patch`, `test_patch`, `FAIL_TO_PASS`, and `problem_statement` are top-level |
Local synthesis inputs are `EVIDENCE-DIGEST.md`, `evidence-pack.json`, `RUN-LEDGER.md`, the two source slates linked above, and `HANDOFF-CRUSH-NATIVE.md`, all under `eval/task-completion-bench/handoffs/improve/`. Treat the source slates as provenance; this file is the authoritative and sufficient continuation plan. A later planning session need not reread either slate unless auditing provenance or challenging a claim. Re-verify paths, hashes, pinned versions, and external state before any implementation or paid stage.
Pinned provenance SHA-256: `SLATE-B.md` = `a79a5bc08062fb422950442828e900892293fcdaf495de305826284d815b2f4e`; `SLATE-B-FABLE.md` = `f6bb827847c89eafc268140cdc39794a69dcadeca3bd1dfdae9b37bfbbd2beeb`.
## 1. Evidence base and corrections

**1.1 Trace coverage in the combined record:** The two sessions together read **22 unique complete main rollouts** end to end with the untruncated reader:
- `pytask-dev__pytask-210` — codex native r0 and sweet r0; opencode sweet r0.
- `akinsho__nvim-bufferline.lua-173` — claude-code native r0, sweet r0, and sweet r1.
- `dashbitco__nimble_options-43` — claude-code native r0, sweet r0, and sweet r1.
- `mransan__ocaml-protoc-202` — opencode native r0 and sweet r0.
- `apple__swift-nio-http2-145` — codex sweet r0; claude-code native r1 and sweet r1.
- `dotnet__yarp-2825` — claude-code native r1 and sweet r1.
- `oceanparcels__parcels-617` — claude-code native r0 and sweet r0.
- `joshuakgoldberg__bingo-274` — claude-code native r0 and sweet r0.
- `codeception__codeceptjs-367` — claude-code native r0 and sweet r0.
Ten additional unique rollouts received deep partial reads covering edits, relevant thinking, verdicts, and endgames but are not misreported as complete:
- pytask — codex native r1 and sweet r1; claude-code native r0, sweet r0, and sweet r1.
- Dashbitco — codex sweet r0.
- Apple — claude-code sweet r0.
- Underscore — claude-code sweet r1 and codex sweet r1.
- Dart HTTP — claude-code sweet r1.
Supporting inspection covered per-rep rows, recorded patches, grader logs, gold/test patches for selected tasks, degeneration markers, self-reverts, and subagent accounting. Detached sidechains are not counted as complete main rollouts.
1. **1.2 Corrections applied during synthesis:** **Pytask is 4/4 versus 8/8, not 5/5 versus 7/7.** The 12 per-rep rows contain four resolved rollouts. Reading the final choices shows that all four implementations passing `exc_info` to the callable resolved, while all eight `()` or frame implementations failed. The causal association remains perfect; the Fable counts were off by one in each bucket.
2. **YARP has six task-arm cells and 12 rollout logs.** Every one of the 12 logs across three harnesses, two arms, and two reps stops at the missing `.NET 10.0.100-preview.3.25201.16` SDK before running a test. YARP is ungradeable in this run.
3. **Only YARP is established as a wholly ungradeable task.** Empty or prematurely yielded `run_tests` results compromise several codex rollouts, but that is a runner/feedback defect—not proof that a second entire task is ungradeable.
4. **No additive tool is risk-free.** Fable's B1 described dependency source as having zero risk to existing solves. The merged plan instead requires solve-preservation controls: another corpus, command, and M± trigger can distract the model or add paid turns.
5. **Small cost components are not standalone cost candidates.** `ss-edit` and the pre-API impact rule remain useful, but their 2–5% arm-level ceilings do not satisfy the approximately 15% bar.
6. **Scoreboard and product effects stay separate.** Subagent accounting repairs the comparison; degeneration filtering repairs measurement; neither is booked as a sweet product saving.
**1.3 Rep-level discipline:** Every proposed task flip is a ceiling, not a forecast. A later gate must establish consistent per-rep behavior on DEV or genuinely fresh tasks. A single lucky rep does not count as evidence, and the ceilings below overlap unless stated otherwise.
## 2. Inversion: how native would crush sweet

> **I am a smart engineer hired to make NATIVE crush SWEET. I have the same 204 traces. What do I exploit?**
1. **Make localization look like completion.** Sweet reaches the first edit 44% sooner on claude-code yet wins nothing from that head start. The decisive contract work happens after the owning symbol is found.
2. **Exploit repository-external contracts.** Pytask's callable signature lives in the installed pytest source. Apple cites an RFC whose state rules are not present in the local switch. Native can sometimes recover through broad caller greps or prior knowledge; sweet stops when its indexed repository evidence is exhausted.
3. **Exploit sweet's explicit uncertainty without giving it a next action.** Losing sweet traces state blind spots such as “the exact callable contract” or “whether related stream-state cases need adjustment,” then guess anyway.
4. **Choose tasks whose required artifacts do not exist.** Bingo needs three new modules and a shared predicate. Ranking existing files cannot retrieve absent nodes, so both arms put plausible helpers into the one retrieved file and fail.
5. **Use green visible tests as a false certificate.** Akinsho's invalid recursive patch passed nine visible tests. Bingo's wrong file graph passed 421/421. Codeception's public-contract guesses were driven by exact visible keys. Green did not mean complete.
6. **Use red visible tests to induce a destructive compatibility shim.** On Dashbitco, agents first implemented `:integer`, saw the old exact-string assertion fail, then hid or repositioned the new type to regain green. The only resolved rep kept the stale test red.
7. **Let extra exploration accidentally create the missing counterexample.** Akinsho native first broke four visible tests, repaired, and solved. Sweet's narrower patch stayed green and wrong.
8. **Exploit call-count optics.** Codex native packs several shell operations into one tool envelope; sweet's calls are finer-grained. Raw call counts can make sweet look wasteful even when its cost is lower. Packing the same work is not the solution.
9. **Use off-ledger workers and broken environments.** Claude native uses more subagents whose spend is omitted. YARP cannot compile. Some codex tests yield no result. Claude degeneration creates huge outliers. An opponent can curate whichever version of that scoreboard favors native.
10. **Keep the empty-issue refusal in the denominator.** Sweet spends almost nothing on mransan and produces no patch. That lowers cost without producing a solve.
The inversion yields the retained programs below: dependency/spec evidence, terminal residue and witnesses, artifact authoring, runtime contracts, state-space reasoning, and local repair execution.
## 3. What the decisive tasks actually require

| Task | What both arms already found | Deciding failure | Required capability |
|---|---|---|---|
| pytask | traceback filter and hide marker | guessed callback argument | installed dependency source or behavior probe |
| Underscore | `groupBy`/`countBy` twins | identical old stem remained 13 lines below | terminal diff-residue audit |
| Dashbitco | `@basic_types` and exact failing assertion | warped code to satisfy stale oracle | issue witness, oracle extraction, closure gate |
| Akinsho | owning offset recursion | green patch referenced branch-local state | nested-layout executable witness |
| Apple | both push-promise methods and state switch | patched one of four state/action quadrants | cited spec plus state-space checker |
| Bingo | existing Handlebars helper file | required new modules absent at base | artifact-graph authoring |
| Codeception | dormant `output.say` primitive | guessed name, ownership, enumerability | runtime public-surface probe |
| YARP | route creation inside endpoint loop | wrong multiplicity, but grading never ran | repair environment, then cardinality simulation |
| Dart HTTP | base API and implementors | nine-file expansion followed by self-revert | impact preview plus local patch tournament |
| Ocean Parcels | exact `kernel_vars` causal slice | paid post-localization wandering | local repair executor |
| mransan | no usable issue text | refusal or random walk | benchmark/task repair, not a product lever |
## 4. Ranked primary programs

### P1. Dependency contract closure: source first, behavior experiment when source is insufficient

**Class:** composite: `retrieval expansion / dependency-source reach` for `ss-deps`, plus `NEW CLASS — dependency behavior experimentation` for `ss-dep-probe`. · **Tier:** `GATED` source corpus; `MOONSHOT` behavior-probe fallback. · **Source proposals retained:** Fable B1 and B3; original candidate 5; defect D-5.
**Trace evidence:** In codex/pytask/native r0, the agent tried to import pytest's implementation and received `ModuleNotFoundError: No module named '_pytest'`, then called the hide predicate with a frame and failed. In opencode/pytask/sweet r0, the model wrote:
> “My current blind spot is the exact callable contract expected by hidden tests...”
It then chose zero arguments and failed. Claude sweet r1 considered that pytest might pass exception information, used `ss-trace`, received only a same-file scan, and reverted to the zero-argument guess. Across all 12 pytask rollouts, the corrected discriminator is:
- `exc_info`: 4/4 resolved.
- `()` or frame: 0/8 resolved.
The exact upstream implementation calls the predicate with exception information. This is a contract the current agent-visible checkout cannot directly inspect. The pinned image is `swerebenchv2/pytask-dev-pytask:210-3022733`; `install_config.install = pip install -e ".[test]"` places pytest in site-packages, and `_pytest/_code/code.py` contains `tbh(None if self._excinfo is None else self._excinfo)`.
1. **Mechanism:** **Repair cross-file trace edges first.** Python, Lua, and TypeScript traces reported same-file fallback scans. For pytask, cross-file callers include literal `sys.exc_info()` flows that helped native resolve. This is a sweet correctness prerequisite and may solve part of the problem before a new corpus is needed.
2. **Add `ss-deps`.** During index construction, walk pinned installed sources from prepared environments—site-packages, declared node modules, and vendored dependencies—into a separately labeled, read-only corpus. Expose `ss-deps <query|module.symbol>` and `ss-read --dep <path>`.
3. **Use blind-spot escrow as a trigger, not a standalone candidate.** When sweet's own state summary names a checkable external contract, the next operation must attempt `ss-deps`, a repaired `ss-trace`, or another concrete check. If none can answer, the final answer must expose the unresolved assumption rather than silently convert it into certainty.
4. **Fallback to `ss-dep-probe`.** For an ambiguous source-level contract, use a version-addressed, hermetic dependency sandbox with sentinels. On pytask it would run the pinned pytest path and record whether the callback receives exception information, a frame, or no arguments.
**Vehicle and differential:** Sweet-only corpus, commands, and general M± trigger. The shared FRAME remains unchanged, so the head-to-head differential is real.
- **Ceiling and cost:** Resolution ceiling: **+1 task on opencode and +1 on claude-code**, with codex stability. That produces a 10/17 versus 9/17 sweet lead on all three harnesses.
- Current sweet pytask spend: **$0.012807 codex / $0.006745 opencode / $0.052958 claude-code**.
- Source consultation likely adds one or two calls on a small trigger set; the prior estimate of roughly `+$0.0005` per triggered rollout or `<0.5%` arm-level cost is a hypothesis, not established fact.
- If a behavior probe also prevents the Claude degeneration-shaped rerun and both reps cost the observed cheap r1 amount (`2 × $0.006595 = $0.013190`), the conditional ceiling is a `$0.039768` saving, or 9.7% of Claude sweet spend, producing `$0.368160` before fully loaded corrections. Do not book that saving until degeneration and contract effects are separated.
- Build cost: `ss-deps` is likely weeks of corpus/version/license work; a general behavior-probe ecosystem is plausibly one to two engineer-months per initial language family.
1. **Cheapest `$0` falsifiers:** Verify which DEV tasks install inspectable source at pinned versions.
2. Confirm the pytask image's pytest file contains the relevant call and can be indexed without network access during a rollout.
3. Rebuild or inspect cross-file trace edges for pytask and ask whether existing callers alone expose the contract.
4. Search all sweet traces for dependency-shaped blind spots and estimate trigger frequency.
5. Kill `ss-deps` if source is usually unavailable, ambiguous, or ignored; escalate only the ambiguous observable subset to `ss-dep-probe`.
**Later GO gate:** On DEV/fresh callback-contract tasks, the program must choose the verified contract in both reps, preserve every control solve, and avoid a material paid-cost regression. “Pure addition” is not an accepted safety argument.
### P2. Terminal family-residue audit over the actual diff

**Class:** `verification / annotation`—an existing §0.5 class, retained because the trigger and checked object differ from the dead search-time sibling ideas. · **Tier:** `GATED`. · **Source proposal retained:** Fable B2; Apple mirror support from both slates.
**Trace evidence:** Claude sweet r1 on Underscore replaced `_.has(result, key)` in `groupBy` but left the identical stem in `countBy`, 13 lines below. It closed with:
> “1561 of 1562 tests passed — no failures introduced.”
The closing explanation never mentioned `countBy`. Both Claude arms missed the twin; codex sweet read a span containing both and changed both. On Apple, every inspected patch widened only the issue-named receive state even though the send twin was already present.
**Mechanism:** Add `ss-audit`, run after an edit and before completion. It reads the working-tree diff and reports:
- remaining verbatim or normalized occurrences of replaced stems;
- likely structural twins of edited symbols;
- a short disposition table requiring edit or an explicit reason for divergence.
Use the existing SimHash/MinHash infrastructure for near-duplicate candidates. The general M± hook is: “Before declaring done, run `ss-audit`; for every residue either edit it or state why it is intentionally different.”
The crucial distinction is timing. Ambient sibling context was ignored. A residue derived from the agent's **own transformation** is a concrete defect list delivered at the completion boundary. Additive Dart changes would not trigger a replaced-stem audit, reducing that known over-edit risk.
**Vehicle and differential:** Sweet-only command plus a general M± completion hook. No FRAME change.
- **Ceiling and cost:** Clean ceiling: **+1 claude-code task** on Underscore; no immediate codex/opencode task claim.
- Apple support is composition-only and not counted here.
- Estimated cost: one call and roughly 300–600 output tokens per triggered rollout, previously estimated at `$0.0002–$0.0004` per Claude rollout or around 1–2% arm-level. It costs money to buy resolution.
**Cheapest `$0` falsifier:** Replay all 102 sweet final diffs against their base trees. Require every losing Underscore patch to name `countBy`, then measure residue noise on resolved cells. Kill the proposal if it misses the twin or floods solved work with false positives.
**Later GO gate:** Require a 2/2 Underscore-shaped DEV/fresh flip, no loss on additive-change controls, and an explicit false-positive/output-token budget.
### P3. Executable issue witnesses and an evidence-closure deliverable

**Class:** composite new capability: `NEW CLASS — issue-to-executable-spec compilation`, `NEW CLASS — oracle extraction`, and `NEW CLASS — terminal deliverable gate`. · **Tier:** `MOONSHOT` for general witness compilation; narrow oracle and replay components are `GATED`. · **Source proposals retained:** original candidate 1; Fable B3, B4, and B7.
**Trace evidence:** On Dashbitco, Claude sweet r0 and r1 reached the same post-edit screen. The actual type list now included `:integer`, while one old exact-string assertion did not. R1 wrote that the failure was an expected stale assertion and shipped red—the only resolved Dashbitco rollout in 204. R0 instead removed or repositioned `:integer` in production output to keep the old assertion green and failed hidden behavior. Codex sweet made the same destructive compatibility move.
On Akinsho, Claude sweet r0 used `is_left` in a recursive branch where that local existed only in a leaf branch. All nine visible offset tests passed, but hidden nested-layout behavior failed. Sweet r1 created an explicit `get_boundary_window(windows, is_left)` recursion and resolved.
Codeception supplies a third shape: the relevant runtime primitive was visible, but names, enumerability, and deferred timing were not captured by visible static tests. P6 owns that specific adapter; it can feed this closure program.
The Dashbitco repair tail is measurable: Claude losing r0 used 24 calls versus winning r1's 17 (+41%); codex sweet averaged 12.5 calls versus native 6.5 (+52% cost) largely after insertion.
**Mechanism:** The program changes the expected deliverable from “patch plus green legacy suite” to “patch plus an independently generated evidence bundle”:
1. **`ss-oracle`: structured visible-test expectations.** Parse exact strings, ordering, counts, expected exceptions, and public-key assertions into data with source lines. This addresses the observed `ss-grep --in` loss and tells the agent exactly what the visible oracle pins. Proposed interface: `ss-oracle <test-file|test-name>`.
2. **`ss-witness`: issue-derived executable behavior.** Generate a small repo-native witness from the issue, base source, and public behavior—without hidden-test or gold-patch knowledge. For Dashbitco it must jointly check integer acceptance, non-integer rejection, and honest advertised type order. For Akinsho it must exercise nested row/column layouts and both boundaries.
3. **Blind-spot escrow.** If the state summary names an unresolved checkable assumption, the closure ledger retains it until a concrete operation disposes of it. This is a trigger component, not an independent solve claim.
4. **`ss-finish`: machine-checked closure ledger.** Before completion, compose P2 residue results, unresolved assumptions, witness output, and new-failure deltas. A test failure whose delta is consistent with the requested public change is marked for explicit human/model adjudication; it is never silently stripped or treated as a hidden-test hint.
The production-safety constraint is strict: substring similarity between an issue and a failing assertion is not enough to authorize shipping red. The evidence bundle must establish the intended public behavior independently. Otherwise the result remains unresolved. A real implementation must parse pytest, ExUnit, XCTest, tape, and Dart-style outputs, must not rubber-stamp its own ledger, and must not contradict the FRAME's authoritative-completion contract.
**Vehicle and differential:** Sweet-only commands and deliverable contract. No behavior is added to the shared FRAME. General M± text may invoke the tools, but it must remain benchmark-agnostic.
- **Ceiling and cost:** A general witness compiler has a conditional ceiling of **+1 Dashbitco task on codex and +1 on opencode**, plus Claude Dashbitco rep stabilization and Claude Akinsho rep stabilization.
- P6's Codeception task ceiling overlaps and is not added here.
- The original Dashbitco + Akinsho + Codeception exposure was **$0.044528 codex / $0.038150 opencode / $0.048685 claude-code**.
- `ss-finish` alone has **zero independently proven task flips**. It is a delivery mechanism for P2/P3/P6 evidence, not a magic verifier.
- Local execution may reduce destructive-repair turns, but book `$0` savings until replay shows it.
- A general multi-language witness compiler and test-output parser likely costs months; narrow language adapters can be gated independently.
1. **Cheapest `$0` falsifiers:** Without consulting gold changes, hand-author distinguishing witnesses for Dashbitco, Akinsho, and Codeception using only issue text, base source, and recorded visible outputs. Require them to reject every recorded wrong patch.
2. Replay all six Dashbitco failure screens through the proposed expected/actual delta parser. Require consistent classification, then require **zero** false stale classifications on the 27 currently resolved cells' final runs.
3. Count how often agents already inspect tests for exact expectations. If `ss-oracle` has fewer than five realistic triggers across the run, retain it only as a P3 adapter.
4. Kill any mechanism whose expected answer depends on hidden test patches or exact gold structure.
**Later GO gate:** On stratified DEV/fresh tasks, require at least one robust 2/2 task flip, no robust solve loss, and no paid-cost increase before expanding language coverage. A green suite remains evidence, but not the sole certificate.
### P4. Normative state closure: cited specifications plus a state-space checker

**Class:** composite: `retrieval expansion / reference corpus` plus `NEW CLASS — domain state-space model checking`. · **Tier:** `GATED` checker; `MOONSHOT` reference-closure corpus. · **Source proposals retained:** original candidate 2; Fable B5; mirror support from P2.
**Trace evidence:** Apple sweet's first search returned `sendPushPromise` in full and pointed to `receivePushPromise`. Its state summary said:
> “The remaining blind spot is the exact transition/effect expected ... and whether related stream-state cases need adjustment.”
It nevertheless changed only receive/`.halfClosedLocalPeerIdle`. Native made the same one-state edit. All recorded Apple patches missed some part of the four-quadrant behavior: send versus receive crossed with body still possible versus `END_STREAM` already sent. The source comments cite RFC 7540 §6.6, which supplies normative state language absent from the local implementation logic.
1. **Mechanism:** **`ss-statecheck <symbol>`.** Parse enums and switch transitions, pair directionally related operations, enumerate reachable state/action pairs, and return concrete counterexample paths. For Apple, a one-quadrant patch must fail the computed matrix.
2. **Reference-closure corpus.** At index-build time, harvest explicit RFC/spec/URL citations from repository comments and documentation into a labeled `refs` corpus with license, version, size, and staleness controls. Use `ss-search --refs` or narrow federation only when a task/code path names a cited standard.
3. **P2 mirror residue.** Report the untouched send/receive twin after a one-sided edit, but do not claim that ambient mirroring alone resolves the semantics.
The checker and corpus are complementary: the specification states normative behavior; the checker ensures the patch covers every reachable local representation of it.
**Vehicle and differential:** Sweet-only analyzer and reference corpus. No FRAME change.
- **Ceiling and cost:** Apple is 0/2 for both arms on all three harnesses. Conditional ceiling: **+1 task on each harness**. That alone produces sweet resolution of 11/17 versus 9 on codex and 10/17 versus 9 on opencode and claude-code.
- Current sweet Apple spend: **$0.011298 / $0.016274 / $0.023329**.
- No saving is booked. Local checking adds compute and may add context; the first gate is cost non-increase.
- The generic checker may require project semantics; the reference corpus requires weeks of fetch, license, freshness, and provenance work.
1. **Cheapest `$0` falsifiers:** Enumerate the four Apple paths from base code and issue/spec evidence, then verify that the design rejects all recorded one-state patches without reading the hidden test patch.
2. Harvest citations from all 17 DEV task repositories. Retain the reference corpus only if at least two task contracts are materially derivable from cited documents; Apple and pytask are the pre-registered probes.
3. Rotate the state checker onto unrelated DEV/fresh state-machine changes. Kill it if project-specific handwritten semantics are required for nearly every case.
**Later GO gate:** Require a 2/2 Apple-shaped DEV/fresh flip, no solved-state-machine regression, and explicit evidence that the model used both normative and reachability outputs rather than merely receiving them.
### P5. Author missing public artifact graphs rather than editing only retrieved files

**Class:** `NEW CLASS — artifact-graph authoring`. · **Tier:** `GATED`. · **Source proposal retained:** original candidate 3.
**Trace evidence:** On Bingo, Claude sweet reasoned that hidden checks might expect specific helper names, then added `handlebarsDirectory` and `handlebarsFile` to the existing `handlebars.ts`. Native did the same. Both visible suites were 421/421 green. Grading then failed to import `./isFile.js`, `./handlebarsDirectory.js`, and `./handlebarsFile.js`; all were new modules absent at base. Every harness/arm followed the existing-file shape.
**Mechanism:** Add `ss-author-api`, producing an editable artifact graph from a requested public capability:
- public symbols and owning bounded contexts/packages;
- one-module-per-export and barrel-export conventions;
- missing source nodes and typed import edges;
- shared predicates placed in their owning package;
- compile-level contract tests and skeleton files.
For Bingo, the graph places the public helpers in separate package modules and shared file-kind detection in `bingo-fs`. This creates absent code and dependency edges; it is not sibling ranking or a prompt to “check exports.”
**Vehicle and differential:** Sweet-only authoring operation. No shared prompt change.
- **Ceiling and cost:** Bingo is 0/2 sweet on all three harnesses. Ceiling: **+1 task on each harness**.
- Current sweet spend: **$0.014091 / $0.013326 / $0.018978**.
- Cost credit remains `$0` until generated graphs reduce paid authoring turns. The feature could initially increase edit/review volume.
**Cheapest `$0` falsifier:** On DEV public-API changes whose accepted solutions add files, generate artifact-only manifests from the base tree and issue. Score owning module, public export, and dependency direction—not exact gold filenames, prose, or tests. Kill the program if it only parrots existing paths or needs future-commit knowledge.
**Later GO gate:** Require at least one 2/2 new-artifact task flip, correct package ownership, build success, and no material cost regression.
### P6. Runtime public-surface and temporal conformance probe

**Class:** `NEW CLASS — runtime public-surface conformance`. · **Tier:** `GATED`. · **Source proposal retained:** original candidate 4; runtime adapter for P3.
**Trace evidence:** On Codeception, Claude native noticed that “the existing output uses `.say` deliberately” and first added enumerable `say`, `comment`, and `remark`. A visible exact-key test failed, so it made them non-enumerable. Hidden grading expected `say` in the actor's public keys. Sweet read `output.say()` but concluded, “I'll add a public `Helper.comment()` method,” choosing the wrong name and owner. Both arms understood deferred output and guessed the public contract.
**Mechanism:** `ss-surface-probe` loads the public factory in an isolated local process and emits a behavioral certificate:
- enumerable methods before and after the change;
- generated type/definition surface;
- recorder call ordering;
- captured output timing;
- visible-test expectations that the new public contract intentionally changes.
For Codeception, it must distinguish direct enumerable queued `I.say(message)` from non-enumerable aliases and helper-owned `comment`. Static types cannot observe enumerability or temporal output.
**Vehicle and differential:** Sweet-only runtime operation; P3 can consume its certificate. No FRAME content.
- **Ceiling and cost:** Codeception is 0/2 sweet on all harnesses. Ceiling: **+1 task on codex, opencode, and claude-code**.
- Current sweet spend: **$0.010678 / $0.014953 / $0.012288**.
- Runtime startup adds local latency but should add little API cost. Book no savings.
- This ceiling overlaps P3's broad witness ceiling and must not be added twice.
**Cheapest `$0` falsifier:** Replay the behavioral certificate against recorded patches. Native's non-enumerable aliases and sweet's helper-only `comment` must fail; an enumerable queued `say` must satisfy surface and ordering. Kill it if the public name cannot be derived without grader-only facts.
**Later GO gate:** Require a 2/2 runtime-contract flip on DEV/fresh tasks, no public-surface regressions, and stable local process isolation.
### P7. Local repair forge: generate and reject alternative patches outside paid-model loops

**Class:** `NEW CLASS — local repair execution and patch tournaments` with subordinate `NEW CLASS — mutation surface` and a prompt/memory impact trigger. · **Tier:** `MOONSHOT`. · **Source proposals retained:** original candidate 7; Fable B6 and B8; Ocean/Dart cost evidence; degeneration rejection from D-3, without counting runner repair as a product win.
**Trace evidence:** Ocean sweet's first search already showed `kernel_vars = [..., 'dt', ...]` and the declaration-removal loop. It then read a 480-line region, searched related symbols, read another file, grepped 343 `dt` matches, and finally made the one-line fix. Native's subagent returned the exact causal chain and edit immediately. Both solved; measured Claude cost was `$0.007543` sweet versus `$0.004547` native before native's omitted subagent spend.
Claude Dart sweet r1 cost `$0.0394` over 74 calls. It read broadly, made ten consecutive edits across nine files to widen an API, ran tests, then executed a full nine-file self-revert and rebuilt a narrower design. The cell cost about `$0.0112` more than native—more than the entire raw Claude arm gap and +46.7% for that cell. The accepted design changes only `base_response.dart` (`+68/-1`) and avoids the subclass cascade; `ss-trace BaseResponse impact` was never called. The self-revert census found Dart only on Claude sweet, none on opencode, and an inconclusive codex grep.
Claude edit paths also contained whitespace/path fumbling—the prior audit counted 32 sweet edit errors, including a whitespace mismatch, `pages:""` parameter error, wrong `r1--16` path, and wrong indent on one Dashbitco documentation edit—and, in degenerate cells, enormous or role-tag-corrupted payloads. Those observations motivate safe mutation and local candidate selection, not another retrieval rendering tweak.
1. **Mechanism:** After one paid turn states the issue and accepts a causal slice, create isolated local worktrees.
2. Use a local code model plus AST/domain transforms to generate several semantically distinct patches.
3. Run canonical tests and P2/P3/P4/P6 evidence checks locally.
4. Reject destructive compatibility shims, degenerate payloads, broad API cascades, and candidates that cannot dispose of their evidence ledger.
5. Return one patch plus proof bundle for paid-agent review.
Retained subordinate mechanisms:
- **`ss-edit`: anchored mutation.** Match by symbol/line anchor with whitespace normalization, reject degenerate payloads, reconcile the index, and report replacement residue inline. Proposed interface: `ss-edit <file> --at <symbol|line-anchor> --old <text> --new <text>`. Its individual ceiling is `$0.005–$0.010` across the Claude arm, about 2–5%; retain as forge infrastructure/product hygiene.
- **Pre-API impact preview.** Before adding or changing a public/abstract member, run `ss-trace <type> impact` and compare cascade size. Its Dart ceiling is about 3–5%, so it remains a forge heuristic rather than a standalone candidate.
- **Checkpoint tournament.** Preserve the first localized checkpoint and test narrow versus broad designs before paying for a long serial repair loop.
**Vehicle and differential:** Sweet-only local execution service and mutation path. Track local GPU/CPU/energy separately; API dollar savings alone are not total-cost savings. No FRAME change.
**Ceiling and cost arithmetic:** The source slate defined its historical addressable pool as sweet's robust 2/2 solves plus Apple, YARP, Dashbitco, Codeception, Bingo, and pytask. Its current sweet spend was:
- codex: `$0.196625`;
- opencode: `$0.182728`;
- claude-code: `$0.229551`.
Halving paid spend in that historical pool saves `$0.0983125 / $0.091364 / $0.1147755`, or `36.3% / 41.0% / 28.1%` of each full sweet total. Because YARP is ungradeable, the clean planning pool must exclude its `$0.012030 / $0.013062 / $0.020026` spend. The corrected pool is `$0.184595 / $0.169666 / $0.209525`; halving it saves `$0.0922975 / $0.0848330 / $0.1047625`, or **34.1% / 38.1% / 25.7%** of total sweet cost. Corrected paid-model totals would be `$0.1783465 / $0.1379460 / $0.3031655`, still below native on all three. This is an architectural ceiling, not a forecast. The minimum qualification threshold remains **15% total paid-cost reduction on each harness with no solve loss**, followed by total-compute accounting.
1. **Cheapest `$0` falsifiers:** Replay all 204 traces at the first-edit checkpoint for mechanics, but calculate the primary addressability estimate on the 192 non-YARP rollouts. Classify whether the final required change was already localized and whether recorded evidence could distinguish alternative semantics.
2. Require at least 30% of paid dollars behind sufficiently specified checkpoints; at 50% local savings, less than 30% addressability cannot move the total by 15%.
3. Replay `ss-trace BaseResponse impact`. If it does not enumerate the Dart implementor set, repair trace edges before retaining the impact heuristic.
4. Count failed edit/fumble chains. If fewer than 20 Claude sweet turns are actually recoverable, keep `ss-edit` as hygiene rather than a cost claim.
5. Separate degeneration outliers from ordinary design churn before estimating savings.
**Later GO gate:** Release only if the forge preserves every robust solve, creates at least one 2/2 DEV/fresh task flip, reduces paid cost by at least 15% on every harness, and remains favorable after local compute is charged. Expected build cost is several engineer-months plus sandboxing, language runners, local model serving, and proof-certificate design.
## 5. Quarantined but preserved program

### Q1. Data/cardinality simulation for configuration generators

**Class:** `NEW CLASS — data/cardinality simulation`. · **Tier:** `GATED`, but **blocked from evaluation until YARP is gradeable**. · **Source proposal retained:** original candidate 6.
Claude YARP sweet r1 correctly observed that “a loop adds a route for every matching endpoint port.” It added a `routeAdded` flag, then changed the rule to a numeric conditional. Native's subagent stated the stronger invariant—“endpoints determine destinations, not routes”—and recommended moving route creation outside endpoint enumeration, but the main agent still chose a guard inside the loop.
The retained mechanism, `ss-cardinality`, interprets fixture/config inputs and generator loops as relations. It emits identity keys and multiplicities such as:
- one ingress path → one route identity;
- one service → many matching endpoint ports;
- one route → many destinations.
It then symbolically executes concrete YAML/configuration and returns duplicate-key and empty-set witnesses. This computes output cardinality; it is not a prompt rule, ranking tweak, or edit guard.
Conditional ceiling: YARP is currently recorded 0/2 everywhere, so a valid mechanism could be **+1 task on each harness**. Current sweet exposure is `$0.012030 / $0.013062 / $0.020026`. That ceiling is not usable evidence because every one of the 12 grader logs failed before executing tests.
Required sequence before reconsideration:
1. Fix or replace the pinned SDK image.
2. Run a `$0` preflight proving the base suite and grader tests actually execute.
3. Reclassify the existing patches on repaired DEV infrastructure without tuning to hidden output.
4. Only then simulate the supplied YAML through base and recorded boolean patches; require both a duplicate-route and no-matching-endpoint witness.
5. Kill or defer the program if a clean DEV fixture cannot distinguish loop placement.
## 6. Prerequisite defect and accounting track

These items remain in the combined plan because later product or benchmark work would otherwise be misinterpreted. They are **not** product levers and must not be counted as sweet wins.
- **D1. Repair or remove the ungradeable YARP cell family:** **Evidence:** all 12 per-rollout grading logs are 84 lines and stop at `A compatible .NET SDK was not found` for `10.0.100-preview.3.25201.16`; zero tests execute.
- **Action later:** pin a compatible image/SDK, require a parsed base-suite verdict, and regenerate gradeability status. Until then, report the task as ungradeable rather than never-solved.
- **Effect:** measurement validity only; Q1 remains blocked.
- **D2. Make codex `run_tests` completion server-enforced:** **Evidence:** codex Apple sweet r0 received two yielded `run_tests` results with empty output, specifically `Script running with cell ID N / Wall time 11.0 seconds / Output:`. It never issued `write_stdin`, then claimed tests completed successfully. Yield-before-completion appears in 14 codex task-arm cells across eight tasks, although the FRAME already specifies `yield_time_ms=300000`.
- **Action later:** force the long yield/blocking behavior in the runner or return a handle that the harness itself must resolve before another model step. Do not rely on another prompt sentence; the FRAME already specifies the wait.
- **Gate:** every task×arm preflight must return a parsed terminal verdict or become ineligible.
- **Effect:** both arms; zero head-to-head differential, mandatory validity repair.
- **D3. Detect and quarantine Claude decoding degeneration:** **Evidence:** at least five Claude rollouts contain role-tag/repetition degeneration. Pytask sweet r0 emitted rejected edit payloads around 127,666 bytes and cost `$0.0464` versus its sibling's `$0.0066`. Dashbitco sweet r0 wrote corrupted multilingual/role-tag content into source. Markers also appear in Dart sweet, Akinsho native, and YARP native.
- **Action later:** reject pathological payloads before filesystem mutation, record a structured degeneration flag, and separate affected costs from ordinary agent behavior. A runner-wide detector applies to both arms; P7/`ss-edit` may add sweet-side defense in depth.
- **Effect:** measurement and safety; do not count removed noise as a product saving.
- **D4. Fix `ss-grep --in` multi-scope handling:** **Evidence:** codex Dashbitco sweet passed both the library and test file to `ss-grep ... --in lib/nimble_options.ex test/nimble_options_test.exs`, but the result header showed only `(scope: --in lib/nimble_options.ex)`. The exact-string oracle was silently omitted.
- **Action later:** support repeated/file-list scopes or reject ambiguous multiple values loudly. Add boundary validation and focused tests for files, directories, spaces, and traversal safety.
- **Effect:** sweet correctness defect. Claim no solve improvement until DEV evidence exists.
- **D5. Restore cross-file `ss-trace` edges:** **Evidence:** Python/pytask, Lua/Akinsho, and TypeScript/Teleport traces reported same-file fallback scans. On pytask, missing callers in `report.py`, `build.py`, and `graph.py` include two literal `sys.exc_info()` flows and helped native choose the winning contract.
- **Action later:** diagnose per-language extraction/index persistence, verify edge completeness on the affected repositories, and make fallback status prominent. P1 must test this repair before adding a dependency corpus.
- **Effect:** sweet correctness and possibly resolution, but no forecast until isolated.
- **D6. Repair or explicitly exclude empty-issue tasks:** **Evidence:** mransan's statement has zero usable characters and its gold change spans 19 files. Opencode sweet responds once with a clarification request and uses zero tools; native random-walks at 6–10× the cost; neither solves. The inspected opencode pair cost `$0.000858` sweet versus `$0.005646` native, and excluding this task changes the headline opencode delta from −17.8% to −13.8%.
- **Action later:** repair the task statement or exclude it at task-admission time. Until then, keep a publication caveat because the refusal flatters sweet's cost.
- **Effect:** task validity; a refusal floor is not a product lever.
- **D7. Include Claude subagent spend in every cost ledger:** **Evidence:** native used subagents in 8 of 17 task-arm cells, 121 requests and `$0.0319` off-ledger; sweet used them in 2, 35 requests and `$0.0098`. Repricing moves Claude from a raw sweet loss of roughly 2.2–2.4% to a sweet advantage of about 3.0% (`$0.43639` native versus `$0.42322` sweet).
- **Action later:** merge sidechain usage by parent rollout, validate request/token attribution, and publish raw plus fully loaded cost. Account for P7 local compute in the same spirit.
- **Effect:** scoreboard repair only; never list as a product saving.
## 7. Benchmark replacement specification

Fable B9 is retained as a measurement plan, not as a sweet candidate. The current 17-task run is too sensitive to single micro-decisions and environment defects to adjudicate small improvements.
Before the next benchmark:
1. **Preflight every task×harness.** Base dependencies install; canonical tests execute; grading tests execute; the runner returns a parsed terminal verdict. Missing results make the cell ineligible rather than failed.
2. **Repair or remove YARP and mransan.** Do not carry known invalid tasks into the next denominator.
3. **Count reps honestly.** Report per-rep outcomes, task-level aggregation, and instability. Do not treat any-rep success as a robust product win.
4. **Charge all execution.** Include Claude sidechains and, for P7, local GPU/CPU/energy. Continue to report API spend separately so the mechanism remains legible.
5. **Flag degeneration rather than average it silently.** Publish raw, flagged, and sensitivity views; never curate flags by arm outcome.
6. **Recruit tasks from the observed separating populations:** installed/external contracts, mirrored families/state machines, new-artifact public APIs, runtime surface contracts, and oracle-pinned behavior. These measure the proposed capabilities rather than generic search.
7. **Keep retrieval controls.** A resolution mechanism must not regress solve or retrieval on tasks where sweet already works.
8. **Preserve benchmark discipline.** Iterate only on stratified DEV/rotated fresh tasks. Keep `HO2` frozen and aggregate-only after treatment freeze. Never inspect a held-out failure and tune to it.
9. **Add fresh-repository credibility.** Before release, include 20–30 hand-authored tasks/queries on a public repository not used during development, with declared sample size and seed where a split applies.
Removing YARP alone changes the displayed task denominator to 16 but does not create a product win: codex remains native 9 versus sweet 10; opencode and claude-code remain 9 versus 9.
## 8. Consolidated discard log

These ideas remain recorded so a later planning session does not rediscover and relabel them.

| Discarded move | Trace-grounded reason |
|---|---|
| Search-time sibling or mirror widening | Apple already showed both methods in the first sweet result; Underscore twins were already in one span. Ambient presence did not produce action. P2 instead derives residue from the agent's own diff. |
| Return the Ocean slice more compactly | Sweet's first result already exposed `kernel_vars` and declaration removal. Reformatting the same information is banned and does not change the repair loop. |
| Stale-test annotation or “ignore this assertion” doctrine | FRAME delivery has zero differential and generic red-test override is unsafe. P3 requires independent behavior evidence rather than a label. |
| Faster first edit or a tighter edit-scope guard | Akinsho sweet edited earlier, stayed green, and failed; native's broader wrong patch created four failures that enabled repair. |
| Auto-refuse, add a refusal floor, or force work on vague issues | Mransan cannot support a valid solve as specified. Refusal flatters cost; forced work burns cost. Repair task admission instead. |
| Put the YARP architecture rule in a prompt | Native's subagent already stated the right rule and the main agent still chose the wrong loop-local guard. A computed cardinality witness is required, after the environment is fixed. |
| Inline linked URL/spec content into the shared prompt | FRAME content reaches both arms and yields zero differential. Use a sweet-only labeled corpus and operation if the evidence survives P1/P4 gates. |
| Strengthen the existing sibling/completeness doctrine | The sweet guide already says a first matching site is not enough; Claude ignored it while codex obeyed it. More wording is not the binding constraint. |
| Pack more probes into codex calls | Native's lower call count partly reflects `sed && sed && rg` envelope packing, not less work. The turn-packing surface is already swept and can damage dependent probes. |
| Prompt codex to poll `run_tests` | The FRAME already mandates the wait and the agent ignored it. D2 is a server/runner obligation. |
| Static type-only contract verification | Codeception's decisive properties are enumerability and deferred order; P6 must execute the runtime surface. |
## 9. Later execution plan with hard gates

### Phase 0 — repair evidence integrity before evaluating product ideas

No paid run is meaningful until:
- D1 YARP gradeability is fixed or the task is removed;
- D2 produces terminal parsed test verdicts;
- D7 includes subagent usage;
- D3 marks degeneration consistently;
- D4 and D5 are reproduced and have scoped repair plans;
- mransan is repaired or excluded.
This phase is infrastructure/correctness work. It must not be reported as sweet winning more tasks or costing less.
### W0 — zero-cost candidate falsification

Run these analyses only on existing artifacts, DEV, or genuinely fresh tasks:

| Gate | Required `$0` output | Kill condition |
|---|---|---|
| P1 dependency closure | pinned-source availability map, pytask source query, repaired caller-edge result, blind-spot trigger census | source/behavior cannot adjudicate contracts or the model has no demonstrated intent to consult it |
| P2 residue audit | replay over 102 sweet diffs with solved-cell noise distribution | misses `countBy` or produces an unusably noisy terminal list |
| P3 witnesses/finish | three independently authored witnesses; six Dashbitco delta replays; 27 solved-cell negative controls | needs hidden/gold facts or mislabels a solved-cell failure as stale |
| P4 spec/state | four Apple paths, all wrong-patch rejections, citation harvest across 17 repos | state semantics require per-project hand coding or fewer than two useful cited contracts exist |
| P5 artifact graph | DEV manifest comparison for accepted new-file APIs | depends on future commit knowledge or routinely chooses the wrong owner |
| P6 runtime surface | replay against all recorded Codeception patches | cannot derive the contract from public runtime/source evidence |
| Q1 cardinality | repaired YARP preflight and distinguishing concrete fixture | tests still do not execute or fixture cannot distinguish loop placement |
| P7 forge | first-edit checkpoint/addressability census excluding YARP from the primary estimate, Dart/Teleport impact output, edit-fumble count | <30% dollar addressability at a 50% local-saving assumption |
No candidate advances merely because it can explain the benchmark after seeing hidden grading.
### Phase 1 — narrow implementation order after W0 approval

Recommended order, subject to explicit approval:
1. Repair D4/D5 because they are existing sweet correctness defects and directly affect P1/P3.
2. Prototype the smallest `ss-deps` corpus for one pinned Python environment.
3. Prototype string-normalized P2 residue replay before structural-twin machinery.
4. Select **one** of P3, P4, P5, or P6 based on the strongest W0 rejection evidence; do not build all domain analyzers in parallel by default.
5. Keep Q1 parked until a clean YARP fixture exists.
6. Advance P7 only if the addressability threshold supports a 15% total move after local compute.
Every implementation must follow the owning bounded context, keep persistence/I/O behind adapters, validate command inputs and file paths, use parameterized storage, and add real integration tests for database behavior.
### Phase 2 — conditional paid micro-confirmation

Fable proposed the following smallest next-dollar design, preserved here as a proposal rather than authorization:
- tasks: pytask for P1 and Underscore for P2;
- arms: native and sweet;
- reps: two;
- harnesses: codex, opencode, and claude-code;
- total: `2 tasks × 2 arms × 2 reps × 3 harnesses = 24 rollouts`;
- matched caps and fully loaded cost accounting;
- pre-registered expectations: pytask flips on at least one of opencode/claude-code, Underscore flips on claude-code, and no control solve regresses.
Before approving that design, add rotated DEV/fresh negative controls so “no control regression” is actually measurable. Therefore **24 is not yet the final authorized rollout count**. The control task count, resulting total, dollar budget, hashes, and stop conditions remain unresolved and must not be invented. Do not use `HO2`. Freeze code, prompts, task list, images, hashes, goldens, budget, and stop conditions; require an explicit user `GO` before spending.
### Phase 3 — domination confirmation and release gate

A treatment is promotable only if:
1. sweet resolves **more** tasks than native on every harness, with per-rep robustness rather than a single lucky cell;
2. sweet is cheaper on every harness using fully loaded cost, and a product cost claim reaches the pre-registered materiality threshold;
3. no robust sweet solve or retrieval-quality control regresses;
4. no task is ungradeable, verdict-null, degeneration-corrupted, or silently missing test output;
5. DEV/fresh treatment is frozen before any held-out run;
6. held-out results are aggregate-only, with sample sizes, split seed, and task exclusions reported.
Until Phase 0 and W0 pass, the verdict remains **NO-GO for a paid pilot**.
## 10. Portfolio arithmetic and non-additivity

Candidate ceilings are alternatives and overlaps, not an additive forecast.
- **Smallest resolution path:** P1 robustly flips pytask on opencode and claude-code, producing sweet 10 versus native 9 on all three harnesses.
- **Independent broad margin:** P4 Apple, P5 Bingo, or P6 Codeception each has a conditional +1-task ceiling on every harness, but each requires its own DEV/fresh proof.
- **Claude-specific margin:** P2 adds Underscore on claude-code if the residue trigger generalizes.
- **Rep stabilization:** P3 targets the unstable Dashbitco and Akinsho decisions; stabilization does not automatically add another task under the existing any-rep aggregation.
- **Overlap:** P3's general runtime witness includes P6-shaped behavior; do not add both Codeception ceilings. P2 mirror residue supports P4 but does not independently earn Apple. P1 source and behavior paths are fallbacks for the same contract, not two pytask flips.
- **Invalid ceiling:** Q1's YARP arithmetic remains quarantined and cannot support any published portfolio until the task is regraded successfully.
- **Cost:** P7 is the only retained candidate with a direct 15%+ product-cost thesis. D7 can correct the scoreboard, and P7's `ss-edit`/impact components may close the raw Claude gap, but neither substitutes for the P7 materiality gate.
The most credible ordering is therefore: repair measurement → falsify P1 and P2 → implement the smallest surviving resolution mechanism → prove one robust flip → pursue P7 only if its W0 addressability survives.
## 11. Source-to-merged proposal map

This table is the preservation audit. Every candidate from both source documents remains either a primary program, an explicit component, a quarantined program, or a benchmark prerequisite.

| Source proposal | Preserved at | Disposition |
|---|---|---|
| Original 1 — issue-to-executable-spec compiler | P3 | primary moonshot capability |
| Original 2 — state-machine model checker | P4 | primary gated capability |
| Original 3 — artifact-graph authoring | P5 | primary gated capability |
| Original 4 — runtime public-surface conformance | P6 | primary gated capability and P3 adapter |
| Original 5 — dependency behavior emulator | P1 | moonshot fallback after source/caller checks |
| Original 6 — data/cardinality simulation | Q1 | preserved, quarantined behind YARP repair |
| Original 7 — local multi-patch forge | P7 | primary cost moonshot |
| Fable B1 — installed dependency source | P1 | lead gated resolution mechanism |
| Fable B2 — terminal family residue | P2 | primary gated resolution mechanism |
| Fable B3 — blind-spot escrow | P1 and P3 | trigger component; no standalone ceiling |
| Fable B4 — evidence-closure deliverable | P3 | moonshot completion component |
| Fable B5 — cited-reference corpus | P4 | moonshot normative-evidence component |
| Fable B6 — anchored `ss-edit` | P7 | forge infrastructure; below standalone cost bar |
| Fable B7 — structured oracle extraction | P3 | gated witness/finish adapter; no standalone flip |
| Fable B8 — pre-API impact preview | P7 | forge heuristic and W0 probe; below standalone cost bar |
| Fable B9 — benchmark re-spec | §7 and Phase 0 | measurement plan, not a sweet lever |
All six Fable defects are retained in D1–D6. The prior subagent-accounting defect is retained as D7. All source discard ideas are represented in §8, with duplicates consolidated by mechanism.
## 12. Class, moonshot, vehicle, and safety audit

**Class distribution:** Counting the preserved source mechanisms rather than hiding components inside composite names:

| §0.5 or new class | Retained mechanisms | Count/status |
|---|---|---:|
| retrieval expansion / sibling-finding | `ss-deps`, cited-reference corpus | 2 |
| result rendering / compaction | none | 0 |
| prompt / memory doctrine | blind-spot escrow, pre-API impact trigger | 2 |
| verification / annotation | terminal family-residue audit | 1 |
| guards / limits | none as product candidates | 0 |
| ranking tweaks | none | 0 |
| cache / prefix | none | 0 |
| NEW — dependency behavior experimentation | `ss-dep-probe` | retained |
| NEW — issue-to-executable-spec compilation | `ss-witness` | retained |
| NEW — oracle extraction | `ss-oracle` | retained as component |
| NEW — terminal deliverable gate | `ss-finish` | retained as component |
| NEW — state-space model checking | `ss-statecheck` | retained |
| NEW — artifact-graph authoring | `ss-author-api` | retained |
| NEW — runtime public-surface conformance | `ss-surface-probe` | retained |
| NEW — data/cardinality simulation | `ss-cardinality` | quarantined |
| NEW — mutation surface | `ss-edit` | retained as component |
| NEW — local repair execution | patch forge | retained |
| NEW — benchmark replacement spec | measurement plan | retained outside product slate |
No existing §0.5 row has more than two retained proposals. More than four mechanisms fit no existing row.
**Mandatory moonshot tier:** The merged plan retains four mechanically coherent moonshots:
1. version-matched dependency behavior experimentation in P1;
2. general executable-witness/evidence closure in P3;
3. cited-reference closure in P4;
4. local repair tournaments in P7.
Each states build cost, necessary conditions, a plausible full-task or 15%+ ceiling, and a zero-cost falsifier. Smaller mechanisms are not padded into moonshots.
**Trace-only evidence quota:** The portfolio materially exceeds the requirement for three trace-only candidates:
- P1 depends on the exact callback guesses and failed attempts to inspect pytest.
- P2 depends on the edited `groupBy` stem remaining in `countBy` at completion.
- P3 depends on the same Dashbitco failure producing opposite second edits and outcomes.
- P4 depends on a one-quadrant edit despite both sibling operations being visible.
- P5 depends on all agents authoring into an existing file while required modules were absent.
- P6 depends on the enumerable-to-non-enumerable retreat and wrong ownership choice.
- P7 depends on Ocean post-localization wandering and Dart's nine-file self-revert.
These are sequence facts unavailable from aggregate rows alone.
- **Banned-move audit:** **No compaction candidate:** no primary program merely presents the same information more compactly. P1 changes the corpus/observability; P2 derives facts from a diff; P3/P4/P6 execute or model behavior; P5 authors missing code; P7 performs the repair loop.
- **No benchmark-only product candidate:** hidden tests and grader patches diagnose the historical failures but are not runtime inputs. P3 explicitly requires issue/base/public evidence. Benchmark repair is labeled separately in §7.
- **No FRAME pseudo-differential:** every product program is sweet-only. Shared runner fixes are labeled zero differential. M± additions remain general and are delivery hooks, not benchmark answers.
- **No held-out tuning:** all proposed falsifiers use existing artifacts, DEV, or fresh tasks. `HO2` remains frozen.
- **Solve and cost audit:** Solve is a veto for every cost claim.
- P1, P2, P4, P5, and P6 have explicit full-task ceilings.
- P3's adapters with zero standalone ceilings are honestly components; its general witness compiler must prove a full-task flip.
- P7 alone carries the 15%+ product-cost requirement.
- D1–D7 and §7 repair measurement and are never counted as product gains.
## 13. Final decision

This synthesis preserves the strongest practical finding from Fable—the installed dependency contract—and the broader resolution/cost capabilities from the original slate. It also retains every smaller suggestion in the role its evidence supports, instead of discarding useful mechanisms or overstating them as independent wins.
Immediate priority for a later authorized session:
1. repair D1, D2, and D7 so the scoreboard is trustworthy;
2. run the `$0` P1 and P2 falsifiers;
3. reproduce and scope D4/D5;
4. choose one additional resolution program from P3–P6 based on W0 evidence;
5. run the P7 addressability audit before designing any cost implementation.
Until those steps pass and the user explicitly authorizes spend: **NO-GO for implementation-backed claims and NO-GO for a paid pilot.**
