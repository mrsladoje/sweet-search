# Cost mechanics of agent harnesses — research from primary sources

**Task R2.** **Date:** 2026-08-28. **Tag:** `r2`.
**Method:** vendor documentation and 2026 literature, plus the deployed binaries and the
891-rollout fresh-pool traces on the evidence box. Read-only. No rollout was launched.
**Scripts:** `scripts/r2-*.mjs` in this directory; box copies under `/tmp/fp-inv/r2/`.

Every claim carries a tag. **[M]** measured by a named script over traces or files.
**[C]** read from a tool contract — vendor source, deployed binary, or our own harness code.
**[I]** inferred. **[W]** web source, with the URL.

---

## 0. Verdict

**Residency is the largest cost term on every harness. It is 45 to 48 percent of the bill.
Ingest is 23 to 30 percent. Output is 24 to 28 percent. The lever the model points at is the
number of turns, not the size of any single payload.**

Four findings drive that, all measured on this run's own traces:

1. **Only 4.8 to 7.5 percent of input tokens are ever billed at the full input rate**
   [M `r2-cache-hit.mjs`]. The other 92.5 to 95.2 percent are re-sends. The prefix cache hits on
   **99.3 to 100.0 percent** of them, so the cache-normalised cost column is close to exact,
   not an assumption.
2. **A token that enters a codex context is re-sent 15.9 times on average** [M
   `r2-cost-decompose.mjs`]. Its true price is therefore `$0.10 + 0.01 × 15.9 = $0.259` per
   million, which is 2.6 times the sticker input rate. On claude-code the multiplier is 20.3
   and the true price is `$0.303` per million.
3. **Output is 60 times cached input but only about 2.3 times an actually ingested token.**
   Output is under 1 percent of all tokens and 27 percent of the bill [M].
4. **No rollout in this run ever compacted.** 400 rollouts, zero context shrinks above 10
   percent, largest context 100,624 tokens against a 1,050,000-token window [M
   `r2-context-shrink.mjs`]. Every compaction or eviction lever is untestable on this bench.

**Two corrections to the programme's own numbers follow from the sources.**

- **The registered price for the backbone is half the current listed price.**
  `openai/gpt-5.6-luna` on OpenRouter today reads `$0.20 / $1.20` with a `$0.02` cache read and
  a `$0.25` cache write per million tokens [W]. The harness registers `$0.10 / $0.01 / $0.60`
  [C]. **Every percentage in the programme is safe** because the ratio vector is unchanged at
  `1 : 0.1 : 6`. **Every absolute dollar figure is half of what the same run would cost today.**
- **Codex cost is a lower bound.** OpenRouter states that GPT-5.6 and later charge cache
  writes at 1.25 times the input rate "even with automatic caching" [W]. Codex's per-turn
  usage record carries no cache-write field [C], so that surcharge is invisible in our codex
  numbers. Opencode and claude-code do report it, and it is **7.6 and 9.7 percent** of their
  bills [M]. If codex pays the same surcharge, the cross-harness table understates codex by
  roughly 6 to 7 percent.

---

## 1. The price vector we actually pay

### 1.1 What is registered, and what is listed today

`eval/task-completion-bench/harness/ideal-cost.mjs` registers [C]:

```
'openai/gpt-5.6-luna':  { in: 0.10, cache: 0.01, out: 0.60 },
'openai/gpt-5.6-terra': { in: 2.00, cache: 0.20, out: 12.0 },
'openai/gpt-5.6-sol':   { in: 2.50, cache: 0.25, out: 15.0 },
```

OpenRouter's model listing, fetched 2026-08-28 [W
[models API](https://openrouter.ai/api/v1/models),
[luna page](https://openrouter.ai/openai/gpt-5.6-luna)]:

| model | input | cache read | cache write | output | context | registered ratio | listed ratio |
|---|---:|---:|---:|---:|---:|---|---|
| `openai/gpt-5.6-luna` | `$0.20` | `$0.02` | `$0.25` | `$1.20` | 1,050,000 | `1 : 0.1 : 6` | `1 : 0.1 : 6` |
| `openai/gpt-5.6-terra` | `$2.00` | `$0.20` | `$2.50` | `$12.00` | 1,050,000 | `1 : 0.1 : 6` | `1 : 0.1 : 6` |
| `openai/gpt-5.6-sol` | `$2.00` | `$0.20` | `$2.50` | `$10.00` | 1,050,000 | `1 : 0.1 : 6` | **`1 : 0.1 : 5`** |

Three consequences.

- **Luna is uniformly 2 times stale.** The ratio is identical, so every A/B percentage and
  every share in this document is unaffected. Absolute dollars would double at today's rates.
  The `$6.9` spend line in the fresh-pool report would read `$13.8` today.
- **Terra is exact.** Nothing to fix.
- **Sol is wrong in ratio, not just in level.** The registration weights output at 6 times
  input; the listing weights it at 5. Pricing a run at the registered sol rates over-penalises
  the more verbose arm by 20 percent on the output term. `MODEL_PRICES` should be re-fetched
  before any sol run. The file's own comment already warns that "the delta between arms is NOT
  price-invariant" [C].
- **Luna's long-context tier no longer appears on the model page** [W]. The models API still
  shows an override above 272k tokens at double the base rates. Our rollouts peak at 100,624
  tokens [M], so the base tier is the one we pay either way.

### 1.2 What the harness does with that vector

`costFromTurns` produces three columns [C `ideal-cost.mjs:83`]:

```
ideal       += (newIn * price.in + resent * price.cache + out * price.out) / 1e6
real        += ((in - cached - cacheWrite) * price.in + cacheWrite * price.in * 1.25
                + cached * price.cache + out * price.out) / 1e6
breakPriced += ((in - cacheable) * price.in + cacheable * price.cache + out * price.out) / 1e6
```

The `1.25` multiplier on cache writes is documented in the code as an Anthropic rule [C]. **It
is also the OpenAI GPT-5.6 rule** [W], so the same line is correct for this backbone by
accident rather than by design. Nobody has to change it. Somebody should change the comment.

`breakPriced` equals `ideal` whenever the context only grows. This run never shrank a context
[M], so **the two columns are identical for all 891 rollouts** and no lever in this run can be
misread through cache-break blindness.

---

## 2. OpenAI prompt caching, and what OpenRouter passes through

### 2.1 The caching contract

From the OpenAI prompt-caching guide [W
[developers.openai.com](https://developers.openai.com/api/docs/guides/prompt-caching)]:

| rule | GPT-5.6 and later | earlier models |
|---|---|---|
| minimum cacheable prefix | 1,024 tokens | 2,048 tokens |
| increment rounding | none — "exact eligible boundary, excluding hidden tokens" | rounds down to a multiple of 128 |
| retention | "A cached prefix remains eligible for reuse for 30 minutes after its most recent write or reuse"; `prompt_cache_options.ttl` accepts only `"30m"` | 5 to 10 minutes idle, up to 1 hour; `prompt_cache_retention` can extend to 24 hours |
| cache write price | "cache writes cost 1.25× the standard, uncached input-token rate" | free |
| what is cached | "the model's full rendered context including OpenAI-provided instructions, developer messages, tool definitions, and conversation history" | same |
| what invalidates | "Cache reuse requires the entire rendered prefix to match. If content or a relevant setting changes before a breakpoint, the prefix after that change cannot match." | same |
| usage field | `cached_tokens` in `prompt_tokens_details` | same, rounded to 128 |

**Two operational readings.**

- **Tool definitions are inside the cached prefix** [W]. Adding, removing or renaming an
  `ss-*` tool invalidates the whole conversation cache from that point. This is the mechanical
  reason the programme's "no new tools" rule is also a cost rule, not only a fairness rule.
- **Any edit to the instruction file changes the prefix.** The tool guide sits in
  `AGENTS.md` / `CLAUDE.md`, which is rendered near the front of the prefix. It therefore costs
  once at ingest and again on every later request — see §7.

### 2.2 Reasoning items and residency

From the OpenAI reasoning guide [W
[developers.openai.com](https://developers.openai.com/api/docs/guides/reasoning)]:

- "While reasoning tokens are not visible via the API, they still occupy space in the model's
  context window and are **billed as output tokens**."
- With `store: false`, "reasoning items in the response's `output` array include an
  `encrypted_content` property by default", and the client passes them back on the next request.
- "GPT-5.6 models instead default to **rendering available reasoning from earlier turns**";
  `reasoning.context = all_turns` selects that behaviour.
- Effort levels: `none, minimal, low, medium, high, xhigh, max`. Our runs use `medium` [C
  `fp-codex-tab-20260826/.../codex-home/config.toml`].

The deployed codex 0.146.1 binary carries `encrypted_content` in its item schema, next to
`reasoning_text`, `input_text` and `summary_text` [C `strings` over
`@openai/codex-linux-x64/vendor/.../bin/codex`]. So codex runs the stateless path and hands
reasoning back itself.

**Measured residency of the model's own output** [M `r2-reasoning-residency.mjs`, codex sweet,
1,228 turn pairs]:

- newly ingested tokens at turn `t` are at least the previous turn's output on **896 of 1,228
  pairs (73.0 percent)**;
- summed shortfall on the other 332 pairs is 45,715 tokens, **12.9 percent** of all prior
  output;
- summed newly ingested tokens are **3.48 times** summed prior output.

[I] Most of the model's own output, reasoning included, does re-enter the prefix and is then
billed as cached input on every later request. About an eighth does not, which is consistent
with encrypted reasoning blobs tokenising smaller than the reasoning tokens billed at output
rates. **Roughly 70 to 75 percent of everything newly added to a codex context is tool output;
the rest is the model's own prior turns.**

**The double charge is real and it is the most expensive token in the system.** A reasoning
token costs `$0.60` per million when produced, then `$0.01` per million on each of the
remaining requests. At the measured 15.9 re-sends that is `$0.759` per million all-in.

### 2.3 What OpenRouter passes through

From OpenRouter's prompt-caching guide [W
[openrouter.ai](https://openrouter.ai/docs/guides/best-practices/prompt-caching)]:

- "Prompt caching with OpenAI is automated and does not require any additional configuration.
  There is a minimum prompt size of 1024 tokens."
- "GPT-5.6 and later charge cache writes at 1.25x the price of the original input pricing,
  **even with automatic caching**."
- Cache activity is reported in `usage.prompt_tokens_details` as `cached_tokens` (reads) and
  `cache_write_tokens` (writes).
- The doc's general line "reads are charged at 0.25x or 0.50x" **does not hold for luna**,
  whose listing gives `$0.02` against `$0.20`, a 0.1 multiplier [W]. **Trust the per-model
  listing, never the general sentence.**

**This is the codex measurement defect.** Cache writes are billed automatically, and codex's
`token_count` record exposes only `input_tokens`, `cached_input_tokens`, `output_tokens` and
`reasoning_output_tokens` [C `ideal-cost.mjs:120`]. There is no write field to read. Opencode
and claude-code do expose one, and the surcharge they pay is measured below. [I] Codex's true
bill is above our recorded one by up to about 7 percent.

---

## 3. Codex CLI 0.146.1

Deployed binary: `/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`, 311 MB [M].

### 3.1 The fixed preamble

| item | size | basis |
|---|---:|---|
| `base_instructions` | 20,903 bytes = **4,365 tokens** (`o200k_base`) | [M] first line of a fresh-pool rollout, byte-identical in both arms |
| whole first request, native arm | **14,210 tokens** median | [M] `r2-turn1-preamble.mjs` |
| whole first request, sweet arm | **15,667 tokens** median | [M] same |
| difference | **+1,457 tokens** | [M] |

The tool guide measures **1,458 tokens** on its own [M, `tiktoken` `o200k_base` over
`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` body; the file's
front-matter claims `token_count: 1307`, which is a different tokeniser or excludes the
heading]. **The measured arm difference is the guide, to within one token.**

The shared frame is in both arms: `FRAME_OPEN` 1,114 bytes = **231 tokens**, `FRAME_CLOSE`
1,918 bytes = **438 tokens** [M]. Together 669 tokens that cannot be a lever, because they are
identical on both sides.

`base_instructions` plus the guide plus the frame is 6,492 tokens. The remaining **9,175
tokens** of a codex sweet first request are tool schemas, environment context and the issue
text [I]. Tool schemas alone are therefore the largest single unexplained block, and they sit
inside the cached prefix, so any change to the `ss-*` tool set invalidates it [W §2.1].

### 3.2 Tool output cap and truncation

- Config key `tool_output_token_limit` exists in the 0.146.1 binary [C]. The published sample
  configuration reads `tool_output_token_limit = 12000  # tokens stored per tool output` [W
  [config sample](https://learn.chatgpt.com/docs/config-file/config-sample)].
- Our deployed `config.toml` sets no limit [M — the file is 4 keys plus provider and trust
  blocks].
- **The observed cap is far below the documented default.** Over 665 `exec_command` outputs the
  largest untruncated was 2,459 tokens and the smallest truncated 2,511 [M, prior work
  `GUTTER-MECHANISM-INVESTIGATION.md` §4.2]. The model's own `max_output_tokens` of 4,000 to
  20,000 does not bind.
- Truncation is middle-out. The binary carries `Warning: truncated output (original token
  count: `, `Original token count: ` and ` tokens truncated` [C].
- [I] The documented 12,000 applies to the code-mode `exec` tool, not the `exec_command` path
  these runs use. The effective per-call budget on this path is about 2,500 tokens and is not
  configurable from `config.toml`.

**Cost consequence.** Codex already truncates every large tool result to about 2,500 tokens.
**Adaptive output budgeting has the least headroom on codex of the three harnesses**, because
the harness has already applied a hard budget.

### 3.3 Exec polling

The binary documents an exec pragma [C]:

```
// @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}
- `yield_time_ms` asks `exec` to yield early if the script is still running. Defaults to 10000 ms.
- `max_output_tokens` sets the token budget for direct `exec` results. Defaults to 10000 tokens.
```

`background_terminal_max_timeout = 300000  # ms; max empty write_stdin poll window (default 5m)`
[W config sample]. The poll-and-wait lever the programme already shipped
(`SS_RT_LONGYIELD`) works on exactly this surface: each empty poll is a full request, so it
pays one whole prefix for no new information.

### 3.4 AGENTS.md handling

`project_doc_max_bytes = 32768  # Max bytes from AGENTS.md to embed into first-turn
instructions. Default: 32768` [W config sample]. `project_doc_fallback_filenames` also exists
[C binary]. The binary's own guidance says "Read the applicable `AGENTS.md` instructions" and
"Direct system/developer/user instructions … take precedence over AGENTS.md instructions" [C].

**Our guide is 6,050 bytes, well inside the 32,768-byte cap.** No truncation risk.

### 3.5 Compaction

Config keys `model_auto_compact_token_limit` and `model_auto_compact_token_limit_scope` exist
[C]. The scope enum is documented in the binary as `total` — "Count the full active context
against the limit" — and `body_after_prefix` — "Count sampled output and later growth after the
carried window prefix" [C]. The default dumped by the binary is
`"auto_compact_token_limit": null` [C], meaning model defaults.

**Compaction never fired in this run** [M]. The largest codex context was 100,624 tokens; a
1,050,000-token window is not close to any threshold.

**A latent trap, not a defect.** The deployed `config.toml` says `model = "gpt-5.5"` [M], and
the runner always overrides it with `-m openai/gpt-5.6-luna` on the command line [C
`codex-task-runner.mjs:598`]. The model actually used is correct. But context-window and
auto-compact defaults are chosen from a model name, so a future run that drops the `-m` flag
would silently size its budget for a different model **and be billed at gpt-5.5's `$5/$0.5/$30`,
which is 25 to 50 times luna's rates.**

---

## 4. OpenCode 1.18.4

Deployed binary: `/usr/lib/node_modules/opencode-ai/node_modules/opencode-linux-x64/bin/opencode`, 179 MB [M].

### 4.1 System prompt and instruction files

Opencode selects a provider-specific prompt file by model id — `anthropic.txt`, `beast.txt`
for GPT, `gemini.txt`, `codex_header.txt` for GPT-5, `qwen.txt` as fallback — then adds an
environment block and any discovered instruction files [W
[prompt-construction gist](https://gist.github.com/rmk40/cde7a98c1c90614a27478216cc01551f)].
Instruction discovery walks upward for `AGENTS.md`, `CLAUDE.md` or `CONTEXT.md`, at system-prompt
time and again when `read` touches a new subdirectory [W].

**Measured whole first request: 6,744 tokens native, 8,201 tokens sweet, difference +1,457**
[M `r2-turn1-preamble.mjs`]. **Opencode has by far the smallest fixed preamble of the three
harnesses**, and the same 1,457-token guide therefore weighs most heavily here in relative
terms. An independent public measurement puts the same contrast at "Claude Code sends 33k
tokens before reading the prompt; OpenCode sends 7k" [W
[HN 48883275](https://news.ycombinator.com/item?id=48883275)]. Our opencode figure matches;
our claude-code figure is lower because these runs carry a minimal tool set and no MCP servers.

### 4.2 Read tool limits

Strings in the deployed binary [C]:

- "By default, this tool returns up to **2000 lines** from the start of the file."
- "**Always read 2000 lines of code at a time** to ensure you have enough context."
- "Contents are returned with each line prefixed by its line number as `<line>: <content>`."
- grep: "(Results are truncated: showing first N results. Consider using a more specific path
  or pattern.)"

A public issue records a hardcoded 2,000-character cap per line [W
[opencode#25337](https://github.com/anomalyco/opencode/issues/25337)], and community
documentation records a 2,000-line / 50 KB output cap with overflow written to a temp file [W
[built-in tools reference](https://deepwiki.com/sst/opencode/5.3-built-in-tools-reference)].

**This is a cost contract, not only a formatting one.** Opencode's own system prompt instructs
the model to read 2,000 lines at a time. **Opencode therefore has the most headroom for
adaptive read windows of the three harnesses**, because its default instruction pushes the
largest possible ingest.

### 4.3 apply_patch, not edit

"GPT models get `apply_patch` instead of `edit`/`write`" [W gist and
[opencode tools doc](https://opencode.ai/docs/tools/)]. This explains the trace observation
that the nine fuzzy `edit` replacers were called zero times in these runs [M, prior work].

### 4.4 Turn accounting and caching

`step_finish` carries `part.tokens = { input, output, reasoning, cache: { read, write } }`.
The harness reconstructs full context as `input + cache.read + cache.write` [C
`opencode-task-runner.mjs:161`]; my parser uses the same convention, so the numbers below are
comparable to the published ones by construction.

**Measured cache behaviour, sweet arm, 63 rollouts** [M `r2-cache-hit.mjs`]:

- total input across all turns 28,334,199 tokens;
- re-sent 26,575,734, of which **26,572,335 hit the cache = 100.0 percent**;
- cache writes 1,758,276 tokens = 27,909 per rollout, about one full final context each;
- the write surcharge at `0.25 × $0.10` per million is `$0.000698` per rollout, which is
  **exactly** the gap between the cache-normalised `$0.009197` and the realised `$0.009899`
  (`$0.000702`).

**Opencode explicitly requests cache writes and pays 7.6 percent for them. Codex requests none
and reports none.**

---

## 5. Claude Code 2.1.218

Deployed bundle: `/root/.local/share/claude/versions/2.1.218`, 273 MB [M].

### 5.1 System prompt size

Public analyses of Claude Code 2.1 report about **14,000 tokens** for the system prompt
including tool definitions and `CLAUDE.md`, with one breakdown of 12,450 system + 3,200 tool
definitions + 2,100 `CLAUDE.md` [W
[shipyard](https://shipyard.build/blog/claude-code-tokens/),
[Piebald-AI system-prompt archive](https://github.com/Piebald-AI/claude-code-system-prompts)].
A filed issue reports 20,000 to 30,000 tokens of fixed overhead per request in ordinary use [W
[claude-code#52979](https://github.com/anthropics/claude-code/issues/52979)].

**Measured whole first request: 17,518 tokens native, 19,095 tokens sweet, difference +1,577**
[M `r2-turn1-preamble.mjs`]. The +1,577 is the 1,458-token guide plus about 119 tokens of
memory-file framing. **Claude-code has the largest fixed preamble of the three harnesses, by
2.6 times over opencode.**

### 5.2 Output caps, read from the deployed binary [C]

```
function Xit(){return o$e("BASH_MAX_OUTPUT_LENGTH",process.env.BASH_MAX_OUTPUT_LENGTH,CXi,TXi).effective}
var TXi=150000, CXi=30000;
```

- `BASH_MAX_OUTPUT_LENGTH` **default 30,000 characters, maximum 150,000**. This matches the
  documented behaviour and the filed documentation gap [W
  [claude-code#19901](https://github.com/anthropics/claude-code/issues/19901)].
- Truncation marker in the binary: `... [N lines truncated] ...`, with middle truncation.
- Read tool cap is token-based, not character-based:
  `File content (${e} tokens) exceeds maximum allowed tokens (${t}). Use offset and limit
  parameters to read specific portions of the file` [C]. The limit comes from the model
  profile; reported publicly as 25,000 tokens on the CLI and 10,000 in the desktop app [W
  [claude-code#40357](https://github.com/anthropics/claude-code/issues/40357)].
- MCP results above the cap are written to a file: `Error: result (N characters) exceeds
  maximum allowed tokens. Output has been saved to <path>` [C].
- Environment overrides present in the binary: `MAX_MCP_OUTPUT_TOKENS`, `MAX_OUTPUT_TOKENS`,
  `MAX_THINKING_TOKENS`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `DISABLE_AUTO_COMPACT` [C].

**The Bash cap was never hit in this programme** — 0 truncations across the 13-task sweet run
[M, prior work]. 30,000 characters is roughly 8,000 tokens, three times codex's effective cap.

### 5.3 Auto-compaction

The binary carries `tengu_auto_compact_start/end`, `autocompactRan`,
`hasAttemptedReactiveCompact`, `rapid_refill_breaker_tripped` and `DISABLE_AUTO_COMPACT` [C].
**It never fired here** [M]: largest claude-code context 95,712 tokens, zero shrinks.

### 5.4 Subagents

Public documentation: each subagent "uses its own context window separate from the main
conversation"; the bundle it receives is "its own system prompt plus environment details, the
delegation task message, your CLAUDE.md and memory hierarchy, a git-status snapshot … and the
full content of any skills named in its skills field" [W
[code.claude.com sub-agents](https://code.claude.com/docs/en/sub-agents),
[nimbalyst guide](https://nimbalyst.com/blog/claude-code-subagents-guide/)]. Practitioner
reports put subagent-heavy sessions at roughly 7 times the tokens of a single-thread session
[W].

**Measured on this run** [M `r2-turn-profile-and-subagents.mjs`, cache-normalised price]:

| arm | cells | cells that delegated | subagent transcripts | subagent turns | subagent cost | main-thread cost | sidechain share |
|---|---:|---:|---:|---:|---:|---:|---:|
| sweet TAB | 22 | **6** | 11 | 199 | `$0.197745` | `$1.171902` | **14.4%** |
| native | 22 | **15** | 33 | 314 | `$0.298656` | `$1.066464` | **21.9%** |

The main-thread column here sums **every** transcript in each cell, so its denominator differs
from §7.2, which keeps the three dearest per cell. Per rollout the three-dearest figures are
sweet `$0.016337` main plus `$0.002996` sidechain, native `$0.015918` main plus `$0.004525`
sidechain [M]. Those are the numbers used in §7.5.

Subagent first-request size: median **8,542** tokens on sweet, **6,108** on native, minimum
5,353 and 5,346, maximum 15,967 and 147,459 [M]. **A subagent does not re-pay the main agent's
full 17,500-token preamble; it pays a reduced bundle of 5,300 to 8,500 tokens.** But that
bundle is a fresh, uncached prefix, so all of it is billed at the full `$0.10` per million.

[I] The arm-identical minimum (5,353 against 5,346, a 7-token difference) is evidence that at
least some subagent types do **not** receive the sweet `CLAUDE.md`. The medians differ by
2,434 tokens, which is more than the guide. At 11 and 33 transcripts this question is not
settled, and the vendor documentation says inheritance does happen. **Do not build a lever on
subagent guide inheritance without measuring it directly.**

### 5.5 Usage in transcripts

One served request is written as many records that share `message.id` — 2.46 blocks per request
over 2,877 requests [C `claude-code-accounting.mjs:36`]. The first record is often a
`redacted_thinking` block with all-zero usage. **Taking the usage-bearing record per id is
exact**: across 1,939 multi-record ids, zero disagreed on any token category [C]. My
reconstruction reproduces the published main-thread totals to six decimals — sweet
`$1.182496 / 66 = $0.017917` and native `$1.130494 / 66 = $0.017129` [M], both matching
`FRESH-POOL-RESULTS.md` §2 exactly.

---

## 6. Literature on agent cost levers

### 6.1 Cost is quadratic in turns; caching moves the coefficient, not the exponent

"While the message history grows linearly with each iteration, total billed input tokens grow
quadratically because each call re-sends prior context" [W
[Augment Code](https://www.augmentcode.com/guides/ai-agent-loop-token-cost-context-constraints)].
A worked model gives `total_input = 4000n + 800 × n(n−1)/2` and the table 10 steps → 76,000
tokens against a 40,000 naive estimate, 30 steps → 468,000 against 120,000, 60 steps →
1,656,000 against 240,000 [W
[fatherofai](https://www.fatherofai.in/blog/llm-agent-cost-grows-quadratically/)]. The same
source states the rule that matters here: **"Caching reduces the coefficient. It does not touch
the exponent."**

Our measurement is the empirical version of that sentence. Cache hit rate is 99.3 to 100.0
percent and residency is still the largest term [M].

### 6.2 Tool output is the context

Anthropic's own context-engineering cookbook analyses a research agent's context and reports:
"File-read results comprise **~322,946 tokens (~96.3%)** of the 335,279-token context, with
tool-call records at 1.9%, agent reasoning text at 1.7%, and user/task prompts at 0.1%" [W
[Claude cookbook](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)].
Tool-result clearing on that run cut a 128,740-token context to 43,060, a 67 percent reduction;
compaction held the peak at 169,164 against a 335,279 baseline.

**And it names the accuracy cost.** Probing what survived compaction: "RESULT: high-level 3/3
preserved, obscure 0/3 preserved." "What it doesn't get you is verbatim fidelity on specifics"
[W]. That is the exact failure mode a code-edit agent cannot tolerate, because an `old_string`
anchor is an obscure specific.

Our own measurement of the same quantity is lower — roughly 70 to 75 percent of newly ingested
codex context is tool output [M §2.2] — because a SWE-bench-style task has a large fixed
preamble and short reads, not a 300,000-token document pile.

### 6.3 Budgeting tool use

*Budget-Aware Tool-Use Enables Effective Agent Scaling* (Liu, Wang, Miao et al., Google Cloud
AI Research and Google DeepMind, arXiv:2511.17006) reports that signalling the remaining budget
to the agent gives comparable accuracy with "40.4% fewer search calls, 21.4% fewer browse
calls, and reducing overall cost by 31.3%", and that a budget-aware scaffold reaches 24.6
percent against 12.6 percent for ReAct under an identical 100-call budget on BrowseComp [W
[arXiv](https://arxiv.org/html/2511.17006v1)]. Their context control is blunt: truncate fetched
pages to 150,000 characters and **discard tool outputs from previous steps**, keeping only the
most recent.

*CompactionRL: Reinforcement Learning with Context Compaction for Long-Horizon Agents*
(arXiv:2607.05378) reports that compaction-aware training improves the model's ability to act
on compacted histories [W]. That is the honest framing: compaction has an accuracy cost unless
the model was trained through it.

*Parallel Context Compaction for Long-Horizon LLM Agent Serving* (Cim, Topcu, Das, Kandemir,
Penn State, arXiv:2605.23296) measures synchronous compaction consuming **up to 62.4 percent of
end-to-end wall time**, and finds parallel compaction gives 1.37x to 2.13x throughput but
**0.80x to 0.86x wall time in some configurations** because uncached blocks must be re-prefilled
[W]. Compaction is not free even when it works.

### 6.4 Harness design sets the token economics

*Claw-SWE-Bench* (Zheng, Han, Li et al., arXiv:2606.12344, 2026-06-10) holds prompt, budget and
tasks constant and varies only the harness [W [arXiv](https://arxiv.org/html/2606.12344v1)]:

- Pass@1 spread across five harnesses on one model: **60.9 to 73.4 percent**, a 12.5-point gap;
  on a weaker model the spread is **27.4 points**.
- "Systems with similar accuracy can differ substantially in total API cost" — `$277.00` at
  73.4 percent against `$330.60` at 71.1 percent.
- **Cache hit rate is the harness variable they report: 96.5 percent down to 66.8 percent on
  one model, 97.6 percent down to 63.9 percent on another.**
- A minimal adapter reaches 19.1 percent Pass@1 with 69.1 percent apply failures; the full
  adapter reaches 73.4 percent with under 1.5 percent.

*The Harness Effect* (arXiv:2607.06906, July 2026) addresses the same question for enterprise
orchestration [W [arXiv](https://arxiv.org/pdf/2607.06906)]; its PDF did not yield extractable
numbers through the fetch tool, so it is cited for topic only.

**This is the single most useful external result for us.** Cache hit rate is the published
harness-level cost lever, and **we are already at 99.3 to 100.0 percent** [M]. There is no
headroom on the lever the literature says matters most between harnesses. Our differences must
come from turns, output and payload, not from cache engineering.

### 6.5 Cost and resolution do not correlate

*DeepSWE* (Huang, Lee, Tng, Ge, Datacurve, arXiv:2607.07946) tracks median output tokens,
median wall-clock and median dollar cost per trial and reports: "Output tokens, wall-clock
duration, and dollar cost per trial all vary by an order of magnitude across the agents shown,
**but none correlates strongly with pass rate**" [W
[arXiv](https://arxiv.org/html/2607.07946v1)].

That is an external replication of this programme's own repeated finding, and it is the reason
the fresh-pool report refuses to publish cost-per-solved.

### 6.6 Long-context degradation

Chroma's context-rot work tested 18 frontier models and found every one degrades as input
length grows; multi-document QA accuracy drops more than 30 percent when the relevant document
sits in the middle rather than at either end [W
[understandingai](https://www.understandingai.org/p/context-rot-the-emerging-challenge),
[morphllm summary](https://www.morphllm.com/context-rot)].

**Our contexts peak at 100,624 tokens** [M]. That is inside the region where degradation is
reported but far from the 100,000-plus padding regime where it becomes severe. [I] Context rot
is a plausible mechanism for wrong-fix behaviour on the longest rollouts, and it is not a cost
lever.

### 6.7 Instruction-file length

The practitioner consensus is that longer system prompts hurt: "The more you put into your
system prompt, the worse the agent performs", and long-context position effects apply to
bloated system prompts as much as to documents [W
[MindStudio](https://www.mindstudio.ai/blog/prompt-bloat-vs-skill-systems-ai-agents)].
*MAS-PromptBench* (arXiv:2606.23664) asks when prompt optimisation helps multi-agent systems at
all [W]. **No source we found measures instruction-file length against coding-agent resolution
with a controlled A/B.** Our own guide-shrink experiment would be novel evidence, not a
replication.

---

## 7. The cost model, with measured numbers

### 7.1 The model

For a rollout of `T` requests, where `in_t` is the full context of request `t` and `out_t` its
output:

```
INGEST   = Σ_t max(0, in_t − in_{t−1})        # every token, counted once, when first sent
PREFIX_t = in_t − max(0, in_t − in_{t−1})     # everything re-sent on request t
OUTPUT   = Σ_t out_t                          # visible output plus reasoning

cost = ( 0.10 × INGEST  +  0.01 × Σ_t PREFIX_t  +  0.60 × OUTPUT ) / 1e6
```

This is `idealCostUsd` exactly [C `ideal-cost.mjs:83`]. It equals `breakPricedUsd` whenever the
context only grows, which is every rollout in this run [M].

### 7.2 What the model reads on this run

Sweet TAB arm and native arm, three dearest transcripts per cell, cache-normalised price
`$0.10 / $0.01 / $0.60` [M `r2-cost-decompose.mjs`]. Claude-code figures are **main thread
only**; the sidechain is in §5.4.

| harness | arm | turns | INGEST | Σ PREFIX | OUTPUT | `$`/rollout | ingest | residency | output |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | sweet | 19.6 | 34,541 | 548,952 | 5,524 | `$0.012258` | 28.2% | **44.8%** | 27.0% |
| codex | native | 18.8 | 35,942 | 515,269 | 5,786 | `$0.012218` | 29.4% | 42.2% | 28.4% |
| opencode | sweet | 19.0 | 27,912 | 421,837 | 3,645 | `$0.009197` | 30.4% | **45.9%** | 23.8% |
| opencode | native | 16.3 | 30,359 | 376,466 | 3,606 | `$0.008964` | 33.9% | 42.0% | 24.1% |
| claude-code | sweet | 23.4 | 38,735 | 786,165 | 7,669 | `$0.016337` | 23.7% | **48.1%** | 28.2% |
| claude-code | native | 24.3 | 36,534 | 782,770 | 7,395 | `$0.015918` | 23.0% | 49.2% | 27.9% |

**Validation.** Codex realised cost from this parser is `$0.012330` sweet and `$0.012287`
native, matching the published table to six decimals [M]. Claude-code main-thread realised cost
matches `FRESH-POOL-RESULTS.md` §2 to six decimals [M]. Opencode's cache-normalised `$0.008964`
matches the published native `$0.008968` to 0.04 percent [M].

**Two derived quantities.**

| harness / arm | re-send multiplier `R = ΣPREFIX / INGEST` | effective price of an ingested token `$0.10 + 0.01R` per M |
|---|---:|---:|
| codex sweet | 15.9 | `$0.259` |
| codex native | 14.3 | `$0.243` |
| opencode sweet | 15.1 | `$0.251` |
| opencode native | 12.4 | `$0.224` |
| claude-code sweet | 20.3 | `$0.303` |
| claude-code native | 21.4 | `$0.314` |

**A token put into an agent context costs 2.2 to 3.1 times its sticker price.**

### 7.3 The 6,000-token tool output, worked

Take a 20-request rollout at the registered price. A single tool result of 6,000 tokens lands
in the context after request `k` and stays.

| where it lands | ingest charge | residency charge | total | ratio to ingest |
|---|---:|---:|---:|---:|
| after request 15 (5 re-sends) | `$0.000600` | `$0.000300` | `$0.000900` | 1.5× |
| after request 10 (10 re-sends) | `$0.000600` | **`$0.000600`** | `$0.001200` | **2.0×** |
| after request 5 (15 re-sends) | `$0.000600` | `$0.000900` | `$0.001500` | 2.5× |
| after request 1 (19 re-sends) | `$0.000600` | `$0.001140` | `$0.001740` | 2.9× |

**Break-even is exactly 10 remaining requests, because the input rate is 10 times the cache
rate.** Past 10 remaining requests, residency costs more than ingest. Our measured means are
15.9 to 21.4 re-sends, so **the typical tool result is past break-even and residency dominates
it.**

**The rule that follows: an early read is dearer than a late read of the same size.** A read at
request 1 costs 1.9 times a read at request 15. Retrieval that front-loads a large payload pays
for it on every later request.

### 7.4 Output at 60 times cached input

`$0.60 / $0.01 = 60`. That is the number people quote, and it is misleading on its own.

Against the **effective** price of an ingested token the ratio is `$0.60 / $0.259 = 2.3` on
codex and `$0.60 / $0.303 = 2.0` on claude-code.

Both readings are correct and they answer different questions.

- **Never trade output for re-sent context.** One output token costs 60 re-sent tokens.
- **Trading output against fresh ingest is nearly even.** One output token costs about 2.3
  freshly ingested tokens on codex. A tool that saves the model 3 tokens of reasoning by
  costing 6 tokens of payload is roughly cost-neutral.

Measured shares make the same point from the other side: **output is 0.94 percent of all
tokens in a codex sweet rollout and 27.0 percent of the bill** [M].

### 7.5 The tool guide, priced exactly

Guide size measured at the wire: **+1,457 tokens** on codex and opencode, **+1,577** on
claude-code [M §3.1, §4.1, §5.1]. It sits in the prefix, so it is ingested once and re-sent on
every later request.

```
guide cost = G × (0.10 + 0.01 × (T − 1)) / 1e6
```

| harness | G | T | guide cost / rollout | share of the rollout |
|---|---:|---:|---:|---:|
| codex | 1,457 | 19.6 | `$0.000417` | **3.4%** |
| opencode | 1,457 | 19.0 | `$0.000408` | **4.4%** |
| claude-code | 1,577 | 23.4 | `$0.000511` | **3.1%** (main thread) |

**Now subtract it from the measured arm difference.**

| harness | sweet | native | observed delta | minus guide | ex-guide delta |
|---|---:|---:|---:|---:|---:|
| codex | `$0.012258` | `$0.012218` | **+0.33%** | `$0.011841` | **−3.1%** |
| opencode | `$0.009197` | `$0.008964` | **+2.60%** | `$0.008789` | **−2.0%** |
| claude-code main | `$0.016337` | `$0.015918` | **+2.63%** | `$0.015826` | **−0.6%** |

**On all three harnesses the tool guide is larger than the whole observed cost penalty.**
Sweet's actual tool traffic is already cheaper than native's on every harness. The guide is
what turns that into a wash or a small loss.

**Claude-code reconciles completely.** Main-thread penalty `+$0.000419`, of which the guide is
`$0.000511`; delegation saving `$0.001529` per rollout (§5.4). Net `−$0.001110` on the
cache-normalised column, `−5.4 percent`. The published `−3.9 percent` is the realised column
including cache-write surcharges, and both are negative.

### 7.6 Gutter tokens, priced

Measured token overhead per numbered line, `o200k_base` over the four golden files [M, prior
work `GUTTER-MECHANISM-INVESTIGATION.md` §5.4]: none 8.66, tab 10.11 (+1.45), pipe 11.04
(+2.38), padded `cat -n` 12.11 (+3.45).

Numbered lines delivered per codex sweet rollout: 15,360 over 39 rollouts = **394 lines** [M,
prior work §5.1].

| form | extra tokens / rollout | cost at `$0.259`/M | share of a `$0.012258` rollout |
|---|---:|---:|---:|
| tab against none | 571 | `$0.000148` | 1.2% |
| pipe against none | 938 | `$0.000243` | 2.0% |
| **pipe against tab** | **366** | **`$0.000095`** | **0.77%** |

**The observed codex PIPE premium is +3.4 percent against TAB. The model explains 0.77 points
of it.** The remaining 2.6 points are behavioural or noise at n=66. This is independent
arithmetic support for the fresh-pool verdict that the delimiter is not a cost lever.

### 7.7 Per-turn state summaries — the term that is not in the table

A block that is **rewritten** rather than appended breaks the prefix. Every token after the
rewrite point is re-priced at `$0.10` instead of `$0.01` on the next request. That is the
`breakPricedUsd` column, and the harness comment records the measured consequence: on a 32k-cap
eviction replay the cache-normalised column read **+7.7 percent saved** while the policy
actually **lost 12.3 percent** [C `ideal-cost.mjs:70`].

A per-turn state summary placed at the front of the context is the worst possible shape. A
summary of `S` tokens rewritten at request `t`, with context `in_t`, costs
`0.09 × in_t` per million extra on that request alone. At `in_t = 40,000` that is `$0.0036`,
**29 percent of a whole codex rollout, for one rewrite.**

**Append-only is not a style preference. It is a 10x price difference on the suffix.**

### 7.8 Where in a rollout the money is

Share of cache-normalised cost by turn position, sweet arm [M
`r2-turn-profile-and-subagents.mjs`]:

| harness | first quarter of turns | last quarter | ratio last:first |
|---|---:|---:|---:|
| codex | 24.5% | 24.9% | 1.02× |
| opencode | 21.8% | 24.5% | 1.13× |
| claude-code | 23.6% | 25.5% | 1.08× |

**Cost is almost flat across turn position.** The first request carries a large uncached
preamble at 10 times the cache rate; later requests carry a larger but cached prefix plus more
output. The two effects nearly cancel.

**Two readings, and they differ.**

- **Observed distribution:** a verification tail of 5 turns out of 20 holds about 25 percent of
  the bill, the same as the first 5. Trimming the tail is worth what trimming the head is worth.
- **Counterfactual saving:** removing request `t` saves its own cost **plus**
  `0.01 × (tokens it added) × (T − t)` per million from every later request. **Removing an
  early turn saves more than removing a late one**, because its payload rides along for longer.

The lever is the count of turns. The position matters only for what the turn puts into the
prefix.

---

## 8. What the model predicts, ranked, per harness

Ordered by predicted size. Every figure is per rollout at the registered price.

### Codex — preamble 14,210 tokens, 19.6 turns, tool output already capped at ~2,500

| rank | lever | term | predicted size | why |
|---|---|---|---:|---|
| 1 | **fewer turns** | all three | `$0.00063` per turn removed | mean per-turn cost is `$0.012258 / 19.6`; codex is already the fewest-call harness |
| 2 | **shrink the tool guide** | ingest + residency | up to `$0.000417` = **3.4%** | measured `+1,457` tokens; halving it returns 1.7% |
| 3 | **fewer output tokens** | output | `$0.60`/M, 27.0% of the bill | reasoning is 1,717 of 5,524 output tokens; `REASONING=low` is a one-flag test |
| 4 | adaptive read window | ingest + residency | small | **codex already truncates at ~2,500 tokens**; the harness has done this lever |
| 5 | gutter form | ingest + residency | `$0.000095` = 0.77% | measured; below the noise floor of any affordable run |
| — | **compaction / eviction** | — | **0** | never fires; 100,624 of 1,050,000 tokens |

### OpenCode — preamble 6,744 tokens (smallest), 19.0 turns, read prompt says "always read 2000 lines"

| rank | lever | term | predicted size | why |
|---|---|---|---:|---|
| 1 | **shrink the tool guide** | ingest + residency | up to `$0.000408` = **4.4%** | smallest preamble, so the guide is the largest relative tax of the three; it is bigger than the whole observed sweet penalty |
| 2 | **adaptive read window** | ingest + residency | large, unmeasured | the harness's own prompt pushes 2,000-line reads [C]; this is where budgeting has the most room |
| 3 | fewer turns | all three | `$0.00048` per turn removed | sweet already runs 21.8 calls against native's 25.2 |
| 4 | fewer output tokens | output | 23.8% of the bill | lowest output share of the three |
| 5 | cache-write surcharge | realised only | `$0.000698` = 7.6% | a harness/provider behaviour, not a sweet lever; note it, do not chase it |

### Claude Code — preamble 17,518 tokens (largest), 23.4 turns, subagents 22% of native's bill

| rank | lever | term | predicted size | why |
|---|---|---|---:|---|
| 1 | **avoid delegation** | a fresh uncached prefix plus its own turns | `$0.001529` = **7.5%** | already achieved: 6 delegating cells against native's 15 [M]. This is the whole claude-code win |
| 2 | **fewer turns** | all three | `$0.00070` per turn removed | most turns of the three; sweet already runs 29.9 calls against native's 41.8 |
| 3 | **shrink the tool guide** | ingest + residency | `$0.000511` = **3.1%** | larger absolute delta (`+1,577`) than the other harnesses |
| 4 | fewer output tokens | output | 28.2% of the bill | highest output share |
| 5 | adaptive read window | ingest + residency | moderate | the 30,000-character Bash cap was never hit [M], so nothing is currently truncated |

### Cross-harness

**The single largest lever the model finds that is under our control is the tool guide.** It is
3.1 to 4.4 percent of every rollout, on every harness, and it is measured to the token at the
wire. It is also the only lever that is larger than the observed sweet-versus-native gap on all
three harnesses.

**The second is turns.** Cost is close to `T × constant`. Sweet already wins on calls by 13 and
28 percent on the two harnesses where calls are comparable, and that win is currently spent on
the guide.

---

## 9. What this model kills, at zero cost

1. **Compaction, eviction, context rewriting, tool-result clearing.** Never fires here; largest
   context is 9.6 percent of the window [M]. Consistent with the eviction and fusion no-go
   already on record.
2. **Cache-hit engineering.** Already 99.3 to 100.0 percent [M]. The literature's headline
   harness lever has no headroom for us [W Claw-SWE-Bench 63.9 to 97.6 percent].
3. **Gutter delimiter as a cost lever.** 0.77 percent of a codex rollout by direct arithmetic
   [M]. It cannot produce the 3.4 percent observed difference.
4. **"Trim the verification tail" as a special case.** Cost is flat across turn position [M].
   A tail turn costs what a head turn costs. Only the payload it leaves behind differs.
5. **Per-turn state summaries in the prefix.** They break the cache and cost roughly `0.09 ×
   context` per rewrite [C]. Any such lever must be read on the break-priced column, and the
   programme has already been burned once by not doing so.

---

## 10. Items I could not finish

1. **The exact codex `exec_command` output cap is not in any document I found.** Measured at
   about 2,500 tokens [M]; documented default for the code-mode `exec` tool is 12,000 [W]. The
   two do not reconcile. Settling it needs the codex-rs source for the non-unified exec path,
   which is not on the box.
2. **`The Harness Effect` (arXiv:2607.06906) yielded no extractable numbers** through the fetch
   tool — the PDF returned compressed streams. Cited for topic only.
3. **Whether claude-code subagents inherit the sweet `CLAUDE.md` is unresolved.** Vendor
   documentation says yes [W]; the arm-identical minimum bundle size says at least some do not
   [M]. n = 11 and 33 transcripts. Needs a direct probe, not more arithmetic.
4. **No controlled study of instruction-file length against coding-agent resolution exists in
   the literature I searched.** Practitioner consensus only [W].
5. **No source measures adaptive read windows for code agents.** The nearest evidence is
   budget-aware tool use with blunt truncation [W arXiv:2511.17006] and opencode's own
   "always read 2000 lines" instruction [C]. Sizing a read window against remaining turns is,
   as far as this search goes, unmeasured.

---

## 11. Reproduction

Box `root@167.233.69.121`, read-only. Scratch `/tmp/fp-inv/r2/`. Scripts kept at
`eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/scripts/`:

| script | what it produces |
|---|---|
| `r2-cost-decompose.mjs` | per-harness INGEST / Σ PREFIX / OUTPUT and the three cost shares (§7.2) |
| `r2-cache-hit.mjs` | actual cache-hit fraction, cache-write volume, share of input ever billed at full rate (§0, §4.4) |
| `r2-turn1-preamble.mjs` | first-request token counts per harness and arm — the guide delta (§3.1, §4.1, §5.1) |
| `r2-context-shrink.mjs` | compaction detector: rollouts with a >10% context shrink, max context (§0, §3.5, §5.3) |
| `r2-reasoning-residency.mjs` | whether prior output re-enters the prefix, codex (§2.2) |
| `r2-turn-profile-and-subagents.mjs` | cost by turn position; claude-code sidechain accounting (§5.4, §7.8) |
| `r2-codex-binary-probe.sh` | binary-string probe template (superseded by the inline greps in §3) |

```bash
ssh -o BatchMode=yes root@167.233.69.121 'mkdir -p /tmp/fp-inv/r2'
scp scripts/r2-cost-decompose.mjs root@167.233.69.121:/tmp/fp-inv/r2/
ssh -o BatchMode=yes root@167.233.69.121 \
  'node /tmp/fp-inv/r2/r2-cost-decompose.mjs \
   /root/sweet-search-private/eval/task-completion-bench/results fp-codex-tab-20260826 codex'
```

Token counts use `tiktoken` `o200k_base` in a local virtual environment
(`python3 -m venv /tmp/tk && /tmp/tk/bin/pip install tiktoken`). The box has no `tiktoken`.

---

## Sources

- [OpenAI — Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI — Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- [OpenAI Codex — Sample configuration](https://learn.chatgpt.com/docs/config-file/config-sample)
- [OpenRouter — Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [OpenRouter — models API](https://openrouter.ai/api/v1/models) and [GPT-5.6 Luna](https://openrouter.ai/openai/gpt-5.6-luna)
- [OpenCode — Tools](https://opencode.ai/docs/tools/) · [prompt-construction gist](https://gist.github.com/rmk40/cde7a98c1c90614a27478216cc01551f) · [built-in tools reference](https://deepwiki.com/sst/opencode/5.3-built-in-tools-reference) · [issue 25337, 2000-char line cap](https://github.com/anomalyco/opencode/issues/25337)
- [Claude Code — Sub-agents](https://code.claude.com/docs/en/sub-agents) · [Tools reference](https://code.claude.com/docs/en/tools-reference) · [issue 19901, Bash 30k cap](https://github.com/anthropics/claude-code/issues/19901) · [issue 40357, Read token cap](https://github.com/anthropics/claude-code/issues/40357) · [issue 52979, fixed overhead](https://github.com/anthropics/claude-code/issues/52979) · [Piebald-AI system-prompt archive](https://github.com/Piebald-AI/claude-code-system-prompts)
- [Anthropic — Context engineering: memory, compaction, tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)
- [Claw-SWE-Bench, arXiv:2606.12344](https://arxiv.org/html/2606.12344v1)
- [DeepSWE, arXiv:2607.07946](https://arxiv.org/html/2607.07946v1)
- [Budget-Aware Tool-Use, arXiv:2511.17006](https://arxiv.org/html/2511.17006v1)
- [Parallel Context Compaction, arXiv:2605.23296](https://arxiv.org/html/2605.23296v1)
- [The Harness Effect, arXiv:2607.06906](https://arxiv.org/pdf/2607.06906)
- [Augment Code — AI agent loop token cost](https://www.augmentcode.com/guides/ai-agent-loop-token-cost-context-constraints)
- [Your LLM cost model is linear; your agent is not](https://www.fatherofai.in/blog/llm-agent-cost-grows-quadratically/)
- [Context rot — Understanding AI](https://www.understandingai.org/p/context-rot-the-emerging-challenge) · [Morph summary](https://www.morphllm.com/context-rot)
- [Prompt bloat vs skill systems](https://www.mindstudio.ai/blog/prompt-bloat-vs-skill-systems-ai-agents)
- [Shipyard — Claude Code tokens](https://shipyard.build/blog/claude-code-tokens/) · [HN 48883275 — 33k vs 7k](https://news.ycombinator.com/item?id=48883275)
