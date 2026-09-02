# c04 adversarial verify — differential and measurability lens

Date: 2026-09-02. Agent: verify/c04-measurability. Spend: `$0`. Local file reads, local code
reads and arithmetic only. I did not open the evidence box, HO2, any `ho2-*` run, or any
grading log. No hidden test name and no reference-patch content appears here. I edited no
product code and no bench code.

Tags: `[M]` measured, `[C]` read from code, `[I]` inferred, `[W]` web.

---

## 0. Verdict

**REFUTED.** Confidence 0.83.

The candidate fails on four counts. First, its headline yield fact is metric-selected and
reverses inside the same published table: on the solved-everywhere slice, sweet's post-edit
probes precede a later edit 43 of 73 times (58.9%) and native's 20 of 34 times (58.8%) `[M
cited phase-anatomy §6.1]`. The "zero measured yield" claim survives only if a re-edit counts
as no yield. Second, the deletion fails a **shipped gate script** the candidate never names:
`eval/task-completion-bench/tests/tooldoc-trim-gate.mjs` asserts that no `ss-*` tool loses its
signature line (line 62 targets `ss-semantic` by name) and that all 30 inventoried behavioural
rules survive; c04 removes the `ss-semantic` signature and drops four inventoried rules `[C]`.
The gate's own comment states the rule: "A dropped rule is a product change, not a trim."
Third, the subagent sentence's cost is overstated by roughly 70×: the +1,516 tokens is the
whole guide reaching a general-purpose subagent through project rules, not the sentence `[M
cited claude-subagents §2.2]`. Fourth, the `ss-batch` component has an exactly zero ceiling
(0 calls of 3,064 `[M]`, absent from the guide `[C]`, absent from npm `files` `[C]`).

The candidate is also mis-scoped on the owner question. The three passages sit at guide lines
24, 27/31/43 and 54, all inside the **tool-docs half** that the owner authorised for gating on
2026-08-10. The protected guidance block is `## Fix discipline`, guide lines 55–64, 778 bytes
`[C, byte-exact match to `PREAMBLE-TRIM-GATE.md`'s composition table]`. c04 does not touch it.
So `needs_user_decision` is right, but for a different reason than the candidate gives.

There is a small arithmetic survivor: the token deletion itself is real and larger than
claimed (about 130–155 tokens, not 95). It is worth −0.3% to −0.6% of a sweet cell. That is
the same order as the 0.21% ceiling the PREAMBLE-TRIM gate already rejected as undetectable,
and it fails the same gate. It does not earn survivor status.

---

## 1. Rule compliance (no hard violation found)

| rule | check | result |
|---|---|---|
| HO2 never per-task | candidate cites `fp-*` fresh-pool rollouts only | pass |
| No gold, hidden tests, or task identity as runtime input | guide text only | pass |
| Ranking signals gated on `_isAgentFormat` | c04 touches no ranking signal | not applicable |
| Owner decision flagged | `needs_user_decision: Yes` present | pass, but the stated basis is wrong (§4) |
| No new tool | `new_tool: false`; c04 removes surface | pass |
| Sweet-only vehicle | `[C codex-task-runner.mjs:474]` `instructions = FRAME_OPEN + (sweet ? mppText : '') + FRAME_CLOSE`; `[C agent-runner-shared.mjs:138]` `pathDirs = [binDir, sweet ? ssBinDir : null]` | pass |
| Not the banned compaction class | c04 deletes lines, it does not re-render them smaller | pass |

I refute on evidence and measurability, not on a hard rule.

---

## 2. Differential: real for the guide, zero for `ss-batch`

The guide reaches only the sweet arm on all three harnesses `[C]`. The `ss-*` bin directory is
on the sweet arm's PATH only `[C]`. Both halves therefore have head-to-head differential in
principle.

The `ss-batch` half has **zero measurable differential in practice**:

- 0 calls in 3,064 sweet `ss-*` operations over 198 rollouts `[M guidesyntax.py, via the
  candidate]`, matching register A2's independent "called 0 times in 198 opencode rollouts".
- `ss-batch` is not in the guide `[C]` — the candidate says so itself — so it costs no prefix
  tokens.
- `ss-batch` is not in `package.json` `files` `[C]`; `ss-search`, `ss-find`, `ss-grep`,
  `ss-semantic`, `ss-trace` and `ss-read` are. It never reaches a real user.

A tool that is never called and never described costs exactly $0. Removing it saves exactly
$0. The candidate's own build-cost line ("one PATH line") is also wrong: the harness puts the
**whole directory** on PATH `[C agent-runner-shared.mjs:138]`, so removal means moving or
deleting the file, which is a bench-code change with a zero ceiling.

**Correction: drop the `ss-batch` component from c04 entirely, or reclassify it as hygiene
with a stated $0 ceiling. It must not appear in any ceiling arithmetic.**

---

## 3. The evidence does not support "zero measured yield"

### 3.1 The yield metric reverses on the same table

`phase-anatomy §6.1` publishes three outcome columns per cell, not one `[M
postedit-search-yield.py, cited]`:

| cell (solved-everywhere) | probes/rollout | new-file edit | re-edit | no further edit | any later edit |
|---|---:|---:|---:|---:|---:|
| claude-code native | 1.03 | 5 | 15 | 14 of 34 | **20 of 34 = 58.8%** |
| claude-code sweet | 2.21 | **0** | **43** | 30 of 73 | **43 of 73 = 58.9%** |

The candidate quotes only the first outcome column. On the "did any later edit follow" metric
the two arms are indistinguishable to one tenth of a point. The excess is **volume** (2.21
against 1.03 probes) and not **yield per probe**.

Either reading hurts the candidate. If the 43 re-edits are genuine patch changes, the probes
are not "pure cost" and deleting the rule that supposedly causes them risks the patch. If the
43 re-edits are failed-edit repair loops — plausible, since W0-P7 put claude sweet's
failed-edit turns at 13.4% of the arm `[M cited BRIEF §1.1]` — then their cause is anchor
failure, not the mapping paragraph, and the deletion removes none of them.

**Correction: the synthesis must state the yield fact as "sweet makes 2.1× native's post-edit
probes at native's per-probe edit-yield rate (58.9% against 58.8% on the solved-everywhere
slice)", not as "zero yield".**

### 3.2 The causal attribution is inferred, and the source says so

`phase-anatomy §6.1` ends: "The guide's rules that plausibly drive the shape are [three rules
quoted] … **Which rule the model is following is inferred, not read `[I]`**." `phase-anatomy
§9` adds: "the claude-code system prompt is not persisted, so which guide sentence drives the
post-edit probe chain is inferred from the guide text, not read from the run."

Three named candidate drivers exist. c04 deletes two of them (both on line 54). The third —
"When your change alters a public contract, re-read the task's exact wording before
finalizing", guide line 63 `[C]` — sits inside `## Fix discipline`, which c04 leaves in place
and which the owner protects. So even at full compliance the deletion addresses at most two of
three named drivers.

A second, independent check on the same slot: `wrongfix-facts §…` records that sibling
consistency "appears once as a necessary-but-insufficient fact" and that "no cell acted on the
sibling pattern that was one directory away" `[M cited]`. If no cell acted on siblings, the
sibling rule is producing few sibling actions, which weakens the claim that it produces 87
probes.

### 3.3 The subagent sentence's cost is overstated by about 70×

The candidate writes "+1,516 uncached tokens where it fires". The source says the opposite
`[M cited claude-subagents §2.2]`: "The general-purpose subagent's +1,516 is **the same
guide**, delivered through the project rules file." Deleting the ~22-token sentence leaves the
other ~1,435 tokens reaching general-purpose subagents unchanged.

The source's own measured statement about obedience is also different from the candidate's.
`claude-subagents §2.1`: the sentence "was therefore **half-obeyed 27 of 27 times** (26
prompts mention `ss-*`, 1 does not) and **fully obeyed 0 of 27 times**." I could not find
"21 of 27" anywhere in the source.

**Correction: the subagent-sentence removal is worth about 22 tokens, roughly $0.000006 per
rollout, about 0.04% of a sweet cell. Cite "fully obeyed 0 of 27, half-obeyed 27 of 27", not
"unobeyable in 21/27", and never attribute +1,516 tokens to it.**

### 3.4 The `ss-semantic` floor is double-booked and partly already banked

The 7 `[FALLBACK]` calls are the candidate's only provable waste. `phase-anatomy §6.5` gives
their files: `dist/index.js` (5 calls), `src/build/targets.py` (1), `src/build/property.jam`
(1) `[M]`. Two of the three files are re-admitted by the already-shipped index fix — 36b802e
"index Jam files + re-admit git-tracked source under build-output dirs" `[C git log]`. So 2 of
7 fallbacks are already gone, leaving 5.

Those 5 are the same 5 that `phase-anatomy` seed S3 and slate-C candidate C3 (absence honesty)
claim, by printing a "not indexed" note on the `ss-semantic` fallback path. Booking them under
c04 as well double-counts.

The upper bound is disclaimed by its own source. `inversion-and-removal.md §B3`: "The truth is
near the floor, because the substitute is usually one `ss-read` and one request either way."
Quoting "upper −2.1%" as a ceiling contradicts the report it comes from.

An unpriced counter-mechanism runs the other way. Removing `ss-semantic` from the guide pushes
the agent to `ss-read`, and `ss-read` on an excluded large file delivered **13,396 tokens in
one call** `[M cited phase-anatomy §6.5]` — about $0.0035 on codex at the measured
ingest-plus-re-send rate, or 28% of a codex rollout `[I]`. One such substitution per about 30
rollouts erases the whole claimed saving.

**Correction: state the `ss-semantic` ceiling as −$0.0000093 floor (5 remaining fallbacks,
−0.08% of the codex cell), flag it as claimed by C3 first, drop the −2.1% upper bound, and add
the whole-file `ss-read` substitution as an unpriced cost-positive risk.**

---

## 4. The register check is wrong on the owner decision and misses the binding gate

### 4.1 The guidance block is not touched

`PREAMBLE-TRIM-GATE.md` records the 2026-08-10 authorisation verbatim: "Tool docs (lower risk)
— gated here … **Guidance block** (`## Fix discipline`, the general M±) — **NOT trimmed.**"
Its composition table gives the split: tool docs 5,272 bytes, `## Fix discipline` 778 bytes.

I reproduced the split byte-exactly `[C, `wc -c` on the production guide]`: guide lines 20–54 =
5,271 bytes; lines 55–64 = 778 bytes. Every c04 passage (lines 24, 27, 31, 43, 54) is in the
tool-docs half.

**Correction: c04 does not reopen the owner-protected guidance block. Delete that claim.
`needs_user_decision` stays true for two other reasons: `ss-semantic` is in npm `files` `[C]`
so retiring it narrows a shipped contract, and the gate below says a dropped rule is a product
change.**

### 4.2 c04 fails a shipped gate script it never names

`eval/task-completion-bench/tests/tooldoc-trim-gate.mjs` exists and encodes five assertions
`[C]`. Two of them c04 fails by construction:

- Assertion 3, product shape. Line 62: `{ name: 'ss-semantic', sig: /^- \`ss-semantic <file>
  "<query>"\`/m, example: … }`. c04 deletes exactly that line.
- Assertion 4, the 30-rule behavioural inventory. Four of the 30 named rules are the text c04
  deletes: `'sub-agents inherit this prompt verbatim'`, `'siblings -> ONE mapping call before
  editing'`, `'read the edited function to its end'`, `'single-site edits skip the mapping
  call'` `[C lines 82–111]`. The file's own comment: "**A dropped rule is a product change,
  not a trim.**"

The gate document went further and pre-registered the evidence bar for exactly this move:
"Realising a material share of the 4.1% would mean **deleting rules**, not rewording them …
It would need evidence of a different kind: **proof that specific rules do not change
behaviour, which is a per-rule ablation programme, not a trim.**"

c04 supplies a yield census (refuted in §3.1), an inferred attribution (§3.2) and a
solve prediction borrowed from P1. It does not supply a per-rule ablation.

The final register's B2 row also names the vehicle: revival is "only via the prompt-optimization
process with a length term". c04 proposes a hand edit. The guide file is a frozen
prompt-optimization artefact carrying its own scores in frontmatter (`score_sonnet 0.993`,
`joint_maximin 0.988`, `homp_family_pass`, `ood_pass`, `vault_maximin 0.963`) `[C]`. A hand
deletion invalidates that provenance and the candidate's build cost does not include a
re-score.

**Correction: the nearest register row is not "B2, different because it deletes content". It
is "B2 plus the PREAMBLE-TRIM gate's rule-deletion clause, whose pre-registered evidence bar is
a per-rule ablation programme, plus the shipped gate script that this change fails at
assertions 3 and 4."**

---

## 5. Measurability: the effect cannot be demonstrated on this bench

### 5.1 The token half, re-measured

The candidate says "~95 of 1,457 tokens". I measured the passages `[C, `wc -c`]`:

| passage | bytes |
|---|---:|
| line 54, sibling mapping paragraph | 350 |
| line 24, subagent-verbatim sentence | 92 |
| line 31, `ss-semantic` bullet | 89 |
| line 27, `ss-semantic` clause | 56 |
| line 43, `ss-semantic` clause | 56 |
| total | 643 |

The guide body is 6,049 bytes for 1,457 tokens `[C + BRIEF §1]`, i.e. 4.15 bytes per token.
643 bytes is about 155 tokens. Lines 27 and 43 need a rewrite rather than a clean cut, so the
net removal is about **130 to 155 tokens**, not 95 `[I on M]`.

Priced against the guide's own $0.00042–$0.00051 per rollout, the deletion is
**$0.000038–$0.000054 per rollout**: −0.31% to −0.44% on the codex sweet cell, −0.41% to
−0.58% on opencode, −0.23% to −0.33% on claude-code main. This is 1.4× to 1.9× the candidate's
figure, so the correction favours the candidate on size.

### 5.2 And it is still an order of magnitude below the detection floor

Register B2 and `PREAMBLE-TRIM-GATE.md` already ran this comparison and reached a verdict: a
0.07% net and a 0.21% ceiling are "two orders of magnitude below the ±37% noise floor" and
"**no live smoke can measure a 0.07% (or even 0.21%) cost change on this bench. Running one
would buy noise.**" c04's token half at 0.31–0.58% is the same class of number against the
same floor.

The fresh-pool bootstrap intervals confirm it independently `[M gutter_cost3.py, cited in
inversion-and-removal §1]`: the 95% interval on the sweet-minus-native cost gap is
codex [−11.5%, +13.2%], opencode [−8.1%, +17.0%], claude-code main [−19.6%, +26.9%]. c04's
largest claimed effect is −3.3% on claude-code; its typical effect is −0.3%. Every one sits
between 4× and 80× inside the interval half-width.

Solves are worse. The pre-registered bar is ±6 rollouts of 66 `[BRIEF §1]`. c04 predicts flat
and measures nothing. Under "solve is the veto" the candidate offers an unmeasurable saving
against an unmeasurable risk.

The token half is nonetheless **arithmetic, not statistical**: N tokens removed from a constant
prefix removes exactly N × (0.10 + R × 0.01) / 10⁶ dollars, with R the measured re-send count.
That identity holds only if the request count does not move. Since the change deletes
instructions, the request count is exactly what cannot be assumed constant. So the one half
that is certain is certain only under the assumption the other half denies.

---

## 6. The `$0` falsifier is not pre-registrable as written

Three defects.

1. **It has already fired on two of three harnesses, and the scope was then narrowed to fit.**
   Measured: claude 0 of 87 (0.0%), codex 25 of 56 (44.6%), opencode 20 of 37 (54.1%) against a
   >10% kill line `[M cited phase-anatomy §6.1]`. The candidate then restricts the behavioural
   half to claude-code. That is post-hoc scoping, not pre-registration.
2. **On the surviving harness it has no discriminating power.** claude-code reads 0.0% against
   a >10% kill line, so the falsifier cannot fail for the thing that would actually ship. A
   falsifier that cannot fire is not a falsifier.
3. **It tests yield, not the mechanism.** Nothing in it links the probes to the mapping
   paragraph, which §3.2 shows is inferred.

A fourth defect covers the second half: falsifier (2) — "is the next `ss-*` call an `ss-read`
of the same file inside the returned span?" — carries **no number**, while the stated
`kill_condition` (">30% of its calls are the last retrieval before an edit of that file")
measures a **different quantity**. The `ss-semantic` half therefore has no runnable
pre-registration.

The candidate also drops a kill condition its own source registered. `phase-anatomy` seed S1
pre-registers, for a live smoke: "post-edit search+read requests per sweet claude-code rollout
not reduced by at least 40%, **or** solved count outside the ±6 bar on 66 rollouts, **or the
removed probes replaced one-for-one by `git diff` or text requests**." The substitution clause
is the one that matters, because `phase-anatomy §6.1` records native doing the same diligence
with `grep -RIn … | head -30` and `Read .eslintrc`. If the diligence is a model habit rather
than a guide artefact, removing the sentence relocates the probes and saves nothing.

**Correction: adopt S1's three-part kill condition verbatim, add a substitution counter for
`git diff` / raw shell / text requests, give falsifier (2) a threshold, and stop calling the
already-fired yield census a pre-registered falsifier for the claude-code half.**

---

## 7. Revised ceiling the synthesis should carry

| component | honest ceiling | status |
|---|---|---|
| Guide-token deletion, all three harnesses | −$0.000038 to −$0.000054 per rollout: −0.31% to −0.44% codex, −0.41% to −0.58% opencode, −0.23% to −0.33% claude-code main `[I on C]` | arithmetic; fails `tooldoc-trim-gate.mjs` assertions 3 and 4; below the detection floor register B2 already used to drop a 0.21% ceiling |
| claude-code behaviour, mapping paragraph | $0 to −$0.000533 (0% to −3.3%), **no lower bound above zero** | attribution `[I]`; yield claim refuted; one of three named drivers survives; substitution unpriced |
| Subagent-verbatim sentence | about 22 tokens, ≈$0.000006 per rollout, ≈0.04% | the +1,516 figure is the whole guide, not the sentence |
| `ss-semantic` retirement | floor −$0.0000093 (−0.08% codex); upper bound disclaimed by its source | 5 of 7 fallbacks remain after E1; already claimed by C3/S3; whole-file `ss-read` substitution is cost-positive |
| `ss-batch` off PATH | **exactly $0** | 0 calls of 3,064; not in the guide; not in npm `files` |

Composite: **−0.3% to −0.6% per harness, arithmetic only, undetectable at n=66; the behavioural
half is unestablished; two components are zero or double-booked.** Against a codex gap of
+0.35% the token half is a point-estimate cover of about 1.0× to 1.3×, inside an interval of
[−11.5%, +13.2%]. Against an opencode gap of +3.31% it covers about one seventh.

---

## 8. If the synthesis keeps any part of c04

Keep the smallest, cleanest fragment and re-label it:

- Keep the two `ss-semantic` **prose** mentions (lines 27 and 43) as a candidate. The shipped
  trim1 variant already removed the line-27 clause and **passed** the gate, because the bullet
  survived `[C, diff of `p7-turnfix-variants/sweet-search-system-prompt.trim1-tooldocs.md`]`.
  That fragment is gate-clean, about 30 net tokens, and needs no owner decision.
- Drop the `ss-semantic` bullet deletion, the `ss-batch` PATH change, and the +1,516-token
  attribution.
- Route the line-54 and line-24 deletions to the vehicle the register names: the
  prompt-optimization process with a length term, plus the per-rule ablation the PREAMBLE-TRIM
  gate pre-registered. Do not ship them as a hand edit.

---

## 9. What I could not finish

- I did not re-run `postedit-search-yield.py`. The re-edit column exists in the published table
  only for the solved-everywhere slice (73 sweet probes, 34 native). The candidate's headline
  uses the all-22-tasks slice (87 and 83), for which the re-edit column is not published. The
  parity check in §3.1 therefore holds on the solved-everywhere slice and needs one box re-run
  to confirm on the headline slice. That re-run is `$0` and is the single most valuable follow-up.
- I did not tokenize with a real tokenizer. Token counts are byte-scaled at the guide's own
  measured 6,049 bytes ↔ 1,457 tokens.
- I did not verify the candidate's "21 of 27 delegations" figure; it does not appear in
  `claude-subagents.md`, whose measured statement is 0 of 27 fully obeyed.
- I did not reconcile the two `ss-semantic` call totals: `phase-anatomy §6.5` says 58 calls in
  198 sweet rollouts, `guidesyntax.py` says 59. The discrepancy does not change any conclusion.
- I did not open the evidence box, HO2, or any grading log.

---

## 10. Evidence opened

**Local documents:**
`eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`;
`.../slate-c/DEAD-LEVER-REGISTER-DRAFT.md`;
`.../slate-c/candidates/inversion-and-removal.md`;
`.../slate-c/candidates/DEDUP.md`;
`.../slate-c/forensics/phase-anatomy.md` (§6.1, §6.5, §9, seed S1, seed S3);
`.../slate-c/forensics/claude-subagents.md` (§0, §1.1, §2.1, §2.2, §5);
`.../slate-c/forensics/verify-tail.md` (§ plan-tool table);
`.../slate-c/forensics/wrongfix-facts.md` (sibling-consistency lines);
`.../slate-c/register/DEAD-LEVER-REGISTER.md` (rows A2, B2, B9, E4, E8, F15, P1);
`eval/task-completion-bench/handoffs/lever3-eviction/PREAMBLE-TRIM-GATE.md`.

**Local code `[C]`:**
`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` (64 lines; body 6,049
bytes; lines 20–54 = 5,271 bytes; lines 55–64 = 778 bytes);
`core/prompt-optimization/data/p7-turnfix-variants/sweet-search-system-prompt.trim1-tooldocs.md`;
`eval/task-completion-bench/tests/tooldoc-trim-gate.mjs` (lines 58–67 TOOLS, 82–111 RULES,
124–128 Fix-discipline assertion);
`eval/task-completion-bench/harness/agent-runner-shared.mjs:134-141`;
`eval/task-completion-bench/harness/codex-task-runner.mjs:474, 500`;
`eval/task-completion-bench/harness/claude-code-task-runner.mjs:52-58, 310-316`;
`package.json` `files`; `eval/agent-read-workflows/bin/` listing;
`git log` for 36b802e and fb9f936.

**Rollout ids referenced (not opened; carried from the candidate and phase-anatomy):**
`fp-claudecode-tab-20260826` — `callstack__react-native-paper-972/sweet/rep2` requests 10–21,
25–28, 33–34; `jazzband__tablib-454/sweet/rep1` requests 8–12;
`aws-actions__configure-aws-credentials-42/sweet/rep1` requests 7–21.
`[FALLBACK]` ids: `codex/aws-actions/sweet/rep0,rep1`; `codex/bfgroup__b2-113/sweet/rep1`;
`codex/bfgroup__b2-259/sweet/rep2`; `opencode/aws-actions/sweet/rep0,rep1,rep2`.

**Denominators used:** 3,064 sweet `ss-*` operations over 198 rollouts; 66 rollouts per cell;
73 and 34 post-edit probes (solved-everywhere claude-code); 87 and 83 (all-22 solved);
27 sweet subagents pooled over three gutter forms; 30 rules in the gate inventory.
