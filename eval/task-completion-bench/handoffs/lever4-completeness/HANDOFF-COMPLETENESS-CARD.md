# Handoff — microsmoke lever #4: bounded repair-completeness card (the LAST GPT lever)

You are a fresh session closing out the GPT-Sol portfolio. This is lever #4, the only remaining
candidate. Follow the `/microsmoke` skill exactly. Do NOT skip the $0 gate. Do NOT touch HO2. Use
Luna via the codex subscription on the box (flat-rate → no real money).

**Read this first — the honest prior.** Five of six GPT levers are resolved: #1 shipped, #2/#3 no-go,
#5 dead, thrash dead. The cost frontier is CLOSED on this backbone. #4 is the one lever that targets
RESOLUTION through a retrieval-differentiable mechanism, but its ceiling is small and the taxonomy
says most losses are unreachable. **The likely outcome is that the $0 hunt finds too few qualifying
cases and #4 dies for $0.** That is a valid, valuable result — it formally exhausts the portfolio. Do
NOT force a marginal example through to justify a build. The bar below is strict on purpose.

This is a TWO-PHASE handoff. Phase 0 is a fast $0 analysis (likely an hour, not overnight). Only if
Phase 0 clears its bar do you proceed to the overnight build + live smoke. If Phase 0 fails, file the
lever dead and stop — do not pad it into a run.

---

## 1. Context — what #4 is and the ONE slice it targets

sweet-search gives a coding agent CLI retrieval tools (`ss-search`, `ss-read`, …). Bench:
SWE-rebench repair tasks — edit repo SOURCE so hidden FAIL_TO_PASS tests pass, PASS_TO_PASS stay
green. Two arms: **native** (rg/grep + sed) and **sweet** (ss-* + a general M± block via the memory
file).

The loss taxonomy (`stats/loss-taxonomy.mjs`) classifies every failed rollout by `f2pFrac`:
- **wrong-fix** (`f2pFrac==0`, touched gold files): ~64-67% both arms. UNIVERSAL, retrieval-
  INDEPENDENT (the missing assertion is not in the repo). Unreachable by #4. Do not target it.
- **wrong-location** (`f2pFrac==0`, touched NO gold file): ~13%. A retrieval miss, but #4 does not
  target it (that is a find problem, not a completeness problem).
- **incompleteness** (`0 < f2pFrac < 1`): ~13-18%. **This is #4's ONLY target.** The agent edited the
  right symbol and made SOME target tests pass, but missed a sibling site, so the rest fail.

#4 = after the agent picks the symbol to edit, surface a small (200-400 token) "completeness card":
the symbol's declaration, its type, the fields that identify it, and its other use-sites — then evict
it after the edit. It exists to convert `0<f2pFrac<1` into `f2pFrac==1` by showing the agent the
sibling site it missed.

**The flagship case (teleport, the ONLY confirmed example so far):** the fix must match files by
`name` AND `fileType`; sweet matched by `name` only. The disambiguator is `GeneratedFile.fileType`
(`teleport-types/src/generators.ts:133`). Native saw it by reading the whole file; sweet's lean
retrieval never surfaced it. A type-aware card would. But it is 1 task out of 18. GPT's own verdict:
"research-GO, product-build NO-GO" until a SECOND independent example appears.

## 2. Phase 0 — the $0 hunt (this is the whole decision)

**Goal: find whether ≥2 INDEPENDENT incompleteness cases are RETRIEVAL-STARVED (a card would fix
them), across dev / held-out-1 only.** No model calls.

### Gate 0a ($0) — enumerate incompleteness cases
Run `stats/loss-taxonomy.mjs` over every available dev/held-out-1 rollout (rotate18 + any DEV-RET
rows you have). Collect every rollout classed `incompleteness` (`0<f2pFrac<1`). That is your
candidate pool. Record `f2pFrac`, gold files, touched files, per case.

### Gate 0b ($0) — the discriminator (the crux)
For each incompleteness case, decide ONE of two labels by reading the trajectory + the gold diff:
- **RETRIEVAL-STARVED** (a card would help): the disambiguating fact (a sibling call-site, a type
  field, a second file needing the same edit) was NOT in the agent's context, but WAS reachable in
  the repo — a bounded type/usage/call-site card for the edited symbol would have surfaced it.
- **GENERATION-VARIANCE** (a card would NOT help): the fact WAS already in the agent's context (it
  read the file / the card content was visible) and it missed the sibling anyway. #4 cannot fix this.

This label is the entire gate. Only RETRIEVAL-STARVED cases count. Be adversarial: the default
assumption is generation-variance unless you can point to the specific fact that was absent from
context but present in the repo and name the card field that would carry it. underscore and gradethis
were already adjudicated as generation-variance in the overnight loop — do not re-count them as
starved without new evidence.

### Pre-registered bar (write it in the run ledger BEFORE labelling)
Proceed to Phase 1 ONLY if **≥2 independent RETRIEVAL-STARVED cases** exist (teleport + at least one
more, on different repos/symbols). One example (teleport alone) = overfit = **DEAD, portfolio
closed.** Also record, per starved case, the exact card field that would carry the missing fact —
Phase 1 must reproduce it.

## 3. Phase 1 — conditional build + overnight smoke (only if Gate 0 clears)

### Gate 0c ($0 render) — prove the card surfaces the fact AND is format-gated
Design the card as an INTERNAL enrichment of the AGENT-FORMAT retrieval response for the edited
symbol (type decl + identifying fields + use-sites, ≤400 tokens, evicted after the edit). Two $0
asserts before any spend:
1. Render the card for EACH starved case and confirm it contains the disambiguating field you named
   in Gate 0b (e.g. teleport's `fileType`).
2. **CLAUDE.md format-gating rule (twice-burned — symbol-boost cost 0.07pp, anomalous-chunk cost
   −27.57pp on GCSN):** the card MUST be gated on `opts._isAgentFormat` / `format==='agent*'`.
   Render an NL/benchmark-format query and assert the card is ABSENT. This is non-negotiable — a
   card that leaks into NL traffic is a GCSN regression waiting to happen. Keep the ss-* product
   shape unchanged (no new user-facing tool mode); this is an internal enrichment only.

### Gate 0d ($0) — NL-search safety replay
Before any live task run, run the card path against a GCSN dev subset (aggregate MRR only, never
per-query held-out) and confirm MRR does not move — the format-gate should make this a no-op by
construction, but measure it. Any MRR drop = the gate leaks = STOP and fix the gate.

### Gate 1 — diagnostics + controls (DEV-RET only)
- Diagnostics (must FLIP fail→pass, or at least raise f2pFrac): teleport + the 2nd starved case.
- Controls (must NOT regress): clean 2/2 solves — redboltz, scoringutils, statamic, oceanparcels.
- NL control: the GCSN dev MRR from Gate 0d must stay flat.

### Gate 2 — live smoke (Luna via codex subscription)
The card is a SWEET affordance → run the sweet arm; keep native as the unchanged control. REPS≥2,
CONCURRENCY=1, matched cap 60. Gate behind a NEW env flag (e.g. `SS_COMPLETENESS_CARD=1`) so the $0
render proves it fires (anti-A/A). Read **solve FLIPS first** (this is a resolution lever — you WANT
teleport + the 2nd case to flip, controls intact), then cost (a small cost rise is acceptable for a
resolution lever; report it on the break-priced column). idealCost / break-priced, never realized.

### Gate 3-5 — read (flips + zero control/NL regression), rotate on 2-3 FRESH DEV-RET tasks, promote.
Neutral-on-rotation is NOT dead — re-smoke with more reps before discarding. A flip that only
reproduces on its tuning task (teleport) is overfit, not a win.

## 4. Box run recipe (verified 2026-08-07)
Runner `/root/smoke.sh` on the box (root@167.233.69.121). Memory `project_codex_subscription_run_gotchas`.
- `MODEL=openai/gpt-5.6-luna` (FULL string — pricing key; bare id aborts at the pricing guard, $0).
- `REASONING=medium`; `EGRESS_ALLOW=chatgpt.com,openai.com`; `DOCKER_HOST=unix:///var/run/docker.sock`;
  `CODEX_SUBSCRIPTION=1`; `HARNESS=codex`; codex CLI ≥0.146.
- Ledger: the card is an ss-* engine/agent-format enrichment, NOT one of the 4 hashed rt-shim files,
  so `ledger-postfix-20260807` stays valid. Point `ENV_LEDGER` at it; preflight `PREFLIGHT_ONLY=1`
  first ($0). If you somehow touch an rt-shim file, re-sweep with `env-ledger-sweep.mjs`.
- One pilot at a time (uid-501 dubious-ownership bug). Per-task image GC (no pre-pull). Disk guard:
  abort if `df / avail` < ~12G.
```
RUN_ID=card-preflight INSTANCES=teleport-<id>,redboltz__mqtt_cpp-466 \
  ENV_LEDGER=/root/.ss-eval/ledger-postfix-20260807/ledger.jsonl PREFLIGHT_ONLY=1 /root/smoke.sh
RUN_ID=card-smoke-v1 INSTANCES=teleport-<id>,<2nd-case>,<control> ARMS=sweet,native REPS=2 \
  CONCURRENCY=1 MAX_TOOL_CALLS=60 ENV_LEDGER=<ledger> SS_COMPLETENESS_CARD=1 /root/smoke.sh
```

## 5. Do NOT redo / out of scope
- #1 shipped; #2/#3/#5/thrash dead. Do not reopen. See `OVERNIGHT-LOOP-2026-08-07.md`,
  `handoffs/lever2-checkpoint/`, `handoffs/lever3-eviction/`, `handoffs/lever-thrash/`.
- Do NOT target wrong-fix (retrieval-independent floor) or wrong-location with #4.
- Do NOT count underscore/gradethis as starved (already adjudicated generation-variance).
- Do NOT build the card without the format-gate + NL-safety asserts (Gate 0c/0d). CLAUDE.md rule.
- Do NOT add a new user-facing ss-* tool mode (keep product shape); internal enrichment only.
- #6 two-candidate generation is NOT in scope (raises cost, needs explicit user approval, fights the
  wrong-fix floor). Do not run it.
- Never touch HO2.

## 6. References
- `stats/loss-taxonomy.mjs` — incompleteness classifier (`0<f2pFrac<1`, line ~138); your Gate 0a tool.
- `OVERNIGHT-LOOP-2026-08-07.md` §"Lever #4" — the teleport ground truth + the build-NO-GO reasoning.
- `handoffs/luna-rotate18/GPT-SOL-REPLY.md` §4 — GPT's #4 write-up (card shape, evict-after, format-gate).
- `.claude/skills/microsmoke/SKILL.md` — the gate protocol.
- Memory: `project_resolution_floor_universal_wrongfix` (why the ceiling is small),
  `project_eviction_nogo_cachebreak_gate` (break-priced column), `feedback_format_gate_boosts` +
  CLAUDE.md format-gating rule (the twice-burned GCSN regression), `project_codex_subscription_run_gotchas`.

## 7. Deliverable
A go/no-go on #4 with: the incompleteness pool (Gate 0a), the starved-vs-variance label per case with
the named missing field (Gate 0b), and the count of independent RETRIEVAL-STARVED cases against the
≥2 bar. If <2 → file #4 DEAD, the GPT portfolio is formally exhausted, stop. If ≥2 → the format-gate
+ NL-safety render proofs, then the live-smoke solve flips (teleport + 2nd case, controls + GCSN MRR
intact) on the break-priced column. Record every step in a RUN-LEDGER in this folder.
