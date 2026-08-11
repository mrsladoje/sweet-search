# RUN LEDGER — lever #4, bounded repair-completeness card

Operator: Claude (session 2026-08-11). Protocol: `/microsmoke` + `HANDOFF-COMPLETENESS-CARD.md`.
Backbone if Phase 1 is reached: `openai/gpt-5.6-luna` via codex subscription on the box
(root@167.233.69.121), flat-rate → no metered dollars. HO2 is never touched.

---

## PRE-REGISTRATION (written BEFORE any case was labelled)

Timestamp: 2026-08-11, before Gate 0a enumeration output was read.

### The bar
Proceed to Phase 1 (build + live smoke) **only if ≥2 independent RETRIEVAL-STARVED
incompleteness cases exist** — teleport plus at least one more, on a **different repo and a
different symbol**. One case alone (teleport only) = overfit = lever #4 **DEAD**, GPT portfolio
formally closed, no spend.

### Label definitions (fixed in advance, adversarial default)
For each rollout classed `incompleteness` (`0 < f2pFrac < 1`), exactly one label:

- **RETRIEVAL-STARVED** — all three must hold:
  1. The disambiguating fact was **absent** from the agent's context window (never read, never
     returned by any tool call).
  2. The fact **was reachable** in the repo at the base commit (not introduced by the gold patch).
  3. I can **name the specific card field** (type declaration / identifying field / use-site list)
     that would have carried it, for the symbol the agent actually edited.
- **GENERATION-VARIANCE** — the fact **was** already in context (file read, tool output showed it)
  and the agent missed the sibling anyway. A card cannot fix this.

**Default is GENERATION-VARIANCE.** A case is promoted to STARVED only on positive evidence for
all three conditions above.

### Exclusions fixed in advance
- `underscore` and `gradethis` were adjudicated GENERATION-VARIANCE in the 2026-08-07 overnight
  loop. They do **not** count as starved without genuinely new evidence.
- `wrong-fix` (retrieval-independent floor) and `wrong-location` are **not** #4 targets. Not counted.
- Two reps of the **same task** count as **one** case (independence = distinct repo + symbol).
- HO2 rollouts are excluded from the pool entirely.

### Data sources declared in advance (dev + held-out-1 only)
- `luna-rotate18-run1` — 72 rollouts, 18 DEV rotate18 tasks, 2 arms × 2 reps (teleport's home run).
- `luna-poll-*` / `postfix-screen17` / `turnfix-v2screen-*` — same rotate18/20 task family.
- `codex-full200-*` and `heldout200-*` — heldout-200, **retired to DEV-RET on 2026-07-31**, so
  usable as dev data (held-out-1).

Arm of interest: **sweet** (the card is a sweet-arm affordance; a native incompleteness case is
not addressable by it).

---

## VERDICT — lever #4 is DEAD. Gate 0 failed. $0 spent. Portfolio formally exhausted.

**Qualifying RETRIEVAL-STARVED cases: 0 (strict) / 1 (most generous reading). Pre-registered bar: ≥2.**
No build, no live smoke, no model calls. HO2 untouched.

---

## Gate 0a — enumerate the incompleteness pool ($0)

### Data actually used
185 run directories on the box carry `rows.json`. Scope filter: `sweet` arm, unresolved,
`0 < f2pFrac < 1`, task present in rotate20 / heldout-1 / dev-200. **HO2 was excluded by task id**;
all three manifests were verified disjoint from HO2 (0 of 200 / 0 of 200 / 0 of 18 overlap), so no
frozen task entered the pool.

Raw pool: **155 sweet partial-fix rollouts across 61 distinct tasks.**

### Two measurement bugs found and fixed before any labelling
1. **Tool-call patch parsing silently failed on older runs.** The taxonomy's `apply_patch`
   extractor returned an empty touched-file set for every pre-August run, which faked a
   "touched no gold file" verdict on 26 tasks. Fixed by reading the authoritative final diff from
   `preds-sweet.jsonl` (`model_patch`) instead of re-parsing tool calls.
2. **`trajectories/*.json` truncate every tool result at exactly 600 characters.** A first
   containment pass over those files produced 13 "never in context" cases that were pure recording
   artifacts. All absence claims were re-derived from full-fidelity sources only — raw
   `rollout-*.jsonl` (codex runs) or `opencode.db` (opencode runs). Presence claims from truncated
   traces remain valid (a hit is a hit); absence claims from them were discarded.

### Structural triage of the pool
`#4` targets "edited the right symbol, missed a sibling site". Gold patches were split into
functional source files vs non-functional ones (changelogs, READMEs, docs, examples, lockfiles,
CI config, version bumps, test files) — a missed changelog cannot flip a FAIL_TO_PASS test.

| signature | rollouts | tasks |
|---|---|---|
| **A — edited a gold source file, missed a sibling gold SOURCE file** (#4's shape) | 59 | **24** |
| B — edited every gold source file, still partial (in-file partial) | 59 | 23 |
| C — edited only non-gold files (wrong location, not a #4 target) | 12 | 3 |

Signature A (24 tasks) is the candidate pool carried into Gate 0b.

---

## Gate 0b — the discriminator: starved vs variance ($0)

### The flagship, teleport, is disqualified — twice over
- **It is not an incompleteness case and never can be.** `teleporthq__teleport-code-generators-291`
  has **exactly 1 FAIL_TO_PASS test**, so `f2pFrac` is binary. Both sweet reps are `f2pFrac = 0.00`
  → classed **wrong-fix**, which the handoff explicitly excludes as a #4 target. There is no
  partial state for a card to convert.
- **The starvation claim is half-refuted.** In sweet rep 0 the disambiguating token `fileType` **was
  present in context** (1 occurrence) and the agent still matched on `name` only. Rep 1 lacked it.
  `findFileInFolder` never appears in either rep — correctly, because the gold patch *introduces*
  it, so no card could surface it.
- Native solved it 2/2; sweet 0/2. Real gap, but not a completeness gap.

### Adjudication of all 24 signature-A tasks
Condition 1 = fact absent from context; condition 2 = fact reachable at the base commit;
condition 3 = a bounded card **for the edited symbol** would carry it.

| task | f2p | outcome | why |
|---|---|---|---|
| pennylaneai__pennylane-3651 | 0.97 | **only starved case** | `null_qubit` appears **0 times in 941 KB** of full context; file pre-exists. Fails condition 3 — see below. |
| cpisciotta__xcbeautify-324 | 0.99 | variance | In the full-fidelity run the agent patched **all four** gold files; `OutputRendering` seen 65×. |
| swc-project__swc-8619 | 0.95 | variance | The esm twin `packages/helpers/esm` is seen 36× and **was patched** in the full-fidelity run — the sibling copy is demonstrably retrievable. |
| facelessuser__wcmatch-46 | 0.96 | variance | `_wcparse.py` was read twice, then not edited. |
| webonyx__graphql-php-1382 | 0.99 | variance | All missed gold sources present in context. |
| rust-lang__rustfmt-5209 | 0.03 | variance | `src/lists.rs` present in context. |
| statsmodels__statsmodels-9016 | 0.50 | variance | `stattools.py` present in context. |
| avsm__ocaml-yaml-75 | 0.12 | variance | both missed files present. |
| unidata__netcdf-c-1528 | 0.86 | variance | present; task resolves in the full-fidelity run. |
| ota-meshi__eslint-plugin-regexp-306 | 0.25 | variance | both missed files present. |
| symfony__ux-2356 | 0.16 | variance | missed file present. |
| reactivecircus__android-emulator-runner-185 | 0.87 | **condition 2 fails** | `channel-id-mapper.{ts,js}` and `getChannelId` are **created by the gold patch** (0 occurrences of either at base). A card cannot surface a file that does not exist. |
| syuilo__aiscript-209 | 0.79 | **condition 2 fails** | `primitive-props.ts` is a 177-line module the gold patch **creates**. |
| microsoft__kiota-4328 | ~1.00 | excluded | 1311 F2P tests essentially all pass → a PASS_TO_PASS break, not incompleteness. Gold is a `config`→`workspace` rename. Baseline also previously found forged. |
| randombit__botan-2738 | ~1.00 | excluded | f2p≈1 → P2P break; all missed files present in context anyway. |
| devlooped__moq-1319 | ~1.00 | excluded | f2p≈1 → P2P break. |
| devexpress__devextreme-vue-111 | 0.50 | excluded | the only missed file is `example/components/popup-example.vue` — an example, cannot flip a test. |
| cs-si__eodag-790 | 0.06 | **condition 3 fails** | 1 of 17 F2P tests passing — nowhere near "right symbol, one sibling missed". Missing facts are error-handling **policy** changes (`logger.error`→`raise`, 401→500) in other plugins, not use-sites of the edited symbol. |
| maxgraph__maxgraph-365 | 0.50 | **condition 3 fails** | agent edited a null-guard in `isRoot`; the missing fact is `CodecRegistry.addAlias('mxPoint','Point')` — an unrelated symbol a use-site card would never reach. |
| greenwood-987 / yargs-1422 / serverless-12030 / py-pdf__pypdf2-1346 / apple__swift-docc-398 | 0.33 / 0.33 / 0.10 / 0.09 / 0.02 | unprovable | No full-fidelity trace survives; only 600-char-truncated recordings. Per pre-registration, absence is **not** assumed. All are low-`f2pFrac` "barely started" failures that do not fit the near-complete-repair shape. |

### Why the one starved case still does not clear the bar
`pennylane-3651` satisfies conditions 1 and 2: the gold fix adds the string `"SpecialUnitary"` to a
supported-operations list in **two** device files; sweet edited `default_mixed.py` and never saw
`null_qubit.py`.

It fails condition 3 under the handoff's own card design. The specified card carries "the symbol's
declaration, its type, the identifying fields, and its **other use-sites**". At the base commit
`null_qubit.py` **does not mention `SpecialUnitary` at all** — it is not a use-site, it is a place
where the symbol is *absent and ought to be added*. **A use-site card cannot surface an absence.**
Only a different mechanism — enumerating sibling *declarations* of the same class member across
sibling device classes — would carry it. That is not the card that was specified, and building a
new mechanism on a single example is the definition of overfitting.

**Strict count (specified card): 0. Most generous count (allowing a redesigned sibling-declaration
card): 1. Bar: ≥2. Gate 0 fails either way.**

---

## Decision

**Lever #4 DEAD at the $0 gate. Phase 1 not entered.** No card was built, no format-gate/NL-safety
render was needed, no live smoke was run, $0 spent, HO2 untouched.

The deeper finding is that #4's premise does not hold on this corpus. Of the 16 signature-A tasks
where full context survives, **11 are generation-variance — the missed sibling file was already in
the agent's context and the agent skipped it anyway**. That is the same wrong-fix/variance floor
that bounds every retrieval lever here: the constraint is what the agent does with what it has,
not what retrieval puts in front of it. Two more fail because the "missing" file is one the gold
patch *creates*, which no retrieval mechanism can anticipate.

With #1 shipped, #2/#3/#5 and thrash dead, and #4 now dead, the GPT-Sol portfolio is formally
exhausted on this backbone.

