# The real-user path: sweet-search on claude-code with Anthropic models

**Task:** Slate C research, `anthropic-model-product-path`. **Date:** 2026-09-02.
**Method:** the deployed claude-code binaries (2.1.257 on this machine, 2.1.218 on the
evidence box), Anthropic's own product documentation, Anthropic's bundled `claude-api`
reference skill, and this session's own transcript. No rollout was launched. No product or
bench code was edited. Box scratch: `/tmp/wf-slatec/anthropic-model-product-path/`.

Tags on every number: **[M]** measured here, with the command · **[C]** read from a deployed
binary or a tool contract · **[W]** web source with URL and date · **[I]** inferred.

---

## 0. Verdict

**The benchmark's biggest blind spot is not the read-before-edit gate. It is the price
vector.** Three findings, in order of size.

1. **The read-before-edit risk is much smaller than the register records, and it points the
   other way.** Claude Code enforces "File has not been read yet" only for a hardcoded set of
   **ten** model ids, and that set contains **no current-generation model**. It is
   byte-identical in 2.1.218 (the build that ran every `fp-claudecode-*` cell) and in 2.1.257
   (current). A real user on Opus 5, Opus 4.8, Sonnet 5, or Fable 5.1 editing a file inside
   the working directory pays **no failed Edit**. A user on Opus 4.6 or older, Sonnet 4.5,
   or Haiku 4.5 pays one failed Edit plus one Read per edited file. The Edit tool's own
   description still tells every model to Read first, so the residual cost on current models
   is a prompt-induced extra Read, not a hard error. [C][M]

2. **Nothing a hook, an MCP server, or a settings file can do makes `ss-read` count as a
   Read.** Only the native Read/Write/Edit/NotebookRead tools, the memory-file loader, an
   internal `sed`-edit path, and one Agent-SDK control message (`seedReadState`) write the
   session's `readFileState`. The hook output schemas have no field for it. The SDK route is
   unavailable to a person running the `claude` CLI. [C]

3. **The cost anatomy in the brief is a property of the `openai/gpt-5.6-luna` price vector,
   not of agent sessions, and it changes materially on Anthropic billing.** Anthropic charges
   a cache **write** surcharge that the brief's model does not carry at all: 1.25x the input
   rate for a 5-minute cache entry, 2x for a 1-hour entry. Repricing claude-code's own
   measured token counts onto Claude Opus 5 moves the anatomy from *ingest 22% / residency
   44% / output 18%* to *ingest 43% / residency 43% / output 15%* (1-hour TTL), and moves
   **sweet's main-thread penalty against native from +2.2% to +4.6%**. Sweet's advantage on
   claude-code is fewer re-sends; its cost is more ingest; Anthropic reprices ingest upward
   and leaves re-sends alone. [M][W][I]

Two further mechanisms, both new to this programme, are named in §3 and §5: claude-code
replaces an oversized tool result with a 2,000-character preview and a file path (a much
harsher regime than codex's middle-out cut), and the built-in `Explore` subagent — the
claude-code delegation path native uses most — has **no Bash tool and omits CLAUDE.md**, so
sweet's whole tool surface is structurally unreachable inside it.

---

## 1. (Q1) The read-before-edit gate: still model-gated, and the set excludes today's models

### 1.1 The exact code, current build

Claude Code **2.1.257**, `~/.local/share/claude/versions/2.1.257`, 199,011,264 bytes,
mtime 2026-09-01 20:56 [M `ls -la`]. The Edit tool's `validateInput` reads [C, offset
162412975]:

```js
let U = n.readFileState.get(_);                       // read-state for this absolute path
if (!U || U.isPartialView) {
  let me = ze(Pp(n)),                                 // the model id for this turn
      _e = rJe(me),                                   // telemetry bucket
      ke = !mYe(me, n.remoteCall) && CJ(zt, _, n, pe(n));   // "guardSkipped"
  if (s("tengu_edit_tool_not_read_hypothetical", {..., guardSkipped: ke, modelBucket: _e, ...}), !ke)
    return { result:false, behavior:"ask",
             message:"File has not been read yet. Read it first before writing to it.",
             errorCode:6 }
}
```

and the gate itself [C, offset 159196151]:

```js
var N = new Set(["claude-opus-4-6","claude-haiku-4-5","claude-opus-4-5","claude-opus-4-1",
                 "claude-opus-4-0","claude-sonnet-4-5","claude-sonnet-4-0",
                 "claude-3-7-sonnet","claude-3-5-sonnet","claude-3-5-haiku"]);
function p(e){ return N.has(tn(e)) }
function mYe(e,n){ if(n===undefined) return p(e); return n.model!==undefined && p(n.model) }
function tn(e){ return e.replace(/\[1m\]$/i,"") }      // strips only the [1m] window suffix
```

Polarity, stated plainly: `mYe(model)` is **true when the guard applies**. `guardSkipped` is
true only when the model is **outside** the set **and** `CJ(...)` is true.
`CJ(e,n,r,o) = !vm(e,r) && nwr(n,o)` [C, offset 159608476]: the Read tool must be present in
the session's tool list, and a read of that exact path must resolve to `allow` (or to `ask`
under `bypassPermissions`). Inside a trusted working directory with default permissions both
hold, so the guard is skipped. Outside it, `nwr` returns false and the guard fires — which is
exactly what the relaxed variant of the tool description says.

### 1.2 The same set is in the build that ran the benchmark

Claude Code **2.1.218** on the evidence box, `/root/.local/share/claude/versions/2.1.218`,
273,177,584 bytes [M `ssh ... python3 /tmp/wf-slatec/anthropic-model-product-path/probe218.py`].
The set at offset 247977766 is **character-identical** to 2.1.257's, and the guard expression
is the same shape (`A = !rji(_) && xEs(s,t)`, same message, same `errorCode:6`). [M][C]

I also checked every intermediate build on this machine — 2.1.247, .248, .250, .251, .252,
.257 — with the same regex. **All six carry the identical 10-model set.** [M] So the set has
been stable across at least eight releases and six weeks.

### 1.3 Which models are and are not covered

The binary knows about `claude-opus-4-7` (32 occurrences), `claude-opus-4-8` (52),
`claude-opus-5` (52), `claude-sonnet-4-6` (40), `claude-sonnet-5` (54) and `claude-fable-*`
(63) [M byte-count]. **None of them is in the guard set.** A separate roster elsewhere in the
binary lists them all, so their absence from `N` is a deliberate omission, not an oversight
of an old build. [C]

| model family | in the guard set? | a sweet user's `Edit` after only `ss-read`, inside the cwd |
|---|---|---|
| Opus 5, Opus 4.8, Opus 4.7 | no | succeeds |
| Sonnet 5, Sonnet 4.6 | no | succeeds |
| Fable 5, Fable 5.1, Mythos 5, Mythos 5.1 | no | succeeds |
| Opus 4.6, 4.5, 4.1, 4.0 | **yes** | fails once, then costs one native `Read` |
| Sonnet 4.5, Sonnet 4.0, Haiku 4.5 | **yes** | fails once, then costs one native `Read` |
| Claude 3.7 / 3.5 family | **yes** | fails once, then costs one native `Read` |

Runtime model ids are recorded as aliases, not dated snapshots: this machine's transcripts
carry `"model":"claude-fable-5-1"`, `"claude-opus-4-8"`, `"claude-fable-5"` [M
`grep -o '"model":"[^"]*"' ~/.claude/projects/.../*.jsonl | sort | uniq -c`]. So set membership
is tested against exactly those strings, and `tn()` strips only a trailing `[1m]`.

### 1.4 The prompt still asks for the Read, on current models

The Edit description is built by `bYr(model, leanPrompt, preReadLineDropped)` [C, offset
162398813]. Two variants:

- `preReadLineDropped` false: *"You must Read the file in this conversation before editing,
  or the call will fail."*
- `preReadLineDropped` true: *"If the file is outside the working directory, you must Read it
  in this conversation before editing, or the call will fail."*

`preReadLineDropped` is resolved per model from the client-data/model-config service
(`iwt(e) = e.preReadLineDropped ?? LTn(e.model)`), so its value is set server-side and cannot
be read statically. **Observed live in this session** (2.1.257, `claude-fable-5-1`,
2026-09-02): my own Edit tool description carries the strict line, *"You must Read the file in
this conversation before editing, or the call will fail."* [M, this session's own tool
definitions]

So on a current Anthropic model the product **tells** the model the Edit will fail and then
does not fail it. The measurable cost to a sweet user is therefore an extra native `Read`
that the model performs voluntarily, not a wasted tool-error turn.

### 1.5 Implication for sweet on claude-code

- Register **D6** ("claude-code read-before-edit gate on Anthropic models — UNMEASURED
  PRODUCT RISK … Real Claude users of sweet-search would pay one failed Edit + one Read per
  edited file") is **half wrong and now measured**. Correct statement: *legacy* Anthropic
  models pay that; *current* ones do not. The bench's own result (218/259 sweet edits with no
  prior native Read, zero errors, on luna) generalises to every current Anthropic model.
- The residual, unavoidable cost is the prompt line. It is a shared, harness-owned string;
  sweet cannot change it. Sweet **can** counter it in its own vehicle
  (`.claude/rules/sweet-search.md`), and that is sweet-only — see candidate **C-A1** in §7.

---

## 2. (Q2) What can register a file as read: only Read, and one SDK control message

`readFileState` is a per-session `Map<absolutePath, {content, timestamp, offset, limit,
isPartialView?, contentNotInModelContext?, seededFromContext?, keepContent?}>`. The Edit gate
tests `!entry || entry.isPartialView`. I enumerated every write to it in 2.1.257 by matching
the seed shape `.set(<var>,{content:` — **14 sites** [M, python regex over the binary]. They
fall into six classes:

| # | writer | can a sweet user reach it? |
|---|---|---|
| 1 | `Read` / `NotebookRead` (offsets 164906084, 164911596) | yes — the native tool only |
| 2 | `Edit` / `Write` / `NotebookEdit` after a successful write (162416967, 163985362, 164094057) | only after an edit already succeeded |
| 3 | memory-file seeding: `seedMemoryFile()` + `bmn()` for CLAUDE.md, `.claude/rules`, nested memory (165745264, 180632040) | automatic, for instruction files only |
| 4 | an internal Bash `sed`-edit fast path, keyed on the tool's private `_simulatedSedEdit` input (165016247) | **no** — the schema field is marked `Internal:` and is not model-callable |
| 5 | the artifact-publish tool (175571628) | not applicable |
| 6 | the engine control message `seed_read_state` (169795929, 169807382, 177166454, 179291011) | **only through the Agent SDK** |

**Hooks cannot do it.** The complete hook-output schema set is at offset 158559264 [C]:
`PreToolUse` accepts `permissionDecision`, `permissionDecisionReason`, `updatedInput`,
`additionalContext`; `PostToolUse` accepts `additionalContext`, `classifierContext`;
`UserPromptSubmit` accepts `additionalContext`, `sessionTitle`, `suppressOriginalPrompt`;
`SessionStart` accepts `additionalContext`, `initialUserMessage`, `sessionTitle`,
`watchPaths`, `reloadSkills`; `Setup`, `PreModelSwitch`, `PostModelSwitch`, `SubagentStart`
accept only `additionalContext` or a permission decision. **No hook field touches
`readFileState`.** The one hook-adjacent write (offset 164140413) only *re-syncs* a path that
is **already** tracked, after a PostToolUse hook (a formatter) changed it on disk — it returns
`null` when `readFileState.get(path)` is empty, so it cannot create an entry.

**MCP cannot do it.** No MCP result path writes `readFileState`. An oversized MCP result is
written to a file instead (`Error: result (N characters) exceeds maximum allowed tokens.
Output has been saved to <path>`) [C].

**Settings cannot do it.** There is no settings key. `claudeMd` in managed settings injects
organisation memory, which goes through class 3 above and only covers instruction files.

**The SDK can.** `seedReadState(path, mtimeCeiling)` is a public method on the object the
engine returns, and a control-protocol request `{subtype:"seed_read_state", path, mtime}`
[C, offset 169808074]:

```js
seedReadState: async (path, mtimeCeiling) => { try {
  let abs = ct(path); let st = await wy(abs);
  if (st.size > 10485760) return;                       // 10 MiB cap
  let mt = Math.floor(st.mtimeMs);
  if (mt <= mtimeCeiling) {                             // file unchanged since the caller's stamp
    let content = await ky(abs, "utf-8");
    Xo({ type:"seed_read_state", path: abs,
         seed:{ content: AA(content), timestamp: mt, offset: undefined, limit: undefined,
                contentNotInModelContext: true } });
  } } catch {} }
```

The seed is merged into `readFileState` at the start of the next turn. It sets
`contentNotInModelContext: true` and does **not** set `isPartialView`, so it satisfies the
Edit gate exactly. Claude Code uses it on itself: `onInit` seeds every loaded CLAUDE.md and
`.claude/rules` file so the model can edit them without reading them first [C, offset
180778905].

`seed_read_state` exists in 2.1.218 as well (12 occurrences of the string) [M box probe], so
this is not a new capability.

### 2.1 Implication for sweet on claude-code

- **There is no product-shaped way to make `ss-read` count as a Read for a CLI user.** Not a
  hook, not an MCP tool, not a settings key. Say so in the docs rather than implying `ss-read`
  is a drop-in replacement on claude-code.
- The bench harness *does* drive claude-code through the SDK, so a bench-only experiment
  could call `seedReadState` after each `ss-read`. That would measure the ceiling of "make
  ss-read count", but it is **not** a shippable product path and should not be booked as one.
- The `PreToolUse.updatedInput` field is the only hook lever that reaches tool inputs; it is
  what the existing D-4 `Read`-`pages` normaliser uses [register D4].

---

## 3. (Q3) Result caps, truncation, and auto-compaction on claude-code

### 3.1 Bash output: head truncation, not middle-out — a correction

`06-research-cost-mechanics.md` §5.2 states the Bash truncation marker is
`... [N lines truncated] ...` "with middle truncation". **The truncation is from the head:
the first N characters are kept and the tail is dropped.** [C]

```js
function QMn(e){                        // 2.1.257, offset 164080169
  let n=_mt(e); if(n) return {...};
  let r=Gbe();                          // BASH_MAX_OUTPUT_LENGTH: default 30000, max 150000
  if(e.length<=r) return {totalLines:_n(e,"\n")+1, truncatedContent:e, isImage:n};
  let o=e.slice(0,r), d=_n(e,"\n",r)+1;
  return { totalLines:_n(e,"\n")+1,
           truncatedContent:`${o}\n\n... [${d} lines truncated] ...`, isImage:n };
}
```

The same function is in 2.1.218 (`J7u`, offset 252422042, `e.slice(0,r)`) [M box probe], so
the correction applies to the benchmark build too. `BASH_MAX_OUTPUT_LENGTH` is unchanged:
default **30,000 characters**, maximum **150,000** [C, both builds].

This matters for sweet: on codex an over-long `ss-search` loses its **middle**; on claude-code
it would lose its **tail**. Rank order survives head truncation. That is the good news. The
bad news is §3.2.

### 3.2 The real claude-code cap is result persistence, and it deletes the whole result

Above a per-tool threshold, claude-code does not truncate a tool result at all. It writes the
**whole** result to a file under the session's `tool-results/` directory and replaces it in
context with a fixed wrapper [C, offset 160362654]:

```js
var Ore="<persisted-output>", Z_n="</persisted-output>", aJ=50000, pNe=2000;
function D8e(toolName, maxResultSizeChars, ceiling=aJ, skipAggregate){
  if(!Number.isFinite(maxResultSizeChars)) return maxResultSizeChars;
  if(skipAggregate) return Math.min(maxResultSizeChars, ceiling);
  let o = P("tengu_velvet_ibis",{})?.[toolName];        // server-controlled per-tool override
  if(typeof o==="number" && o>0) return o;
  return Math.min(maxResultSizeChars, ceiling);
}
function Npe(n){ return `<persisted-output>\nOutput too large (${size}). Full output saved to: ${path}\n\nPreview (first 2.0KB):\n${preview}\n...\n</persisted-output>` }
```

The preview is **2,000 characters** (`pNe`). The default ceiling is **50,000 characters**
(`aJ`), and a server-controlled map `tengu_velvet_ibis` can override it per tool name, so the
exact Bash threshold is not statically readable and can differ per user and session.

**Measured in this session** (2.1.257, `claude-fable-5-1`, 45 tool-result blocks) [M, python
over `~/.claude/projects/-Users-admin-Projects-sweet-search-private/559eb8e8-….jsonl`]:

- the largest tool result delivered **inline** was **40,262 characters**;
- results reported by the wrapper at **32.5 KB, 34.3 KB and 37.9 KB** were **persisted**,
  each arriving as a ~2.1-2.2 KB block;
- one 366.6 KB Bash stdout was persisted whole, not cut at 30,000 characters.

So on 2.1.257 the operative cap for a large Bash result is persistence, not
`BASH_MAX_OUTPUT_LENGTH`, and the threshold sits somewhere in the 32-50 KB band for Bash.

**Why this matters for sweet more than for native.** `ss-*` results arrive through Bash as one
large block. Native `Read` on claude-code averages 3.1 kB per call and `ss-read` 5.3 kB
[brief §1.1] — comfortably under. But an `ss-search` pack, a wide `ss-grep`, or an `ss-read`
of a large span can cross it, and when it does the agent loses the **entire** ranked result and
must spend a `Read` turn on the persisted file to get any of it back. That is a per-harness
failure mode with no counterpart on codex or opencode.

### 3.3 In-session tool-result clearing (below compaction)

Independently of compaction, claude-code replaces old tool results with the literal string
`[Old tool result content cleared]` for a whitelisted set of tool names, above a
**20,000**-token per-result threshold [C, offset 164548068: `var eHe="[Old tool result content
cleared]", Ndn=20000, iHo=2000, aHo=new Set([dt, ...vN, Wo, Yo, ID, ro, zt, jn])`]. The set
demonstrably contains `Read`, `Edit`, `Write` and `WebFetch`; whether it contains `Bash` I
could **not** resolve, because the tool-name constants are imported from other bundle chunks
(§8, item 1). No clearing fired in this session (0 of 45 results) [M].

If Bash is outside that set, `ss-*` results are never cleared while native `Read` results are —
a structural, sweet-only residency asymmetry in long sessions. That is a cheap $0 question
(§7, falsifier for C-A2).

### 3.4 Auto-compaction thresholds

The threshold is an absolute token count, not a percentage [C, offsets 162505301, 162508603,
162509524]:

```
effectiveWindow = autoCompactWindow − min(model max output tokens, 20000)      // GZt = 20000
compact  when contextTokens ≥ effectiveWindow − 13000                          // Vxe, FZt = 13000
warn     when contextTokens ≥ (that threshold) − 20000
blocked  when contextTokens ≥ (rawWindow − min(maxOutput,20000)) − 3000        // $Zt = 3000
```

**Validation.** Anthropic's own documentation states Sonnet 5 "compacts at the threshold for
its configuration (approximately 967K tokens by default when running with native 1M)" [W
code.claude.com/docs/en/model-config, fetched 2026-09-02]. The formula gives
1,000,000 − 20,000 − 13,000 = **967,000** exactly. For a 200,000-token window it gives
**167,000** tokens.

Controls: `autoCompactEnabled`, `autoCompactWindow` settings, `/autocompact <n>`,
`CLAUDE_CODE_AUTO_COMPACT_WINDOW`; accepted values 100K-1M, a bare 100-1000 meaning thousands
[W settings-reference and model-config, 2026-09-02]. `DISABLE_AUTO_COMPACT` and
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` exist as env overrides [C].

A rapid-refill breaker trips after **3** consecutive compactions each within **<3** turns of
the previous one, and tells the model: *"Autocompact is thrashing: the context refilled to the
limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool
output is likely too large for the context window."* [C, offset 162503826]

Compaction **clears `readFileState`** entirely and re-attaches memory files from disk
[C, offset 164832909] — so after a compaction, every previously-read file is un-read again,
and on a guarded model the read-before-edit gate re-arms.

Register **B5** ("compaction / eviction on this bench — UNTESTABLE, never fires, max context
100,624 of 1.05M") **stands**. Even at a 200K window the threshold is 167,000 tokens, above
the bench's 95,712-token claude-code maximum [M, doc 06 §5.3]. But it is **not** untestable
for a real user in a long interactive session, and the 20,000-token result-clearing of §3.3
fires well below it.

### 3.5 Other caps, current build

| surface | value | source |
|---|---|---|
| Bash stdout head-truncation | `BASH_MAX_OUTPUT_LENGTH`, default 30,000 chars, max 150,000 | [C] both builds |
| tool-result persistence | `min(tool maxResultSizeChars, 50,000 chars)`, per-tool server override `tengu_velvet_ibis` | [C] 2.1.257 |
| persisted-result preview | 2,000 characters | [C] |
| MCP tool result | default **25,000 tokens**; env `MAX_MCP_OUTPUT_TOKENS`; gate `tengu_velvet_ibis.mcp_tool`; message `[OUTPUT TRUNCATED - exceeded N token limit]` | [C] 2.1.257 offset 179820726 |
| `Read` file cap | token-based, from the model profile: `File content (N tokens) exceeds maximum allowed tokens (M). Use offset and limit parameters` | [C] |
| Edit diff render | 8,192 chars, head truncation | [C] `TQe=8192` |
| in-session result clearing | 20,000 tokens per result, whitelisted tools | [C] |

One more model-facing signal worth knowing: the Bash result carries an optional
`staleReadFileStateHint`, *"Model-facing note listing readFileState entries whose mtime bumped
during this command"* [C]. So when an `ss-*` wrapper writes a file, claude-code already tells
the model which tracked files went stale. That is adjacent to register **E3** (`ss-grep`
working-tree freshness) and means the harness, not sweet, owns that signal on claude-code.

---

## 4. (Q4) Anthropic prompt-caching economics, and what they do to the brief's cost model

### 4.1 The contract

From Anthropic's bundled `claude-api` skill reference (`shared/prompt-caching.md`, cached
2026-06-24, read from
`/private/tmp/claude-501/bundled-skills/2.1.257/…/claude-api/shared/prompt-caching.md`) and
the claude-code product page [W code.claude.com/docs/en/prompt-caching, fetched 2026-09-02]:

- **Cache reads cost ~0.1x the base input price** — and **0.025x on Claude Fable 5.1**
  ($0.25/MTok).
- **Cache writes cost 1.25x the input rate for a 5-minute TTL and 2x for a 1-hour TTL.**
- Break-even: 5-minute TTL pays off from the **second** request (1.25x + 0.1x = 1.35x versus
  2x uncached); 1-hour TTL needs a **third** (2x + 0.2x = 2.2x versus 3x).
- A cache read refreshes the entry's timer for free. The lifetime is measured from the
  **start** of the request that writes or reads it.
- Maximum **4** `cache_control` breakpoints per request. Minimum cacheable prefix is
  model-dependent: 512 tokens on Opus 5 / Fable 5 / Fable 5.1, 1,024 on Opus 4.8 and Sonnet 5,
  2,048 on Opus 4.7, 4,096 on Opus 4.6 and Haiku 4.5.
- Render order `tools -> system -> messages`; a byte change anywhere in the prefix
  invalidates everything after it.

Current first-party prices (per MTok) [W, bundled `claude-api` model table, cached 2026-06-24]:

| model | input | output | cache read | 5m write | 1h write |
|---|---:|---:|---:|---:|---:|
| Claude Opus 5 (`claude-opus-5`) | $5.00 | $25.00 | $0.50 | $6.25 | $10.00 |
| Claude Opus 4.8 | $5.00 | $25.00 | $0.50 | $6.25 | $10.00 |
| Claude Sonnet 5 | $2.00 | $10.00 | $0.20 | $2.50 | $4.00 |
| Claude Fable 5.1 | $10.00 | $50.00 | **$0.25** | $12.50 | $20.00 |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 | $1.25 | $2.00 |

Compare the bench's registered `openai/gpt-5.6-luna` vector: `$0.10 / $0.01 / $0.60`, i.e.
input : cache-read : output = **1 : 0.1 : 6**, and **no write term at all** in the model
[brief §1.1]. Anthropic's vector is **1 : 0.1 : 5** (Opus 5 / Sonnet 5 / Haiku 4.5) or
**1 : 0.025 : 5** (Fable 5.1), **plus an explicit 1.25x-2x write surcharge**.

### 4.2 How claude-code chooses the TTL

Read from the binary [C, offsets 165376738 and 165384390] and confirmed by the product page
[W, 2026-09-02]. Two buckets: **main conversation** (interactive turns, `-p` runs, Agent SDK
turns, and inline helpers — the allowlist `["repl_main_thread*","sdk","auto_mode",
"memdir_relevance"]`) and **everything else** (subagents, workflows, teammates, forks,
compaction, session titles).

| bucket | Claude subscription, within plan usage | usage credits, API key, or cloud provider |
|---|---|---|
| main conversation | **one hour** | five minutes |
| everything else | five minutes (except server-controlled helpers) | five minutes |

Precedence, first match wins [C `U3n` / `xYn`; W same order in the doc]:
1. `FORCE_PROMPT_CACHING_5M=1`
2. `CLAUDE_CODE_PROMPT_CACHE_TTL` / `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`
3. `promptCacheTtl` / `subagentPromptCacheTtl` settings (require **v2.1.242+** [W])
4. a subagent's `experimental.cacheTtl` frontmatter (requires **v2.1.248+** [W]; a `1h` there
   is ignored while a subscription is on usage credits)
5. `ENABLE_PROMPT_CACHING_1H=1`
6. the bucket default above

**None of the TTL settings existed at bench time.** `promptCacheTtl` and
`subagentPromptCacheTtl` appear 0 times in 2.1.218 [M box probe] — consistent with the
documented v2.1.242 floor.

Cache scope on claude-code: *"effectively scoped to one machine and directory. The system
prompt embeds the working directory, platform, shell, OS version, and auto memory paths"* [W].
Worktrees of the same repository miss each other's cache.

### 4.3 What a tool result appended each turn costs, on Anthropic pricing

Take claude-code's own measured shares [brief §1.1] and reconstruct the token counts for one
sweet rollout at the registered luna vector `cost = 0.10·I + 0.01·P + 0.60·O` per million,
`C = $0.020727` [I arithmetic on M inputs]:

- `I` (tokens ever ingested) `= 0.22 × 0.020727 / 0.10 × 1e6 = 45,599`
- `P` (re-sent prefix tokens) `= 0.44 × 0.020727 / 0.01 × 1e6 = 912,000`
- `O` (output tokens) `= 0.18 × 0.020727 / 0.60 × 1e6 = 6,218`
- check: `P/I = 20.0` against the brief's measured 20.1 re-sends per ingested token. ✓

Now price the **same token counts** on Claude Opus 5 [I]:

| price vector | ingest | residency | output | main-thread total | anatomy |
|---|---:|---:|---:|---:|---|
| luna, as registered | $0.004560 | $0.009120 | $0.003731 | **$0.017411** | 26% / 52% / 21% |
| Opus 5, 5-minute TTL | $0.284994 | $0.456000 | $0.155450 | **$0.896444** | 32% / 51% / 17% |
| Opus 5, 1-hour TTL | $0.455990 | $0.456000 | $0.155450 | **$1.067440** | **43% / 43% / 15%** |
| Fable 5.1, 5-minute TTL | $0.569988 | $0.228000 | $0.310900 | **$1.108888** | **51% / 21% / 28%** |

**Conclusion for the cost model.** Doc 06's verdict — *"Residency is the largest cost term on
every harness … The lever the model points at is the number of turns, not the size of any
single payload"* — is a statement about the luna vector. On a Claude subscription with
Opus 5 the two terms are equal; on Fable 5.1 **ingest is 2.5x residency** and payload size is
the dominant lever. The single missing term is the cache-write surcharge, which the brief's
model does not contain.

**Sensitivity of the bill to a byte cut.** Cutting X% of ingested bytes cuts X% of both the
ingest and the residency terms. That is `0.79X` on luna, `0.83X` on Opus 5 at 5m, `0.85X` on
Opus 5 at 1h, and `0.72X` on Fable 5.1 [I, verified by script]. Payload levers are therefore
**about 8% more valuable** on the Anthropic path at worst, not multiples — and on Fable 5.1
they are *less* valuable, because the cheap 0.025x read shrinks the residency half. Register
**B7** ("result diet / render the same lines smaller — BANNED CLASS, honest ceiling 1.9%")
would become a ~2.0% ceiling. **B7 stays dead.** I say so explicitly so nobody mistakes §4 for a revival.

### 4.4 The repricing makes sweet worse on claude-code

Do the same reconstruction for the native arm (`C = $0.021558`, shares 19% / 40% / 20%):
`I = 40,960`, `P = 862,320`, `O = 7,186` [I].

| price vector | sweet main-only | native main-only | sweet − native |
|---|---:|---:|---:|
| luna, as registered | $0.017411 | $0.017031 | **+2.2%** |
| Opus 5, 5-minute TTL | $0.896444 | $0.866810 | **+3.4%** |
| Opus 5, 1-hour TTL | $1.067440 | $1.020410 | **+4.6%** |
| Fable 5.1, 5-minute TTL | $1.108888 | $1.086880 | **+2.0%** |

**Mechanism, stated plainly.** On claude-code, sweet ingests about **11.3% more tokens** than
native (45,599 versus 40,960) and re-sends each of them **5.0% fewer times** (20.0 versus 21.05).
Under luna those two nearly cancel. Anthropic reprices ingest upward by 1.25x-2x and leaves
the cache-read rate at the same 0.1x, so the cancellation breaks and sweet's penalty roughly
doubles. On Fable 5.1 the cheap 0.025x read shrinks residency, which cuts sweet's *advantage*
term as well, but the larger output share (native writes more output) partly offsets it.

Two caveats I must state. First, native's claude-code cost is a **lower bound**: 205 delegated
requests carry no usage record [register G6], so the native column is understated in every
row. Second, this is arithmetic on the bench's measured token counts, not a live measurement
on Anthropic models — the token counts themselves would differ, because Opus 4.7 and later use
a different tokenizer from GPT-5.6 [W bundled `claude-api` skill: "the Opus 4.7 tokenizer uses
~1x-1.35x as many tokens" relative to earlier Anthropic models; no published ratio against
`o200k_base` exists]. Treat the table as a **direction and a magnitude**, not a forecast.

### 4.5 The 1-hour TTL is 16.0% of the bill it appears in, for a continuously working agent

`$1.067441 / $0.896443 = 1.1908` [I, script-verified]: on the reconstruction above, the
1-hour TTL costs **19.1% more** than the 5-minute TTL for the same work — equivalently, the
surcharge is **16.0%** of the 1-hour bill. The write price doubles and the session never idles
past five minutes, so nothing is bought with it. Anthropic's own guidance agrees: *"Requests that share
a prefix and start less than 5 minutes apart keep the 5-minute cache warm indefinitely — the
1-hour TTL buys nothing there except the doubled write price."* [W bundled skill]

A sweet-search user on a Pro or Max plan gets the 1-hour TTL **by default** on the main
conversation. For an agent loop whose turns are seconds apart, `promptCacheTtl: "5m"` in
`.claude/settings.json` is a large, safe saving.

**This is not a lever for the slate.** It reaches both arms identically (brief §0.6,
differential rule). It belongs in sweet-search's claude-code documentation.

### 4.6 A subscription prices main-thread ingest 1.6x above subagent ingest

This one **is** asymmetric. On a Claude subscription the main conversation writes cache at
2x input and subagents write at 1.25x — a **1.60x** ratio. The sweet guide's measured
behaviour is *fewer delegations*: native delegated in 15 of 22 claude-code task-cells, sweet
in 6 [M, doc 06 §5.4]. So on the Anthropic subscription path, sweet keeps a larger share of
its ingested tokens in the most expensive write bucket while native pushes 21.9% of its bill
into the cheaper one.

Register **F15** ("delegation for sweet on claude-code — REJECTED; native already delegates;
sweet's win is not needing to") was decided on a ledger argument, not a price argument. This
is new evidence of a different kind, and it is measurable at $0 (§7, C-A3).

### 4.7 What invalidates the cache mid-session on claude-code

[W code.claude.com/docs/en/prompt-caching, 2026-09-02] — the ones that matter for sweet:

- **Adding a bare tool-name deny rule** (e.g. `Bash`) removes the tool from the system prompt
  and invalidates everything. Scoped rules like `Bash(rm *)` do not.
- **Connecting or disconnecting an MCP server** invalidates the cache **only when its tools
  are loaded into the prefix**; deferred tools (the default on supported models) do not. This
  softens doc 06's blanket claim that "adding, removing or renaming an `ss-*` tool invalidates
  the whole conversation cache", which was read off the OpenAI contract.
- **Editing CLAUDE.md mid-session does not invalidate the cache — and does not apply.** The
  file is read once at session start. So a sweet `init` that rewrites `.claude/rules/…` mid-
  session changes nothing until `/clear`, `/compact`, or a restart.
- **Compaction** invalidates the conversation layer by design and reloads project context from
  disk, which cache-hits only if CLAUDE.md is unchanged.
- **Model or effort switch** invalidates everything; caches are model- and effort-scoped.
- Skills and slash commands inject as user messages and **keep** the cache.

---

## 5. (Q5) Subagent inheritance, and the project-level default agent

### 5.1 CLAUDE.md, rules and skills — resolved

Doc 06 §10 item 3 left this open ("Whether claude-code subagents inherit the sweet CLAUDE.md
is unresolved"). It is now settled from both directions.

**Code** [C, 2.1.257, offset 163773111 — the subagent spawn path]:

```js
let [Tr, Rr] = await Promise.all([
  B?.userContext   ?? CC(r.session, r.storageV5, r.credentials),   // the CLAUDE.md / rules blocks
  B?.systemContext ?? ey(r.session, r.options.cacheBreakerPhrase)
]);
let ys = e.omitClaudeMd && !B?.userContext;
let { claudeMd: Qs, ...Bo } = Tr;
let zr = ys ? Bo : Tr;                                              // drop claudeMd iff the agent says so
let { gitStatus: cr, ...dr } = Rr;
let Dr = (e.agentType === "Explore" || e.agentType === "Plan") ? dr : Rr;
```

`omitClaudeMd: true` appears on exactly three **built-in** definitions — `Explore`, `Plan`,
and the built-in web-fetch agent [C, offsets 162226142 / 162231355 / 162247113]. It is **not**
a field of the user-authored frontmatter schema (`QXt()`, offset 162254705), so a project or
user agent **always** inherits CLAUDE.md.

**Documentation** [W code.claude.com/docs/en/sub-agents, fetched 2026-09-02] agrees and adds
the list: a non-fork subagent's initial context is its own system prompt plus environment
details, the delegation task message, *"every level of the CLAUDE.md hierarchy the main
conversation loads, including `~/.claude/CLAUDE.md`, project rules, `CLAUDE.local.md`, and
managed policy files"*, a git-status snapshot, the full content of any skill named in the
agent's `skills` field, and a sibling roster. It states the exception outright: *"Explore and
Plan are the only subagents that omit CLAUDE.md and git status."* It also states what never
reaches a subagent: **output style** and **auto memory**.

**This explains the 08-28 anomaly.** Doc 06 §5.4 measured subagent first-request minima of
5,353 tokens (sweet) versus 5,346 (native) and inferred "at least some subagents do not
receive the sweet CLAUDE.md". They are `Explore`/`Plan`-class subagents, which omit CLAUDE.md
by design. The inference was right; the reason is now named.

**Read state is inherited.** The subagent's `readFileState` is
`boe(r.readFileState, {stripSeededFromContext: true})` [C, same offset] — a copy of the
parent's map with the memory-file seeds de-flagged. So a file the parent `Read` counts as read
for the subagent's `Edit`. This is undocumented [W: "The documentation does not address
whether a file the parent Read counts as read for the subagent's Edit"].

**Frontmatter fields** (user/project agents), from the binary's zod schema [C, offset
158570956] and confirmed by the docs [W]: `description` (required), `prompt` (required),
`tools`, `disallowedTools`, `model` (alias or `inherit`), `permissionMode`, `skills`
(preloaded into context), `memory` (`user` / `project` / `local`, auto-loading
`~/.claude/agent-memory/<agentType>/` or `.claude/agent-memory/<agentType>/` or
`.claude/agent-memory-local/<agentType>/` — **not** CLAUDE.md), `initialPrompt`, `mcpServers`,
`hooks`, `maxTurns`, `effort`, `isolation` (`worktree` / `remote`), `background`, `observer`,
`observerMessage`, `observeSubagents`, `color`, and `experimental.cacheTtl` (`5m` / `1h`,
v2.1.248+).

### 5.2 Explore has no Bash — sweet is structurally unreachable in the main delegation path

[W code.claude.com/docs/en/sub-agents, 2026-09-02]: the built-in `Explore` agent's tools are
**Read, Grep, Glob**. It does not have Bash. `Plan` is read-only tools with Write and Edit
denied. `General-purpose` and `claude` get every tool available to subagents.

`ss-*` are CLI wrappers reached through Bash [brief §2.1]. So when claude-code delegates to
`Explore` — the fast, read-only exploration path — the subagent **cannot call any sweet tool
at all**, and would not know they exist even if it could, because `Explore` omits CLAUDE.md.

On the fresh pool, native delegated in **15 of 22** claude-code task-cells and sweet in **6**
[M, doc 06 §5.4]; native ran 33 subagent transcripts and 314 subagent turns, 21.9% of its
bill. Whatever share of those were `Explore`, that share is a region of the claude-code arm
that sweet's tool surface has never reached. This is a **new structural ceiling** on
claude-code and it is not in the register.

### 5.3 A project CAN define a default main-thread agent that carries an instruction file

Yes. Two mechanisms, both first-party:

- **`agent` in `.claude/settings.json`** — *"Start every session as a named subagent with its
  prompt, tools, and model"* [W code.claude.com/docs/en/settings-reference, 2026-09-02].
- **`--agent <agent>` on the CLI** — *"Agent for the current session. Overrides the 'agent'
  setting."* [C, 2.1.257 CLI option table, offset 170222884]

The resolution is `let Sa = ln ?? XQe("agent"); if(!bn && !ln && Sa) bn = yl(...)` [C, offset
170020912], i.e. flag first, then the settings key. When it resolves, the agent's `prompt`
becomes a system-prompt block for the **main thread**, its `initialPrompt` is auto-submitted
as the first user turn (*"Auto-submitted first message when this agent runs as the main
session (via `--agent` or settings). Not read when spawned as a subagent."* [C]), its `skills`
are preloaded, and its `tools`/`disallowedTools` restrict the main tool surface. Hook input
confirms the distinction: `agent_type` is *"present … on the main thread of a session started
with `--agent` (without `agent_id`)"* [C].

Known limitation: the `agent` setting is ignored on Claude Code for Web
[W github.com/anthropics/claude-code/issues/13953].

### 5.4 Subagents and the cache

[W code.claude.com/docs/en/prompt-caching, 2026-09-02]: a subagent's first request **does not**
read the parent's cache, warms its own, and falls in the "everything else" TTL bucket — five
minutes even on a subscription. A **fork** inherits the parent's system prompt, tools and full
history, so its first request **does** read the parent's cache. In a workflow fan-out,
claude-code holds all but the first agent so their first requests can read the prefix the first
one cached.

---

## 6. Corrections to the three existing research documents

| # | document | statement | correction |
|---|---|---|---|
| 1 | `06` §5.2 | Bash truncation marker `... [N lines truncated] ...` "with middle truncation" | **Head truncation.** `e.slice(0, BASH_MAX_OUTPUT_LENGTH)` then the marker. True in 2.1.218 and 2.1.257. [C][M] |
| 2 | `06` §5.2 | the character cap is the Bash story | Incomplete. Above ~32-50 KB the result is **persisted whole to a file** and replaced by a 2,000-character preview. Measured live. [C][M] |
| 3 | `06` §10 item 3 | "Whether claude-code subagents inherit the sweet CLAUDE.md is unresolved" | **Resolved.** They do, except `Explore`, `Plan`, and the built-in web-fetch agent, which set `omitClaudeMd`. The arm-identical minimum bundle was those agents. [C][W] |
| 4 | `06` §2.1 | "Adding, removing or renaming an `ss-*` tool invalidates the whole conversation cache" | True on the OpenAI contract. On claude-code, **deferred** MCP tools (the default) do not invalidate; only prefix-loaded ones do. [W] |
| 5 | `06` §0 / §7 | "Residency is the largest cost term on every harness … the lever is turns, not payload" | Holds at the luna vector. On Opus 5 (1h) ingest and residency are equal; on Fable 5.1 ingest is 2.5x residency. The missing term is the cache-write surcharge. [W][I] |
| 6 | `05` §1.1 | Edit prompt variants gated by `tengu_tab_read_sep` | Still true in 2.1.257, and there is a **second** gate: `preReadLineDropped`, which swaps "you must Read" for "you must Read if outside the working directory". Server-configured per model; **not** dropped for `claude-fable-5-1` today. [C][M] |
| 7 | register D6 | "Real Claude users of sweet-search would pay one failed Edit + one Read per edited file" | Only on the 10 legacy model ids. Current Anthropic models skip the guard inside the working directory, exactly as luna did. [C][M] |

---

## 7. Candidate levers

Every candidate states mechanism, harnesses, vehicle, evidence, ceiling, the cheapest $0
falsifier with a pre-registered kill condition, build cost, register check, and flags.

### C-A1 — claude-code-only Edit protocol line in the sweet guide

- **Mechanism.** On claude-code with a *guarded* model (Opus 4.6 and older, Sonnet 4.5/4.0,
  Haiku 4.5, 3.x), an `Edit` after only `ss-read` returns errorCode 6 and costs one wasted
  turn plus one native `Read`. On every model, the Edit tool description tells the model to
  Read first. A one-line clause in `.claude/rules/sweet-search.md` — "before an Edit, read the
  exact span with the native Read tool" — converts a wasted error turn into a planned read.
- **Harnesses.** claude-code only. Gate on `CLAUDECODE` via the existing
  `detectAgentEnv()` in `core/search/output-policy.js`.
- **Vehicle.** `scripts/inject-agent-instructions.js` → `.claude/rules/sweet-search.md`.
  **Sweet-only**; codex and opencode never see it.
- **Evidence.** 218 of 259 sweet edits in the fresh pool had no prior native Read and none
  errored, because the bench ran luna [brief §1.4]. The guard set is unchanged in 2.1.257 [M].
- **Ceiling.** Zero on the bench (luna is unguarded) and zero for a user on a current model.
  For a user on a guarded model: one error turn per first-edit-per-file. At the fresh pool's
  1.18 edited files per rollout it is roughly one turn in twenty, ~5% of a rollout's requests.
- **$0 falsifier.** Count first-edits-per-file per rollout in
  `fp-claudecode-tab-20260826/rows.json` + `agent-state/*/claude-home/**`. **Kill if** the
  median rollout edits ≤1 distinct file, because then the clause buys at most one turn and
  costs 40 tokens on every request of every session.
- **Build cost.** One sentence in one file. Hours.
- **Register check.** Nearest is **D6** (unmeasured product risk) and **F8** (general
  engineering clauses in the guide, DEAD). Different from F8: F8's clauses were *reasoning*
  rules with no computed content; this is a harness-protocol fact. Same class as the shipped
  D-4 `pages` note.
- `new_tool: false`. `needs_user_decision: false` — but note **the guidance block is
  owner-protected** [brief §0.12], so this is an addition, not a trim.
- **Honest caveat.** This is a *product-correctness* item with a near-zero head-to-head
  differential on the current bench backbone. It should not be counted as a cost lever.

### C-A2 — keep every `ss-*` result under claude-code's persistence threshold

- **Mechanism.** Above ~32-50 KB claude-code replaces a Bash result with a 2,000-character
  preview plus a file path. An `ss-search` pack or wide `ss-grep` that crosses it loses its
  entire ranked list and costs a recovery `Read`. Cap `ss-*` output bytes when `CLAUDECODE` is
  set, with an addressable continue token.
- **Harnesses.** claude-code only.
- **Vehicle.** `core/search/output-policy.js` + `core/search/search-read.js`. **Sweet-only.**
- **Evidence.** [C] `aJ=50000`, `pNe=2000`, `tengu_velvet_ibis` override. [M] this session:
  40,262 chars delivered inline; 32.5 / 34.3 / 37.9 KB persisted.
- **Ceiling.** Each persistence event costs the whole result plus one recovery turn — of order
  5% of a claude-code rollout. If the event count is zero, the ceiling is zero.
- **$0 falsifier.** Grep every claude-code transcript in `fp-claudecode-tab-20260826` and
  `fixval-claude-code-20260828` for `<persisted-output>` and for
  `... [N lines truncated] ...` on an `ss-*` tool_use. **Kill if fewer than 3 of the 66 sweet
  rollouts contain either.** Below that the lever is pure "render the same lines smaller",
  which is the banned class [brief §0.7].
- **Build cost.** Small: a byte budget plus a continue span. Days.
- **Register check.** Nearest is **C9** (fit under codex's ~2,400-token cap, DEFERRED) and
  **C8** (raising codex's cap, REJECTED). Different harness, different mechanism: codex cuts
  the middle and keeps the rest; claude-code deletes the whole result and hands back a path.
- `new_tool: false`. `needs_user_decision: false`.

### C-A3 — reprice both arms on an Anthropic vector before any claude-code claim

- **Mechanism.** Not a lever; a measurement correction that changes which levers are worth
  building. The registered luna vector carries no cache-write term. Anthropic charges 1.25x
  (5m) or 2x (1h) of input on every newly ingested token, and a subscription puts the main
  conversation on 1h and subagents on 5m — a 1.60x ratio that penalises the arm that
  delegates less. Sweet delegates in 6 of 22 claude-code cells; native in 15.
- **Harnesses.** claude-code (and any harness a user points at an Anthropic model).
- **Vehicle.** `eval/task-completion-bench/harness/ideal-cost.mjs` — a **shared** analyzer
  column, like `breakPricedCostUsd` [register G2]. Zero head-to-head differential by itself;
  its value is that it re-ranks every other lever.
- **Evidence.** §4.3-§4.6 arithmetic on the fresh pool's measured shares; TTL policy read from
  the binary and confirmed in the vendor doc.
- **Ceiling.** Repricing moves claude-code sweet-vs-native main-only from +2.2% to +3.4%
  (5m) or +4.6% (1h). If that survives a proper per-request replay, **the claude-code
  "sweet is 3.9% cheaper" headline does not transfer to real users at all.**
- **$0 falsifier.** Rebuild per-request usage from the raw claude transcripts (usage-bearing
  record per `message.id` [brief §2.2 trap]), split main-thread from sidechain, apply
  `write = 2.00x` to main and `1.25x` to sidechain, `read = 0.10x`, `out = 5.00x`, and
  recompute both arms. **Kill the concern if** sweet − native stays within ±1 percentage point
  of the luna figure on both TTLs.
- **Build cost.** One analyzer column. Days. No new run.
- **Register check.** Nearest is **G2** (break-priced cost column). Different: G2 reprices the
  *suffix* after a cache break; this reprices the *write* of every ingested token and adds a
  bucket split the register has never modelled. It also supplies the price evidence register
  **F15** lacked.
- `new_tool: false`. `needs_user_decision: false`. **Green-ledger rule applies**: re-sweep
  after the harness change.

### C-A4 — a sweet project agent so delegation keeps sweet's tools

- **Mechanism.** claude-code's most-used delegation target, the built-in `Explore`, has tools
  Read/Grep/Glob only and sets `omitClaudeMd`. Sweet's whole surface is unreachable inside it.
  Shipping `.claude/agents/sweet-explore.md` at `init` with `tools: Bash, Read, Grep, Glob`,
  the sweet guide as its prompt, and `model: inherit` restores reach; the main thread can then
  delegate exploration without falling back to native tools.
- **Harnesses.** claude-code only.
- **Vehicle.** `scripts/inject-agent-instructions.js`. **Sweet-only.** An agent definition is
  not a tool, so the "no new tools" rule is not triggered on its face — but it does change the
  product's contact surface, which is the same kind of decision as the MCP one.
- **Evidence.** [W] Explore's tool list and CLAUDE.md omission. [C] `omitClaudeMd` on the
  built-ins only. [M] native delegated 15/22 cells, sweet 6/22; native sidechain 21.9% of its
  bill.
- **Ceiling.** The sidechain share of the claude-code arm, ~15-22%. Under §4.6 pricing, moving
  ingest from the 2x main bucket to the 1.25x subagent bucket is worth up to 0.75x of the
  input rate on whatever mass moves.
- **$0 falsifier.** Census which `subagent_type` native actually used in the 33 subagent
  transcripts of `fp-claudecode-tab-20260826`. **Kill if fewer than half are `Explore` or
  `Plan`** — if native mostly used `general-purpose`, that agent already inherits CLAUDE.md
  and can run Bash, so sweet already reaches it and there is nothing to fix.
- **Build cost.** One file written at `init`, plus documentation. Days.
- **Register check.** Nearest are **F15** (delegation for sweet on claude-code, REJECTED),
  **E10** (ephemeral causal coprocessor, DEAD live: calls 6.8 → 12.5, cost +79%), and **A4**
  (MCP surface, OWNER-EXCLUDED). Different from E10: that lever *added* a delegation step; this
  one changes the *definition* of a delegation the harness already performs. Different from
  F15: F15 asked sweet to delegate more; this asks that sweet's tools survive delegation.
- `new_tool: false`. **`needs_user_decision: true`** — it adds a file to the user's
  `.claude/agents/` directory at `init`, which is a contact-surface decision of the same kind
  the owner already ruled on for MCP.

### C-A5 — `promptCacheTtl: "5m"` in sweet's claude-code documentation

- **Mechanism.** A Pro/Max user gets the 1-hour TTL on the main conversation by default, which
  doubles the cache-write price. An agent loop whose turns are seconds apart never uses the
  extra 55 minutes. Setting `promptCacheTtl: "5m"` cuts writes from 2x to 1.25x.
- **Harnesses.** claude-code, real users only.
- **Vehicle.** documentation. **Arm-universal — zero head-to-head differential.**
- **Evidence.** [W] the TTL table and Anthropic's own "the 1-hour TTL buys nothing there
  except the doubled write price". [I] 19.1% of a reconstructed main-thread rollout in §4.5.
- **Ceiling.** **16.0%** of a real user's claude-code main-thread bill, on a subscription
  within plan usage, for a continuously working session (the 1-hour TTL costs 19.1% more than
  the 5-minute one; the surcharge is 16.0% of the larger bill).
- **$0 falsifier.** None needed; it is a documented price fact. The only open question is
  whether real sweet sessions idle past five minutes, which is a user-behaviour question.
- **Register check.** Nearest is **B6** ("cache engineering — NOTHING; 99.3-100% hit on
  re-sent tokens"). B6 was about hit *rate*; this is about the *write price*, which the bench
  vector does not contain.
- `new_tool: false`. `needs_user_decision: false`. **Not a slate lever.** Listed so it is not
  mistaken for one.

---

## 8. What I could not finish

1. **Whether `Bash` is in the in-session tool-result clearing set.** `aHo = new Set([dt,
   ...vN, Wo, Yo, ID, ro, zt, jn])` at offset 164548068 resolves `Read`, `Edit`, `Write` and
   `WebFetch` from usage elsewhere, but the constants are imported across bundle chunks and I
   could not bind `vN`, `Wo`, `Yo`, `ID` with confidence. If Bash is outside the set, `ss-*`
   results are never cleared while native `Read` results are — a real residency asymmetry.
   Settle it by running one long claude-code session and grepping the transcript for
   `[Old tool result content cleared]` against the tool name of each cleared `tool_use_id`
   (the script is three lines; it found 0 of 45 in this session).
2. **The exact Bash persistence threshold.** `min(tool maxResultSizeChars, 50,000)` is the
   static default, but `tengu_velvet_ibis` can override it per tool name from the server, and
   my own session showed 40,262 chars inline while 32.5 KB elsewhere was persisted. The
   threshold is not a constant you can rely on.
3. **The live value of `preReadLineDropped` for each model.** It is a client-data lookup, not
   a local constant. I observed it false for `claude-fable-5-1` on 2026-09-02; I cannot read
   the values for other models without running them.
4. **A token-count re-baseline.** Every dollar figure in §4.3-§4.4 reprices the bench's
   `o200k_base` token counts. Opus 4.7 and later use a different tokenizer, and no published
   ratio against `o200k_base` exists. The direction and magnitude are sound; the absolute
   dollars are not a forecast.
5. **Whether native's claude-code delegations were `Explore`.** The census in C-A4's falsifier
   is a 20-minute job on the box and I did not run it; it decides C-A4 on its own.

---

## 9. Sources

Deployed binaries (primary):

- Claude Code **2.1.257**, `/Users/admin/.local/share/claude/versions/2.1.257`, Mach-O arm64,
  199,011,264 bytes, mtime 2026-09-01. Offsets cited inline.
- Claude Code **2.1.247 / .248 / .250 / .251 / .252**, same directory — used only for the
  guard-set stability check.
- Claude Code **2.1.218**, `root@167.233.69.121:/root/.local/share/claude/versions/2.1.218`,
  273,177,584 bytes. Probes at
  `/tmp/wf-slatec/anthropic-model-product-path/probe218.py` and `probe218b.py`.

This session's own evidence:

- `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f.jsonl`
  — model id, 45 tool-result blocks, persistence sizes, zero cleared results.
- The `Edit` tool description delivered to this session (2.1.257, `claude-fable-5-1`).

Anthropic documentation (all fetched 2026-09-02 unless noted):

- <https://code.claude.com/docs/en/sub-agents> — subagent context inheritance, the
  Explore/Plan CLAUDE.md exception, the frontmatter table, `experimental.cacheTtl` (v2.1.248+).
- <https://code.claude.com/docs/en/prompt-caching> — the layer table, the TTL buckets and
  precedence, cache scope, invalidators, subagents and the cache.
- <https://code.claude.com/docs/en/settings-reference> — `agent`, `promptCacheTtl`,
  `subagentPromptCacheTtl`, `autoCompactEnabled`, `autoCompactWindow`, `env`.
- <https://code.claude.com/docs/en/model-config> — default auto-compact thresholds
  ("approximately 967K tokens by default when running with native 1M" for Sonnet 5).
- <https://code.claude.com/docs/en/context-window> — context composition and compaction.
- Bundled `claude-api` skill, claude-code 2.1.257, model table cached **2026-06-24**:
  `/private/tmp/claude-501/bundled-skills/2.1.257/3723d0c06cab82aa0917d9d03926099e/claude-api/`
  — `SKILL.md` (model prices), `shared/prompt-caching.md` (write surcharge 1.25x/2x, read
  0.1x and 0.025x, 4 breakpoints, per-model minimum prefix, invalidation hierarchy, 20-block
  lookback, concurrent-request timing).
- <https://github.com/anthropics/claude-code/issues/13953> — the `agent` settings key is
  ignored on Claude Code for Web.

Programme documents this report corrects or extends:

- `eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/05-research-editing-interfaces.md` §1.1
- `.../06-research-cost-mechanics.md` §0, §2.1, §5.2, §5.4, §10
- `.../07-research-resolution-levers.md` — no correction; no overlap.
- `eval/task-completion-bench/handoffs/improve/slate-c/DEAD-LEVER-REGISTER-DRAFT.md` — D6, B5,
  B6, B7, C8, C9, E3, F15, G2, G6.
