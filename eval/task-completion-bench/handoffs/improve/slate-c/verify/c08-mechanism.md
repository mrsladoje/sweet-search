# c08 — adversarial verify, MECHANISM lens

Candidate: "Put the guide inside claude-code's delegation path with an init-written project
agent definition" (`.claude/agents/Explore.md`, Shape A; or `sweet-explore.md`, Shape B).
Rank 8. Merged from R14 (`candidates/real-user-product.md` RU-2) and R3 item 2
(`candidates/cost-structural.md` CS-3 item 2). Restated in `candidates/DEDUP.md` c08.

Author: workflow verify agent (mechanism lens). Date 2026-09-02. Cost of this study: $0
(trace reading on the evidence box, static reading of two Claude Code binaries, one
documentation fetch, arithmetic). Evidence box read-only. Box scratch:
`/tmp/wf-slatec/c08-mechanism/`. Scripts and raw outputs:
`verify/scripts-c08-mechanism/{c08_count.mjs,c08_cost.mjs,c08_ledger.mjs,data/}`.

Tags: `[M]` measured with a named script, `[C]` read from code, `[W]` web with URL,
`[I]` inferred.

## 0. Verdict — REFUTED as a ranked cost lever. Confidence 0.80.

The mechanism is real. The ceiling is not.

The traces show the mechanism the candidate describes. The sweet arm's eight `Explore`
subagents received no tool guide: their first request is the same size as native's `Explore`
first request to within 20 tokens (background 5,353–5,366 vs 5,346–5,366; foreground
8,532–8,542 vs 8,524–8,562), while the three sweet `general-purpose` subagents carry
+1,516 tokens against native's one `[M c08_cost.mjs]`. The guide-less `Explore` subagents
spent 34 requests before their first working `ss-*` call; the guided `general-purpose`
subagents spent 0 `[M c08_ledger.mjs]`. The code confirms the cause and the proposed fix:
the built-in `Explore` sets `omitClaudeMd:!0`, the user frontmatter schema has no such
field, and a project agent named `Explore` replaces the built-in in the active-agent map
`[C 2.1.258]`.

The ceiling does not survive re-derivation. The whole recoverable amount is $0.0203 over
66 rollouts, $0.000308 per rollout, and that is an upper bound `[M]`. The added cost of
carrying the guide and the inherited CLAUDE.md hierarchy on every subagent request is
$0.000070 to $0.000171 per rollout `[M]+[I]`. The net is −$0.00014 to −$0.00024 per
rollout, −0.66% to −1.15% of the $0.020727 sweet cell. The candidate's −1.7% is 1.5 to
2.6 times the corrected range. The realistic Shape A variant lands at −0.98%, on the
candidate's own pre-registered kill line of 1%. The lever touches 8 launches in 66
rollouts on one harness and $0 on the two harnesses where sweet is dearer.

Two further mechanism facts weigh against it. First, the candidate's frontmatter
(`tools: Bash, Read, Grep, Glob`) is not a like-for-like override: the built-in `Explore`
denies only nine tools (Agent, Edit, Write, NotebookEdit, ExitPlanMode and four Artifact
tools) and keeps SendMessage, WebSearch, WebFetch, Skill and TaskUpdate, which native's
subagents used 67, 7, 4, 2 and 2 times `[C 2.1.258; M]`. Second, in the shipped product the
lever is negative until the worktree project-root fix (RU-3 / M3) ships: 44 of 44 subagent
launches ran with `isolation: "worktree"`, `ss-*` resolves its index from `cwd`, and
`.sweet-search/` is gitignored, so every `ss-*` call inside a worktree subagent exits 2
outside the bench `[M; C]`. The bench runner's `SWEET_SEARCH_PROJECT_ROOT` pin hid this.

What the synthesis must keep from c08: the correction that `Explore` is not tool-starved
(Bash is allowed) is right; the code claim that a project agent inherits CLAUDE.md is right;
override-by-name is confirmed in code; and a config-file vehicle is the only shape that
escapes the recorded instruction-deafness kills. Book it as hygiene sequenced after the
worktree fix, not as a cost lever.

## 1. Does the trace evidence show the mechanism? Yes, with three citation errors

### 1.1 Launch census `[M c08_count.mjs, fp-claudecode-tab-20260826]`

Deduplicated `Agent` tool-use blocks in the main transcripts:

| arm | Explore | general-purpose | total | `isolation: worktree` |
|---|---:|---:|---:|---:|
| native | 30 | 3 | 33 | 33 of 33 |
| sweet | 8 | 3 | 11 | 11 of 11 |
| pooled | 38 | 6 | 44 | 44 of 44 |

The candidate's "Explore 38/44 launches (86.4%)" is arithmetically right and pools both
arms. The lever writes a file only the sweet arm carries. It reaches 8 launches in 66
rollouts (0.12 per rollout), inside 9 delegating rollouts (13.6%). On
`rb-claudecode-20260824` sweet delegated 0 times in 39 rollouts, and on
`fixval-claude-code-20260828` 0 times in 18 sweet rows `[M rows.json, sidechainTurns]`.

### 1.2 Guide visibility by subagent type `[M c08_cost.mjs]`

First usage-bearing request size (input + cache read + cache write tokens):

| type, flag | native | sweet | delta |
|---|---|---|---:|
| Explore, background | 5,346–5,366 (n=15) | 5,353 / 5,360 / 5,366 (n=3) | 0 |
| Explore, foreground | 8,524–8,562 (n=6) | 8,532 / 8,542 (n=2) | 0 |
| general-purpose, foreground | 9,749 (n=1) | 11,265 / 11,268 (n=2) | +1,516 / +1,519 |

Three sweet `Explore` transcripts and one general-purpose transcript have a zero-usage first
request and are excluded from the size comparison. The +1,516 tokens match the guide
(1,457 tokens per the brief) plus rules framing. This re-derives forensics F2. The guide
reaches `general-purpose` through `.claude/rules/sweet-search.md` and does not reach
`Explore`. The mechanism is shown.

### 1.3 Behaviour of guide-less versus guided subagents `[M c08_count.mjs, c08_ledger.mjs]`

| sweet subagent type | n | requests | zero-usage | requests before first working `ss-*` | `--help` | binary hunts | `ss-*` by absolute path |
|---|---:|---:|---:|---:|---:|---:|---:|
| Explore (guide-less) | 8 | 231 | 104 | 34 | 12 | 13 | 213 of 233 |
| general-purpose (guided) | 3 | 133 | 61 | 0 | 0 | 0 | 0 of 102 |

Counts of `ss-*` calls here include `--help` and hunt calls, so they run slightly above the
forensics table (which buckets those separately). The direction and size agree with
forensics F3. Native subagents (n=33) used Bash 347 times, Read 590, SendMessage 67,
WebSearch 7, WebFetch 4, TaskUpdate 2, Skill 2, and Grep and Glob 0 times `[M]`.

### 1.4 Three citation errors in the candidate's evidence line

1. `bfgroup__b2-259-sweet/agent-a8d5f1d037a62e83b.jsonl` is a **general-purpose** subagent
   (guide present), not an `Explore`. It ran Bash 57 times and `ss-*` **57** times, all bare,
   not 90 `[M]`. It is the wrong example for "Explore ran Bash"; the right examples are the
   `Explore` transcripts `a04ad28e63dd30186` (Bash 61, `ss-*` 61 of which 60 by absolute
   path) and `a41e46d3e2671aa14` (Bash 47, `ss-*` 41) `[M]`.
2. `asynkron__protoactor-dotnet-1909-sweet/agent-a3d311866bfc0b7cb.jsonl` ran Bash 25 times
   and `ss-*` 18 times including 2 `--help` and 1 hunt, not 25 `[M]`.
3. "`ss-*` 25–95 times each" is wrong. The per-transcript range over the 11 sweet subagents
   is 9 to 61 with `--help` and hunts included, 5 to 59 without `[M]`.

The qualitative claim — sweet subagents, including `Explore`, ran Bash and `ss-*` — holds.

## 2. Is the ceiling arithmetic right? No; it is 1.5 to 2.6 times too generous

All dollars are the ledger's ideal (cache-normalised) cost at the registered luna price
(in $0.10, cache $0.01, out $0.60 per million), computed with the ledger's own
`costFromTurns` from `harness/ideal-cost.mjs`, with zero-usage requests imputed from
neighbours as the forensics study did `[M c08_ledger.mjs]`.

### 2.1 Denominators re-derived

- Sweet sidechain, tab run: Explore $0.218537 + general-purpose $0.109572 = **$0.3281**
  (recorded-only $0.1977). Native sidechain $0.4210 (recorded $0.2987). Sweet main thread
  `idealCostMainOnlyUsd` sum $0.9728. Sweet arm inclusive **$1.3009**, $0.019710 per
  rollout. All four agree with forensics §5–§6.3 to the fourth decimal `[M]`.
- The brief's cell figure $0.020727 is realized cost; the candidate's percentages use it.
  I use it too, so the comparison is like-for-like.

### 2.2 Gross recoverable amount

| component | forensics (all 11 sweet subagents) | this study, Explore only | note |
|---|---:|---:|---|
| requests before the first working `ss-*` | 31 req, $0.0182 | 34 req, $0.0193 | criterion differs slightly (a rejected `--help` counts as not-working here) |
| later requests whose every `ss-*` call failed | 15 req, $0.0073 | 2 req, $0.0010 | forensics' figure spans the whole transcript and includes the 3 guided general-purpose subagents (6 req, $0.0038), which already had the guide |
| union | ≤ $0.0255 | **$0.0203** | |

The candidate books the $0.0255 union as recoverable. $0.0038 of it is failures inside
subagents that already carried the guide, which this lever cannot touch. The Explore-only
recoverable amount is **$0.0203 per 66 rollouts = $0.000308 per rollout = 1.49% of the
cell**. This is an upper bound: it assumes a guided `Explore` makes zero pre-`ss-*`
requests, which rests on three general-purpose transcripts.

### 2.3 Added cost

The 8 sweet `Explore` subagents made 231 requests (14, 11, 15, 58, 34, 54, 30, 15), mean
28.9, not the 14 the candidate used (14 is native's median) `[M]`. Each launch pays the
added tokens once at the input rate and then once per further request at the cache rate.
A project agent always inherits the CLAUDE.md hierarchy `[C]`; in the bench that is the
frame in `CLAUDE.md` (about 754 tokens `[C claude-code-task-runner.mjs:310]`) plus the
guide in `.claude/rules/sweet-search.md` (measured +1,516).

| variant | tokens per request | added over 66 rollouts | per rollout |
|---|---:|---:|---:|
| candidate's figure (guide only, 14 re-sends) | 1,516 | — | $0.0000437 |
| guide only, measured request counts | 1,516 | $0.004593 | $0.0000696 |
| guide + frame via inherited hierarchy (Shape A minimum) | 2,270 | $0.006878 | $0.000104 |
| guide in agent body + guide via rules + frame (naive Shape A) | 3,727 | $0.011293 | $0.000171 |

The built-in `Explore` system prompt is about 2,365 characters, roughly 590 tokens
`[C 2.1.258, function t5r]`. A Shape A body that keeps that prompt and relies on the
inherited rules file for the guide is the minimum variant.

### 2.4 Net and requests

| variant | net per rollout | share of $0.020727 | 
|---|---:|---:|
| guide only | −$0.000238 | −1.15% |
| Shape A minimum | −$0.000204 | −0.98% |
| naive Shape A | −$0.000137 | −0.66% |
| candidate | −$0.00035 | −1.7% |

Requests: 34 of 66 = **−0.52 requests per rollout** as an upper bound. The candidate's
"about −0.5 requests" holds. The dollar ceiling does not: the candidate's −1.7% is 1.5 to
2.6 times the corrected range, and the realistic variant sits at the candidate's own 1%
kill line. Codex and opencode: 0 delegating rows in 132 codex and 129 opencode rows
(261, not 264) `[M rows.json]`.

### 2.5 Solves are not traded in the bench

Sweet's 9 delegating rollouts: 4 solved, all on tasks solved in every rep; 5 failed, all on
tasks failed in every cell `[M rows.json; forensics §4]`. Delegation flipped 0 of 6 tasks.
The lever changes only those rollouts' sidechains, so the bench solve exposure is about
zero. Production solve risk for Shape A (replacing the exploration prompt) is real and
unpriced; the candidate says so.

## 3. Code facts the synthesis must adopt

Read from `/Users/admin/.local/share/claude/versions/2.1.258` (local) and
`/root/.local/share/claude/versions/2.1.218` (box) `[C]`, and
`https://code.claude.com/docs/en/sub-agents` fetched 2026-09-02 `[W]`.

1. **Built-in `Explore` definition (2.1.258, offset 162228062):**
   `disallowedTools:[yt,...Iie,r_,zt,jn,fc]`, `model:"inherit"`, `omitClaudeMd:!0`, no
   positive `tools` list. Resolved identifiers: `yt="Agent"`, `Iie=["Artifact",
   "ArtifactComments","ArtifactData","ArtifactCheck"]`, `r_="ExitPlanMode"`, `zt="Edit"`,
   `jn="Write"`, `fc="NotebookEdit"`. **Bash is not denied.** The candidate's correction to
   `research/anthropic-model-product-path.md` §5.2 ("Explore has no Bash") is right, and the
   current documentation agrees ("read-only tools; Write and Edit are denied"). 2.1.218 on
   the box has the same shape (six identifiers, `omitClaudeMd:!0`, `model:"inherit"`);
   identifiers not resolved there.
2. **"The gap is `omitClaudeMd` only" is incomplete.** The candidate's frontmatter
   `tools: Bash, Read, Grep, Glob` is an allowlist. It removes SendMessage, WebSearch,
   WebFetch, Skill, TaskUpdate and TodoWrite, which the built-in keeps and native's
   subagents used (67, 7, 4, 2, 2 times) `[M]`. A like-for-like override must use
   `disallowedTools: Agent, Edit, Write, NotebookEdit, ExitPlanMode` (plus the Artifact
   tools) and no `tools` line.
3. **Model resolution is source-gated (offset ~162228700):**
   `function oX(e,n){if(e.agentType!==O0.agentType||e.source!=="built-in")return e.model; ...
   return o5r(n)?{inheritCap:"opus"}:"inherit"}`. A project `Explore` returns its own
   `model` with no cap. The docs say the same: "A user or project subagent named Explore
   overrides the built-in and keeps its own model field." With `model: inherit` on a
   higher-than-Opus main model, exploration runs on that tier. Set the model explicitly.
   The bench cannot see this because the proxy served every requested model as luna.
4. **Frontmatter schema (offset ~162252190)** accepts `tools, disallowedTools, prompt,
   model, effort, permissionMode, mcpServers, hooks, maxTurns, skills, initialPrompt,
   memory, background, isolation, observer, observerMessage, observeSubagents`. No
   `omitClaudeMd`. The candidate's central code claim holds. (The bare string at offset
   74500084 is a string table entry, not a schema field.)
5. **Override by name is in code (offset ~162252190, `UF`):** the active-agent map is filled
   in the order built-in → plugin → userSettings → projectSettings → flagSettings →
   policySettings, keyed by `agentType`, later wins. A project `Explore.md` therefore
   replaces the built-in on 2.1.258. The candidate's remaining `$0` falsifier ("confirm via
   `/agents`") is answered by code for 2.1.258. Not confirmed from the 2.1.218 binary.
6. **Spawn path (offset 163775014):** `ys = e.omitClaudeMd && !B?.userContext` drops
   CLAUDE.md only when the definition says so; `Dr = (agentType==="Explore"||"Plan") ? dr : Rr`
   drops git status **by name**. Shape A keeps the git-status omission; Shape B loses it and
   costs more per launch.
7. **Production dependency.** `eval/agent-read-workflows/bin/_ss-helpers.mjs:136-142`:
   `PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd()` and
   `process.exit(2)` when `<root>/.sweet-search/codebase.db` is missing. `.gitignore:12`
   lists `.sweet-search/`. `harness/agent-runner-shared.mjs:142` pins
   `SWEET_SEARCH_PROJECT_ROOT: rundir`. All 44 bench subagents ran in worktrees `[M]`.
   Outside the bench a worktree subagent has no index and every `ss-*` call fails at once.
   A guide-carrying `Explore` would then spend its requests on failing calls. c08 must be
   sequenced after RU-3 / M3 (worktree-aware project root), which it does not state.
8. **Ledger.** In `fp-claudecode-tab-20260826/rows.json` all 9 sweet and all 28 native
   delegating rows have `costRealizedUsd` null; the priced sweet mean ($0.015127, n=57) is
   a non-delegating mean `[M]`. The lever's effect is invisible to the published mean until
   the sidechain ledger repair (register G1/G6) lands.
9. **Documentation `[W]`:** "Explore and Plan skip your CLAUDE.md files and the parent
   session's git status ... Every other built-in and custom subagent loads both." "Output
   style: a subagent runs its own system prompt ... Auto memory: the main conversation's
   auto memory isn't loaded." Project subagents are discovered by walking up from the
   working directory; priority: managed settings > `--agents` flag > `.claude/agents/` >
   `~/.claude/agents/` > plugins.

## 4. Register check (mechanism view)

- **F15 (delegation for sweet, DEAD)** — Shape A adds no delegation; Shape B "helps only if
  the model chooses it", which is asking for more delegation and is F15.
- **B18 (richer launch brief, DEAD)** — c08 meets B18's letter ("re-score on-ledger") but the
  re-score is 0.66–1.15% of one harness, the segment is still null in `rows.json`, and the
  sweet-side exposure is 8 launches in 66 rollouts (0 in the two adjacent runs).
- **E10 (coprocessor, DEAD live at +79%)** — the only live measurement of changing
  claude-code's exploration path went the wrong way by an order of magnitude against its
  `$0` prediction. A `$0`-derived −1% on the same path deserves no more trust.
- **New register fact (favours the vehicle):** the guide's sentence "Any sub-agent you
  delegate to must use these `ss-*` tools, with this system prompt verbatim"
  (`sweet-search-system-prompt.md:24`) was half-obeyed 26 of 27 times and fully obeyed 0
  of 27 `[M forensics §2.1]`. Prose cannot deliver the guide to a subagent; only a config
  file can.

## 5. What I could not finish

- I did not confirm the override-by-name merge order in the 2.1.218 bundle on the box
  (identifier names differ; the pattern search returned nothing). 2.1.258 and the current
  documentation both confirm it.
- Subagent system prompts are not written to transcripts. Guide presence is inferred from
  first-request size deltas and behaviour, as in the forensics study.
- I did not price the extra `Read` and raw-shell calls guide-less `Explore` subagents made
  after their first working `ss-*` call. The gross figure is therefore a lower bound on
  dilution and the net is an upper bound on saving only under the zero-pre-`ss-*`
  assumption; the two effects pull in opposite directions and neither can move the result
  past 2% of the cell.
- I did not run a live Claude Code to list `/agents`; the code reading replaces that check
  for 2.1.258 only.

## Appendix. Paths, ids, commands

- Run: `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/`
  (`rows.json`, `agent-state/<task>-<arm>/claude-home/projects/<slug>/<session>.jsonl`,
  `.../<session>/subagents/agent-<id>.jsonl`). Also `rows.json` of
  `fixval-claude-code-20260828`, `rb-claudecode-20260824`, `fp-codex-tab-20260826`,
  `fp-opencode-tab-20260826`.
- Sweet subagent transcripts opened: `a3d311866bfc0b7cb`, `a0d415047c0776a3e`,
  `a484cf2677177e8ef`, `abd536db90e42b25d`, `a41e46d3e2671aa14`, `a04ad28e63dd30186`,
  `a8d5f1d037a62e83b`, `a914bc3d20e9a67cc`, `abf1061910955a4c6`, `a61852622b2fb2c36`,
  `a38e681945774a613`; all 33 native subagent transcripts in the tab run.
- Scripts: `verify/scripts-c08-mechanism/c08_count.mjs` (launch census, per-transcript tool
  counts, `isolation` census), `c08_cost.mjs` (first-request sizes), `c08_ledger.mjs`
  (ledger-footed dilution, sidechain totals, added-cost variants). Box copies and outputs
  under `/tmp/wf-slatec/c08-mechanism/`; outputs copied to `scripts-c08-mechanism/data/`.
- Binaries: `/Users/admin/.local/share/claude/versions/2.1.258` (offsets 162228062,
  162233275, 162249033, 163775014, 162252190, 162224511, 158092705, 159196026, 158792439,
  158793099, 158794530, 159237486); `/root/.local/share/claude/versions/2.1.218`.
- Code: `eval/agent-read-workflows/bin/_ss-helpers.mjs:136-142`; `.gitignore:12`;
  `harness/claude-code-task-runner.mjs:7,49-58,310-316`; `harness/agent-runner-shared.mjs:134-142,242-250`;
  `harness/ideal-cost.mjs:84-109`; `scripts/write-claude-rules.js`; `scripts/inject-agent-instructions.js`.
- Web: `https://code.claude.com/docs/en/sub-agents` (fetched 2026-09-02 with curl; sections
  "Built-in subagents", "Choose the subagent scope", "Supported frontmatter fields",
  "What loads at startup").
- Sibling reports read: `forensics/claude-subagents.md`, `research/anthropic-model-product-path.md` §5,
  `candidates/real-user-product.md` RU-2, `candidates/cost-structural.md` CS-3,
  `candidates/DEDUP.md` c08, `verify/c08-history.md`, `verify/c08-measurability.md`.
