# Candidates, lens "cost-structural": fewer requests without model cooperation

Slate C ideation, 2026-09-02. Author: workflow agent `cost-structural`. Spend: $0. No rollout
was launched. Nothing under `results/` was written. Box scratch: `/tmp/wf-slatec/cost-structural/`
(created, left empty; every probe ran read-only from stdin). Local scratch: none needed.

Tags on every number: **[M]** measured here or by a named sibling script · **[C]** read from
code or a deployed binary · **[W]** web source with URL · **[I]** inferred, arithmetic shown.

---

## 0. Verdict

**One structural request-saver survives the register and the code on all three harnesses, and it
is a harness configuration, not a retrieval feature: remove the harness plan tool from the sweet
arm through the config file `ss init` already writes.** The plan tool (`update_plan` on codex,
`todowrite` on opencode, `TaskCreate`/`TaskUpdate` on claude-code) is emitted as a request of its
own 100% of the time in both arms [M `verify-tail.md` §5]. Removing it in the sweet arm alone is
worth −$0.001469 (−11.9%) per codex rollout, −$0.001006 (−10.9%) per opencode rollout and
−$0.000606 (−2.9% of the inclusive cell, −3.7% of the main thread) per claude-code rollout at zero
solve effect [M tokens, I arithmetic], and it turns the head-to-head from +0.3% / +3.3% / −3.9%
into **−11.6% / −7.9% / −6.7%** [I]. Three facts make it structural rather than prompted: codex
0.146.1 already reads `[tools.update_plan] enabled = false` [C `codex-rs/core/src/config/mod.rs`
at tag `rust-v0.146.1`, lines 1033–1034 and 2551–2556]; opencode 1.18.4 drops a tool from the
request when `tools.<name>: false` or a `*`-pattern deny rule names it [C `session/llm/request.ts`
lines 208–213]; claude-code removes a tool from context on a bare-name deny rule, in every mode
including `bypassPermissions` [W code.claude.com permissions and permission-modes pages]. Two
honest caveats bound it. Applied to both arms it is a shared floor cut and **moves the head-to-head
the wrong way on codex and opencode** (+1.8% / +5.4%) because native calls the plan tool slightly
more often [I]; its value as a *sweet* lever exists only because native does not ship the
config. And on codex 0.146.1 the system prompt still names `update_plan` eight times when the
tool is off [C `gpt_5_2_prompt.md` at the tag], so the codex half is clean only after 0.152.0,
where the tool is off by default for both arms [W PR #41744] — a time-limited, pin-specific win.

**Second, the opencode parallel-emission gap has a non-MCP vehicle at the pinned version, but the
mechanism class is register A4 and stays owner-excluded.** OpenCode 1.18.4 lets a project plugin
rewrite a built-in tool's arguments and output (`tool.execute.before` / `tool.execute.after`)
[C plugin `index.d.ts` 1.18.4] and loads project custom tools from `.opencode/tool/*.ts`
[C `tool/registry.ts` lines 162–180]. My own pre-edit split shows the gap is not a phase
artefact: before the first edit native emits 2.657 structured calls per structured-bearing
request against sweet's 1.298 `ss-*` envelopes; after the first edit both arms drop to 1.247
and 1.016 [M this report §3]. The pre-edit ceiling is 3.87 requests per rollout, −12.7% to
−14.3% of the sweet cell at the marginal price [M+I]. Nothing here changes the owner decision;
I list it because the task asked for harness-native parallel emission and this is the only
form that exists at $0 on the pin. Claude-code has no such vehicle: `PreToolUse` can rewrite
inputs but cannot replace a tool result (`replacementToolResult` occurs 0 times in 2.1.218 and
2.1.258 [C]), and codex is at exactly 1.000 calls per request in both arms [M sibling].

**Third, a claude-code retry-prevention package of wrapper and init changes removes about 1 to 2
wasted requests per sweet rollout on claude-code and about 0.1 on the other two harnesses.** It
bundles the worktree-scope rewrite, an init-written `Explore` agent that carries the guide, a
working `--help` with the flag aliases guide-less callers guess, and four false-"no matches"
paths. Realistic ceiling 3–5% of the claude-code sweet arm, upper envelope about 10% [M sibling
counts, I bound]; all items are sweet-only and solve-neutral; two are already proposed by the
`real-user-product` lens and must be booked once.

**Four structural ideas died at $0 in this pass and should not come back.** (1) A `PreToolUse`
hook that repairs a failed `Edit` anchor: Claude Code runs `validateInput` — which holds "String
to replace not found in file", "File has not been read yet" and "modified since read" — **before**
any `PreToolUse` hook, in both 2.1.218 and 2.1.258 [C this report §5.1]. (2) Precision-gated
search-to-read prefetch: the measured next-call precision is at or below the break-even on every
harness (opencode: a read follows a sweet search 36% of the time against a 38% break-even;
codex: the continue pointer is followed 23.6% against 32%) [M siblings, I], and the mechanism is
B12, which inverted live. (3) `--tools` restriction on claude-code is register B17, DEAD.
(4) Codex `&&`-chain budget sharing across wrapper processes is C9, DEAD on the follow-rate
economics.

Codex has no sweet-only structural request-saver at the pinned 0.146.1 except the plan-tool
config with its prompt mismatch; I say so plainly rather than inventing one.

---

## 1. Scope, inputs, and what I did myself

Read in full: `BRIEF.md`, `DEAD-LEVER-REGISTER-DRAFT.md`, `register/DEAD-LEVER-REGISTER.md`
(123 rows), the seven forensics reports and the six research reports under `slate-c/`, the two
sibling candidate reports already in `candidates/`. Code read: `harness/opencode-task-runner.mjs`,
`harness/claude-code-task-runner.mjs`, `harness/codex-task-runner.mjs` (config lines), the
Claude Code binaries 2.1.258 (local) and 2.1.218 (box), the deployed codex 0.146.1 binary (box),
opencode 1.18.4 sources at commit `49c69c5e` (`config/config.ts`, `tool/registry.ts`,
`session/llm/request.ts`, `session/tools.ts`, `agent/agent.ts`, `permission/index.ts`,
`session/prompt/gpt.txt`, `tool/todowrite.txt`), codex sources at tag `rust-v0.146.1`
(`codex-rs/core/src/config/mod.rs`, `codex-rs/config/src/config_toml.rs`,
`codex-rs/config/src/loader/mod.rs`, six prompt files).

Measured here [M], with the commands in §8:

1. Claude Code tool pipeline order (`inputSchema.safeParse` → `validateInput` → PreToolUse
   hooks), both binaries.
2. Claude-code fresh-pool tool-name histogram, main transcripts, both arms.
3. Opencode native structured calls and sweet `ss-*` envelopes split at the first edit request,
   from the sibling census `scripts-opencode-calls-per-request/data/requests.json` (132 rows).
4. Codex 0.146.1 config key `tools.update_plan` in source and in the deployed binary's string
   table; project config layers and their denylist at the pin.

Rules honoured: $0; box read-only (probes ran `python3 -` over stdin, wrote nothing); no product
or bench code edited; HO2 never opened; no grading log read; no hidden test name or gold patch
content appears here.

---

## 2. The request anatomy this lens can act on

Every request class below is per rollout, native / sweet, from the sibling censuses that
reproduce the ledger to within 0.01% [M `verify-tail.md` §1, `phase-anatomy.md` §1,
`opencode-calls-per-request.md` §1].

| class | codex N / S | opencode N / S | claude-code N / S (main) | structural handle without model cooperation? |
|---|---|---|---|---|
| plan tool, always its own request | 4.14 / 3.92 | 3.92 / 3.79 | 2.05 / 1.91 | **yes**: harness config removes the tool (§4.1) |
| retrieval requests (read + search) | 5.00 / 4.53 | 9.28 / 5.72 | 8.36 / 7.36 | opencode only: structured surface (§4.2); codex 1.000 calls/request both arms |
| requests after a failed `ss-*` call | 0 / ≤0.4 | 0 / ≤0.4 | 0 / ≤0.5 | **yes**: wrapper fixes (§4.3), upper envelope ≤2.4% / 2.2% / 1.9% (E2) |
| subagent hunts and worktree zeros | — | — | 0 / ~1–2 (in 9 delegating rollouts) | **yes**: init agent file + scope rewrite (§4.3) |
| `run_tests` + polls | 3.0 / 3.1 | 2.7 / 2.9 | 3.1 / 3.2 | no: shared shim and frame (A9, A10, F13) |
| edits and failed edits | 2.0 / 2.0 | 1.8 / 1.9 | 4.7 / 4.9 | no on claude-code: hooks run after validation (§5.1); D1b needs a new tool |
| `git diff` / `status` | 2.4 / 1.8 | 2.3 / 2.5 | 3.1 / 1.2 | no: F18 git-diff absorber DEAD; arm-similar |
| final text answer | 1.0 / 1.0 | 1.0 / 1.0 | 1.0 / 1.0 | no |

Retrieval rows are `read`+`search` class sums from `phase-anatomy.md` §3.1 (solved-everywhere
subset) [M]; other rows from `verify-tail.md` §4–5 and `native-capability-gaps.md` §2 [M].
The plan row is the largest class that a configuration can remove, and it is arm-symmetric
today, which is why no lever has touched it: the only vehicle anyone priced was a guide sentence
(`verify-tail.md` §10, `phase-anatomy.md` S4), which needs the model to obey.

---

## 3. New measurements

### 3.1 Claude Code runs `validateInput` before `PreToolUse` hooks (both binaries) [C]

Local 2.1.258 (`~/.local/share/claude/versions/2.1.258`, offset 164,436,000–164,442,500), the
tool-execution function `qLo`:

```
… let _e=e.inputSchema.safeParse(fe); … if(!_e.success){ … InputValidationError … }
let ke=await e.validateInput?.(_e.data,{...o,toolUseId:n});
if(ke?.result===!1) return … `<tool_use_error>${ke.message}</tool_use_error>` …
… for await(let xn of UPe(o,e,Ie,…)) switch(xn.type){ … case"hookUpdatedInput":Ie=xn.updatedInput; … case"additionalContext": … }
```

The Edit tool's `validateInput` (offset 162,413,200–162,417,000) is the function that returns
"File has not been read yet" (errorCode 6), "File has been modified since read" (7), "String to
replace not found in file" (8) and "Found N matches" (9). Box 2.1.218 (`/root/.local/share/claude/
versions/2.1.218`): the only `validateInput?.(` call site at offset 255,110,621 is followed by
`hookUpdatedInput` 1,891 bytes later and by `PreToolUse` 3,048 bytes later, with `safeParse`
1,991 bytes before it [M python probe over stdin]. **Consequence:** no `PreToolUse` hook can see,
let alone repair, an Edit whose anchor is wrong; the failed-edit request has already been billed.
This closes the anchor-repair-hook idea (§5.1) and strengthens register D2's "harness-owned" kill.

### 3.2 Claude-code plan tools in the fresh pool, by name [M]

`grep -oh '"name":"[A-Za-z_]*","input"'` over the main transcripts of `fp-claudecode-tab-20260826`:

| tool | native | sweet |
|---|---:|---:|
| Read | 709 | 56 |
| Bash | 584 | 1,139 |
| Edit | 308 | 284 |
| **TaskUpdate** | **80** | **79** |
| **TaskCreate** | **56** | **57** |
| Agent | 33 | 11 |
| Write | 8 | 6 |
| TaskList / TaskGet | 1 / 0 | 2 / 1 |
| TaskOutput / TaskStop (background-task control, not planning) | 2 / 1 | 0 / 0 |

So the plan family on the bench binary is `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`:
137 native and 139 sweet calls over 66 rollouts each, 2.08 and 2.11 per rollout (the sibling
census counted 135 / 126 with a different transcript match rule; the difference does not
change the candidate). `TaskOutput` and `TaskStop` manage background subagents and must not be
denied.

### 3.3 Opencode: parallel emission is a pre-edit phenomenon in both arms [M]

Over `scripts-opencode-calls-per-request/data/requests.json` (66 native rows; 66 canonical sweet
rows, 33 from `fp-opencode-tab-20260826` and 33 from `rp-oc-tab-20260827`), splitting each
rollout at its first request of kind `E` (edit):

| population | requests | multi-call share | calls or envelopes per request |
|---|---:|---:|---:|
| native, structured read-like (`read`/`grep`/`glob`/`list`), **before** first edit | 327 | **64.2%** | 2.657 |
| native, same, **after** first edit | 85 | 17.6% | 1.247 |
| sweet, `ss-*`-bearing, **before** first edit | 500 | **13.8%** | 1.298 |
| sweet, same, **after** first edit | 62 | 1.6% | 1.016 |

Native structured calls: 975 total, 869 (89%) before the first edit; `grep` 240 of which 39
(16%) after the first edit; `read` 596 of which 62 after; `glob` 139 of which 5 after [M].

Two readings. First, the phase-mix kill test the `structured-vs-shell-parallelism.md` report
left open (its F1: kill if sweet's pre-edit rate is ≥70% of native's pre-edit rate) does **not**
fire: 13.8% against 64.2% is 21%. Second, both arms batch far less after the first edit, so any
structured surface earns almost all of its saving before the first edit, and the 11% of native
structured calls that come after the first edit are the ones an intercept must hand back to the
native tool because the index cannot see same-rollout edits (register E3).

Pre-edit ceiling, if sweet's 649 pre-edit `ss-*` envelopes were emitted at native's pre-edit
density of 2.657: 244 requests instead of 500, 256 fewer over 66 rollouts = **3.87 requests per
rollout**, −$0.001178 (−12.7%) at the measured exploration marginal price $0.000304 or −$0.001321
(−14.3%) at the 08-28 price $0.000341 [M+I]. The sibling's whole-rollout figure is 3.43; the
dependency-respecting figures are 1.23 to 3.06 [M `opencode-calls-per-request.md` §6].

### 3.4 Codex 0.146.1 already has the plan-tool switch, and a project config layer [C]

`codex-rs/core/src/config/mod.rs` at `rust-v0.146.1` (commit `abb1de9b`):

```rust
/// Whether to register the update_plan tool.
pub update_plan_enabled: bool,                       // line 1034
fn resolve_update_plan_enabled(config_toml: &ConfigToml) -> bool {
    config_toml.tools.as_ref()
        .and_then(|tools| tools.update_plan.as_ref())
        .is_none_or(|config| config.enabled)          // lines 2551–2556: default true
}
```

`codex-rs/config/src/config_toml.rs` line 632: `pub struct ToolsToml { web_search, experimental_request_user_input, update_plan: Option<UpdatePlanToolConfig> }`.
The deployed 0.146.1 binary carries the serde field table `ToolsToml web_search
experimental_request_user_input update_plan` (57 hits of `update_plan`) [M box probe]. The TOML
form is therefore `[tools.update_plan]\nenabled = false`.

Config layers at the pin (`codex-rs/config/src/loader/mod.rs` lines 102–106): user
`${CODEX_HOME}/config.toml`, profile, `${PWD}/config.toml`, tree `./.codex/config.toml` up to root,
repo `$(git rev-parse --show-toplevel)/.codex/config.toml` — the project layers "loaded but
disabled when the directory is untrusted". `PROJECT_LOCAL_CONFIG_DENYLIST` (lines 60–75) excludes
provider, notify, profile and telemetry keys; `tools` is **not** on it, so a project
`.codex/config.toml` may turn the plan tool off. The bench marks every run directory
`trust_level = "trusted"` [M `/root/.codex/config.toml`].

The prompt does not follow the switch at the pin. `codex-rs/core/gpt_5_2_prompt.md` (and
`prompt_with_apply_patch_instructions.md`, `gpt_5_1_prompt.md`) carry a static "## Planning"
section with 8 mentions of `update_plan` ("You have access to an `update_plan` tool …") [C].
PR #41744, shipped in 0.152.0, is the change that "Remove[s] bundled `update_plan` guidance from
model … prompts when the tool is disabled" and flips the default to off [W
https://github.com/openai/codex/pull/41744].

### 3.5 Opencode 1.18.4: how a tool leaves the request, and which config file wins [C]

`config/config.ts` lines 553–563: `tools: {<name>: false}` becomes `permission.<name> = "deny"`
(`write`/`edit`/`patch` collapse to `edit`). `session/llm/request.ts` lines 208–213:

```ts
function resolveTools(input) {
  const disabled = Permission.disabled(Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []))
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}
```

`permission/index.ts` lines 204–214: a rule with `pattern === "*"` and `action === "deny"` puts
the tool in the hidden set. Load order, `config/config.ts` lines 396–409: global → the file named
by `OPENCODE_CONFIG` → project `opencode.json`/`opencode.jsonc` (`ConfigPaths.files`, skipped
only when `OPENCODE_DISABLE_PROJECT_CONFIG` is set) → `.opencode/opencode.json` → later sources
win by `mergeDeep`. The bench runner sets `OPENCODE_CONFIG` and does not set the disable flag
[C `opencode-task-runner.mjs`]. `session/prompt/gpt.txt` at 1.18.4 never names `todowrite` [C];
the tool's own 2,012-byte description ("To be used proactively and often") is the only text that
promotes it.

### 3.6 Claude Code: deny rules remove the tool and hold in every mode [W]

"A bare tool name like `Bash` removes the tool from Claude's context entirely, so Claude never
sees it." [W https://code.claude.com/docs/en/permissions, section Manage permissions]. "Deny rules
block in every mode, including `bypassPermissions`." [W https://code.claude.com/docs/en/permission-modes].
"`deny` and `ask` rules apply right away" without workspace trust [W
https://code.claude.com/docs/en/settings]. The system-prompt sentence that promotes the plan tool
is conditional on the tool being present in both binaries: `let n=[mA,cb].find((v)=>e.has(v)); …
n?\`Use ${n} to plan and track work. Mark each task completed as soon as it's done; don't
batch.\`:null` [C 2.1.258 offset 165,344,864; 2.1.218 offset 257,190,362]. So removing the
tools removes the instruction with them; there is no prompt-tool mismatch on claude-code.

---

## 4. Candidates

### 4.1 CS-1 — Remove the harness plan tool in the sweet arm through the config `ss init` writes

- **Family:** turn economy; harness configuration. **Lens:** cost-structural.
- **Harnesses:** opencode (clean), claude-code (clean), codex (pin-specific, with a prompt
  mismatch; see below).
- **Mechanism.** The plan tool is billed as a request of its own on every call: codex 273/273
  native and 259/259 sweet, opencode 259/259 and 250/250, claude-code 135/135 and 126/126
  [M `verify-tail.md` §5]. Three files, written by `ss init` and present only in the sweet
  arm, remove the tool and its prefix description before the first request:
  - opencode: `<repo>/opencode.json` with `{"tools": {"todowrite": false}}` (or
    `"permission": {"todowrite": "deny"}`); loads after the runner's `OPENCODE_CONFIG` and wins
    (§3.5). The 2,012-byte `todowrite.txt` description leaves the prefix as well.
  - claude-code: `<repo>/.claude/settings.json` with `"permissions": {"deny": ["TaskCreate",
    "TaskUpdate", "TaskList", "TaskGet"]}`; the tools and their prompt sentence leave the
    context (§3.6). `TaskOutput` and `TaskStop` stay.
  - codex: `<repo>/.codex/config.toml` with `[tools.update_plan]\nenabled = false`, honoured at
    0.146.1 in a trusted directory (§3.4). **At the pin the base prompt still tells the model it
    has `update_plan`** (8 mentions); the model may call a missing tool and burn a request on
    the error. From 0.152.0 the tool is off by default for both arms, so the sweet-only
    differential disappears on upgrade (trap T7 of `harness-changelogs.md`).
- **Why native cannot match.** It can, by adopting the same config. Then the change is a shared
  floor cut with zero differential (brief rule 6). The lever is a sweet lever only in the sense
  that sweet-search ships the opinionated agent profile and native does not. The owner must
  choose the booking; I give both below.
- **Evidence.** Plan-only requests per rollout and their counterfactual price (output plus
  re-sent prefix; ingest moves to the next request): codex sweet 3.92 × $0.000374, opencode
  sweet 3.79 × $0.000266, claude-code sweet 1.91 × $0.000318 [M `verify-tail.md` §5]. Within-arm
  solve screen: no positive association between plan-request count and solving (claude-code
  native 0–1 plans 20/26 solved, 2–3 plans 20/32; codex 2–3 plans 5/7 native, 7/18 sweet; 4–5
  plans 32/55, 32/48) [M `phase-anatomy.md` S4, confounded]. Vendor signals: OpenAI made
  `update_plan` opt-in in 0.152.0 [W PR #41744]; Anthropic removed the task tools for Opus 4.8,
  Sonnet 5, Fable 5 and newer in 2.1.233 [W CHANGELOG, cited in `harness-changelogs.md`].
  Example rollout with four plan requests in 22: `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0`, positions 0, 6, 10, 21 [M `verify-tail.md` §10].
- **Ceiling per harness** (100% removal, zero solve effect) [M tokens, I arithmetic]:

  | harness | sweet cell today | saving per rollout | sweet after | head-to-head today → sweet-only | head-to-head if both arms |
  |---|---:|---:|---:|---|---|
  | codex | $0.012330 | −$0.001469 (−11.9%) | $0.010864 | +0.3% → **−11.6%** | +1.8% (native saves 4.14 × $0.000390) |
  | opencode | $0.009265 | −$0.001006 (−10.9%) | $0.008257 | +3.3% → **−7.9%** | +5.4% |
  | claude-code | $0.020727 (inclusive) | −$0.000606 (−2.9% inclusive, −3.7% main) | $0.020120 | −3.9% → **−6.7%** | −4.0% |

  Secondary prefix term, not in the table [I]: opencode loses the 460-token `todowrite`
  description from every request, about $0.000115 (1.2%); claude-code loses roughly 1,100 tokens
  of `Task*` descriptions, about $0.00037 (1.8%); codex loses only the tool schema (the Planning
  prose stays at the pin). In requests: −3.9 / −3.8 / −1.9 per rollout.
- **Vehicle and `sweet_only`.** `scripts/inject-agent-instructions.js` (and `write-claude-rules.js`)
  at `init`; in the bench, the same files written into the sweet rundir and declared as injected
  so `verifyIntegrity` does not flag them. **partial**: sweet-only by construction, shared by
  adoption.
- **Cheapest `$0` falsifier.** Two static checks, both done here: (a) the harness drops the
  tool *and* its prompt text when the config says so — true on opencode (§3.5, `gpt.txt` has no
  mention) and claude-code (§3.6), **false on codex 0.146.1** (§3.4); (b) plan calls never share
  a request with a working call, so nothing else compresses — 100% standalone on all six cells
  [M `verify-tail.md` §5]. A third `$0` check I did not run: count text-only non-final requests
  per rollout today (0.06 per rollout, claude-code native only [M `phase-anatomy.md` §1]) as the
  baseline for the kill condition below.
- **Kill condition (pre-registered for the first paid smoke).** Kill on a harness if any of:
  plan-only requests per sweet rollout not reduced ≥90% (the tool is gone, so anything above
  0.4 per rollout means "unknown tool" errors); solved count outside ±6 of 66 against the same
  tasks' native cell; text-only non-final requests rise by more than 0.5 per rollout (the plan
  moved into its own text request); on codex, "unknown tool" error requests exceed 0.3 per
  rollout at the pin.
- **Build cost.** Small: three config fragments at `init`, one arm-conditional injection in each
  runner, a preflight assertion that the resolved config shows the tool disabled. One day.
- **Register check.** No row names the plan tool. Nearest: the *prompt* form of this lever,
  seeded by `verify-tail.md` §10 and `phase-anatomy.md` S4 and used by the sibling
  `inversion-and-removal.md` arithmetic — a different vehicle (a guide sentence the model must
  obey; A1/A6 record luna as instruction-deaf). **B17** (redundant-tool retirement, DEAD) removed
  Grep/Glob/Read *schemas* for their prefix tokens (758 tokens, below the kill line) and found the
  fair both-arms application moved claude-code the wrong way; CS-1 removes *requests*, 20–24% of
  all requests on codex and opencode, and I report the same fairness inversion on codex and
  opencode (+1.8% / +5.4% under both-arms application). **B4** (state summary) is a different
  text. Not a register row under a new name: the vehicle, the quantity removed (requests, not
  tokens) and the per-harness code facts are new.
- **Flags.** `new_tool: false`. `needs_user_decision: true` — three decisions: whether a
  harness-config profile shipped by `ss init` counts as a sweet feature or as a shared floor;
  whether to change what `init` writes into users' `opencode.json` / `.claude/settings.json` /
  `.codex/config.toml`; whether to run the codex half at the pin with the prompt mismatch.
- **Solve risk.** Unknown and behavioural. The plan tool carries no information the model lacks;
  the risk is that the model moves planning into text requests (priced in the kill condition) or
  loses stop discipline without a checklist. The two vendors' defaults and the within-arm screen
  point to a small effect; only a paired smoke can price it. Solve is the veto.

### 4.2 CS-2 — Serve `ss-*` through opencode's structured tool surface (A4 class, non-MCP vehicle)

- **Family:** turn economy; parallel emission. **Lens:** cost-structural.
- **Harnesses:** opencode only. Codex: 1.000 calls per request in both arms, zero headroom
  [M `structured-vs-shell-parallelism.md` §2]. Claude-code: no output-rewriting hook
  (`replacementToolResult` 0 hits in 2.1.218 and 2.1.258 [C]), and the same Bash tool swings
  3.5% → 41.3% companion rate between main thread and subagents, so tool identity is not the
  cause there [M sibling].
- **Mechanism.** Two vehicles exist at the pinned 1.18.4, both loaded from the project directory:
  (a) a plugin in `.opencode/plugin/sweet-search.ts` registering `tool.execute.before` (rewrites
  `args`) and `tool.execute.after` (replaces `output`) for the built-in `grep`, `glob` and `read`
  [C `@opencode-ai/plugin@1.18.4` `index.d.ts`; `session/tools.ts` lines 106–122 trigger the
  hooks around `execute`]; (b) custom structured tools in `.opencode/tool/ss-*.ts`, appended to
  the built-in list as ordinary description-plus-schema entries [C `tool/registry.ts` 162–180,
  225–228]. Under (a) the model keeps emitting the tools it already batches 64% of the time
  before the first edit (§3.3) and never learns the results come from the index. Under (b) the
  model must be told to prefer `ss-*` (the guide already does) and the `ss-*` schemas enter the
  cached prefix.
- **Why native cannot match.** Native already has the structured surface; this removes sweet's
  request handicap and cannot make sweet emit fewer requests than native. The residual
  differential is result quality (ranking, `-k` caps, search bodies), which is unmeasured for
  solves (120/198 against 125/198, p ≥ 0.72).
- **Evidence.** Native `read` 84.5%, `glob` 90.1%, `grep` 75.2% in multi-call requests; `bash`
  37.3% native and 36.1% sweet; Bash `ss-*` 12.5% [M `structured-vs-shell-parallelism.md` §3,
  `opencode-calls-per-request.md` §3]. Pre-edit split, §3.3 here [M]. Sweet does 21% fewer
  retrieval operations and needs 27% more retrieval requests [M sibling §7.2]. Concrete pairs:
  `rp-oc-tab-20260827/agent-state/devlooped__moq-1262-sweet` rep 2 requests 16–20 (five single
  `ss-read` requests, $0.002202 marginal) against native rep 0 request 8 reading three of those
  files at once [M `opencode-calls-per-request.md` §5].
- **Ceiling per harness.** opencode: pre-edit 3.87 requests per rollout, −$0.001178 to −$0.001321
  (−12.7% to −14.3%) [M+I, §3.3]; whole-rollout 3.43 requests (−10.1% to −12.7%) [M sibling];
  dependency-respecting 1.23 to 3.06 requests (−4.5% to −11.1%) [M sibling §6]. Realised
  fraction unknown; the harness's own `read` reaches 54.6% parallel, which is an anchor not a
  prediction. Under vehicle (a) the honest expectation is request parity with native (sweet
  ≈ −3.2%, the gap removed) plus whatever byte advantage survives a native-shaped call pattern
  (up to about −8%) [I]. Codex 0. Claude-code 0 (no vehicle).
- **Vehicle and `sweet_only`.** `ss init --opencode` writes the plugin or tool files into the
  project; in the bench the runner must stop rejecting them (`validateMainOpencodePreflight`
  fails on `resolved.plugin.length !== 0`, and auto-discovered `.opencode/plugin` files are
  appended to that list [C `config/config.ts` 394–408]). **yes**, sweet-only.
- **Cheapest `$0` falsifier.** Replay every native `grep`, `glob` and `read` call of
  `fp-opencode-tab-20260826` and `rp-oc-tab-20260827` through the proposed mapping against the
  goldens: `read(filePath, offset, limit)` → `ss-read` of the same window (byte-identical by
  construction, no replay needed); `grep(pattern, include, path)` → `ss-grep` with `--in path`,
  `-k` raised, output post-filtered by the `include` glob — **240 of 240 native grep calls carry
  an `include` glob** [M `native-capability-gaps.md` §2], so this translation is mandatory;
  `glob` → an index path-table lookup that does not exist yet (`sweet-search files` was planned
  and not built [C `core/cli.js`]) or a fall-through to native `glob`. Score: does the mapped
  result contain every file the native result matched. Also count the 106 post-first-edit
  structured calls (11%) that must fall through to native because the index cannot see
  same-rollout edits (E3), and token-count the six `ss-*` schemas for vehicle (b).
- **Kill condition.** Kill if the mapped grep result misses files on more than 10% of native
  grep calls; kill vehicle (b) if the schemas add more than 500 prefix tokens without an equal
  guide cut; kill either vehicle if a live paired smoke on the 22 tasks moves solves outside
  ±6 of 66. Known correctness hazards the replay must include: the alternation prefilter false
  negative (1 in 198 rollouts) and the `--in .` scope bug (5 of 5 zero) from
  `claude-main-thread.md` §6.2.
- **Build cost.** 3–5 days: argument translators for three tools, an include-glob post-filter,
  a path-table lookup for `glob`, a staleness fall-through, and the preflight change.
- **Register check.** This is **A4**'s mechanism (structured `ss-*` surface as the
  parallel-emission vehicle), OWNER-EXCLUDED 2026-07-31 "Bash/CLI only", with a non-MCP vehicle
  that `harness-changelogs.md` L-1 and `opencode-calls-per-request.md` §7 already describe. New
  here: the pre-edit split that rules out the phase-mix explanation (§3.3), the post-edit
  fall-through bound (11%), the include-glob translation requirement, and the statement that
  claude-code has no output-rewriting hook. **E9**'s "runtime-signal router NOT refuted" branch is
  the per-call routing inside vehicle (a). **A1/A2** do not apply: nothing is asked of the model.
  Booked here for completeness of the lens; it stays a user decision.
- **Flags.** `new_tool: false` for vehicle (a) (no new tool appears to the model); `true` for
  vehicle (b). `needs_user_decision: true` (reopens the 2026-07-31 scope decision; vehicle (a)
  silently changes the semantics of the harness's own tools).
- **Solve risk.** Real and unmeasured: stale index after edits (E3), `-k` caps against `rg`'s
  full listing, ranking replacing raw match order, and the two false-negative bugs above. The
  crossed ablation in `agent-efficiency-2026.md` §7.2 (arXiv 2607.10569) found tool surface
  changes cost, not answers, on codex and claude-code, which is neutral evidence, not positive.

### 4.3 CS-3 — Claude-code retry-prevention package: wrapper fixes plus a guide-carrying `Explore`

- **Family:** wrapper hygiene; subagent reach. **Lens:** cost-structural (requests a wrapper
  provokes and can stop provoking).
- **Harnesses:** claude-code (all items), codex and opencode (the two main-thread wrapper items
  only; no delegation there in 264 rollouts [M `claude-subagents.md` F9]).
- **Mechanism, six items, each a wrapper or init change and none a model instruction:**
  1. Worktree scope rewrite: when `--in` (or a positional path) resolves under
     `<repo>/.claude/worktrees/<agent>/`, strip the prefix, search the repo-root path, print the
     rewrite in the banner; say "no indexed entities in scope" instead of "(no matches)". Today
     45 of 57 worktree-scoped `ss-grep`/`ss-find` calls answered zero and 12 were usage errors,
     after which the subagents did 127 native operations (87 `Read`, 13 `grep -RInE`, 18 `find
     -name`, 9 `find -type f`, 184,470 tokens) in 7 rollouts; two subagents later re-ran 12 of the
     same patterns unscoped and got hits [M `native-capability-gaps.md` §3.2].
  2. `init` writes `.claude/agents/Explore.md` whose body is the guide plus a short
     explore-and-report prompt, `tools: Bash, Read, Grep, Glob`, `model: inherit`. The built-in
     `Explore` omits CLAUDE.md and project rules [W sub-agents doc; C `omitClaudeMd` on the three
     built-ins only], so guide-less sweet `Explore` subagents hunted for the binaries (13 calls),
     called `--help` 12 times, invoked `ss-*` by absolute path 200 of 215 times and failed 14.0%
     of `ss-*` calls against 4.8% in the main thread; guided general-purpose subagents made 0
     hunts and failed 5.9% [M `claude-subagents.md` §2].
  3. `--help`/`-h` print usage and exit 0; accept `-E`/`--extended-regexp` as inert (ERE is
     already the engine's syntax); accept `--in` on `ss-trace`/`ss-find`. 36 of 329 subagent
     `ss-*` calls (10.9%) and 12 of 779 main-thread calls were usage errors of these kinds
     [M `native-capability-gaps.md` §3.2, `claude-subagents.md` §2.1].
  4. `--in <absent path>` returns an error naming the path instead of "(no matches)" (11 calls in
     198 rollouts; three probes of a file that does not exist in one task) [M `claude-main-thread.md` §6.2].
  5. `--in .` / `--in ./` treated as unscoped (`pathSegments('.')` is empty, so every file is
     rejected; 5 of 5 such calls answered zero, 4 had hits) [C `grep-output-shaping.js`; M sibling].
  6. Alternation prefilter: when a branch yields no ≥3-character literal, scan unfiltered instead
     of requiring the surviving branch's literal (`_color|_.*,` dropped 59 matching lines in
     indexed files; 1 event in 198 rollouts) [C native literal extractor; M sibling].
  Two further paths from `phase-anatomy.md` S3 belong in the same package for codex and
  opencode: the `ss-semantic` `[FALLBACK]` whole-file span on an excluded file (7 calls, 2.8 kB
  each) and `ss-read` of an excluded bundle (13,396 tokens in one call) should print the shipped
  "not indexed" note instead.
- **Why native cannot match.** Native has no `ss-*` failures to remove; this package deletes
  sweet-only waste and can at best reach native's zero.
- **Evidence.** Rollout ids: `fp-claudecode-tab-20260826` sweet `asynkron__protoactor-dotnet-1909/rep1`,
  `bfgroup__b2-113/rep1`, `bfgroup__b2-113/rep2`, `bfgroup__b2-259/rep0`,
  `final-form__final-form-64/rep2` (worktree zeros; subagent transcripts under
  `agent-state/<task>-sweet/claude-home/projects/*/<session>/subagents/`); quoted sequence
  `bfgroup__b2-113/sweet/rep2` subagent calls 41–50 (`ss-grep -F 'boost-install' --in <worktree>`
  → 0; `ss-grep -F install -k 100` → 198 matches) [M `native-capability-gaps.md` §3.2]. Subagent
  table with per-agent hunt, `--help` and failure counts: `claude-subagents.md` §2.1 [M].
- **Ceiling per harness.** claude-code: worktree-driven fallback $0.001809 per sweet rollout
  (8.7%) as an upper bound, about 3% realistic after removing the `b2` share that was index-blind
  at the time [M+I sibling]; guide-less `Explore` dilution ≤ $0.00039 per rollout (2.0%) [M];
  usage-error requests ≤ $0.0073 per 66 rollouts (0.56%) [M]; main-thread false negatives
  (items 4–6) about 12 requests per 66 rollouts ≈ 0.18 per rollout ≈ 0.6% [M counts, I price at
  $0.0007]. The sets overlap (the same subagents hunt, mis-scope and mistype), so the package is
  **3–5% of the claude-code sweet arm realistic, about 10% upper envelope**, roughly 1–2
  requests per rollout. Codex and opencode: ≤0.5% each (items 4–6 plus the two excluded-file
  paths; no delegation). In solves: expected 0 (the affected tasks are dead in every cell or
  solved in every cell).
- **Vehicle and `sweet_only`.** `eval/agent-read-workflows/bin/_ss-helpers.mjs` and
  `_ss-argparse.mjs` (items 1, 3–6, the two excluded-file paths); `core/search/grep-output-shaping.js`
  (item 5); the native literal extractor (item 6); `scripts/init.js` sibling of
  `write-claude-rules.js` (item 2). **yes**, sweet-only.
- **Cheapest `$0` falsifier.** (1) Replay the 45 worktree-scoped zero patterns against the
  `b2`, `final-form` and `protoactor` goldens with the prefix stripped and count how many return
  the line the same subagent later found natively. (2) Re-parse the 48 recorded usage errors with
  the new argparse rules. (3) On a local Claude Code ≥ 2.1.218, list `/agents` and confirm the
  project `Explore.md` is the active definition (no model call). (4) Unit-test `pathSegments('.')`
  and replay the 11 absent-scope and 5 `--in .` calls.
- **Kill condition.** Kill item 1 if fewer than half of the 45 patterns return the later-found
  line; kill item 3 if fewer than 30 of 48 usage errors become valid calls; kill item 2 as a cost
  lever if a later run shows `Explore` `ss-*` failure rate unchanged with the guide present
  (keep it as hygiene); kill the package as a cost lever if the next claude-code run shows
  sweet-only failed or zero `ss-*` calls below 0.3 per rollout.
- **Build cost.** 1–2 days for the wrapper items; one init-written file for item 2.
- **Register check.** Extends **E2** (hygiene package SHIPPED: regex crash, positional path,
  ENOENT hint, empty body, "not indexed", banner) with eight uncovered paths; none of E2's items
  concerns worktrees, `--help`, `-E`, `--in .`, absent scopes, the alternation prefilter, the
  `ss-semantic` fallback or `ss-read` on excluded files. Does not touch **F15** (no delegation is
  added; the model already delegates). Items 1 and 2 are also proposed by
  `candidates/real-user-product.md` **RU-3** (worktree project root) and **RU-2** (project agent
  definition) and by `claude-subagents.md` M1/M3 and `native-capability-gaps.md` S1 — **book once**;
  this report's contribution is the request-count framing and the combined ceiling.
- **Flags.** `new_tool: false`. `needs_user_decision: partial` — `no` for the wrapper items;
  `yes` for item 2, which adds a file to the user's `.claude/agents/` at `init` (the same
  contact-surface class as the MCP decision).
- **Solve risk.** Neutral: 0 solves changed in the affected rollouts [M siblings]; item 1 makes
  the two-views hazard (`SWEET_SEARCH_PROJECT_ROOT` pinned to the parent while the subagent's
  `Read` sees the clean worktree) visible instead of silent.

---

## 5. Dead at $0 in this pass — do not re-propose

### 5.1 `PreToolUse` anchor-repair hook for claude-code `Edit` — DEAD [C]

Idea: a sweet-installed `PreToolUse` hook rewrites `old_string` (tab-carry strip, whitespace
normalisation, gutter removal, basename lookup for wrong paths) before `Edit` runs, so the 28 of
32 mechanically addressable fumbles of register D1b never cost a request. Fact: `validateInput`
runs before the hooks in both binaries (§3.1), and the not-found, not-read and stale-read
checks are inside `validateInput` with `errorCode` 6–9. The error is billed before any hook sees
the input. The `updatedInput` field can only change an Edit that would already succeed. Register
**D2** ("apply preflight — harness-owned") is therefore right on claude-code even with hooks; the
only remaining anchored-edit path is a new tool (**D1b**, `needs_user_decision`). Opencode's
`tool.execute.before` does run before `apply_patch` executes [C `session/tools.ts`], but opencode
sweet lost only 4 turns (1.2%) to fumbled edits [M `W0-P7`], so there is nothing to collect there.

### 5.2 Precision-gated search-to-read prefetch (A3 reopened by `agent-efficiency-2026.md` S2) — DEAD at $0 [M+I]

Break-even precision on luna is 32% codex, 38% opencode, 25% claude-code [I sibling]. Measured
upper bounds on the precision: on opencode a read of *any* file follows a sweet search-only
request 36% of the time (another search follows 44%) [M `opencode-calls-per-request.md` §4], so
the precision for the top-1 file is below 36% against a 38% break-even; on codex the
`continue:` pointer to the unread remainder of the top-1 file is followed within three calls
23.6% of the time (57/242) against a 32% break-even [M `codex-cap-x-ss.md` §6]. The mechanism is
also **B12** (span expansion, INVERTED live: more context provoked more work) and **A3** (v1
top-1 cap raise null live). Kill confirmed without a new run.

### 5.3 `--tools` restriction of claude-code's built-ins (harness-changelogs L-2) — is register B17, DEAD

B17 captured the live API request: `Grep` and `Glob` schemas are not in it; the removable set
is 758 tokens; applied to both arms it moves claude-code the wrong way. L-2's 2.0–3.0% band is
an estimate against a public breakdown, B17's is a measurement. Not re-booked.

### 5.4 Claude-code structured surface for `ss-*` — no vehicle at 2.1.218 or 2.1.258 [C]

`PreToolUse` `updatedInput` can redirect a `Read` or `Grep` call's arguments but cannot replace
the result (`replacementToolResult` 0 hits). A `PostToolUse` `additionalContext` can append a
sweet result next to the native result, which doubles the payload (B12 class). MCP is A4.

### 5.5 Codex `&&`-chain budget shared across wrapper processes — C9, DEAD

A PPID-keyed budget file would let chained `ss-read` calls see each other's output size and stay
under the ~2,400-token cap. It is register **C9** with a new implementation detail, and
`codex-cap-x-ss.md` §7 showed the design costs money at any pointer follow-rate above 9.5%
(measured 23.6%). 69% of cuts are bundles, so the reach would be larger than C9's 33 single
cuts, but the sign does not change.

### 5.6 Hook-appended `git diff` after every edit — F18, DEAD; hook-triggered `run_tests` — shared

Appending the post-edit diff to the edit result targets 0.54–0.86 `git diff`/`status` requests
per rollout, arm-similar [M `verify-tail.md` §4]; register **F18** (git-diff absorber) is DEAD
and "git self-state arm-similar". Auto-running the suite from a hook is register **F13** class:
the `run_tests` shim and frame are shared, and a sweet-only version would be a harness change of
the same fairness class as CS-1 with a much larger solve surface.

### 5.7 Progressive disclosure of the guide — killed by `agent-efficiency-2026.md` §6.2

One deferred fetch costs 1.7–2.0× the always-resident guide on every harness [I sibling on M
inputs]. Recorded so the next lens does not re-derive it.

---

## 6. Register cross-check, one line per candidate

| candidate | nearest rows | why it is not that row |
|---|---|---|
| CS-1 plan-tool removal by config | none names the plan tool; prompt form seeded by `verify-tail.md` §10 / `phase-anatomy.md` S4; B17 (schema retirement, DEAD); B4 (state summary, DEAD); A1/A6 (prompt steering, DEAD) | configuration vehicle, no model cooperation; removes 20–24% of requests, not 758 prefix tokens; same fairness inversion as B17 reported, not hidden |
| CS-2 opencode structured surface | **A4** (OWNER-EXCLUDED), E9 runtime-router branch, A1/A2 | same mechanism class as A4 with a non-MCP vehicle; listed under `needs_user_decision`, not as new |
| CS-3 retry-prevention package | E2 (SHIPPED), F15 (delegation REJECTED), D6/E3, RU-2/RU-3 of `real-user-product.md`, M1/M3/M4 of `claude-subagents.md`, S1–S3 of `native-capability-gaps.md` | eight paths E2 does not cover; adds no delegation; overlaps two sibling candidates and says so |
| §5.1 anchor-repair hook | D1b (OPEN), D2 (DEAD) | killed here by the pipeline order [C]; strengthens D2 |
| §5.2 prefetch | A3 (CLOSED), B12 (INVERTED) | killed here by measured precision bounds |
| §5.3 `--tools` | B17 (DEAD) | identical |
| §5.5 chain budget | C9 (PARKED → DEAD per `codex-cap-x-ss.md`) | identical sign |
| §5.6 hook diff / hook tests | F18 (DEAD), F13 (shared) | identical |

---

## 7. Measurement traps met

1. A `.validateInput(` regex finds five unrelated sites in the Claude Code bundle; the pipeline
   calls `e.validateInput?.(` (optional call). Search both spellings before concluding a function
   is never called.
2. The bundle contains two copies of most strings (a main chunk and a second region near
   offset 75 M in 2.1.258, 89–145 M in 2.1.218); count sites per region before saying "the only".
3. `grep -oh '"name":"[A-Za-z_]*"'` over claude transcripts counts tool names inside text and
   `toolUseResult` blocks too; anchor on `"name":"X","input"` to count `tool_use` blocks.
4. `gh api …/contents/<path>?ref=<tag>` returns 404 for files that moved between the tag and
   `main`; list the directory at the tag first (`codex-rs/config/src/loader/` is a directory at
   0.146.1, not a file).
5. `bypassPermissions` does not disable deny rules, but it does disable *allow* rules; a
   sweet-arm allowlist would be inert in the bench while a denylist is live [W permission-modes].
6. The opencode census `requests.json` holds the canonical 66 sweet rows (33 `fp`, 33 `rp`); a
   naive read of `fp-opencode-tab` alone has 63 sweet rows, 30 superseded.
7. Plan-only request savings must be the counterfactual (output plus re-sent prefix), not the
   request's attributed cost: 27–28% attributed against 12% counterfactual on codex
   [M `verify-tail.md` §5].
8. The claude-code `Task*` family includes two background-task control tools (`TaskOutput`,
   `TaskStop`); denying them would break `Agent` result collection.

---

## 8. Commands and paths

Local repository: `/Users/admin/Projects/sweet-search-private`.

```bash
# §3.1 pipeline order, local 2.1.258 (offsets printed by the script)
python3 - <<'EOF'
import re; b=open('/Users/admin/.local/share/claude/versions/2.1.258','rb').read()
for n in [rb'validateInput\?\.\(', rb'hookUpdatedInput', rb'String to replace not found in file', rb'replacementToolResult']:
    print(n, [m.start() for m in re.finditer(n,b)][:8])
EOF
# same on the box (read-only, stdin script): /root/.local/share/claude/versions/2.1.218
#   validateInput?.( at 255110621; hookUpdatedInput +1891; PreToolUse +3048; safeParse -1991

# §3.2 tool names, fp-claudecode-tab-20260826, main transcripts
R=/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/agent-state
for a in native sweet; do find $R -path "*-$a/*" -name '*.jsonl' -not -path '*subagents*' \
  | xargs grep -oh '"name":"[A-Za-z_]*","input"' | sort | uniq -c | sort -rn | head -16; done

# §3.3 pre/post-edit split over the sibling census
# eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-opencode-calls-per-request/data/requests.json
# split each rollout at the first request with kind == 'E'; count tools in ('read','grep','glob','list')
# for native and ss_env >= 1 for sweet; multi = >= 2 such calls (envelopes) in one request.

# §3.4 codex 0.146.1 config
gh api repos/openai/codex/contents/codex-rs/core/src/config/mod.rs?ref=rust-v0.146.1 --jq .content | base64 -d | sed -n '1033,1034p;2551,2556p'
gh api repos/openai/codex/contents/codex-rs/config/src/config_toml.rs?ref=rust-v0.146.1 --jq .content | base64 -d | grep -n -A8 'struct ToolsToml'
# deployed binary string table (box): /usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex

# §3.5 opencode 1.18.4 sources
curl -sL https://raw.githubusercontent.com/anomalyco/opencode/v1.18.4/packages/opencode/src/session/llm/request.ts | sed -n '208,213p'
curl -sL https://raw.githubusercontent.com/anomalyco/opencode/v1.18.4/packages/opencode/src/config/config.ts | sed -n '396,409p;553,563p'
```

Sibling evidence used: `slate-c/forensics/{verify-tail,phase-anatomy,opencode-calls-per-request,claude-subagents,claude-main-thread,native-capability-gaps,codex-cap-x-ss}.md`;
`slate-c/research/{harness-changelogs,structured-vs-shell-parallelism,agent-efficiency-2026,anthropic-model-product-path,competitor-mechanisms}.md`;
`slate-c/candidates/{inversion-and-removal,real-user-product}.md`. Web: the URLs named inline
(code.claude.com permissions, permission-modes, settings, prompt-caching pages; github.com/openai/codex PR 41744;
raw.githubusercontent.com anomalyco/opencode v1.18.4 and openai/codex rust-v0.146.1).

---

## 9. What I could not finish

1. **No solve-effect estimate exists for CS-1.** The class is behavioural on the model's side
   even though the vehicle is not; only a paired smoke can price it, and the `$0` rule forbids
   one. The kill conditions in §4.1 are pre-registered for that smoke.
2. **Codex at the pin:** I did not find the code that consumes `update_plan_enabled` when
   registering tools (the 0.146.1 tree moved `tools/spec.rs`; six candidate files had zero
   hits). The config key and its default are read from `config/mod.rs`; the prompt mismatch is
   read from the prompt files. Whether luna calls a tool the prompt names but the request omits
   is unmeasured.
3. **Opencode:** I did not run the plugin API or a custom tool; the `before`/`after` hook
   invocation is read from `session/tools.ts`, and the preflight rejection of project plugins is
   read from `config.ts` plus the runner. The include-glob replay and the path-table lookup for
   `glob` were specified, not run.
4. **Claude-code deny rule in the bench:** the docs say deny holds in `bypassPermissions` and
   removes the tool; I did not verify on 2.1.218 that a project `.claude/settings.json` written
   into the run directory is loaded when the runner also mounts a private `~/.claude` with its
   own `settings.json`. A local `claude -p` with `--permission-mode bypassPermissions` and a deny
   rule would settle it at $0 but it is a model call, so I did not run it.
5. **CS-3 replays** (worktree patterns, usage-error re-parse, `/agents` listing) were specified
   and not run; they need a few hours of read-only work against the goldens and a local Claude
   Code, and the `real-user-product` lens already owns RU-2/RU-3.
6. **The prefix-token bonus of CS-1** is an estimate from file sizes at 4.37 bytes per token; the
   claude-code `Task*` description total is a guess (about 5 kB), not a measurement.
