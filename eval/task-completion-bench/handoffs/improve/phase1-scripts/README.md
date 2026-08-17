# Phase-1 gate scripts

Every measurement in [`PHASE-1-RESULTS.md`](../PHASE-1-RESULTS.md) comes from one of these.
All are **read-only** over the evidence box and cost `$0` — no model is invoked anywhere.

Run them by piping to the box, which is how they were run originally and which writes nothing
to the host except under `/tmp`:

```bash
ssh root@167.233.69.121 'node -' < <script>.mjs
# or, when the script takes arguments:
ssh root@167.233.69.121 'cat > /tmp/s.mjs && node /tmp/s.mjs <args>' < <script>.mjs
```

They import `harness/ideal-cost.mjs` from the box's own copy of the repo, so the pricing
arithmetic is the same code path the runner uses. They read `results/<run>/rows.json`, the raw
transcripts under `results/<run>/agent-state/`, and the base checkouts in `/root/.ss-eval/golden`.

## Order

| script | what it establishes |
|---|---|
| `01-sidechain-usage-classification.mjs` | the first-record-wins defect: which delegated requests are recoverable and which are absent |
| `02-block-split-content-loss.mjs` | how much assistant content the same defect discards (6.6× on main transcripts) |
| `03-imputation-calibration.mjs` | whether the context identity holds, and how well output tokens can be predicted |
| `04-sidechain-repair.mjs` | the repaired LOW/MID/HIGH inclusive column, with the 0.5% main-only reproduction gate |
| `05-corrected-headline.mjs` | the `screen-v3` headline on the repaired column, with the degenerate sensitivity |
| `gate2-c4-wholefile-replay.mjs` | C-4 optimistic token replay, swept over the line threshold |
| `gate3-c2-routing-loto.mjs` | C-2 leave-one-task-and-repo-out router, plus a 13,892-rule robustness family |
| `gate4-c3-context-reset.mjs` | C-3 context-reset simulation, swept over handoff size |
| `gate5-c9-edit-census.mjs` | post-C-1 failed-edit population, classified |
| `gate5-c9-addressability.mjs` | C-9 symbol addressability and the residual round-trip cost |
| `gate6-c5-dependency-audit.mjs` | external references in all 18 issues; the `pytask` evidence check |
| `gate789-preconditions.mjs` | C-6's base-tree premise and C-8's patch-pool diversity |
| `gate10-r1-localization-timing.mjs` | how many calls before the first-edit file appears |
| `gate10-r1-breakeven.mjs` | dossier carrying cost against removed early requests |
| `gate10-r1-top5.mjs` | top-5 localisation upper bound from each rollout's first retrieval call |

`04-sidechain-repair.mjs` writes `/tmp/rows-sidechain-repaired-<run>.json`, which
`05-corrected-headline.mjs` and `gate3-c2-routing-loto.mjs` then read. Run it first.

## Doctrine scripts (`d*`) — added 2026-08-14

These execute [`HANDOFF-EVIDENCE-DOCTRINE.md`](../HANDOFF-EVIDENCE-DOCTRINE.md) and are reported
in [`SLATE-A-CLOSE-RESULTS.md`](../SLATE-A-CLOSE-RESULTS.md) §9. Same rules: read-only, `$0`, no
model. `d1` runs first; the rest are independent of each other.

| script | what it establishes |
|---|---|
| `d1-census-and-control-set.mjs` | the 204/268 rollout denominators, and the fixed control set of 5 tasks that resolve 2 of 2 in **both** arms on all three harnesses |
| `d2-c4-census.mjs` | C-4's mechanism frequency (repeat reads) on all three harnesses, and its tier |
| `d3-c4-proximal-tokens.mjs` | C-4 in cumulative billed input tokens, and the naive-vs-true overstatement factor |
| `d4-c9-postfix-residual.mjs` | post-C-1 failed edits split by cause, with a four-shape gutter detector that tests whether anchor corruption is really gone |
| `d5-c9-stale-address-split.mjs` | splits "String to replace not found" into whitespace-mismatch / self-invalidated / phantom against the base tree |
| `d6-whitespace-lever-price.mjs` | prices those classes on the marginal-cost rule; the 74% figure comes from here |

`d3` reproduces the recorded C-4 codex figure (−2.69%) exactly, which is the check that the
replay machinery is unchanged.

## Slate-A residue scripts (`d13`-`d18`) — added 2026-08-17

These execute [`HANDOFF-SLATE-A-RESIDUE.md`](../HANDOFF-SLATE-A-RESIDUE.md) and are reported in
[`SLATE-A-RESIDUE-RESULTS.md`](../SLATE-A-RESIDUE-RESULTS.md). Same rules: read-only, `$0`, no model.

| script | what it establishes |
|---|---|
| `d13-c3-rederivation-census.mjs` | C-3's Gate 0: post-boundary re-derivation on the baseline, per build, and the ceiling it puts on the mechanism (0.64 calls/rollout) |
| `d14-c3-reset-repricing.mjs` | the same replay on ALL THREE cost columns — settles whether `idealUsd` vs `breakPricedUsd` mattered (it does not: identical to six decimals) |
| `d15-c3-surface.mjs` | C-3's response surface over handoff size AND trigger threshold, plus the base-prefix term that decides the lever, plus an unreachable per-rollout oracle |
| `d16-phase4-power.mjs` | Phase 4's power analysis from this corpus's own paired heterogeneity: ~465 tasks for a 5% cost effect at 80% power |
| `d17-c3-live-rederivation.mjs` | scores the C-3 LIVE A/B on the pre-registered proximal metric, with the diagnosis/apply boundary matched across one-phase and two-phase cells |
| `d18-r1-live.mjs` | scores the R-1 LIVE A/B on its pre-registered metric (retrieval calls before the first edit), with the dossier-delivery Gate 0 in the same output |

**One parsing trap these fix, and it is worth knowing before writing another trace script.** Codex
encodes the shell command differently by CLI version: 0.146 emits `custom_tool_call` whose `input`
is a JS snippet (`const r = await tools.exec_command({cmd:"ss-grep …"})`), while 0.141 emits
`function_call` with `{"command":["bash","-lc","…"]}`. A parser that classifies by first token sees
`const` or `bash` and files **every** retrieval as `other`. `codexCommandOf()` in `d13`/`d17`/`d18`
unwraps both. `d12`'s regex approach is immune to this but has the `&&`-chain trap instead
(`HANDOFF-SLATE-A-RESIDUE` §1.5 #2); these scripts split on `&&`/`;`/`|` and classify each segment.

## What they do not do

They never read `patch`, `test_patch`, `FAIL_TO_PASS` or `PASS_TO_PASS` from the task file. Where
task metadata is needed — repo, base commit, language, problem statement — only those fields are
touched, and `gate3` says so in a comment at the read site. `gate789` inspects the `bingo` **base**
tree only.
