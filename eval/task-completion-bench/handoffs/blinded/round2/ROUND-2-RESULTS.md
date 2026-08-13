# ROUND 2 RESULTS — obligation-graph gate, rotation

**Run:** 2026-08-13. **Spend: `$0`.** No model rollouts, no paid calls, no pilots. Every statement
below comes from reading base trees and stored artifacts.

---

## 0. Declaration and lock hash

> I did not open `handoffs/improve/`, `handoffs/blinded/picker/`, the previous round's results
> or lock files, or any `tasks_full_*.json` before writing and hashing my lock file. I checked
> my memory index for contamination and found: **none**.
> Lock hash: `e23a4b2a375b09be307fbd5c3a2af618918abac57eedda47d861a99437fd5f03`.

### 0.1 The memory-index check, in full

`MEMORY.md` loaded automatically before the brief could be read, so the check was done first and
against the whole index. No line names any of the five repositories on this slate, nor any symbol,
filename or finding belonging to them. Three index lines do name benchmark repositories — `kiota`,
`zeek` and `Julia` — and none of the three is on this slate. One line carries an explicit warning
that its *body* names task answers; that file was not opened, and its one-line hook names no
repository. **This round is uncontaminated.**

### 0.2 A base-tree hazard worth recording

The golden checkouts are **not** clones of upstream history. Each is a single synthetic commit made
when the harness materialised the tree, so `git rev-parse HEAD` returns an unrelated hash and
`git cat-file` on the stated base commit fails outright. A session that trusted `git checkout
<base_commit>` here would fail; a session that ran `git log` looking for the base commit would find
a branch tip instead. I copied tracked files only (`git ls-files | tar`) and then verified each tree
is pre-fix by confirming zero hits for the thing the issue asks for — `EnableIfAttr`, `style`,
`KinesisFirehoseResponseRecordMetadata`, `no-console`, `peerDependencies`. All five are clean.

---

## 1. Per-task results

Twenty-one nodes filed across five tasks. Four new source modules in the accepted solutions; all
four predicted with the correct owning package.

### 1.1 `konstantin8105__c4go-367` — **PASS**, 0 false positives

**Derived.** The issue's three error messages are two different failures wearing one label.
`AllocSizeAttr` already exists in the tree, so its line reaches a parser and panics — which is why
that message reads `Cannot parse line … bad integer` while the other two read `unknown node type`.
The regex makes the second integer optional but hands the empty capture to `util.Atoi`, which
panics; `ast.Parse` recovers and emits an error node. The other two node kinds are simply absent.
Filed: an in-place fix to `parseAllocSizeAttr` in package `ast` (**not** in `util`, which was named
only as a low-confidence alternative site); two new modules in package `ast`; the two new exported
types satisfying the `ast.Node` interface, with `EnableIfAttr` additionally capturing the quoted
message; preservation of `AllocSizeAttr`'s exported `A`/`B` fields and its two-integer and
`Inherited` forms; and **two** union sites — the node-name switch in `ast.Parse` and the type switch
in `setPosition`. Asserted not to apply: any `transpiler` case (only 3 of 30 attribute types appear
there and the default arm warns rather than errors) and any `program/struct.go` entry (that ignore
list is struct-field attributes; these three are function attributes).

**Reveal.** Five files: `ast/alloc_size_attr.go`, `ast/ast.go`, `ast/enable_if_attr.go`,
`ast/overloadable_attr.go`, `ast/position.go`.

**Score.** New modules **2/2**, correct owning package. Both union sites present. The in-place fix
is at the predicted site, in `ast`, and guards both integers exactly as derived. `EnableIfAttr`
carries `Message1` from the quoted capture, as derived. Both asserted negatives hold — the patch
touches neither `transpiler` nor `program`. Every one of the five modified files was predicted.
**False positives: 0.**

### 1.2 `smooth-code__svgr-10` — **FAIL**, 1 false positive

**Derived.** The h2x pass emits the `<style>` element's text as raw JSX text, so babel reads
`{fill:#34107D}` as an expression container. Filed: a new transform module under `src/h2x/` in
package `svgr`; its addition to the public export list in `src/index.js`; unconditional insertion
into the default plugin array in `getH2xPlugins()`; and — node 2.4 — that the emitted JSX for the
style text becomes an expression container wrapping a string literal.

**Reveal.** Six files. Three are source: `src/h2x/removeStyle.js` (new), `src/configToOptions.js`,
`src/index.js`. The other three are lint and coverage configuration incidental to the fix
(`.eslintignore`, jest `collectCoverageFrom`, an `eslint-disable` line in `webpack.js`).

**Score.** New module **1/1**, correct owning package and correct directory. The export obligation
is present and was required — the patch does add `removeStyle` to `src/index.js`'s export list. The
wiring node is exact: the patch appends `removeStyle` to the same unconditional array
`[jsx, stripAttribute('xmlns'), removeComments]`, not behind a config flag.

**Node 2.4 is wrong, and it is the substantive claim.** The accepted solution does not preserve the
stylesheet. `removeStyle.js` is thirteen lines that call `path.remove()` on any `JSXElement` named
`style`. The crash is fixed by deleting the content. My lock named this outcome explicitly as the
way the task could go the other way — *"deleting the `<style>` element … would silence the crash by
destroying content and is not the requested capability"* — and predicted it would therefore not
happen. It happened, by an h2x plugin rather than by svgo. **False positives: 1.**

One further imprecision, recorded rather than excused: node 2.1 stated the new module would import a
node constructor from `h2x-plugin-jsx`, as `expandProps.js` does. The accepted module imports
nothing. The node itself was needed; the dependency edge I attached to it does not exist.

Under a literal reading of §4 this task clears both PASS bullets — the new module appears with the
correct owning package, and every export obligation the solution relies on appears. I am scoring it
**FAIL** anyway, because the graph asserts a mechanism the solution does not use, and the point of
the artefact is to say what the change must do. A near miss is a miss.

### 1.3 `aws__aws-lambda-dotnet-1346` — **PASS**, 0 false-positive nodes

**Derived.** Filed: a new public type carrying the partition keys as a string-to-string dictionary
in package `Amazon.Lambda.KinesisFirehoseEvents`, `[DataContract]`, its member carrying
`[DataMember(Name = "partitionKeys")]` **and** the `#if NETCOREAPP_3_1`
`System.Text.Json.Serialization.JsonPropertyName` twin, because the package multi-targets
`netstandard2.0;netcoreapp3.1` and the two serializers read different attributes; a public
`Metadata` property on `FirehoseRecord` with the same attribute pair; and preservation of every
existing member. Asserted **no new source module**, on the evidence that the package holds exactly
two `.cs` files and both top-level types already nest their record class in the same file.

**Reveal.** One file, `KinesisFirehoseResponse.cs`. A nested `[DataContract] public class
FirehoseResponseRecordMetadata` with `public Dictionary<string, string> PartitionKeys`, both
attributes present; and `public FirehoseResponseRecordMetadata Metadata { get; set; }` on
`FirehoseRecord`, both attributes present.

**Score.** New modules **0/0** — the "no new module" claim was correct, and it was the load-bearing
call on this task. Both export nodes are exact, including the dual-attribute requirement and the
reason for it. The issue proposed the name `KinesisFirehoseResponseRecordMetadata`; the accepted
name is `FirehoseResponseRecordMetadata`. The bar does not require exact names.
**False-positive nodes: 0.** One over-assertion inside a correct node: node 3.3 added, at declared
medium confidence, that a null `Metadata` must not appear in the serialised response. The accepted
solution does nothing about null suppression. The node's primary claim — existing signatures
preserved — holds.

### 1.4 `vuejs__eslint-plugin-vue-2194` — **PASS**, 0 false positives

**Derived.** Filed: one new rule module `lib/rules/no-console.js` in package `eslint-plugin-vue`,
which cannot live in an existing file because `tools/lib/rules.js` derives each rule id from a
filename and `lib/index.js` requires it by path; the `rules` map in `lib/index.js` — the package
entry, generated but checked in — gaining `'no-console'` in **alphabetical** position; and the
`RuleModule` meta contract enforced by the repo's own internal rules `no-invalid-meta` and
`no-invalid-meta-docs-categories`. Asserted not to change: `lib/configs/*` (the rule lands
uncategorized — 65 of 225 current rules carry no categories — and `no-layout-rules.js` collects only
`meta.type === 'layout'`), and `lib/utils`.

**Reveal.** Four files: two documentation, plus `lib/index.js` and the new `lib/rules/no-console.js`.

**Score.** New module **1/1**, correct owning package. The enumeration node is exact, including the
ordering rule and the insertion point — the patch places `'no-console'` immediately after
`'no-computed-properties-in-data'`, the left neighbour named in the lock. The meta-contract node is
confirmed in the strongest possible way: the accepted file carries the literal line
`// eslint-disable-next-line no-invalid-meta, no-invalid-meta-docs-categories`, naming the two
internal rules the lock named. Both asserted negatives hold. **False positives: 0.**

**But the dependency direction was ranked wrong.** The lock made a bespoke rule built on
`defineTemplateBodyVisitor` the primary shape, and `wrapCoreRule` the low-confidence alternative,
reasoning that core `no-console` resolves the global `console` variable at `Program:exit` and a
template body does not populate that scope. The accepted solution is
`utils.wrapCoreRule('no-console', { create })` — the alternative — *with a hand-written
`MemberExpression` visitor* whose comment reads "Copied from the core rule `no-console`". The
reasoning was right and the ranking was wrong: the real answer is both halves, and I ranked the half
that supplies the meta below the half that supplies the detection. The edge onto the installed
`eslint` package's rule registry is real and sits in my graph at low confidence instead of at the
front.

### 1.5 `joshuakgoldberg__create-typescript-app-2061` — **PASS**, 1 false positive

**Derived.** A three-stage narrowing, derived from the base tree: `readPackageData` reads the raw
file through `inputFromFileJSON` and types it as `PartialPackageData`, which declares thirteen
fields and neither peer field; `base.ts` publishes it as the `packageData` option whose zod object
declares exactly `dependencies`, `devDependencies` and `scripts`; and `blockPackageJson.produce`
rebuilds `package.json` from scratch, carrying over only those three. Any other pre-existing
property is dropped by construction — which is why the symptom is not specific to peer dependencies.
Filed: widening the `packageData` option schema in `src/base.ts`, noted as a **public** surface
change because `src/index.ts` does `export * from "./base.js"`, with an explicitly named wider
variant — *"carry the whole of `options.packageData` through by passthrough rather than naming two
fields"*; the in-place change in `blockPackageJson.produce`; preservation of the existing merge
semantics; and, at **low confidence**, the same two fields on `PartialPackageData`. Asserted **no
new source module**.

**Reveal.** Two files. `src/base.ts` gains `peerDependencies: z.record(z.string(),
z.string()).optional()` and `peerDependenciesMeta: z.record(z.unknown()).optional()`.
`src/blocks/blockPackageJson.ts` gains a single line: `...options.packageData,` spread first, before
`...addons.properties` and before the explicit field list.

**Score.** New modules **0/0** — correct. Both required edits are exact, in the right modules, with
the public/internal call right. The accepted solution used *both* variants named in the lock: the
schema names the two fields, and the produce site spreads wholesale. The preservation node holds —
the spread is placed first, so `useLargerVersions`, the scripts merge and the explicit fields all
still win. My `peerDependenciesMeta` shape was `z.record(z.object({ optional: z.boolean().optional()
}))` against the accepted `z.record(z.unknown())`; the obligation is identical and the bar scores
module, surface and direction.

**Node 5.4 is a false positive.** `src/types.ts` is untouched. The lock filed it at low confidence
with the correct reason — *"TypeScript accepts the narrower interface without it"* — which is
exactly why it was not needed. **False positives: 1.**

---

## 2. Overall verdict

**FAIL against §4's bar: four of five, not five of five.**

| task | new modules | other obligations | asserted negatives | false positives | verdict |
|---|---|---|---|---:|:--|
| `c4go` | 2/2 ✅ | all present | 2/2 correct | 0 | **PASS** |
| `svgr` | 1/1 ✅ | all present | **1 wrong** | 1 | **FAIL** |
| `aws-lambda-dotnet` | 0/0 ✅ | all present | 1/1 correct | 0 | **PASS** |
| `eslint-plugin-vue` | 1/1 ✅ | all present | 2/2 correct | 0 | **PASS** |
| `create-typescript-app` | 0/0 ✅ | all present | 1/1 correct | 1 | **PASS** |

**Totals.** New source modules: **4 of 4**, every one with the correct owning package. Export,
overload and enumeration obligations: none missed on any task. False positives: **2 of 21 nodes**,
both filed at or flagged as low confidence at lock time. One over-assertion clause inside an
otherwise correct node. One dependency direction correctly identified but ranked second.

### 2.1 What this round adds that the previous one could not

The previous round passed its gate 2 out of 2, and said plainly what it had not tested: *"Neither
rotation task tests recall of **absent modules**, which is the capability that would resolve
`bingo`. The only test of that capability is the contaminated one. A clean replication needs a
rotation task whose accepted solution authors a new module, chosen blind."*

That is precisely what this slate delivered — three of five tasks author new modules, four modules
in total, and the slate was sealed before I saw it. **On the one capability the previous round could
not test, the result is 4 of 4 with correct owning packages, plus correct refusal on the two tasks
that add none.** The contaminated `bingo` result the previous round reported but declined to count
now has a clean replication behind it.

### 2.2 Where I agree and differ with the previous round

I agree with its Gate A verdict and with the limitation it declared on itself. Two differences of
substance:

**The failure mode has moved.** The previous round's misses were *over-reach into a neighbouring
module* — asserting a package index would change when it did not, and a low-confidence variant that
was not in gold. Mine are the same species: both false positives are low-confidence nodes about a
type or a mechanism one level out from the change. The capability is not failing to *find* the
change; it over-describes its edges. That is a precision problem, and precision is cheap to tune
because the low-confidence marks already sort the wheat correctly — in both rounds, every false
positive was flagged low-confidence or hedged *before* the reveal, and no high-confidence node was
wrong.

**The one real failure is not structural.** On `svgr` the graph identified the right package, the
right directory, a new module, the export, and the exact wiring line — and then predicted that the
maintainer would preserve the stylesheet. He deleted it. Thirteen lines, `path.remove()`. The
derivation error is a judgment about what a maintainer will choose when two fixes are available, not
a failure to read the tree. That distinction matters for what this capability can be sold as: it
derives what *must* be true for a capability to exist, and the accepted patch here chose to remove
the capability instead. Any downstream use has to survive that gap.

---

## 3. Post-lock observations, scored as misses

- The union insertion in `ast.Parse` is **strictly** alphabetical, not "loosely alphabetical, not
  enforced" as the lock hedged. The hedge was justified by the base file, where `AnnotateAttr`
  precedes `AllocSizeAttr`, but the accepted patch inserts both new cases in exact alphabetical
  position. Scored as a miss on the ordering rule.
- `eslint-plugin-vue` has no `no-const-assign` rule; the lock named it as the right-hand neighbour
  in `lib/index.js`. The left neighbour and the insertion point were right. Scored as a miss.
- On `svgr`, three of the six touched files are lint and coverage configuration. No node kind in the
  table covers them, and none is load-bearing for the capability, but a graph that claims to predict
  a change's shape currently says nothing about that class of file.

---

## 4. What should happen next

**This capability survives, with its scope cut.** Four of four new modules with correct owning
packages, on a blind slate, after a previous round that could not test that at all — that is the
evidence the programme was missing, and it is now in hand. It does not pass the gate as written,
and the gate should not be re-cut to let it through.

Three concrete next steps, cheapest first:

1. **Fix precision before adding anything.** Both false positives across both rounds were
   low-confidence nodes about edges one hop from the change — a package index, a type alias, an
   import. The signal to act on already exists: low-confidence marks were right both times, and no
   high-confidence node has yet been wrong across two rounds. Either drop low-confidence edge nodes
   from the scored graph, or report them in a separate tier that does not count as an assertion.
   This costs `$0` and is a change to the artefact's format, not to the method.

2. **Do not claim mechanism, only shape — or test mechanism separately.** The `svgr` failure is the
   whole risk in miniature. The graph is reliable about *where* a change lands and *what surface it
   touches*; it is not reliable about *which of two admissible fixes a maintainer picks*. If the
   downstream use needs mechanism, that needs its own gate with its own bar. If it needs only shape,
   say so, and `svgr` stops being a failure and starts being a scope boundary.

3. **One more rotation, five tasks, same protocol, seed fixed in advance.** Two rounds now agree on
   the failure species, which is the point at which a third round either confirms a rate or breaks
   the pattern. Exclude this slate and the previous one. The marginal cost is a session at `$0`.

**On the blinding machinery itself.** The `MEMORY.md` leak did not recur this round, and the
brief's instruction to check the index first is what made that verifiable rather than assumed. The
new hazard is the one in §0.2: the golden checkouts do not contain the base commit as a git object,
so "check out the base commit and do not read forward" is not literally executable on this box. A
future brief should say to extract the tracked files and verify the tree is pre-fix, which is both
safer and what actually works.
