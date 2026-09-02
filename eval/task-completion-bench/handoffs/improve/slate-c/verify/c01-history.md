# c01 — adversarial verify, HISTORY lens

Candidate: **Remove the harness plan tool in the sweet arm through the config files `ss init`
writes.** Verifier lens: history. Date: 2026-09-02. Cost of this work: `$0` (trace reading,
static binary inspection, register reading, web reading; no model rollouts).

## 0. Verdict

**Refuted as a head-to-head lever. Confidence 0.72.** The measurement is new and sound; the
lever is not. Three recorded facts kill it.

1. **The vehicle class is register row B17 (DEAD), and c01 reproduces B17's killing argument
   rather than escaping it.** B17 is "stop shipping the harness's own tool schemas on the sweet
   arm". Its register verdict line reads `shared harness config, zero differential once measured
   correctly`, and the fact that closed it was fairness: "applied honestly to **both** arms it
   moves claude-code the **wrong way**". c01 states the same inversion in its own ceiling field
   (codex +1.8%, opencode +5.4% against sweet). B17 died on size *and* on fairness; c01 escapes
   the size half and inherits the fairness half whole.
2. **Two of the three legs have a vendor expiry, already merged.** Codex PR #41744 ("Make the
   `update_plan` tool opt-in", merged 2026-08-31, shipped in 0.152.0) defaults
   `tools.update_plan.enabled` to `false` **and removes the bundled planning guidance from the
   prompts when the tool is disabled**. Claude Code 2.1.233 makes `TodoWrite` and the four Task
   tools unavailable by default on Opus 4.8, Sonnet 5, Fable 5, Mythos 5 and newer. Both changes
   land in **both** arms. On the two harnesses where the vendor has acted, the differential is a
   pin artifact with a known end date, not a sweet feature.
3. **"Zero solve effect assumed" contradicts the register.** Row P3 (commitment-quality prompts,
   *including* a plan-reflect variant) is PARKED with a **positive** measured micro-smoke: one
   task flipped 0/2 → 2/2 and another produced its first-ever sweet solve, and the traced root
   cause of both original losses was commitment quality, not localization. The only evidence c01
   offers against a solve effect is a within-arm association that its own author labels
   "a confounded within-arm reading, not a causal one".

The candidate is honest about item 1 and flags `needs_user_decision`. That honesty does not make
it a survivor. Under the history lens the recorded doctrine is consistent and one-directional:
this program removes arm asymmetries that flatter sweet (row G7), and refuses to book shared or
arm-universal floor cuts as sweet wins (rows A10, D4a, F13, F14, F16).

**What I am not claiming.** The plan-tool *class* is genuinely new as a priced object. I verified
that. I also verified three of c01's contested mechanism facts and they hold. My refutation is
about what the saving *is*, not about whether it exists.

---

## 1. Register check, done by grep and by reading

`[M]` `DEAD-LEVER-REGISTER.md` (93,467 bytes, 123 rows) contains **zero** occurrences of
`update_plan`, `todowrite`, `TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList` or the bare word
`todo` (case-insensitive grep). The only occurrence of any planning word is row P3's
"plan-reflect".

`[M]` Across the whole prior corpus — `handoffs/improve/*.md`, `handoffs/*/*.md`,
`TURN_FIX_PLAN.md`, `TURN_PACKING_FINAL.md`, `PLAN.md` — the only file naming a plan tool is
`handoffs/improve/W0-P3-GATE-RESULTS.md:262`, and there it is a **measurement trap**, not a
lever: an opencode `todowrite` whose text says "Run baseline test suite with run_tests" was being
miscounted as a test run.

**So c01's `register_check` claim "no row names the plan tool" is correct.** The class is new.

### 1.1 The nearest row is B17, and it is the one that matters

`DEAD-LEVER-REGISTER.md` §2 row **B17 — redundant-tool retirement — DEAD**:

> `[M]` The exact live API request Claude Code 2.1.218 sends was captured: Grep and Glob schemas
> **do not exist in it** (24-tool roster) … The genuinely removable set is three tools = 758
> tokens = $0.0034, below the proposer's own kill line, and applied fairly to both arms it moves
> claude-code the wrong way (+2.38% → +2.92%).
> `sweet-only?` column: **shared harness config, zero differential once measured correctly.**

Source text, `RUN-LEDGER.md` lines 337–346:

> The first refuter added the fairness point: applied honestly to **both** arms it moves
> claude-code the **wrong way**, because native runs 20.0 turns to sweet's 17.7, so a shared
> prefix token is worth more to native.

B17 was **proposed as sweet-arm-only** ("in the sweet arm", via runner configuration, prose
explicitly disclaimed) and the register still classified its vehicle as shared harness config with
zero differential. That is the precedent that covers c01. B17 had two independent kills: a size
kill and a fairness kill. c01 defeats the size kill — its object is 3.8–3.9 requests per rollout,
not 758 prefix tokens — and walks straight into the fairness kill.

### 1.2 The fairness arithmetic, re-derived

`[M+I]` From `BRIEF.md` §1 and `forensics/verify-tail.md` §5, applying the same removal to both
arms:

| harness | native after | sweet after | sweet vs native after | before |
|---|---:|---:|---:|---:|
| codex | $0.012287 − $0.001615 = $0.010672 | $0.012330 − $0.001469 = $0.010861 | **+1.77%** | +0.3% |
| opencode | $0.008968 − $0.001132 = $0.007836 | $0.009265 − $0.001006 = $0.008259 | **+5.40%** | +3.3% |
| claude-code | $0.021558 − $0.000605 = $0.020953 | $0.020727 − $0.000606 = $0.020121 | **−3.97%** | −3.9% |

Native calls the plan tool slightly more than sweet in all six cells (codex 4.14 against 3.92,
opencode 3.92 against 3.79, claude-code 2.05 against 1.91 requests per rollout `[M verify-tail
§5]`). The lever therefore helps native more than sweet. **The entire head-to-head gain of c01 is
produced by withholding the setting from the control arm.** c01's own
`why_native_cannot_match` field concedes this in one sentence: "It can adopt the same config, at
which point the differential is zero."

### 1.3 The program's own precedent for asymmetries that flatter sweet

`[M]` Register row **G7** — invented run-directory absolute-path transcription tax. A harness-level
artifact cost "native 12.66% of arm spend against sweet 5.29%, contributing 7.4 points to the
claude arm delta — the same size as the `pages` tax, **in sweet's favour**". The response on the
record was **to remove the asymmetry**: arm-blind directory names plus a regression test asserting
the arm string never appears. c01 proposes the opposite move on an artifact of the same size.

`[M]` Rows **A10** (`never book as a sweet win`), **D4a** (a harness-defect fix that improves
native "must never be described as a sweet regression"), **F13** (`shared — ship as product
correctness, never claim as a sweet win`), **F14**, **F16** and **F12** all record the same rule.
`BRIEF.md` rule 6 states it as doctrine. c01 escapes rule 6's *letter*, because the setting is
deliberately not shared. It does not escape the doctrine the rule expresses.

### 1.4 Two more rows that bear on the substitution risk

`[M]` Row **A13** (`run_tests` shim output de-duplication, SHIPPED) is the recorded case of a
suppression lever being routed around: "The agent bypassed it with `--ss-full` in 4/5 rollouts
(14/84 calls); the hint was then removed from the summary because advertising it cost 20/84 calls
re-requesting a transcript already in context." Suppressing a channel the model wants has cost
money before.

`[M]` Row **A6** act 3: a stronger process constraint produced "the same task's longest grind
ever, 62 calls, after five imperative nudges". Constraining process has backfired before.

---

## 2. Vendor expiry — the two legs that are already being closed by the harness authors

### 2.1 Codex (the largest leg, −11.9%)

`[W]` **openai/codex PR #41744, "Make the `update_plan` tool opt-in", merged 2026-08-31**
(https://github.com/openai/codex/pull/41744). Quoted from the PR description:

> Default `tools.update_plan.enabled` to `false`; users can explicitly enable it to expose
> `update_plan`.

and, as an additional modification, the PR **removes bundled planning guidance from the model,
collaboration-mode, multi-agent, compaction, prewarm and goal-continuation prompts when the tool
is disabled**.

Two consequences, and they run in opposite directions.

- **Before #41744 — that is, at the bench pin 0.146.1 — disabling the tool does NOT remove the
  planning prompt.** The prompt-stripping is what the PR *adds*. `[M]` The recorded
  `session_meta.base_instructions` of `fp-codex-tab-20260826` is 20,751 characters and names
  `update_plan` **9 times** (c01 says 8), including a 5-paragraph `## Planning` section that opens
  "You have access to an `update_plan` tool …". So at the pin the sweet arm would be told nine
  times to call a tool it does not have. c01 lists this in `falsifier_zero_dollar` as `FALSE codex
  0.146.1` and then keeps codex −11.9% as its headline anyway. That is the candidate's one
  internal inconsistency, and it sits on the leg that makes it rank 1.
- **After 0.152.0 the tool is off by default in both arms.** The differential goes to zero without
  anyone shipping anything, and `research/harness-changelogs.md` trap T7 adds that a codex run on
  0.152 is not comparable with one on 0.146.1 at the dollar level, under the register's own
  "never pool runs across a shipped fix" rule.

### 2.2 Claude-code (the smallest leg, −2.9%)

`[W]` Claude Code **2.1.233**: `TodoWrite`, `TaskCreate`, `TaskGet`, `TaskUpdate` and `TaskList`
are not available on Opus 4.8, Sonnet 5, Fable 5, Mythos 5 and newer unless the user exports
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. Anthropic's stated reason is that those models track multi-step
work without a written checklist and the definitions cost context. A vendor-published example
reports 7 turns → 5, output 2,286 → 1,373 tokens, $0.405 → $0.323.

Two consequences.

- **The direction of c01's cost claim is externally corroborated.** That is a point in the
  candidate's favour and I record it as such.
- **For a real Claude user on a current model the plan tool is already gone.** So the claude-code
  leg is not a sweet-search product feature; it is a bench artifact of running `luna`, which is
  outside the gated model set. `research/harness-changelogs.md` §2.1 says exactly this: "the bench
  keeps a tool block that a real Anthropic-model user no longer has."
- **The vendor's solve-safety evidence does not transfer.** Anthropic's rationale names specific
  Anthropic models. The bench backbone is `openai/gpt-5.6-luna`. Codex 0.146.1's own prompt says a
  plan "helps demonstrate that you've understood the task". c01's `solve_risk` line "Vendor
  defaults point to a small effect" therefore over-reads the vendor evidence.

---

## 3. Mechanism facts I checked, and which way they went

I checked five contested facts. **Three hold, one is corrected in the candidate's favour, one is
newly at risk.**

| # | claim | verdict | evidence |
|---|---|---|---|
| 1 | claude-code's plan tools are `TaskCreate/TaskUpdate/TaskList/TaskGet`, not `TodoWrite` | **HOLDS** | `[M]` Full census of 138 session files in `fp-claudecode-tab-20260826`: native `TaskCreate` 56, `TaskUpdate` 80, `TaskList` 1 (137 blocks); sweet `TaskCreate` 57, `TaskUpdate` 79, `TaskList` 2, `TaskGet` 1 (139 blocks). **`TodoWrite` appears 0 times in either arm.** `Agent` (delegation) is a separate tool: native 33, sweet 11. Denying the four Task tools does not touch delegation. |
| 2 | `[tools.update_plan] enabled=false` parses at codex 0.146.1 | **HOLDS** | `[M]` `codex -c tools.update_plan.enabled=false mcp list` succeeds; `codex -c tools.update_plan=false mcp list` fails with `invalid type: boolean false, expected struct UpdatePlanToolConfig in tools.update_plan`. The struct and its `enabled` field are also present as strings in the pinned binary. |
| 3 | claude-code drops the plan prompt sentence when the tool is absent | **HOLDS, and on the right version** | `[C]` c01 cites 2.1.258; the deployed binary is **2.1.218** (`/root/.local/share/claude/versions/2.1.218`, confirmed by `version` in 40 transcripts). The gating exists at 2.1.218 too: `…t?\`Use ${t} to plan and track work. Mark each task completed as soon as it's done; don't batch.\`:null…`. |
| 4 | deny rules survive `--permission-mode bypassPermissions` | **HOLDS** | `[C]` 2.1.218 string: "permissionMode 'bypassPermissions' auto-approves every tool call (**except explicit deny rules**) before the callback is consulted." |
| 5 | `permissions.deny` removes the tool from the roster (rather than rejecting the call) | **NOT ESTABLISHED — new risk** | `[C]` 2.1.218 ships `--tools` ("Specify the list of available tools from the built-in set") and `--disallowedTools`, and carries the string "Tool search disabled: ToolSearchTool is not **available** (may have been disallowed via `disallowedTools`)". Availability-based removal is proven for `disallowedTools`. Nothing I found proves `permissions.deny` makes `t` null rather than denying at call time. If it denies at call time, the claude-code leg **inverts**: the prompt still says "Use TaskCreate to plan", the model calls it, the call is refused, and sweet pays a wasted request plus a retry. |

`[M]` One further codex fact: `codex features list` at 0.146.1 enumerates 100 flags and **none of
them is a plan or todo flag**, so `--disable` / `features.*` is not an alternative route at the pin.

`[C]` And on the vehicle: `scripts/inject-agent-instructions.js` (455 lines) and
`scripts/write-claude-rules.js` write **only** markdown surfaces today — `AGENTS.md`,
`.claude/rules/sweet-search.md`, `GEMINI.md`, `.cursor/rules/sweet-search.mdc`. Neither writes
`opencode.json`, `.claude/settings.json` or `.codex/config.toml`. c01's vehicle is new product
behaviour, correctly flagged `needs_user_decision`.

---

## 4. The ceiling is roughly half of what is claimed, for a reason no request count can catch

`[I, arithmetic on measured tokens]` The counterfactual price of a removed request is its output
plus one re-send of the cached prefix. For codex sweet: about 290 output tokens (text plus
reasoning) at $0.60 per million is **$0.000174**, and about 20k cached tokens at $0.01 per million
is **$0.0002**. So roughly **47% of the saving is output tokens**, not the prefix re-send.

Codex 0.146.1's base instructions also carry a "Preamble messages" section telling the model to
write text *before* tool calls. If the model stops calling `update_plan` and writes the same
planning sentences as a preamble inside a request it was going to make anyway, then the request
disappears but the output tokens do not. Roughly half the ceiling evaporates, and **c01's
pre-registered kill condition cannot see it**, because that condition counts *text-only non-final
requests*, and relocated preamble text creates no new request.

`[M]` The baseline c01 cites for that condition is also not reproducible from the evidence. The
only measurement I found is `scripts-verify-tail/tail-extras-output.md` §5, which counts text-only
requests **in the tail only**: 3 rollouts of 396 carry extra ones, and the per-cell distributions
above §5 give about 0.23 extra tail text-only requests per rollout for codex sweet. I could not
locate the "0.06" figure the candidate quotes.

---

## 5. Corrections the synthesis must adopt

1. **Re-classify.** c01 is a **shared harness-configuration profile**, not a retrieval lever. Its
   head-to-head number exists only while the control arm is denied a free, publicly documented
   setting. Present it as a product decision with a fairness disclosure, or drop it. Do not put it
   at rank 1 of a cost-lever slate.
2. **Register linkage.** State that c01 inherits **B17's fairness kill** and defeats only B17's
   size kill. Add the **G7** precedent: the program's recorded response to an arm asymmetry worth
   7.4 points in sweet's favour was to delete the asymmetry.
3. **Codex leg.** Say plainly that PR #41744 is **merged (2026-08-31)** and that it both flips the
   default and strips the planning prompt when the tool is off. Therefore: at the pin the prompt is
   *not* stripped, and after 0.152.0 the differential is **zero**. Reconcile the ceiling table with
   `falsifier_zero_dollar`, which already records `FALSE codex 0.146.1`.
4. **Claude-code leg.** Say that 2.1.233 already removed these tools by default for current
   Anthropic models. The leg is a `luna`-pin artifact, not a product feature. Cite the vendor
   example (7→5 turns, $0.405→$0.323) as external corroboration of *direction only*.
5. **Change the claude-code vehicle** from `permissions.deny` to `--disallowedTools` or `--tools`,
   or add a `$0` proof that `permissions.deny` removes availability. Availability-based removal is
   proven for `disallowedTools` at 2.1.218; it is not proven for `permissions.deny`.
6. **Numbers.** `update_plan` appears **9** times in the recorded 0.146.1 base instructions, not 8
   (20,751 characters, `fp-codex-tab-20260826` `session_meta`). Deployed claude-code is **2.1.218**,
   not 2.1.258; the prompt gating cited from 2.1.258 does hold at 2.1.218.
7. **Ceiling.** Halve it, or label it an upper bound that assumes the planning text disappears
   rather than relocating. About 47% of the per-request price is output tokens.
8. **Solve risk.** Replace "zero solve effect assumed" with the register position: **P3 is PARKED
   with a positive plan-reflect micro-smoke**, and `forensics/phase-anatomy.md` §10 states that no
   solve-effect estimate for this mechanism exists. `BRIEF.md` §2.2 adds that fixed-trajectory
   predictions get direction right about as often as not (C-4: replay −2.8%, live +4.8 / +19.8 /
   +11.7%).
9. **Kill condition.** Add one that can see the failure mode: **assistant output tokens per rollout
   must not rise by more than 8%**, alongside the request counts. A request-count-only condition is
   blind to relocated planning text.

## 6. Revised ceiling

Cost, sweet arm only, if the profile is kept asymmetric and the planning text vanishes entirely:
codex −11.6% against native (**expires on the next codex upgrade**), opencode −7.9%, claude-code
−6.7%. If planning text relocates into preambles, roughly half of each. **Applied fairly to both
arms, which is what the register's B17 row demands, the honest numbers are codex +1.8%, opencode
+5.4%, claude-code −4.0% — that is, worse than today on two of three harnesses.** Solve effect:
unmeasured, with the only register evidence pointing the wrong way.

## 7. Evidence checked

Local repo `/Users/admin/Projects/sweet-search-private`:
- `eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/DEAD-LEVER-REGISTER-DRAFT.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/register/DEAD-LEVER-REGISTER.md` (rows A1,
  A5, A6, A10, A13, B2, B3, B16, B17, C8, D4a, E9, F12, F13, F14, F16, G7, H1, P1, P3, T-rows)
- `eval/task-completion-bench/handoffs/improve/RUN-LEDGER.md` lines 270–286, 325–360 (B17 source)
- `eval/task-completion-bench/handoffs/improve/PANEL-SYNTHESIS.md` §(a), §(b), §4a, §169–174
- `eval/task-completion-bench/handoffs/improve/W0-P3-GATE-RESULTS.md` line 262
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/verify-tail.md` §0, §1, §4, §5, §10
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-verify-tail/tail_census.py`
  (plan-class tool-name lists), `tail_extras.py`, `tail-extras-output.md` §5,
  `tail-report-tables.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/phase-anatomy.md` §S4, §8, §9, §10
- `eval/task-completion-bench/handoffs/improve/slate-c/research/harness-changelogs.md` §2.1, §2.2,
  §2.3, §5.2 (L-2), §6 traps T7/T8, §7
- `eval/task-completion-bench/handoffs/improve/slate-c/candidates/DEDUP.md` §c01 (lines 48–57)
- `scripts/inject-agent-instructions.js`, `scripts/write-claude-rules.js`
- `eval/task-completion-bench/harness/claude-code-task-runner.mjs` lines 95–140
- `eval/task-completion-bench/harness/opencode-task-runner.mjs` lines 209, 306–308

Evidence box `root@167.233.69.121` (read-only; scratch under `/tmp/wf-slatec/c01-history/`):
- `results/fp-claudecode-tab-20260826/agent-state/*/claude-home/projects/*/*.jsonl` — 138 session
  files, full plan-tool name census, both arms; transcript `version` = 2.1.218
- `results/fp-codex-tab-20260826/agent-state/absinthe-graphql__absinthe-998-sweet/codex-home/sessions/2026/08/26/rollout-2026-08-26T22-30-48-01a04032-8802-7141-9323-441bae82f339.jsonl`
  — `session_meta`, `cli_version 0.146.1`, `base_instructions` 20,751 chars, `## Planning` section
- `/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`
  — `UpdatePlanToolConfig` + `enabled` field; 4 embedded prompt blobs each containing the Planning
  section; `codex features list` (100 flags, no plan flag); `codex -c tools.update_plan… mcp list`
  config-validation probes
- `/root/.local/share/claude/versions/2.1.218` — conditional plan prompt sentence;
  `bypassPermissions … except explicit deny rules`; `--tools` / `--disallowedTools` help strings;
  "may have been disallowed via disallowedTools"
- Rollout cited by the candidate:
  `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0` (also rank 1 of the
  codex tail table in `tail-report-tables.md`)

Web:
- https://github.com/openai/codex/pull/41744 — "Make the `update_plan` tool opt-in", merged
  2026-08-31
- https://github.com/anthropics/claude-code/releases/tag/v2.1.233 and
  https://code.claude.com/docs/en/tools-reference — todo/task tools unavailable by default on
  current models, `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` to restore
- https://dev.classmethod.jp/en/articles/20260815-cc-updates-v2-1-233/ — vendor-reported example
  (7→5 turns, 2,286→1,373 output tokens, $0.405→$0.323)

## 8. What I could not finish

1. **I could not prove that `tools.update_plan.enabled=false` actually removes the tool from the
   roster at codex 0.146.1.** The config key parses and the struct exists, but `codex debug
   prompt-input` renders only the message list, not the tool roster (11,436 bytes, identical with
   the flag on and off, 0 hits for `update_plan`). Proving it needs a request capture, which needs
   a model call, which the `$0` rule forbids.
2. **I could not prove whether `permissions.deny` removes a claude-code tool from the roster or
   only refuses the call.** This decides the sign of the claude-code leg. It is a `$0` question for
   whoever can capture one live request against a local sink, which is how B17 was settled.
3. **I could not reproduce the "0.06 text-only non-final requests" baseline** the candidate cites
   as its un-run falsifier.
4. **I did not open HO2 and did not read any grading log.** No hidden test name and no gold patch
   content appears anywhere in this report.
