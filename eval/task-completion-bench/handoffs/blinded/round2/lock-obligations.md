# LOCK — obligation graphs, rotation round 2

Written before any accepted patch, test patch, sealed label, previous-round result or planning
document was opened. Inputs used: `ISSUES.json`, `SLATE-PUBLIC.json`, and the five base trees.

**Base-tree provenance.** The golden checkouts on the evidence box are not clones of upstream
history — each is a single synthetic commit whose working tree is the base tree, so
`git cat-file` on the stated base commit fails and there is no forward history to read. I copied
the tracked files only (`git ls-files | tar`) and verified every tree is pre-fix: `EnableIfAttr`,
`style`, `KinesisFirehoseResponseRecordMetadata`, `no-console` and `peerDependencies` each have
zero hits in the respective source directories.

Confidence is stated per node. Dependency direction is given as `A → B` meaning A depends on B.

---

## Task 1 — `konstantin8105__c4go-367`

**Capability.** Three clang AST dump lines must parse into AST nodes instead of becoming
`/* AST Error */` comments in the generated Go: `AllocSizeAttr … <col:100, col:116> 2`,
`EnableIfAttr … "<no message provided>"`, and `OverloadableAttr … <col:61>`.

**Derived root cause.** Two different failures wearing one label. `AllocSizeAttr` already exists,
so its line reaches a parser and panics; the other two are unknown node names. `ast.Parse`
recovers from the panic and returns `C4goErrorNode`, which is why one message says
`Cannot parse line … bad integer` and the other two say `unknown node type`.

| # | node kind | statement |
|---|---|---|
| 1.1 | modify existing behaviour in place | `parseAllocSizeAttr` — owning package `ast` (`github.com/Konstantin8105/c4go/ast`); function internal, its type public. Its regex makes the second integer optional (`(?P<a> \d+)(?P<b> \d+)?`) but feeds the empty capture to `util.Atoi`, which panics `bad integer`. The single-integer form must parse. Direction `ast → util`, unchanged. **High.** Low-confidence alternative site: the guard is put in `util.Atoi` (package `util`) so empty becomes `0` everywhere. |
| 1.2 | author a new source module | One module per clang node kind for `EnableIfAttr` — owning package `ast`, file internal, type public. It cannot live in an existing file: the package holds one file per node kind (30 `*Attr` files alone), each with the struct, its `parse…` constructor and the four `Node` methods. Direction: `ast` gains no dependency; `program` and `transpiler` depend on `ast`. **High.** |
| 1.3 | author a new source module | The same for `OverloadableAttr`, owning package `ast`. **High.** |
| 1.4 | add or change an export | Package `ast`'s public surface gains exported types `EnableIfAttr` and `OverloadableAttr`, each satisfying the exported `ast.Node` interface (`Address() Address`, `Children() []Node`, `AddChild(Node)`, `Position() Position`) with public `Addr`, `Pos`, `ChildNodes` fields. `EnableIfAttr` additionally captures the quoted message. Their constructors stay internal. **High.** |
| 1.5 | preserve an overload or existing signature | `AllocSizeAttr` keeps its exported `A int` and `B int` fields, and the two-integer form and the `Inherited <a> <b>` form keep parsing to the same values. The fix widens the accepted input, it does not replace it. **High.** |
| 1.6 | update a public enumeration or union | The node-name→constructor switch inside `ast.Parse` (`ast/ast.go`) gains `"EnableIfAttr"` and `"OverloadableAttr"`. This switch *is* the union of supported clang node kinds; `Parse` is public, the switch internal. Ordering: loosely alphabetical and not enforced (`AnnotateAttr` precedes `AllocSizeAttr` today). **High.** |
| 1.7 | update a public enumeration or union | The `Node` type switch in `setPosition` (`ast/position.go`) gains `*EnableIfAttr` and `*OverloadableAttr`. Internal function, second half of the same union — every existing node type appears there, and position fixing silently skips a type that does not. **Medium-high.** |

**Asserted negatives (no node filed).** No `transpiler` case is needed: only 3 of 30 attribute
types appear there and the default arm emits a warning, not an error. No `program/struct.go`
entry is needed: that ignore list covers struct-field attributes, and these three are function
attributes. No type predicate and no wrong-kind-input rejection applies.

---

## Task 2 — `smooth-code__svgr-10`

**Capability.** An SVG containing `<style type="text/css">` must convert to a React component
that parses, instead of throwing `SyntaxError: Unexpected token, expected }`.

**Derived root cause.** The h2x pass emits the `<style>` element's text child as raw JSX text, so
babel reads `{fill:#34107D}` as a JSX expression container. Nothing under `src/` mentions style,
text or CDATA nodes today. This is svgr 0.4.0: one root package, no monorepo yet, pipeline
`svgo → h2x → babel transform → prettier`.

| # | node kind | statement |
|---|---|---|
| 2.1 | author a new source module | A new h2x transform module under `src/h2x/` — owning package `svgr` (the single root package), file internal. It cannot live in an existing file: each h2x transform is one module default-exporting a plugin factory `() => ({ visitor: … })` (five exist: `emSize`, `expandProps`, `removeComments`, `replaceAttrValue`, `stripAttribute`), and both `src/index.js` and `src/configToOptions.js` import them one path per plugin. Direction: `src/h2x/* → h2x-plugin-jsx` only, exactly as `expandProps.js` imports `JSXAttribute`; no new package dependency. **High.** |
| 2.2 | add or change an export | `src/index.js`'s public export list gains the new plugin. That list is the package's public plugin surface and currently names all seven transforms. **Medium-high.** |
| 2.3 | modify existing behaviour in place | `getH2xPlugins()` in `src/configToOptions.js` must push the new plugin **unconditionally**, beside `jsx`, `stripAttribute('xmlns')` and `removeComments` — not behind a config flag like `icon` or `expandProps`. Internal function inside a default-exported module. Observable change: the default `convert()` path stops throwing on a style-bearing SVG. **High.** |
| 2.4 | modify existing behaviour in place | The JSX emitted for a `<style>` element's text becomes a JSX expression container wrapping a string literal (`<style>{'.st0{fill:#34107D}'}</style>`) instead of raw JSX text; the embedded predicate is either "element is `style`" or, more widely, "text contains `{` or `}`". Package `svgr`, executed inside the h2x pass. **High** on the shape, the two predicates are the same node. |

**Asserted negatives (no node filed).** No change to `src/plugins/svgo.js` or the svgo plugin list
— deleting the `<style>` element via svgo's `removeStyleElement` would silence the crash by
destroying content and is not the requested capability. This is the most likely way this task
goes the other way. No change to `src/plugins/transform.js`: the JSX text is already malformed
before babel sees it, so no parser option can help. No enumeration, predicate, overload or
wrong-kind-input node applies.

---

## Task 3 — `aws__aws-lambda-dotnet-1346`

**Capability.** A transformation handler must be able to set per-record
`metadata.partitionKeys` and have it serialise to the JSON that Firehose dynamic partitioning
expects.

| # | node kind | statement |
|---|---|---|
| 3.1 | add or change an export | A new **public** type carrying `PartitionKeys` as a string-to-string dictionary (`IDictionary<string, string>` or `Dictionary<string, string>`), in namespace and package `Amazon.Lambda.KinesisFirehoseEvents`. It must be `[DataContract]` and its member must carry `[DataMember(Name = "partitionKeys")]` **and** the `#if NETCOREAPP_3_1` `System.Text.Json.Serialization.JsonPropertyName` twin — every existing member in this package carries both, because the package multi-targets `netstandard2.0;netcoreapp3.1` and the two serializers read different attributes. **High.** |
| 3.2 | add or change an export | `KinesisFirehoseResponse.FirehoseRecord` gains a public `Metadata` property of that type, again with `[DataMember(Name = "metadata")]` plus the conditional `JsonPropertyName("metadata")`. Public surface of the same package. **High.** |
| 3.3 | preserve an overload or existing signature | `KinesisFirehoseResponse.Records` (`IList<FirehoseRecord>`), `FirehoseRecord.RecordId`, `.Result`, `.Base64EncodedData`, `.EncodeData(string)` and the three `TRANSFORMED_STATE_*` constants all keep their present signatures, and the addition stays optional — a handler that never sets `Metadata` must keep producing today's payload rather than emitting a null `metadata`. **High** on the signatures, **medium** on null suppression. |

**Asserted negatives (no node filed).** **No new source module.** The new type is nested inside
the existing `KinesisFirehoseResponse.cs`: this package contains exactly two `.cs` files, and
both `KinesisFirehoseResponse` and `KinesisFirehoseEvent` already nest their `FirehoseRecord`
class in the same file. **Medium-high**; the low-confidence alternative is a separate file, whose
owning package would still be `Amazon.Lambda.KinesisFirehoseEvents`. No other package changes:
the serialization packages depend on the events package, never the reverse. No enumeration
update (the `TRANSFORMED_STATE_*` constants are untouched), no predicate, no wrong-kind-input
rejection, no in-place behaviour change to an existing method.

---

## Task 4 — `vuejs__eslint-plugin-vue-2194`

**Capability.** A new `vue/no-console` rule must report `console` usage inside `<template>`
expressions, mirroring ESLint core's `no-console`.

| # | node kind | statement |
|---|---|---|
| 4.1 | author a new source module | One rule module `lib/rules/no-console.js` — owning package `eslint-plugin-vue` (root package), file internal, its default export public through the plugin's rule map. It cannot live in an existing file: `tools/lib/rules.js` derives each rule id from a filename in `lib/rules/`, `lib/index.js` requires it by path, and the docs and config generators key off that same list; `tools/new-rule.js` writes exactly one rule module per rule. **High.** |
| 4.2 | update a public enumeration or union | `lib/index.js`'s `rules` map gains `'no-console': require('./rules/no-console')`. That file is the package entry point and therefore public, is generated by `npm run update` but checked in, and is **alphabetically ordered by rule id** — the new key belongs between `no-computed-properties-in-data` and `no-const-assign`. **High.** |
| 4.3 | preserve an overload or existing signature | The module must export the `RuleModule` shape the loader and the repo's own lint expect: `{ meta: { type, docs: { description, categories, url }, schema, … }, create(context) }`, with `meta.docs.url` = `https://eslint.vuejs.org/rules/no-console.html` and `meta.docs.categories` present even when `undefined`. Enforced by the repo's internal rules `eslint-internal-rules/no-invalid-meta` and `no-invalid-meta-docs-categories`. Internal contract, public consequence. **High.** |

**Direction.** `lib/index.js → lib/rules/no-console.js → lib/utils/index.js`, never the reverse.
Primary shape: a **bespoke** rule built on `utils.defineTemplateBodyVisitor` plus the existing
scope helpers (`getScope`, `findVariable`), because core `no-console` resolves the global
`console` variable's references at `Program:exit`, and a Vue template body does not populate that
JavaScript global scope. **Low-confidence alternative:** `utils.wrapCoreRule('no-console')`,
which would add a dependency edge onto the installed `eslint` package's rule registry through
`getCoreRule` and set `meta.docs.extensionRule = true`.

**Asserted negatives (no node filed).** `lib/configs/*.js` is unchanged — the rule lands
uncategorized (65 of the 225 current rules carry no categories) and `no-layout-rules.js` collects
only rules whose `meta.type === 'layout'`. **Medium-high.** No change to `lib/utils`: the
template-body machinery already exists. `docs/rules/no-console.md`, `docs/rules/index.md` and
`tests/lib/rules/no-console.js` are excluded by the bar.

---

## Task 5 — `joshuakgoldberg__create-typescript-app-2061`

**Capability.** Running the generator over an existing repository must leave that repository's
`peerDependencies` and `peerDependenciesMeta` intact in the emitted `package.json`.

**Derived root cause — a three-stage narrowing.** `readPackageData` (`src/options/readPackageData.ts`)
reads the raw file through `inputFromFileJSON` and types the result as `PartialPackageData`
(`src/types.ts`), an interface declaring thirteen fields and neither peer field. `base.ts` then
publishes it as the `packageData` **option**, whose zod object declares exactly `dependencies`,
`devDependencies` and `scripts`, so everything else is narrowed away. Finally
`blockPackageJson.produce` rebuilds `package.json` from scratch — it spreads `addons.properties`
and then re-adds an explicit field list, carrying over only `options.packageData?.dependencies`,
`.devDependencies` and `.scripts`. Any other pre-existing property is dropped by construction,
which is why the symptom is not specific to peer dependencies.

| # | node kind | statement |
|---|---|---|
| 5.1 | add or change an export | The `packageData` option schema in `src/base.ts` gains `peerDependencies` and `peerDependenciesMeta` as optional entries (a string-to-string record, and a record of `{ optional?: boolean }`). This is a **public** surface change: `src/index.ts` does `export * from "./base.js"`, so the option type is part of the package API and of every consumer preset and addon. Equivalent wider variant, same node: carry the whole of `options.packageData` through by passthrough rather than naming two fields. **High.** |
| 5.2 | modify existing behaviour in place | `blockPackageJson.produce` (`src/blocks/blockPackageJson.ts`; the block is public via `src/blocks/index.ts`) must emit both fields from `options.packageData`, merged with `addons.properties`. Observable change: both properties survive a run on a repo that already has them. Direction `blocks → base`, never the reverse. **High.** |
| 5.3 | preserve an overload or existing signature | The existing merge semantics are unchanged: `dependencies` and `devDependencies` keep going through `useLargerVersions`, `scripts` keeps `{...options.packageData?.scripts, ...addons.properties.scripts}`, and `sortPackageJson` plus `removeUndefinedObjects` keep post-processing, so a package with no peer fields must still emit none rather than an empty object. **Medium-high.** |
| 5.4 | add or change an export | `PartialPackageData` in `src/types.ts` gains the two optional fields. **Internal** — `src/index.ts` re-exports `base`, `blocks` and `presets`, not `types.js`. **Low confidence:** this is only forced if the option producer's return type must carry them, and TypeScript accepts the narrower interface without it. |

**Asserted negatives (no node filed).** **No new source module** — this is field plumbing through
three existing modules. **High.** No enumeration or union update, no type predicate, no
wrong-kind-input rejection.

---

## Summary of what is being claimed

| task | new source modules claimed | other nodes | low-confidence nodes |
|---|---|---|---|
| c4go | 2 (both in package `ast`) | 5 | 0 (one alternative site noted inside 1.1) |
| svgr | 1 (package `svgr`, `src/h2x/`) | 3 | 0 |
| aws-lambda-dotnet | **0** | 3 | 0 |
| eslint-plugin-vue | 1 (package `eslint-plugin-vue`, `lib/rules/`) | 2 | 0 |
| create-typescript-app | **0** | 4 | 1 (5.4) |
