# c13 — adversarial verify, HISTORY lens

**Verdict: REFUTED (confidence 0.90).** The remedy c13 proposes is already shipped by Claude
Code itself. Every Claude Code binary in evidence — the bench binary 2.1.218 and every current
build 2.1.247 through 2.1.258 — puts the sentence *"You must use your `Read` tool at least once
in the conversation before editing. This tool will error if you attempt an edit without reading
the file."* into the **Edit tool description**, unconditionally on 2.1.218 and for every gated
model on 2.1.258 `[C, verified byte-level by me on both binaries]`. That instruction reaches the
model in the cached prefix of every request, in both arms, at zero marginal cost to sweet. c13's
payload is a verbatim restatement of it. Restating a standing instruction inside a tool result is
register row **A6** (mid-task advisories and footer nudges, DEAD in three acts) delivered in the
trailer channel, and register row **P1/F8** (rule-only clauses, DEAD, flat 3 of 8 in every
condition) in content class. The bench already measured the compliance of this exact sentence in
this exact channel: the harness printed it in all 66 sweet claude rollouts and sweet still made
**68 first edits of an existing file with no prior native `Read`, in 56 of 66 rollouts**
`[M forensics/claude-main-thread.md §4.1]`. Two further faults: the priced ceiling is about
double the truth, and the detection channel is wrong inside a subagent.

Tags: `[M]` measured, `[C]` read from code, `[W]` web, `[I]` inferred. `$0` spent. No product or
bench code touched. Nothing written to the evidence box. The frozen held-out set was not opened.

---

## 1. The killing fact: the harness already says it

### 1.1 Current binary, 2.1.258 (this machine runs it) `[C]`

Byte offsets are into `/Users/admin/.local/share/claude/versions/2.1.258`.

- Offset 162400351, `function yYr()` returns:
  `"- You must use your \`Read\` tool at least once in the conversation before editing. This tool
  will error if you attempt an edit without reading the file."`
- Offset 162400530, `function _Yr()` returns the weaker outside-the-working-directory variant.
- Offset 162400771, `function bYr(model, leanPrompt, preReadLineDropped)` builds the Edit tool
  description. It computes `d = !CLAUDE_CODE_SIMPLE && preReadLineDropped(model)` and emits
  `yYr()` when `d` is false, `_Yr()` when `d` is true.
- `preReadLineDropped(model)` returns **false whenever the model is in the guard set**
  (`function C(e){ ... if(p(ze(e))) return !1; ... }`, where `p(e)=N.has(tn(e))`).

So the strict sentence is emitted for exactly the models where the `Edit` gate fires. c13 adds
nothing the gated model has not already been told, in every single request.

### 1.2 Guard set, re-verified `[C]`

Offset 159198071 of 2.1.258:

`var N=new Set(["claude-opus-4-6","claude-haiku-4-5","claude-opus-4-5","claude-opus-4-1",
"claude-opus-4-0","claude-sonnet-4-5","claude-sonnet-4-0","claude-3-7-sonnet",
"claude-3-5-sonnet","claude-3-5-haiku"]);`

Exactly ten legacy ids, as the sibling reports say. The binary's own model roster (offset
159633537) lists 22 ids including `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`,
`claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6`. **None of the current flagship ids is
in the guard set.** Of today's lineup only Opus 4.6 and Haiku 4.5 are gated.

### 1.3 Correction: the bench binary 2.1.218 also carries the sentence `[C]`

`forensics/claude-main-thread.md` §4.3 states that on 2.1.218 the "`Edit` description has no
read-first sentence". **That is wrong.** Read on the evidence box (read-only, no writes):

```
function wSy(e){let t=FPt();if(gE(e))return`Performs exact string replacement in a file.

- You must ${zi} the file in this conversation before editing, or the call will fail.
...`;
  ...
  return`Performs exact string replacements in files.

Usage:${ASy()}
...`}

function ASy(){return`
- You must use your \`${zi}\` tool at least once in the conversation before editing. This tool
will error if you attempt an edit without reading the file.`}
```

`wSy` takes only the model and branches on the lean-prompt check. **Both branches carry the
read-first instruction, with no model gating at all.** String counts confirm it, on the bench
binary and on every locally installed build `[M]`:

| binary | `"tool at least once in the conversation before editing"` | `"in this conversation before editing, or the call will fail"` |
|---|---:|---:|
| 2.1.218 (box, bench binary) | 2 | 1 |
| 2.1.247 / .248 / .250 / .251 / .252 / .257 / .258 (local) | 2 each | 4 each |

### 1.4 Therefore the bench already measured this instruction's compliance `[M]`

The bench binary printed the read-first instruction in the Edit tool description of every sweet
claude request. Sweet still committed 68 first edits of an existing file with no prior native
`Read`, across 56 of 66 rollouts, and made 0 native `Read` calls prompted by the sentence
(`forensics/claude-main-thread.md` §4.1). Native's 92 of 92 first edits were preceded by a
`Read`, but only because native's `Read` **is** its retrieval, not because of the sentence.

The honest caveat: the backbone was `openai/gpt-5.6-luna`, which register row A1 records as
instruction-deaf. A gated Anthropic model might comply. Nobody has checked. That check is the
second half of H1's own revival condition and it has not been run.

---

## 2. The register rows this lands on

| row | verdict on record | why c13 is that row |
|---|---|---|
| **H1** | UNMEASURED product risk. Revival: "a `$0` price of the extra read-plus-edit pair, **and** a small check on a real Anthropic model." | c13 is the explicit revival. Half the condition is met (the price exists). The Anthropic-model check does **not** exist: the live verification ran on `claude-fable-5-1`, which is not in the guard set, so the gate never fired `[M, my own session transcript: 75 assistant records, all model `claude-fable-5-1`]`. |
| **A6** — mid-task advisories, footer nudges, stall controller | DEAD, three acts; "third of three independent channels in which the backbone ignores mid-task instruction". Revival: backbone change. | c13's delivery channel is a footer line appended to a tool result. That is the same channel. |
| **P1 / F8** — general clauses | DEAD; every condition solved exactly 3 of 8 tasks over 153 rollouts. | c13's payload is a prose rule, not a computed fact about the code. |
| **F9** — hint ladder | Computed certificates flip tasks (apple 0/3 → 16/16); **prose rules 0/3, placebo 0/4**. "The value is the computation, not the rule." | c13 computes only *when to restate a rule*. The delivered content is the rule. |
| **E4** — sibling-site echo trailer | DEAD; ambient presence in a tool result produced no action, twice. | Another tool-result trailer that the model did not act on. |
| **C-A1** (`research/anthropic-model-product-path.md` §7) | The same lever with a guide vehicle. Its own author writes: "This is a *product-correctness* item with a near-zero head-to-head differential on the current bench backbone. It should not be counted as a cost lever." | c13 is C-A1 plus a runtime suppression gate. Same mechanism, same population, same zero bench ceiling. |
| **D4a** — the claude-code `pages` prompt note (the candidate's claimed class) | SHIPPED, arm-symmetric, and it repaired **native's** cost. | The analogy fails. D4a corrected an argument-schema quirk of our own harness adapter that no model could know, delivered byte-identically to both arms. c13 repeats a sentence the harness itself already prints to both arms. |
| **D4b** — the PreToolUse normalizer for the residual `pages` failures | BLOCKED; "no documented Claude Code surface can close the gap". | Cautionary precedent, not a kill: an outside-in repair of a Claude Code protocol defect already failed once. |

**c13 does not escape any of these.** Its stated escape — "not a reasoning rule and not in the
guide; a computed harness-protocol fact like D4a" — is refuted by §1: the fact is not new to the
model, because the harness states it verbatim in the Edit tool description on every request.

---

## 3. The ceiling is about half of what the candidate claims

`forensics/claude-main-thread.md` §4.2 prices the gate at **$0.00127 (immediate) to $0.00153
(lifetime) per rollout, 7.8% to 9.4% of the claude-code sweet main-thread arm** `[M]`. That
price is for **two** extra requests: request B, the native `Read`, and request C, the re-issued
`Edit`.

c13 cannot avoid request B. `readFileState` is written only by `Read`, `Edit`/`Write` and the
memory paths `[C, register H1 and research §2]`, so the native `Read` is the only thing that
satisfies the precondition, and making the model issue it is c13's entire purpose. Sweet
therefore still pays a duplicate read on top of its `ss-read`.

- Without c13, on a gated model: `ss-read` → `Edit` fails → `Read` → `Edit`. Three requests.
- With c13: `ss-read` → `Read` → `Edit`. Two requests.
- With no gate (today's bench): `ss-read` → `Edit`. One request.

c13 removes **one of the two** extra requests. Honest ceiling, scaling F6's own numbers:
**about $0.00064 to $0.00077 per rollout, about 3.9% to 4.7% of the claude-code sweet
main-thread cell** `[I, arithmetic on M]` — on legacy Anthropic models only, and **0.0% on every
cell of every bench run** by the candidate's own admission.

The "blind clause wastes 5.5% on ungated models" argument also weakens. On ungated current
models the harness's own Edit description still tells the model to read first
(`research/anthropic-model-product-path.md` §1.4, observed live). Any voluntary extra `Read` is
already caused by the harness. c13 cannot suppress that; it can only decline to add a second
reminder.

---

## 4. The detection channel is wrong inside a subagent

Verified on this machine, Claude Code 2.1.258, from inside a subagent `[M]`:

- `CLAUDE_CODE_SESSION_ID=559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f` is set, and it is the **parent**
  session id. `CLAUDE_CODE_CHILD_SESSION` is also set.
- The proposed glob `~/.claude/projects/*/$CLAUDE_CODE_SESSION_ID.jsonl` resolves to
  `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/559eb8e8-….jsonl`
  (2,126,547 bytes, live-appended). Parsed: 455 records, 0 unparsable, 75 assistant records with
  `message.model = claude-fable-5-1`, 4 `Read` tool uses all carrying `input.file_path`.
- **`isSidechain` is false on all 455 records.** The subagent's own tool calls are not in that
  file. They live at
  `~/.claude/projects/<slug>/<session-id>/subagents/workflows/<wf-id>/agent-<id>.jsonl`
  — eight such files, mtimes current.

Claude Code gives each subagent its own read state; the slate's own census script says so in a
source comment (`forensics/scripts-claude-main-thread/cc-readgate-census.mjs` line 44). So inside
a subagent the detector reads the **parent's** read state and fails in the harmful direction: the
parent read the file, the hint is suppressed, and the subagent's `Edit` still errors. Sweet
delegated in **9 of 66** claude tab rollouts and **24 of 198** pooled fresh-pool rollouts
`[M forensics/claude-subagents.md §1.1]`. The candidate's kill conditions do not cover this case.

---

## 5. The pre-registered falsifier cannot fail

Falsifier (b) replays `fp-claudecode-tab-20260826` sweet, reconstructs the (file, first-edit)
pairs with no prior `Read`, and compares against "the 68 gated files `claude-main-thread` F6
counted **by a different route**". It is not a different route. `cc-readgate-census.mjs` derives
the 68 from the same claude transcripts under `agent-state/*/claude-home/**`
(`m.transcript.parsed` and `m.transcript.sub`, script lines 40 to 80) `[C]`. The comparison tests
a parser against a parser. It cannot test the runtime channel, which is where the real failure
modes are: environment-variable scope in a subagent, transcript flush latency relative to the
Bash child, and per-agent read state.

Falsifier (a) — the channel check — is real and passed, but on an **ungated** model, so it
observed nothing about gate behaviour.

---

## 6. What I could not finish

1. I did not run falsifier (b). It needs the box transcripts and a replay script; the history
   lens did not require it, and §5 argues it would not settle the question anyway.
2. I did not check a gated Anthropic model live. That costs money and is barred by the `$0` rule.
   It remains the missing half of H1's revival condition.
3. I did not measure transcript flush latency, that is, whether a `Read` from the immediately
   preceding turn is on disk before the next Bash child runs. That belongs to the mechanism lens.
4. I did not audit `preReadLineDropped`'s server-side value. It is resolved from a remote model
   config `[C]`, so an ungated model may or may not see the strict line in practice. It does not
   change the verdict, because the gated case is settled by the code path in §1.1.

---

## 7. Corrections the synthesis must adopt

1. **`forensics/claude-main-thread.md` §4.3 is wrong** where it says 2.1.218's `Edit` description
   has no read-first sentence. `[C]` `wSy()` carries it in both branches, unconditionally.
2. **c13's ceiling is about 3.9% to 4.7%** of the claude-code sweet main thread, not 7.8% to
   9.4%. The native `Read` is unavoidable; only the failed `Edit` is saved.
3. The verified install is **2.1.258**, not 2.1.257. The guard set is unchanged and is exactly
   the ten legacy ids.
4. Register H1's "218 of 259 sweet edits" is superseded by the cost-matched census: **219 of
   244** edit calls had no prior native `Read`, and the gate-relevant figure is **68 first edits
   of an existing file across 56 of 66 rollouts**.
5. `CLAUDE_CODE_SESSION_ID` inside a subagent names the **parent** session, and subagent
   transcripts sit under a different path. Any transcript-derived read state must be scoped per
   agent.
6. Falsifier (b) is not independent of the F6 census and should be replaced or dropped.
7. **Register H1 should be re-dispositioned** from "UNMEASURED product risk" to: *MEASURED and
   narrowed. Applies only to ten legacy model ids. The harness already delivers the remedy in the
   `Edit` tool description on every binary in evidence. Bench ceiling 0.0%; legacy-user ceiling
   about 4% of the claude-code sweet main thread.*

---

## 8. Evidence opened

- `eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/DEAD-LEVER-REGISTER-DRAFT.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/register/DEAD-LEVER-REGISTER.md` — §0.1,
  §0.2, §1 (A1, A5, A6, A7), §4 (D1a, D1b, D2, D3, D4a, D4b, D5, D6), §7 (P1–P5), §8 (H1, H2),
  §9 (G1a–G22), §12.4, §12.5
- `eval/task-completion-bench/handoffs/improve/slate-c/candidates/harness-adaptive-rendering.md`
  §C-2 (the candidate's own text) and its limitations note
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/claude-main-thread.md` §0 item 3,
  §4.1, §4.2, §4.3
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/claude-subagents.md` §0, §1.1
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-claude-main-thread/cc-readgate-census.mjs`
  lines 1–80
- `eval/task-completion-bench/handoffs/improve/slate-c/research/anthropic-model-product-path.md`
  §1.3, §1.4, §1.5, §7 (C-A1)
- `/Users/admin/.local/share/claude/versions/2.1.258` (and .247, .248, .250, .251, .252, .257)
- `root@167.233.69.121:/root/.local/share/claude/versions/2.1.218` (read-only)
- `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f.jsonl`
  and `.../559eb8e8-…/subagents/workflows/wf_2b8e698f-673/agent-*.jsonl`
- Run referenced: `fp-claudecode-tab-20260826` (aggregate figures only, via the two sibling
  forensics reports; no per-task grading log was opened)
