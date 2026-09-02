# c05 — adversarial verify, HISTORY lens

**Verdict: REFUTED as a lever.** The mechanism is a call-site-surfacing lever built on one task.
The register holds an explicit recorded instruction against exactly that: `B9b`'s source says
"**DO NOT build the call-site-surfacing lever on this evidence (n=1 task for it)**", and its
revival condition — "a cohort of sweet-CONSISTENT (0/2) failures" — is not met by this candidate.
`accenture` is not sweet-consistent: 4 of the 6 addressable losing cells are **native** cells the
sweet-only hook can never reach `[M]`. The measured sweet-only ceiling is **2 rollouts of 198**
(1.0%), one third of the pre-registered ±6-rollout bar, and even at a 100% flip sweet still trails
native on both affected harnesses (codex 40 against 41; claude-code 41 against 43) `[M]`. Two parts
of the candidate survive, and neither is a lever: the code-graph coverage defect (part B, self-declared
0 solves and 0 cost) and the `accenture` verification-blindness measurement item.

---

## 1. What I checked

| item | path or command |
|---|---|
| register (canonical, 404 lines) | `slate-c/register/DEAD-LEVER-REGISTER.md` — rows A6, A10, A13, B9, B9b, B11, B12, B19, D1a, D1b, D3, D4b, E4, E7, E14, E16, F2, F3, F5, F9, P1, P2, P4, G5, H1 |
| candidate source | `slate-c/candidates/resolution-computed-facts.md` §§0–9 |
| upstream seed | `slate-c/forensics/wrongfix-facts.md` §2.7, §3, §4, §5 |
| vehicle claim source | `slate-c/research/harness-changelogs.md` §5.3 (L-3), §§206–297, §327–337 |
| B9b killing fact (original) | `eval/task-completion-bench/TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §24.2–24.3 |
| B19 / P4 killing facts (original) | `eval/task-completion-bench/handoffs/improve/PANEL-SYNTHESIS.md` §(b), §(c) |
| A13 backfire (original) | `eval/task-completion-bench/PLAN.md` line 630 (L3 row) |
| hint-ladder controls | `eval/task-completion-bench/handoffs/improve/HINT-LADDER-RESULTS.md` §§385–400 |
| census the candidate ran | `slate-c/candidates/scripts-resolution-computed-facts/data/census-summary.txt` |
| solve counts (box, read-only) | `ssh root@167.233.69.121`, `node -e` over `results/fp-codex-tab-20260826/rows.json`, `fp-claudecode-tab-20260826/rows.json`, `fp-opencode-tab-20260826/rows.json`, `rp-oc-tab-20260827/rows.json` |
| pinned-harness hook contract | `eval/task-completion-bench/harness/turnfix-overnight-orchestrator.mjs:352` |

Scratch on the box: `/tmp/wf-slatec/c05-history/` (created, empty; all reads were direct). Nothing
written under `results/`. HO2 untouched. No grading log opened. No hidden test name or gold content read.

## 2. The recorded killing fact that applies

`B9b` — "usage / call-site starvation as a general finding" — is the same mechanism under an earlier
name. Its source reads `[M]`:

> "**DO NOT build the call-site-surfacing lever on this evidence (n=1 task for it).** … To find
> systematic sweet-side mechanisms, need a cohort of sweet-CONSISTENT (0/2) failures; this run
> produced only one. User's #1 check prevented over-building on a single-task artifact."
> (`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §24.3)

The candidate does not escape this. It replaces one single task with a different single task.
Worse, the new task fails the "sweet-consistent" half outright. I read the box `[M]`:

| run | arm | rep | resolved | f2pFrac | class |
|---|---|---|---|---|---|
| `fp-codex-tab-20260826` | sweet | 0 | false | 1 | blanket guard (addressable) |
| `fp-codex-tab-20260826` | sweet | 1 | false | 0 | wrong site (register D3) |
| `fp-codex-tab-20260826` | native | 0,1,2 | false | 1 | blanket guard ×3 (**unreachable**) |
| `fp-opencode-tab-20260826` | native | 1 | false | 1 | blanket guard (**unreachable**) |
| `rp-oc-tab-20260827` | sweet | 0,1 | false | 0 | wrong site ×2 (register D3) |
| `fp-claudecode-tab-20260826` | sweet | 1 | false | 1 | blanket guard (addressable) |

Six blanket-guard losers, **four of them native**. A sweet-only hook reaches two.

`B19` (caller-set inline, DEAD) does not refute on its own: its killing fact was zero exposure, and
this face has exposure 2. The mechanical difference the candidate claims — a bound expression plus a
computed emptiness flag, not a caller line — is real. But `B19`'s revival condition ("a cohort with
more signature-change tasks") is unmet, and the panel's record adds a fact the candidate's argument
needs and does not have: in `B19`'s exposure check "one cell **ran the exact caller trace and still
failed**. The information was never absent." (`PANEL-SYNTHESIS.md` §(b)). Nothing measured shows that
adding the binding and the emptiness flag changes the choice; the candidate itself tags the flip rate
`[I]`, borrowed by analogy from other fact classes (§8 of its own report).

`P4` (look-before-API) is a third rejection of the neighbouring idea: "the effect **inverts** to 0/12
against 6/24 once the single supporting task is removed", and its caller-only rescue "returns
`fan-in=0`" (`PANEL-SYNTHESIS.md` §(c); register row P4, DEAD).

## 3. Does the candidate revive F9? No — it repeats F3

`F9` is OPEN for exactly one thing: "**find a family of computable facts that generalizes**". The
candidate's own census, which I re-read line by line, shows the opposite `[M
census-summary.txt`]:

- The flagged face fires on **15 of 390 cells**, and the per-task table shows all 15 on
  `accenture__sfmc-devtools-1974` (18 cells, `possiblyEmpty=15`). Every one of the other 21 tasks
  shows `possiblyEmpty=0`.
- That is one task in 22, zero in 21. It is the `F3` disposition again — a checker whose strict shape
  fires on one file in 152,270, PARKED on generality with the register's own instruction: "do **not**
  promise generality".

The candidate is therefore a second data point *for* `F9`'s generalization failure, not a revival of
`F9`. The `L-3` vehicle seed says the same thing about itself: "This lever supplies the missing
*vehicle*, not the missing *computation*" and sets the bar as "a family of computable facts that
fires on more than one file in 152,270" (`harness-changelogs.md` §5.3).

The unflagged `≥2 callers` form does generalize — it fires on 48.6–56.1% of solved cells `[M]` — and
the candidate correctly refuses it, because that is the `B19`/`B11` default-trailer shape.

## 4. Ceiling arithmetic, corrected

Fresh-pool solves, re-counted from `rows.json` `[M]`:

```
fp-codex-tab-20260826      sweet 39/66   native 41/66
fp-claudecode-tab-20260826 sweet 40/66   native 43/66
```

At a 100% flip of both addressable sweet cells: codex 40 against 41, claude-code 41 against 43.
**The lever does not reach parity on either harness.** The differential is +2 of 198 sweet rollouts
= **1.0%**, one third of the ±6-rollout (3.03%) pre-registered bar. The register calls this tier
undecidable in `D1a` ("0.64% of one arm, 4 events, a tier the doctrine calls undecidable").

The seed-to-prototype shrinkage is also worth stating plainly. `wrongfix-facts.md` §5 claimed 34
losing cells across three tasks (b2 12, accenture 6, moq 16). The built prototype reaches
**6 cells on one task**, and 2 of those are sweet: an 82% loss of the claimed exposure, because the
`b2` face needs Jam indirect-rule resolution and the `moq` face needs a runtime trace (§3.6, §2).

## 5. Two problems the candidate's own report creates

**(a) The exposure task is one the same report asks to invalidate.** Candidate E of the same file
records that `accenture` ran with `run_tests` returning `INFRA` in **every cell of every harness**,
and concludes: "Any per-task resolution reading on `accenture` measures design luck, not
verification… should be flagged by preflight… or admitted with a 'no-verification' label." If that
measurement item is adopted, candidate A's exposure falls to **0 cells** — precisely `B19`'s number.
The two candidates cannot both stand.

**(b) The certificate fires on twice as many already-solved sweet cells as addressable ones.**
Of 9 `accenture` sweet cells, 3 edited `fixKeys` (the wrong-site class) and 6 edited the shared
method. Of those 6: **4 solved, 2 lost** `[M rows.json` + `census-summary.txt`]. So in the sweet arm
the flagged fact is delivered into four cells that were already winning for every two it might help.
The pre-registered kill condition covers "≥1 solved cell **contradicted**"; it does not cover a
solved cell **disturbed**, which is the `B12` and `P2` failure mode (`B12` live cost
+4.78/+19.79/+11.72%; `P2` regressed one task 1/2 → 0/2 twice independently).

## 6. Vehicle risk — the hook is asserted, never installed

The candidate's vehicle evidence is `[C]` string and type reads (codex `PostToolUse` 33 hits;
claude-code `additionalContext` 45 hits; the opencode plugin type signature), plus `[W]` docs. No
hook has ever been installed and observed to fire in this program's sweet arm. The recorded base
rate is poor:

- `D4b` — the **only measured hook deployment** in the program was **provably inert**, with complete
  separation across 32 sessions: it ran on 189 calls needing nothing and did not run on the 110 that
  all needed it, because Claude Code validates arguments before the hook stage.
- `A10` — the `D2` shim deployment had **two independent blockers, both invisible to preflight**.
- `harness/turnfix-overnight-orchestrator.mjs:352` records, in a frozen pre-outcome contract,
  `t2: { verdict: 'NO-GO', reason: 'pinned OpenCode 1.18.4 has no per-request hook' }`. That is a
  *per-request* hook, not `tool.execute.after`, so it is a tension rather than a contradiction — but
  it is the one recorded statement about hooks on the pinned opencode binary and it is negative.

A `$0` install-and-fire check on all three pinned binaries is a prerequisite, not an optional extra.

## 7. Where the candidate genuinely escapes the record

I state these so the synthesis does not over-kill.

- **Delivery on the agent's own edit is new.** No register row records it. `B11` (turn-0 dossier) and
  `E4`/`B19` (search-time trailers) are different triggers, and `E16` supports the change of trigger:
  "the tool had the answer and the model never called it". The `ss-trace` demand count, 0.2–0.6 calls
  per rollout `[M]`, is the same finding measured again.
- **`A6` does not cleanly refute.** `A6` killed mid-task *instructions* on Grok-4.5 and its own
  revival condition is "backbone change", which has happened (luna). A descriptive fact is a different
  object. The nearest measured analogue is not `A6` but `A13`: advertising a hint inside a shared tool
  result made the agent spend **20 of 84 calls** re-requesting a transcript it already had, and the
  hint was removed. That is the honest precedent for mid-task tool-result injection, and it is negative.
- **Part B (graph coverage) is a real, unrecorded defect.** `E7` records a cross-file trace gap and
  refutes a Python sub-claim; neither JavaScript `#private` methods (34 definitions, 0 graph entities
  in `accenture`) nor Elixir (2,651 entities, 0 call edges in `absinthe`) appears anywhere. Book it as
  an `E7` extension, `new_tool: false`, correctness only. Its ceiling is the candidate's own words:
  **0 solves, 0 cost.** It must never be counted toward the lever's ceiling.

## 8. The pattern this program has recorded five times

Every lever in this program whose evidence was one task has gone flat or inverted when screened wider:

| lever | small-n signal | what the wider screen said |
|---|---|---|
| P1 general clauses | 5-task pilot 15/20 against 11/20 | 153 rollouts: **every** condition 3 of 8 tasks; originating task reverses |
| P2 exemplar-stop clause | −13% on 6 tuning tasks | neutral on 6 fresh tasks; regressed one solve twice |
| C3 per-harness delimiter | n=18 suggested per-harness forms | n=66: all forms within 3 rollouts, p ≥ 0.72 |
| B12 span expansion | replay −1.6/−2.1/−4.7% | live **+4.78/+19.79/+11.72%** |
| B9 completeness card | one flagship starvation case | disqualified twice; strict count 0 against a bar of 2 |

`c05`'s evidence is one task. The prior says it goes flat.

## 9. What I could not finish

- I did not verify the `[C]` graph-extractor claims in code (JS `#private` entity emission, Elixir
  call-edge extraction). I accepted them as plausible and unrecorded; they do not change the verdict
  because part B's ceiling is zero by its own statement.
- I did not install or fire any harness hook. That check is `$0` and remains open.
- I did not run the candidate's own falsifier item (a) — the face over all 22 golden bases for every
  function with ≥2 callers. It is listed by the candidate as "to do", so its pre-registered kill
  condition (">5 flagged functions per repo on >4 of 22 goldens") has **never been evaluated**.
- I did not open `accenture` grading logs, and did not read HO2.
