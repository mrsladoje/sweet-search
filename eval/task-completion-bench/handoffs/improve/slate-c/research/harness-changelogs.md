# Harness changelogs since the pinned versions — what moved the tool economics

**Task:** Slate C research, "harness-changelogs". **Date:** 2026-09-02. **Cost:** $0. No rollout
was launched. Nothing under `results/` was written. Scratch is local only.

Tags on every number: **[M]** measured here (script or command named) · **[C]** read from a
deployed binary, a shipped type definition, or vendor source · **[W]** web source with URL ·
**[I]** inferred with the arithmetic shown.

---

## 0. Verdict

**The three harnesses changed very little in tool economics since the pins, but the pinned
binaries already carry two mechanisms this programme has never used, and one of them removes
the whole opencode cost gap without the model cooperating.**

Five results, in order of how much they change the plan.

1. **OpenCode's plugin API — at the pinned 1.18.4 — lets a plugin rewrite the *arguments* and
   the *output string* of the harness's own built-in `read`, `grep` and `glob` tools.** [C]
   `tool.execute.before` returns `{args}`; `tool.execute.after` returns `{title, output,
   metadata}`. Sweet-search can therefore serve its index through opencode's native structured
   tool surface. That surface is the one the model emits in parallel batches. The entire
   opencode penalty is that a Bash `ss-*` call is one call per request (1.11 calls/request)
   while native structured tools are 1.55, costing **+3.4 requests = +10.2%**. Removing that
   term takes opencode sweet from `$0.009265` to about `$0.008320` against native `$0.008968`,
   a **7.2% win** instead of a 3.3% loss. [I, arithmetic in §5.1]
2. **The claude-code read-before-edit product risk is not real, and was not real at the pin.**
   [C] The `Edit` guard is skipped unless the model id is in a hardcoded set of **ten legacy
   Claude models** — `claude-opus-4-6, claude-haiku-4-5, claude-opus-4-5, claude-opus-4-1,
   claude-opus-4-0, claude-sonnet-4-5, claude-sonnet-4-0, claude-3-7-sonnet, claude-3-5-sonnet,
   claude-3-5-haiku`. Opus 5, Sonnet 5, Fable 5 and 5.1, Opus 4.7 and Opus 4.8 are all absent,
   in both 2.1.218 and 2.1.258. The `Write` tool was stricter at the pin (a per-model remote
   flag, default off = guard on); **2.1.228 aligned `Write` with `Edit`**. Register item D6 and
   BRIEF §1.1's "real Claude users would pay one failed Edit plus one Read per edited file"
   should both be closed as **not real on any current model**.
3. **`claude --tools <list>` restricts the built-in tool set, exists in both 2.1.218 and
   2.1.258, and the bench runner does not use it.** [C][M] Naming only the tools the sweet arm
   needs drops the `Read`, `Grep`, `Glob`, `Task` and todo-tool schemas out of the cached
   prefix. That is worth **2.0–3.0% of a claude-code sweet rollout**, the same order as the
   gutter and the tool guide, and it costs no information the sweet arm uses. [I, §5.2]
4. **All three harnesses can now inject or transform context without the model cooperating.**
   Codex 0.146.1 already ships `PreToolUse` / `PostToolUse` / `UserPromptSubmit` hooks with
   `updatedInput` and `additionalContext` [C]; 0.148.0 let hooks run asynchronously and call MCP
   tools [W]; 0.151.0 let extensions inspect or replace MCP tool results [W]. Claude Code has
   `updatedInput` in both bundles [C]. This is the missing delivery channel for a computed
   certificate: register F9 showed delivered computed facts flip tasks, and a `PostToolUse`
   `additionalContext` delivers one **at zero extra requests**.
5. **Prices did not move.** `openai/gpt-5.6-luna` reads `$0.20 / $1.20` in and out per million
   with `$0.02` cache read and `$0.25` cache write, unchanged from the 08-28 reading [M
   OpenRouter models API, 2026-09-02]. Every percentage in the programme stays valid. The one
   new pricing fact that matters: **Claude Fable 5.1's cache read is `$0.25` per million against
   a `$10.00` input rate — a 40× discount, not the usual 10×** — so on Fable 5.1 a context
   token's true price is 1.50× sticker instead of 3.01×, and request-count levers are worth
   roughly half what they are worth on luna, Opus 5 or Sonnet 5. [M, §4]

Two things I must say plainly. Findings 1, 3 and 4's codex half are **new to this programme but
not new to the binaries**: they were available at the pinned versions and nobody used them. I
label each one that way below. And the public claude-code hooks reference documents a
`replacementToolResult` field for `PreToolUse` that **appears zero times in either the 2.1.218
or the 2.1.258 bundle** [C], so do not build on it without a check.

---

## 1. Version drift, measured

| harness | pinned | latest today | releases between | dates |
|---|---|---|---:|---|
| codex CLI (`@openai/codex`) | 0.146.1 | **0.152.1** | 6 stable (0.147.0, 0.148.0, 0.149.0/.1, 0.150.0/.1, 0.151.0, 0.152.0/.1) | pin 2026-08-05 → 2026-09-01 |
| opencode (`opencode-ai`) | 1.18.4 | **1.18.26** | 22 patches, no minor | pin 2026-07-20 → 2026-09-01 |
| claude-code (`@anthropic-ai/claude-code`) | 2.1.218 | **2.1.258** | 33 published entries | pin 2026-07-22 → 2026-09-02 |

[M] `npm view @openai/codex version`, `npm view opencode-ai version`,
`npm view @anthropic-ai/claude-code version`, GitHub releases API for `openai/codex` and
`anomalyco/opencode`, `raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`.
[M] Deployed on the evidence box: `codex-cli 0.146.1`, `opencode 1.18.4`,
`/root/.local/share/claude/versions/2.1.218` — all three still at the pins.

---

## 2. What actually changed, per harness

### 2.1 Claude Code 2.1.219 → 2.1.258

Ranked by effect on tool economics. Each line is verbatim from the changelog unless marked.

**Read-before-edit and the tool contract**

- **2.1.228** — "Changed the Write tool so newer models can overwrite an existing file they
  haven't read this session, matching the Edit tool's rules; older models still require the read
  first." [W] I verified the mechanism on both bundles [C]:
  - **2.1.218 `Write`**: `f = !c && Xe(nji("tengu_velvet_mallet", model), false)` — guard skipped
    only when a per-model remote feature flag is on, and the default is `false`. So at the pin,
    `Write` demanded a prior read for **every** model.
  - **2.1.218 `Edit`**: `A = !rji(model) && readAutoAllowed`, with
    `rji(e){return grg.has(oa(e))}` and `grg = new Set(["claude-opus-4-6","claude-haiku-4-5",
    "claude-opus-4-5","claude-opus-4-1","claude-opus-4-0","claude-sonnet-4-5","claude-sonnet-4-0",
    "claude-3-7-sonnet","claude-3-5-sonnet","claude-3-5-haiku"])`.
  - **2.1.258 `Write` and `Edit`** both use `mYe(model, remoteCall)` with the *same* ten-model
    set `N`, so `Write` now matches `Edit`.
  - Telemetry field names confirm this is deliberately instrumented:
    `tengu_edit_tool_not_read_hypothetical` / `tengu_write_tool_not_read_hypothetical` with
    `{wouldHaveResult, isPartialView, isFilePathAbsolute, guardSkipped, modelBucket, servedCall,
    callerModelBucket}` [C].
  - `modelBucket` comes from `rJe(e)`: strip a trailing `[1m]`, strip a leading `claude-`,
    replace `-` with `_`, then require `^[a-z0-9_]{1,40}$` or emit `"nonconforming"` [C]. The
    bench's `openai/gpt-5.6-luna` contains `/` and `.`, so **every bench rollout is bucketed
    `nonconforming`** — outside every Anthropic bucket, which is why the guard never fired.
- **2.1.258 Edit description, read from the binary** [C]: there are now **two** description
  families (a full one and a "lean" one, selected by a model-dependent predicate `CA({model,
  leanPrompt})`), and each has a tab/colon variant selected by `iz() = kU("tengu_tab_read_sep",
  false)`:
  - full family: `"line number + a single separator character (a tab or \`:\`)"` when on,
    `"line number + tab"` when off;
  - **lean family (new to this programme)**: `"line number + a single tab or \`:\`"` when on,
    `"line number + tab"` when off.
  - Research document 05 §0 recorded only the full family. The gate still defaults to **false**,
    so the live contract is still `"line number + tab"`. **Register C5's revival condition ("the
    claude-code separator gate flips") has not been met.**
  - Two further gates 05 did not record: `tengu_edit_minimalanchor_jrn` (default false) adds
    *"Keep `old_string` minimal — usually 1-3 lines... Including excess context wastes tokens and
    is an error"*; `tengu_amber_wren` carries `{maxSizeBytes, maxTokens, includeMaxSizeInPrompt,
    targetedRangeNudge}` for the `Read` tool [C].

**Read-tool caps — a correction to research document 06 §5.2**

06 said the claude-code `Read` token cap "comes from the model profile". The binary says
otherwise [C, 2.1.258 and 2.1.218 both]:

```js
var gYr = 25000;                                  // default Read max tokens
function hYr(){ let e = env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS;
                if (e !== undefined && e > 0) return e; return; }
maxTokens: hYr() ?? (tengu_amber_wren.maxTokens ?? gYr)
```

So the cap is a constant 25,000 with **two overrides: a plain environment variable
`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`, and a remote config value**. Not a model profile.

**Tool surface and the cached prefix**

- **`--tools <tools...>`** — "Specify the list of available tools from the built-in set. Use `""`
  to disable all tools, `default` to use all tools, or specify tool names (e.g.
  `"Bash,Edit,Read"`)." [C `claude --help` on 2.1.258; the identical help string is present in
  the 2.1.218 bundle, so **this is not new since the pin**]. The bench runner passes
  `--append-system-prompt` and `--permission-mode bypassPermissions` and **never passes
  `--tools`** [M, grep of `harness/claude-code-task-runner.mjs`].
- **2.1.248** — "Added `--restricted` (or `CLAUDE_CODE_RESTRICTED=1`): removes the built-in tools
  that run commands or code and `WebFetch` (unless named in `--tools`), keeps file tools inside
  the working directory, **refuses `bypassPermissions`**, and ignores user, project and local
  settings files." [W] The refusal of `bypassPermissions` makes `--restricted` unusable in this
  bench; `--tools` on its own is the usable half.
- **2.1.233** — "Todo/task-tracking tools (TaskCreate/Get/Update/List, TodoWrite) are no longer
  available on Opus 4.8, Sonnet 5, Fable 5, Mythos 5, and newer models; set
  `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` to bring them back." [W] Model-gated again. `luna` is not in
  that list, so **the bench keeps a tool block that a real Anthropic-model user no longer has**.
- **2.1.248** — "Improved the Workflow tool's prompt footprint: its description is now about 1k
  tokens instead of 5.7k, with the script-writing reference moved into a bundled
  `workflow-authoring` skill." **2.1.234** — "Reduced the context cost of loading the built-in
  `claude-api` skill from ~200k+ tokens to ~25k by loading reference docs on demand." [W] Both
  are Anthropic doing exactly the trade §5.4 evaluates for the sweet tool guide.

**Prompt caching (all shared, none differential)**

- **2.1.243** — "Added `promptCacheTtl` and `subagentPromptCacheTtl` settings so API-key and
  cloud-provider users can keep a 1-hour prompt cache on the main conversation while subagents
  stay at 5 minutes." [W] Absent from 2.1.218 [C].
- **2.1.248** — "Added `experimental.cacheTtl` (`"5m"` or `"1h"`) to agent frontmatter." [W]
- **2.1.248** — "Fixed a prompt-cache miss (and lost extended-thinking context) roughly once an
  hour in long sessions, caused by tool definitions being re-rendered after an OAuth token
  refresh." [W] Our rollouts are minutes long, so this never bit us.
- **2.1.229** — "Improved workflow fan-outs to stagger same-prefix sibling agents so subsequent
  agents read the cached prompt prefix instead of re-paying it
  (`CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS=0` disables)." [W]
- **2.1.232** — "Subagent forking is now on by default: a `subagent_type: "fork"` subagent
  inherits the full conversation and prompt cache." [W] **This changes native claude-code's
  delegation economics** on any future run: native delegated in 15 of 22 fresh-pool task-cells
  and each subagent paid a fresh uncached 5,300–8,500-token bundle [M, 06 §5.4]. Under forking,
  that bundle is a cache read instead.
- **2.1.221** — "Reduced prompt-cache costs for auto-mode permission checks by reusing the cached
  conversation prefix across decisions." [W] We run `bypassPermissions`, so this is inert here.

**Compaction and context windows**

- **2.1.223** — "Changed auto-compact to keep sessions on **unrecognized model IDs** within the
  assumed context window instead of letting them grow past it; set
  `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` to restore the previous behavior." [W]
  See trap T2.
- **2.1.223** — "Changed `CLAUDE_CODE_DISABLE_1M_CONTEXT` to hold every Claude model with a
  native 1M window to 200K via auto-compaction." [W]
- **2.1.247** — "Changed Sonnet 5's default auto-compact window to its full 1M context, so
  sessions on the 1M window now auto-compact at about 967K tokens instead of about 934K." [W]
- **2.1.238** — "Fixed unbounded memory growth in long interactive sessions: subagent tool
  results are now released once they leave the recent display window." [W] Memory, not context.

**Hooks**

- **2.1.251** — "Added `PreModelSwitch` and `PostModelSwitch` hook events; `SessionStart` resume
  hooks now receive session staleness and the estimated re-cache cost." [W]
- **2.1.219** — "Added `DirectoryAdded` hook." [W]
- **2.1.222** — "Fixed PreToolUse auto-allow hooks bypassing tool restrictions in background
  agent tasks." [W]
- The full event list today [W code.claude.com/docs/en/hooks]: `UserPromptSubmit`,
  `UserPromptExpansion`, `Stop`, `StopFailure`, `PreToolUse`, `PermissionRequest`,
  `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `SessionStart`,
  `Setup`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCreated`,
  `TaskCompleted`, `FileChanged`, `DirectoryAdded`, `CwdChanged`, `ConfigChange`,
  **`InstructionsLoaded`**, `WorktreeCreate`, `WorktreeRemove`, `MessageDisplay`,
  `PreModelSwitch`, `PostModelSwitch`, `Notification`, `PreCompact`, `PostCompact`,
  `Elicitation`, `ElicitationResult`.
- `PreToolUse` documented output: `{permissionDecision, permissionDecisionReason,
  **updatedInput**, **replacementToolResult**, additionalContext, systemMessage}` [W].
  `PostToolUse` may append `additionalContext` [W].
  **Binary check** [C]: `updatedInput` appears 79 times in 2.1.218 and 99 times in 2.1.258;
  `additionalContext` 45 times in 2.1.218; **`replacementToolResult` appears 0 times in either**.
  `PostToolBatch`, `InstructionsLoaded`, `UserPromptExpansion` and `PermissionDenied` are all
  present in **both** bundles, so the hook surface itself is not new since the pin.

**Instruction files**

- `claudeMdExcludes` exists in both bundles [C]; **2.1.239** fixed it "not excluding a symlinked
  `.claude/rules` file" [W]. **2.1.257** — "Fixed settings in `.claude/` folder created after
  startup not being picked up" and "Fixed `/add-dir` rejecting a directory inside the current
  working directory; it now loads that directory's skills, commands, and agents" [W].

### 2.2 Codex CLI 0.147.0 → 0.152.1

**Genuinely new since the pin**

- **0.152.0 (2026-09-01)** — "**Individual MCP tools support an `output_token_limit` setting**,
  with consistent truncation across session resumes." (#41421) [W] The PR adds "a positive
  `output_token_limit` setting to each entry under an MCP server's `tools` configuration",
  applies "the most restrictive limit when plugin and user policies overlap", and carries "the
  effective MCP output budget in conversation history so tool output, post-tool hook responses,
  and resumed sessions use the same truncation limit" [W PR #41421]. **Verified new**: the
  literal `output_token_limit` occurs in 0.146.1 only as a substring of `tool_output_token_limit`
  (16 hits each, the same lines) [M].
- **0.152.0** — "The planning tool is disabled by default; enable it with
  `tools.update_plan.enabled = true`." (#41744) [W] A default prefix shrink that lands in **both**
  arms on upgrade. See trap T7.
- **0.152.0** — #41260 "Let the history backend enforce tool output budgets" [W].
- **0.151.0 (2026-08-29)** — "**Extensions can now inspect or replace MCP tool results before
  they reach the model.**" (#41202) [W]
- **0.150.0 (2026-08-26)** — "New `Interrupt` hooks can run commands or MCP handlers when an
  active top-level turn is interrupted." (#40511) [W]
- **0.150.0** — "**Untrusted projects no longer supply project-level `AGENTS.md` instructions**,
  and managed deny-read rules remain enforced after permission changes." (#39837, #40004) [W]
  See trap T1. Paired with **0.147.0** #36960 "Require explicit trust for unfamiliar local
  projects" [W].
- **0.148.0 (2026-08-18)** — "Hooks can now run commands asynchronously and invoke MCP tools."
  (#37533, #38705) [W]; #37363 "Recognize MCP tool hook configurations"; #37424 "Cap project
  instructions across environments" [W].
- **0.147.0 (2026-08-07)** — "Support the opt-in MCP 2026-07-28 protocol, including **paginated
  discovery**, multi-round requests, and non-blocking server startup." (#35724, #35725, #35590,
  #35742) [W]; #35608 "Support model-owned token budget defaults"; #35773 "Scale skill metadata
  budgets with context windows"; #35769 "Share the skills budget across host and executor
  catalogs" [W].
- **0.149.0** — #38978 "Add a configurable skill catalog token budget" [W].
- **0.150.0** — #39757 and #39772 "Standardize shell execution on unified exec"; **0.152.0**
  #41393 "Preserve one-shot exec when unified exec is disabled" [W]. The exec path our runs use
  is being consolidated, which is the path the ~2,500-token cap sits on.

**Already present at the pin — new to this programme, not new to codex** [M, string counts on
the deployed 0.146.1 binary]

| marker | hits in 0.146.1 |
|---|---:|
| `PreToolUse` | 38 |
| `PostToolUse` | 33 |
| `UserPromptSubmit` | 9 |
| `updatedInput` | 6 |
| `additionalContext` | 28 |
| `tool_output_token_limit` | 16 |
| `disabled_tools` / `enabled_tools` | 20 / 21 |
| `compact_prompt` | 21 |
| `unified_exec` | 51 |
| `skills` | 274 |

Hook contract today [W learn.chatgpt.com/docs/hooks]: events `SessionStart`, `SessionEnd`,
`PreToolUse`, `PostToolUse`, `PermissionRequest`, `PreCompact`, `PostCompact`,
`UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`. TOML shape:

```toml
[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = '/usr/bin/python3 "script.py"'
timeout = 30
statusMessage = "Checking Bash command"
```

Output fields: `continue`, `stopReason`, `systemMessage`, `additionalContext`. **`PreToolUse` can
return `updatedInput` to rewrite tool arguments before execution; `PostToolUse` can inject
`additionalContext` for model visibility after tool completion.** Default timeout 600 s. [W]

Config keys relevant here, from the published sample [W learn.chatgpt.com config-sample]:
`tool_output_token_limit = 12000  # tokens stored per tool output`;
`project_doc_max_bytes = 32768`; `project_doc_fallback_filenames = []`;
`model_auto_compact_token_limit`; `model_auto_compact_token_limit_scope = "total" | "body_after_prefix"`;
**`compact_prompt = ""  # Inline override for the history compaction prompt`** (not in 06);
`[mcp_servers]` with `enabled = true`, `required`, `startup_timeout_sec`, `tool_timeout_sec`,
**`enabled_tools` / `disabled_tools` allow and deny lists** (not in 06);
`[[skills.config]] enabled = false`; `[tools] view_image = true`.

### 2.3 OpenCode 1.18.5 → 1.18.26

**Nothing in the release notes touches tool economics.** [M] I read all 22 release bodies from
the GitHub releases API and grepped them for read/grep/glob/edit/patch/tool/AGENTS/instruction/
compact/cache/prompt/plugin/hook/parallel/truncate/limit/MCP. Everything that matched was
provider authentication (Azure, Bedrock), desktop UI, or a narrow bug fix. The nearest items:
1.18.15 "Repeated compaction now keeps earlier tool-call history in summaries instead of dropping
orphaned results"; 1.18.17 "Made session compaction keep complete recent turns"; 1.18.26
"`apply_patch` no longer emits an empty move path in permission metadata". None reaches our
economics because compaction never fires on this bench.

**The plugin API did not change either.** [M] I unpacked `@opencode-ai/plugin@1.18.4` and
`@1.18.26` and diffed the hook-name sets: **identical**.

**What the pinned 1.18.4 plugin API already offers** [C, `package/dist/index.d.ts`]:

```ts
"tool.execute.before"?: (input:{tool:string; sessionID:string; callID:string},
                         output:{args:any}) => Promise<void>;
"tool.execute.after"?:  (input:{tool:string; sessionID:string; callID:string; args:any},
                         output:{title:string; output:string; metadata:any}) => Promise<void>;
"experimental.chat.messages.transform"?: (input:{}, output:{messages:{info:Message;parts:Part[]}[]}) => Promise<void>;
"experimental.chat.system.transform"?:   (input:{sessionID?:string; model:Model}, output:{system:string[]}) => Promise<void>;
"chat.params"?:  (... output:{temperature; topP; topK; maxOutputTokens; options}) => Promise<void>;
"chat.headers"?: (... output:{headers:Record<string,string>}) => Promise<void>;
"experimental.session.compacting"?: (... output:{context:string[]; prompt?:string}) => Promise<void>;
"experimental.compaction.autocontinue"?: (... output:{enabled}) => Promise<void>;
```

`tool.execute.after` returns the tool's **output string**, so a plugin can replace what the model
sees for any tool, built-in included. `experimental.chat.messages.transform` rewrites the whole
message array sent to the model.

**Custom structured tools, also at the pin** [C, string in the deployed 1.18.4 binary: *"`.ts`
files in `.opencode/tools/` to define new LLM tools"*; W opencode.ai/docs/custom-tools, dated
2026-09-01]: files in `.opencode/tools/` or `~/.config/opencode/tools/` export
`tool({description, args, execute})` and "function as native structured tools alongside built-ins
like `read`, `write`, and `bash`. **They can override built-in tools if using identical names.**"

**Config keys** [W opencode.ai/docs/config, dated 2026-09-01]: `"tools": {"write": false, "bash":
false}` disables built-in tools; `"instructions": [paths and globs]` adds instruction files;
`"compaction": {"auto": true, "prune": false, "reserved": 10000}` where `prune` means "removing
old tool outputs to save tokens". [C] `SessionCompaction.prune` and `if(!cfg.compaction?.prune)
return;` are both present in the pinned 1.18.4 binary, so **prune is not new and is gated inside
compaction**, which never fires here. Register B5 stands.

**The parallel-emission instruction is already maximal.** [C] The deployed 1.18.4 system prompt
contains, verbatim:

> "You have the capability to call multiple tools in a single response. When multiple independent
> pieces of information are requested, batch your tool calls together for optimal performance.
> **When making multiple bash tool calls, you MUST send a single message with multiple tools
> calls to run the calls in parallel.** For example, if you need to run "git status" and "git
> diff", send a single message with two tool calls to run the calls in parallel."

The sweet arm still emitted 1.11 calls per request. **No prompt can close the opencode request
gap; the instruction is already there and luna ignores it.** This is independent structural
support for register A1 ("luna instruction-deaf") and it forecloses the prompt branch entirely.

---

## 3. What did not change — negatives that close hypotheses

| # | claim | evidence |
|---|---|---|
| N1 | The claude-code tab-separator gate has **not** flipped. `tengu_tab_read_sep` still defaults to `false` in 2.1.258, so the live Edit contract is still `"line number + tab"`. | [C] `function iz(){return kU("tengu_tab_read_sep",!1)}` |
| N2 | The claude-code `Edit` read-before-edit model set is **byte-identical** in 2.1.218 and 2.1.258. | [C] both bundles carry the same ten-model `Set` |
| N3 | OpenCode's plugin hook names are **identical** between 1.18.4 and 1.18.26. | [M] type-definition diff |
| N4 | OpenCode shipped **no** change to read caps, `apply_patch`, instruction discovery or parallel emission since the pin. | [M] all 22 release bodies read and grepped |
| N5 | Compaction still cannot fire on this bench. Context windows are unchanged: luna 1,050,000 tokens, all current Anthropic models 1,000,000. | [M] OpenRouter models API 2026-09-02; largest observed context 100,624 [M 06] |
| N6 | The price **ratio** vector for luna is unchanged since 08-28, so every percentage in the programme is still valid. | [M] §4 |
| N7 | Claude-code's `Already in context (…)` / `Unchanged since last read` read-dedupe labels appear **zero times** in all 44 fresh-pool claude-code transcripts, in either arm. | [M] `grep -c` over `fp-claudecode-tab-20260826/agent-state/*/**/projects/**/*.jsonl` |
| N8 | `replacementToolResult` is documented but absent from both claude-code bundles. | [C] 0 hits in 2.1.218 and 2.1.258 |

---

## 4. Prices today (2026-09-02)

[M] `curl https://openrouter.ai/api/v1/models`, read on 2026-09-02. Dollars per million tokens.

| model | input | output | cache read | cache write | context |
|---|---:|---:|---:|---:|---:|
| `openai/gpt-5.6-luna` | 0.20 | 1.20 | 0.02 | 0.25 | 1,050,000 |
| `openai/gpt-5.6-luna:batch` | 0.10 | 0.60 | 0.01 | — | 1,050,000 |
| `openai/gpt-5.6-sol` | 2.00 | 10.00 | 0.20 | 2.50 | 1,050,000 |
| `openai/gpt-5.6-terra` | 2.00 | 12.00 | 0.20 | 2.50 | 1,050,000 |
| `anthropic/claude-opus-5` | 5.00 | 25.00 | 0.50 | 6.25 | 1,000,000 |
| `anthropic/claude-sonnet-5` | 2.00 | 10.00 | 0.20 | 2.50 | 1,000,000 |
| `anthropic/claude-fable-5.1` | 10.00 | 50.00 | **0.25** | 12.50 | 1,000,000 |
| `anthropic/claude-fable-5` | 10.00 | 50.00 | 1.00 | 12.50 | 1,000,000 |
| `anthropic/claude-opus-4.8` | 5.00 | 25.00 | 0.50 | 6.25 | 1,000,000 |
| `anthropic/claude-haiku-4.5` | 1.00 | 5.00 | 0.10 | 1.25 | 200,000 |

**Cache-write policy** [W openrouter.ai/docs/features/prompt-caching, read 2026-09-02, no date
shown on page]:

- OpenAI: "Prompt caching with OpenAI is automated and does not require any additional
  configuration." Cache writes are "charged at **1.25x the price of the original input pricing,
  even with automatic caching — no opt-in required**." Cache reads "0.25x or 0.50x" per the page,
  but the model endpoint's own numbers govern and say **0.10x** for luna (`0.02 / 0.20`). Report
  the endpoint numbers; the prose is a generalisation.
- New since 06: "Developers can mark specific content blocks with **`prompt_cache_breakpoint`**
  to control cache boundaries instead of relying on automatic placement, available on GPT-5.6 and
  newer." That is a harness-side control we do not own, and it is arm-shared.
- Anthropic: 5-minute TTL writes at **1.25x** input, 1-hour TTL writes at **2x** input, reads
  uniformly at **0.1x** input. `claude-fable-5.1` is the exception at 0.025x.

**What these numbers mean for the programme.** The bench registers `$0.10 / $0.01 / $0.60`. The
listed luna price today is exactly double with the same ratio `1 : 0.1 : 6`, so every percentage
holds and every dollar figure is half of a run today. The interesting ratio is the *true price of
a context token* — sticker input plus residency at the measured re-send factor:

| model | ratio in : cached : out | true price of a context token at 20.1 re-sends | multiplier over sticker |
|---|---|---:|---:|
| `gpt-5.6-luna` (bench) | 1 : 0.1 : 6 | 0.10 + 20.1×0.01 = $0.301 /M | **3.01×** |
| `claude-opus-5` | 1 : 0.1 : 5 | 5.00 + 20.1×0.50 = $15.05 /M | **3.01×** |
| `claude-sonnet-5` | 1 : 0.1 : 5 | 2.00 + 20.1×0.20 = $6.02 /M | **3.01×** |
| `claude-fable-5.1` | 1 : **0.025** : 5 | 10.00 + 20.1×0.25 = $15.03 /M | **1.50×** |

[I. The re-send factor 20.1 is the claude-code sweet figure from 06 §0 and is held constant across
all four rows on purpose, so that the column isolates the price ratio and not the harness.]
**Results measured on luna carry
over to Opus 5 and Sonnet 5 unchanged in percentage terms.** On Fable 5.1 they do not: residency
is four times cheaper relative to ingest, so request-count levers are worth about half as much
and ingest-side levers relatively more. A real Claude Code user today defaults to Opus 5 on
Enterprise (2.1.251) with Fable 5.1 as the default Fable model (2.1.257) [W].

---

## 5. Candidate levers

Each states mechanism, harnesses, vehicle, ceiling with arithmetic, the cheapest `$0` falsifier
with its kill condition, build cost, the nearest register entry, and the two flags.

### 5.1 L-1 — Serve `ss-*` through opencode's own `read` / `grep` / `glob`

- **Mechanism.** An opencode plugin registers `tool.execute.before` and `tool.execute.after` for
  the built-in `grep`, `glob` and `read` tools. `before` rewrites `args` (for example, turning a
  ripgrep pattern into an `ss-grep` query and path filter); `after` replaces the `output` string
  with the sweet-search result, numbered `N<TAB>` as today. The model is never told. It keeps
  emitting the structured tools it already batches in parallel.
- **Why it matters.** BRIEF §1.1: opencode native issues **1.55 tool calls per request**, sweet
  **1.11**, because a Bash `ss-*` call is one per request. That costs sweet **+3.4 requests =
  +10.2%**. §2.3 shows the harness prompt already demands parallel bash and luna ignores it, so
  the gap is structural, not instructional.
- **Harnesses.** OpenCode only. A weaker claude-code analogue exists (`PreToolUse` +
  `updatedInput`, plus a documented but unverified `replacementToolResult`); codex has no
  built-in structured read or grep tool to intercept.
- **Vehicle.** `ss init` writes `.opencode/plugin/sweet-search.ts` in the sweet arm only.
  **Sweet-only.** Not the FRAME, not the shim, not a shared harness setting.
- **Ceiling.** Removing the request penalty: `0.102 × $0.009265 = $0.000945`, giving sweet
  `$0.008320` against native `$0.008968`, a **−7.2%** delta [I]. At half effect, `$0.008792`, a
  **−2.0%** delta. Sweet also keeps its measured 18% tool-byte advantage, which this does not
  spend.
- **Cheapest `$0` falsifier.** Replay every `grep`, `glob` and `read` call recorded in the
  **native** arm of `fp-opencode-tab-20260826` and `rp-oc-tab-20260827` through the proposed
  rewrite, offline, against the same checked-out repositories. Score each replayed call on two
  binary tests: (a) does the sweet result contain every file the native result matched?
  (b) does the sweet path return non-empty and non-error? **Kill if either test fails on more
  than 10% of calls.** Zero model calls. This is a static compatibility check, not a cost
  prediction, so the register's "fixed-trajectory replay gets direction right half the time"
  warning does not apply.
- **Second `$0` screen, mandatory before build.** Count how many native `grep` calls use regular
  expression syntax `ss-grep` does not implement. Memory note `forensics-review` records an
  `ss-grep` basic-regular-expression `\|` defect. Any silent dialect mismatch is a solve risk and
  solve is the veto.
- **Build cost.** One TypeScript file, roughly 150 lines, plus an argument translator per tool.
  One day.
- **Register check.** Nearest entries are **A4** (MCP tool surface as the packing vehicle,
  OWNER-EXCLUDED) and **E9** (selective superset routing, DEAD as a *pre-run* predictor but
  explicitly "runtime-signal router NOT refuted"). This is neither. It is not MCP: no server, no
  new tool schema, no change to the cached prefix. It is not a pre-run router: the decision is
  made per call at runtime, which is exactly the branch E9 left open. It is not register **A1**
  or **A2**: nothing is asked of the model.
- **`new_tool`: false.** No new tool appears to the model. **`needs_user_decision`: true.** It
  silently changes the semantics of opencode's own tools, which is a product-integrity question,
  and the 2026-07-31 decision scoped the arm to "Bash/CLI only".

### 5.2 L-2 — Restrict claude-code's built-in tool set in the sweet arm

- **Mechanism.** Pass `--tools Bash,Edit,Write` (plus whatever the solve floor needs) in the
  sweet arm. The named set is the only one whose schemas enter the request, so `Read`, `Grep`,
  `Glob`, `Task`, the todo tools, `NotebookEdit`, `WebFetch` and `WebSearch` leave the cached
  prefix, and the model cannot fall back to them.
- **Harnesses.** Claude-code only. [C] The flag is present in both 2.1.218 and 2.1.258; the bench
  runner does not pass it [M].
- **Vehicle.** A runner flag applied to the sweet arm only, or `ss init --claude-code` writing the
  equivalent. **Sweet-only by construction** — native needs those tools.
- **Ceiling.** The public breakdown puts claude-code 2.1 tool definitions at about **3,200
  tokens** [W shipyard]. Removing eight of roughly fifteen built-ins plausibly removes
  **1,280–1,920 tokens** [I]. A prefix token is ingested once and re-sent about 22.4 times at
  23.4 turns [M 06 §8], so the saving is `S × (0.10 + 0.01 × 22.4) / 10^6 = S × 0.324 / 10^6`:
  **$0.000415 to $0.000622 per rollout, which is 2.0% to 3.0% of claude sweet's $0.020727**.
  That is the same order as the gutter (2.0–3.7%) and the tool guide (2.6–4.5%), and unlike
  either it removes nothing the sweet arm uses.
- **Risks that could veto it.** Dropping `Task` removes delegation; sweet delegated in 6 of 22
  fresh-pool cells. Dropping `Read` removes the fallback when an `ss-read` call fails, and the
  fresh pool measured "requests reacting to failed `ss-*` calls" at up to about 2%. Both are
  solve risks, and solve is the veto.
- **Cheapest `$0` falsifier.** Two static counts on `fp-claudecode-tab-20260826`, sweet arm only.
  (a) In the 6 delegating cells, did delegation change the outcome? If any solved rollout used a
  subagent whose result the main thread acted on, `Task` must stay. (b) Count `Read`, `Grep` and
  `Glob` calls in the sweet arm; each one is a call the restricted set would have forced onto
  `ss-*`. **Kill if `Read`+`Grep`+`Glob` exceed 20% of the sweet arm's tool calls**, because at
  that rate the substitution is a behaviour change, not a schema trim.
- **Sizing the prize exactly needs one paid probe** (about $0.001): `claude -p --tools default`
  and `claude -p --tools Bash,Edit,Write` on the same one-line prompt, then read
  `usage.input_tokens` of the first request. I did **not** run it; the rule is `$0`.
- **Build cost.** One flag. One hour including the tool-name audit.
- **Register check.** Not on the register. Nearest is **A4** ("a new tool schema changes the
  cached prefix"), which is about *adding* schemas via MCP; this *removes* schemas without MCP.
  Distinct from **B2** (tool-guide trim, CLOSED) because it touches harness schemas, not the
  guide, and from **B7** (result diet, BANNED) because it removes a fixed block, not rendering.
- **`new_tool`: false. `needs_user_decision`: true** — it changes what `ss init` writes for
  claude-code users and removes their `Read`/`Grep` tools.

### 5.3 L-3 — Deliver a computed fact through a `PostToolUse` hook at zero extra requests

- **Mechanism.** A `PostToolUse` hook matched on the `run_tests` shim (codex and claude-code) or
  a `tool.execute.after` handler (opencode) attaches a computed certificate as
  `additionalContext`. Today the only way to put a computed fact in front of the model is to make
  it call a tool, which costs a request and a decision. A hook costs neither.
- **Harnesses.** All three. Codex `additionalContext` is present in 0.146.1 [C, 28 hits] and
  documented [W]. Claude-code `PostToolUse additionalContext` is documented [W] and the field
  appears in the 2.1.218 bundle [C, 45 hits]. Opencode `tool.execute.after` returns `output` [C].
- **Vehicle.** Sweet-only if `ss init` installs it and the computation comes from the index.
  **It becomes shared, with zero differential, the moment it is attached to the shared
  `run_tests` shim.** Attach it to an `ss-*` call instead.
- **Ceiling.** Not bounded by the delivery channel. It is bounded by register **F9**'s open
  problem: the one certificate that worked (`apple`, 0/3 → 16/16) came from a checker whose
  strict shape fires on **1 file in 152,270** (register **F3**). This lever supplies the missing
  *vehicle*, not the missing *computation*.
- **Cheapest `$0` falsifier.** None is needed for the vehicle; it is a code-read fact. The
  falsifier belongs to whatever computation is proposed, and register F3/F9 already set that bar:
  a family of computable facts that fires on more than one file in 152,270.
- **Register check.** Extends **F9** and **F3** with a delivery mechanism. Distinct from **A6**
  (mid-task advisories, REFUTED) because A6 delivered *instructions* the model had to act on;
  this delivers a *fact* the model reads as tool output, which is the channel F9 measured working.
- **`new_tool`: false. `needs_user_decision`: false** as a mechanism note; true for any specific
  computation.

### 5.4 L-4 — Deliver the tool guide as a skill instead of a prefix block — **arithmetic-closed**

I priced this and it does not survive, so record it as closed rather than parked.

All three harnesses support progressive-disclosure skills at their pinned versions: claude-code
`.claude/skills/*/SKILL.md`; codex skills with a catalog token budget (0.149.0 #38978) [W];
opencode `.opencode/skills` with `SKILL.md`, present as strings in the deployed 1.18.4 binary [C].
Anthropic itself used this trade twice (2.1.234, 2.1.248) [W].

The guide costs **1,457 tokens** of prefix on every harness [M 06]. As a skill the prefix carries
only a name and description, perhaps 40 tokens [I]. The prefix saving would be:

| harness | turns | saving per rollout | share of sweet |
|---|---:|---:|---:|
| codex | 19.6 | 1,417 × 0.286/10^6 = $0.000405 | 3.3% |
| opencode | 19.0 | 1,417 × 0.280/10^6 = $0.000397 | 4.3% |
| claude-code | 23.4 | 1,417 × 0.324/10^6 = $0.000459 | 2.2% |

Those reproduce 06's measured guide share of 2.6–4.5%, so the arithmetic is sound. But **the
saving only exists in rollouts where the model never loads the skill**, and in those rollouts the
guide's measured behaviours — no delegation, fewer calls — are gone. In rollouts where the model
does load it, the body is ingested and re-sent from that point *and* costs one extra request
(codex prefix 15,667 tokens × $0.01/10^6 ≈ $0.000157 per extra request), so the skill form is
strictly dearer than the prefix form. The lever therefore collapses into register **B3** ("drop
the guide entirely", PROPOSED, NOT RUN, conflicts with owner scope) with an extra request bolted
on. **Do not build it.**

### 5.5 L-5 — Codex per-MCP-tool `output_token_limit` — real, but only inside an excluded arm

Codex 0.152.0's `[mcp_servers.<name>.tools.<tool>] output_token_limit` [W PR #41421] is the first
per-tool output budget any of the three harnesses has offered. It would let an MCP-delivered
`ss-read` set its own cap instead of inheriting the ~2,500-token `exec_command` cap that register
**C9** deferred as "about 2%, correctness not cost". It is real and new. It is reachable only
through the MCP arm, which is **OWNER-EXCLUDED** (register A4, 2026-07-31), and register **C8**
already rejected raising codex's cap as a lever because delivering truncated output in full costs
2–19× more. **Record it against A4's revival condition; do not open it on its own.**

---

## 6. Measurement traps introduced by these changes

- **T1 — Upgrading codex past 0.150.0 can silently delete the sweet arm's tool guide.**
  "Untrusted projects no longer supply project-level `AGENTS.md` instructions" (#39837) [W]. The
  bench delivers the guide through `AGENTS.md` and marks each run directory
  `trust_level = "trusted"` in `/root/.codex/config.toml` [M, the file lists one
  `[projects."/root/.ss-eval/runs/<task>__<arm>__..."]` block per run]. If that writer ever
  misses a directory on 0.150+, the sweet arm runs **without its guide** and the result reads as
  "the guide is worthless". Verify the trust entry exists for every run directory before any
  post-upgrade run.
- **T2 — Upgrading claude-code past 2.1.223 can make compaction fire where it never did.**
  "Changed auto-compact to keep sessions on unrecognized model IDs within the assumed context
  window instead of letting them grow past it" [W]. `openai/gpt-5.6-luna` is unrecognized (its
  `modelBucket` normalises to `nonconforming` [C]). Largest observed context was 95,712 tokens
  [M 06], so the risk is not certain, but the "no rollout ever compacted" premise behind register
  **B5** would need re-checking. `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`
  restores the old behaviour.
- **T3 — The bench's claude-code prefix is not a real user's prefix.** 2.1.233 removed the
  todo/task tools for Opus 4.8, Sonnet 5, Fable 5, Mythos 5 "and newer models" [W]. luna is not
  in that list, so the bench carries a tool block a real user does not. Both arms carry it, so
  the head-to-head is safe; the absolute prefix figure is not transferable.
- **T4 — Claude-code native delegation gets cheaper on upgrade.** 2.1.232 made subagent forking
  the default, inheriting the full conversation and prompt cache [W]. Native delegated in 15 of
  22 fresh-pool cells and paid a fresh uncached 5,300–8,500-token bundle each time [M 06 §5.4].
  After the upgrade that bundle is a cache read. **Native's cost falls; the sweet-minus-native
  delta widens against sweet.** Never pool a pre-upgrade and a post-upgrade claude-code run.
- **T5 — On Fable 5.1 the lever ranking changes.** Cache reads are 0.025× input, so a context
  token costs 1.50× sticker rather than 3.01× [I, §4]. Request-count levers lose about half their
  value there. State the model whenever a percentage is quoted.
- **T6 — `replacementToolResult` is documented but not in the binary.** [W] vs [C]. Any
  claude-code design that depends on replacing a tool result from a hook must first be shown to
  work on the installed version.
- **T7 — Codex 0.152.0 disables the planning tool by default.** [W] That is a prefix change in
  **both** arms. The register's rule "never pool runs across a shipped fix" extends to harness
  upgrades: a codex run on 0.152 is not comparable with one on 0.146.1 at the dollar level.
- **T8 — A harness upgrade is itself a shared change.** Every item in §2 that lands in both arms
  has zero head-to-head differential by BRIEF rule 6. Only §5.1, §5.2 and a sweet-installed §5.3
  are differential.

---

## 7. What I could not finish

1. **I could not price L-2 exactly.** Sizing the claude-code tool-schema block needs one
   two-request probe, which is a model rollout, which the `$0` rule forbids. The 2.0–3.0% band is
   inferred from a public 3,200-token figure and a proportion I chose; treat it as a band, not a
   number.
2. **I could not confirm which codex code path `tool_output_token_limit` binds.** 06 inferred
   that the documented 12,000-token default applies to the code-mode `exec` tool and not the
   `exec_command` path our runs use, leaving an effective ~2,500-token budget. I found nothing
   in 0.147–0.152 that settles it, and I did not read the Rust source.
3. **I could not verify the effective codex output cap on 0.152.** The box runs 0.146.1 and is
   read-only; installing 0.152 there would change the evidence box. A local install and a
   `strings` pass would answer it at `$0` but is out of this task's scope.
4. **N7 is inconclusive on mechanism.** The `Already in context (…)` and `Unchanged since last
   read` strings sit next to display labels such as `Read image (`, `Read PDF (` and `at cell`
   in the bundle, so they are probably terminal-interface text rather than tool-result content.
   Their absence from the transcripts therefore does not prove claude-code's `Read` never
   suppressed an unchanged re-read; it proves the label never reached the JSONL.
5. **I did not enumerate codex's `[tools]` table.** The published sample shows
   `[tools] view_image = true` and 0.152.0 adds `tools.update_plan.enabled`, but my attempt to
   recover the full serde field list from the 0.146.1 binary returned unrelated matches.
6. **I did not open HO2 and did not read any grading log.** No hidden test name or gold patch
   content appears anywhere above.

---

## 8. Sources

Read on 2026-09-02 unless stated.

**Changelogs and releases**

1. Claude Code CHANGELOG — https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md — entries 2.1.219 through 2.1.258.
2. OpenAI Codex releases (GitHub API) — https://api.github.com/repos/openai/codex/releases — tags `rust-v0.146.0` (2026-07-29) through `rust-v0.152.1` (2026-09-01).
3. Codex PR #41421, per-tool MCP output limits — https://github.com/openai/codex/pull/41421 — merged for 0.152.0.
4. OpenCode releases (GitHub API) — https://api.github.com/repos/anomalyco/opencode/releases — tags `v1.18.4` (2026-07-20) through `v1.18.26` (2026-09-01).
5. OpenCode changelog — https://opencode.ai/changelog.

**Vendor documentation**

6. Claude Code hooks reference — https://code.claude.com/docs/en/hooks (redirect target of code.claude.com/docs/hooks-reference); event list and `PreToolUse` / `PostToolUse` output fields.
7. Codex hooks — https://learn.chatgpt.com/docs/hooks (308 redirect from https://developers.openai.com/codex/hooks); event names, TOML shape, `updatedInput`, `additionalContext`, timeouts.
8. Codex config sample — https://learn.chatgpt.com/docs/config-file/config-sample; `tool_output_token_limit`, `project_doc_max_bytes`, `project_doc_fallback_filenames`, `model_auto_compact_token_limit`, `compact_prompt`, `[mcp_servers]` `enabled_tools`/`disabled_tools`, `[[skills.config]]`, `[tools]`.
9. OpenCode custom tools — https://opencode.ai/docs/custom-tools/ — page dated 2026-09-01.
10. OpenCode plugins — https://opencode.ai/docs/plugins/.
11. OpenCode config — https://opencode.ai/docs/config/ — page dated 2026-09-01; `tools`, `instructions`, `permission`, `compaction`.
12. OpenRouter prompt caching — https://openrouter.ai/docs/features/prompt-caching — OpenAI 1.25× cache writes on GPT-5.6+, `prompt_cache_breakpoint`, Anthropic 1.25× / 2× write multipliers and 0.1× reads.
13. OpenRouter models API — https://openrouter.ai/api/v1/models — prices in §4, read 2026-09-02.
14. Claude Code token breakdown (cited by 06, re-used for the 3,200-token tool-definition figure) — https://shipyard.build/blog/claude-code-tokens/.

**Shipped code and binaries (read-only)**

15. `@opencode-ai/plugin@1.18.4` and `@1.18.26`, `dist/index.d.ts` — `npm pack`, unpacked locally in the scratchpad. Hook signatures in §2.3; name-set diff empty.
16. Deployed opencode 1.18.4 — `/usr/lib/node_modules/opencode-ai/node_modules/opencode-linux-x64/bin/opencode` on `root@167.233.69.121` — parallel-call prompt text, `SessionCompaction.prune`, `.opencode/tools/`, `SKILL.md` loader.
17. Deployed codex-cli 0.146.1 — `/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex` — hook and config-key string counts in §2.2.
18. Deployed claude-code 2.1.218 — `/root/.local/share/claude/versions/2.1.218` — `Edit`/`Write` guard logic, `grg` model set, marker presence table.
19. Local claude-code 2.1.258 — `~/.local/share/claude/versions/2.1.258` — `mYe`/`p`/`N`, `rJe`, `iz()`, `hX()`, `gYr = 25000`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`, `tengu_amber_wren`, `tengu_edit_minimalanchor_jrn`, `--tools` help text, `replacementToolResult` absence.
20. Bench runner — `/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/harness/claude-code-task-runner.mjs` — flags actually passed.
21. Fresh-pool traces — `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/agent-state/` — N7 census, 44 task-arm directories.

**Prior programme documents this report extends or corrects**

22. `harness-gutter-cost-20260828/05-research-editing-interfaces.md` — corrected in §2.1 (a third Edit-description family and two further gates it did not record).
23. `harness-gutter-cost-20260828/06-research-cost-mechanics.md` — corrected in §2.1 (the `Read` token cap is a constant plus an environment override, not a model profile) and extended in §2.2 (`compact_prompt`, `enabled_tools`/`disabled_tools`).
24. `harness-gutter-cost-20260828/07-research-resolution-levers.md` — §5.3 supplies the zero-request delivery channel its L-block assumed had to be a tool call.
25. `slate-c/DEAD-LEVER-REGISTER-DRAFT.md` — items A1, A4, B2, B3, B5, B10, C5, C8, C9, D6, E9, F3, F9 are all touched above; D6 should be closed.
