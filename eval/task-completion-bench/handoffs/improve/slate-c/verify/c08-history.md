# c08 — adversarial verify, HISTORY lens

**Candidate:** "Put the guide inside claude-code's delegation path with an init-written
project agent definition" (rank 8; family "harness adaptation / subagent inheritance";
merged from R14 and R3 item 2; stated in `candidates/DEDUP.md` c08 and
`candidates/real-user-product.md` RU-2).

**Author:** workflow verify agent, HISTORY lens. Date 2026-09-02.
**Cost of this study: $0.** Trace arithmetic on `rows.json`, a census JSON already in the
repo, static reading of the shipped Claude Code binary, and `git log`. No model call, no
rollout. The evidence box was read only; nothing was written under `results/`. Local
scratch was created at `/private/tmp/.../scratchpad` and not needed.

Tags: `[M]` measured with a named command, `[C]` read from code, `[W]` web with URL,
`[I]` inferred.

---

## 0. Verdict, first

**REFUTED as a ranked cost lever. Confidence 0.85.** Keep it as `E2`-class hygiene, and
only after a different fix ships.

The mechanism is **not** a duplicate of any register row. No row covers config-file
delivery to subagents, `.claude/agents/`, or worktree isolation. But three recorded
killing facts still bite, and the candidate's own numbers do not survive re-measurement.

1. **B18's exposure clause still applies.** B18 died at 3 of 34 sweet claude-code cells,
   8.8%. Re-scored on every measured claude-code run, sweet-arm exposure is **24
   delegating rollouts of 255 = 9.4%** `[M]`. That is the same number. The candidate's
   "38/44 = 86.4% passed" is the `Explore` share of subagent *launches* **pooled across
   both arms** `[M]`. It is a conditional probability given a launch, not exposure to a
   sweet-only lever. The falsifier the candidate calls "Passed" was scored on the wrong
   denominator.
2. **B18's second clause is not addressed at all.** `PANEL-SYNTHESIS.md` line 112 kills the
   lever with two reasons, not one: the segment is off-ledger, **"and a richer brief is
   larger, so the sign is probably positive."** c08 makes every `Explore` context larger by
   1,457 tokens in production and about 2,211 tokens in the bench, which is +26% to +41% on
   a 5.35k-to-8.53k first request `[M]+[C]`. The register holds three independent live
   inversions of exactly this shape: B11, B12/C-4, and E10. `BRIEF.md` §2.2 states the rule
   the candidate's ceiling breaks: a fixed-trajectory estimate "gets the direction of a
   context change right about as often as not and never the size."
3. **Its own kill line is straddled, not cleared.** Re-measured on the sweet `Explore`
   subagents alone, and with the omitted cost terms priced, the net is **1.0% to 1.2% of the
   claude-code sweet arm** `[M]+[I]`, against a stated kill condition of "dilution under 1%
   of arm". The headline **−1.7%** is not the estimate; it is above the top of my range.

Two further facts settle the ranking.

4. **It is worth exactly $0 on codex and opencode** `[M]`, the only two harnesses where
   sweet is measured dearer (+0.3% and +3.3%). It moves the one harness that already reads
   −3.9%. It cannot advance the workflow goal.
5. **In production it is currently negative, not small-positive.** All 44 subagents in the
   primary run ran with `isolation: "worktree"` `[M]`; `sweet-search init` gitignores
   `.sweet-search/` `[C]`; the wrapper hard-exits with "no Sweet Search index" when the
   database is absent `[C]`. A project `Explore.md` written by `init` today hands a subagent
   a guide for tools that exit 2 on the first call.

**Three things in c08 are right and the synthesis must keep them**, stated before the
refutation so they are not lost. Its correction of
`research/anthropic-model-product-path.md` §5.2 is sound. Its vehicle argument — a config
file, not prose — genuinely escapes the instruction-deafness kills A1 and A6. And I closed
its one remaining falsifier at $0, in its favour: a project `Explore.md` **does** override
the built-in on Claude Code 2.1.258 `[C]`.

**The originating study already reached this verdict.**
`forensics/claude-subagents.md` §7 M1 — the study that produced every number c08 cites —
writes: *"treat M1 as hygiene, not a cost lever."* c08 promotes it to a ranked cost lever
with no new measurement.

---

## 1. What I opened

Register and its cited sources:

- `handoffs/improve/slate-c/register/DEAD-LEVER-REGISTER.md` rows **B18** (line 96),
  **F15** (line 179), **E10** (line 147), **B2**, **B3**, **B11**, **B12**, **B16**, **B17**,
  **B19**, **E2**, **G1b** (line 217), **G6** (line 224), and §0.1 owner decisions.
- `handoffs/improve/PANEL-SYNTHESIS.md` lines 35–69 and **line 112** — B18's origin and its
  exact killing sentence.
- `handoffs/improve/FRESH-POOL-RESULTS.md` §2 — the claude-code cost reconstruction.
- `handoffs/improve/slate-c/DEAD-LEVER-REGISTER-DRAFT.md` rows B18-adjacent, F15, E10, E2.
- `handoffs/improve/slate-c/forensics/claude-subagents.md` in full — §0, §1.1, §2.1, §2.2,
  §3, §4, §5, §6.1–6.5, §7 M1–M4, §8 F1–F9, §9, §10, Appendix A.
- `handoffs/improve/slate-c/candidates/DEDUP.md` c08 entry (lines 31, 158–166);
  `candidates/real-user-product.md` RU-2 (lines 33, 175, 338–398);
  `candidates/cost-structural.md` lines 445–511; `research/anthropic-model-product-path.md`
  lines 565–784.

Data I measured myself, listed in §2.

---

## 2. Measurements I made

### 2.1 Exposure, re-scored on the sweet arm only

Command (box, read-only), `node -e` over each run's `rows.json`, counting
`sidechainTurns > 0`:

```
ssh root@167.233.69.121 'cd /root/sweet-search-private/eval/task-completion-bench/results
  && node -e "... rows.filter(r=>r.arm===ARM && (r.sidechainTurns||0)>0) ..."'
```

| run | sweet rollouts | delegating | share |
|---|---:|---:|---:|
| `fp-claudecode-tab-20260826` | 66 | 9 | 13.6% |
| `fp-claudecode-none-20260826` | 66 | 9 | 13.6% |
| `fp-claudecode-pipe-20260826` | 66 | 6 | 9.1% |
| `rb-claudecode-20260824` | 39 | **0** | 0.0% |
| `fixval-claude-code-20260828` | 18 | **0** | 0.0% |
| **total** | **255** | **24** | **9.4%** |

`[M]`. Two of the five runs, 57 sweet rollouts or 22% of the measured corpus, carry **zero**
exposure. B18 was killed at 8.8%. The re-score gives 9.4%. **B18's exposure clause is not
escaped; it is confirmed.**

The candidate's 38/44 is arithmetically correct and irrelevant. From
`forensics/scripts-claude-subagents/data/census-fp-claudecode-tab-20260826.json`, the
44 subagent records split **native `Explore` 30, native general-purpose 3, sweet `Explore`
8, sweet general-purpose 3** `[M]`. So 38 of 44 is 30 native plus 8 sweet. A sweet-only
lever reaches the 8.

### 2.2 The ledger still refuses to price the rollouts the lever touches

Every delegating row in the primary run is null in every cost column `[M]`:

```
SWEET  n=66 delegating=9  nullCostRealized=9  delegating_and_null=9  sidechainAccountingComplete false=9
NATIVE n=66 delegating=28 nullCostRealized=28 delegating_and_null=28 sidechainAccountingComplete false=28
```

Per-row, sweet: `costRealizedUsd=null`, `costSidechainUsd=null`, `idealCostUsd=null`,
`breakPricedCostUsd=null`, `sidechainAccountingComplete=false` for
`asynkron__protoactor-dotnet-1909` r1, `awslabs__aws-embedded-metrics-node-21` r0 and r2,
`bfgroup__b2-113` r1 and r2, `bfgroup__b2-259` r0 and r1, `fastify__fastify-cors-285` r0,
`final-form__final-form-64` r2 `[M]`.

**Partial escape, and the candidate must state it as partial.** The published −3.9% headline
is **not** the ledger. `FRESH-POOL-RESULTS.md` §2 rebuilds it by hand: sweet main $1.182496
plus sidechain $0.185518 = $1.368014, and native $1.130494 plus $0.292341 = $1.422835 `[M]`.
So the sidechain **is** inside the published number today. B18's off-ledger clause is escaped
for one hand-built table, and for nothing else. Any future automated comparison reads
`rows.json`, which nulls exactly the rollouts this lever changes.

### 2.3 The measurement noise on the touched segment is six times the effect

Summing `imputedIdealCostUsd` over the 11 sweet subagent records in the census gives
**$0.328109** `[M]`, which reproduces the forensics' imputed sweet sidechain of $0.3281
against a recorded $0.1977. The imputation gap is **$0.1304 = 10.0%** of the $1.3009
inclusive sweet arm. The lever's whole addressable dilution is **$0.021744 = 1.67%** of that
arm (§2.4). **The uncertainty on the segment is 6.0x the effect it is meant to move.**
`G6` on the register already says the reconstruction is a lower bound; 165 of 364 sweet
subagent requests carry no usage record at all `[M]`.

### 2.4 The dilution is smaller than quoted, and half of the failure cost is not addressable

Read directly from the census `preSSIdealCostUsd` and `ssFailIdealCostUsd` fields `[M]`:

| set | subagents | pre-`ss-*` phase | failed-`ss-*` requests |
|---|---:|---:|---:|
| sweet `Explore` (no guide) | 8 | **$0.018195** | **$0.003549** |
| sweet general-purpose (guide present) | 3 | $0.000000 | **$0.003791** |
| union quoted by c08 | 11 | — | — |

Three findings.

- The candidate's **$0.0255 = 2.0%** is the union over **all 11** sweet subagents. The
  `Explore`-addressable part is **$0.021744 = 1.67%** of the arm. The headline overstates the
  target by 17%.
- **52% of the failed-call spend happened in subagents that already had the guide**
  ($0.003791 of $0.007340) `[M]`. The guide does not prevent those failures. This is a direct
  measured hit on the causal premise.
- Per subagent, the **guided** ones spent **more** on failed `ss-*` calls than the guide-less
  ones ($0.00126 against $0.00044) `[M]`. The 14.0%-against-5.9% *rate* gap does not carry
  into a cost advantage per subagent.

The saving also has a floor. Guided subagents still fail 5.9% of `ss-*` calls against the
main thread's 4.8% `[M]`. So the failure component falls by at most
(14.0 − 5.9)/14.0 = 58%, that is **at most $0.002058**. The pre-`ss-*` phase plausibly goes
to zero: guided subagents recorded `preSSIdealCostUsd = $0.000000` in 3 of 3 `[M]`.
Realistic gross saving **$0.020253**.

### 2.5 The re-ingest term is under-priced 2.3x

The payload is not the guide alone. A project-authored agent inherits the CLAUDE.md
hierarchy `[C]`, and in the bench that hierarchy carries **two** files: the runner writes
`CLAUDE.md` with the frame only (`claude-code-task-runner.mjs:310`,
`writeInstructionFile(rundir,'CLAUDE.md',{sweet:false,mppText})`) and adds
`.claude/rules/sweet-search.md` with the guide on the sweet arm only (line 316) `[C]`. Frame
about 754 tokens `[C, forensics]` plus guide 1,457 tokens = **2,211 tokens**.

Sweet `Explore` subagents made **231 requests across 8 launches** `[M]` (14, 11, 15, 58, 34,
54, 30, 15).

- Bench: 8 x 2,211 x $0.10/M (ingest) + 223 x 2,211 x $0.01/M (re-send) = $0.00177 + $0.00493
  = **$0.00670**.
- Production, guide only, no frame: 8 x 1,457 x $0.10/M + 223 x 1,457 x $0.01/M = $0.00117 +
  $0.00325 = **$0.00442**.

The candidate's **+$0.0000437 per rollout = $0.00288** over the arm reproduces exactly
`199 x 1,457 x $0.01/M` — the guide alone, across the usage-bearing requests only, with no
ingest leg. It omits the frame inheritance, the 104 requests that carry no usage record, and
the first-request ingest price. **Under-priced by 2.3x.**

### 2.6 Net, re-derived

| | bench pricing | production pricing |
|---|---:|---:|
| gross saving | $0.020253 | $0.020253 |
| re-ingest | −$0.00670 | −$0.00442 |
| **net over the 66-rollout arm** | **$0.01355** | **$0.01583** |
| **as % of the $1.3009 sweet arm** | **1.04%** | **1.22%** |
| per rollout | $0.000205 | $0.000240 |
| **as % of $0.020727 per rollout** | **0.99%** | **1.16%** |

`[M]+[I]`. Against a claimed −1.7% and a self-declared kill line of 1%. **The lever
straddles its own kill line.** An independent verifier on the measurability lens reached
0.80%–1.30% by a different route; the two ranges agree.

### 2.7 One induced delegation erases the lever, twice over

Sweet's 9 delegating rollouts carried **$0.328109** of subagent spend `[M]`, that is
**$0.0365 per delegating rollout** on top of its main thread. Non-delegating rollouts carry
zero. So one extra delegation across 66 rollouts costs **+$0.0365 = 2.8% of the arm** —
**1.7x the gross saving and 2.7x the net.** Sweet's delegations flipped **0 of 6** task
outcomes and cost 2.5 to 4.5 times their non-delegating sibling reps on the solved tasks
`[M, forensics §4]`.

This is `F15`'s principle used as a risk bound rather than as a duplicate check. c08 says
"F15 asked for more delegation, this adds none". Shape A adds no roster entry, so that is
fair for Shape A. **Shape B adds `sweet-explore` to the roster the main thread sees**, which
is an explicit invitation to take the path F15 killed. And Shape A still changes the
`Explore` description the main thread reads, so its delegation propensity is not held fixed
either. The downside is 2.7x the upside and the register says the downside is the behaviour
that loses.

### 2.8 The 14.0% failure rate is a pre-fix number

`git log --date=iso`: the fresh pool ran 2026-08-26/27; **`36b802e` landed 2026-08-28
16:41:50 +0200** `[M]`. Its body `[C]` records: "ss-grep/ss-find: accept a trailing
positional path as an `--in` scope"; "ss-find: add `--in`"; "ss-read: on ENOENT print a
locate hint".

The 36 measured subagent `ss-*` failures class as `[M, forensics §2.1]`: `--help` rejected
10, `--in` not accepted by `ss-trace`/`ss-find` 7, extra positional path 8, grep-style flags
4, `--full` 3, `--start/--end` 1, ENOENT 1, other 2. **`36b802e` already removes 9 of the 36
outright (8 positional + 1 ENOENT) and an unknown share of the 7 `--in` failures — 9 to 16 of
36, that is 25% to 44%** `[M]+[C]`.

The candidate's live kill condition reads: *"Explore `ss-*` failure rate not below 8% with
guide present."* Removing 25% to 44% of Explore's 30 failures puts the post-fix rate at
**7.9% to 10.5%** `[I]` before any guide arrives. **The pre-registered falsifier can be
satisfied by code that shipped four days before the lever exists.** `BRIEF.md` §2.2:
"Never pool runs across a shipped fix."

---

## 3. Register check, row by row

| row | verdict on the register | does its killing fact apply to c08? |
|---|---|---|
| **B18** richer subagent-launch retrieval brief | DEAD, exposure 3/34 and off-ledger | **Yes, on both clauses.** Exposure re-scores to 9.4%, statistically the same. The "larger brief, sign probably positive" clause is untouched by anything c08 offers. The off-ledger clause is escaped **only** for the hand-built fresh-pool table, never for `rows.json`. |
| **F15** delegation for sweet on claude-code | DEAD, "sweet's win is not needing to delegate" | **Yes, as a risk bound.** Shape B adds a roster entry, which is F15's mechanism in a new vehicle. For Shape A the bound is the arithmetic in §2.7: one induced delegation is 2.7x the net saving. |
| **E10** ephemeral exploration specialist (C-3) | DEAD live, cost +79%, calls 6.8 to 12.5 | **Yes for Shape B**, which is an exploration specialist added to the roster. No for Shape A, which adds no step. c08's own register check is right about Shape A and silent about Shape B. |
| **B11** turn-0 retrieval dossier | DEAD, calls to first edit down 2–16% while cost rose 4.8–19.8% live | **Yes, as the sign precedent.** A $0 estimate said the extra context saved; live it cost. |
| **B12 / C-4** whole-file span expansion | INVERTED, replay −1.6/−2.1/−4.7%, live +4.78/+19.79/+11.72% | **Yes, as the sign precedent.** "The agent handed more does more work." |
| **B2 / B3** guide trim, guide removal | CLOSED / owner-blocked; 08-28 research ranked "drop the guide" #1 on published evidence that repo context files cost 20–23% for −0.5 to −2% resolution | **Direction conflict.** c08 multiplies guide delivery into a second context. There is no measurement anywhere that the guide pays for itself inside a subagent; the only evidence is a rate gap confounded by agent type, with guide presence **inferred from token deltas, never read** `[forensics §10]`. |
| **E2** `ss-*` hygiene package | SHIPPED 36b802e / 1a00765 | **Yes, as a cohort trap** (§2.8), and as the correct home: M4 in the same forensics doc proposes making `ss-* --help` exit 0, which removes 10 of the 36 failures at near-zero cost and with no delegation risk. A strictly cheaper alternative sits in the same source document. |
| **A1 / A6** instruction-deafness | DEAD x4 / REFUTED | **c08 genuinely escapes these.** The guide already carries the intent as prose: "Any sub-agent you delegate to must use these `ss-*` tools, with this system prompt verbatim" `[C, sweet-search-system-prompt.md:24]`. Measured obedience: 26 of 27 delegation prompts mention `ss-*`, **0 of 27 carry the guide** `[M]`. A config file is a real, different vehicle. Keep this argument. |
| **G1b / G6** sidechain ledger | SHIPPED / disclose always | Explains why B18's revival condition reads as met and is not. G1b shipped the *inclusive* ledger; the ledger honours it by writing `null` when a subagent transcript is incomplete, which is every delegating row (§2.2). |

**Novelty finding, stated plainly:** the mechanism itself is **not on the register**. I
grepped the canonical register for `worktree`, `init writes`, `append-subagent`, and
`output style` and found **zero** rows `[M]`. c08 is not a rename of a dead lever. It is a
new mechanism whose economics are governed by dead levers' facts.

---

## 4. Code facts I confirmed at $0 that nobody had

All from the shipped binary at
`/Users/admin/.local/share/claude/versions/2.1.258`, read with `grep -a -b -o` for a byte
offset and `dd` for a window. No model call.

1. **A project `.claude/agents/Explore.md` DOES override the built-in.** `[C, offset
   162252318]` Function `UF` partitions definitions by source and merges them in the order
   `[built-in, plugin, userSettings, projectSettings, flagSettings, policySettings]` into a
   `Map` with `I.set(B.agentType, B)`. A later group with the same `agentType` overwrites an
   earlier one, and `projectSettings` comes after `built-in`. **The candidate's one remaining
   falsifier is now PASSED, at $0, without `/agents` and without a model call.**
2. **The override is wholesale replacement, not a merge.** `[C, same offset]` `Map.set`
   replaces the whole definition object, including
   `getSystemPrompt: () => t5r()` on the built-in `Explore` `[C, offset 162228062]`.
   **So the candidate's stated mitigation — "append only the tool block" — is not available
   for Shape A.** The built-in exploration policy is discarded, not extended. The solve risk
   the candidate calls "real" cannot be mitigated the way it proposes. This is a correction
   the synthesis must adopt.
3. **`Explore` is not tool-starved.** `[C, offset 162228062]`
   `O0={agentType:"Explore", whenToUse:..., disallowedTools:[yt,...Iie,r_,zt,jn,fc],
   source:"built-in", baseDir:"built-in", model:"inherit", omitClaudeMd:!0,
   getSystemPrompt:()=>t5r()}` — a deny list, **no positive `tools` allowlist**. c08's
   correction of `research/anthropic-model-product-path.md` §5.2 is confirmed independently.
4. **`omitClaudeMd` is not a user-facing frontmatter field.** `[C, offset 162258416]` The
   parser `Ryr` reads `name`, `description`, `color`, `model`, `background`,
   `memory` (`user|project|local`), `isolation` (`worktree|remote`), `effort`, and `tools`.
   `omitClaudeMd` appears at six offsets in the binary and every definition site I opened is
   a `source:"built-in"` literal (`Explore`, `Plan`, the web-fetch agent, and
   `comment-thread-analyst`). The stripping site is
   `ys = e.omitClaudeMd && !B?.userContext; {claudeMd:Qs,...Bo}=Tr; zr = ys?Bo:Tr`
   `[C, offset 163775014]`. **c08's Shape A premise holds.**
5. **`isolation` is settable by the caller, so the definition cannot prevent a worktree.**
   `[C]` plus `[M]`: **44 of 44** subagents in `fp-claudecode-tab-20260826` carry
   `inWorktree: true` and `isolation: "worktree"`, which the forensics reads from the `Agent`
   call input. Omitting `isolation` from the frontmatter does not stop the caller passing it.
6. **So the production form of this lever is negative today.** `sweet-search init` appends
   `.sweet-search/` to the project `.gitignore` `[C, scripts/init.js:296-309]`. A
   `git worktree add` checkout contains tracked files only, so the index is absent.
   `_ss-helpers.mjs:136-142` `[C]` resolves
   `PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd()` and then
   `process.exit(2)` with `[ss-*] no Sweet Search index at ...`. **A project `Explore.md`
   written by `init` today hands a subagent a 1,457-token guide for tools that exit 2 on
   every call.** The bench never saw this because `agent-runner-shared.mjs:134-142` pins
   `SWEET_SEARCH_PROJECT_ROOT` to the parent checkout `[C, forensics §6.2]`.

**Ordering consequence:** c08 must not ship before the worktree-aware project-root fix
(`forensics/claude-subagents.md` §7 M3). Shipped in the stated order, c08 is a cost with no
benefit for real users.

---

## 5. Where the candidate's escape argument actually lands

c08 claims: *"this meets B18's own revival condition (re-score on-ledger, exposure 38/44)
with a different vehicle; evidence post-dates B18's kill."*

Taken clause by clause:

- **"different vehicle" — TRUE and valuable.** B18's vehicle was the launch prompt the model
  writes. c08's vehicle is a file `init` writes. The register's instruction-deafness rows
  (A1, A6) and the measured 0-of-27 obedience to the guide's own delegation sentence make
  this a real distinction. Keep it.
- **"evidence post-dates B18's kill" — TRUE but not sufficient.** New evidence exists. It
  re-confirms rather than overturns: exposure 8.8% then, 9.4% now `[M]`.
- **"exposure 38/44" — FALSE as exposure.** It is the pooled Explore share of launches, both
  arms. Sweet exposure is 24 of 255 rollouts.
- **"re-score on-ledger" — HALF TRUE.** The published table includes the sidechain; the
  ledger does not, and the reconstruction's own imputation gap is 6x the effect (§2.3).
- **Not addressed at all:** B18's second killing clause, that a larger brief has a positive
  sign. Three live inversions on the register say that clause is the one with teeth.

---

## 6. Corrections the synthesis must adopt

1. Replace exposure **"38/44 (86.4%)"** with **"sweet-arm exposure 24 delegating rollouts of
   255 measured sweet claude-code rollouts = 9.4%; 8 `Explore` subagents in the primary run;
   0 in `rb-claudecode-20260824` and `fixval-claude-code-20260828`"** `[M]`.
2. Replace the dilution **"$0.0255 = 2.0% of arm"** with **"$0.021744 = 1.67% of arm
   addressable ($0.018195 pre-`ss-*` + $0.003549 Explore failed-`ss-*`); the remaining
   $0.003791 of failed-call spend occurred in subagents that already had the guide"** `[M]`.
3. Replace the re-ingest term **"+$0.0000437/rollout"** with **"+$0.00670 over the arm in the
   bench (frame + guide, 2,211 tokens, 231 requests, ingest leg included) or +$0.00442 in
   production (guide only)"** `[M]+[I]`.
4. Replace the ceiling **"−$0.00035/rollout = −1.7%"** with **"net −$0.000205 to −$0.000240
   per rollout = −1.0% to −1.2% of the claude-code sweet arm, straddling the candidate's own
   1% kill line"** `[M]+[I]`.
5. Add the missing risk term: **"one induced delegation across 66 rollouts costs +$0.0365 =
   +2.8% of the arm, 2.7x the net saving; sweet delegation flipped 0 of 6 task outcomes"**
   `[M]`.
6. Strike the mitigation **"append only the tool block"**. `[C]` A project agent replaces the
   built-in definition object wholesale; there is no append path. Shape A's solve risk must be
   carried unmitigated, or the candidate must fall back to Shape B, which is closer to E10.
7. Mark the falsifier **PASSED, with the method**: project `.claude/agents/` beats `built-in`
   in `UF`'s merge order on 2.1.258 `[C, offset 162252318]`. Do not carry it as an open item.
8. Add the ordering blocker: **the lever is negative in production until the worktree-aware
   project-root fix ships** — 44 of 44 subagents ran `isolation: "worktree"` `[M]`,
   `.sweet-search/` is gitignored `[C]`, and the wrapper hard-exits `[C]`.
9. Add the cohort trap: **the 14.0% Explore failure rate predates `36b802e` (2026-08-28
   16:41)**; that commit already removes 9 to 16 of the 36 measured failures, so the
   candidate's own 8% live kill line may be met by unrelated shipped code `[M]+[C]`.
10. Reclassify: **`E2`-class hygiene and a real-user product correctness item, not a ranked
    cost lever** — the wording the originating forensics already used.
11. Keep, verbatim, c08's correction of `research/anthropic-model-product-path.md` §5.2:
    `Explore` is not tool-starved; the gap is `omitClaudeMd` only. Independently confirmed
    `[C, offset 162228062]`.
12. Fix one citation: the candidate cites `b2-259-sweet agent-a8d5f1d037a62e83b.jsonl` for
    "sweet subagents ran Bash and `ss-*`". That transcript is a **general-purpose** subagent
    with the guide, not an `Explore` `[M, census]`. The claim is true, but the supporting id
    should be an `Explore` record, for example `a04ad28e63dd30186` (b2-259 sweet r0, 59
    `ss-*` calls). The stated per-subagent range **"`ss-*` 25-95"** also disagrees with the
    census, which gives **5 to 59** `ss-*` calls per sweet subagent `[M]`.

---

## 7. What would revive it

Not a new argument. A new measurement, in this order:

1. Ship the worktree-aware project-root resolution first, so `ss-*` works inside an isolated
   subagent at all.
2. Ship the `E2`-class `--help` fix, which takes 10 of 36 failures at near-zero cost and
   near-zero risk, and re-measure the Explore failure rate **after** `36b802e` so the baseline
   is post-fix.
3. Only then, if the post-fix Explore failure rate is still above about 10% **and** the sweet
   delegation rate has risen above roughly 25% of rollouts on a fresh cohort, is there an
   effect large enough to survive a segment whose own imputation noise is 10% of the arm.

Until then the honest label is hygiene, and the honest number is "about 1% of one harness,
the harness that is already winning."

---

## 8. What I could not finish

- I did not run the `/agents` listing on a live session. I closed the same question by
  reading the merge order in the binary, which is stronger evidence and cost nothing, but it
  is static reading, not a live confirmation.
- I did not verify that a project agent named `Explore` still receives the built-in's
  `gitStatus` stripping. `[C, offset 163775014]` shows the strip keys off the **agentType
  string**, `e.agentType==="Explore"||e.agentType==="Plan"`, not off `source`, so a project
  agent with that name inherits the strip. I did not price it; it is small.
- I did not reproduce the worktree "no index" failure live. The claim is a three-step code
  chain (`init.js:296-309`, `git worktree` semantics, `_ss-helpers.mjs:136-142`) plus the
  44-of-44 isolation measurement, not an execution.
- I could not separate agent **type** from **guide presence** as the cause of the 14.0%
  against 5.9% failure gap. Three guided subagents in two task cells, with guide presence
  inferred from token deltas rather than read `[forensics §10]`, cannot carry that causal
  claim. Separating them needs a paid ablation.
- I did not re-derive the frame's 754-token size; I carried the forensics' `[C]` figure.
