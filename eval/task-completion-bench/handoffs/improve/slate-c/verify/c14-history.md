# c14 — adversarial verify, HISTORY lens: REFUTED

**Verdict: refuted, confidence 0.90.** Candidate c14 is three claude-code accounting
corrections plus one product rider. Two of the three corrections are already shipped code, the
third is not a correction at all, and the rider's own source document says twice that it is not
a slate lever. The candidate is self-declared `sweet_only: no` with the ceiling "risk, never a
win", so even a perfect version cannot make the sweet arm cheaper or solve more, which is the
slate's stated goal. One genuine measurement chore survives, and it is register row **G17**
unchanged — but c14 states G17 backwards.

---

## 1. What c14 proposes, and where each part already lives

| part | c14's claim | what the record and the code say | verdict |
|---|---|---|---|
| 1a | "Rebuild per-request usage from raw transcripts (usage-bearing record per `message.id`, `isSidechain` split)" | **Shipped and verified exact.** `claude-code-accounting.mjs` groups every record by `message.id` and keeps the usage-bearing one; `sidechainTurnSets` prices each delegated transcript separately `[C]`. Register **G1a SHIPPED**: 0 of 1,939 multi-record ids disagreed on any token category `[M]`. | already done |
| 1b | "Price cache writes at 1.25x" | **Already charged on claude-code.** `ideal-cost.mjs:94-96` multiplies `cacheWrite` by 1.25 in the realized column, and `claude-code-accounting.mjs` supplies `cacheWrite = usage.cache_creation_input_tokens` `[C]`. `costRealizedUsd` **is** `realFromTurnsUsd` `[C agent-runner-shared.mjs:335-337]`. | already done |
| 1c | "Price main-thread cache writes at 2.00x (1-hour TTL)" | **Does not apply to this bench.** c14's own cited TTL table gives one hour only on a "Claude subscription, within plan usage"; an "API key or cloud provider" path is five minutes in **both** buckets `[W anthropic-model-product-path.md §4.2]`. The runner routes through OpenRouter with `ANTHROPIC_AUTH_TOKEN` and deliberately blanks `ANTHROPIC_API_KEY` `[C claude-code-task-runner.mjs:274-281]`. The bench bucket is five minutes = 1.25x = what the ledger already charges. | not a correction |
| 1d | "Reads 0.10x, output 5.00x — the Anthropic vector" | **Forbidden by a documented code invariant.** `ideal-cost.mjs:19-22` `[C]`: "The delta between arms is NOT price-invariant: ideal weights newIn/resent/out by this vector, so pricing one backbone at another's rates silently distorts the efficiency-at-parity headline (a model with pricier output penalizes the more verbose arm)." The same file states the design rule for the headline column: "a model's cache-WRITE rate never enters this math", because the ideal column is cache-normalized so that TTL and cache luck "cannot pollute an A/B" `[C ideal-cost.mjs:14-17, 60-66]`. | reintroduces the pollution the column exists to exclude |
| 2 | "Repair or disclose the residual invalid-`pages` Read failures" | **Recorded twice, with the asymmetry and the sign.** Register **D4a SHIPPED**: 68 native against 6 sweet Read calls died on the empty value `[M]`, and the row already prices the sign: the fix "improves **native's** claude-code cost by an estimated 2-4%; when that number moves it must never be described as a sweet regression." The product code carries the same sentence, dated 2026-08-12 `[C claude-code-task-runner.mjs:332-339]`. **D4b BLOCKED**: no documented Claude Code surface can close the residual; its revival condition has not fired. | repair dead, disclosure already standing |
| 3 | "Price each subagent at the model it requested" | **The ledger is right; c14's version would make it wrong.** The runner pins `ANTHROPIC_DEFAULT_SONNET_MODEL`, `..._OPUS_MODEL` and `..._HAIKU_MODEL` to the same OpenRouter slug `[C claude-code-task-runner.mjs:279-281]`, and the forensics report c14 cites confirms the outcome: "The proxy resolved all of them to `openai/gpt-5.6-luna` (`resolvedModel` in `toolUseResult`) and the ledger priced them at luna's rate" `[M claude-subagents.md:148]`. Luna's rate is what was billed. | counterfactual, not a correction |
| rider | "init writes `promptCacheTtl: '5m'`" | Mechanically possible: `init` does write `.claude/settings.json` `[C scripts/init.js:1006]`, and the setting needs v2.1.242+ while the bench ran 2.1.218 `[W harness-changelogs.md:166]`. But the source document states the disposition twice: "This is **not** a lever for the slate. It reaches both arms identically" and "**Not a slate lever.** Listed so it is not mistaken for one" `[research/anthropic-model-product-path.md §4.5, C-A5]`. | arm-universal, zero differential |

---

## 2. The register check in c14 is backwards on its own headline row

c14 says G17 is "never recomputed for claude-code" and treats that as the gap it fills. The
register says the opposite. **G17's live half is codex and opencode**, which supply no cache-write
field at all; claude-code is the one harness that already charges the surcharge.

> "The cache-write surcharge is charged on claude-code only, and it is not neutral between
> arms. `costFromTurns` multiplies a `cacheWrite` field by 1.25. Only
> `claude-code-accounting.mjs:103` supplies that field. The opencode runner folds `cache.write`
> into `in`, and codex's `turnsFromRollout` emits none."
> — `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §2.1 `[C/M]`

G17's recorded effect is on the other two harnesses: charging it everywhere moves opencode
+3.31% to +2.52% and codex +0.35% to +0.06% `[M register G17]`. Independent corroboration that
1.25x is the right multiplier for the model actually served: OpenRouter lists `openai/gpt-5.6-luna`
cache write at `$0.25` against `$0.20` input, exactly 1.25x `[W 06-research-cost-mechanics.md §1.1,
<https://openrouter.ai/api/v1/models>, fetched 2026-08-28]`. So G17 needs finishing on codex and
opencode. c14 does not advance that half; it misdirects it.

---

## 3. What I measured myself (all `$0`, read-only)

Run: `/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/rows.json`,
132 rows (22 tasks x 3 reps x 2 arms), all carrying `model: openai/gpt-5.6-luna` `[M]`.

| quantity | native | sweet | note |
|---|---:|---:|---|
| `costRealizedMainOnlyUsd` mean, n=66 each | $0.016542 | $0.016314 | sweet **-1.38%**, reproducing c14's own pages baseline and the register's "-1.4% on all 22 tasks main-only" |
| rows with a non-null `costRealizedUsd` | 38 of 66 | 57 of 66 | 28 native and 9 sweet nulls — reproduces **G6** exactly |
| `usage.cache_creation_input_tokens` per rollout | 37,507 | 43,329 | sweet writes **15.5% more** cache tokens; the direction of c14's write-price sensitivity is real |
| `cache_creation.ephemeral_1h_input_tokens`, summed over all 132 rows | 0 | 0 | while `cache_creation_input_tokens` sums to **5,335,178** |
| `cache_creation.ephemeral_5m_input_tokens`, summed over all 132 rows | 0 | 0 | the OpenRouter skin does not populate the TTL split at all |
| `usage.service_tier` | `standard` | `standard` | on every row |

**The last two rows break c14's own falsifier.** Its `$0` test is "one replay over
`fp-claudecode-tab-20260826` agent-state claude transcripts ... applying the three corrections".
The transcripts do not record which TTL was used: both ephemeral fields read zero on all 132 rows
`[M]`. A replay therefore cannot decide between the 1.25x and the 2.00x column from data; it must
assume the answer it was built to test. The provider-path argument in §1 row 1c settles it
independently, and it settles it at 1.25x — the value already in the ledger.

---

## 4. Every move is far inside the recorded uncertainty, and the target was already withdrawn

c14's ceiling is "together they can erase the published -3.9%". Three problems.

**(a) The three moves use three different denominators and cannot be summed.**
Part 1 runs on a main-only convention whose baseline is +2.2% `[real-user-product.md §3.2]`.
Part 2 runs on a different main-only convention whose baseline is -1.38% `[M rows.json, above]`.
Part 3 runs on an inclusive convention whose baseline is -9.2% `[M claude-subagents.md:148]`.
The published -3.9% is a fourth convention (dearest-3, inclusive lower bound). Parts 1 and 2
act on main-only, which **excludes** the delegated spend that produces the -3.9% in the first
place.

**(b) Part 3's own source states the opposite conclusion.** "Sweet's margin narrows from -9.2%
to -3.0% or -4.1% but **keeps its sign** ... The headline is therefore pricing-dependent but
**not sign-fragile**" `[M claude-subagents.md:148, F7 row 210]`. c14 quotes the numbers and
inverts the finding.

**(c) The moves are one twenty-fifth of the interval.** The claude-code row-matched comparison
is -8.8% with a bootstrap interval of **[-33.1%, +29.1%]**; the all-22 main-only figure is -1.4%
with **[-20.1%, +27.0%]** `[M HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md §2.2]`. c14's largest
single move is 2.4 points (part 1) and its pages move is 2.0 points. And the program has already
recorded four claude-code numbers that are each right about something different — **-8.8%
row-matched, -3.9% published, +1.9% every dollar spent** `[M same §2.2]` — plus register **G5**:
"No arm difference clears the pre-registered +/-6-rollout bar on any harness." `BRIEF.md` §1 states
it plainly: "The claude-code 'win' is entirely native's subagent spend; on the 4 tasks where
neither arm delegated, sweet's main thread is +26% dearer." **There is no standing claude-code
win to erase.** c14 aims at a claim the programme withdrew before Slate C opened.

---

## 5. Within Slate C, part 2 is also a same-day duplicate

`forensics/phase-anatomy.md` (this slate, phase 1) already measured the fresh-pool pages residual
and already computed the sign move:

- "154 `Invalid pages parameter: \"\"`, 9 `Invalid pages parameter: \" \"` ... sweet has 26" `[M]`
- "native 1.39 per solved-everywhere rollout, $0.000513 = 5.9% of its main-thread cost; sweet
  0.42 ... on all 22 tasks 1.52 against 0.52" `[M]`
- "Without the artifact native's claude-code cost would be about 4% lower ... and sweet's +2.1%
  would read about +6%" `[I]`
- Its own disposition, item 9: "extends D4 (fix incomplete for the `\"\"` form) and G6 ...
  **measurement, not a lever**." `[phase-anatomy.md:13, 218, 249, 323]`

c14's 93-against-25 wholly-wasted-request count (1.41 against 0.38 per rollout, 3.7x) is a third
parser over the same defect on the same run. It is consistent, and it is not new.

---

## 6. What survives, and what it is worth

Two obligations, both already on the register, neither a lever:

1. **Finish G17 on codex and opencode.** Their runners emit no cache-write field while
   OpenRouter lists luna's write at 1.25x input `[W]`. Recorded effect: opencode +3.31% to
   +2.52%, codex +0.35% to +0.06% `[M]`. This *shrinks* sweet's measured penalty on both
   harnesses, so it is a fairness fix that helps sweet, not a risk.
2. **Keep disclosing the pages asymmetry beside every claude-code table**, as D4a's own wording
   and G6 already require. D4b stays BLOCKED; its revival condition (a documented per-tool
   schema override, or a confirmed change to `pages` validation in a Claude Code release) has
   not fired.

Nothing here changes a lever verdict, a solve count, or a head-to-head differential.

## 7. Corrections the synthesis must adopt

1. Reverse c14's G17 sentence. claude-code **already** charges the 1.25x cache-write surcharge;
   codex and opencode do not. G17's open half is those two harnesses.
2. Delete the "2.00x main thread" column from any claim about this bench. The bench ran an
   API-key/auth-token path, which c14's own TTL source puts in the five-minute bucket for both
   main thread and subagents. Keep 2.00x only as a labelled hypothetical about a Pro/Max
   subscriber on Anthropic models.
3. Say that the subagent ledger is **correct**: all three model slots were pinned to one slug and
   every subagent resolved to `openai/gpt-5.6-luna`, so luna's rate is what was billed.
4. Replace "together they can erase the published -3.9%" with the source's own finding:
   "pricing-dependent but not sign-fragile" (-9.2% to -3.0/-4.1%, sign kept). State that the
   three corrections sit on three different denominators and cannot be summed.
5. Credit D4a and `claude-code-task-runner.mjs:332-339` with the pages arm asymmetry **and** the
   sign discipline. c14's contribution is an updated magnitude, already published this slate in
   `phase-anatomy.md`.
6. Quote the intervals whenever a repricing move is quoted: row-matched -8.8% [-33.1%, +29.1%];
   all-22 main-only -1.4% [-20.1%, +27.0%].
7. Record that the proposed `$0` falsifier cannot decide the TTL: both `ephemeral_1h` and
   `ephemeral_5m` cache-creation fields are zero on all 132 rows of the run it names.
8. For the rider, say "plan-usage consumption", not "bill". Its named beneficiary is a
   subscription user within plan usage, who is metered against limits rather than invoiced per
   token. And note `promptCacheTtl` needs v2.1.242+ while the bench ran 2.1.218.
9. Revised ceiling: **$0 head-to-head differential, no solve effect, no lever.** Residual value =
   two registered measurement chores (G17's codex/opencode half; D4a/G6 disclosure).

## 8. What I could not finish

- I did not read a provider invoice. Whether OpenRouter actually billed luna's cache writes at
  the listed 1.25x is still web-sourced only, exactly as G17 records.
- I did not re-derive c14's `pagescheck.py` counts myself; I checked them against
  `phase-anatomy.md`'s independent parser (163 pages-invalid Read errors on native, 26 on sweet)
  and they agree.
- I did not verify the `2.1.218` binary probe for `promptCacheTtl`; I confirmed the version floor
  from `harness-changelogs.md` and that the locally installed client is 2.1.258.
