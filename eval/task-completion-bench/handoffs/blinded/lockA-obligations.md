# LOCK A — obligation graphs, derived before reveal

**Written:** 2026-08-13. **Inputs used:** issue text + base source tree only. No accepted
patch, no test patch, no recorded agent attempt, no grader verdict, no `tasks_full_*.json`.

**Known contamination, declared up front:** the session memory index (`MEMORY.md`) is loaded
automatically at session start, before the brief was read. It carries a one-line hook for
`project_no_retrieval_headroom_rotate20` reading *"rotate20 ~zero retrieval headroom;
bingo-274 files don't exist at base"*. That line asserts the accepted solution for
`joshuakgoldberg__bingo-274` touches paths absent from the base tree — i.e. it pre-confirms the
node kind "author a new source module" for the tuning task. The memory file itself was not
opened. **Task 1 below is therefore contaminated on the new-module question and must not be
scored as clean.** The two rotation tasks are uncontaminated; no memory hook mentions them.

Node kinds are the six from §2 of the brief. For every node: owning package, public/internal,
dependency direction. Confidence is stated per node. Exact filenames are not claimed.

---

## Task 1 — `joshuakgoldberg__bingo-274` (contaminated, see above)

**Base:** `aa2363da6dae89bb322beb9916358b3865bd68e4`, 401 files, pnpm workspace, 13 packages.

### Issue, restated in one line

`handlebars()` returns `CreatedEntry | undefined`; `Creation["files"]` requires
`CreatedDirectory`; consumers therefore write `as CreatedDirectory`. Asked for: dedicated file
and directory equivalents that throw when handed the wrong entry kind.

### Facts read out of the base tree

| fact | location |
|---|---|
| `handlebars(sourcePath, options?)` → `CreatedEntry \| undefined`, throws only when `intake` returns undefined | `packages/bingo-handlebars/src/handlebars.ts` |
| `CreatedEntry = CreatedDirectory \| CreatedFileEntry \| false` | `packages/bingo-fs/src/types.ts` |
| `Creation.files: CreatedDirectory` — the assignment target the issue is about | `packages/bingo/src/types/creations.ts` |
| `bingo-fs` public surface is `intake` (value) + `export type * from "./types.js"` — **exactly one runtime export** | `packages/bingo-fs/src/index.ts` |
| a directory/file predicate pair already exists, **private and duplicated**, in another package | `packages/bingo-stratum/src/creators/inferPreset.ts:106-114` |
| `loadHandlebars()` already models the wanted error shape: throws `'…' does not exist.` and `'…' is a file.` | `packages/bingo-handlebars/src/loadHandlebars.ts` |
| module convention: one exported function per file, one sibling `.test.ts`, `index.ts` is a list of `export *` | all of `packages/bingo-handlebars/src/` |
| the "does not exist" message is pinned by an inline snapshot | `packages/bingo-handlebars/src/handlebars.test.ts` |

### Obligation graph

**A1 — author a new source module: the directory variant.** *(high confidence)*
Owning package `bingo-handlebars`. **Public.** Cannot live in `handlebars.ts`: every module under
`packages/bingo-handlebars/src/` exports exactly one function and owns one `.test.ts`; `index.ts`
re-exports per module. Direction: new module → `bingo-fs` (types, `intake`), new module →
`./executeTemplatesRecursive.js` (internal).

**A2 — author a new source module: the file variant.** *(high confidence)*
Owning package `bingo-handlebars`. **Public.** Same convention argument, same directions.

**A3 — add or change an export: `bingo-handlebars` public surface.** *(high confidence)*
`packages/bingo-handlebars/src/index.ts` gains one `export *` line per new module. Direction:
`index.ts` → A1, A2. This is what makes the capability reachable by a consumer; without it the
modules exist and the issue is unfixed.

**A4 — add a type predicate or guard.** *(high confidence that a guard exists; medium on where)*
Narrows `CreatedEntry | undefined` → `CreatedDirectory` on one side and → `CreatedFileEntry` on
the other. It must decide **four** cases, not two: object-not-array → directory; string or array
→ file; `false` → neither; `undefined` → neither. Primary claim: it belongs in **`bingo-fs`**,
**public**, because `bingo-fs` owns `types.ts` and a private copy already exists in
`bingo-stratum`; a third copy would be the second duplication of the same six lines. Secondary,
lower-confidence fallback: a **private** helper inside `bingo-handlebars`. Direction in both
readings: `bingo-handlebars` → `bingo-fs`. Never the reverse — `bingo-fs` has no dependency on
any bingo package and must not gain one.

**A5 — add or change an export: `bingo-fs` gains a runtime (value) export.** *(medium
confidence; conditional on A4 landing in `bingo-fs`)*
`packages/bingo-fs/src/index.ts` is today `export * from "./intake.js"` plus
`export type * from "./types.js"`. A predicate is a **value**, so `export type *` cannot carry
it: either `types.js` stops being type-only, or the predicate gets its own module re-exported
with a plain `export *`. **This is the cross-package export obligation most likely to be
missed.** Direction: `bingo-handlebars` consumes a newly public `bingo-fs` value.

**A6 — preserve an overload.** *(high confidence)*
`handlebars(sourcePath: string, options?: object)` must keep its signature, must keep returning
`CreatedEntry | undefined`, and must keep throwing with the exact text
`handlebars() must be given a path to a file or directory. '<path>' does not exist.` — that
string is an inline snapshot in a visible test. The new variants are additions, not a
replacement. `loadHandlebars(directoryPath, optionsDefaults?)` and its two thrown messages must
likewise keep working.

**A7 — prove a wrong-kind input is rejected.** *(high confidence)*
Input classes and expected behaviour:
- directory variant given a path that resolves to a **file** → **throws**, does not return.
- file variant given a path that resolves to a **directory** → **throws**, does not return.
- either variant given a **non-existent** path → **throws** (preserved from `intake` returning
  `undefined`).
- neither variant may satisfy the issue by returning `undefined` or by coercing. The issue's
  words are "throw an error if given the incorrect entry type".

**A8 — narrow the returned type at the package boundary.** *(high confidence; this is the
acceptance criterion)*
The directory variant must be typed `Promise<CreatedDirectory>` and the file variant
`Promise<CreatedFileEntry>` — **no `| undefined`, no `CreatedEntry`**. Otherwise the `as
CreatedDirectory` assertion in the issue survives and nothing is fixed. Cross-package fact this
depends on: `Creation["files"]` is `CreatedDirectory` imported from `bingo-fs` by `bingo`, so
the variant must produce that same package's type.

**A9 — the loaded form may need the same pair.** *(low confidence, listed for recall)*
`loadHandlebars()` returns an inner `handlebars(sourcePath, options?)` with the identical
`CreatedEntry | undefined` defect. A complete fix plausibly gives the loaded form file and
directory variants too — as extra modules in `bingo-handlebars`, or as properties on the
returned function, or via a shared assertion module (`bingo-handlebars`, internal) that A1, A2
and the loaded form all call. Flagged because the task's failing-test count (12) is larger than
two new functions plus a predicate would normally justify.

### Node kinds asserted NOT to apply

- **update a public enumeration or union** — does not apply. The feature *narrows* the existing
  `CreatedEntry` union at a call boundary; it adds no member to `CreatedEntry`,
  `CreatedFileEntry`, `IntakeEntry` or any other union, and no ordering rule is in play.

### Kill-condition self-check

Nodes A1, A2, A4, A5 name work that does not exist anywhere in the base tree. A4/A5 in
particular are derived from a structural fact — `bingo-fs/src/index.ts` has exactly one value
export — not from knowledge of the solution. The derivation is not a walk over existing paths.

---

## Task 2 — rotation — `holoviz__holoviews-6534` (uncontaminated)

**Base:** `7b2161eb84d354ebc07be1bc68e68bddd1f83808`. Selected by a rule fixed before any
inspection: of the 28 DEV-RET tasks (`select/tasks_heldout.jsonl`) that lie outside
`tasks_luna_rotate20.json` and have both a recorded rollout and a golden checkout, sort
`instance_id` ascending and take indices `floor(n/3)` and `floor(2n/3)`, n=28 → 9 and 18.

**Issue:** `CDSCallback._process_msg` raises `ValueError: The truth value of an array with more
than one element is ambiguous` when the PolyEdit tool sends a four-element list whose third
element is a list of numpy arrays rather than a byte-order string.

**Base fact:** `holoviews/plotting/bokeh/callbacks.py:1406-1418` — the guard chain tests
`len(values) == 4 and values[2] in ("big", "little")`. `values[2] in (...)` evaluates
`ndarray == str` elementwise and then coerces the array to bool. That is the raise, and it
happens **inside the guard**, before the branch body runs.

### Obligation graph

**H1 — no new source module.** *(high confidence)* The whole defect is an over-permissive guard
inside one existing method of one existing module. Nothing needs a new owner.

**H2 — no export change, no public-surface change.** *(high confidence)* `_process_msg` is a
private method (leading underscore) of `CDSCallback` in
`holoviews.plotting.bokeh.callbacks`. Owning package `holoviews`, **internal**. No cross-package
edge in either direction.

**H3 — add a type predicate or guard.** *(high confidence)* This is the only node with real
content. The guard must establish `values[2]` is a `str` **before** the membership test is
evaluated, because `in` on a numpy array is what raises. Owning module: the same
`callbacks.py`, **internal**, expressed inline rather than as a named helper. What it narrows: a
heterogeneous four-element list, to the base64/dtype/byte-order/shape encoding only.

**H4 — prove a wrong-kind input is rejected.** *(high confidence)* Input class: a four-element
list whose `values[2]` is a list of numpy arrays (the PolyEdit payload). Expected behaviour:
**fall through the branch and return the value unchanged — no raise.** Note the polarity: unlike
bingo, correct behaviour here is *not* throwing.

**H5 — preserve behaviour on the byte-order path.** *(high confidence)* The existing
geoviews#584 case — `['pm9…=', 'float64', 'little', [4]]` — must still decode through
`base64.decodebytes` / `np.dtype(...).newbyteorder(...)` / `np.frombuffer`. A guard that is too
tight breaks it.

### Node kinds asserted NOT to apply

author a new source module; add or change an export; preserve an overload; update a public
enumeration or union. **Four of six kinds do not apply.** Stated positively so the gate can be
failed: if the accepted solution adds a module or changes an exported surface, this derivation
is wrong.

---

## Task 3 — rotation — `pennylaneai__pennylane-3651` (uncontaminated)

**Base:** `210af1d088d3f7689dc6fff950e5c98049f8f3f4`. Selected by the same fixed rule.

**Issue:** `SpecialUnitary` is not trainable under autodiff on `default.mixed`. Cause chain
given in the issue: `default.mixed` does not list `SpecialUnitary` as supported → it is
decomposed into `TmpPauliRot` operations with zero parameters → those are also unsupported and
are dropped in the next decomposition → gradient vanishes. The issue names the remedy for this
device: add `SpecialUnitary` to the supported operations.

**Base facts:** `DefaultMixed.operations` is a `set` literal of operation-name strings at
`pennylane/devices/default_mixed.py:69`, currently ~60 entries including `QubitUnitary`,
`ControlledQubitUnitary`, `DiagonalQubitUnitary`. `SpecialUnitary` is defined at
`pennylane/ops/qubit/special_unitary.py:128` and is absent from that set.

### Obligation graph

**P1 — update a public enumeration.** *(high confidence — this is the load-bearing node)*
Which one: `DefaultMixed.operations` in `pennylane/devices/default_mixed.py`. Owning package
`pennylane`, **public** (it is a class attribute of a public device and is what
`Device.supports_operation` reads). **Ordering rule: none** — it is a Python `set` literal, so
membership is the only thing that matters and position is not observable.

**P2 — no export change.** *(high confidence)* `SpecialUnitary` is already exported from
`pennylane.ops.qubit`; the device gains a **string name**, not an import. Direction of the
existing edge: `pennylane.devices.default_mixed` → the device-support machinery → operation
names. No new cross-package or cross-module edge is created.

**P3 — no new source module.** *(medium-high confidence)* Every mechanism the fix needs already
exists: the generic matrix-application path in `DefaultMixed._apply_operation`, and
`SpecialUnitary.matrix()`. Adding a name to a set does not need a new owner.

**P4 — prove a wrong-kind input is rejected — restated as its dual.** *(high confidence)* The
observable is a **non-vanishing** gradient. Input class: a `SpecialUnitary` on
`default.mixed` under a differentiable interface. Expected behaviour:
`jax.grad(circuit)(x)` must be non-zero and must match the `default.qubit` result;
`device.supports_operation("SpecialUnitary")` must be true; the tape must **not** contain
`TmpPauliRot` after device expansion.

**P5 — preserve behaviour.** *(high confidence)* Devices that genuinely cannot apply an
arbitrary matrix must keep decomposing `SpecialUnitary`. The change is scoped to one device's
support list — the issue explicitly says other devices remain an open question, so widening it
to the shared base class would be scope the issue does not ask for.

**P6 — a second enumeration may need the same entry.** *(low confidence, listed for recall)*
If the repo carries a parallel list — a `stopping_condition`, an `_operations`/`observables`
mirror, or a per-interface device subclass such as `default.mixed.autograd`/`.jax` that
re-declares support — the same string must be added there too, or support is inconsistent
across interfaces. The failing-test count (127) is far larger than a single set entry would
suggest, which is why this node is listed at all.

### Node kinds asserted NOT to apply

author a new source module; add or change an export; preserve an overload; add a type predicate
or guard.

---

## Summary of what a reveal must show for each task to pass

| task | must appear | must NOT appear |
|---|---|---|
| bingo-274 | ≥2 new modules in `bingo-handlebars`, public; `index.ts` export change; guard + narrowed return types; `handlebars()` preserved | — |
| holoviews-6534 | guard added inside existing private method of `callbacks.py` | any new module, any export change |
| pennylane-3651 | `"SpecialUnitary"` added to `DefaultMixed.operations` | any new module, any export change |
