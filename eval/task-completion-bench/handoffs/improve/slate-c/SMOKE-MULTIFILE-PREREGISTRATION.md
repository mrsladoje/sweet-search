# SMOKE PRE-REGISTRATION — 20 multi-file, larger-repo tasks

**Written 2026-09-02, before launch. Nothing here may be changed once the run starts.**
Written after the eleven Slate C fixes landed (`ca4bf91` … `d91b6c0`) and before any rollout.
Spend so far this session: **$0**.

**One sentence.** This smoke asks whether the fixed harness changes anything on the one
population where a structural code index has a published same-harness win — multi-file patches
in larger repositories — and it is pre-registered to expect **no**.

---

## 1. Why this population, and why it is a fair test rather than a favourable one

The two pools measured so far had close to zero retrieval headroom. The fresh pool's median gold
patch touches **1 file**, its median golden holds **310 tracked files**, and only **2 of 21**
repositories exceed 1,000 files. The rotation pool is the same shape. A retrieval tool cannot
show a retrieval effect on tasks that need no retrieval.

The only published same-harness win for a structural code index is on multi-file patches in
repositories above 1,000 files. The first held-out set (DEV-RET) is **74 of 200** multi-file
after the gate and **38 of 200** above 1,000 files, so the stratum exists there and DEV-RET is
DEV data — per-task inspection is allowed and expected. The frozen set is representative of
SWE-rebench and is **not** re-drawn for this.

**Read this as the honest framing it is.** Choosing the population where an effect is most
likely is not cheating when it is declared in advance and when the pre-registered expectation
is still "no effect". It is the last place the retrieval story can live. If sweet cannot beat
native on cost here, the retrieval-headroom story is dead for this population too, and that
is the finding.

---

## 2. The pool: 20 tasks, selected by metadata, outcome-blind

Selected by `handoffs/improve/slate-c/smoke-select.py` from DEV-RET, re-run 2026-09-02.
**108 candidates** passed the screen; these 20 are the default set, all DEV-RET.

Screen, every criterion metadata-only and outcome-blind:

- selection gate: `FAIL_TO_PASS < 100` and `PASS_TO_PASS >= 1` (`select/task-gates.json`)
- gold patch touches **≥ 2 EXISTING source files** and creates none
- the issue text names **none** of the gold source files (localisation is not given away)
- issue text > 200 characters
- no vacuity marker in `FAIL_TO_PASS` (widened marker, `VACUITY-PRESCREEN-RESULTS.md`)
- **not name-locked**, stamped against the vault goldens
- at most one task per repository; language spread across 9 languages
- "used before" is reported, not excluded — none of these 20 was used before

| task | lang | gold src files | F2P | P2P | repo tracked files | golden |
|---|---|---:|---:|---:|---:|---|
| `getmoto__moto-6716` | python | 6 | 1 | 269 | 2053 | reuse |
| `python-markdown__markdown-1294` | python | 4 | 2 | 27 | 488 | reuse |
| `mirumee__ariadne-codegen-223` | python | 2 | 39 | 94 | 310 | reuse |
| `projectlombok__lombok-3619` | java | 5 | 1 | 1162 | 2290 | **REBUILD** |
| `squashql__squashql-295` | java | 15 | 2 | 15 | 526 | **REBUILD** |
| `eclipse-ee4j__yasson-395` | java | 5 | 1 | 61 | 562 | reuse |
| `gleam-lang__gleam-3458` | rust | 2 | 30 | 2585 | 2111 | **REBUILD** |
| `rust-analyzer__rust-analyzer-2616` | rust | 6 | 1 | 308 | 952 | reuse |
| `raphlinus__pulldown-cmark-754` | rust | 2 | 1 | 997 | 114 | reuse |
| `maxgraph__maxgraph-365` | ts | 2 | 2 | 40 | 784 | **REBUILD** |
| `vazco__uniforms-787` | ts | 3 | 10 | 895 | 583 | reuse |
| `firebase__firebase-tools-2933` | ts | 2 | 3 | 801 | 567 | **REBUILD** |
| `joshuakgoldberg__bingo-271` | ts | 10 | 8 | 406 | 379 | **REBUILD** |
| `rokucommunity__brighterscript-1050` | ts | 4 | 2 | 1863 | 248 | reuse |
| `yargs__yargs-1422` | js | 5 | 3 | 545 | 120 | reuse |
| `singapore__renovate-1153` | js | 2 | 6 | 584 | 255 | reuse |
| `chaijs__chai-990` | js | 3 | 17 | 288 | 65 | reuse |
| `jensneuse__graphql-go-tools-174` | go | 2 | 1 | 659 | 187 | **REBUILD** |
| `sqlkata__querybuilder-557` | csharp | 2 | 1 | 304 | 95 | reuse |
| `intel__rohd-458` | dart | 3 | 4 | 410 | 303 | reuse |
Language spread: python 3, java 2, rust 3, ts 5, js 3, go 1, csharp 1, dart 1 — one repository
each. Gold source files per task 2–15 (median 3); repositories 65–2,290 tracked files, **6 of 20
above 500 and 4 above 900**, against the fresh pool's 2 of 21 above 1,000.

### 2.1 Name-lock census — run, and it is not optional

`node select/stamp-name-lock.mjs --tasks select/.cache/smoke-candidates.json --golden
~/.ss-eval/vault/golden --report-only`, 2026-09-02:

| | |
|---|---:|
| tasks in the screened pool | 108 |
| examined (base tree available) | 66 |
| not examined (no local base tree, so unstamped) | 42 |
| **name-locked — naming lotteries** | **15 (22.7% of examined)** |

**All 20 of the pool above are stamped clean.** Multi-file tasks are MORE often naming
lotteries than the general population, which is why the stamp is mandatory here and not a
formality. The 15 excluded: `jsx-eslint__eslint-plugin-react-3385`, `sindresorhus__emittery-121`,
`hdmf-dev__hdmf-752`, `knative__client-629`, `openrefine__openrefine-7247`,
`testing-library__svelte-testing-library-404`, `eslint-community__eslint-plugin-promise-365`,
`eslint__eslint-9905`, `painterqubits__unitful.jl-478`, `jimhester__lintr-562`,
`chicio__id3tageditor-54`, `pointfreeco__swift-case-paths-90`, `samchungy__zod-openapi-330`,
`dart-lang__http-1114`, `litestar-org__polyfactory-405`.

**One tension, flagged not resolved.** An earlier hint-ladder micro-smoke recorded "bingo and
dart are naming lotteries". Two of the 20 — `joshuakgoldberg__bingo-271` (ts) and
`intel__rohd-458` (dart) — are those families, and the frozen name-lock checker stamps both
**clean**. The checker is the declared mechanism and it wins here, but if either task's result
looks like a coin flip in the smoke, that observation belongs in the report, not in a
post-hoc exclusion.

Bigger DEV-200 candidates exist (`docker__compose-9148` 14 files, `serverless-12030` 10,
`basedpyright-85` 9, `argo-3371`, `carbon-2801`) but have **no local golden**, so they are
unstamped and inadmissible under the rule above. 42 of the 108 are unstamped for the same
reason; stamping them needs a base-tree checkout.

---

## 3. Design and price

| | |
|---|---|
| tasks × reps × arms × harnesses | 20 × 3 × 2 × 3 = **360 rollouts** |
| model | `openai/gpt-5.6-luna` via OpenRouter, all three harnesses |
| pins (unchanged, never pool across a move) | codex **0.146.1**, opencode **1.18.4**, claude-code **2.1.218** |
| price | **about $4.5** at the registered luna price, scaled from $10.87 for 891 rollouts |
| gutter | per-harness, pinned by the runners: claude-code `N<TAB>`, opencode `N:`, codex none |
| `pages` note | delivered to BOTH arms' main thread AND subagents, byte-identical |
| ledger basis | `cache-write-1.25x-all-harnesses`, printed beside every cost figure |

---

## 4. Outcomes, declared before the run

**Primary: solved rollouts per cell against native. Bar ±6 of 60.**

The bar is inherited from the 66-rollout cells, where the paired minimum detectable solve
effect at 80% power was 6.8 of 66. At 60 rollouts per cell this smoke has **less** power than
the run that set the bar, so a null result here is weaker evidence than a null result there.
Say so in the report rather than treating ±6 as a clean threshold.

**Secondary: cost per rollout** on the realised, ideal and break-priced columns, under both
conventions, with:

- the **ledger basis** printed beside every figure (`cache-write-1.25x-all-harnesses`), and the
  legacy basis reproducible from `costRealizedNoCacheWriteUsd` for any disclosure row
- claude-code's **construction** (row-matched vs dearest-3), its **null-row count per arm**, and
  the **lower-bound flag** — all printed automatically by `analyze-run.mjs` since `0c76217`
- the **`pages` asymmetry**, now repaired on both arms; report the failed-`pages` count per arm
  from the subagent transcripts, and expect it near zero

**Pre-registered expectation: no cell clears ±6 on solves.** On cost, this run's baseline is not
the fresh pool's — F1 moved the ledger and F2 moved native's request count — so no cost band is
pre-registered. Any cost figure from this run is a NEW baseline, not a comparison against the
fresh pool. Never pool the two.

**Nothing here may be published as a sweet win.** Every fix in this batch is shared measurement
repair or sweet-only product correctness with a zero benchmark claim. F2 in particular is
arm-symmetric by construction: if native improves, that is the repair of our own harness defect
and it is never reported as a sweet regression.

---

## 5. Stop rules

Abort, and do not report, if any of these fires.

1. **Green ledger is not on the new version.** The harness fingerprint moved
   `5bf17a2e8856494f` → `a2bdcbd44aa6bcd7` (F4 alone; measured, see register §14.4). Sweep the
   20 tasks on the new version before launching. Container time only, no model spend.
2. **A golden that needed a rebuild still carries a pre-2026-08-28 index.** Seven of the 20 need
   one; see §6.
3. **codex authentication is dead on the box** — abort the codex leg only, and say so.
4. **More than 4 of 20 tasks are flagged by the trustworthy-verdict census.** This census needs
   rollouts, so it runs on the smoke's own rows **before any admission filter is applied**, via
   `handoffs/improve/slate-c/fixes/f5-untrusted-cell-census.jq.sh <run>/rows.json`. It could not
   run before launch and this document does not pretend otherwise.

---

## 6. Goldens: verified present, seven need a rebuild

All 20 goldens are present **in the Mac vault and on the box**, each with `.git` and a
`codebase.db`. Every index dates from 2026-07-16 to 2026-07-22, i.e. **all predate the
2026-08-28 index fixes**.

The rule is the owner's own (18 of 267 rebuilt for the frozen set): rebuild ONLY the goldens
whose admitted file set actually moves. Computed at `$0` by comparing what the current admission
policy admits against what each golden's index holds:

| task | Jam files | git-tracked source under a build dir | committed bundles currently INDEXED | verdict |
|---|---:|---:|---:|---|
| `projectlombok__lombok-3619` | 0 | 0 | **14** | REBUILD |
| `joshuakgoldberg__bingo-271` | 0 | **21** | 0 | REBUILD |
| `gleam-lang__gleam-3458` | 0 | **13** | **1** | REBUILD |
| `firebase__firebase-tools-2933` | 0 | **2** | 0 | REBUILD |
| `squashql__squashql-295` | 0 | 0 | **1** | REBUILD |
| `maxgraph__maxgraph-365` | 0 | 0 | **1** | REBUILD |
| `jensneuse__graphql-go-tools-174` | 0 | 0 | **1** | REBUILD |
| the other 13 | 0 | 0 | 0 | reuse as-is |

**7 of 20 (35%)**, against 18 of 267 (6.7%) on the frozen set. The higher rate is what the
stratum is: larger repositories with build output are exactly where the content-shape and
build-directory rules bite. No task carries a `.jam` file.

Indexing happens on the owner's RunPod flow, **never on the box**; then vault →
`harness/golden-vault.sh push --verify`. Stamp each rebuilt golden with its index build (engine
version + index config hash) so the ledger can prove provenance (register G9).

---

## 7. Blinding

DEV-RET is dev data. **Per-task inspection is allowed and expected.** This is not a blinded
gate, and no result from it may be presented as one. The frozen held-out set (199) is untouched
by this run and is never opened per task.

---

## 8. The `$0` adaptive-budgeting census — an ANALYSIS, not a lever

Pre-registered here so it cannot be invented afterwards. Runs on the smoke traces only.

Per `ss-*` call, join the printed `confidence=`, the margin (top-1 minus runner-up), the tier,
the tokens returned and the `sufficient=` verdict with what the agent did next: a further read
of the same file or not, solved or not. Report two things:

1. Does high confidence + high margin predict "no further read of the same file AND solved"?
2. On the repositories above 1,000 files specifically, what is the trimmable surplus — tokens
   returned minus tokens the agent later anchored an edit or a test on, excluding documentation
   comments?

Build a running budget **only if** the signal predicts sufficiency AND that surplus on large
repositories is clearly above the 1.9% general-pool ceiling. Either way it is a lever for the
run AFTER the frozen one (owner decision D3), not for this one.

---

## 9. Launch

Only after every box in §10 is ticked. The owner launches; this session does not.

```sh
# on the box, once per harness. RUN_ID and HARNESS change; nothing else does.
cd /root/sweet-search-private/eval/task-completion-bench

# 0. green ledger on the NEW fingerprint (container time only, no model spend)
node harness/env-ledger-sweep.mjs \
  --tasks select/.cache/smoke-candidates.json \
  --ids   handoffs/improve/slate-c/smoke20.json \
  --out   /root/env-ledger/luna-smoke20-v5

# 1. the run, per harness
RUN_ID=sm-codex-20260902      HARNESS=codex       \
TASKS_FILE=select/.cache/smoke-candidates.json    \
INSTANCES="$(paste -sd, handoffs/improve/slate-c/smoke20.txt)" \
MODEL=openai/gpt-5.6-luna REPS=3 ARMS=native,sweet CONCURRENCY=1 \
ENV_LEDGER=/root/env-ledger/luna-smoke20-v5/ledger.jsonl \
  node harness/run-pilot.mjs

# ...then HARNESS=opencode (RUN_ID=sm-opencode-20260902)
# ...then HARNESS=claude-code (RUN_ID=sm-claudecode-20260902)

# 2. read it
node harness/analyze-run.mjs results/sm-<harness>-20260902/rows.json
sh handoffs/improve/slate-c/fixes/f5-untrusted-cell-census.jq.sh \
   results/sm-*-20260902/rows.json          # stop rule 4, BEFORE any admission filter
```

`codex exec` authentication on the box was dead on 2026-08-28. Check it before launching the
codex leg; if it is still dead, run the other two and say the codex leg did not run.

---

## 10. Launch checklist

- [x] Gutter commit landed; F1–F11 landed as separate commits with tests
- [x] `npx vitest run` green (7,552 tests; the four daemon/maintainer spawn files are
      load-flaky in the full run and pass in isolation — re-run and confirmed)
- [x] `npm run lint` clean
- [x] F1 reproduces **opencode +2.52% / codex +0.06%** on the fresh-pool usage, through the
      shipped parsers, within 0.004 pp; every cost table prints its ledger basis
- [x] F2 emits `--append-subagent-system-prompt` for both arms; the pinned 2.1.218 binary
      accepts it (registration extracted from the deployed bundle)
- [x] F4: the accenture line is not INFRA; tally re-run over 284 grader logs in all 12
      fresh-pool runs — 15 of 15 accenture logs flip, nothing else moves
- [x] F5 counters present and verified on synthetic rollouts
- [x] F6/F7 `$0` replays return zero bare `(no matches)` and zero excluded-file bodies
- [x] F8/F9/F10 unit tests green
- [x] Register rows filed (F11)
- [x] Goldens: all 20 present on the box and in the vault, with `.git` and an index
- [x] The 20 screened clean and stamped not name-locked
- [ ] **New ledger version named and swept** for the 20 on the new fingerprint
- [ ] **Seven goldens rebuilt on RunPod and stamped**, then pushed to the box
- [ ] Trustworthy-verdict census run on the smoke's own rows (≤ 4 of 20 flagged) — post-run
      stop rule, cannot run before launch

The two unticked build items and the post-run census are the owner's, not this session's.
