# Gemini 3.1 Pro Deep Think — Round-6 Reflection

Model: gemini-3.1-pro-preview
Wall: 67047ms
Tokens: in=69923 out=1670 thinking=6469
Web searches: (none)

---

### Top-Line Recommendation
**I strongly recommend a targeted hand-craft edit.** The optimizer has found a highly effective local optimum (0.987 sharpness), but it is currently trapped by the length penalty: it cannot add the necessary safety rails to prevent token blow-ups and infinite loops because it hasn't figured out how to delete its own bloated prose to make room. By surgically pruning the verbose "Stateful summary" rule, we can free up ~30 tokens to add hard bounds on file reads and retry loops, fixing the remaining edge cases while strictly staying under the 980-token limit.

Here is the data-driven breakdown answering your questions.

---

### Q1: Sonnet Accuracy Drop (0.002) & Structural Fix
**The Culprit:** Sonnet's accuracy is 0.998, meaning it failed partially on exactly one probe out of 40. The data shows this is `cpp-005` (score 0.92). 
**The Cause:** `cpp-005` is a `multi-file-flow` probe in a C++ repository (`highway`). Look at the winner's `Multi-file flow` section: it explicitly instructs the agent to look for a file that *"imports another module"* and trace the *"downstream module"*. C++ does not use module imports in the JS/Python sense; it uses `#include` directives for header files. Sonnet likely failed to execute the multi-file trace because it was rigidly looking for "imports".
**The Fix:** Broaden the terminology. Change *"imports another module"* to *"imports/includes another file"*.

### Q2: GPT-5.5 Token Blow-up
**The Culprit:** GPT-5.5 is burning 43,516 tokens per probe (nearly 5x the native baseline of 9,100), despite making *fewer* tool calls than native (5.5 vs 7.7). 
**The Cause:** If an agent is making few calls but burning massive tokens, the tokens are either going to inputs (reading massive context) or outputs (chatty generation). 
1. **Unbounded Reads:** The prompt defines `[[ss-read]] <file> [start] [end]` but never enforces the bounds. GPT-5.5 is almost certainly omitting the optional bounds and executing blind full-file reads.
2. **Verbose Outputs:** The `Output` section asks the agent to "explain how they answer the query," which invites GPT-5.5's notoriously chatty CoT/summarization behavior.
**The Fix:** Mandate line bounds (`ALWAYS use [start] [end] bounds; never read full files`) and enforce a strict length limit on the final answer (`provide a CONCISE 1-2 sentence explanation`).

### Q3: Pruning for Token Discipline (<= 980 tokens)
**The Culprit:** To add the fixes from Q1 and Q2 without hitting the length penalty, we must prune. The `Stateful summary rule` in the winner prompt is bloated with conversational LLM-isms.
**The Target:** 
> *"Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first, you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question."* (56 words)
**The Fix:** This can be aggressively compressed without losing the semantic trigger:
> *"Before your 3rd query or final answer, you MUST output a `<state_summary>` block: (1) one sentence on findings so far, (2) one sentence on the open question."* (27 words)

### Q4: Structural Patterns Missed by the Optimizer
**The Culprit:** The optimizer failed to learn *when to give up*. 
**The Cause:** Look at `kotlin-009` (a `no-match` probe). Sonnet made **27 calls** (vs native 7). Similarly, `js-007` took 23 calls. The `Stopping` section tells the agent: *"Conclude [[no-match]] only after verifying absence (a symbol search and a broad [[ss-grep]] both empty)."* However, it provides no upper bound on how many synonyms or alternate approaches to try before executing that final broad grep. The agent gets stuck in a loop of "broadening" the search.
**The Fix:** Add a hard retry cap to the `Stopping` section: *"Max 3 failed attempts per conceptual path."*

---

### Q5: The Exact Hand-Craft Diff
Apply the following surgical replacements to the winner prompt. This diff removes ~20 words overall, guaranteeing you will stay safely below the 980-token limit while patching the C++ include bug, the GPT-5.5 token blow-up, and the Sonnet infinite loops.

**1. Replace `### [[ss-grep]] / [[ss-read]]`**
```diff
- [[ss-grep]] for exact literal patterns; [[ss-read]] to confirm or expand context on a file.
+ [[ss-grep]] for exact literal patterns; [[ss-read]] to confirm context. ALWAYS use [start] [end] bounds; never read full files.
```

**2. Replace `## Multi-file flow`**
```diff
- When [[ss-search]] surfaces a file that imports another module, follow the chain: [[ss-semantic]] on the entry file to find the import, then [[ss-search]] (or [[ss-find]] once the symbol is known) on the downstream module, then [[ss-read]] if needed. Follow the chain only while each hop yields progress.
+ When [[ss-search]] surfaces a file that imports/includes another, follow the chain: [[ss-semantic]] on the entry file to find the import, then [[ss-search]] (or [[ss-find]] once the symbol is known) on the downstream file, then [[ss-read]] if needed. Follow the chain only while each hop yields progress.
```

**3. Replace `## Stateful summary rule`**
```diff
- Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first, you MUST output a <state_summary> block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.
+ Before your 3rd query or final answer, you MUST output a <state_summary> block: (1) one sentence on findings so far, (2) one sentence on the open question.
```

**4. Replace `## Stopping`**
```diff
- Stop once you have confirmed evidence; don't over-search. If an attempt fails, change approach rather than repeating a near-identical query. Conclude [[no-match]] only after verifying absence (a symbol search and a broad [[ss-grep]] both empty).
+ Stop once you have confirmed evidence. Max 3 failed attempts per conceptual path. Conclude [[no-match]] immediately after a symbol search and a broad [[ss-grep]] both return empty.
```

**5. Replace `## Output`**
```diff
- Name the file(s) and symbol(s) involved and explain how they answer the query, or [[no-match]].
+ Name the file(s)/symbol(s) and provide a CONCISE 1-2 sentence explanation, or [[no-match]].
```
