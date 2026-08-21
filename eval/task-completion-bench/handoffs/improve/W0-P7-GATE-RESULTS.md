# W0 gate — P7 local repair forge

**Executes:** [`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §9 W0, row "P7 forge", and §4 P7
falsifiers 1–5, under [`W0-P7-PREREGISTRATION.md`](./W0-P7-PREREGISTRATION.md) (committed at
`3454123`, **before** any figure existed).
**Date:** 2026-08-21 — **Model spend: `$0`.** No rollout. Existing artifacts only.
**Protected state:** remote `results/` not mutated; the Dart golden was copied, never written
to, and the copy deleted; HO2 untouched.
**Artifacts:** [`p7-20260821/`](./p7-20260821/) — `census.json` (192 rollouts, per-rollout),
`numbers.json` (every figure below), `discriminability.txt`.
**Instruments:** [`w0-p7-addressability.mjs`](./phase1-scripts/w0-p7-addressability.mjs),
[`w0-p7-discriminability.mjs`](./phase1-scripts/w0-p7-discriminability.mjs).

---

## 0. Verdict

**P7 passes its pre-registered bar on all three harnesses, and it passes as a COST program
only. Its selection loop is blind on 7 of 16 tasks, so nothing here licenses a resolution
claim. Two of the four secondary falsifiers came back more interesting than the headline.**

| pre-registered bar | result |
|---|---|
| dollar addressability `A ≥ 30%` on the sweet arm, realized pricing | **codex 31.6% · opencode 34.4% · claude-code 43.5%** — passes on all three |
| implied cost move `0.5 × A ≥ 15%` materiality | **15.8% · 17.2% · 21.8%** — passes on all three, codex by 0.8pp |
| Gate 0: every patch-producing rollout has a checkpoint | **188/188**, zero misses |

**The two figures that matter more than the pass.**

**Native's addressability is HIGHER than sweet's — 42.5% against 37.9%.** The forge is a
sweet-only vehicle, but the money it is bidding for sits disproportionately in the arm we are
not shipping it to. Building it narrows sweet's own cost lead in relative terms unless the
saving is larger than native's equivalent headroom.

**The visible test suite cannot reject a wrong patch on 7 of 16 tasks.** 56 of 192 rollouts
finished with the full visible suite green and still failed grading. A forge selects
candidates by running tests locally; on those 7 tasks it would select a wrong patch with
full confidence. They are exactly the tasks with resolution headroom.

---

## 1. What was measured, and the one choice that decides everything

The checkpoint is the API turn containing the rollout's first file-mutating tool call, and
**that turn is charged to BEFORE the checkpoint**. The forge cannot avoid paying for the turn
in which the model commits to an edit. Charging it the other way would have raised every
number below; the pre-registration fixed the conservative direction in advance.

`A` is the share of sweet's total realized spend that sits after a checkpoint on a rollout
where the final patch was already localized. Realized (cache-discounted) pricing is the bar
because it is the money actually spent and it is the smaller of the two available columns.

## 2. Headline

Sweet arm, 96 rollouts, `dotnet__yarp-2825` excluded as ungradeable (D1).

| harness | n | sweet total | `A` realized | `A` break-priced | `0.5 × A` | localized |
|---|---:|---:|---:|---:|---:|---:|
| codex | 32 | `$0.261850` | **31.6%** | 27.0% | 15.8% | 30/32 |
| opencode | 32 | `$0.209838` | **34.4%** | 34.4% | 17.2% | 29/32 |
| claude-code | 32 | `$0.421861` | **43.5%** | 46.1% | 21.8% | 29/32 |
| all | 96 | `$0.893549` | **37.9%** | 37.5% | 18.9% | 88/96 |

**Disclosure — codex fails the bar under break-priced accounting: 27.0%, not 31.6%.** The
pre-registration named realized as the bar and break-priced as sensitivity, so codex passes;
but codex is the marginal harness under either column and its `0.5 × A` of 15.8% is 0.8pp
above a 15% materiality threshold. Do not describe codex as a comfortable pass.

**Sensitivity — the two degeneration-flagged rollouts removed:**

| harness | n | `A` realized | `0.5 × A` |
|---|---:|---:|---:|
| codex | 32 | 31.6% | 15.8% |
| opencode | 32 | 34.4% | 17.2% |
| claude-code | 31 | 37.4% | 18.7% |
| all | 95 | 34.9% | 17.4% |

The bar survives without the outliers, at `−3.0pp` overall. Claude-code carries the whole
sensitivity: removing one rollout costs it `6.1pp`.

**Native, for context and never as the bar:**

| harness | `A` realized | localized |
|---|---:|---:|
| codex | 40.3% | 32/32 |
| opencode | 39.3% | 31/32 |
| claude-code | 46.1% | 32/32 |
| all | **42.5%** | 95/96 |

Sweet front-loads: it spends more before the first edit, so proportionally less of its money
is sitting where the forge would stand. That is a coherent picture of the two arms and it is
bad news for P7 as a *differential*.

## 3. Localization is near-total, and it is not the story

88 of 96 sweet rollouts had every final-patch file in the trace before they edited. The eight
that did not are two tasks and no more:

- `dart-lang__http-1114` — 7 patch files, 5 or 6 seen. This is the API-cascade task; the
  files it had not yet seen are the ones the cascade later dragged in.
- `mransan__ocaml-protoc-202` — empty patch, so nothing to localize. The refusal task.

This replicates the slate's own executive verdict from a different direction: the frontier is
not localization. It also means `L` is doing almost no filtering work in the ratio above —
`A` is essentially "post-checkpoint spend", `43.3%` of the arm before the `L` filter.

## 4. Discriminability — the finding that bounds P7 hardest

The harness's `run_tests` wrapper emits one machine-readable verdict line in every language,
so this is exact rather than estimated:

```
[run_tests verdict] status=PASS scope=full exit=0
```

A rollout is a **false green** if it ended on a full-scope PASS and still failed grading.

- **56 of 192 rollouts are false greens.** 127 ended green on the full visible suite; 44% of
  those were wrong.
- **7 of 16 tasks have at least one false green** and are therefore not locally selectable:
  `codeception` 12/12, `bingo` 12/12, `dashbitco` 11/12, `dart` 10/12, `pytask` 8/12,
  `gradethis` 2/12, `akinsho` 1/12.

The four tasks with 12/12 or 11/12 false greens are the ones every earlier program in this
slate has been trying to flip. A forge that runs the visible suite to reject candidates gets
no signal on any of them.

**This does not fail the gate** — the pre-registration put the bar on `A` precisely because
P7 is a cost program, and a forge can save money while resolving nothing extra. It does mean
any future document describing P7 as a path to more solved tasks is contradicted by this
measurement.

## 5. The four secondary falsifiers

### F3 — Dart impact edges: PASS, and the failure was demand, not supply

`ss-trace BaseResponse`, run against the `dart-lang__http` golden at base
`5c75da6e0841…` on a deleted copy, returns in 44 ms:

```
fan-in=2 fan-out=3
answer checklist: key symbols=BaseResponse, StreamedResponse, Response
answer cues: top callers=extends StreamedResponse (…/streamed_response.dart:11)
                       | extends Response (…/response.dart:16)
answer cues: critical paths=… IOStreamedResponse@…/io_streamed_response.dart:11
                              -> StreamedResponse@…:11 -> BaseResponse@…:12
```

The recorded cascade touched 8 distinct files across two reps. Three of them are actual
`BaseResponse` implementors — `response.dart`, `streamed_response.dart`,
`io_streamed_response.dart` — and **`ss-trace` names all three**, the transitive one
included. The bar is met.

**The honest reading is worse for the slate than a fail would have been.** The other five
files in the cascade are construction sites, not implementors, so the blast radius as a whole
is reported at 3 of 8. And the tool already had the answer while the model never called it —
the slate records `ss-trace BaseResponse impact` as never invoked in that rollout. That is
the third independent instance in this programme of the same shape: **the information is
available and the agent does not ask for it.** The first two were P1's dependency reach and
the seven-wording boundary smoke.

### F4 — edit fumbles: the slate's estimate was low by roughly three times

A fumbled edit wastes the turn that issued it, so the recoverable money is that turn's
realized cost.

| harness | arm | turns lost | cost | share of arm |
|---|---|---:|---:|---:|
| codex | sweet | 0 | `$0.000000` | 0.0% |
| codex | native | 0 | `$0.000000` | 0.0% |
| opencode | sweet | 4 | `$0.002451` | 1.2% |
| opencode | native | 6 | `$0.004036` | 1.6% |
| claude-code | sweet | **32** | **`$0.056597`** | **13.4%** |
| claude-code | native | 15 | `$0.028661` | 7.0% |

The slate put `ss-edit`'s ceiling at "2–5%, below the standalone bar". On claude-code it is
**13.4% of the whole sweet arm**, and it is asymmetric: sweet loses `$0.0279` more than
native to this, which is **larger than the entire raw claude arm cost gap** the slate spent
its executive summary qualifying (`$0.009493`).

Why the edits failed, classified from the error text (claude, both arms; the native column
here counts 18 because it includes YARP, which the census excludes — the three extra are all
YARP native):

| cause | sweet | native | anchored editing fixes it? |
|---|---:|---:|---|
| string to replace not found | 20 | 7 | yes — this is the anchor problem |
| file does not exist / wrong path | 6 | 4 | yes — symbol addressing removes the path |
| payload unparseable (degenerate) | 2 | 1 | yes — the payload-size guard |
| old and new string identical | 3 | 5 | no — a reasoning error |
| file modified since read | 1 | 0 | index reconciliation, not anchoring |
| more than one match, `replace_all` false | 0 | 1 | no |

**28 of sweet's 32 fumbles are addressing failures.** `ss-edit` is not hygiene. It is the
single largest measured, arm-asymmetric, mechanically-fixable cost item in the whole slate,
and it needs no retrieval change, no analyzer, and no new corpus.

Codex is at zero because it edits through `apply_patch` inside `exec`, which either applies
or reports at the shell level; the fumble surface is a property of the tool-call editor.

### F5 — degeneration: the pre-registered detector was wrong

**This is a defect of the pre-registration and is recorded as one rather than repaired
silently.** The registered detector was "any single tool-call input exceeds 50,000 bytes".
It finds nothing: **the largest tool input in all 192 rollouts is 6,166 bytes.** The runaway
payload never reaches the transcript as a tool call — it is rejected, and it survives only
inside the *error result*:

```
InputValidationError: Edit was called with input that could not be parsed as JSON.
You sent (first 200 of 127666 bytes): {"file_path": …
```

That is the slate's 127,666-byte payload, located exactly. Since F5 is explicitly not part
of the bar, the detector was re-derived from the corpus rather than re-registered: flag a
rollout if any single turn's output tokens reach 16,000, half the observed 32,000 cap.

The corpus separates without any tuning. **Every rollout in all three harnesses tops out
below 3,929 output tokens in a turn, except two that hit exactly 32,000.**

| harness | task | arm | rep | max out-tokens | realized cost |
|---|---|---|---|---:|---:|
| claude-code | pytask | **native** | 1 | 32,000 | `$0.038542` |
| claude-code | pytask | **sweet** | 0 | 32,000 | `$0.047199` |

One in each arm, both on the same task. D3's claim that degeneration is arm-neutral holds.
Any threshold between 4,000 and 32,000 selects the same two rollouts.

### F1b — the arithmetic, stated rather than asserted

`0.5 × A` against the 15% materiality bar: **codex 15.8%, opencode 17.2%, claude-code 21.8%**;
with degeneration excluded, 15.8% / 17.2% / 18.7%. The claim "a forge that halves
post-checkpoint spend clears 15% on every harness" is true **only if the halving assumption
holds**, which nothing here tests. On codex it survives a 15% bar with 0.8pp of room, so a
40% local saving rather than 50% would fail there.

## 6. Measurement integrity

**Gate 0.** The first detector said all 32 opencode rollouts contained no edit at all. That
was a detector bug: opencode's editor is `apply_patch`, not `edit`/`write`. The harness's own
`toolCounts.edit` is also unusable as ground truth — it reads 0 on codex rollouts that
plainly produced patches, because codex packs `apply_patch` inside `exec`. The test that
cannot be wrong is the patch itself: **188 rollouts produced a non-empty `model_patch`, and
all 188 have a detected checkpoint.** The 4 empty-patch rollouts are the mransan refusals.

**Cost reconstruction.** The retained `turns/` ledger is written once per `(task, arm)`, so
rep 1 overwrote rep 0 and it cannot price rep 0 at all. Per-turn usage was therefore rebuilt
from each rep's own raw trace using the same extraction the harness adapters use.
**128 of 192 reproduce `realFromTurnsUsd` exactly** (within `$0.000005`) — every codex and
every opencode rollout. The 64 that do not are all claude-code, my reconstruction is *higher*
in every case, and the cause is documented in `claude-code-accounting.mjs`: the aggregate
`result.usage` omits one served request per rollout and the transcript is a strict superset.
The claude turn *counts* match the harness module's own
`turnsFromTranscriptFile` on **64 of 64**. Numerator and denominator come from the same
reconstruction, so the ratio is unaffected either way.

**Not measured.** Local compute. A forge spends GPU, CPU and wall time that this gate does
not price at all, and the slate's own release gate requires it to remain favourable after
that charge.

## 7. What to do with this

1. **Build `ss-edit` first, not the forge.** F4 is a measured 13.4% arm-level cost item on
   claude-code, asymmetric against sweet, with 28 of 32 failures mechanically addressable. It
   is a bounded piece of work with no analyzer, no corpus, and no new retrieval behaviour. The
   forge is months; this is not.
2. **P7 survives W0 as a cost program.** It does not survive as a resolution program, and §4's
   ceiling arithmetic should be read with §4 above: on 7 of 16 tasks the forge's own selection
   signal is false 100% of the time.
3. **Price native's headroom before committing.** At 42.5% against sweet's 37.9%, the same
   architecture applied to a native baseline would save more. That is not a reason to skip it,
   but it is a reason not to describe it as a competitive moat.
4. **Do not re-run this gate to get a friendlier number.** If the definition is challenged,
   re-register separately; `W0-P7-PREREGISTRATION.md` is not to be edited.
