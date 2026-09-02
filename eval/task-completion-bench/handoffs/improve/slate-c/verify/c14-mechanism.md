# c14 — mechanism verify (adversarial): Claude-code headline sensitivity package

Verifier lens: mechanism. Date: 2026-09-02. Run replayed: `fp-claudecode-tab-20260826`
(22 tasks × 3 reps × 2 arms = 132 rows; 66 rollouts per arm). Scratch on the box:
`/tmp/wf-slatec/c14-mechanism/` (read-only on `results/`). Script and full output are archived
in `verify/scripts-c14-mechanism/`.

## Verdict

**Refuted as packaged; two of its three parts survive with corrected numbers.** The lead item
(the Anthropic price vector, "the ledger has no write term") does not show its mechanism: the
claude-code ledger already prices cache writes at 1.25× `[C]`, so the 5-minute Anthropic vector
changes only the output weight (6× → 5×) and moves the cell by 0.04 to 0.68 points — inside the
candidate's own ±1-point kill band. Its "+2.2% main-only" baseline is a share reconstruction that
matches neither measured convention (row-matched −1.38%, published dearest-3 +4.60%) `[M]`. The
1-hour leg is real arithmetic (+1.3 to +2.7 points) but Claude Code requests the 1-hour TTL only
inside a subscription's included plan usage, where no per-token bill exists, and drops to
5 minutes the moment usage is billed `[W]`; the `promptCacheTtl: "5m"` rider therefore saves no
dollars on any per-token default path and is dead. The pages asymmetry (item 2) and the
haiku-subagent repricing (item 3) reproduce from the raw transcripts and are stronger than
claimed: under the published dearest-3 convention, repricing native's haiku-requested subagents
alone flips the claude-code cell from −3.31% to +2.14% `[M]`. The candidate's closing sentence,
"together they can erase the published −3.9%", is supported: on the per-token real-user path the
cell is −0.18% (row-matched, a tie) or +2.70% (published convention). Solves are unchanged by
construction (native 43/66, sweet 40/66). Zero head-to-head differential; measurement only.

## 1. What I replayed, and how it ties to the ledger

Method `[M c14_replay.py]`: for every row in `rows.json`, open the main transcript under
`agent-state/<task>-<arm>/claude-home/projects/*-r<rep>-*/<session>.jsonl`, group assistant
records by `message.id`, keep the usage-bearing record (brief §2.2 trap), price it with the
ledger vector (`in $0.10`, `cache-read $0.01`, `cache-write $0.125`, `out $0.60`), and match
the row by cost. Sidechain = `<session>/subagents/agent-*.jsonl` (every record there carries
`isSidechain: true`), linked to the parent `Agent` call through `toolUseResult.agentId` to read
the requested model.

- All 132 rows matched a transcript to within $0.000002 of `costRealizedMainOnlyUsd` `[M]`.
- Main-only per rollout: native $0.016542, sweet $0.016314 (−1.38%) `[M]`; this equals the
  `rows.json` column sums (1.091795 / 1.076702 over 66) `[M]`.
- Recorded sidechain per rollout: native $0.004429, sweet $0.002811 `[M]`, the same figures as
  `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §2.1. Inclusive lower bound −8.81% `[M]`.
- Subagents: native 33 (Explore: 19 haiku, 11 sonnet; general-purpose: 3 sonnet), sweet 11
  (Explore: 6 haiku, 2 sonnet; general-purpose: 3 sonnet) `[M]`. Subagent requests 519 / 364,
  of which 205 / 165 carry all-zero usage `[M]` — the register's G6 figure reproduces.
- Session files in the run: 67 native, 71 sweet `[M]`. The 6 extra files are degeneration
  re-runs; the published cells use "dearest-3" (keep the 3 dearest per task × arm). Selecting
  the 3 dearest by ledger inclusive cost reproduces sweet's published $0.020727 exactly and
  native $0.021437 against the published $0.021558 lower bound `[M]`.
- TTL is unobservable in this run: `usage.cache_creation.ephemeral_5m_input_tokens` and
  `ephemeral_1h_input_tokens` are 0 on every one of the 3,133 main-thread and 513 usage-bearing
  sidechain requests `[M]`; the OpenRouter Anthropic skin does not populate them.

## 2. Item 1 — the Anthropic price vector: mechanism not shown, level wrong

### 2.1 The ledger already has the write term on claude-code

`ideal-cost.mjs` `costFromTurns` bills `cacheWrite × price.in × 1.25` in `realFromTurnsUsd`, and
`claude-code-accounting.mjs` supplies `cacheWrite` from `cache_creation_input_tokens` `[C]`. The
candidate cites this fact itself and then argues that "Anthropic reprices ingest upward by
1.25×–2× while the ledger has no write term". For claude-code that is false at the 5-minute
multiplier: the 1.25× is already charged. The luna vector has no write field, but the claude-code
ledger applies the multiplier anyway.

### 2.2 Measured repricing (per rollout, same token counts, both conventions)

| vector (in / read / write / out per MTok) | row-matched native | sweet | Δ | dearest-3 native | sweet | Δ |
|---|---:|---:|---:|---:|---:|---:|
| ledger: luna 0.10 / 0.01 / 0.125 / 0.60 | 0.016542 | 0.016314 | **−1.38%** | 0.017129 | 0.017917 | **+4.60%** |
| luna with no write surcharge (0.10 write) | 0.015565 | 0.015218 | −2.23% | 0.016152 | 0.016817 | +4.11% |
| Opus 5, 5-minute: 5 / 0.5 / 6.25 / 25 | 0.795043 | 0.789444 | −0.70% | 0.819459 | 0.857486 | +4.64% |
| Opus 5, 1-hour: 5 / 0.5 / 10 / 25 | 0.941685 | 0.953739 | +1.28% | 0.965935 | 1.022483 | +5.85% |
| Sonnet 5, 5-minute: 2 / 0.2 / 2.5 / 10 | 0.318017 | 0.315777 | −0.70% | 0.327783 | 0.342994 | +4.64% |
| Fable 5.1, 5-minute: 10 / 0.25 / 12.5 / 50 | 1.005226 | 1.002774 | −0.24% | 1.053788 | 1.129349 | +7.17% |

All `[M c14_replay.py]`, main thread only, 66 rollouts per arm. Prices `[W]`
<https://platform.claude.com/docs/en/about-claude/pricing>: 5-minute write 1.25×, 1-hour write
2×, read 0.1× (0.025× on Fable 5.1).

Readings:

- **5-minute shift: +0.68 points (row-matched) or +0.04 points (dearest-3).** The only change
  from the ledger is output 6× → 5×. Sweet emits 18% fewer output tokens than native on the
  row-matched set (5,248 vs 6,415 per rollout) `[M]`, so a lower output weight costs sweet a
  little. The candidate's pre-registered kill condition ("retire the pricing concern if the gap
  stays within ±1 point of the luna figure") **fires on the 5-minute leg**.
- **1-hour shift: +2.66 points (row-matched) or +1.25 points (dearest-3).** Real arithmetic:
  sweet writes 12.0% more cache tokens than native (43,812 vs 39,105 per rollout) `[M]`, and
  the write multiplier rises 1.25 → 2.0. But see §2.4.
- **The candidate's levels are wrong by more than a factor of two.** It states main-only
  "+2.2% → +3.4% (5m) / +4.6% (1h)". Measured: −1.38% → −0.70% / +1.28% (row-matched) or
  +4.60% → +4.64% / +5.85% (dearest-3). Its "+2.2%" is
  `0.84 × $0.020727 = $0.017411` against `0.79 × $0.021558 = $0.017031` — the published
  inclusive cells scaled by rounded cost shares — which I reproduced to the dollar `[M]`; it is
  a reconstruction, not a measured column. Its mechanism sentence ("sweet ingests 11.3% more
  tokens and re-sends each 5.0% fewer times") comes from the same reconstruction; measured:
  ingest +12.0%, re-sent tokens −1.5%, output −18.2% `[M]`. Sweet's main-thread credit is output,
  not re-send.
- **Register G17 thread 14 resolves in sweet's favour, slightly.** If OpenRouter does not bill
  luna cache writes at 1.25×, the ledger overcharges both arms; removing the surcharge moves the
  row-matched main-only gap from −1.38% to −2.23% and the inclusive gap from −8.81% to −8.95%
  `[M]`. OpenRouter's own guide states GPT-5.6+ charge writes at 1.25× even with automatic
  caching `[W via 06-research-cost-mechanics.md §2.3,
  https://openrouter.ai/docs/guides/best-practices/prompt-caching]`, so the ledger is probably
  right; either way the swing is under one point.

### 2.3 Cross-harness "uniform 1.25×" figure

The candidate's `[M G17]` figure (opencode +3.31% → +2.52%, codex +0.35% → +0.06%) is an
arithmetic consequence of the cache-write counts in `HARNESS-GUTTER-COST-ANALYSIS` §2.1
(opencode 30,356 vs 28,312; codex 35,899 vs 34,498 tokens per rollout) at 0.25 × $0.10/MTok; I
re-derived both to the second decimal `[M arithmetic]`. It concerns the other two harnesses and
does not bear on the claude-code mechanism.

### 2.4 The 1-hour leg models a path with no per-token bill

`[W]` <https://code.claude.com/docs/en/prompt-caching> (fetched 2026-09-02): "Unless you choose
a TTL yourself, Claude Code requests the one-hour TTL only on a Claude subscription within your
plan's included usage." Table: main conversation = one hour on "Claude subscription, within plan
usage"; five minutes on "usage credits, API key, or cloud provider"; everything else (subagents)
five minutes. "Once you go over your plan's usage limit and Claude Code draws on usage credits,
you are billed for that usage, so Claude Code drops the main conversation to the cheaper
five-minute TTL." Consequences:

- Every per-token-billed default path (API key, usage credits, cloud provider) is already on the
  5-minute TTL for both buckets. The "2.00× main / 1.25× subagent" split exists only where the
  user pays a flat plan fee.
- The bench ran with `ANTHROPIC_AUTH_TOKEN` and a custom `ANTHROPIC_BASE_URL` `[C
  claude-code-task-runner.mjs:268-282]`, sets no TTL variable `[C grep]`, on Claude Code 2.1.218
  `[M transcript version stamps]`. That is the API-key bucket: 5 minutes, both arms.
- Whether 1-hour writes deplete a subscription's included usage faster is not stated on the
  page. It is an open, unmeasurable-at-$0 question, not a dollar mechanism.

### 2.5 The rider (`init` writes `promptCacheTtl: "5m"`) is dead

- The vehicle exists: `scripts/init.js:967-1013` registers a SessionStart hook in
  `.claude/settings.json` non-destructively `[C]`. `promptCacheTtl` appears 0 times in the bench
  binary 2.1.218 and 8 times in 2.1.247 and 2.1.258 `[M grep of
  /root/.local/share/claude/versions/2.1.218 and ~/.local/share/claude/versions/*]`; the setting
  requires v2.1.242+ `[W]`. The candidate's version facts hold.
- The mechanism does not: the users who get the 1-hour default are exactly the users who are
  not billed per token `[W]`, and Claude Code already switches them to 5 minutes when billing
  starts. "16.0% of a real subscription user's main-thread bill" describes a bill that does not
  exist. A user idling past five minutes would additionally pay a full re-ingest (in latency, and
  in plan usage if that is metered), which is the candidate's own kill condition.

## 3. Item 2 — the `pages` asymmetry: reproduced, sign flip confirmed, price corrected

| arm (66 rollouts, row-matched) | `Read` calls | failed on `pages` | rollouts hit | wholly-wasted requests | own ledger cost | share of main-only |
|---|---:|---:|---:|---:|---:|---:|
| native | 690 | 159 | 66/66 | **92** (1.39 / rollout) | $0.037120 ($0.000562 / rollout; $0.000403 per request) | 3.40% |
| sweet | 51 | 23 | 18/66 | **23** (0.35 / rollout) | $0.010814 ($0.000164 / rollout; $0.000470 per request) | 1.00% |

`[M c14_replay.py]`. The candidate's `pagescheck.py` gives 163 / 93 and 25 / 25 because it runs
over all 67 + 71 session files (degeneration re-runs included) and then divides by 66 `[M, script
re-run read-only]`; row-matched the ratio is 4.0×, not 3.7×. Dearest-3: 91 / 23 `[M]`.

- Removing the wasted requests' own cost from both arms moves row-matched main-only from −1.38%
  to **+1.06%** `[M]` (candidate: +0.62% conservative). The candidate's "$0.000318 per removed
  request" understates the measured request cost ($0.000403 native, $0.000470 sweet); each
  wasted request re-reads a ~19.6k-token prefix and emits ~87 output tokens.
- The "+4.8%" upper figure inherits `claude-main-thread.md` F4's $0.074321 (6.81%), which prices
  every request that contained a failed `Read`, including requests that also carried successful
  calls `[C claude-main-thread.md §5]`. That is an over-attribution; do not publish it as a
  removal counterfactual.
- Inclusive effect: row-matched −8.81% → −7.10%; dearest-3 −3.31% → −1.55% `[M]`.
- Real-user relevance: the failure is the luna backbone filling an optional Claude-only
  parameter `[C runner comment 332-344]`; a Claude model would not pay it. Removing it is the
  correct correction for a "real user's path", and it is arm-asymmetric against native.
- D4b stays BLOCKED (schema validation precedes the hook) `[C runner 59-73]`; disclosure only.

## 4. Item 3 — subagents priced at the model they requested: reproduced and stronger

- Counts: native 19/33 haiku, sweet 6/11 `[M]`. Haiku share of sidechain spend: 55.2% / 32.5% on
  recorded realized cost `[M replay]`; 56.4% / 36.3% on the census's imputed ideal column `[M
  local recompute of census-fp-claudecode-tab-20260826.json]`. The candidate's shares are the
  imputed-ideal ones; both exist.
- Every subagent resolved to `openai/gpt-5.6-luna` (`resolvedModel`) and was billed at luna's
  rate `[M]`. Under the runner, `ANTHROPIC_DEFAULT_HAIKU_MODEL` is pinned to the luna slug `[C
  runner 279-281]`, so the compute really was luna's; the repricing is a real-user sensitivity,
  not a bill correction.
- Inclusive lower bound, haiku at 0.2× / 0.33× of the base rate, recorded sidechain:
  row-matched −8.81% → **−3.27% / −4.24%** `[M]` (candidate −9.2% → −3.0% / −4.1%; its −9.2%
  base is the forensics' neighbour-imputed figure); **dearest-3 −3.31% → +2.14% / +1.19%** `[M]`.
  Under the published convention this single correction flips the sign.
- Ratio imputation (recorded × requests / usage-bearing requests) gives dearest-3 −7.97% →
  +1.73% / −0.08% `[M]`; the sign flip holds at 0.2×.

## 5. Combined "real-user path" scenarios (main + sidechain, per rollout)

| scenario | row-matched, recorded | row-matched, imputed | dearest-3, recorded | dearest-3, imputed |
|---|---:|---:|---:|---:|
| ledger as published | −8.81% | −13.13% | **−3.31%** | −7.97% |
| API-key path: Opus 5 5m everywhere, subagents at requested model (Haiku 0.2×, Sonnet 0.4×) | −2.45% | −3.49% | **+2.70%** | +1.55% |
| API-key path + pages defect removed both arms | **−0.18%** | −1.36% | **+5.00%** | +3.70% |
| subscription path: Opus 5 1h main, 5m subs at requested model | −0.34% | −1.32% | +4.12% | +3.07% |
| subscription path + pages removed | +2.23% | +1.10% | +6.69% | +5.49% |
| candidate item 1 literal: 1h main, 5m subs, no model repricing | −5.49% | −9.73% | −1.12% | −5.52% |

`[M c14_replay.py]`. Ratios Haiku 4.5 : Opus 5 = 0.2 and Sonnet 5 : Opus 5 = 0.4 hold on all
five price columns `[W pricing page]`. Token counts are luna's; Claude 4.7+ tokenizers produce
about 30% more tokens `[W pricing page note]`, so treat these as direction and magnitude.

Reading: the published −3.9% does not survive a real user's per-token path. Under the published
convention it becomes +2.7% (+5.0% with the bench defect removed); under the graded-transcript
convention it becomes a tie (−0.2%). The candidate's closing sentence holds; its component
figures and its item-1 mechanism do not. Adding point shifts computed on three different
baselines (−9.2% imputed inclusive, −1.38% row-matched main-only, +2.2% reconstructed main-only)
onto the published −3.9% is not valid arithmetic; the table above is computed on one ledger.

## 6. Denominators and traps checked

- 66 rollouts per arm, 22 tasks × 3 reps; 132 rows, 132 transcript matches; 138 session files;
  33 / 11 subagents; 519 / 364 subagent requests; 205 / 165 zero-usage `[M]`.
- Solves: native 43/66, sweet 40/66 `[M rows.json]`; unchanged by every scenario (accounting).
- Convention swing: main-only −1.38% (row-matched) against +4.60% (dearest-3) — 6 points, larger
  than any pricing effect. Any published sensitivity must name its convention.
- No HO2 access; no grading logs opened; no hidden-test content read.

## 7. What I could not finish

- Neighbour imputation as the forensics did it; I used ratio imputation, which is cruder and
  larger (native sidechain $0.008069 vs their $0.006380 per rollout).
- Whether OpenRouter actually billed luna cache writes at 1.25× (no invoice available; §2.2
  bounds the effect under one point either way).
- Whether a subscription's included usage is depleted faster by 1-hour writes (not documented
  on the fetched page; not measurable at $0).
- A native $0.021558 reproduction: my dearest-3 inclusive lower bound is $0.021437 (−0.6%),
  probably a different measured-sidechain set in the runner; sweet's $0.020727 reproduces
  exactly.

## 8. Recommendation to the synthesis

Split c14. Retire item 1 and the rider. Re-register items 2 and 3 as measurement disclosures
(zero differential) with the numbers in §3–§5, and state the convention beside every claude-code
figure. Retire register G17's "never recomputed for claude-code" thread: it is computed here.
