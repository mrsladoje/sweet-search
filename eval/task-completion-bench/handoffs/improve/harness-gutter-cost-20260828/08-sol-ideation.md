# Mechanistic Verdict — August 28, 2026

1. **[C] The cost identity is simple; the fresh report does not publish its three components.** For Luna,
   \[
   C=0.10N_{\text{new}}/10^6+0.01N_{\text{resent}}/10^6+0.60N_{\text{out}}/10^6
   \]
   where each turn resends its entire prior prefix (`eval/task-completion-bench/harness/ideal-cost.mjs:54`). Thus **100 output tokens cost as much as 600 fresh-input or 6,000 cached-prefix tokens**. Aggregate tool bytes cannot identify the winning component.  
   **Falsifier:** run `costFromTurns` over the retained fresh transcripts and publish new-input, resend, and output dollars by harness/arm/form.

2. **[I] Sweet’s old advantage vanished because its fixed taxes stayed fixed while native’s payload gap narrowed.** Native’s individual `sed`/`rg` outputs shrank 32–63%; sweet’s `ss-read`/`ss-search` outputs stayed roughly flat because they are package-budgeted (`FRESH-POOL-RESULTS.md:99`). Sweet still delivered 18% fewer total tool bytes, so “native read shrink” alone cannot explain cost parity. The missing terms are the guide, gutters, turn count, and output.  
   **Falsifier:** counterfactually subtract only guide and gutter tokens from each fresh turn; if sweet remains at parity, trajectory/output—not fixed taxes—dominates.

3. **[I] The 1,307-token guide is large enough to erase a small retrieval win by itself.** It costs about `$0.000131` on first ingestion. Over 18 model requests, its 17 cached resends add `$0.000222`, totaling roughly **`$0.000353`**, or 3.8% of a `$0.0093` OpenCode rollout. Every Claude sidechain starts another independent prefix. The guide also mandates a visible `<state_summary>` and insists that subagents receive it verbatim (`sweet-search-system-prompt.md:24`, `:48`).  
   **Falsifier:** identify the exact guide token interval in turn deltas and recompute cost with that interval removed.

4. **[I] Sweet’s excess by component is:**
   - **Ingest:** guide + gutters + result headers/fences/trailers + up-to-3k default search packs; an un-ranged `ss-read` still renders a whole file.
   - **Resident resend:** the guide and any large early search result recur on every later request. Early bytes are much dearer over their lifetime than late bytes.
   - **Output:** extra reasoning, retries, summaries, or delegation decisions can overwhelm thousands of gutter tokens because output is priced 6× fresh input and 60× cached input.

   The repaired OpenCode rebaseline illustrates this: sweet’s unique-content cost was approximately **8.1% lower**, but resident resend was **5.7% higher**, leaving only the reported 2.8% net win.  
   **Falsifier:** fresh per-turn component totals showing no sweet resident-resend excess.

5. **[C] The tool contract creates a floor native tools do not have.** `ss-search` defaults to top-5 and auto-selects a 3k/8k/12k package (`_ss-helpers.mjs:615`); `ss-read` defaults to a whole-file body unless the model supplies ranges; all current search/read/semantic code blocks are now numbered (`_ss-helpers.mjs:63`). Native can issue exactly `sed -n '140,190p'` or one narrow `rg`. Sweet decides its payload before it knows how much task context remains.  
   **Falsifier:** replay fresh commands through candidate renderers and show that sweet payload size already falls with remaining-turn count or task ambiguity.

6. **[C] Direct gutter cost has one invariant ordering on every harness:** **NONE < TAB < PIPE**. The `o200k_base` proxy measured overheads of **0**, **+1.48**, and **+2.40 tokens/line**, respectively (`GUTTER-MECHANISM-INVESTIGATION.md:331`). The exact Luna tokenizer is unpublished, but the large TAB–PIPE ordering is unlikely to reverse. Current code also applies the gutter to surfaces that were unnumbered during the fresh experiment, so the experiment understates today’s direct tax.  
   **Falsifier:** exact provider-token deltas from identical current-renderer outputs under the three forms.

7. **[I] Harness-specific prices separate cleanly into three effects.**
   - **Codex:** PIPE’s +3.8% is directionally consistent with direct token cost and earlier truncation. Its whitespace-tolerant `apply_patch` gives no compensating edit mechanism.
   - **OpenCode:** TAB being dearer than PIPE despite fewer direct tokens proves behavioral variance dominates—turns, generated text, patch attempts, or rereads.
   - **Claude Code:** the observed PIPE < NONE < TAB cost ordering is opposite direct token cost. Delegation explains part, but not all: only about 35% of the TAB–PIPE total gap is literal sidechain dollars; main-chain cost also changes with whether and when delegation occurs.

   **Falsifier:** compare direct gutter dollars, pre-spawn main-chain dollars, and post-spawn/sidechain dollars within matched task×rep cells.

8. **[I] Among the three tested forms, the mechanistic defaults should be:**

   | Harness | Form | Reason |
   |---|---|---|
   | Codex | **NONE** | Lowest direct cost; tolerant patch matching; no measured gutter benefit. |
   | OpenCode | **NONE** | Same tolerant patch path; native `N: ` prior did not translate into a resolution mechanism. |
   | Claude Code | **TAB** | Byte-shape matches its explicit `Read`/`Edit` stripping contract and avoids PIPE’s trailing-space ambiguity. |

   These are mechanism-based defaults, not fresh-pool significance claims; the current all-surfaces renderer still needs a DEV confirmation.  
   **Falsifier:** a current-renderer DEV A/B showing ≥6-rollout loss for NONE on Codex/OpenCode, or equivalent anchor failures under Claude TAB.

9. **[H] Three new designs merit cheap testing—but none can beat NONE on direct tokens; they must beat it through fewer rereads or edit failures.**

   | Design | Expected overhead/line | Main risk |
   |---|---:|---|
   | **Sidecar ruler:** raw code plus an external start/end and ten-line tick map | ~`+0.05–0.15` | Model may count rows incorrectly; code itself remains anchor-clean. |
   | **Sparse-10 TAB:** number first/every tenth line | measured ~`+0.15` | Mixed prefixed/raw lines violate Claude’s “every line” prior. |
   | **Landmark-only TAB:** number definitions/classes/decorators | measured ~`+0.067` | Language coverage gaps; weak support for arbitrary line targeting. |

   Measurements for sparse forms are in `harness-gutter-cost-20260828/logs/r1-tokens.json:1`.  
   **Falsifier:** synthetic exact-copy/edit trials plus trace replay showing no avoided follow-up reads relative to NONE.

10. **[I] “The delimiter is not a lever” is wrong as written.** It is not a demonstrated **resolution** lever, but it is unquestionably an ingest-and-resend cost lever.  
    **Falsifier:** identical token counts for NONE, TAB, and PIPE on current outputs.

11. **[I] The source comment claiming “−16% agent cost, no solve loss” is obsolete and causally overbroad** (`core/search/search-read.js:621`). Fresh TAB is +0.3% Codex, +3.3% OpenCode, and −3.9% Claude versus native. The old result cannot be attributed to the delimiter alone.  
    **Falsifier:** a post-repair, current-surface run reproducing −16% across harnesses.

12. **[I] “Claude cost differences are a delegation coin flip” is too strong.** Spawn count correlates with cost, but the main-chain spread exceeds the direct sidechain-dollar spread; correlation is not mediation. Likewise, rebaseline’s claim that retrieval “removes the need” to delegate is causal overreach—fresh sweet still delegated in six task-cells.  
    **Falsifier:** matched pre-delegation trajectories showing forms already equal before the spawn decision.

## Cost Levers

13. **[H] Replace the 1.3k resident guide with one typed `ss` operation and a compact schema.** Keep behavioral policy in short result-local contracts rather than six command tutorials. **Expected:** 2–4%/rollout.  
    **Falsifier:** schema+system prefix is not at least 900 tokens smaller, or a cheap DEV smoke increases malformed/misrouted calls.

14. **[H] Price payloads by lifetime, not per-call capacity.** Use small early packs; expand only after ambiguity, failed edits, or explicit continuation. **Expected:** 2–6%.  
    **Falsifier:** replay shows early payload tokens have no more future resends than late payloads, or later calls repurchase all removed context.

15. **[H] On `sufficient=YES`, return top-1 plus a lower-rank manifest, not lower-rank bodies.** Materialize a lower rank only on request. **Expected:** 1–4%.  
    **Falsifier:** existing traces show lower-rank bodies are subsequently used in more than ~20% of sufficient-YES calls.

16. **[H] Make gutter policy surface- and harness-specific.** Raw bodies for Codex/OpenCode; TAB only where Claude exact-string editing consumes the snippet. **Expected:** 0.5–2%.  
    **Falsifier:** current trace replay shows numbered non-Claude surfaces prevent enough extra reads to repay their lifetime token cost.

17. **[H] Remove mandatory visible `<state_summary>` output and trim agent-facing metadata to action-changing fields.** Output tokens are especially expensive; headers need file, range, symbol, sufficiency, and continuation—not routing diagnostics. **Expected:** 0.2–1.5%.  
    **Falsifier:** trace census finds these fields/summaries negligible or repeatedly used to choose successful actions.

## Resolution Levers

18. **[H] Add a patch preflight/canonicalizer:** sort hunks by current file position, detect ambiguous context, and request a wider exact anchor before applying. **Expected:** remove 30–60% of hunk-order/ambiguity failures; +0–2 solves/66.  
    **Falsifier:** `$0` replay of failed patches salvages fewer than 20%.

19. **[H] Add a deterministic issue→diff obligation checker.** Extract identity fields/public behaviors from the issue and verify that the patch touches or preserves each one—e.g. `(name, fileType)`. This is not another prompt completeness card. **Expected:** +1–2/66.  
    **Falsifier:** it cannot distinguish known incomplete patches from gold without excessive false alarms.

20. **[H] Index installed dependency source and expose contract definitions explicitly.** This targets cases where localization succeeds but the required external call contract is absent. **Expected:** +1–3/66 on dependency-bound pools.  
    **Falsifier:** source-availability census shows failing tasks already received the decisive dependency contract.

21. **[H] Generate executable public-surface witnesses from issue wording.** Probe enumerability, deferred order, serialization, or temporal behavior before accepting a patch. **Expected:** +1–3/66.  
    **Falsifier:** witnesses do not discriminate known failing patches from accepted behavior on public fixtures.

22. **[H] Detect absent requested artifacts and emit an implementation graph—files, exports, registrations, and tests—before editing.** This targets “required code does not yet exist,” not sibling widening. **Expected:** up to one additional task-majority per pool.  
    **Falsifier:** static replay on absent-artifact tasks fails to recover the gold patch’s required artifact set.

