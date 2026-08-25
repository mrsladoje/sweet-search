# Read-gutter delimiter — cross-harness A/B: PRE-REGISTRATION

**Written before the claude-code and opencode arms ran.** The codex arm is already complete
and is quoted here as the motivation, not as a result to be confirmed.

## 0. What we already know

`116ca2b` (2026-08-13) changed the `ss-read` gutter from `N| ` to `N<TAB>`, on measured
**claude-code** evidence: `N| ` leaks one space into an exact-match `old_string`, giving
20 anchor failures against native's 0. **Codex was never re-measured.** On 2026-08-25 it was,
and the tab costs it three rollouts of eighteen:

| | TAB (shipped) | PIPE | NONE | native |
|---|---|---|---|---|
| codex, 6 tasks × 3 reps | **10/18** | **13/18** | **13/18** | 14/18 |
| controls | 6/6 | 6/6 | 6/6 | 6/6 |

Both alternatives recover all of it, controls never move, cost is flat. So the shipped
default is worse on codex, and the question is what to ship given claude-code wanted the
opposite.

## 1. Design

- **Tasks:** the same six — `underscore`, `pytask`, `gradethis`, `teleport`, plus `robot` and
  `scoringutils` as controls that are 3/3 in every arm measured so far.
- **Harnesses:** claude-code and opencode. **Sweet arm only** — native never calls `ss-read`,
  so no gutter setting can touch it.
- **Conditions:** `PIPE` (`SS_READ_GUTTER=pipe`) and `NONE` (`SS_READ_LINENUMS=0`).
- **TAB is not re-run.** `rb-opencode-20260824` and `rb-claudecode-20260824` sweet already
  cover these six tasks at three reps under the shipped default. Same tasks, same reps, same
  ledger.
- 2 harnesses × 2 conditions × 6 tasks × 3 reps = **72 rollouts**, `CONCURRENCY=1`,
  ledger `luna-rotate20-v4`. Estimated **≈ `$0.8`** — above the `$0.5` I first quoted, because
  claude-code rollouts are ~50% dearer than opencode's.

## 2. Two outcomes are measured, not one

**Resolution**, per condition, with controls reported separately.

**Edit-anchor failures**, per condition — the quantity the tab was adopted to fix. On
claude-code, `PIPE` is expected to *re-break* anchors; if it does not, the original
justification for `116ca2b` needs re-examining. This is the decisive number for claude-code,
and resolution alone must not be used to overturn it.

## 3. Pre-registered decision rule

| finding | action |
|---|---|
| a single setting is ≥ TAB on all three harnesses | ship it globally |
| harnesses genuinely disagree | ship **per-harness**, defaulting each to its own best |
| differences are within noise on claude-code and opencode | keep TAB there, change codex only |
| any control regresses in any arm | ship nothing; investigate the control first |

**No change ships on n=18 per cell alone.** Whatever wins here gets a confirmation run on the
full 13-task set for the harnesses it changes, before it becomes the default. The whole reason
this regression existed is that a delimiter was changed on one harness's evidence and
generalised without checking.

## 4. Gate 0

Before any cell is read, the arms must be shown to differ in the recorded traces: pipe-gutter
line counts > 0 and tab-gutter counts == 0 in `PIPE`, and both == 0 in `NONE`. The codex arm
passed this (2,208 pipe / 0 tab against 17,362 tab / 0 pipe); the same check runs here.
