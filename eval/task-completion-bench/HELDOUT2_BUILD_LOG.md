# Held-out 2 — build progress ledger

Resumable stage ledger for building and freezing the new 200-task held-out set.
Rules: `select/HELDOUT2_RULES.md` · Fairness snapshot: `select/FAIRNESS.md`.
Scope ends at a green ledger — **no rollout, no agent API spend, no golden indexing on
the box or the Mac** (indexing is the user's RunPod step).

| stage | state | notes |
|---|---|---|
| S1 · read + inventory | DONE 2026-07-30 | box verified idle (no run-pilot, no containers); Mac vault 239 keys / 71G; box goldens 199; exclusion sources snapshotted |
| S2 · rules + seed + FAIRNESS.md committed | PENDING | the pre-registration moment |
| S3 · draw + freeze + manifest hash in PLAN.md | PENDING | 200 primary + 67 reserve |
| S4 · extension-coverage audit | PENDING | fix gaps as indexing-config commits; never re-draw |
| S5 · RunPod handoff inputs | PENDING | ordered key list + specs; then PAUSE for the user |
| S6 · vault verify + stage on box (read-only) | PENDING | after the user returns indexed goldens |
| S7 · green ledger, gold-FULL 200/200 | PENDING | box compute, 4-wide sweep |
| S8 · final PLAN.md update, set marked DONE | PENDING | |

## Log

**S1 — 2026-07-30.** Read PLAN.md, the selection pipeline (`select_heldout.py`,
`select_tasks.py`, `task_gates.py`, `materialize_tasks.py`), the held-out-1
pre-registration and replacement precedent, `golden-build.mjs`, `golden-vault.sh`,
`pod-golden-fleet.sh`. Confirmed the pinned dataset revision
`475dd5e8703bb5fb22dd3c60b5d038b019eba1e0` is in the local HF cache and `.venv-grade`
carries `datasets` 4.8.5, so the draw runs offline on the Mac. Box checked idle. Built the
repo-level exclusion snapshot: 647 repos / 730 instance ids across 7 sources.
