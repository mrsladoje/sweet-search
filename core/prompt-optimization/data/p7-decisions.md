# Phase 7 — Manual Reflection Decision Log

**Run ID**: p7-v1
**Status**: not started (scaffold)
**Protocol**: docs/PHASE7.md §3.4 (AI-assisted manual reflection) + §6.2 (decision log)

This file is the **load-bearing artifact for human-in-the-loop GEPA defensibility**
(§6.2). It is **append-only during the run** and committed at `release/p7-v1`.

Rules (§3.4):

- Hand-edits MUST be motivated by **dev-set failures only**, never held-out/vault probes.
- Gemini Deep Think's output is **advisory**, not authoritative — the user retains the final call.
- Every decision (including `no-edit`) is logged so the write-up can show provenance.

One entry per GEPA round, in the format below.

---

<!--
## Round N
### Gemini Deep Think summary (auto)
<Gemini's reflection output, verbatim>

### Failures observed (top 3)
- <failure cluster 1 + dev probe IDs>
- <failure cluster 2 + dev probe IDs>
- <failure cluster 3 + dev probe IDs>

### Per-target failure split (§3.1 step 8)
- Sonnet-only: <...>
- GPT-5.5-only: <...>
- Joint (both ≤ 0.4): <...>

### User decision
- **Action**: no-edit | hand-craft | inject-hint
- **Rationale**: <1-2 sentences: accept/modify/reject of Gemini's recommendation>
- **Edit content (if any)**: <verbatim>
-->
