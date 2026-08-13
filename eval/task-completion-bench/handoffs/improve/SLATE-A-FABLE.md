# SLATE A (Fable 5) — cost-first, from full-trace reading

**Session:** A · **Lens:** COST first, resolution second · **Spend: $0.** Read-only on the box; no
rollouts launched; nothing in `results/` mutated; HO2 untouched. All quotes below come from the raw
traces via `dump-trace.mjs` or from raw-JSONL decoding, never from `trajectories/`.

**Headline discoveries, before the slate:**

1. **One of the six "never-solved" tasks is unsolvable by construction.** Every one of the 12
   `dotnet__yarp-2825` grading runs dies with a missing .NET SDK before a single test executes, and
   the ledger records it as `gradeable=True, f2pFrac=0`. The agents' patches are near-gold. This is a
   grading-oracle outage recorded as a model failure. (Defect D-1 below.)
2. **Sweet's entire net solve advantage (one task, one harness) is a coin flip on one token.** All
   six `pytask-dev__pytask-210` cells wrote the same fix and differ only in the argument passed to a
   callable: `exc_info` solves, `frame` or `()` fails. The reference that settles the choice is
   unreachable by any means in the rollout environment — one native rep tried five distinct
   verification routes and every one failed. (Finding F-A2, moonshot M-2.)
3. **Sweet pays two measurable mechanical taxes that native does not**, both invisible to
   aggregates: a systematic off-by-one-space Edit-anchor failure on claude-code caused by ss-read's
   `NNN| ` gutter (20 failures, all with the same signature), and a span-nibbling pattern on small
   files that inflates codex turn count (94 collapsible calls across the three harnesses). These two
   are the concrete content of "sweet reaches its first edit 44% sooner and wins nothing." (Levers
   L-1, L-2.)

---

## 1. The inversion (§5a): how I would make NATIVE crush SWEET, from these traces

1. **Exploit shell composability.** Native packs several probes into one call:
   `sed -n '1,115p' lib/nimble_options.ex; sed -n '160,190p' ...` and
   `pwd && rg --files | head -80 && run_tests` (codex dashbitco native rep0, calls 1 and 3). One
   turn, three probes. Sweet issues one ss command per call and its own "unread below … continue:
   ss-read …" trailer *invites* the next call. On codex, where turns are the cost driver, native
   wins turn count by construction. I would lean harder into multi-span sed/rg chains.
2. **Exploit anchor fidelity.** Native's Read renders `75\t…` — the exact format claude-code's Edit
   training strips. ss-read renders `75| …`, and the model absorbs the gutter's trailing space into
   `old_string`: 20 sweet anchor failures vs 7 native, 14 of 14 sampled failures showing the exact
   lead=N fail → lead=N−1 success signature. I would keep feeding sweet spans and watch it burn
   late-episode turns on retries.
3. **Exploit off-ledger subagents on claude-code.** Native delegates exploration to sidechains in
   8/17 cells; the ledger charges none of it (F-1, already verified by the prior session). Until the
   accounting is fixed, delegation is free money for native.
4. **Exploit whole-file completeness.** Native reading a whole 508-line file sees the docs list, the
   `@basic_types` list and the `validate_type` family in one view. Sweet's six nibbles of the same
   file fragment the picture across six turns.
5. **Exploit sweet's honesty on vague tasks.** On the zero-character `mransan` issue, native digs
   (14-22 calls) and sweet declines (0 calls opencode; explore-then-no-edit claude-code). Neither
   scores, but if partial credit ever exists, digging collects it and declining cannot.

Each of these inverts into slate content: (1)→L-2, (2)→L-1 and M-1, (3)→republish under F-1,
(4)→L-2's solve-side upside, (5)→reported as a caveat, deliberately NOT a lever (discard #1).

---

## 2. Trace log (§5e)

**Read end to end (8):**
1. codex / pytask-210 / sweet / rep0 — full, every message and result
2. codex / pytask-210 / native / rep0 — full
3. claude-code / pytask-210 / native / rep1 — full error paths (the five failed verification
   attempts, the four contract flip-flops)
4. claude-code / dashbitco-43 / sweet / rep1 — full, twice (tools-only pass + full pass with
   thinking and final message) — the only solving rep of this task anywhere
5. claude-code / dart-http-1114 / sweet / rep0 — all 73 calls, error anatomy
6. claude-code / dart-http-1114 / native / rep0 — structured skim, call-type census
7. opencode / mransan-202 / sweet / rep0 — full (it is one message)
8. codex / dashbitco-43 / sweet rep0+rep1 and native rep0+rep1 — complete call-by-call command
   listing for all four rollouts

**Structured partial reads:** claude-code mransan sweet (final message + call census), claude-code
akinsho native (call census), codex yarp sweet (run_tests output decode), apple/yarp/pytask final
patches for all 6 cells each, all 12 yarp grading logs, all 102 grading logs (bootstrap-failure
sweep).

**Dataset-wide measurements built this session (all $0, all reproducible):**
- Edit-failure taxonomy by arm on claude-code, deduped by tool_use_id (native 106 errors: 68
  `pages`-param, 18 bad-path, 7 anchor; sweet 46: 20 anchor, 6 pages, 7 bad-path).
- Failed→succeeded anchor-pair diff: 14/14 sampled sweet pairs are the off-by-one-space signature.
- ss-read nibble census (same file ≤600 lines, ≥2 reads): codex 34 collapsible calls, opencode 26,
  claude-code 34; on claude-code the nibbles fetched MORE lines (4,481) than whole-file-once would
  (4,126).
- Opencode bash decomposition: sweet's non-ss bash is exactly run_tests (74) + git diff/status (47).
- Grading-log bootstrap sweep: yarp = SDK-missing in all 12 logs; no other task affected (mransan's
  log is a build wall on a task with a 0-char problem statement).

### Ideas generated and DISCARDED, with the trace fact that killed each (§5e)

1. **Never-zero-edits guard (anti-surrender doctrine).** Killed: exposure is exactly `mransan`
   (0-char statement); all six native attempts produced WRONG-LOC patches (0 solves); attempting
   costs 6-8x the refusal ($0.0057-0.0087 vs $0.0009). The lever can only raise sweet's cost and can
   never win the task. Report the cost-flattering caveat (F-3) instead.
2. **Rollout-time reference fetch (ss-web / WebFetch allowlist).** Killed: the bench bans network by
   design (the runner instruction text lists "curl, wget, git fetch/clone/pull, and package
   installs"), and the one observed WebFetch attempt (claude-code pytask native rep1) returned
   "Unable to verify if domain github.com is safe to fetch." A lever that assumes rollout-time
   network dies on the bench and on real enterprise sandboxes alike. Its index-time form survives as
   moonshot M-2.
3. **Git-diff absorber (ss-owned compact self-state).** Killed: git diff/status counts are
   arm-identical (native 46, sweet 47 on opencode) — zero differential — and its mechanism is
   "present the same information more compactly," banned move #1.
4. **Insertion-position oracle (suggest where a new enum member goes).** Killed: the deciding
   evidence was already in sweet's context in the failing cell — codex sweet's call 4 (`ss-read
   lib/nimble_options.ex 155 190`) displayed `:atom,` directly above `:non_neg_integer,` — and the
   model still inserted `:integer` after `:boolean`. Evidence in context does not change the choice;
   this is the same ground on which Sibling-Site Echo died.
5. **Mirror-switch echo (apple's send/receive symmetry).** Killed: structurally identical to the
   dead sibling/structural-closure class; both codex arms' patches edit within ~25 lines of the
   mirrored `sendPushPromise` switch (native's patch even rewrites the comment above the receive
   case list) and neither arm touched the mirror. In-context adjacency was already insufficient.

---

## 3. Defects first (not levers — they change the scoreboard, not the agent)

### D-1. The yarp grading oracle never runs: 12 auto-failed cells recorded as model failures · NEW, verified

**What is wrong.** Every `dotnet__yarp-2825` grading log (all 3 harnesses × 2 arms × 2 reps, 12
logs, each 3,505 bytes) ends:

```
The command could not be loaded, possibly because:
  * You intended to execute a .NET application: The application 'test' does not exist.
Requested SDK version: 10.0.100-preview.3.25201.16
global.json file: /yarp/global.json
Installed SDKs:            <-- empty
```

No test ever executes. Yet `rows.json` records `gradeable=True, f2pFrac=0` for all 12 cells. The
**rollout** environment is fine — the agent-side `run_tests` in the same cells ran the real suite
("[run_tests baseline-diff] 26 PRE-EXISTING failure(s)…", WebSocketTests executing). The rollout
image and the grading image are different environments, and only the grading one is broken.

**Why it matters.** (a) The handoff's resolution analysis counts yarp among the three
"perfect-localization, never-solved" tasks that anchor the "resolution floor" story. It is not
evidence of any model floor. (b) All six cells produced essentially the gold fix — the same
`routeAdded` guard at the same site, differing from gold only in declaring the guard one loop level
higher (gold: `var isRoutePresent = false;` inside `foreach (var subset …)`; every agent: outside
it). Their patches kept the visible suite green in-rollout. With a working grader, yarp plausibly
grades SOLVED for both arms in some or all cells. (c) A false-failure task adds 12 rollouts of pure
cost noise to both arms.

**Detection gap.** The bootstrap sweep that found this is three lines of grep: a grading log with
zero test-result lines and a `gradeable=True` row is a contradiction. The green-ledger invariant
covers the rollout env; it does not currently assert "the grading log contains test evidence."

**Exact next step ($0 + one cheap regrade).** Add a grader-side tripwire: `gradeable=False` unless
the log contains at least one framework result line. Fix the grading image SDK (or pin
`global.json`), regrade the 12 existing yarp patches from `preds-*.jsonl` — no new rollouts needed —
and republish the solve table. Effect on the head-to-head: solve is expected to move for BOTH arms
symmetrically (all six cells wrote the same fix), so this is scoreboard integrity, not a sweet win.
State it that way.

**Effect on cost/solve:** cost unchanged; solve table changes for both arms; the "6 never-solved"
denominator becomes 5.

### D-2. (Confirmation of known F-1/F-3, from traces.) The claude-code subagent exclusion and the
mransan refusal both checked out exactly as the prior session recorded them; I add one new
quantum: **native also wastes 68 calls on a claude-code Read-tool quirk** (`Invalid pages
parameter: ""`), 11x sweet's 6, because native Reads 10x more. Part of native's claude-code bill is
a harness parameter bug, not retrieval work. Fold this into any claude-code cost narrative: the
claude-code comparison is currently noisy in both directions for non-product reasons.

---

## 4. The slate (ranked)

### L-1. Anchor-fidelity read rendering: make ss-read output byte-safe for exact-match editors
- **Class:** result rendering (§0.5 row 2) — declared. **Why it is not dead for the same reason the
  six dead rendering levers are:** every dead rendering lever changed how much or how densely
  content renders (density, elision, ceilings). This changes zero content and zero length; it fixes
  a **byte-level contract violation** between ss-read's gutter and claude-code's exact-string Edit
  tool, with a measured 20-failure error class attached. It is a defect fix with benchmark-visible
  cost, like F-2 but with nonzero benchmark value.
- **Tier:** GATED.
- **Trace evidence.** claude-code dart-http sweet rep0: five consecutive files show first-Edit
  failure at lead=N spaces → success at N−1 — e.g. call `fu288gIpwa…` `old_string`
  `"       this.request,"` (7 spaces) → `String to replace not found` → call `w6oqUkmtiNMfnLllg…`
  `"      this.headers…"` (6 spaces) → success. Dashbitco sweet rep1 (the solving rep): docs edit
  fails at 5 spaces, succeeds at 4; `@basic_types` edit fails twice at 5, succeeds at 4. Dataset:
  20 sweet anchor failures vs 7 native; 14/14 sampled sweet pairs show the exact off-by-one
  signature. Mechanism confirmed in source: `eval/agent-read-workflows/bin/_ss-helpers.mjs:559`
  renders `` `${startAt + i}| ${ln}` `` — pipe + one space, visually fused with the file's own
  indentation. The harness Read the model is trained on renders `75\t…` (tab-delimited, seen
  verbatim in the same traces). Codex is immune (apply_patch fuzzy-matches: 0 failures in 107
  applies), opencode near-immune (4 vs 6).
- **Mechanism.** One-line renderer change in the agent-format read path: emit
  `String(lineNo).padStart(width) + "\t" + line` (mirror `cat -n`), or gutter-free body with a line
  map in the header. Apply to ss-read and any ss-search/ss-grep block that models quote as anchors.
  Agent formats only; human CLI output untouched (keeps `feedback_keep_search_modes`).
- **Vehicle and differential.** Sweet-only (ss renderer). Differential is real and lands entirely on
  the sweet arm; nothing is shared with native.
- **Ceiling arithmetic.** 20 anchor failures + observed recovery overhead (each failure is 1 wasted
  call, and in the traced cells 0-2 further wasted calls: a re-Read, a second failed retry) ≈ 30-45
  wasted calls of sweet's ~670 claude-code calls = **4.5-6.7% of sweet claude-code turns**,
  concentrated late in episodes where per-turn cost is maximal, and concentrated in sweet's worst
  cell (dart-http claude-code +46.7%, where rep0 alone burned ~10 failures + retries ≈ 27% of its
  73 calls). Honest dollar band: **~4-7% of sweet's claude-code spend; ~0% on codex/opencode.**
  Below the 15% bar alone — this is a stacking component and a defect fix, priced honestly.
- **Cheapest $0 falsifier.** Replay: regenerate the recorded ss-read outputs with the new gutter,
  then re-derive every failed `old_string` by applying the model's observed copy rule (take the
  visible post-gutter text) — if the derived anchors now byte-match the files, the mechanism is
  fixed; if the 7 native failures share the signature, the gutter is not the cause (it is generic
  drift) and the lever dies.
- **Solve effect.** ≥0 by construction (it removes an error class; content unchanged). No claimed
  flip. Watch item: none — this cannot remove information.

### L-2. Whole-file-on-first-touch: ss-read returns the entire file when it is small
- **Class:** **NEW CLASS — probe granularity.** No §0.5 row changes *what a read returns*: the
  rendering row changed formatting of the same result; "symbol-complete first read" (dead) widened
  spans to symbol boundaries mid-file and died on unbounded forward-widening (153-273 lines per
  widening). This is bounded by total file size and replaces measured, already-observed repeat calls
  1:1. It is also not the dead "coalesced lookups" (that was model-side call packing via prompts —
  the packing surface; this changes tool semantics so there is nothing left to pack).
- **Tier:** GATED.
- **Trace evidence.** codex dashbitco sweet rep0/rep1 (the +52% cost cell): six separate ss-read
  calls into the same 508-line `lib/nimble_options.ex` — spans 320-355, 155-190, 55-105, 490-505,
  350-392, 300-352 — six turns to view ~half the file, while codex native's call 3 is
  `sed -n '1,115p' lib/nimble_options.ex; sed -n '160,190p' lib/nimble_options.ex` — two spans, one
  turn. The prior session's finding I-2 already attributed ~90% of this cell's +52% to "sweet made
  12.5 tool calls vs native's 6.5"; the nibble census now shows what those extra calls are. Sweet's
  own unread-trailer ("# unread below (93-508)… continue: ss-read …", quoted verbatim in the
  dashbitco trace) actively invites the next nibble.
- **Measured exposure (this session, all sweet rollouts):** same-file ≤600-line nibble groups —
  codex 19 groups / **34 collapsible calls**; opencode 16 / **26**; claude-code 18 / **34**. Byte
  tradeoff: codex nibbles fetched 4,723 lines vs 5,529 whole-file (+17% bytes for −34 calls);
  **claude-code nibbles fetched 4,481 lines vs 4,126 whole-file — whole-file-once is fewer calls
  AND fewer bytes** (overlapping spans re-fetch the same lines).
- **Mechanism.** In the agent format only: on the first ss-read of a file with ≤600 lines (tunable),
  return the whole file with a header saying so; subsequent ss-reads of that file return only spans
  not yet served. Big files keep today's span behavior. No ranking signal involved; no
  `_isAgentFormat` ranking-gate exposure (it is a read path, but gate on agent format anyway by
  policy).
- **Vehicle and differential.** Sweet-only tool semantics. Native cannot mirror it (its Read already
  reads whole files — that is precisely the behavior being matched; the differential is that sweet
  currently does WORSE than native here and stops doing so).
- **Ceiling arithmetic.** Turn reduction: codex 34/317 sweet calls ≈ **1.0 call per rollout ≈ 8-11%
  of codex sweet turns** (12.1 → ~11.1); opencode 26 calls ≈ 4.5% of turns; claude-code 34 ≈ 5%.
  Priced at average per-call cost (upper bound, since nibbles sit early-mid episode): codex sweet
  $0.0080 × ~9% ≈ **$0.0007/rollout ≈ 9% of codex sweet spend**; ~4% opencode; ~4-5% claude-code.
  It directly attacks the two worst codex regression cells (dashbitco +52%, statamic/teleport
  short-trajectory cells where per-call overhead dominates). Honest band: **5-9% codex, 3-5% the
  other two.** Again a stacking component, not a 15% headline alone.
- **Cheapest $0 falsifier.** Already half-run (the census above). Completing it: for each nibble
  group, verify from the trace that the later spans' content was actually used (edited or quoted) —
  if the model nibbles because it *wants* narrow context and would not have used the rest, serving
  the whole file adds bytes without removing calls. Falsified if, replaying whole-file-first against
  the recorded groups, the estimated byte cost exceeds the per-turn overhead saved on codex
  (per-turn uncached ~4.5-5.3K tokens at $0.10/M plus output regeneration).
- **Solve effect.** ≥0 expected: strictly more context per read, no removal. Plausible small upside
  on completeness misses (the codex dashbitco cell nibbled around the docs list and the
  `@basic_types` list in different turns and chose a docs-relative insertion anchor in the code
  list) — claimed as ZERO for gating purposes.

### M-1. MOONSHOT — ss-edit: index-addressed structural editing (stop shipping string anchors at all)
- **Class:** **NEW CLASS — edit addressing.** No §0.5 row touches editing; the seven dead rows are
  all on the read/verify/prompt side. This changes what the agent is asked to produce (edit
  *addresses*, not edit *anchors*).
- **Tier:** MOONSHOT (feasibility filters suspended per §5c).
- **Trace evidence.** The same 20-failure anchor class as L-1, plus the dart-http rep0 anatomy: 25
  Edit calls to land ~10 hunks, failures recurring per-file as the model re-guesses whitespace per
  file; plus dashbitco rep1's `File does not exist` path-typo failure (`…r1--16` for `…r1__16`) —
  the whole category of address-transcription fragility. Codex's zero-failure apply_patch (fuzzy
  context match) is the existence proof that a more forgiving edit contract eliminates the class.
- **Mechanism.** `ss-edit <file> --symbol <name> [--occurrence N] --replace-body|--insert-after
  <member>|--patch -` : the index (tree-sitter chunker already knows symbol spans) resolves the
  address to exact bytes, applies the change atomically, and returns the unified diff of what
  actually changed. The model never reconstructs whitespace; stale-anchor drift after earlier edits
  disappears (symbol addresses survive edits; string anchors do not). Delivered in the sweet arm as
  the preferred editor; harness Edit remains available.
- **Vehicle and differential.** Sweet-only capability. Native structurally cannot do this: it has no
  symbol index to resolve addresses against. This is the "exploit what native cannot do" candidate
  on the cost side.
- **What it would take / what must be true.** Real build: symbol-addressed edit engine over the
  existing tree-sitter chunk index (languages already covered by FILE_PATTERNS), address-collision
  rules, dry-run mode. It works if (a) models reliably emit symbol names they just read (they do —
  every ss-trace/ss-read header prints them), and (b) harnesses allow a custom editor to coexist
  with their native one (they do — it is a CLI, same as ss-read today).
- **Ceiling arithmetic (honest).** Removes the L-1 class (4-7% claude-code) plus the address-drift
  retries L-1 cannot fix (failed→failed→re-Read→retry chains in dart rep0: ~8 further calls), plus
  it decouples editing from full-span reading (edit-by-address needs a pointer read, not a 60-line
  span) — combined **8-12% of sweet claude-code spend, 0-3% elsewhere**, and it is the enabling
  substrate for pointer-tier reads to go further later. Solve: ≥0 (removes failure modes); a real
  solve claim would be speculative and is not made.
- **Cheapest $0 falsifier (for the gated core).** From the 20 recorded failures: resolve each
  intended edit to a symbol address using the current index offline; if ≥90% of the failed edits are
  unambiguously addressable (unique symbol + position), the addressing scheme covers the observed
  failure class. If models' intended sites are frequently sub-symbol and ambiguous, the scheme dies.

### M-2. MOONSHOT — dependency-source index tier: carry the reference corpus offline
- **Class:** **NEW CLASS — corpus boundary.** The dead retrieval-expansion row expands *within* the
  repo working tree. This changes which corpus exists at all. ("Dep-Source Reach" on the dead list
  was killed at "exposure 0" as a same-corpus retrieval widening; the exposure metric there counted
  sweet-side retrieval opportunities. The trace record now shows the exposure was real but lived in
  the *other arm's failed attempts*: five distinct dependency-lookup attempts in one native rep
  alone. I flag the tension honestly rather than pretending the dead-list entry does not exist; the
  mechanism proposed here — index-time corpus acquisition, not rollout-time reach — is also
  different from what was gated.)
- **Tier:** MOONSHOT.
- **Trace evidence (the strongest single quote-chain in this slate).** `pytask-dev__pytask-210` is
  decided in all six cells by one token — what the callable receives:

  | cell | wrote | solved |
  |---|---|---|
  | codex native | `is_hidden = is_hidden(frame)` | 0/2 |
  | codex sweet | `is_hidden = is_hidden(exc_info)` | **2/2** |
  | opencode native | `is_hidden = is_hidden(exc_info)` | 1/2 |
  | opencode sweet | `is_hidden = is_hidden()` | 0/2 |
  | claude-code native | `is_hidden = is_hidden(exc_info)` (rep0) | 1/2 |
  | claude-code sweet | `is_hidden = is_hidden(frame)` | 0/2 |

  The issue text links the settling reference
  (`pytest/blob/…/src/_pytest/_code/code.py#L271`). claude-code native rep1 tried to verify five
  ways and every route failed: `python` (`command not found`), `python3 -c "import _pytest…"`
  (`ModuleNotFoundError`), `grep -R "def _is_hidden" /usr/local/lib/python*` (empty),
  `find / -path '*/_pytest/_code/code.py'` (**empty — the file does not exist on the agent-visible
  filesystem**), and `WebFetch` of the exact URL ("Unable to verify if domain github.com is safe to
  fetch"). It then flip-flopped `is_hidden(frame)` → `is_hidden()` → `(frame)` → `()` across ~10
  Edit calls (37 calls total vs 27 for the rep that guessed right first) and failed. **The
  contract-ambiguity is also a cost bug: the rep that could not verify burned 37% more calls.**
  Codex sweet's correct guess came from ss-trace making the in-file `exc_info` threading salient
  ("The callable should follow pytest's contract: it receives the exception-info object… I'm
  threading the existing `exc_info` tuple through" — assistant, before its first patch). That is
  retrieval nudging a guess; it is not verification, and the same sweet arm guessed wrong on the
  other two harnesses.
- **Mechanism.** At index time (network-legal: the same phase that builds images and installs
  dependencies), resolve the project's declared dependencies and index their *sources* as a separate
  searchable tier (`ss-search --deps`, auto-triggered when a query names a package that is a
  declared dependency, gated to agent formats). At rollout time the reference is served offline from
  the index. In the product this is dependency-aware code search (jump into pytest/lodash/serde
  sources); in the bench it is the only legal route to the reference, since rollout-time network is
  banned by design.
- **Vehicle and differential.** Sweet-only capability; native structurally cannot reach files that
  are not on the filesystem (`find /` proved the absence) and cannot use the network (by bench
  design and enterprise reality).
- **What must be true / build cost.** Index-time dependency resolution per ecosystem (pip/npm/hex/
  cargo/pub…), a size-bounded source tier (top-N direct deps), and the retrieval gate from repo
  guidance (`opts._isAgentFormat`) to keep GCSN safe. Weeks, not days.
- **Ceiling arithmetic (honest).** On THIS 17-task set: pytask is the one clean decisive case
  (**+1 task on 2 of 3 harnesses if the sweet cell verifies instead of guessing** — sweet already
  wins it on codex by luck), plus a half-case (dart-http's `headersSplitValues` splitter is
  RFC-6265-derived; the issue cites the RFC; the gold regex encodes its token grammar — reference
  access plausibly upgrades the splitter but scope-control still has to be survived). So: **ceiling
  ≈ 1, maybe 2 tasks of 17 — and it converts sweet's only solve "advantage" from a coin flip into a
  mechanism.** Cost effect: removes contract-thrash (the 37-vs-27-call spread on pytask; ~0.5-1% of
  total spend — small). This is the resolution-lens candidate; at n=17 one deterministic task is at
  the edge of measurability, which is exactly why it is a moonshot and not a gated lever.
- **Cheapest $0 falsifier.** Corpus audit over the 17 issues + gold patches: count tasks whose
  deciding ambiguity (the token that separates solved from failed patches) is settled by text
  outside the working tree (dependency source, cited spec/RFC, linked implementation). I count 2
  (pytask decisive, dart partial) from the traces read; if a full audit of the failed cells finds no
  third, the on-bench ceiling is confirmed at 1-2 and the case rests on product value plus future
  task sets.

### M-3. MOONSHOT — turn-0 dossier: run retrieval before the first model turn
- **Class:** **NEW CLASS — retrieval timing** ("when retrieval happens at all," §0.5's own widening
  list). No dead lever moved retrieval off the model's turn clock.
- **Tier:** MOONSHOT.
- **Trace evidence.** Every sweet rollout opens with the same shape: 1-2 ss-search + 2-4 ss-read
  before the first edit (dashbitco codex rep0 calls 1-4; dashbitco claude rep1 calls 1-5; pytask
  codex sweet calls 2-4). Mean steps-to-first-edit: claude-code sweet 11.4, opencode 17.0, codex
  9.3. These are model turns spent issuing queries whose *inputs* (the issue text) exist before the
  episode starts. The index can run its own localization pass — search on the issue text, expand
  once through the existing graph, render the top files/symbols — and deliver it as part of turn-1
  input, cutting the query-issuing turns (not the reading) out of the loop.
- **Mechanism.** At episode start, sweet computes a task dossier (no LLM: query = issue text;
  existing hybrid search + 2-hop expansion, which is already few-ms per the perf record) and injects
  it as a tool-result-shaped block in the first user turn. The agent starts at the "I have
  candidates, now read/verify" stage. Guard: on empty/garbage problem statements (mransan) the
  dossier degrades to a repo map instead of noise.
- **Vehicle and differential.** Sweet-only (native has no index to precompute with). FRAME risk is
  the classification: if the operator rules that pre-computed task context is "task framing," it
  must go to both arms and the differential dies — but native has nothing to precompute WITH, so a
  fair both-arms rule ("each arm may precompute with its own tools at $0 model cost") still yields a
  sweet-only artifact. This classification question must be settled by the operator first, exactly
  like the Stale-Oracle delivery-rule question in the prior ledger.
- **Ceiling arithmetic.** If the dossier replaces even half the pre-edit query turns: claude-code
  sweet 11.4 → ~7, i.e. **~4 turns ≈ 20% of turns**; but they are the *cheapest* turns
  (short context), so the dollar effect is smaller than the turn effect: bounding with the turn-1
  input sizes and growth rates from the cost table, ~8-14% of sweet spend on the verbose harnesses,
  ~5% on codex. The honest risk side: pushed context the model did not ask for may be ignored
  (the completeness-card and type-inlining levers died partly on "pushed rows ignored" — that
  precedent cuts against this lever and is why it sits in the moonshot tier, not gated).
- **Cheapest $0 falsifier (weak — flagged).** Requires per-task indexes to replay searches; the
  boxes' run workdirs are cleaned, so the honest falsifier is a rebuilt index for 2-3 tasks (still
  $0 model spend, some compute). Falsified if the issue-text search fails to rank the eventual
  first-edit file in top-5 for the majority of solved rollouts (i.e., the dossier would not have
  contained what the agent actually needed).

### Not-a-lever findings that belong in the published record

1. **The pytask contract coin flip** (M-2's table) should be attached to any solve headline: sweet's
   codex 10-vs-9 rests on it. At this margin, per-harness solve deltas are guesses, not signal.
2. **The head-start giveback is now itemized.** Sweet's −44% steps-to-first-edit on claude-code
   coexists with an arm-similar post-edit tail (native 29.5−20.2 ≈ 9.3 calls after first edit; sweet
   19.7−11.4 ≈ 8.3). The tail is run_tests cycles + finalize for both arms; sweet's tail
   additionally carries the anchor-retry mass (L-1). Sweet wins the opening and gives back the
   margin in mechanics, then both arms pay the same verification tail.
3. **Sweet's undisplaced opencode bash is exactly run_tests (74) + git diff/status (47).** There is
   no hidden third workload for ss-* to absorb; the displacement story is complete and the remaining
   bash is either FRAME-level (run_tests) or arm-identical (git self-state).
4. **The claude-code Read `pages` quirk** (68 wasted native calls, 6 sweet) is a harness bug
   inflating native's claude-code cost; if it gets fixed upstream, expect native's claude-code
   number to improve ~2-4% with no product change on either side. Do not let a future rerun
   read that as a sweet regression.

---

## 5. Self-audit (§5b quotas)

| quota | requirement | this slate |
|---|---|---|
| per-class cap | ≤2 per §0.5 row | rendering row: 1 (L-1). All other rows: 0. ✔ |
| outside the swept surface | ≥4 fitting NO §0.5 row | L-2 (probe granularity), M-1 (edit addressing), M-2 (corpus boundary), M-3 (retrieval timing) = 4 ✔ |
| moonshots | ≥2 | M-1, M-2, M-3 = 3 ✔ |
| trace-only candidates | ≥3, with quoted turns | L-1 (quoted anchor pairs), L-2 (quoted nibble spans), M-2 (quoted five-way verification failure + the six-cell one-token table), D-1 (quoted SDK log) ✔ |
| banned move 1 (compaction) | none | L-1 changes a delimiter, not density; L-2 *increases* served bytes on codex; no candidate reduces rendered information ✔ |
| banned move 2 (grading artifacts) | none | D-1 *fixes* a grading artifact and is filed as a defect, not a lever; no lever depends on hidden-test mechanics ✔ |
| discards | ≥3 with killing trace fact | 5 listed ✔ |

**Honest bottom line against the goal (cheaper AND more resolving, all three harnesses).**
Cost: with F-1's accounting fix (prior session) plus D-2's caveat context, the corrected baseline is
already codex −6.5% / opencode −13.8% (ex-mransan) / claude-code ≈ −3%. Stacking L-1 + L-2 adds
roughly 4-7% + 3-5% on claude-code, ~9% on codex, ~4% on opencode — enough to put **every harness in
the −8% to −17% band**, which is at the edge of provable at n=17 and provable with one more rep set.
Resolution: on THIS task set the honest ceiling for any sweet-side mechanism is 1-2 tasks, and M-2
is the only candidate that converts an existing coin flip into a mechanism rather than betting on a
new one; D-1's regrade probably lifts both arms' absolute solve by one task. Solve domination on
all three harnesses is not reachable from these 17 tasks by any lever in any class I could ground in
traces — it needs either the M-2 class built for real, or a task set whose failures are not
(a) authoring, (b) spec-dead, (c) infra-dead, or (d) single-token contract coin flips. Saying
otherwise would be the aggregate-reasoning failure this handoff exists to prevent.
