# c11 — adversarial verify, HISTORY lens (2026-09-02)

**Verdict: REFUTED as a Slate-C lever. Confidence 0.86.** The mechanism is register **C9**
(fit an `ss-*` render under a harness output limit and make the remainder addressable) moved
to a second harness, and it lands on the wrong side of the economics that parked C9 and closed
**C8**. The candidate's own attribution script under-counts its population by 3.75× on the
production form; when I re-count with the correct matcher, the corrected ceiling is about
**+2.2% to +2.3% cost on claude-code, not +0.6%** [M]. Worse, **25 of the 28 fresh-pool events
(89%) sit on two tasks from one repository**, `bfgroup__b2-113` and `bfgroup__b2-259` [M], and
the record already assigns that repository's grind to an index gap whose fix shipped on
2026-08-28 (register E1, commits `36b802e` / `fb9f936`). All four measured runs pre-date that
fix. **Thirty of the 32 measured events sit in rollouts that never solved in any rep; the other
two sit in tasks the sweet arm solved 3/3 anyway** [M] — zero measured exposure to a solve.
Two of the candidate's facts survive intact and are genuinely new: claude-code's persistence
path is never read back (I confirmed 0 of 12,567 tool inputs over 5 runs), and no register row
covers it. That earns a **new register row and an E2-class hygiene item**. It does not earn a
lever.

---

## 1. What the candidate claims, and what the register already holds

| candidate element | nearest register row | verdict on the row | does the killing fact transfer? |
|---|---|---|---|
| bound `ss-*` output below a harness output limit, make the remainder addressable | **C9** (codex, ~2,400-token cap, continuation span) | PARKED; source says **"Do not build a general cap-aware renderer"** | partly — see §2 |
| pay tokens to stop a harness deleting a result | **C8** (raise / uncap the codex output cap) | CLOSED; full delivery costs **2.0×–19×** the follow-ups it prevents | yes, and it gets stronger — see §2 |
| give the claude-code agent more content than it gets now | **B12** (span expansion / whole-file first touch) | INVERTED; live cost **+4.78 / +19.79 / +11.72%**, claude-code ex-never-solved **+41.3%** | yes — the candidate prices only marginal tokens, which is the exact error B12 recorded |
| repair an `ss-*` wrapper defect on a rare path | **E2** (`ss-*` hygiene package) | SHIPPED `36b802e`, `1a00765` | yes — the candidate's own kill line routes it here |
| the b2 escalation chain as harm evidence | **E1** (index `.jam`, re-admit git-tracked `src/build/`) | SHIPPED `36b802e`, `fb9f936` | yes — see §4 |
| a claude-code, subagent-concentrated lever | **B18** (richer subagent brief) | DEAD on exposure (3 of 34 cells) | precedent, not identity |
| per-invocation byte ceiling as the vehicle | **A1** (sweet `&&`-chains 84% of `ss-`-bearing bash calls) | DEAD, but the chaining fact stands | yes — see §5 |

`[C]` I grepped the canonical register for `persist`, `too large`, `BASH_MAX`, `30,000`,
`preview`, `stub`, `deleted`. **No row covers claude-code whole-result deletion.** Section 12.4
(18 screens specified and never run) does not name it either. The *observation* is new. The
*lever* is not.

---

## 2. The two codex rows are not "opposite semantics" — one half transfers and it is the half that decides cost

The candidate's escape argument is that codex and claude-code have opposite rules, so C8 and C9
do not apply. Half of that is right and half is backwards.

**What does not transfer.** C9's strongest kill is `[M]` "0 of 480 edit calls (2,922 anchor
lines) ever anchored on a line that only a truncation had hidden"
(`12-truncation-census.md` §0, §3.2). On claude-code nothing survives at all, so that null
cannot be restated. The candidate is right about this.

**What does transfer, and the candidate does not address it.**
`12-truncation-census.md` §5 states the rule in its own words:

> "Cap-aware rendering means fitting under the cap deliberately, which **costs nothing extra
> in ingest**."

That sentence is why C9 was ever admissible on codex. On codex the harness already delivers a
fixed ~10,200-character window `[M]`, so fitting under the cap re-arranges bytes the model was
going to receive anyway. **On claude-code the same move is a token purchase.** The harness
currently hands back a ~2,200-character stub `[M` median 2,202 chars over 32 sweet events`]`
and bills nothing for the body. Emitting a bounded body instead re-buys it. That is the
transaction `12-truncation-census.md` §5 priced and rejected: full delivery cost **2.0×–19×**
the follow-ups the deletion provoked, in all four codex cells `[M]`. The candidate is running
that same trade at partial strength, on the harness with the **highest re-send multiplier**
(claude-code sweet, 20.1 re-sends per ingested token, `BRIEF.md` §1.1).

The candidate concedes the sign — "the harness's deletion currently **saves** sweet tokens" —
and then files the lever as correctness. That is honest. It is also the point: the Slate-C goal
is cost parity with solve non-inferiority, and this moves cost the wrong way on the one harness
where sweet's measured position is a lead.

---

## 3. Correction 1 — the candidate under-counts its own population by 3.75× on the production form

`[M]` My own census (`/tmp/wf-slatec/c11-history/persist.py`, `analyze.py`) reproduces the
candidate's persisted-event totals exactly — native/sweet **34/16, 0/12, 0/4, 26/2** — so the
instrument is sound. The `ss-*` attribution is not.

The candidate's `ss-*` counts (4 / 10 / 2 / 2) only match commands typed as a **bare name**.
About two thirds of the events invoke the wrapper by absolute path
(`/root/sweet-search-private/eval/agent-read-workflows/bin/ss-find …`). Counting both forms:

| run | persisted sweet | `ss-*`-bearing, any form `[M]` | candidate's figure | main thread | in subagents | chained envelope |
|---|---:|---:|---:|---:|---:|---:|
| `fp-claudecode-tab-20260826` | 16 | **15** | 4 | 2 | 14 | 1 |
| `fp-claudecode-none-20260826` | 12 | **11** | 10 | 1 | 11 | 1 |
| `fp-claudecode-pipe-20260826` | 4 | **2** | 2 | 0 | 4 | 0 |
| `rb-claudecode-20260824` | 2 | **2** | 2 | 2 | 0 | 1 |
| `sb-claudecode-20260811` (Epoch A, my addition) | 2 | **2** | not cited | 1 | 1 | 0 |

`[M]` Total across five claude-code runs: **32 sweet `ss-*` over-threshold events**, not 18.

**Consequence for the ceiling.** The candidate multiplies its per-event cost by 0.061 events per
rollout (4 of 66). The production-form rate is **0.227** (15 of 66). Its own arithmetic, rerun:

- per event, candidate's figures: 6,500 extra tokens × $0.301 per million resident = $0.00196.
- per rollout, corrected: 0.227 × $0.00196 = **$0.000445**, which is **+2.15%** of the
  claude-code sweet rollout ($0.020727) `[I]`.
- if the ceiling is set just under 30,000 characters (~7,500 tokens) the per-event figure is
  $0.00209 and the rollout figure is **+2.30%** `[I]`.

So the corrected ceiling is **about four times the stated +0.6%**, on a harness where sweet's
measured lead is −3.9% and that lead is itself a lower bound (`BRIEF.md` §1, G6). One caveat
runs the other way and nobody has measured it: **14 of the 15 production-form events are inside
subagents** `[M]`, whose contexts are shorter, so the true resident multiplier for these events
is below 20.1. The honest statement is that the cost sign is **unmeasured and the stated +0.6%
is not defensible**.

**Correction 2 — the payload is bigger than assumed.** `[M]`
(`/tmp/wf-slatec/c11-history/sizes.py`, parsing the harness's own `Output too large (N)` field)
the 32 sweet events have original size **min 30 KB, median 42 KB, max 148 KB**. The candidate
assumed "a 7,500–20,000-token result". At the median (~10,500 tokens) a 7,500-token ceiling
discards 29% of the body; at the max (~37,000 tokens) it discards 80%. The guard is therefore
not "deliver it bounded". It is C9's mechanism exactly: deliver a slice and name the rest.

---

## 4. Correction 3 — the flagship harm exhibit belongs to a lever that already shipped

`[M]` Concentration of the 28 fresh-pool `ss-*` events:

| task | events | share |
|---|---:|---:|
| `bfgroup__b2-259` | 18 | 64% |
| `bfgroup__b2-113` | 7 | 25% |
| `asynkron__protoactor-dotnet-1909` | 1 | 4% |
| `aws-actions__configure-aws-credentials-42` | 1 | 4% |
| `devlooped__moq-1262` | 1 | 4% |

`[M]` Seventeen of the 25 b2 events sit in **two rollouts**: `b2-259` `r0-52` (10 events, TAB)
and `b2-259` `r2-38` (7 events, NONE).

`HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §5.1 C3 and §5.2 R1 already attribute the b2 grind
to a retrieval gap: `[M]` "0 of 321 `.jam` files are indexed in the b2 golden", and the
`'**/build/**'` deny pattern was unanchored and deleted `src/build/**`. §5.3 rejects a stop rule
with the sentence that matters here: **"the b2 grind has an upstream cause (C3, R1, R2)."**

The candidate's escalation chain is that same grind. Its commands are literally
`ss-find ".jam" --regex "jam$|\.jam" --full -k 200` and `ss-read src/build/targets.py` `[M]` —
the two file classes register E1 fixed. The agent widened `-k` from 200 to 1,000 because it was
finding nothing, and each widening produced a bigger unfocused pack. **The size failure is
downstream of the retrieval failure**, and the retrieval failure has a shipped fix.

`[M]` Timeline: the four fresh-pool and rebaseline runs are 2026-08-24 to 2026-08-27. Commits
`36b802e` and `fb9f936` land 2026-08-28. `BRIEF.md` §2.2 trap: "Never pool runs across a
shipped fix." **All of the candidate's evidence is pre-fix.** It does not post-date or bypass
the killing fact; it precedes it.

`[M]` One directional signal: on the post-fix `fixval-claude-code-20260828` run, sweet on
`bfgroup__b2-113` moves 0/3 → **1/3**, while `b2-259` stays 0/3 in both arms.

---

## 5. Correction 4 — the named vehicle cannot bound its own flagship main-thread exhibit

`[M]` The TAB main-thread exhibit `devlooped__moq-1262` sweet rep 0 (session
`a0ea3568-74da-4647-b170-521a1451927c`) is a **four-command `&&` envelope**:

```
ss-search "MatcherFactory predicate Match Create lazy matcher" -k 8 && ss-read src/Moq/MatcherFactory.cs 1 300 && ss-read src/Moq/Match.cs 1 220 && ss-…
```

The harness applies its 30,000-character threshold to the **Bash result**, which is the
concatenation of four separate processes. A byte ceiling in `core/search/output-policy.js` and
`_ss-helpers.mjs` is per-invocation `[C]`; no one process can see its siblings' output. So the
proposed vehicle cannot guarantee the envelope stays under the threshold. Register **A1** records
that this envelope form is sweet's norm: `[M]` sweet `&&`-chains **84%** of `ss-`-bearing bash
calls, 0.98 envelopes per turn.

`[C]` A second code fact points the same way. `ss-search` and `ss-find` already carry a rendered
token budget with tiers (`agent`, `--full` = 8k, `--xl` = 12k) plus an environment override
(`_ss-helpers.mjs:448, 474, 488, 501, 708, 729, 803`). Twelve thousand tokens is roughly 48,000
characters, well above claude-code's 30,000. So a budget mechanism exists and the events happen
because the model raises the tier. The candidate is a **cap on an already-shipped budget**, and
the same candidates document files the budget's mis-measurement as C-4, "prerequisite, not a
lever". `[C]` `detectAgentEnv` exists but is referenced only inside `output-policy.js` for
decoration; no payload path consumes it.

---

## 6. The exposure fact — the doctrine's own tier, and solve is the veto

`HANDOFF-EVIDENCE-DOCTRINE.md` §2 sets the census tiers: 200+ firings is measurable, 20–50
resolves a large proximal effect only, **under ~10 is UNDECIDABLE and no affordable run resolves
it**. §6 adds that undecidable is not automatically dead — it is filed for the user to accept or
decline on principle.

`[M]` Remove the single dominant repository and the fresh-pool census is **3 events in 198 sweet
rollouts** (`protoactor` 1, `configure-aws` 1, `moq` 1). Add the two older runs and the
non-b2 total across five runs is **7 events**. That is the undecidable tier. The candidate's own
kill condition — "post-fix population under 3 events per 198 sweet rollouts, then E2-class
hygiene" — is already met once b2 is excluded.

`[M]` Solve exposure is zero. Sweet-arm resolution on the tasks that carry the events:

| task | events | sweet solves, measured runs |
|---|---:|---|
| `bfgroup__b2-259` | 18 | 0/3 TAB, 0/3 NONE, 0/3 PIPE, 0/3 fixval |
| `bfgroup__b2-113` | 7 | 0/3 TAB, 0/3 NONE, 0/3 PIPE |
| `apple__swift-nio-http2-145` | 3 | 0/3 rb |
| `devlooped__moq-1262` | 1 | 0/3 TAB, 0/3 NONE, 0/3 PIPE |
| `dart-lang__http-1114` | 1 | 0/3 rb |
| `aws-actions__configure-aws-credentials-42` | 1 | **3/3** every run |
| `asynkron__protoactor-dotnet-1909` | 1 | **3/3** every run |

**Thirty of 32 events sit in rollouts that never solved in any rep. The remaining two sit in
tasks that solved in every rep.** No measured event sits in a rollout whose outcome was in play.

---

## 7. What survives, verified and strengthened

`[M]` I re-ran the recovery check at a larger denominator than the candidate did
(`/tmp/wf-slatec/c11-history/recover.py`, five runs, 518 transcripts): **0 of 12,567 tool-use
inputs reference a `tool-results/` path**, in either arm. Claude-code's persistence path is a
dead letter. That fact is true, new, and belongs in the register.

`[M]` The cited exhibits are real. `fp-claudecode-none-20260826` `bfgroup__b2-259` sweet `r2-38`
does hold seven deleted `ss-find` results with `-k` rising 200 → 300 → 500. One citation
correction: `26998406-a8e3-4e66-b48c-5a629598a91a` is the **main** session id, not a subagent;
the subagent file is `agent-ac81ac4efebab094f.jsonl`, and 6 of the 7 deletions are in it.

`[M]` One clean non-b2 repeat exists and the candidate did not cite it: `ss-trace` on
`apple__swift-nio-http2-145` crosses the threshold in three separate rollouts across
`sb-claudecode-20260811` and `rb-claudecode-20260824` (`ss-trace receivePushPromise callers` and
`… impact`, 33–38 KB each). That is the strongest single argument for a hygiene fix on
`ss-trace`, and it is a better exhibit than either of the two the candidate leads with.

---

## 8. Disposition

1. **Do not carry c11 as a Slate-C lever.** Its cost sign is against the program's goal, its
   corrected ceiling is ~4× the stated one, its population is undecidable once one repository is
   removed, and its evidence pre-dates a shipped fix that attacks the same exhibits.
2. **Add a register row** (suggested `H3`, harness adaptation): "claude-code deletes a Bash
   result above ~30,000 characters and no agent ever reads the persisted file — 0 of 12,567 tool
   inputs across 5 runs." Verdict: **UNDECIDABLE (doctrine §6)**, with the census above.
3. **File the fix as E2-class hygiene**, scoped to a per-invocation ceiling on `ss-find`,
   `ss-search`, `ss-trace` and `ss-read` when `CLAUDECODE` is set, with the header, the
   sufficiency line, the top address and the narrowing command in the first 2,000 characters.
   Ship it as correctness, price nothing, claim nothing.
4. **The falsifier as written is close to circular.** Replaying 16 invocations against a renderer
   whose ceiling you chose will pass by construction. If it is run at all, replay the **32**
   events, and pre-register the second half only: does the first 2,000 characters carry the four
   named fields for a pack that had to discard 80% of its body?

---

## 9. What I could not finish

1. **The post-fix population is not measurable at `$0`.** `fixval-claude-code-20260828` retains
   `rows.json`, `turns/` and `trajectories/` but **no `agent-state/`** `[M]`, so no run after
   commits `36b802e` / `fb9f936` holds transcripts. The candidate's own kill condition cannot be
   evaluated on any existing artifact.
2. **I did not price claude-code's follow-ups** the way `12-truncation-census.md` §4 priced
   codex's. That number decides the cost sign and it is the measurability agent's job. The
   candidate's "4 to 7 further requests at about $0.00070 each" comes from one subagent chain,
   on a non-production gutter form, on a task no arm has ever solved.
3. **I did not test whether `ss-read dist/index.js 34500 35000` is register D6's
   argument-semantics defect** (count against end line). I read the flag parsing, not the range
   handling. If it is D6, that main-thread exhibit belongs to a different row again.
4. `trajectories/` was never used for any absence claim, per `BRIEF.md` §2.2.

---

## 10. Evidence opened

**Local.**
`eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`;
`.../slate-c/DEAD-LEVER-REGISTER-DRAFT.md`;
`.../slate-c/register/DEAD-LEVER-REGISTER.md` (§0.2, §2, §3, §4, §8, §9, §11.3, §12.4, §12.5);
`.../slate-c/candidates/harness-adaptive-rendering.md` (§0, §1.1–1.4, C-3, C-4);
`.../improve/HANDOFF-EVIDENCE-DOCTRINE.md` (§2, §3, §6, §8);
`.../improve/harness-gutter-cost-20260828/12-truncation-census.md` (§0, §4, §5, §6, §8, §9);
`.../improve/HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` (§5.1, §5.2, §5.3);
`core/search/output-policy.js`; `eval/agent-read-workflows/bin/_ss-helpers.mjs`.

**Box (read-only; scratch only under `/tmp/wf-slatec/c11-history/`).**
`/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-{tab,none,pipe}-20260826/agent-state/**`;
`.../rb-claudecode-20260824/agent-state/**`; `.../sb-claudecode-20260811/agent-state/**`;
`.../fixval-claude-code-20260828/` (no `agent-state`); `rows.json` for all five runs.
Scripts: `/tmp/wf-slatec/c11-history/{persist.py,analyze.py,persist2.py,recover.py,sizes.py,solves.py}`.

**Rollout ids cited.**
`fp-claudecode-tab-20260826` `devlooped__moq-1262` sweet `r0-74` session
`a0ea3568-74da-4647-b170-521a1451927c`;
`fp-claudecode-tab-20260826` `aws-actions__configure-aws-credentials-42` sweet `r1-33`;
`fp-claudecode-tab-20260826` `bfgroup__b2-259` sweet `r0-52` (10 events);
`fp-claudecode-none-20260826` `bfgroup__b2-259` sweet `r2-38` session
`26998406-a8e3-4e66-b48c-5a629598a91a`, subagent `agent-ac81ac4efebab094f.jsonl` (7 events);
`rb-claudecode-20260824` `apple__swift-nio-http2-145` sweet `r2-39` and `r1-38`;
`sb-claudecode-20260811` `apple__swift-nio-http2-145` sweet `r0-43`,
`dart-lang__http-1114` sweet `r0-11`.

No hidden test name, no gold patch content, and no HO2 per-task material appears above.
