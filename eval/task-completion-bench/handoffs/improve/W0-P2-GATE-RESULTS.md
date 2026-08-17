# W0 gate — P2 terminal family-residue audit

**Executes:** [`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §9 W0, row "P2 residue audit"<br>
**Date:** 2026-08-17 — **Model spend: `$0`** (no agent rollout; compute was `git archive`
plus greps over recorded patches)<br>
**Protected state:** remote `results/` not mutated; golden checkouts never written to —
every tree was materialised with `git archive` into a temp dir and deleted; HO2 untouched.

---

## 0. Verdict

**P2 survives both kill conditions, and it survives them cleanly.**

| W0 required output | result |
|---|---|
| replay over the sweet final diffs | **99 patch records replayed**, 78 of them admissible; 0 errors, 0 apply failures |
| must not miss `countBy` | **2 of 2** losing Underscore sweet patches surface `countBy`, by name |
| must not flood solved work | **4 residue items across 38 resolved cells** — median 0, max 1 item per cell |

The kill condition was "misses `countBy` **or** produces an unusably noisy terminal
list". Neither happened. The strongest evidence is not either number on its own but that
the same instrument separates them: on one task, one file, one stem, it fires on the two
cells that failed and stays silent on the four that passed.

---

## 1. Sensitivity — the trace P2 exists to catch

Both Claude sweet reps produced the identical one-line patch, replacing the stem inside
`groupBy` and leaving it inside `countBy`:

```
-    if (_.has(result, key)) result[key].push(value); else result[key] = [value];
+    if (hasOwnProperty.call(result, key)) result[key].push(value); else result[key] = [value];
```

The replay derives exactly one stem, `_.has(result, key)`, and finds exactly one
surviving occurrence:

```
underscore.js:461  symbol=countBy  |  if (_.has(result, key)) result[key]++; else result[key] = 1;
```

**The data supplies its own control.** Codex and opencode sweet changed **both** call
sites in all four of their reps, resolved the task, and score **zero** residue.

| harness | rep | resolved | residue | names `countBy` |
|---|---|---|---|---|
| claude-code | 0 | **false** | 1 item | **yes** |
| claude-code | 1 | **false** | 1 item | **yes** |
| codex | 0, 1 | true | 0 | — |
| opencode | 0, 1 | true | 0 | — |

Six cells, same task, same file, same stem, perfect separation, no error in either
direction. That is a discriminating control, not a coincidence of thresholds.

### A design constraint the gate settled

A **whole-line** residue check cannot do this. The base tree holds the stem twice:

```
448:    if (_.has(result, key)) result[key].push(value); else result[key] = [value];   <- groupBy, patched
461:    if (_.has(result, key)) result[key]++;           else result[key] = 1;         <- countBy, left alone
```

The two lines share the stem and diverge immediately after it. Line-granular residue
scores **zero** on the only trace P2 exists for. `ss-audit` must extract a **sub-line
span** — the removed-only token run against its best-matching replacement, extended to
the balanced group that follows so a call name keeps its arguments. That yields
`_.has(result, key)`, which is both sensitive and specific. This is a requirement on the
build, not a tuning preference.

---

## 2. Specificity — what the audit says about work that was already right

Span granularity, scope limited to the files the patch touched, over the **38 resolved
admissible sweet cells**. Every item here is a false positive by construction.

| granularity / scope | cells with any residue | median | p90 | max | total items |
|---|---|---:|---:|---:|---:|
| **span / touched** | **4 of 38 (10.5%)** | 0 | 1 | 1 | **4** |
| span / repo | 12 of 38 (31.6%) | 0 | 3 | 3 | 22 |
| line / touched | 2 of 38 (5.3%) | 0 | 0 | 1 | 2 |
| line / repo | 8 of 38 (21.1%) | 0 | 3 | 3 | 18 |

**All four false positives are the same stem in the same task.** `user, solution)` in
`rstudio-education__gradethis-161`, two hits each:

```
R/detect_mistakes.R:68  symbol=if  |  if (!identical(user, solution)) {
R/grade_code.R:103      symbol=if  |  if (is_code_identical(user, solution)) {
```

A worst case of one item and two lines is a two-line disposition table, not a flood.

**Two scope decisions fall out of this.** Repo-wide search costs five times the noise for
no measured gain, so `ss-audit` scopes to touched files. Line granularity is quieter
still but is dead on §1, so it is not an option.

---

## 3. Is the quiet real?

The specificity number only counts if the audit is silent because there was nothing to
say. **36 of 78** admissible sweet cells derived zero stems, which needed explaining
rather than assuming.

| category | cells | verdict |
|---|---:|---|
| purely additive patch (`removed = 0`) | 9 | correct by construction — P2 predicts this ("additive Dart changes would not trigger a replaced-stem audit") |
| replaced something, audit silent | 27 | explained line by line below |
| produced stems | 42 | — |

Every removed line inside those 27 cells, with its reason:

| reason | lines | is it correct silence? |
|---|---:|---|
| ABSORBED — the replacement is a superset of the removed line; nothing was displaced | 17 | yes |
| KEPT — the replaced text is re-used elsewhere in the same patch | 11 | yes |
| REJECTED — a span was derived and the meaningfulness filter dropped it | 9 | yes, see below |
| SHOULD-HAVE-FIRED — a real span, not kept, and still no report | **0** | — |

The 9 REJECTED lines are **two shapes**, both genuinely un-auditable:

- `!=` — from `if (length(unique(lengths)) != 1) {`. The agent swapped a comparison
  operator. Searching a repository for `!=` is pure noise.
- `dt', '` — from a Python list literal that gained an element. A fragment of string
  punctuation, not a reference to anything.

**Stem yield across admissible cells: median 1, p90 7, max 19, total 117.** The extractor
is not globally dead; it is quiet where the patches were additive or self-contained.

---

## 4. What the audit says on cells that FAILED

Beyond the noise question, the 40 unresolved admissible cells show what a real terminal
report would contain. Seven items in total:

| task | stem | reading |
|---|---|---|
| `jashkenas__underscore-2757` ×2 | `_.has(result, key)` | **the target** |
| `apple__swift-nio-http2-145` ×3 | `halfClosedLocalPeerIdle, .` | the state-family residue P2's Apple support predicted — the agent pulled one state out of one `case` list; three other `case` lists still carry it |
| `rstudio-education__gradethis-161` | `user, solution)` | false positive (the §2 shape) |
| `dart-lang__http-1114` | a `TODO(nweiz)` comment | noise |

Five of seven point at real family residue. The Apple hits are **composition support
only** and are not an independent task claim, per SLATE-B §P2.

---

## 5. Instrument reliability

The P1 gate's probe was wrong five times, so nothing here was trusted before it was
controlled. P2 is the harder case: its two halves fail in **opposite** directions — an
under-report kills the proposal on §1 and *flatters* it on §2 — so a one-sided sanity
check could not certify the replay.

**11 controls**, written against answers established by hand from the base tree before
any code existed, and they caught two real defects before the sweep ran:

| defect | direction | effect if unfixed |
|---|---|---|
| a minimum-character-length filter on stems | under-report | `_.has` is five characters; the filter dropped the one stem the gate turns on, and P2 would have died on a threshold |
| the same filter accepted `#endif` | over-report | a bare preprocessor directive would have entered the residue list |

Character length was the wrong axis. What separates `_.has` from `#endif` is
**structure**: residue matters when the agent replaced a *reference* — a call, member
access, index or assignment. That rule passes both.

**The silence audit invented two bugs of its own.** Its first version used a cruder
similarity function than the replay, paired the removed line with the wrong replacement,
and reported two `SHOULD-HAVE-FIRED` verdicts against a replay that was behaving
correctly (`dart-lang__http-1114`, where the agent hoisted the expression into a local
rather than deleting it). Sharing the replay's own function took it to zero. A diagnostic
that does not share the pipeline it audits manufactures its own findings.

### Denominator

SLATE-B says "102 sweet diffs". The recorded artifacts hold **99**. The three absent are
all `mransan__ocaml-protoc-202` — `model_stopped`, zero hunks, and already blocked as
unmeasurable. The admissible denominator is exactly complete: **78 = 13 tasks × 3
harnesses × 2 reps**, no gaps.

---

## 6. One post-hoc design note, clearly labelled

Not part of the gate verdict. Identified **after** seeing the false-positive list, so
quoting it as the gate number would be tuning the instrument to the evidence it weighs.

Every false positive was an unbalanced fragment (`user, solution)` — an argument-list
tail beginning mid-expression). Requiring a **bracket-balanced stem**:

| population | as run (cells/items) | balanced-only |
|---|---|---|
| resolved (false positives) | 4 / 4 | **0 / 0** |
| unresolved | 7 / 7 | 6 / 6 |
| all admissible | 11 / 11 | 6 / 6 |

`countBy` is still found **2 of 2**. Carry the rule into the build; do not restate the
gate result with it.

---

## 7. Gate verdict and what it does not prove

**P2 is NOT killed.** Its `$0` falsifier asked whether the residue is derivable and
whether the derived list is clean. Both answers are yes, with margin.

**Ceiling unchanged at +1 claude-code task** on Underscore. Nothing here supports more,
and the Apple hits are explicitly composition-only.

**The gate proves the list exists, not that the model acts on it.** A residue report at
the completion boundary is worthless if the agent closes anyway — which is exactly what
Claude did on Underscore, writing "1561 of 1562 tests passed — no failures introduced"
without mentioning `countBy`. Whether delivering a concrete two-line defect list changes
that is a behavioural question, and only the paid Phase-2 micro-confirmation can answer
it. The pre-registered cost estimate stands: roughly one call and 300–600 output tokens
per triggered rollout.

**Requirements this gate places on any `ss-audit` build:**

1. **Sub-line span extraction is mandatory.** Line granularity scores zero on the
   motivating trace.
2. **Scope to the files the patch touched.** Repo-wide costs five times the noise for no
   measured gain.
3. **Require a bracket-balanced, structure-bearing stem.** Rejecting bare operators,
   literal fragments and unbalanced tails is what keeps the list to a handful of lines.

**Unchanged:** NO-GO for a paid pilot until Phase 0's remaining items close. Two `$0`
gates now stand: P1 (corpus broadly available, demand thin) and P2 (mechanism clean).

---

## 8. Artifacts

- `handoffs/improve/w0-p2-20260817/w0-p2-residue.json` — per-cell stems, residue items and hits
- `handoffs/improve/w0-p2-20260817/scoring.txt` — §1, §2 and the full false-positive list
- `handoffs/improve/w0-p2-20260817/silence-audit.txt` — §3, one reason per removed line
- `handoffs/improve/w0-p2-20260817/controls-and-balance.txt` — the 11 controls and §6
- `handoffs/improve/w0-p2-20260817/w0-p2-sweep.log` — the replay transcript
- `phase1-scripts/w0-p2-residue-replay.mjs` — stem extraction and the replay
- `phase1-scripts/w0-p2-controls.mjs` — the controls; run this before trusting any number above
- `phase1-scripts/w0-p2-silence-audit.mjs` — why a cell was quiet
- `phase1-scripts/w0-p2-analyze.mjs`, `w0-p2-balance-sensitivity.mjs` — scoring
