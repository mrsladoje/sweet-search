# c02 — adversarial verify, HISTORY lens

Candidate: **Structured `ss-*` surface for opencode (plugin intercept / custom tools), MCP as
the far vehicle — reopens A4.** Verifier lens: has this been tried, gated, or killed under
another name?

---

## 0. Verdict

**Refuted as filed. Confidence 0.70.** The mechanism is register row A4. A4 has a written
revival condition with two parts: an owner decision **and** the W0.c chain-rework census. The
candidate satisfies only the first part. It flags the owner decision; it does not run W0.c, and
it does not name W0.c anywhere.

A second, harder problem: the programme already killed this mechanism **once on measurement**,
not only by owner decision, and the candidate's register check never mentions that kill.
`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §20 closes with the sentence *"MCP first-class
ss-* tools would only change counting, not turns — deprioritized."* `TURN_PACKING_FINAL.md` §0
row 5 records the same judgement as *"envelope form = counting"*, and its closed list names
*"MCP-for-packing absent a W0.c/W0.a gate signal"*. The candidate cites none of these.

The candidate **can** escape that measured kill, and I say below exactly why. But it does not
make the escape argument, its headline ceiling is 2.8–3.1× the number its own sources call
honest, its "parity plus byte advantage" arithmetic double-counts, and two of its three vehicles
turn net-negative once the tool-schema prefix is priced. A survivor must earn it. This one has
not.

What should survive is smaller and differently worded. I give that wording in §5.

---

## 1. The recorded kill the candidate does not address

`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §19–§20 (local repo,
`eval/task-completion-bench/`):

- §19 records the origin of the idea, in the owner's own words: *"OpenCode enforces parallel
  tool calls on its FIRST-CLASS tools … sweet's ss-* are bash-hidden so likely invisible to
  that machinery — explains native 1.64 vs sweet 0.98 calls/turn. Test: mimic OpenCode's batch
  wording in frame, or expose ss-* as first-class tools (MCP path)."*
- §20 then answers it: *"Native satisfies it with multiple bash/grep ENVELOPES per message;
  sweet satisfies it with one bash envelope that &&-CHAINS several ss-* ops (the measured 84%).
  … The native-1.64 vs sweet-0.98 calls/turn 'gap' is therefore substantially a COUNTING
  artifact … MCP first-class ss-* tools would only change counting, not turns —
  deprioritized."* `[M]` on the retired Grok-era run.

So the mechanism has been proposed, measured against, and deprioritized under the name **"MCP
first-class ss-* tools"**. The register carries only the softer `OWNER-EXCLUDED` label for A4
and does not carry §20's sentence. The candidate inherits that gap.

## 2. Why the escape is real, and how far it reaches

The §20 kill rests on one number: **84% of sweet's `ss-*`-bearing bash calls already chain two
or more operations** `[M` retired run, `TURN-ECONOMY-2026-07-30.md:352`, quoted in
`TURN_PACKING_FINAL.md` §1.1`]`. On the current backbone and pool that number is false.

| measurement | value | source |
|---|---:|---|
| `ss-*` envelopes chaining ≥2 `ss-*` operations, opencode sweet | **7.4%** (53 of 712) | `[M]` `forensics/opencode-calls-per-request.md` §2–3 |
| same, independent re-derivation | **6.4%** (43 of 673) | `[M]` `research/structured-vs-shell-parallelism.md` §5.2 |
| the 08-28 "20.8% chain" figure | an artefact of splitting on `\|` inside quoted regex | `[M]` both documents above |
| operations per request, opencode | native **1.578** vs sweet **1.208** | `[M]` `opencode-calls-per-request.md` §2 |
| operations per rollout, opencode | native **25.74** vs sweet **23.79** | `[M]` same |

Sweet performs **fewer** operations in **more** requests. At the operation level the gap is
−23.4%, not zero. The counting-artifact defence therefore does not transfer from the Grok-era
run to the luna fresh pool. **This escape is valid and measured.** It is the single strongest
thing in the candidate's favour, and the candidate never states it.

Consequence for the gate, which cuts the other way. W0.c is defined in `TURN_PACKING_FINAL.md`
§3 as a count of chain rework: class 1 is `&&` short-circuit (the tail never runs and the next
turn re-issues it), class 2 is `;` output concatenation. The same fresh-pool census that frees
the candidate from §20 also empties W0.c: at most 53 chained envelopes per 66 rollouts, with
`;` joiners at 3 of 76 `[M]`. **W0.c's first limb will not fire.** The gate's second limb (W0.a
decision-time-independent operations that a schema envelope could pack where a chain cannot) is
the one that must carry the candidate, and its measured value is 1.23 requests per rollout, not
3.87 (§3).

## 3. The headline ceiling does not survive its own sources

The candidate leads with **−10.1% to −12.7%** for opencode. Its own cited documents rank the
estimators:

| estimator | requests saved / rollout | value | source |
|---|---:|---:|---|
| all requests at native's global width | 5.60 | −18.4% | `[M]` `opencode-calls-per-request.md` §6 A1 — *"the wrong estimator"* |
| pre-edit `ss-*` envelopes at native's pre-edit density 2.657 | 3.87 | −12.7% | `[M+I]` `candidates/cost-structural.md` §3.3 |
| retrieval calls at native's retrieval density 2.370 | 3.43 | −10.1% to −12.7% | `[M+I]` `structured-vs-shell-parallelism.md` §4.1 |
| consecutive exploration runs at native's pooled width | 3.06 | −11.1%, prefix-only −8.4% | `[M]` `opencode-calls-per-request.md` §6 B3 |
| **dependency-strict** (a search never merges with the reads after it) | **1.23** | **−4.5%, prefix-only −3.4%** | `[M]` same, B1+B2 |
| the pattern actually observed (runs of single `ss-read` requests) | 0.53–0.68 | −2.2% to −2.8% | `[M]` same, C1/C2 |

The gap between 3.87 and 1.23 is one behavioural assumption: that the model, given a structured
surface, will also start reading files speculatively **alongside** a search, the way native does
with `[glob,glob,grep]` then `[read,read,read,read]`. A tool-surface change cannot buy that
assumption. Only merging of consecutive same-kind retrieval requests follows from the surface
alone, and that is the 1.23 row.

`opencode-calls-per-request.md` §6 states the outcome plainly: the dependency-strict figure
*"would move sweet from +3.3% to about −1.3% against native; the speculative figure to about
−8%"* `[M]`.

**Arithmetic error to correct.** The candidate writes *"honest expectation parity (−3.2%) plus
byte advantage up to −8%"*. These do not stack. Sweet already carries whatever byte advantage
exists on opencode and is **still** +3.3% dearer ($0.009265 against $0.008968 per rollout,
`[M]` BRIEF §1). The −8% figure **is** the speculative-merge outcome, not a separate byte term
added to parity. Stacking them would publish −11.2% for a mechanism whose safe value is −1.3%.

## 4. Two vehicles die on the tool-schema prefix; one does not

The candidate's own forensics lists this as unfinished: *"the prefix cost of adding a structured
tool schema was not priced"* `[M]` `opencode-calls-per-request.md` §10(b). I priced it.

Opencode sweet: 19.70 requests per rollout, cell $0.009265, luna prices $0.10/M ingest and
$0.01/M cache read `[M]` BRIEF §1.1 and `opencode-calls-per-request.md` §1.

| added prefix | cost / rollout | share of the opencode sweet cell |
|---:|---:|---:|
| 500 tokens (the candidate's own kill line) | $0.000143 | **1.55%** |
| 1,000 tokens | $0.000287 | **3.10%** |
| 1,428 tokens | $0.000410 | **4.42%** |
| 2,307 tokens | $0.000662 | **7.15%** |
| 2,653 tokens | $0.000761 | **8.22%** |

`[M]` arithmetic in this report; `[C]` the token counts below.

Anchors for the token counts:

- `[C]` I read `mcp/server.js` myself. It registers exactly **eight** tools — `search`, `trace`,
  `index`, `health`, `repo-map`, `vocab-prewarm`, `read`, `read-semantic`. **There is no `grep`
  and no `find`.** The candidate's claim is correct. Their definition blocks (description plus
  parameter descriptions, source form) total 9,229 characters ≈ **2,307 tokens**; a four-tool
  subset (`search`, `read`, `read-semantic`, `trace`) is 5,713 characters ≈ **1,428 tokens**.
- `[M]` Register row B17 priced three claude-code tool schemas at **758 tokens**, about 253
  tokens per tool, and killed the reverse lever (removing schemas) because the prize sat below
  its own kill line.

The decisive fact against vehicle (c). The candidate's kill condition (b) allows added schemas
only *"without an equal guide cut"*. The one worked example of moving sweet to a structured
surface is the shipped Model Context Protocol guide variant, and it goes the **wrong way**:
`[C]` `core/prompt-optimization/data/p7-final/sweet-search-system-prompt-mcp.md` is **1,257
words** against the command-line variant's **1,016 words**, **+23.7%**. Moving to a structured
surface has historically **grown** the prompt, not shrunk it. Under vehicle (c) the opencode
prefix therefore grows by roughly 2,307 schema tokens plus about 346 guide tokens ≈ 2,653
tokens ≈ **8.2% of the cell**, against a dependency-safe saving of 4.5%. **Vehicle (c) is
net-negative on opencode at the honest ceiling.**

`[C]` Independent confirmation that the guide variant is untrusted: the memory note
`project_mcp_nocli_contact_surface.md` records the MCP prompt as `benchmarked: false` in its own
front matter, *"needs a P7 eval through MCP before it can be trusted as equivalent to the CLI
champion."*

Vehicle (b), custom tool files in `.opencode/tool/`, sits between 1.55% and 4.42% depending on
how terse the descriptions are. At any plausible size it consumes 35% to 100% of the
dependency-safe saving.

**Vehicle (a), the plugin intercept, escapes this entirely.** It adds no schema; it rewrites the
arguments and output of tools opencode already ships. That is the candidate's best design
choice, and my pricing does not touch it. Vehicle (a) is the only part of c02 that is not
arithmetically self-defeating.

## 5. What survives, and how the synthesis must word it

Rewrite c02 as a single-vehicle, single-harness, parity-class item:

> **Opencode plugin intercept only.** A project plugin rewrites the arguments and output of
> opencode's own `read`, `grep` and `glob` so the sweet arm keeps the harness's structured
> emission habit while results come from the index. Opencode only. Codex zero. Claude-code
> **not addressed** — it has no output-rewriting hook `[C]`, and the MCP route is net-negative
> once schemas and the larger guide are priced. Dependency-safe ceiling **−4.5%** of the
> opencode sweet cell (prefix-only −3.4%), which moves opencode from **+3.3% to about −1.3%**
> `[M]`. The −10.1% to −12.7% figure is an upper bound that also requires the model to begin
> speculative reading; no `$0` evidence supports that. Vehicles (b) and (c) are dropped on
> price. Reopening still needs the owner decision **and** the W0.c chain-rework census, which
> is the second limb of `TURN_PACKING_FINAL.md` §3, and which nobody has run.

## 6. Four further history facts the synthesis must carry

1. **The causal premise cannot be separated at $0, and the record holds a counter-example.**
   The candidate's own forensics says so: *"it cannot be separated at $0 from 'the model simply
   likes read'"* `[M]` `opencode-calls-per-request.md` §7 item 2. The counter-example is
   stronger than the candidate admits. On claude-code the **same** Bash tool sits in a
   multi-call request 3.5% of the time in the sweet main thread (1,139 calls) and 41.3% inside
   sweet subagents (385 calls) — a 12× swing with tool identity held constant `[M]`
   `structured-vs-shell-parallelism.md` §3. And the tool that is **told** to batch batches least:
   claude-code's Bash description carries an explicit parallel instruction and reaches 13.5%,
   while Read carries none and reaches 35.1% `[M/C]` same section. The candidate uses this to
   retire the claude-code branch. It also weakens the opencode branch, and the candidate does
   not say so.
2. **The codex zero is a bench misconfiguration, not a property of codex.** Codex 0.146.1 ships
   `core/src/tools/parallel.rs` and a model catalogue in which every model carries
   `"supports_parallel_tool_calls": true` `[C]`, but the run's model string `openai/gpt-5.6-luna`
   does not match the catalogue slug, so the catalogue was never applied `[M]`
   `structured-vs-shell-parallelism.md` §0.1 and §5.3. The same mismatch is why codex truncated
   at about 2,500 tokens instead of the catalogue's 10,000. If the slug is ever fixed, **native**
   gains parallel emission on codex and sweet, on Bash, does not. The candidate's phrase "codex
   0.0 by construction" should read "codex 0.0 while a bench misconfiguration holds, with the
   risk one-sided against sweet".
3. **Vehicle (a) needs a hermeticity guard weakened for one arm.** `[C]` I read
   `eval/task-completion-bench/harness/opencode-task-runner.mjs` lines 69–77 and 94–102:
   `validateMainOpencodePreflight` throws `'ambient OpenCode plugin detected'` whenever
   `resolved.plugin.length !== 0`, and `buildMainOpencodeConfig` writes `plugin: []`. That guard
   exists to keep the harness hermetic. Admitting a plugin for the sweet arm alone is a
   benchmark-validity change, and register row D2 is DEAD for a related reason: *"The apply
   surface is harness-owned."*
4. **The 11% fall-through is confirmed.** `[M]` `candidates/cost-structural.md` §3.3: of native's
   975 structured calls, 106 come after the first edit (39 `grep`, 62 `read`, 5 `glob`) and must
   be handed back to the native tool because the index cannot see same-rollout edits (register
   E3). The candidate reports this honestly.

## 7. Denominators, and what I could not finish

- Opencode fresh pool: 66 native rows and 66 sweet TAB rows, 22 tasks × 3 reps, from
  `fp-opencode-tab-20260826` plus the 11 repair tasks from `rp-oc-tab-20260827` `[M]`.
- Codex: 132 sessions, 2,406 tool calls, 2,406 requests, both arms `[M]`.
- Claude-code main thread: sweet Bash 1,139 calls, native Bash 584, native Read 709 `[M]`.
- Solve, all harnesses pooled: native 125/198, sweet 120/198, no cell clearing the ±6 bar `[M]`
  BRIEF §1. c02 does not change solve in any measured way, and its solve risk is unmeasured.
- **Not finished.** I did not open the box. Every number above comes from the local repository:
  the slate-c forensics and research documents, the register, the turn-economy programme
  documents, `mcp/server.js`, the two guide variants, and `opencode-task-runner.mjs`. I did not
  re-run the opencode request census myself, so the 7.4% / 6.4% chain rates and the 1.23 / 3.06
  / 3.43 / 3.87 request counts are carried from the two slate-c documents with their tags. I did
  not price vehicle (a)'s effect on the tool guide, which could shrink once the model stops
  calling `ss-*` by name; that is a real unclaimed upside and it collides with register B3
  (dropping the guide, PARKED, needs a user decision). I did not verify the
  `1,014 / 3,273` `ss-grep` plus `ss-find` operation census, which lives on the box.

## 8. Files and paths opened

- `eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/DEAD-LEVER-REGISTER-DRAFT.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/register/DEAD-LEVER-REGISTER.md` (§0.1, §1 rows A1–A13, §2 rows B16–B17, §4 row D2, §12.4 item 19)
- `eval/task-completion-bench/handoffs/improve/slate-c/register/reader-turn-economy.md` §A4
- `eval/task-completion-bench/handoffs/improve/slate-c/candidates/DEDUP.md` (c02 entry, lines 63–76)
- `eval/task-completion-bench/handoffs/improve/slate-c/candidates/cost-structural.md` §3.3
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/opencode-calls-per-request.md` §1–10
- `eval/task-completion-bench/handoffs/improve/slate-c/research/structured-vs-shell-parallelism.md` §0, §3, §4, §5
- `eval/task-completion-bench/TURN_PACKING_FINAL.md` §0, §1.1, §3 (W0.c), §8
- `eval/task-completion-bench/TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §19, §19.1, §20
- `eval/task-completion-bench/harness/opencode-task-runner.mjs` lines 60–102
- `mcp/server.js` lines 155–345
- `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` and `-mcp.md`
- `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/memory/project_mcp_nocli_contact_surface.md`
