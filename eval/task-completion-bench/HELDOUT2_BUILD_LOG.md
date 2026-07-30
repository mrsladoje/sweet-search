# Held-out 2 — build progress ledger

Resumable stage ledger for building and freezing the new 200-task held-out set.
Rules: `select/HELDOUT2_RULES.md` · Fairness snapshot: `select/FAIRNESS.md`.
Scope ends at a green ledger — **no rollout, no agent API spend, no golden indexing on
the box or the Mac** (indexing is the user's RunPod step).

| stage | state | notes |
|---|---|---|
| S1 · read + inventory | DONE 2026-07-30 | box verified idle (no run-pilot, no containers); Mac vault 239 keys / 71G; box goldens 199; exclusion sources snapshotted |
| S2 · rules + seed + FAIRNESS.md committed | DONE 2026-07-30 | `9be3169`, amended by `e4f2587` (amendment 1) |
| S3 · draw + freeze + manifest hash in PLAN.md | DONE 2026-07-30 | 200 + 67, seed 20260731, byte-identical on a second run |
| S4 · extension-coverage audit | DONE 2026-07-30 | 1,299 patch paths audited; 23 extensions added to the indexing config; remaining gaps all by-design |
| S5 · RunPod handoff inputs | IN PROGRESS | ordered key list + specs; then PAUSE for the user |
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

**S2/S3 — 2026-07-30.** Pre-registered, drew, hit a degenerate result, amended once, redrew.
The first draw (seed 20260730) was valid under its rules but put 56 python in the set: the
deficit rule inherited from held-out 1 measures "largest quota" against the running quota, so
every freed slot made the same language largest again and all 26 snowballed onto python.
Amendment 1 replaced it with proportional redistribution and split exclusions into two tiers
after establishing that no exclusion policy can rescue C++/C# (the population holds 12 C++ and
17 C# repos at quality A in total, and held-out 1 / dev-200 consumed most of them by repeating
repos). The discarded draw is committed at `select/discarded-draw-20260730/`. Final set: 200
tasks in 200 distinct repos, python 34 / ts 33 / js 29 / java 22 / go 20 / rust 20 / php 9 /
kotlin 7 / swift 5 / c 5 / csharp 3 / cpp 3 / tail 10.

**S4 — 2026-07-30.** Audited every file path in the 267 drawn tasks' gold and hidden-test
patches (1,299 paths) against sweet's live indexing config — `FILE_PATTERNS.include` for
discovery, `CODE_FILE_EXTENSIONS` for ss-grep — with the same `dot:true` matcher the indexer
uses. Script kept at `select/audit_extension_coverage.mjs`.

Gaps found and fixed in the indexing config (never by dropping a task, per rules §8):
`.razor` `.inl` `.jj` `.bnf` `.yy` `.y` `.scm` `.jq` `.pkl` `.gleam` `.hylo` `.snap`
`.stderr` `.conf` `.config` `.adoc` `.scd` `.vtt` `.test` `.txtar` `.bsh` `.inc` `.fixed`,
plus `go.mod` which was discovered but invisible to ss-grep. `.inl` also got a real
`EXTENSION_MAP` entry (it is C++); the rest are discovered + greppable without claiming a
chunker grammar.

Deliberately NOT added, recorded so it is a decision and not an oversight: `.md` `.rst`
`.txt` are discovered but excluded from the grep code path by design (doc formats go through
DocumentChunker); `Cargo.lock` / `go.sum` are generated lockfiles the config already excludes
on purpose; `.gitmodules`, `.all-contributorsrc` and a bare `repo/spec` are extensionless
metadata that cannot be globbed without noise. Full test suite green after the change
(1,863 + 1,902 assertions).
