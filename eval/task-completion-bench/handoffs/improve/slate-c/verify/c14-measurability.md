# c14 — adversarial verify, differential and measurability lens

**Verdict: REFUTED as written.** The candidate has zero head-to-head differential by its own
admission, so it can never move the workflow's goal. That alone does not kill it, because the
brief permits a measurement obligation. What kills it is that four of its load-bearing claims
fail when I recompute them from the run's own recorded usage. Its first correction is already
shipped on the arm it targets. Its stated baseline has the opposite sign to the measurement.
Its own pre-registered kill condition fires on the five-minute price bucket. Its third
correction contradicts the forensics document it cites. Underneath the package there is a real
two-paragraph disclosure obligation and one sensitivity row. That is what should survive, not a
"days of work" analyzer package.

Denominators used throughout: `fp-claudecode-tab-20260826`, 132 rows, 66 rollouts per arm,
22 tasks × 3 reps × 2 arms, model `openai/gpt-5.6-luna` on all 132 rows [M `c14_rows2.py`].

---

## 1. What I verified as true

**V1. The pages arm-asymmetry reproduces exactly, on a third independent parser** [M
`scripts-c14-measurability/c14_pages.py`, 138 main-thread transcripts, subagent files excluded].
Failed `Read` calls carrying "Invalid pages parameter": native 163 in 67 files, sweet 25 in 20.
Requests where every tool call failed that way: native 93, sweet 25. Per rollout that is 1.41
against 0.38, a factor of 3.7. This matches `pagescheck.py` and `phase-anatomy.md` PA-6.

**V2. The subagent model census reproduces exactly** [M box grep over main-thread transcripts].
Native ran 33 subagents and asked for `haiku` on 19 and `sonnet` on 14. Sweet ran 11 and asked
for `haiku` on 6 and `sonnet` on 5. Subagent transcript files: native 33, sweet 11.

**V3. The shipped cache-write surcharge is real and claude-code-only** [C
`harness/ideal-cost.mjs:95` `cacheWrite * price.in * 1.25`; `harness/claude-code-task-runner.mjs:195`
is the only adapter that supplies `cacheWrite`]. This is register G17, and it is correctly
revived.

**V4. No bench run could have used a one-hour cache** [M box probe of the 2.1.218 binary that ran
every `fp-claudecode-*` cell]. `promptCacheTtl`, `subagentPromptCacheTtl`,
`FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H` and
`ephemeral_1h` each occur **0** times. In the rows themselves,
`usage.cache_creation.ephemeral_1h_input_tokens` and `ephemeral_5m_input_tokens` sum to **0** over
all 132 rows [M `c14_x.py`]. The bench cannot observe the TTL dimension at all.

**V5. The one-hour surcharge size is about right.** Repriced on measured usage, the one-hour
vector costs 18.3% more than the five-minute vector on native and 20.8% more on sweet [M
`c14_reprice.py`]. The candidate's 19.1% sits inside that.

---

## 2. Why it is refuted

### R1. Correction (1) is already shipped on the arm it targets

The candidate's evidence line says "the luna vector has no write term; only claude-code
accounting supplies 1.25x". The first half is true only of the `MODEL_PRICES` entry. The
multiplier is hardcoded in the shared cost function and it is applied to every claude-code row
[C `ideal-cost.mjs:95`]. So the claude-code ledger **already charges the Anthropic five-minute
write surcharge**.

Expressed as ratios to the input rate, the shipped claude-code vector is
`write 1.25x / read 0.10x / output 6.0x`. The Anthropic five-minute vector is
`1.25x / 0.10x / 5.0x`. The only difference is the output multiplier. The one-hour vector adds
the single genuinely new term, `write 2.00x`.

G17's real content is the opposite of the candidate's framing: codex and opencode are **not**
charged, and charging them makes sweet look **better** there — opencode +3.31% to +2.52%, codex
+0.35% to +0.06% [M `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §2.1 line 150]. The candidate
presents a mixed-direction correction as a one-way risk.

Further, whether the provider bills luna cache writes at 1.25x at all rests on one web page and
no provider bill [C/W same source]. The shipped ledger may already over-charge claude-code
against the other two arms. Correction (1) proposes to double that unverified number.

### R2. The stated baseline is a reconstruction from rounded shares, and the measurement has the opposite sign

The "+2.2% main-only, luna as registered" figure is not measured. It is
`0.84 x $0.020727` against `0.79 x $0.021558` [C `research/anthropic-model-product-path.md`
§4.3–4.4]. That is the **inclusive** per-rollout dollar multiplied by a **rounded whole-percent
non-sidechain share** taken from `BRIEF.md` §1.1, then called a main-only cost. Every token
count in §4.3 (`I`, `P`, `O`) is derived by dividing the same rounded share by the same rounded
price, so the whole Opus-5 table rests on three two-digit shares.

Repriced from the run's own recorded main-thread usage, the same quantity is negative:

| construction of "claude-code main thread, luna" | sweet − native |
|---|---:|
| `costRealizedMainOnlyUsd`, all 132 rows [M `c14_rows2.py`] | **−1.38%** |
| recorded `usage` aggregate, all 132 rows [M `c14_x.py`] | **+1.08%** |
| recorded `usage`, 4 disagreeing cells dropped from both arms, 62 rows/arm [M `c14_z.py`] | **−0.67%** |
| `idealCostMainOnlyUsd`, all 132 rows [M `c14_rows2.py`] | **−3.85%** |
| reconstruction the candidate uses [I `anthropic-model-product-path.md` §4.4] | **+2.2%** |

Three of the four measured constructions give sweet the cheaper main thread. The
reconstruction gives the only positive number, and the candidate builds its ceiling on it.

### R3. The mechanism numbers are wrong, and that error produced the ceiling

The candidate says sweet ingests about 11.3% more tokens and re-sends each 5.0% fewer times.
Measured on the main thread [M `c14_z.py`, 62 balanced rows per arm]: ingest **+13.4%** (44,617
against 39,339 tokens per rollout) and re-sends **−12.7%** (17.65 against 20.22 per ingested
token). The offsetting term is 2.5 times larger than stated. That is exactly why the
reconstruction lands at +2.2% where the measurement lands near −0.7%.

### R4. The candidate's own kill condition fires on the five-minute bucket

Repricing measured usage under each vector [M `c14_z.py`, balanced 62 rows per arm; the
full-132-row version in `c14_reprice.py` gives the same moves]:

| vector (ratios to the input rate) | sweet − native | move from shipped |
|---|---:|---:|
| luna as shipped, `w1.25 / r0.10 / o6.0` | −0.67% | — |
| luna with no write surcharge, `w1.00` | −1.55% | −0.88 pp |
| Anthropic 5-minute, `w1.25 / r0.10 / o5.0` | **+0.01%** | **+0.68 pp** |
| Anthropic 1-hour, `w2.00 / r0.10 / o5.0` | **+2.09%** | **+2.76 pp** |
| Fable-5.1-like 5-minute, `w1.25 / r0.025 / o5.0` | +0.63% | +1.30 pp |

The move is the robust part. On the full 132 rows it is +0.69 pp (five-minute) and +2.82 pp
(one-hour) [M `c14_reprice.py`]. The baseline is not robust; it swings 1.75 percentage points on
the choice of which incomplete rows to keep.

The candidate pre-registers: "retire the pricing concern if sweet-minus-native stays within ±1
percentage point of the luna figure on both TTLs." The five-minute move is **+0.68 pp**, inside
the bar. The one-hour move is **+2.76 pp**, outside it. So the concern **retires on the
five-minute bucket by the candidate's own rule**, and survives only on the one-hour bucket —
the bucket that requires Claude Code v2.1.242 or later, that no bench run could request (V4),
and that the rider exists to switch off.

### R5. "Erase the published −3.9%" is not a well-posed claim

Seven numbers describe the claude-code cost delta on this one run:

| number | construction | source |
|---|---|---|
| −8.8% | row-matched, ties to `costRealizedMainOnlyUsd` on 342/342 rows; interval [−33.1%, +29.1%] | `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §2.1 line 181 [M] |
| −3.9% | published; "dearest-3", substituting 12 discarded degeneration re-runs | same [M] |
| +1.9% | every dollar spent (sweet triggered 11 of those 12 re-runs) | same [M] |
| −3.85% | `idealCostMainOnlyUsd`, 132 rows | `c14_rows2.py` [M] |
| −1.38% | `costRealizedMainOnlyUsd`, 132 rows | `c14_rows2.py` [M] |
| +1.08% | recorded `usage` aggregate, 132 rows | `c14_x.py` [M] |
| −0.67% | recorded `usage`, balanced exclusion, 62 rows/arm | `c14_z.py` [M] |

There is no single −3.9% for a 0.7 to 2.8 point repricing to erase. Worse, the sign is decided
by a handful of rollouts. Four of 132 rows disagree between the aggregate `usage` field and the
turn ledger by more than $0.000001; all four delegated to a subagent [M `c14_y.py`]. Dropping
just those four rows moves the ledger delta from −1.38% to **+1.57%**. Three of the four are
native.

### R6. The effect is one twentieth of the interval it lives in

Task bootstrap on the paired main-only delta, seed 42, 4,000 resamples over 22 tasks: **95%
interval [−19.81%, +27.41%]** [M `c14_reprice.py`]. The published analysis reports [−33.1%,
+29.1%] on its own construction, [−11.6%, +12.9%] on codex and [−8.5%, +16.4%] on opencode [M
`HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §2.1].

I state the fair version of this objection. A repricing is deterministic on fixed traces, so it
adds no sampling noise; it is a bias correction, not a precision problem. But the *inference*
the candidate claims to change — "sweet leads on no harness on the real-user path" — is
unsupported before and after the correction, because the interval already spans both signs.
A 0.68 to 2.82 point shift cannot decide a question whose interval is 47 points wide.

### R7. Correction (3) contradicts the document it cites

`forensics/claude-subagents.md` line 148 concludes: sweet's margin moves "from −9.2% to −3.0%
or −4.1% **but keeps its sign** … The headline is therefore pricing-dependent but **not
sign-fragile**" [M]. The candidate lists this among corrections that "together can erase the
published −3.9%". Its own source says it cannot.

The −9.2% base is itself imputed. Neighbour imputation raises native sidechain spend by 41% and
sweet's by 66%; the recorded-only inclusive figure is −10.7% (native $0.019854, sweet $0.017735)
[M same source line 144]. So correction (3) reprices an imputation.

### R8. The three corrections are quoted on three different bases and then added

Correction (1) is quoted on a reconstructed "main-only". Correction (2) is quoted on
`costRealizedMainOnlyUsd` ("−1.38% to +0.62%"). Correction (3) is quoted on an imputed
"inclusive" (−9.2%). The word "together" adds them. They do not share a denominator. Note also
that `costSidechainUsd` is null on every row that delegated, and `sidechainAccountingComplete`
is false on exactly those rows — native 28 of 66, sweet 9 of 66 [M `c14_rows2.py`] — so
`rows.json` cannot produce a sidechain-inclusive figure at all.

---

## 3. Rule check

| rule | result |
|---|---|
| HO2 never opened per-task | pass — dev pool `fp-*` only |
| gold, hidden tests or task identity at runtime | pass — none proposed |
| ranking signal format gate | not applicable — no ranking signal |
| owner decision without a flag | pass — the rider carries `needs_user_decision` |
| banned same-information compaction | pass — nothing is re-rendered |
| $0 falsifier | pass — a read-only replay; I ran a version of it |
| differential rule (rule 6) | **zero differential, declared**; it cannot be a lever |

No hard rule is violated. The refutation is on the evidence, not on a rule.

---

## 4. Corrections the synthesis must adopt

1. Delete "the luna vector has no write term" as stated. Replace with: the shared cost function
   hardcodes a 1.25x cache-write surcharge and only the claude-code adapter supplies the token
   count, so **claude-code already pays the Anthropic five-minute write price**; codex and
   opencode do not, and charging them makes sweet look better there (+3.31% to +2.52% opencode,
   +0.35% to +0.06% codex).
2. Replace the "+2.2% luna main-only" baseline with the measured range **−1.4% to +1.6%**,
   and name the construction each time. State that the reconstruction behind +2.2% multiplies an
   inclusive dollar by a rounded whole-percent share.
3. Replace "+3.4% (5m) / +4.6% (1h)" with the measured **+0.01% (5-minute) / +2.09% (1-hour)**
   on a −0.67% baseline, or state the move instead of the level: **+0.68 pp (5-minute),
   +2.76 pp (1-hour)**.
4. Replace "sweet ingests 11.3% more and re-sends 5.0% fewer" with **+13.4% ingest and
   −12.7% re-sends** (44,617 against 39,339 tokens per rollout; 17.65 against 20.22 re-sends).
5. Delete "together they can erase the published −3.9%". Say instead: seven constructions of the
   claude-code delta exist, spanning −8.8% to +1.9%, and the sign is carried by about three
   rollouts of 66.
6. Record that the candidate's own ±1 pp kill condition **fires** on the five-minute bucket.
   Only the one-hour bucket survives it.
7. Add the rate-versus-dollars nuance to the pages disclosure: native failed 163 of 709 main-thread
   `Read` calls (23.0%), sweet 25 of 56 (44.6%) [M `c14_pages.py`]. Absolute dollars favour
   sweet; the per-call failure rate favours native. Sweet is not immune, it simply calls `Read`
   12.7 times less often.
8. Restore correction (3)'s own conclusion: the subagent repricing **keeps the sign**, and its
   −9.2% base is imputed (recorded-only is −10.7%).
9. Say plainly that the bench cannot observe the TTL split: `ephemeral_1h_input_tokens` and
   `ephemeral_5m_input_tokens` are 0 on all 132 rows, and 2.1.218 contains no TTL key at all.
10. Cut the build cost. "Days for the columns" buys a point-estimate shift smaller than one
    twentieth of the interval it sits in. The defensible deliverable is one sensitivity row
    (five vectors, one table) plus a two-paragraph disclosure appended to G17, G6 and D4a/D4b.

---

## 5. Revised ceiling

Zero head-to-head differential; not a lever under any reading. As a measurement obligation the
honest content is:

- claude-code main thread, sweet minus native, measured: **−0.67%** on the shipped luna vector,
  **+0.01%** on the Anthropic five-minute vector, **+2.09%** on the Anthropic one-hour vector,
  **+0.63%** on a Fable-5.1-like vector — all inside a **[−19.8%, +27.4%]** bootstrap interval.
- The pages asymmetry disclosure stands, with the rate nuance added.
- The subagent repricing keeps its sign and is a disclosure line beside G6.
- The rider is the only part with a measurable consequence (18.3% to 20.8% on the one-hour
  bucket), it is arm-universal, it requires v2.1.242 or later, it changes the price and
  behaviour of every unrelated Claude Code conversation in that project, and no bench run can
  validate it. Keep `needs_user_decision`.

---

## 6. What I could not finish

1. I did not rebuild per-request usage per `message.id` from the raw transcripts. I used the
   `usage` aggregate on each row and the turn ledger, and I showed where the two disagree (4
   rows of 132). A full per-request rebuild would settle which of the two is right on the four
   delegating rows; it would not widen the bootstrap interval, so it cannot change the verdict.
2. I did not price the sidechain under the Anthropic vectors. `costSidechainUsd` is null on every
   delegating row, so any inclusive repricing needs the imputation `claude-subagents.md` already
   built, and that imputation is the weakest link in correction (3).
3. I did not verify the Anthropic list prices myself. I used ratio form only (write 1.25x/2.00x,
   read 0.10x, output 5.0x), which is what the candidate cites [W]; absolute dollars are not
   forecast here, and the cited source itself warns the tokenizer differs.
4. I did not check whether a Claude subscription's usage limits are charged on write-surcharged
   tokens. The rider targets subscription users, so this matters to the rider's value.

---

## 7. Evidence

Local files read: `slate-c/BRIEF.md`; `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`;
`slate-c/register/DEAD-LEVER-REGISTER.md` (D4a, D4b, G6, G15, G16, G17);
`slate-c/candidates/DEDUP.md` (c14 entry, lines 248–258);
`slate-c/candidates/real-user-product.md` §3.1, §3.2, RU-5, §5–§7;
`slate-c/candidates/inversion-and-removal.md` A1, A2, A3, C5, §6, §7;
`slate-c/research/anthropic-model-product-path.md` §4.2–§4.5;
`slate-c/forensics/claude-subagents.md` lines 87, 95, 128, 144, 148, 210;
`slate-c/forensics/claude-main-thread.md` lines 16, 193, 262;
`FRESH-POOL-RESULTS.md` §2; `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §2.1 lines 150, 156,
169, 181, 206, 400, 406, 454.

Code read: `eval/task-completion-bench/harness/ideal-cost.mjs` lines 13–108 (the 1.25x on line
95); `harness/claude-code-accounting.mjs` lines 72–160, 322–385;
`harness/claude-code-task-runner.mjs` line 195; grep for `cacheWrite` across `harness/` and
`stats/`.

Evidence box, read-only, scratch in `/tmp/wf-slatec/c14-measurability/`:
`results/fp-claudecode-tab-20260826/rows.json` (132 rows);
`results/fp-claudecode-tab-20260826/agent-state/*/claude-home/projects/*/*.jsonl` (138
main-thread transcripts, 44 subagent transcripts); `/root/.local/share/claude/versions/2.1.218`.

Scripts, copied to `slate-c/verify/scripts-c14-measurability/`: `c14_rows.py`, `c14_rows2.py`
(arm means and null structure), `c14_usage.py` (usage shape), `c14_reprice.py` (five-vector
repricing on 132 rows plus the task bootstrap), `c14_x.py` (TTL split and ledger
reconciliation), `c14_y.py` (the four disagreeing rows), `c14_z.py` (balanced-exclusion
repricing), `c14_pages.py` (independent pages census).
