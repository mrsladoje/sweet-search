# c03 — worktree-aware `ss-*` — adversarial verify, differential and measurability lens

Date 2026-09-02. Cost of this study: $0 (trace reading, `rows.json` arithmetic, static code
reading). Evidence box read-only; scratch under `/tmp/wf-slatec/c03-measurability/`.
Tags: `[M]` measured with a named command, `[C]` read from code, `[W]` web, `[I]` inferred.

## 0. Verdict — REFUTED as a cost lever; survives only as a correctness item

**Refuted.** The candidate is sweet-only and admissible in class, but it fails the
measurability lens three separate ways, and its production half carries a correctness
regression the candidate scores as low risk.

1. **The prize sits in rollouts the ledger prices as null.** All five rollouts that carry the
   entire measurable effect have `costRealizedUsd = null` and `sidechainAccountingComplete =
   false` `[M]`. They contribute $0.00 of the $0.86226 the claude-code sweet cell actually
   priced `[M]`. The "8.7% of cost" figure is an imputation at arm-average unit prices onto
   rows the ledger declined to price. Register G6 already says this.
2. **The ceiling is over-stated about 3×.** Only 74.9% of the 184,470 subagent fallback tokens
   sit in rollouts that ever made a worktree-scoped call `[M]`, and 58.8% of that remainder
   sits in the two `bfgroup__b2` tasks whose index-coverage gap shipped as register E1 after
   the run `[M]`. The non-confounded ceiling is **2.7%** of the claude-code sweet arm, over
   **2 rollouts of 66**.
3. **2.7% is far under the detection floor.** The measured paired sweet-minus-native cost
   difference has a standard error of $0.000927 per rollout at n=34 pairs `[M]`. A 2.7%
   saving is $0.00056 per rollout, i.e. 0.60 of one standard error. Register G10's own power
   analysis needs about 465 tasks for a 5% effect; a 2.7% effect needs about 1,594. The pool
   has 22. That is a **72× gap** `[I from G10]`.
4. **Falsifier (1) cannot fail**, so it carries no information; **falsifier (2) is 64%
   confounded** with the already-shipped E1 fix `[M]`.
5. **The production remedy trades a loud cheap failure for a silent expensive wrong answer.**
   `ss-read` resolves paths against `PROJECT_ROOT` `[C]`, so redirecting `PROJECT_ROOT`
   through the git common directory makes `ss-read` inside a worktree return the **main
   checkout's** copy of a file on a different branch. The offered mitigation is a header
   line, a class the register measured at zero behavioural effect four times.

What survives is a real, sweet-only production defect that belongs in register class E2,
whose own precedent prices this exact shape at "under 1% of cost and under one task, shipped
as correctness with no benchmark value claimed".

## 1. Differential lens — passes on vehicle, fails on reach

| question | answer | evidence |
|---|---|---|
| Is the vehicle sweet-only? | **Yes.** `eval/agent-read-workflows/bin/_ss-helpers.mjs` and `_ss-argparse.mjs` are shipped in the npm `files` list and touch no shared frame, shim, or harness setting. | `[C]` `package.json:72-81` |
| Does it change *which* lines or requests happen? | **Yes, admissible.** A scoped `ss-grep` that returns hits instead of zero removes the native fallback requests that followed. Not a re-render of the same lines. | `[M]` `analysis-extras.txt` §A, §C |
| How many harnesses does it reach on the bench? | **One.** Codex and opencode delegated zero times in the fresh pool, so no worktree ever existed there. The candidate's "codex/opencode ≤ 0.5%" should read **0.0% measured**. | `[M]` `claude-subagents.md` §0; `native-capability-gaps.md` §3.2 |
| Does mechanism half (1) have any bench differential? | **No, zero.** `agent-runner-shared.mjs:142` pins `SWEET_SEARCH_PROJECT_ROOT` to the run directory for the whole `claude` process, so the missing-index path never runs. The candidate concedes this. | `[C]` `harness/agent-runner-shared.mjs:142` |
| Rule violations (HO2, gold or task identity at runtime, format gate, owner scope)? | **None found.** No ranking signal, no new tool, no runtime use of gold or task identity, no HO2 access. | — |

So the bench differential is mechanism half (2) only, on claude-code only, in five rollouts.

## 2. The five rollouts are unpriced — the decisive measurability fact

Command `[M]`, run on the box against
`/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/rows.json`:

```
node -e 'rows.filter(r=>r.arm===A) → count costRealizedUsd==null vs sidechainTurns>0'
```

Result `[M]`:

| arm | rows | `costRealizedUsd` null | rows with `sidechainTurns > 0` | null AND delegated |
|---|---:|---:|---:|---:|
| sweet | 66 | 9 | 9 | **9** |
| native | 66 | 28 | 28 | **28** |

Null cost and delegation are perfectly correlated in both arms. `sidechainAccountingComplete`
is `false` on exactly those rows `[M]`. The five rollouts the candidate names —
`asynkron__protoactor-dotnet-1909/rep1`, `bfgroup__b2-113/rep1`, `bfgroup__b2-113/rep2`,
`bfgroup__b2-259/rep0`, `final-form__final-form-64/rep2` — are all inside the sweet nine, and
each returns `cost: null` in the forensics agent's own reconstructed event stream
(`/tmp/wf-slatec/native-capability-gaps/events-claude-code.jsonl.gz`) `[M]`.

Priced sweet-arm total: **$0.86226 over 57 rollouts**; the five target rollouts contribute
**$0.00000, that is 0.0%** `[M]`.

The consequence is not that the spend was free. It is that the "8.7% of cost" was produced by
multiplying 184,470 tokens and 91 sole-native requests by the arm's **average** unit prices
($0.301 per million ingested tokens, $0.000702 per request, `native-capability-gaps.md` §3.1).
That is an imputation onto rows the primary ledger refuses to report. Register G6 states the
same defect from the other side: summing nulls as zero read sweet at +123.2% where the
reconstruction reads −3.9%.

**Consequence for a future paid run:** the lever cannot be read on the headline cost column
until claude-code sidechain accounting completes on delegating rows. Any pre-registration for
c03 must first name the accounting fix as a precondition.

## 3. The ceiling is over-stated about 3×

### 3.1 Attribution discount — 25% of the mass is in subagents that never scoped a worktree

Per-rollout subagent native retrieval, from `analysis-extras.txt` §C `[M]`:

| rollout (claude-code sweet) | native retrieval ops | tokens | made a worktree-scoped call? |
|---|---:|---:|:--:|
| `asynkron__protoactor-dotnet-1909/rep1` | 11 | 20,627 | yes |
| `bfgroup__b2-113/rep1` | 10 | 17,744 | yes |
| `bfgroup__b2-113/rep2` | 21 | 25,777 | yes |
| `bfgroup__b2-259/rep0` | 27 | 37,742 | yes |
| `final-form__final-form-64/rep2` | 17 | 36,267 | yes |
| `bfgroup__b2-259/rep1` | 19 | 33,482 | **no** |
| `awslabs__aws-embedded-metrics-node-21/rep0` | 15 | 9,312 | **no** |
| `awslabs__aws-embedded-metrics-node-21/rep2` | 7 | 3,519 | **no** |
| `fastify__fastify-cors-285/rep0` | 0 | 0 | no |
| **total** | **127** | **184,470** | |

I re-derived the worktree column independently `[M]`, by scanning every sweet claude-code
tool call whose command names `ss-grep`, `ss-find` or `ss-trace` **and** contains
`.claude/worktrees/`:

```
python3 over /tmp/wf-slatec/native-capability-gaps/events-claude-code.jsonl.gz
→ total worktree-path calls: 71, confined to exactly 5 rollouts
  protoactor-1909 rep1: 6 calls (5 zero, 1 usage error)
  b2-113 rep1:         13 calls (12 zero, 1 usage error)
  b2-113 rep2:          8 calls ( 5 zero, 3 usage error)
  b2-259 rep0:         30 calls (12 zero, 6 usage error, 12 other)
  final-form-64 rep2:  14 calls (11 zero, 2 usage error, 1 other)
```

The 45 zero-returns reproduce the report's count exactly. **No sixth rollout exists.**

Worktree-attributable tokens = 20,627 + 17,744 + 25,777 + 37,742 + 36,267 = **138,157**, that
is **74.9%** of 184,470 `[M]`. Ceiling after this discount: 8.7% × 0.749 = **6.5%**.

### 3.2 Confound discount — 59% of what is left is the already-shipped index fix

Of the 138,157 worktree-attributable tokens, the two `bfgroup__b2` tasks carry
17,744 + 25,777 + 37,742 = **81,263 tokens, that is 58.8%** `[M]`. Of the 45 zero-returns,
those tasks carry **29, that is 64.4%** `[M]`.

Both `bfgroup__b2` tasks are the recorded index-coverage failures: their gold files lived in
`.jam` files and under `src/build/`, fixed by 36b802e and fb9f936 on 2026-08-28, register E1
`[C]`. The fresh-pool runs are dated 2026-08-26, before the fix, and the verified register
adds that every fresh-pool row carries a golden-cache index dated 2026-07-16, so E1 is
invisible in every run analysed to date `[M register E1]`. The brief's own rule applies:
never pool runs across a shipped fix.

Non-confounded ceiling: 8.7% × 0.749 × 0.412 = **2.7% of the claude-code sweet arm**, resting
on 56,894 tokens in **two rollouts of 66** (`protoactor-1909/rep1`, `final-form-64/rep2`).

### 3.3 Direction discount — the biggest single block is reads, which this does not touch

Subagent fallback splits as `[M analysis-extras.txt §A]`: `read.range` 87 ops / **115,610
tokens (62.7%)**, `grep.regex` 13 ops / 38,278, `glob` 18 ops / 17,398, `list` 9 ops / 13,184.

A worktree prefix rewrite on `ss-grep` and `ss-find` returns `file:line`, not file bodies. It
can displace the grep, glob and list block (68,860 tokens, 37.3%). It removes a read only if
the agent then reads less, which the register has recorded going the other way three times:

- B12 whole-file-on-first-touch: replay −1.6 / −2.1 / −4.7%, live **+4.78 / +19.79 / +11.72%**.
- E10 ephemeral coprocessor: $0 surface predicted +3 to +9.5%, live **+79%**.
- E1, the closest analogue in shape — make `ss-*` return content it previously failed to
  return — coincided with claude-code sweet **+30.6% dearer** in the fix-validation smoke
  (brief §1, small n) `[M]`.

The sign of c03's cost effect is therefore not established, only assumed.

## 4. Detectability — the honest ceiling is 0.6 of one standard error

Measured on `fp-claudecode-tab-20260826` `rows.json` `[M]`:

| statistic | value |
|---|---:|
| sweet rollouts with a price | 57 of 66 |
| mean priced rollout cost | $0.015127 |
| standard deviation | $0.011330 (coefficient of variation 74.9%) |
| min / median / max | $0.004174 / $0.010115 / $0.056588 |
| paired sweet−native pairs where both arms priced | 34 |
| paired difference, mean | $0.000815 |
| paired difference, standard deviation | $0.005407 |
| **standard error of the paired mean** | **$0.000927** |

The task brief's stated cost interval of ±$0.001 to $0.005 per rollout is consistent with this.

Now price the candidate against it:

| claimed effect | dollars per rollout | in units of the paired standard error |
|---|---:|---:|
| candidate "8.7% upper bound" | $0.00180 | 1.94 |
| candidate "~3% realistic" | $0.00062 | 0.67 |
| **honest ceiling from §3.2, 2.7%** | **$0.00056** | **0.60** |

Detecting a difference at 80% power and p<0.05 needs roughly 2.8 standard errors. Nothing in
that table reaches it, including the candidate's own optimistic bound. Register G10 gives the
same answer from an independent direction: a 5% cost effect needs about 465 tasks at 80%
power; effect size scales as the square root of N, so 2.7% needs about
465 × (5 / 2.7)² ≈ **1,594 tasks**, against a 22-task pool `[I]`.

**Solve is the veto and the candidate concedes 0 expected solves.** A lever with no solve
upside must win decisively on cost. This one cannot be seen at all.

## 5. The falsifier does not do the job

### 5.1 Falsifier (1) cannot fail

Proposed: `git worktree add /tmp/wt` in an indexed repository, run `ss-grep foo` from it,
observe exit 2. Kill condition: "`ss-grep` from a fresh worktree already returns results."

`[C]` `eval/agent-read-workflows/bin/_ss-helpers.mjs:136-147` — the block is at 136-147, not
138-146 as the candidate cites:

```js
const PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();   // line 138
if (!existsSync(path.join(PROJECT_ROOT, '.sweet-search', 'codebase.db'))) {    // line 140
  process.stderr.write(`[ss-*] no Sweet Search index at ...`);
  process.exit(2);                                                            // line 145
}
```

`_ss-env.sh` never sets the variable `[C]`. A `git worktree add` checkout contains no
`.sweet-search/codebase.db`. The kill condition is therefore refuted by static reading before
the command is typed. A test whose outcome is fixed in advance is a demonstration, not a
falsifier, and it produces no number the synthesis can pre-register.

### 5.2 Falsifier (2) is real but 64% confounded and cannot sign the effect

Proposed: replay the 45 worktree-scoped zero patterns with the prefix stripped; kill if fewer
than half return the later-found line.

- **29 of the 45 patterns (64.4%) are in the two `bfgroup__b2` tasks** `[M]`. Replaying them
  against rebuilt goldens measures E1, not the worktree fix. Replaying them against the
  2026-07-16 golden index measures a corpus state that no longer ships.
- Restricting to the clean 16 patterns (`protoactor-1909/rep1` 5, `final-form-64/rep2` 11)
  leaves a "more than 8 of 16" bar drawn from **two rollouts**. That is a naming-and-corpus
  lottery, not a population.
- Even a pass measures **retrieval recall**, not cost and not solves. Register B12's
  replay-versus-live inversion (replay −1.6/−2.1/−4.7%, live +4.78/+19.79/+11.72%) and the
  brief's own trap note — "a fixed-trajectory replay gets the direction right about as often
  as not and never the size" — apply directly.

**A falsifier that would do the job** is stated in §8 below.

## 6. Correctness objection — mechanism (1) makes a measured hazard the default

The candidate rates solve risk "low" and makes a header line the mitigation. Three facts
argue the opposite.

1. **`ss-read` follows `PROJECT_ROOT` too.** `[C]` `_ss-helpers.mjs` passes
   `projectRoot: PROJECT_ROOT` into read resolution. Redirect `PROJECT_ROOT` through
   `git rev-parse --git-common-dir` and `ss-read <relative path>` inside a worktree returns
   the **main checkout's** copy of that file, on a different branch. Today that call exits 2,
   loudly, for about zero tokens. After the fix it returns plausible wrong content that the
   agent will use as an `Edit` anchor. Register D-family measured what wrong anchors cost:
   claude sweet failed-edit turns were 13.4% of the arm, 20 of 32 string-not-found (W0-P7).
2. **The hazard is already measured in the pinned bench.** With `SWEET_SEARCH_PROJECT_ROOT`
   pinned to the parent, 6 of 22 `ss-*` results in two subagents echoed the parent's own
   uncommitted edit, and one subagent reported that edit back as "the likely intended
   behaviour" `[M claude-subagents.md §6.1]`. Zero solves changed, so this is an unpriced
   hazard, not a measured loss — but the candidate proposes to ship it as the default.
3. **The mitigation is of a class measured at zero effect.** Prose delivered to the model
   changed nothing four independent times: F8 general clauses DEAD over 153 rollouts (every
   condition 3 of 8), A6 mid-task advisories ignored 3 of 3, F9 placebo 0 of 4 and prose
   rules 0 of 3, hint-ladder localization-only 0 of 5. A header line naming the reflected
   tree is that class.

The candidate's own source document listed a safer alternative that the candidate JSON drops:
"or refuse with a hint naming the main checkout" (`claude-subagents.md` line 180). That form
keeps the loud failure, costs the same to build, and carries none of this risk.

## 7. Register check — the class is on the record even though the item is not

The candidate checks E2 at **item** level and concludes "new". At **class** level the
verified register already holds the result:

> **E2, SHIPPED** — "A separate census found 251 grep calls, 31 with a scope flag, 11
> directory scopes, of which 10 (91%) returned a false zero match; that lever's ceiling was
> **0.99% of cost and under one task**, so it **shipped as correctness with no benchmark
> value claimed**. The review panel explicitly rejected the zero-behavioural-risk framing."
> (`register/DEAD-LEVER-REGISTER.md` line 139)

c03 is the worktree instance of a false zero on a directory scope. Its honest ceiling (2.7%,
two rollouts) is the same order as E2's (0.99%, under one task), and the disposition the
register already recorded for that shape is "correctness, no benchmark value". The candidate
is therefore **not new as a cost lever**; it is new only as an unlisted E2 hygiene item.

One genuinely new and unlisted fact does emerge, and the candidate does not contain it:
`.claude/` sits on `AGENTIC_GITIGNORE_ALLOWLIST` `[C core/infrastructure/config/search.js:377-379]`,
so `.claude/worktrees/<agent>/` — a full second copy of the repository — is **admissible to
the index**. That is the other recorded worktree behaviour (`ss-grep` once returned a `.jam`
path from inside a worktree copy, `04-resolution-claude-code.md` §2). Duplicate-corpus
admission is an index-hygiene question in register class E15, and it points the opposite way
from c03: exclude the worktree path, do not redirect to it.

## 8. Corrections the synthesis must adopt

1. Replace the ceiling. **Not 8.7% claude-code with ~3% realistic. The non-confounded ceiling
   is 2.7% of the claude-code sweet arm, resting on two rollouts of 66.** Show the chain:
   184,470 tokens → ×0.749 attribution → ×0.412 after removing the E1-confounded
   `bfgroup__b2` mass.
2. Replace the codex and opencode figure. **Not "≤0.5%". Measured 0.0%** — neither harness
   delegated once in the fresh pool, so no worktree existed there.
3. State that the effect is unpriced. **All five target rollouts carry `costRealizedUsd =
   null` and `sidechainAccountingComplete = false`; they contribute $0.00 of the $0.86226 the
   claude-code sweet cell priced.** Any pre-registration must name completing claude-code
   sidechain accounting as a precondition.
4. State the detection gap in one number. **The honest 2.7% ceiling is $0.00056 per rollout
   against a measured paired standard error of $0.000927, that is 0.60 of one standard
   error.** Register G10 implies about 1,594 tasks are needed; the pool has 22.
5. Drop falsifier (1). Its kill condition is refuted by `_ss-helpers.mjs:136-147` before the
   command runs, so it yields no pre-registrable number. Keep it as a one-line code citation.
6. Rewrite falsifier (2). Restrict it to the **16 non-`bfgroup__b2` patterns**
   (`protoactor-1909/rep1` 5, `final-form-64/rep2` 11), state that it measures retrieval
   recall only, and add the explicit warning that it cannot sign the cost effect (B12
   inversion).
7. Correct the code citations. `_ss-helpers.mjs` **136-147** (PROJECT_ROOT at 138, `exit(2)`
   at 145), not 138-146. `agent-runner-shared.mjs` **142** is the pin line.
8. Raise the solve risk from "Low" to **"Unpriced regression risk"** and change the mechanism.
   Ship **refusal with a hint naming the main checkout**, not silent redirection through the
   git common directory — because `ss-read` also follows `PROJECT_ROOT` `[C]` and would
   silently return another branch's file as an `Edit` anchor. Delete "a header line is
   mandatory" as a mitigation; that class measured zero four times.
9. Delete the unsourced real-user figure. **"up to 54% of a claude-code cell wasted"** appears
   in no evidence I could open. The supportable statement is: sweet delegated in 9 of 66
   rollouts (13.6%) and native in 27 of 66 (40.9%) `[M]`, so a real user's exposure is
   bounded by that delegation rate, not by 54%.
10. Qualify the real-user reach. The wrappers ship in the npm `files` list but there is **no
    npm `bin` entry** for them (`bin` is `sweet-search` and `sweet-search-mcp` only) and I
    found no PATH installation in `scripts/init.js` `[C package.json:64-81]`. "Every `ss-*`
    call in a worktree fails" is therefore conditional on the user having put
    `eval/agent-read-workflows/bin` on PATH themselves; that population is unmeasured.
11. Re-file the candidate. Book it under **register E2 as a new hygiene item priced at 0%
    benchmark value**, alongside E2's own precedent (0.99%, under one task, correctness only).
    Book the `.claude/worktrees/` index-admissibility question separately under **E15**.

## 9. What I could not finish

- I did not reproduce the worktree exit-2 failure live. The claim rests on
  `_ss-helpers.mjs:136-147` and `_ss-env.sh` `[C]` only, as in the source forensics.
- I did not price the request half of the 8.7% separately per rollout; the 91 sole-native
  subagent requests are not broken out per rollout in `analysis-extras.txt`, so I applied the
  token share (74.9%, then 41.2%) as the scaling proxy for the whole $0.001809 and said so.
- I did not verify whether `git rev-parse --git-common-dir` behaves as the candidate assumes
  inside a Claude Code worktree; that is a $0 local check the synthesis should run before
  writing any build plan.
- I did not open HO2, any per-task held-out data, or any grading log. No hidden test name or
  gold patch content appears above.

## 10. Evidence opened

Local repository, `/Users/admin/Projects/sweet-search-private`:
- `eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/DEAD-LEVER-REGISTER-DRAFT.md`
- `eval/task-completion-bench/handoffs/improve/slate-c/register/DEAD-LEVER-REGISTER.md` (E1, E2, E3, E15, G6, G10)
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/claude-subagents.md` (§0, §5, §6.1, §6.2, F4, lines 136-185)
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/native-capability-gaps.md` (§0, §1, §3.1, §3.2, §4 G1)
- `eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-native-capability-gaps/data/analysis-extras.txt` (§A, §B, §C, §F)
- `eval/agent-read-workflows/bin/_ss-helpers.mjs` (lines 136-147, 235-280, 338-395, read-path resolution)
- `eval/agent-read-workflows/bin/_ss-argparse.mjs` (lines 82, 151, 255-268)
- `eval/agent-read-workflows/bin/_ss-env.sh`
- `eval/task-completion-bench/harness/agent-runner-shared.mjs` (lines 125-150)
- `core/infrastructure/config/search.js` (lines 369-379, `AGENTIC_GITIGNORE_ALLOWLIST`)
- `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`
- `package.json` (`files`, `bin`, `scripts`)

Evidence box, `root@167.233.69.121`, read-only:
- `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/rows.json`
- `/tmp/wf-slatec/native-capability-gaps/events-claude-code.jsonl.gz`

Rollout identifiers examined (all `fp-claudecode-tab-20260826`, sweet arm):
`asynkron__protoactor-dotnet-1909/rep1`, `bfgroup__b2-113/rep1`, `bfgroup__b2-113/rep2`,
`bfgroup__b2-259/rep0`, `bfgroup__b2-259/rep1`, `final-form__final-form-64/rep2`,
`awslabs__aws-embedded-metrics-node-21/rep0`, `awslabs__aws-embedded-metrics-node-21/rep2`,
`fastify__fastify-cors-285/rep0`.
