# Preamble trim — $0 exposure gate (the redirect out of the eviction gate)

Follow-on from `GATE0-RESULTS.md`. That gate killed eviction and found the real re-send driver:
the **preamble**, at 18.0% of ideal spend, of which the sweet arm carries **+1457 tokens** more
than native on every request (= **4.1% of the sweet arm's ideal spend**).

Authorised scope (user, 2026-08-10): split the 1457 tokens and gate the halves separately.
- **Tool docs** (lower risk) — gated here. Wording and redundancy only. Product shape untouched.
- **Guidance block** (`## Fix discipline`, the general M±) — **NOT trimmed.** It is delivered via
  the memory file, deliberately general, and tuned; trimming risks both its generality and the
  fix-discipline effect it exists for. The gate asserts it is byte-identical to the parent.

Spend: **$0.00**. No live cell run — see the verdict.

---

## Composition of the 1457 tokens

| half | bytes | ≈tokens | share | status |
|---|---|---|---|---|
| ss-\* tool docs | 5272 | 1188 | 87% | gated here |
| `## Fix discipline` (general M±) | 778 | 175 | 13% | **untouched, byte-identical** |
| total | 6050 | 1363 | 100% | measured 1457 in the live preamble diff |

## Gate result — **PASS on safety, but the prize is not there**

`tests/tooldoc-trim-gate.mjs` (standalone, $0). It renders the trimmed docs through the REAL
harness path (`FRAME_OPEN + M± + FRAME_CLOSE`, exactly what `codex-task-runner.mjs` appends to
`<rundir>/AGENTS.md`) and asserts:

1. renders inside the frame, with `FRAME_CLOSE` still after M± — completion authority preserved ✓
2. **all 6 tools keep a usable signature AND a concrete example** ✓ (examples were added: the
   parent doc had signatures with placeholders but almost no concrete usage)
3. **product shape untouched** — no `ss-*` tool removed, `ss-trace` keeps all three modes, and
   `-k N` / `--regex` / `--in` all retained ✓
4. **30-rule behavioural inventory, all 30 survive** ✓ — every instruction the parent issues must
   still be expressed, wording free to change. A dropped rule is a product change, not a trim.
5. `## Fix discipline` byte-identical ✓

The gate also caught a defect in itself on first run: one inventory entry had been written against
the trimmed wording rather than the parent's, and it failed loudly rather than passing vacuously.

## The number — why no live cell is authorised

| | tokens | % of sweet arm ideal spend |
|---|---|---|
| redundancy actually removed | 74 | 0.21% |
| concrete examples added back (required by the gate) | −50 | −0.14% |
| **net saving** | **23** | **0.07%** |
| ceiling, if the examples were skipped entirely | 74 | 0.21% |
| **noise floor of the bench** (aggregate cost, n≈19) | — | **±37%** |

**Both figures are about two orders of magnitude below the detection floor.** No live smoke can
measure a 0.07% (or even 0.21%) cost change on this bench. Running one would buy noise.

**VERDICT: do not authorise the live cell. The tool-doc trim is dropped as a cost lever.**

## Why the 4.1% is not reachable this way

The tool docs are **dense, not padded**. The 30-rule inventory is the proof: 1188 tokens carrying
30 distinct behavioural rules is roughly 40 tokens per rule, which is close to the floor for
stating a rule at all. Wording cuts recovered 74 tokens — 6% of the block — and that was the
generous end, taking every genuine verbatim repetition (the raw-shell rule stated 3×, the tool
list described twice, "stop when answered" stated twice).

Realising a material share of the 4.1% would mean **deleting rules**, not rewording them — roughly
25 of the 30 would have to go. That is precisely the tool-use-degradation risk this gate was set up
to protect against, and it is a solve-safety question, not a cost question. It would need evidence
of a different kind: proof that specific rules do not change behaviour, which is a per-rule ablation
programme, not a trim.

## What is kept

`core/prompt-optimization/data/p7-turnfix-variants/sweet-search-system-prompt.trim1-tooldocs.md`
stays as a **variant, NOT promoted** — the production `MPP` default is unchanged.

It is worth keeping for a reason unrelated to cost: it adds a concrete example to all six tools,
which the parent lacked. That is a plausible tool-use *quality* improvement. It is **an untested
hypothesis** — it has never been run — and it would need its own solve-safety smoke to claim
anything. It is not claimed here.

## Standing conclusion for the cost story

Of the sweet arm's re-send tax, the addressable-by-editing part is small and the rest is structural:
the codex system prompt and the task statement dominate the preamble and neither is ours to cut.
The cost story does not have a preamble lever in it. Combined with `GATE0-RESULTS.md`, both
remaining context-side cost levers are now closed for $0.
