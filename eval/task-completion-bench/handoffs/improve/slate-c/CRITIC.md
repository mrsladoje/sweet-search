# SLATE C — completeness critic (2026-09-02)

**Verdict first.** The uber document's headline conclusion survives, but three of its
load-bearing statements do not, and nineteen gaps need repair before anything ships or is
published. The conclusion "no admissible combination reaches at-most-native cost on all three
harnesses at equal-or-better solves" holds, because codex still needs +2 solves of 66 and
claude-code +3 of 66, and no candidate offers a solve. What fails is the supporting text.
The one path that could move opencode is summarised as "parity at best" when its own verifier
puts it at "+2.9% to −1.2% against native". One survivor carries a wrong user-decision flag and
a mechanism its verifier says breaks the outcome-blind admission contract. One executive claim
calls a real-user price counterfactual a "bench artefact", which both c14 verifiers refuted. Two
`$0` questions this slate already answered are still scheduled as unrun. Two of the five
survivors get no register row, so a future session can re-propose them.

Cost of this review: `$0`. No rollout ran. Nothing under `results/` was written. The frozen
held-out set was never opened. No grading log was read. No hidden test name and no reference
patch content appears here.

Tags: `[M]` measured with a named script or command, `[C]` read from code, `[W]` web with URL,
`[I]` inferred with the arithmetic shown, `[carried]` taken from a slate document and not
re-measured here.

What I read in full: `slate-c/SLATE-C-UBER.md` (539 lines),
`slate-c/register/DEAD-LEVER-REGISTER.md` (405 lines), `slate-c/BRIEF.md`,
`slate-c/DEAD-LEVER-REGISTER-DRAFT.md`, `slate-c/candidates/DEDUP.md` §0–8. Skimmed with
targeted reads: all eight forensics reports, all six research reports, the six candidate lens
reports, and the verdict plus "corrections the synthesis must adopt" sections of the 45 files
under `slate-c/verify/`.

---

## 1. Blocking

### B1. The opencode ceiling is mis-stated in the executive table and in the owner decision

**Where.** `SLATE-C-UBER.md` §0.1 opencode row, §2 opencode row, §8 item 1.

**What the uber says.** "register A4 structured surface, owner-excluded: −0.4% to −4.5% of the
sweet cell after schema cost, **parity at best**"; "parity is not a win"; "It cannot make sweet
emit fewer requests than native"; "That is about parity with native."

**What the cited source says.** `verify/c02-mechanism.md` §5: "Vehicle (b) custom structured
tools, opencode only: ceiling −3.5% to −4.5% of the sweet cell ... minus about 3.1% for schemas
unless the guide is cut equally. Net −0.4% to −4.5%, **landing sweet between +2.9% and −1.2%
against native**." `[carried]`

**Why it matters.** The bar for opencode is a cut of −3.2% of the sweet cell `[I on M: (0.009265
− 0.008968) / 0.009265 = 3.21%]`. A −4.5% cut clears it. Checked: 0.009265 × 0.955 = 0.008848
against native 0.008968, which is −1.34% `[I]`, close to the verifier's −1.2%. The uber conflates
two different quantities. Request parity is true, because a structured surface can at best make
sweet batch like native. Cost parity is not what the source says, because sweet returns fewer
bytes per request. §8 item 1 is the text the owner reads to take the only decision that can move
opencode, and it hides the win end of its own range.

**Fix.** Quote c02-mechanism §5's translation verbatim in the §0.1 opencode cell and in §8 item
1: "vehicle (b) lands sweet between +2.9% and −1.2% against native; vehicle (a) is exactly
parity". Separate the request claim from the cost claim in one sentence each. Keep the
owner-excluded status and the unbenchmarked warning unchanged.

---

### B2. Survivor §4.2 carries a wrong decision flag and a mechanism its verifier says is inadmissible

**Where.** `SLATE-C-UBER.md` §4.2, and its absence from §8.

**What the uber says.** "At admission, run the shim's clean-baseline classification once and
refuse or label tasks that are not `trustworthy=yes`." … "**needs_user_decision:** no."

**What the verifier says.** `verify/c15-measurability.md` §7 rule table: "Owner decisions without
a flag | **Violated in the metadata.** `needs_user_decision: no` is wrong. Running `run_tests` in
the jailed image at admission breaks the documented 'METADATA-ONLY and OUTCOME-BLIND' contract of
`select/task-gates.json` `[C]` and, since the gate runs before the seeded draw over a roughly
19,000-task pool `[C PLAN.md §6 row P6]`, a jailed image run per candidate is not affordable
there." Correction 9: "Set `needs_user_decision: true`." `[carried]`

The same section carries a second constraint the uber drops: "HO2 is frozen at denominator 199
(G4). An admission filter applied retroactively to a frozen set would break that freeze. Any
adoption must be forward-only." `[carried]`

**Why it matters.** As written, step 2 of the `$0` work plan (§6) tells an implementer to build an
admission gate that runs a container per candidate task and consumes outcome information at
admission. That is a benchmark-validity change, not a bug fix, and it is the exact class the
project's own methodology rules govern. The HO2 constraint is a hard rule in `BRIEF.md` §0 rule 4.

**Fix.** Set §4.2 to `needs_user_decision: yes`. Add the forward-only sentence. Add the item to
§8 as a tenth decision. Replace the falsifier line — which still uses the `INFRA` discriminator
that correction 1 says to abandon — with the `trustworthy=no` per-cell census and the refuter's
numeric kill (correction 7: "drop the item if fewer than 2 admitted tasks in a pool are
all-untrusted across every rep of every arm"). Also correct the register filing (see m6).

---

### B3. The subagent repricing is a real-user counterfactual, not a bench artefact

**Where.** `SLATE-C-UBER.md` §0.2 prose, §3 row 5, §4.1 evidence and ceiling.

**What the uber says.** "Two bench artefacts carry the published sign. … **Native's
haiku-requested subagents were priced as luna** `[M]`." §3 row 5: "Haiku-requested subagents
priced as luna | repricing flips dearest-3 −3.31% → +2.14% | Measurement only." §4.1: "Subagent
repricing at 0.2× moves dearest-3 −3.31% → +2.14% `[M]`."

**What both verifiers say.** `verify/c14-history.md` row 3: "**The ledger is right; c14's version
would make it wrong.** The runner pins `ANTHROPIC_DEFAULT_SONNET_MODEL`, `..._OPUS_MODEL` and
`..._HAIKU_MODEL` to the same OpenRouter slug `[C claude-code-task-runner.mjs:279-281]` … Luna's
rate is what was billed." It classes the item "counterfactual, not a correction".
`verify/c14-mechanism.md` §4 agrees: "the compute really was luna's; **the repricing is a
real-user sensitivity, not a bill correction**." `[carried]`

**Why it matters.** §4.1 is item 1 of "What to do first" and would ship a disclosure saying the
ledger mispriced native's subagents. It did not. The ledger is correct for the run that happened.
The repricing belongs only inside the labelled real-user rows of the §0.2 table, where it already
sits correctly. One of the "two bench artefacts" is therefore not an artefact, and only the
`pages` asymmetry is. On the bench's own ledger, removing only the `pages` waste leaves
claude-code sweet still cheaper at −1.55% inclusive `[carried M verify/c14-mechanism.md §3]`.

A second unadopted correction sits in the same place. `verify/c14-history.md` correction 6: "Quote
the intervals whenever a repricing move is quoted: row-matched −8.8% [−33.1%, +29.1%]; all-22
main-only −1.4% [−20.1%, +27.0%]." The §0.2 table quotes seven point estimates and no interval.

**Fix.** Reword §0.2 to "one bench artefact and one price-vector counterfactual". Change §3 row 5
to "not an artefact: all three model slots were pinned to one slug, so luna's rate is the true
price of what ran; the 0.2× figure is a real-user sensitivity". Add the two intervals to the §0.2
table. Delete the repricing from §4.1's list of ledger defects and keep it as a sensitivity row.

---

## 2. Major

### M4. A forensics seed never became a candidate and was never dropped: dot-config index admission

**Where.** `forensics/phase-anatomy.md` §7 seed S2; `candidates/index-time-and-capabilities.md`
§3 "Not carried forward as candidates"; absent from `candidates/DEDUP.md` entirely; referenced
once in `SLATE-C-UBER.md` §3 row 8 and pointed to the wrong section.

**The seed.** Admit extensionless dot-config files (`.eslintrc`, `.prettierrc`, `.editorconfig`,
`.babelrc`, `.flowconfig`, `.nvmrc`) to the index. Vehicle `core/infrastructure/config/search.js`
`FILE_PATTERNS`. Sweet-only. Ranking-neutral, so the `_isAgentFormat` gate does not apply.
Trace evidence `fp-claudecode-tab-20260826/callstack__react-native-paper-972/sweet/rep2` requests
18, 20, 21, 34 `[carried M]`. Stated register position: "extends E1 with a new instance class;
E1 did not list dotfiles" `[carried]`.

**The census that was asked for and delivered.** `index-time-and-capabilities.md` ran it: "94
dotfiles absent across the 22 goldens (`.eslintrc` 6, `.prettierrc` 7, `.editorconfig` 9 …);
native read one in 4 of 198 rollouts" and its instruction is "**Merge into the PA-5 seed**"
`[carried M census.py/census3.py]`. Its register table row reads "94 dotfiles outside the index |
E1 (PA-5 seed) | merge".

**What happened.** `candidates/DEDUP.md` has no R number for it, no merge-map entry, and no row
in §5 "Dropped candidates". A grep for `dot-config`, `dotfile`, `extensionless` and `eslintrc`
returns zero hits in `DEDUP.md` and zero in `register/DEAD-LEVER-REGISTER.md` `[M grep]`.
`SLATE-C-UBER.md` §3 row 8 names it ("Index exclusions: committed bundles and dot-config files")
and answers "Yes, as correctness (§4.3)". §4.3 covers three wrapper-side notes — the bundle "not
indexed" note, the `ss-semantic` fallback, and `ss-read` on excluded files. None of them admits a
file to the index. The citation is wrong and the seed is unanswered.

**Also carried nowhere:** the same section records "83 `.md` and 30 `.json` fixtures under 30
bytes are absent from the path table (markup-it, accenture). The rule that drops them was not
located in code" `[carried M]`. Its author marked it "recorded only"; nothing records it.

**Fix.** Add one row to §4.6 filing both index-admission facts as an E1 extension, with the
94-dotfile census and its 4-of-198 native-read exposure, or add an explicit drop row to
`DEDUP.md` §5 saying the ceiling (one task of 22, at most −1.3% of a pooled claude-code rollout
`[carried I]`) does not clear the bar. Correct §3 row 8's pointer.

---

### M5. Two `$0` questions this slate answered are still scheduled as unrun, and one is answered twice in opposite directions

**Where.** `SLATE-C-UBER.md` §6 step 5, §7 item 3, and §4.6 row E13.

**What the uber says.** §6 step 5: "Run the four specified-never-run `$0` falsifiers (register
§12.4 item 25): hygiene replay, index-rebuild replay, working-tree freshness census (E3),
`run_tests` scope census. … E3 stays OPEN unless stale-index calls exceed 5% of calls." §7 item 3
repeats that the four "were not run".

**What this slate measured.** `candidates/index-time-and-capabilities.md` F5 ran the E3 census:
"Genuine stale-index exposure: **7 of 1,251 sweet lexical `ss-*` calls (0.56%)**; requests until
the next edit or test run after them: 13 requests over 198 rollouts (0.07 per rollout, about 0.3%
of a rollout). **E3's revival condition (5% of calls) is not met.**" `[carried M census.py E,
census2.py 3]`

The same report's F1 ran the `run_tests` scope census: a six-cell table of `run_tests` calls,
calls carrying a pattern, and calls the shim ignored (codex 199/19/7 native and 197/33/7 sweet,
opencode 179/16/10 and 193/19/10, claude 207/21/2 and 200/13/4), plus the ignore reasons over all
396 rollouts `[carried M census.py A, census2.py 2, census4.py 3]`. `DEDUP.md` R21 uses those
numbers to drop the lever, and `SLATE-C-UBER.md` §4.6 itself moves E13 from OPEN to DEAD on them.

**Why it matters.** The work plan schedules paid-run preconditions. Two of its four items are
already answered, and one of them (E3) is answered inside a document the uber cites elsewhere.
The uber simultaneously closes E13 in §4.6 and keeps its census on the to-do list in §6. Only the
hygiene replay and the index-rebuild replay genuinely need a rebuilt golden.

**Fix.** Add an E3 row to §4.6: "OPEN → CLOSED, 7 of 1,251 sweet lexical calls (0.56%) against a
5% bar; 13 follow-up requests per 198 rollouts". Reduce §6 step 5 to the two golden-dependent
replays. Update register §12.4 item 25 from four falsifiers to two and note which document closed
the other two.

---

### M6. G17's open half is dropped, and it is worth a quarter of the opencode gap

**Where.** `SLATE-C-UBER.md` §4.1 "Refuter corrections adopted", §4.6 row G17, and the absence of
the item from §4 and §6.

**What the refuter listed as surviving.** `verify/c14-history.md` §6 item 1: "**Finish G17 on
codex and opencode.** Their runners emit no cache-write field while OpenRouter lists luna's write
at 1.25× input `[W]`. Recorded effect: opencode +3.31% to +2.52%, codex +0.35% to +0.06% `[M]`.
This *shrinks* sweet's measured penalty on both harnesses, so it is a fairness fix that helps
sweet." Correction 1: "claude-code **already** charges the 1.25× cache-write surcharge; codex and
opencode do not. **G17's open half is those two harnesses.**" `[carried]`

**What the uber adopted.** Only the first clause: "The claude-code ledger already charges cache
writes at 1.25× `[C ideal-cost.mjs:95]`." The §4.6 G17 row records a different thing entirely —
the Anthropic price-vector move on the claude-code cell. A grep of `SLATE-C-UBER.md` for "1.25"
returns four hits, none of which is the codex or opencode half `[M grep]`.

**Why it matters.** The uber's §0.1 says opencode must cut 3.2% of its sweet cell. Charging cache
writes on the same basis as claude-code moves the opencode comparison by 0.79 percentage points,
which is a quarter of that gap, and it moves it in sweet's favour. It is a measurement fairness
defect: the same ledger charges one harness a surcharge it does not charge the other two.
`verify/c14-mechanism.md` §2.3 confirms the arithmetic ("I re-derived both to the second decimal")
and states only that it is out of that verifier's scope, not that it is wrong `[carried M]`.

**Fix.** Add a §4 shared-correctness item: apply the cache-write treatment consistently across the
three runners, or disclose the inconsistency beside every cross-harness cost table. Add a §4.6
register row correcting G17's scope. Restate §0.1's opencode cell on whichever ledger the fix
chooses, and say which one it is.

---

### M7. §8 item 2 quotes a figure that both c09 verifiers ordered deleted

**Where.** `SLATE-C-UBER.md` §8 item 2 (the tool-guide decision).

**What the uber says.** "Two `$0` readings disagree. Guide-taught syntax dependence is **98–100%**
under one classification and 0.7–1.2% under another `[M verify/c09]`."

**What the verifiers say.** `verify/c09-history.md` correction 5: "Falsifier 2 result: literal
reading **33.92% claude-code** (>20% → c09's guide-branch kill fires); wide reading 0.69 / 1.24 /
0.76% (headline false). **Delete the claim that the census 'fires at 98–100%, closing B3'.**"
`verify/c09-mechanism.md` correction 5 says the same and adds: "The headline '98–100%' is the
pre-reclassification number from an instrument that counts documented optional flags as guide
dependence." Both lenses give the same two admissible readings: literal 33.92 / 13.92 / 11.42%
(claude-code / codex / opencode) and wide 0.69 / 1.24 / 0.76% `[carried M guidesyntax.py,
guidesyntax_repaired.py]`.

**Why it matters.** §8 is the decision text. The reading the uber omits, 33.92% on claude-code, is
the one that fires the pre-registered 20% kill line for `research/agent-efficiency-2026.md` seed
S1 (the harness-conditional guide). Reporting a withdrawn 98–100% next to 0.7–1.2% makes the two
readings look like a measurement disagreement of two orders of magnitude, when the honest spread
is 0.7% to 33.9% and one end is decision-relevant.

**Fix.** Replace the numbers in §8 item 2 with the two admissible readings and their per-harness
values. State that the literal reading fires S1's 20% kill line on claude-code and the wide
reading misses it by 16–29×. Remove the "98–100%" figure from the document.

---

### M8. Two of the five survivors get no register row, and three register corrections were requested and not made

**Where.** `SLATE-C-UBER.md` §4.6.

§4.6 files §4.3 under "E1/E2". It files nothing for §4.4 (`ss-grep` false-zero paths and the
`ss-find` line-span crash) and nothing for §4.5 (worktree-aware `ss-*`). A grep of §4.6 for
"worktree", "pathSegments" and "alternation" returns zero hits `[M]`.

Three explicit filing instructions were not carried out:

1. `verify/c03-measurability.md` correction 11: "Re-file the candidate. Book it under **register
   E2 as a new hygiene item priced at 0% benchmark value**, alongside E2's own precedent (0.99%,
   under one task, correctness only). Book the `.claude/worktrees/` index-admissibility question
   separately under **E15**." `[carried]`
2. `candidates/DEDUP.md` §7 item 1: "`ss-batch` is not in `files` … **Register §0.2 should note
   this.**" `[carried C, `npm pack --dry-run`]`
3. `verify/c12-measurability.md` §3 item 2: the same request, with the reason: "A2 records
   `ss-batch` as deployed and called zero times, which is a weaker version of the same fact."
   `[carried]`

**Why it matters.** The register is the only artefact that stops a future session re-proposing a
mechanism. Register §0.2 is the code fact the register says "bounds eight rows"; it currently
lists `ss-batch` as part of the shipped tool surface, and a real install never receives it.

**Fix.** Add three §4.6 rows: an E2 hygiene row for §4.4's grep and find paths; an E2 hygiene row
plus an E15 index-admission row for §4.5; a §0.2 correction stating that `ss-batch` ships in
neither `bin` nor `files`.

---

### M9. §4.5 asserts a real-user harm that §5.1 says cannot happen, and drops three refuter corrections

**Where.** `SLATE-C-UBER.md` §4.5 against §5.1 row c12.

§4.5 states: "Real user: all of sweet's value is lost in a worktree session." §5.1 c12 states the
wrappers "are bench instrumentation" and that "`$DIR` uses `BASH_SOURCE` without `readlink`, so
an npm symlink breaks all six". `verify/c12-measurability.md` and `candidates/DEDUP.md` §7 both
record that `package.json` has no `bin` entry for the six commands `[carried C]`. A real user
therefore has no `ss-*` on PATH unless they added it, so the worktree failure reaches an
unmeasured population, not every user.

`verify/c03-measurability.md` asked for exactly this qualifier (correction 10) and for two more
that were not adopted:

- Correction 9: "Delete the unsourced real-user figure. '**up to 54% of a claude-code cell
  wasted**' appears in no evidence I could open." The uber's qualitative "all of sweet's value is
  lost" is the same claim without the number.
- Correction 3: "State that the effect is unpriced. **All five target rollouts carry
  `costRealizedUsd = null` and `sidechainAccountingComplete = false`; they contribute $0.00 of the
  $0.86226 the claude-code sweet cell priced.**" §4.5 gives a 1.3–2.0% ceiling with no such
  disclosure.
- Correction 7: the code citation is `_ss-helpers.mjs` **136-147** (PROJECT_ROOT at 138, `exit(2)`
  at 145), not 138-146. The uber still cites 138-146 in §4.5 and in Appendix A.

**Fix.** Add the PATH condition to the real-user sentence. Add the "$0.00 of the priced cell"
disclosure beside the ceiling. Correct the line citation in §4.5 and in Appendix A.

---

### M10. The published claude-code −3.9% is not reproduced anywhere, and the gap is not in §7

**Where.** `SLATE-C-UBER.md` §0.1 claude-code row, §0.2 prose and table, §7.

§0.2 says "The published −3.9% is the 'dearest-3' convention", then its own dearest-3 row for the
same ledger reads **−3.31%**. Two documents record why the two do not meet, and neither statement
reaches §7:

- `verify/c14-mechanism.md` §7: "A native $0.021558 reproduction: my dearest-3 inclusive lower
  bound is **$0.021437 (−0.6%)**, probably a different measured-sidechain set in the runner;
  sweet's $0.020727 reproduces exactly." `[carried M]`
- `research/structured-vs-shell-parallelism.md` §9: "`rows.json` for `fp-claudecode-tab-20260826`
  gives `costRealizedUsd` **$0.005853 native / $0.013065 sweet** with `costSidechainUsd` zero,
  against the BRIEF's $0.021558 / $0.020727. I used the BRIEF's figures and flagged the gap; **I
  did not find the accounting path that produces them.**" `[carried M]`

**Why it matters.** §0.2 is the section that argues the claude-code result is an artefact, and
§4.1's first work item is to repair claude-code disclosures. Both rest on a cell nobody in this
slate could rebuild from the run's own rows. Calling −3.9% and −3.31% the same convention hides
that.

**Fix.** Add one §7 item: "the published claude-code cell is not reproducible from `rows.json`;
two independent attempts land at −0.6% on native and at a different sidechain basis". Stop
describing −3.9% as the dearest-3 figure until the accounting path is found, or state the −0.6%
reproduction gap where the two numbers are used together.

---

## 3. Minor

### m11. §0.3 gives the wrong task count for claude-code

§0.3: "On the **twelve** tasks both arms solve 3 of 3 … `[M forensics/phase-anatomy.md §2,
72/72/66 rollouts]`". `phase-anatomy.md` §2.3 is headed "claude-code main thread (**11 tasks**, 33
native and 33 sweet rollouts)" `[carried M]`. The rollout denominator 66 already implies 11 tasks;
the prose does not. **Fix:** "twelve tasks on codex and opencode, eleven on claude-code".

### m12. The codex cost cell reasons from a threshold it does not meet

§0.1's codex row justifies "no" with "none; every surviving item is under 0.5% hygiene", against a
required cut of 0.35% of the sweet cell. An item under 0.5% can exceed 0.35%. §4.3 itself prices
the codex bundle hunt at +$0.000059 per pooled rollout, larger than the $0.000043 gap `[carried
M]`; §4.3 books it at zero for a separate and good reason ("an honest note invites a probe"). The
codex verdict is still correct, because the solve column needs +2 of 66. **Fix:** strike the cost
non-sequitur and rest the codex row on solves.

### m13. The `promptCacheTtl` product item is retired on the argument its refuter corrected

§4.1: "The one-hour TTL applies only inside a subscription's included usage, where **no per-token
bill exists** `[W]`." `verify/c14-history.md` correction 8: "For the rider, say '**plan-usage
consumption**', not 'bill'. Its named beneficiary is a subscription user within plan usage, who is
metered against limits rather than invoiced per token." `verify/c14-mechanism.md` §7 lists
"Whether a subscription's included usage is depleted faster by 1-hour writes" as unfinished
`[carried]`. `research/anthropic-model-product-path.md` C-A5 self-labels "Not a slate lever", so
it was never a lever; it is a zero-build documentation item worth 16.0% of a real user's
claude-code main-thread consumption `[carried I]`. §0.2 also omits c14-mechanism's two
subscription-path rows (row-matched −0.34%, dearest-3 +4.12%). **Fix:** restore C-A5 as an
arm-universal product-documentation note with an explicit zero bench claim, or record the
plan-allowance question in §7 as unresolved.

### m14. A product defect both c09 lenses say survives is filed nowhere

`verify/c09-history.md` §7: "**New finding, not in c09 and not in the register:** the guide
documents an `ss-trace` mode word the wrapper silently ignores `[C guide:32 vs TRACE_USAGE 939 /
cmdTrace 954]`; **27 operations in the pool used it.** Either implement it or delete it from the
guide." `verify/c09-mechanism.md` item 9 repeats it. It appears in no §4 item and no §4.6 row `[M
grep of SLATE-C-UBER.md for "mode word"]`. **Fix:** add it to §4.4 or as its own E2-class register
row.

### m15. Repository-size stratification was seeded with a `$0` falsifier and never dispositioned

`research/agent-efficiency-2026.md` §8 S4 proposes recruiting a pool that represents repositories
above 1,000 tracked files, flags `needs_user_decision: true`, and gives a `$0` falsifier: "Count
candidate SWE-rebench repositories above 1,000 tracked files. **Kill if fewer than 30 exist.**"
`[carried]` It is absent from §5.3, from §6, and from §8. §8 item 8 asks a different question
(screening for multi-file reference patches). §7 item 15 notes the fact ("2 of 21 repositories
reach 1,000 files") but takes no decision. **Fix:** add the repository-size screen to §8 item 8 as
a second axis and put S4's count in §6 as a `$0` step.

### m16. §4.2's register filing names the wrong vehicle row, and its stop rule cannot fire once it ships

§4.2 says "File next to register G13 and G20". `verify/c15-measurability.md` correction 6 says
"correction and extension of **G13**, using the vehicle of **G11**" — G11 is the shipped
`task-blocklist.json` plus `run-pilot.mjs` admission path; G20 is the unrelated preflight-gate row
`[carried C]`. Separately, §6's stop rule "abort if the trustworthy-verdict census flags more than
4 of 27 tasks" is unreachable once §4.2's filter removes the flagged tasks at admission. **Fix:**
correct the row reference and re-word the stop rule to run the census before the filter.

### m17. The "7–10% sweet must earn back" figure sums three envelopes, one of which is not removable

§0.1: "sweet carries fixed sweet-only terms of about 7–10% of a rollout: the guide (2.6–4.5%), the
gutter (2.0–3.7%), and requests after failed `ss-*` calls (at most about 2%) `[M BRIEF.md §1.1]`".
Register E2 records the third term as "**an upper envelope, not removable spend**" and notes "the
review panel explicitly rejected the zero-behavioural-risk framing" `[carried M]`. §4.7 forbids
summing ceilings but the rule is not applied to this line, which is carried from the brief.
**Fix:** print the three terms separately, or label the sum an upper envelope and cite E2's
qualifier next to it.

### m18. §4.2 mixes two denominators in one sentence

"Removing accenture moves native 125/198 → 120/189 and sweet 115/195 → 111/187 (raw fp rows)".
Native's 125/198 is the canonical brief figure; sweet's 115/195 is the raw fresh-pool count before
the opencode repair pass is substituted, where the canonical sweet figure is 120/198 `[carried M
BRIEF.md §1]`. The "(raw fp rows)" tag sits at the end and reads as covering only the sweet pair.
**Fix:** give both arms on one basis, or state both bases explicitly.

### m19. One tag overstates what was measured

§0.3: "72 (53%) are locked by hidden tests `[M forensics/wrongfix-facts.md §3]`". The source
derives that class correctly and by inference — from the solve matrix, the base tree, the issue
text and the agents' own patches — and records that "Gold and hidden-test fields were counted,
never read into this report" `[carried]`. The class name is an inference about content nobody
read, which is the rule-compliant way to do it, but the tag should say so. **Fix:** tag it `[I on
M]` and keep the source's sentence about how it was derived.

---

## 4. Checks that came back clean

Recorded so nobody re-runs them.

1. **No HO2 access.** Every slate document states HO2 was never opened per task. Every run named
   in the uber, the forensics and the verifications is a DEV pool (`fp-*`, `rp-*`, `rb-*`,
   `sb-*`, `fixval-*`, `gab-*`, `bd-*`) `[M grep for `ho2`/`HELDOUT` across `slate-c/`: no
   per-task read]`.
2. **No hidden test name and no reference-patch content.** `forensics/wrongfix-facts.md` §1 states
   the discipline and every per-task card describes the missing fact as a class. Spot-checked
   cards §2.1 and §2.2: both derive from `test/preflight.test.js` line numbers in the base tree
   and a `README.md` line, which are base-tree artefacts, not gold `[M read]`.
3. **The no-summing rule is stated and honoured in §4.7**, which names the three overlapping
   populations and the 87 subagent `Read` calls that c03 and c08 both claimed. The only
   unqualified sum I found is m17, which is carried from the brief.
4. **Vehicle labelling.** Every §4 survivor states its vehicle and whether it is sweet-only, and
   the two shared items (§4.1, §4.2) declare zero differential and say the `pages` fix lowers
   native's cost. No shared vehicle is claimed as a sweet win.
5. **Candidate-to-register duplication is declared.** §5.1 names the nearest register row for all
   fifteen kills (c02 = A4, c11 = C9 on a second harness, c05 = B9b, c15 = G13/G11, c01 = B17's
   class, c08 = B18, and so on). The gap is on the survivor side, not the kill side (M8).
6. **Per-harness arithmetic in §0.1 reproduces.** Codex cut $0.000043 = 0.349% of 0.012330;
   opencode $0.000297 = 3.206% of 0.009265; claude-code (0.020727 − 0.021558) / 0.021558 = −3.855%;
   solve deltas +2, 0, +3 of 66 `[I on M BRIEF.md §1]`. The §1 fact 2 figure also reproduces:
   (23.79 − 25.74) / 25.74 = −7.58% `[I]`. The plan-tool ranges in §1 fact 6 match
   `verify-tail.md` §5 exactly `[M]`.
7. **The `Explore` count conflict is handled correctly.** §7 item 9 names both counts, adopts the
   forensics count, and forbids citing 60/12. That is the right treatment.

---

## 5. What I could not finish

- I read the verdict and the "corrections the synthesis must adopt" section of each of the 45
  verify files, plus the full text of c02, c03, c07, c09, c12, c14 and c15 where a conflict
  appeared. I did not read c01, c04, c05, c06, c08, c10, c11 and c13 end to end, so a further
  unadopted correction may sit in one of them.
- I did not open the evidence box. Every `[M]` above is either arithmetic I did here on figures the
  slate documents publish, a grep of the local slate tree, or a `[carried]` number with its
  source's own tag and script name.
- I did not re-derive any forensics measurement. Where two slate documents disagree I report the
  disagreement and name both sources; I did not adjudicate the c02 ceiling, the claude-code cell
  reproduction, or the guide-dependence classification myself.
- I did not check the six candidate lens reports (`candidates/*.md`) for seeds that never reached
  `DEDUP.md`'s R1–R27 list, because that list is stated to be the workflow's own supplied
  enumeration and its provenance is not written down anywhere I could read. The one seed I found
  missing (M4) came from a forensics report and from a candidate report independently.
